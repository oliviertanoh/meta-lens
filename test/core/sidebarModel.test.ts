import * as path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Project } from '../../src/core/model';
import { loadProject } from '../../src/core/project';
import { buildSidebarModel, type SidebarModel } from '../../src/core/sidebarModel';
import { fixture } from './helpers';

describe('buildSidebarModel (bsp-custom)', () => {
  let p: Project;
  let m: SidebarModel;
  const root = fixture('bsp-custom');
  const rel = (f: string) => path.relative(root, f);

  beforeAll(async () => {
    p = await loadProject(root);
    m = buildSidebarModel([p], rel);
  });

  it('project rows: config, local.conf, release, MACHINE, DISTRO', () => {
    expect(m.projects).toHaveLength(1);
    expect(m.projects[0]?.rows.map((r) => [r.key, r.value, r.tone ?? '', !!r.warning])).toEqual([
      ['Config', path.join('build', 'conf', 'bblayers.conf'), 'orange', false],
      ['Local conf', path.join('build', 'conf', 'local.conf'), 'orange', false],
      ['Release', 'scarthgap (5.0 LTS)', '', false],
      ['MACHINE', 'acme-rpi4', 'blue', false],
      ['DISTRO', 'acme-distro', 'blue', false],
    ]);
  });

  it('MACHINE opens its definition and explains where it is set', () => {
    const machine = m.projects[0]?.rows.find((r) => r.key === 'MACHINE');
    expect(machine?.open).toEqual({
      file: fixture('bsp-custom', 'sources', 'meta-acme-bsp', 'conf', 'machine', 'acme-rpi4.conf'),
    });
    expect(machine?.title).toBe(
      `Set in ${path.join('build', 'conf', 'local.conf')}:3.\nDefined in ${path.join('sources', 'meta-acme-bsp', 'conf', 'machine', 'acme-rpi4.conf')}.`,
    );
  });

  it('layers carry priority, counts, origin and severity', () => {
    expect(
      m.layers.map((l) => [l.name, l.priority, l.recipeCount, l.origin.kind, l.severity]),
    ).toEqual([
      ['meta', 5, 4, 'upstream', undefined],
      ['meta-poky', 5, 0, 'upstream', undefined],
      ['meta-acme-bsp', 10, 0, 'project', undefined],
      ['meta-oe', 6, 3, 'upstream', undefined],
      ['meta-qt6', undefined, 0, 'project', 'error'],
      ['meta-acme', 10, 3, 'project', 'warning'],
    ]);
    expect(m.layers[5]?.title).toContain(
      '⚠ Orphan bbappend: no recipe matches psplash_1.2.bbappend.',
    );
  });

  it('recipes, appends, layer names and project layers for the webview', () => {
    expect(m.recipes).toHaveLength(10);
    expect(m.appends).toHaveLength(5);
    expect(m.layerNames[fixture('bsp-custom', 'sources', 'poky', 'meta')]).toBe('meta');
    expect(m.projectLayers.map((l) => path.basename(l))).toEqual([
      'meta-acme-bsp',
      'meta-qt6',
      'meta-acme',
    ]);
  });

  it('is JSON-serializable (sent with postMessage)', () => {
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
  });

  it('contains no em dash', () => {
    expect(JSON.stringify(m)).not.toContain('—');
  });

  it('skips folders without layers', () => {
    expect(buildSidebarModel([], rel).projects).toEqual([]);
  });
});
