import * as assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { MetaLensApi } from '../../../src/extension';

/** Poll until `check` is true or the timeout expires. */
async function until(check: () => boolean, what: string, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

suite('meta-lens smoke test (bsp-custom)', () => {
  let api: MetaLensApi;

  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension<MetaLensApi>('oliviertanoh.meta-lens');
    assert.ok(ext, 'extension not found');
    api = await ext.activate();
    assert.equal(ext.isActive, true);
    await api.refresh();
    // VS Code's file watcher starts asynchronously; give it time before the
    // tests that rely on file events.
    await new Promise((r) => setTimeout(r, 2000));
  });

  test('registers its commands', async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const c of [
      'meta-lens.refresh',
      'meta-lens.open',
      'meta-lens.showOverlayChain',
      'meta-lens.filterRecipes',
      'meta-lens.filterAppends',
      'meta-lens.showAllRecipes',
      'meta-lens.showProjectRecipes',
    ]) {
      assert.ok(commands.includes(c), `${c} missing`);
    }
  });

  test('lists layers in BBLAYERS order with their origin', () => {
    const layers = api.getProjects().flatMap((p) => p.layers);
    assert.deepEqual(
      layers.map((l) => [l.name, l.origin.kind]),
      [
        ['meta', 'upstream'],
        ['meta-poky', 'upstream'],
        ['meta-acme-bsp', 'project'],
        ['meta-oe', 'upstream'],
        ['meta-qt6', 'project'],
        ['meta-acme', 'project'],
      ],
    );
  });

  test('indexes recipes, bbappends, overlays and images', () => {
    const p = api.getProjects()[0];
    assert.ok(p);
    const busybox = p.recipes.find((r) => r.pn === 'busybox');
    assert.deepEqual(
      busybox?.appends.map((a) => path.basename(path.dirname(path.dirname(path.dirname(a))))),
      ['meta-acme-bsp', 'meta-acme'],
    );
    assert.ok(p.recipes.some((r) => r.pn === 'openssh' && r.overlay));
    assert.ok(p.recipes.some((r) => r.pn === 'acme-image' && r.image));
    assert.deepEqual(
      p.config.confFiles.map((f) => path.basename(f)),
      ['local.conf'],
    );
  });

  test('sidebar webview starts and talks to the extension', async () => {
    await vscode.commands.executeCommand('meta-lens.open');
    await Promise.race([
      api.sidebarReady(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('webview not ready')), 15_000)),
    ]);
    // The webview reports its initial filter: project recipes only.
    await until(() => (api.getRecipeFilter().scope ?? 'project') === 'project', 'initial filter');

    // Command → webview → back to the extension.
    await vscode.commands.executeCommand('meta-lens.filterAppends');
    await until(() => api.getRecipeFilter().kind === 'appends', 'hasAppends on');
    await vscode.commands.executeCommand('meta-lens.filterAppends');
    await until(() => api.getRecipeFilter().kind === undefined, 'hasAppends off');

    await vscode.commands.executeCommand('meta-lens.showAllRecipes');
    await until(() => api.getRecipeFilter().scope === 'all', 'show all');
    await vscode.commands.executeCommand('meta-lens.showProjectRecipes');
    await until(() => api.getRecipeFilter().scope === 'project', 'project only');
  });

  test('overlay chain panel opens for busybox', async () => {
    const busybox = api.getProjects()[0]!.recipes.find((r) => r.pn === 'busybox')!;
    await vscode.commands.executeCommand(
      'meta-lens.showOverlayChain',
      vscode.Uri.file(busybox.path),
    );
    await until(() => api.isChainOpen(), 'chain panel');
  });

  test('a new image in deploy/images shows up without a full rescan', async () => {
    const p = api.getProjects()[0]!;
    const dir = path.join(p.root, 'build', 'tmp', 'deploy', 'images', 'e2e-machine');
    const scansBefore = api.scanCount();
    await fs.mkdir(dir, { recursive: true });
    try {
      await fs.writeFile(path.join(dir, 'e2e-image-e2e-machine.rootfs.manifest'), 'busybox a 1\n');
      await until(
        () => api.getProjects()[0]!.builtImages.some((i) => i.name === 'e2e-image'),
        'new built image',
        20_000,
      );
      assert.equal(api.scanCount(), scansBefore, 'images-only refresh, no full rescan');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
    await until(
      () => !api.getProjects()[0]!.builtImages.some((i) => i.name === 'e2e-image'),
      'image removed',
      20_000,
    );
  });

  test('the overlay chain follows edits of its bbappends', async () => {
    const p = api.getProjects()[0]!;
    const busybox = p.recipes.find((r) => r.pn === 'busybox')!;
    await vscode.commands.executeCommand(
      'meta-lens.showOverlayChain',
      vscode.Uri.file(busybox.path),
    );
    await until(() => api.currentChain()?.recipe.pn === 'busybox', 'busybox chain');
    const append = busybox.appends[1]!; // meta-acme
    const original = await fs.readFile(append, 'utf8');
    const lines = () => api.currentChain()?.steps[2]?.lines.length ?? -1;
    assert.equal(lines(), 1);
    try {
      await fs.writeFile(append, original + 'DEPENDS += "zlib"\n');
      await until(() => lines() === 2, 'chain updated after edit', 20_000);
    } finally {
      await fs.writeFile(append, original);
    }
    await until(() => lines() === 1, 'chain back after restore', 20_000);
  });
});
