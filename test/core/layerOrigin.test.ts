import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gitRootOf } from '../../src/core/layerOrigin';
import { loadProject } from '../../src/core/project';
import { fixture } from './helpers';

const origins = async (root: string, projectLayers?: string[]) =>
  (await loadProject(root, { projectLayers })).layers.map((l) => [l.name, l.origin.kind]);

describe('layer origin (bsp-custom, no nested git)', () => {
  it('well-known collections are upstream, the rest is project', async () => {
    expect(await origins(fixture('bsp-custom'))).toEqual([
      ['meta', 'upstream'],
      ['meta-poky', 'upstream'],
      ['meta-acme-bsp', 'project'],
      ['meta-oe', 'upstream'],
      ['meta-qt6', 'project'], // missing layer: unknown collection, same repo
      ['meta-acme', 'project'],
    ]);
  });

  it('metaLens.projectLayers overrides every other rule', async () => {
    expect(await origins(fixture('bsp-custom'), ['meta-oe', 'meta-acme'])).toEqual([
      ['meta', 'upstream'],
      ['meta-poky', 'upstream'],
      ['meta-acme-bsp', 'upstream'],
      ['meta-oe', 'project'],
      ['meta-qt6', 'upstream'],
      ['meta-acme', 'project'],
    ]);
  });

  it('explains the decision', async () => {
    const p = await loadProject(fixture('bsp-custom'));
    expect(p.layers[0]?.origin.reason).toBe('well-known collection "core"');
    expect(p.layers[2]?.origin.reason).toBe('part of this repository');
  });
});

describe('layer origin with nested git checkouts', () => {
  let root: string;

  const layer = async (rel: string, collection: string) => {
    const dir = path.join(root, rel);
    await fs.mkdir(path.join(dir, 'conf'), { recursive: true });
    await fs.writeFile(
      path.join(dir, 'conf', 'layer.conf'),
      `BBFILE_COLLECTIONS += "${collection}"\nBBFILE_PRIORITY_${collection} = "6"\nLAYERSERIES_COMPAT_${collection} = "scarthgap"\n`,
    );
  };

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'meta-lens-git-'));
    await fs.mkdir(path.join(root, '.git'));
    // Vendored BSP from a vendor, unknown collection name, cloned with its own .git.
    await layer('layers/meta-vendor/meta-vendor-bsp', 'vendor-bsp');
    await fs.mkdir(path.join(root, 'layers', 'meta-vendor', '.git'));
    // Submodule: `.git` is a file.
    await layer('layers/meta-sub', 'sub');
    await fs.writeFile(
      path.join(root, 'layers', 'meta-sub', '.git'),
      'gitdir: ../../.git/modules/x\n',
    );
    // Own layer, tracked by the workspace repo.
    await layer('meta-mine', 'mine');
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('finds the nearest git root', async () => {
    expect(await gitRootOf(path.join(root, 'layers', 'meta-vendor', 'meta-vendor-bsp'))).toBe(
      path.join(root, 'layers', 'meta-vendor'),
    );
    expect(await gitRootOf(path.join(root, 'meta-mine'))).toBe(root);
  });

  it('layers in a nested checkout or submodule are upstream', async () => {
    const p = await loadProject(root);
    expect(p.layers.map((l) => [l.name, l.origin.kind, l.origin.reason])).toEqual([
      ['meta-sub', 'upstream', `separate git checkout ${path.join('layers', 'meta-sub')}`],
      [
        'meta-vendor-bsp',
        'upstream',
        `separate git checkout ${path.join('layers', 'meta-vendor')}`,
      ],
      ['meta-mine', 'project', 'part of this repository'],
    ]);
  });

  it('without a workspace git repo, only the well-known list applies', async () => {
    await fs.rm(path.join(root, '.git'), { recursive: true });
    try {
      // The temp dir is outside any git repo, so nested checkouts are not a signal anymore.
      const p = await loadProject(root);
      expect(p.layers.map((l) => l.origin.kind)).toEqual(['project', 'project', 'project']);
    } finally {
      await fs.mkdir(path.join(root, '.git'));
    }
  });
});
