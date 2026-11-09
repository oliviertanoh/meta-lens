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

describe('isFilterActive', () => {
  it('ignores blank text', () => {
    expect(isFilterActive({})).toBe(false);
    expect(isFilterActive({ text: '  ' })).toBe(false);
    expect(isFilterActive({ text: 'a' })).toBe(true);
    expect(isFilterActive({ hasAppends: true })).toBe(true);
  });
});
