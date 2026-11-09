import { beforeAll, describe, expect, it } from 'vitest';
import type { Project } from '../../src/core/model';
import { loadProject } from '../../src/core/project';
import { buildRecipeTree, isFilterActive } from '../../src/core/recipeTree';
import { fixture } from './helpers';

describe('buildRecipeTree (bsp-custom)', () => {
  let p: Project;
  beforeAll(async () => {
    p = await loadProject(fixture('bsp-custom'));
  });

  const shape = (t: ReturnType<typeof buildRecipeTree>) =>
    t.groups.map((g) => [g.category, g.recipes.map((r) => r.pn)]);

  it('groups every recipe by category, sorted', () => {
    const t = buildRecipeTree(p.recipes, p.appends);
    expect(shape(t)).toEqual([
      ['recipes-acme', ['acme-app', 'acme-extra']],
      ['recipes-connectivity', ['openssh', 'openssh']],
      ['recipes-core', ['base-files', 'busybox']],
      ['recipes-graphics', ['fb-demo']],
      ['recipes-support', ['htop']],
    ]);
    expect(t.total).toBe(8);
    expect(t.shown).toBe(8);
    expect(t.orphans.map((a) => a.fileName)).toEqual(['psplash_1.2.bbappend']);
  });

  it('"Has appends" keeps only extended recipes and drops empty groups', () => {
    const t = buildRecipeTree(p.recipes, p.appends, { hasAppends: true });
    expect(shape(t)).toEqual([
      ['recipes-core', ['base-files', 'busybox']],
      ['recipes-support', ['htop']],
    ]);
    expect(t.shown).toBe(3);
    expect(t.orphans).toHaveLength(1); // orphans stay visible: they are always relevant
  });

  it('text filter is case-insensitive and also filters orphans', () => {
    const t = buildRecipeTree(p.recipes, p.appends, { text: '  BUSY ' });
    expect(shape(t)).toEqual([['recipes-core', ['busybox']]]);
    expect(t.orphans).toEqual([]);
    expect(buildRecipeTree(p.recipes, p.appends, { text: 'splash' }).orphans).toHaveLength(1);
  });

  it('combines both filters', () => {
    const t = buildRecipeTree(p.recipes, p.appends, { text: 'ssh', hasAppends: true });
    expect(t.groups).toEqual([]);
    expect(t.shown).toBe(0);
  });
});

describe('buildRecipeTree projectOnly (bsp-custom)', () => {
  let p: Project;
  let projectLayers: Set<string>;
  beforeAll(async () => {
    p = await loadProject(fixture('bsp-custom'));
    projectLayers = new Set(p.layers.filter((l) => l.origin.kind === 'project').map((l) => l.path));
  });

  const names = (t: ReturnType<typeof buildRecipeTree>) =>
    t.groups.flatMap((g) => g.recipes.map((r) => `${r.pn}@${r.layer.split('/').pop()}`));

  it('keeps recipes created or extended by project layers', () => {
    const t = buildRecipeTree(p.recipes, p.appends, { projectOnly: true }, projectLayers);
    expect(names(t)).toEqual([
      'acme-app@meta-acme', // created
      'openssh@meta-acme', // created (overlays meta's openssh)
      'base-files@meta', // extended by meta-acme-bsp
      'busybox@meta', // extended by meta-acme-bsp and meta-acme
      'htop@meta-oe', // extended by meta-acme-bsp (dynamic layer)
    ]);
    expect(t.shown).toBe(5);
    expect(t.total).toBe(8);
    expect(t.noProjectLayer).toBe(false);
    expect(t.orphans.map((a) => a.fileName)).toEqual(['psplash_1.2.bbappend']);
  });

  it('acme-extra lives in an upstream layer (meta-oe dynamic layer): not shown', () => {
    const t = buildRecipeTree(p.recipes, p.appends, { projectOnly: true }, projectLayers);
    expect(names(t).some((n) => n.startsWith('acme-extra'))).toBe(false);
  });

  it('combines with the other filters', () => {
    const t = buildRecipeTree(
      p.recipes,
      p.appends,
      { projectOnly: true, hasAppends: true, text: 'busy' },
      projectLayers,
    );
    expect(names(t)).toEqual(['busybox@meta']);
  });

  it('falls back to every recipe when there is no project layer', () => {
    const t = buildRecipeTree(p.recipes, p.appends, { projectOnly: true }, new Set());
    expect(t.shown).toBe(8);
    expect(t.noProjectLayer).toBe(true);
  });

  it('is not counted as an active filter', () => {
    expect(isFilterActive({ projectOnly: true })).toBe(false);
  });
});

describe('isFilterActive', () => {
  it('ignores blank text', () => {
    expect(isFilterActive({})).toBe(false);
    expect(isFilterActive({ text: '  ' })).toBe(false);
    expect(isFilterActive({ text: 'a' })).toBe(true);
    expect(isFilterActive({ hasAppends: true })).toBe(true);
  });
});
