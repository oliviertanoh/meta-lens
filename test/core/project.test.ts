import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Layer, Project } from '../../src/core/model';
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
      { name: 'meta', priority: 5, recipes: 4, warnings: 0 },
      { name: 'meta-poky', priority: 5, recipes: 0, warnings: 0 },
      { name: 'meta-acme-bsp', priority: 10, recipes: 0, warnings: 0 },
      // htop + acme-extra (BBFILES_DYNAMIC acme) + fb-demo (!qt6-layer); qt-demo is ignored.
      { name: 'meta-oe', priority: 6, recipes: 3, warnings: 0 },
      { name: 'meta-qt6', priority: undefined, recipes: 0, warnings: 1 },
      // missing qt6-layer dependency + orphan psplash bbappend
      { name: 'meta-acme', priority: 10, recipes: 3, warnings: 2 },
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

  describe('recipe index (bsp-custom)', () => {
    let p: Project;
    const src = (...parts: string[]) => fixture('bsp-custom', 'sources', ...parts);
    const recipe = (pn: string) => p.recipes.find((r) => r.pn === pn);

    it('loads', async () => {
      p = await loadProject(fixture('bsp-custom'));
    });

    it('lists recipes sorted by category then PN, with layer and version', () => {
      expect(p.recipes.map((r) => `${r.category}/${r.pn}@${r.pv}`)).toEqual([
        'recipes-acme/acme-app@1.0',
        'recipes-acme/acme-extra@1.0',
        'recipes-connectivity/openssh@9.6p1',
        'recipes-connectivity/openssh@9.6p1',
        'recipes-core/base-files@3.0.14',
        'recipes-core/busybox@1.36.1',
        'recipes-core/core-image-minimal@undefined',
        'recipes-graphics/fb-demo@1.0',
        'recipes-images/acme-image@undefined',
        'recipes-support/htop@3.3.0',
      ]);
      expect(recipe('busybox')?.layer).toBe(src('poky', 'meta'));
    });

    it('applies busybox appends in priority, then BBLAYERS order', () => {
      expect(recipe('busybox')?.appends).toEqual([
        src('meta-acme-bsp', 'recipes-core', 'busybox', 'busybox_%.bbappend'),
        src('meta-acme', 'recipes-core', 'busybox', 'busybox_%.bbappend'),
      ]);
    });

    it('enables dynamic-layers/<collection> for loaded collections only', () => {
      expect(recipe('htop')?.appends).toEqual([
        src(
          'meta-acme-bsp',
          'dynamic-layers',
          'openembedded-layer',
          'recipes-support',
          'htop',
          'htop_%.bbappend',
        ),
      ]);
      expect(p.recipes.some((r) => r.pn === 'qt-acme')).toBe(false);
      expect(p.layers.find((l) => l.name === 'meta-acme-bsp')?.appendCount).toBe(3);
    });

    it('matches the "3.%" wildcard', () => {
      expect(recipe('base-files')?.appends).toEqual([
        src('meta-acme-bsp', 'recipes-core', 'base-files', 'base-files_3.%.bbappend'),
      ]);
    });

    it('reports the orphan psplash bbappend on meta-acme', () => {
      const orphan = p.appends.find((a) => a.pn === 'psplash');
      expect(orphan?.recipes).toEqual([]);
      const acme = p.layers.find((l) => l.name === 'meta-acme');
      expect(acme?.diagnostics.map((d) => d.message)).toContain(
        'Orphan bbappend: no recipe matches psplash_1.2.bbappend.',
      );
      expect(acme?.appendCount).toBe(2);
    });

    it('ignores files outside BBFILES and says so', () => {
      expect(p.recipes.some((r) => r.pn === 'legacy-tool' || r.pn === 'qt-demo')).toBe(false);
      const acme = p.layers.find((l) => l.name === 'meta-acme');
      expect(acme?.diagnostics.find((d) => d.severity === 'info')?.message).toBe(
        `1 .bb/.bbappend file(s) not matched by BBFILES are ignored, e.g. ${path.join('scripts', 'legacy', 'legacy-tool_1.0.bb')}.`,
      );
    });

    it('flags image recipes', () => {
      expect(p.recipes.filter((r) => r.image).map((r) => r.pn)).toEqual([
        'core-image-minimal',
        'acme-image',
      ]);
    });

    it('indexes .inc files without parsing them', () => {
      expect(p.includes.map((i) => i.fileName)).toEqual(['busybox.inc']);
    });
  });

  describe('project config (MACHINE, DISTRO, release)', () => {
    it('bsp-custom: values from local.conf, definitions found in layers', async () => {
      const p = await loadProject(fixture('bsp-custom'));
      const local = fixture('bsp-custom', 'build', 'conf', 'local.conf');
      expect(p.config).toEqual({
        machine: {
          value: 'acme-rpi4',
          file: local,
          line: 3,
          definition: fixture(
            'bsp-custom',
            'sources',
            'meta-acme-bsp',
            'conf',
            'machine',
            'acme-rpi4.conf',
          ),
          definitionLayer: fixture('bsp-custom', 'sources', 'meta-acme-bsp'),
        },
        distro: {
          value: 'acme-distro',
          file: local,
          line: 2,
          definition: fixture(
            'bsp-custom',
            'sources',
            'meta-acme',
            'conf',
            'distro',
            'acme-distro.conf',
          ),
          definitionLayer: fixture('bsp-custom', 'sources', 'meta-acme'),
        },
        release: {
          names: ['scarthgap'],
          label: 'scarthgap (5.0 LTS)',
          layer: fixture('bsp-custom', 'sources', 'poky', 'meta'),
        },
      });
    });

    it('poky-mini: auto.conf overrides local.conf', async () => {
      const p = await loadProject(fixture('poky-mini'));
      expect(p.config.machine?.value).toBe('qemuarm64');
      expect(p.config.machine?.file).toBe(fixture('poky-mini', 'build', 'conf', 'auto.conf'));
      expect(p.config.distro?.definition).toBe(
        fixture('poky-mini', 'meta-poky', 'conf', 'distro', 'poky.conf'),
      );
    });

    it('kas-project: values from the kas file, missing definitions are warned', async () => {
      const p = await loadProject(fixture('kas-project'));
      const kas = fixture('kas-project', 'kas', 'project.yml');
      expect(p.config.machine).toEqual({ value: 'qemuarm64', file: kas, line: 4 });
      expect(p.config.release).toBeUndefined();
      expect(p.diagnostics.filter((d) => d.severity === 'warning').map((d) => d.message)).toEqual([
        'MACHINE "qemuarm64" is not provided by any loaded layer (no conf/machine/qemuarm64.conf).',
        'DISTRO "poky" is not provided by any loaded layer (no conf/distro/poky.conf).',
      ]);
    });

    it('scan source: no config', async () => {
      const p = await loadProject(fixture('bsp-custom', 'sources'));
      expect(p.config.machine).toBeUndefined();
      expect(p.config.release?.names).toEqual(['scarthgap']);
    });
  });
});
