import * as assert from 'node:assert/strict';
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
  });

  test('registers its commands', async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const c of [
      'meta-lens.refresh',
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
    await vscode.commands.executeCommand('workbench.view.extension.metaLens');
    await Promise.race([
      api.sidebarReady(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('webview not ready')), 15_000)),
    ]);
    // The webview reports its initial filter: project recipes only.
    await until(() => api.getRecipeFilter().projectOnly === true, 'initial filter');

    // Command → webview → back to the extension.
    await vscode.commands.executeCommand('meta-lens.filterAppends');
    await until(() => api.getRecipeFilter().hasAppends === true, 'hasAppends on');
    await vscode.commands.executeCommand('meta-lens.filterAppends');
    await until(() => api.getRecipeFilter().hasAppends === false, 'hasAppends off');

    await vscode.commands.executeCommand('meta-lens.showAllRecipes');
    await until(() => api.getRecipeFilter().projectOnly === false, 'show all');
    await vscode.commands.executeCommand('meta-lens.showProjectRecipes');
    await until(() => api.getRecipeFilter().projectOnly === true, 'project only');
  });
});
