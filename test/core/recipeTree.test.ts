import { beforeAll, describe, expect, it } from 'vitest';
import type { Project } from '../../src/core/model';
import { loadProject } from '../../src/core/project';
import { buildRecipeTree, scopeOf } from '../../src/core/recipeTree';
import { fixture } from './helpers';

let p: Project;
let projectLayers: Set<string>;
beforeAll(async () => {
  p = await loadProject(fixture('bsp-custom'));
  projectLayers = new Set(p.layers.filter((l) => l.origin.kind === 'project').map((l) => l.path));
});

const shape = (t: ReturnType<typeof buildRecipeTree>) =>
  t.groups.map((g) => [g.category, g.recipes.map((r) => r.pn)]);
const pns = (t: ReturnType<typeof buildRecipeTree>) =>
  t.groups.flatMap((g) => g.recipes.map((r) => `${r.pn}@${r.layer.split('/').pop()}`));
const tree = (filter: Parameters<typeof buildRecipeTree>[2], layers = projectLayers) =>
  buildRecipeTree(p.recipes, p.appends, filter, layers);

describe('scope and kind (bsp-custom)', () => {
  it('defaults to the project scope', () => {
    expect(scopeOf({})).toBe('project');
  });

  it('all: every recipe grouped by category', () => {
    const t = tree({ scope: 'all' });
    expect(shape(t)).toEqual([
      ['recipes-acme', ['acme-app', 'acme-extra']],
      ['recipes-connectivity', ['openssh', 'openssh']],
      ['recipes-core', ['base-files', 'busybox', 'core-image-minimal']],
      ['recipes-graphics', ['fb-demo']],
      ['recipes-images', ['acme-image']],
      ['recipes-support', ['htop']],
    ]);
    expect([t.shown, t.total]).toEqual([10, 10]);
    expect(t.orphans.map((a) => a.fileName)).toEqual(['psplash_1.2.bbappend']);
  });

  it('project: created or extended by project layers', () => {
    expect(pns(tree({}))).toEqual([
      'acme-app@meta-acme',
      'openssh@meta-acme',
      'base-files@meta',
      'busybox@meta',
      'acme-image@meta-acme',
      'htop@meta-oe',
    ]);
  });

  it('project without project layer falls back to everything', () => {
    const t = tree({}, new Set());
    expect(t.shown).toBe(10);
    expect(t.noProjectLayer).toBe(true);
  });

  it('kind combines with the scope: "my overlays"', () => {
    expect(pns(tree({ kind: 'overlayed' }))).toEqual(['openssh@meta-acme']);
    expect(pns(tree({ scope: 'all', kind: 'overlayed' }))).toEqual([
      'openssh@meta-acme',
      'openssh@meta',
    ]);
    expect(pns(tree({ kind: 'appends' }))).toEqual([
      'base-files@meta',
      'busybox@meta',
      'htop@meta-oe',
    ]);
  });

  it('no orphans in the overlayed view', () => {
    expect(tree({ kind: 'appends' }).orphans).toHaveLength(1);
    expect(tree({ kind: 'overlayed' }).orphans).toHaveLength(0);
  });
});

describe('text filter', () => {
  it('is case-insensitive and also filters orphans', () => {
    const t = tree({ scope: 'all', text: '  BUSY ' });
    expect(shape(t)).toEqual([['recipes-core', ['busybox']]]);
    expect(t.orphans).toEqual([]);
    expect(tree({ scope: 'all', text: 'splash' }).orphans).toHaveLength(1);
  });
});

describe('layer filter (click on a layer)', () => {
  const layer = (name: string) => p.layers.find((l) => l.name === name)!.path;

  it('meta-acme-bsp: the recipes it extends (it creates none)', () => {
    expect(pns(tree({ layer: layer('meta-acme-bsp') }))).toEqual([
      'base-files@meta',
      'busybox@meta',
      'htop@meta-oe',
    ]);
  });

  it('meta-acme: its recipes, what it extends, and its orphan', () => {
    const t = tree({ layer: layer('meta-acme') });
    expect(pns(t)).toEqual([
      'acme-app@meta-acme',
      'openssh@meta-acme',
      'busybox@meta',
      'acme-image@meta-acme',
    ]);
    expect(t.orphans.map((a) => a.fileName)).toEqual(['psplash_1.2.bbappend']);
  });

  it('an upstream layer works too', () => {
    expect(tree({ layer: layer('meta') }).shown).toBe(4);
  });
});
