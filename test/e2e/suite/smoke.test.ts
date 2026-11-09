import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { MetaLensApi } from '../../../src/extension';

suite('meta-lens smoke test', () => {
  test('activates on a Yocto workspace and lists its layers', async () => {
    const ext = vscode.extensions.getExtension<MetaLensApi>('oliviertanoh.meta-lens');
    assert.ok(ext, 'extension not found');
    const api = await ext.activate();
    assert.equal(ext.isActive, true);

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('meta-lens.refresh'));

    await api.refresh();
    const names = api.getProjects().flatMap((p) => p.layers.map((l) => l.name));
    assert.deepEqual(names, ['meta', 'meta-poky']);
  });
});
