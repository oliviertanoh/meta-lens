import { describe, expect, it } from 'vitest';
import { appendMatches, matchAppends, wildcardIssue } from '../../src/core/appendMatch';
import type { RecipeFile } from '../../src/core/model';
import { parseRecipeName } from '../../src/core/recipes';

describe('appendMatches (BitBake semantics)', () => {
  it.each([
    // exact names
    ['busybox_1.36.1.bbappend', 'busybox_1.36.1.bb', true],
    ['busybox_1.36.1.bbappend', 'busybox_1.36.0.bb', false],
    ['busybox.bbappend', 'busybox.bb', true],
    ['busybox.bbappend', 'busybox_1.36.1.bb', false],
    // % wildcard right before .bbappend
    ['busybox_%.bbappend', 'busybox_1.36.1.bb', true],
    ['busybox_%.bbappend', 'busybox_git.bb', true],
    ['busybox_1.%.bbappend', 'busybox_1.36.1.bb', true],
    ['busybox_1.%.bbappend', 'busybox_2.0.bb', false],
    ['busybox_1.36.%.bbappend', 'busybox_1.36.1.bb', true],
    ['busybox_1.36.%.bbappend', 'busybox_1.35.0.bb', false],
    // % never makes the PN fuzzy when the name has a "_"
    ['busybox_%.bbappend', 'busybox-static_1.0.bb', false],
    ['busybox_%.bbappend', 'busybox.bb', false],
    ['linux-yocto_%.bbappend', 'linux-yocto-rt_6.6.bb', false],
    ['linux-yocto_6.%.bbappend', 'linux-yocto_6.6.bb', true],
    // BitBake quirk: a bare "foo%" also matches longer PNs
    ['linux-yocto%.bbappend', 'linux-yocto-rt_6.6.bb', true],
  ])('%s → %s = %s', (append, recipe, expected) => {
    expect(appendMatches(append, recipe)).toBe(expected);
  });
});

describe('wildcardIssue', () => {
  it('accepts % right before .bbappend', () => {
    expect(wildcardIssue('busybox_%.bbappend')).toBeUndefined();
    expect(wildcardIssue('busybox_1.%.bbappend')).toBeUndefined();
    expect(wildcardIssue('busybox_1.36.1.bbappend')).toBeUndefined();
  });

  it('flags % anywhere else', () => {
    expect(wildcardIssue('busybox_%.1.bbappend')).toContain('"busybox_"');
    expect(wildcardIssue('a%_%.bbappend')).toBeDefined();
  });
});

const file = (layer: string, rel: string): RecipeFile & { wildcard: boolean } => {
  const fileName = rel.split('/').pop() as string;
  return {
    ...parseRecipeName(fileName)!,
    path: `${layer}/${rel}`,
    layer,
    fileName,
    category: rel.split('/')[0] as string,
    wildcard: fileName.includes('%'),
  };
};

describe('matchAppends', () => {
  const ranks = new Map([
    ['/meta', { priority: 5, index: 0 }],
    ['/bsp', { priority: 10, index: 1 }],
    ['/oe', { priority: 6, index: 2 }],
    ['/app', { priority: 10, index: 3 }],
  ]);
  const recipes = [
    file('/meta', 'recipes-core/busybox/busybox_1.36.1.bb'),
    file('/meta', 'recipes-core/busybox/busybox_1.35.0.bb'),
    file('/meta', 'recipes-core/zlib/zlib_1.3.bb'),
  ];

  it('orders appends by priority, then BBLAYERS order, then path', () => {
    const appends = [
      file('/app', 'recipes-core/busybox/busybox_%.bbappend'),
      file('/bsp', 'recipes-core/busybox/busybox_%.bbappend'),
      file('/oe', 'recipes-core/busybox/busybox_1.36.1.bbappend'),
      file('/bsp', 'recipes-core/busybox/b/busybox_1.%.bbappend'),
    ];
    const r = matchAppends(recipes, appends, ranks);
    const bb136 = r.recipes.find((x) => x.fileName === 'busybox_1.36.1.bb');
    expect(bb136?.appends).toEqual([
      '/oe/recipes-core/busybox/busybox_1.36.1.bbappend',
      '/bsp/recipes-core/busybox/b/busybox_1.%.bbappend',
      '/bsp/recipes-core/busybox/busybox_%.bbappend',
      '/app/recipes-core/busybox/busybox_%.bbappend',
    ]);
    const bb135 = r.recipes.find((x) => x.fileName === 'busybox_1.35.0.bb');
    expect(bb135?.appends).toHaveLength(3);
    expect(r.recipes.find((x) => x.pn === 'zlib')?.appends).toEqual([]);

    // One wildcard append can apply to several recipe versions.
    const wild = r.appends.find((a) => a.path === '/bsp/recipes-core/busybox/busybox_%.bbappend');
    expect(wild?.recipes).toEqual([
      '/meta/recipes-core/busybox/busybox_1.36.1.bb',
      '/meta/recipes-core/busybox/busybox_1.35.0.bb',
    ]);
    expect(r.diagnostics.size).toBe(0);
  });

  it('reports orphans and misplaced wildcards on the append layer', () => {
    const r = matchAppends(
      recipes,
      [
        file('/app', 'recipes-graphics/psplash/psplash_1.2.bbappend'),
        file('/app', 'recipes-core/zlib/zlib_%.3.bbappend'),
      ],
      ranks,
    );
    // Same layer → path order: recipes-core before recipes-graphics.
    expect(r.appends.map((a) => [a.fileName, a.recipes.length])).toEqual([
      ['zlib_%.3.bbappend', 1],
      ['psplash_1.2.bbappend', 0],
    ]);
    expect(r.diagnostics.get('/app')?.map((d) => [d.file, d.message.split(':')[0]])).toEqual([
      [
        '/app/recipes-core/zlib/zlib_%.3.bbappend',
        expect.stringContaining('"%" is only supported'),
      ],
      ['/app/recipes-graphics/psplash/psplash_1.2.bbappend', 'Orphan bbappend'],
    ]);
  });
});
