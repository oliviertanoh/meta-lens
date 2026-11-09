import { describe, expect, it } from 'vitest';
import type { Recipe } from '../../src/core/model';
import { compareVersions, markOverlays } from '../../src/core/overlay';
import { loadProject } from '../../src/core/project';
import { fixture } from './helpers';

describe('compareVersions', () => {
  it.each([
    ['1.36.1', '1.36.0', 1],
    ['1.10', '1.9', 1],
    ['9.6p1', '9.6', 1],
    ['1.0rc1', '1.0', 1], // like BitBake: no special case for rc (no ~ handling)
    ['git', '1.0', -1],
    ['2.0', '2.0', 0],
  ])('%s vs %s', (a, b, sign) => {
    expect(Math.sign(compareVersions(a, b))).toBe(sign);
  });
});

const recipe = (layer: string, pn: string, pv: string): Recipe => ({
  pn,
  pv,
  path: `${layer}/${pn}_${pv}.bb`,
  layer,
  fileName: `${pn}_${pv}.bb`,
  category: 'recipes-x',
  appends: [],
});

describe('markOverlays', () => {
  const ranks = new Map([
    ['/meta', { priority: 5, index: 0 }],
    ['/oe', { priority: 6, index: 1 }],
    ['/a', { priority: 10, index: 2 }],
    ['/b', { priority: 10, index: 3 }],
  ]);

  it('higher priority wins even with a lower version', () => {
    const list = [recipe('/meta', 'ssh', '9.6'), recipe('/a', 'ssh', '8.0')];
    markOverlays(list, ranks);
    expect(list[0]?.overlay).toEqual({
      winner: '/a/ssh_8.0.bb',
      candidates: ['/a/ssh_8.0.bb', '/meta/ssh_9.6.bb'],
    });
    expect(list[1]?.overlay?.winner).toBe('/a/ssh_8.0.bb');
  });

  it('same priority: higher version, then BBLAYERS order', () => {
    const v = [recipe('/a', 'x', '1.0'), recipe('/b', 'x', '2.0')];
    markOverlays(v, ranks);
    expect(v[0]?.overlay?.winner).toBe('/b/x_2.0.bb');
    const o = [recipe('/b', 'y', '1.0'), recipe('/a', 'y', '1.0')];
    markOverlays(o, ranks);
    expect(o[0]?.overlay?.winner).toBe('/a/y_1.0.bb');
  });

  it('several versions in a single layer are not an overlay', () => {
    const list = [recipe('/meta', 'linux', '6.1'), recipe('/meta', 'linux', '6.6')];
    markOverlays(list, ranks);
    expect(list.every((r) => r.overlay === undefined)).toBe(true);
  });
});

describe('overlays in bsp-custom', () => {
  it('meta-acme openssh overlays meta openssh', async () => {
    const p = await loadProject(fixture('bsp-custom'));
    const ssh = p.recipes.filter((r) => r.pn === 'openssh');
    const winner = fixture(
      'bsp-custom',
      'sources',
      'meta-acme',
      'recipes-connectivity',
      'openssh',
      'openssh_9.6p1.bb',
    );
    expect(ssh.map((r) => r.overlay?.winner)).toEqual([winner, winner]);
    expect(p.recipes.filter((r) => r.overlay).map((r) => r.pn)).toEqual(['openssh', 'openssh']);
  });
});
