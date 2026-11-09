import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { MetaLensApi } from '../../../src/extension';
import { AppendBadgeProvider, badgeText, recipeBadgeUri } from '../../../src/views/appendBadges';
import { projectRows } from '../../../src/views/projectView';

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
      'meta-lens.filterAppendsOff',
      'meta-lens.clearRecipeFilter',
    ]) {
      assert.ok(commands.includes(c), `${c} missing`);
    }
  });

  test('lists layers in BBLAYERS order', () => {
    const names = api.getProjects().flatMap((p) => p.layers.map((l) => l.name));
    assert.deepEqual(names, [
      'meta',
      'meta-poky',
      'meta-acme-bsp',
      'meta-oe',
      'meta-qt6',
      'meta-acme',
    ]);
  });

  test('indexes recipes and their bbappends', () => {
    const p = api.getProjects()[0];
    assert.ok(p);
    const busybox = p.recipes.find((r) => r.pn === 'busybox');
    assert.deepEqual(
      busybox?.appends.map((a) => path.basename(path.dirname(path.dirname(path.dirname(a))))),
      ['meta-acme-bsp', 'meta-acme'],
    );
  });

  test('filter commands run', async () => {
    await vscode.commands.executeCommand('meta-lens.filterAppends');
    await vscode.commands.executeCommand('meta-lens.filterAppendsOff');
    await vscode.commands.executeCommand('meta-lens.clearRecipeFilter');
  });

  test('+N badge', () => {
    const provider = new AppendBadgeProvider();
    const deco = provider.provideFileDecoration(recipeBadgeUri('/x/busybox_1.36.1.bb', 2));
    assert.equal(deco?.badge, '+2');
    assert.equal(provider.provideFileDecoration(recipeBadgeUri('/x/a.bb', 0)), undefined);
    assert.equal(provider.provideFileDecoration(vscode.Uri.file('/x/a.bb')), undefined);
    assert.deepEqual([1, 9, 10, 99, 250].map(badgeText), ['+1', '+9', '10', '99', '99']);
  });

  test('PROJECT rows', () => {
    const p = api.getProjects()[0];
    assert.ok(p);
    const rows = projectRows(p).map((n) => {
      assert.equal(n.kind, 'row');
      return n.kind === 'row' ? [n.item.label, n.item.description] : [];
    });
    assert.deepEqual(rows, [
      ['Config', path.join('build', 'conf', 'bblayers.conf')],
      ['Release', 'scarthgap (5.0 LTS)'],
      ['MACHINE', 'acme-rpi4'],
      ['DISTRO', 'acme-distro'],
      ['Mode', 'Static scan · no bitbake env'],
      [
        `BBLAYERS entry "/home/builder/bsp/sources/meta-openembedded/meta-oe" resolved to ${path.join('sources', 'meta-openembedded', 'meta-oe')} by guess.`,
        '',
      ],
    ]);
  });
});
