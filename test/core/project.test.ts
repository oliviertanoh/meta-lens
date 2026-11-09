import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Layer } from '../../src/core/model';
import { loadProject } from '../../src/core/project';
import { fixture } from './helpers';

const summary = (l: Layer) => ({
  name: l.name,
  priority: l.priority,
  recipes: l.recipeCount,
  warnings: l.diagnostics.filter((d) => d.severity !== 'info').length,
});

describe('loadProject', () => {
  it('poky-mini: layers from bblayers.conf in order', async () => {
    const p = await loadProject(fixture('poky-mini'));
    expect(p.source).toEqual({
      kind: 'bblayers',
      file: fixture('poky-mini', 'build', 'conf', 'bblayers.conf'),
    });
    expect(p.layers.map(summary)).toEqual([
      { name: 'meta', priority: 5, recipes: 2, warnings: 0 },
      { name: 'meta-poky', priority: 5, recipes: 0, warnings: 0 },
    ]);
    expect(p.layers[0]?.collections).toEqual(['core']);
    expect(p.layers[0]?.seriesCompat).toEqual(['scarthgap']);
    expect(p.diagnostics).toEqual([]);
  });

  it('bsp-custom: relocation, missing layer and missing LAYERDEPENDS', async () => {
    const p = await loadProject(fixture('bsp-custom'));
    expect(p.layers.map(summary)).toEqual([
      { name: 'meta', priority: 5, recipes: 2, warnings: 0 },
      { name: 'meta-poky', priority: 5, recipes: 0, warnings: 0 },
      { name: 'meta-acme-bsp', priority: 10, recipes: 0, warnings: 0 },
      { name: 'meta-oe', priority: 6, recipes: 1, warnings: 0 },
      { name: 'meta-qt6', priority: undefined, recipes: 0, warnings: 1 },
      { name: 'meta-acme', priority: 10, recipes: 2, warnings: 1 },
    ]);

    const oe = p.layers[3];
    expect(oe?.path).toBe(fixture('bsp-custom', 'sources', 'meta-openembedded', 'meta-oe'));
    expect(p.diagnostics.map((d) => d.message)).toEqual([
      `BBLAYERS entry "/home/builder/bsp/sources/meta-openembedded/meta-oe" resolved to ${path.join('sources', 'meta-openembedded', 'meta-oe')} by guess.`,
    ]);

    expect(p.layers[4]?.diagnostics[0]).toMatchObject({ severity: 'error' });
    const acme = p.layers[5]?.diagnostics[0];
    expect(acme?.message).toContain('"qt6-layer"');
    expect(acme?.file).toBe(fixture('bsp-custom', 'sources', 'meta-acme', 'conf', 'layer.conf'));
    expect(acme?.line).toBe(8);
  });

  it('kas-project: kas source, layers inferred from scan', async () => {
    const p = await loadProject(fixture('kas-project'));
    expect(p.source).toEqual({ kind: 'kas', file: fixture('kas-project', 'kas', 'project.yml') });
    expect(p.layers.map(summary)).toEqual([
      { name: 'meta-custom', priority: 8, recipes: 1, warnings: 1 }, // "core" not present
    ]);
    expect(p.diagnostics[0]?.severity).toBe('info');
  });

  it('picks the first of several bblayers.conf and says so', async () => {
    const p = await loadProject(fixture('multi-build'));
    expect(p.source.file).toBe(
      fixture('multi-build', 'builds', 'build-a', 'conf', 'bblayers.conf'),
    );
    expect(p.bblayersFiles).toHaveLength(2);
    expect(p.diagnostics.map((d) => d.message)).toEqual([
      `2 bblayers.conf files found; using ${path.join('builds', 'build-a', 'conf', 'bblayers.conf')}.`,
    ]);
    expect(p.layers.map((l) => [l.name, l.priority])).toEqual([['meta-x', 7]]);
  });

  it('falls back to a plain scan without any config file', async () => {
    const p = await loadProject(fixture('bsp-custom', 'sources'));
    expect(p.source).toEqual({ kind: 'scan' });
    expect(p.layers.map((l) => l.name)).toEqual([
      'meta-acme',
      'meta-acme-bsp',
      'meta-oe',
      'meta',
      'meta-poky',
    ]);
  });

  it('uses a forced bblayersFile without the "several files" note', async () => {
    const p = await loadProject(fixture('poky-mini'), {
      bblayersFile: fixture('poky-mini', 'build', 'conf', 'bblayers.conf'),
    });
    expect(p.diagnostics).toEqual([]); // no "several bblayers" note when forced
  });

  it('returns an empty project for a non-Yocto folder', async () => {
    const p = await loadProject(fixture('kas-project', 'meta-custom', 'recipes-apps'));
    expect(p.layers).toEqual([]);
    expect(p.source.kind).toBe('scan');
    expect(p.diagnostics).toEqual([]);
  });

  it('flags duplicate collection names', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'meta-lens-'));
    try {
      for (const name of ['meta-a', 'meta-b']) {
        await fs.mkdir(path.join(root, name, 'conf'), { recursive: true });
        await fs.writeFile(
          path.join(root, name, 'conf', 'layer.conf'),
          'BBFILE_COLLECTIONS += "dup"\nBBFILE_PRIORITY_dup = "1"\nLAYERSERIES_COMPAT_dup = "scarthgap"\n',
        );
      }
      const p = await loadProject(root);
      expect(p.layers.map((l) => l.diagnostics.map((d) => d.message))).toEqual([
        ['Collection "dup" is also declared by meta-b.'],
        ['Collection "dup" is also declared by meta-a.'],
      ]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
