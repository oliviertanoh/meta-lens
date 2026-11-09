import { describe, expect, it } from 'vitest';
import {
  BbfilesMatcher,
  categoryOf,
  effectiveBbfiles,
  globToRegExp,
  indexLayerFiles,
  parseRecipeName,
  scanLayerFiles,
} from '../../src/core/recipes';
import { fixture } from './helpers';

describe('parseRecipeName', () => {
  it.each([
    ['busybox_1.36.1.bb', { pn: 'busybox', pv: '1.36.1' }],
    ['base-files_3.0.14.bb', { pn: 'base-files', pv: '3.0.14' }],
    ['packagegroup-core-boot.bb', { pn: 'packagegroup-core-boot' }],
    ['linux-yocto_git.bb', { pn: 'linux-yocto', pv: 'git' }],
    ['foo_1.0_r2.bb', { pn: 'foo', pv: '1.0', pr: 'r2' }],
    ['busybox_%.bbappend', { pn: 'busybox', pv: '%' }],
    ['busybox.bbappend', { pn: 'busybox' }],
  ])('%s', (file, expected) => {
    expect(parseRecipeName(file)).toEqual(expected);
  });

  it('rejects names with more than two underscores, like BitBake', () => {
    expect(parseRecipeName('a_b_c_d.bb')).toBeUndefined();
  });
});

describe('categoryOf', () => {
  it('returns the recipes-* folder, even below dynamic-layers', () => {
    expect(categoryOf('recipes-core/busybox/busybox_1.36.1.bb')).toBe('recipes-core');
    expect(categoryOf('dynamic-layers/acme/recipes-acme/x/x_1.bb')).toBe('recipes-acme');
    expect(categoryOf('images/my-image.bb')).toBe('images');
    expect(categoryOf('top.bb')).toBe('');
  });
});

describe('globToRegExp (Python glob semantics)', () => {
  it('does not let * or ? cross a /', () => {
    const re = globToRegExp('/l/recipes-*/*/*.bb');
    expect(re.test('/l/recipes-core/busybox/busybox_1.0.bb')).toBe(true);
    expect(re.test('/l/recipes-core/busybox/sub/busybox_1.0.bb')).toBe(false);
    expect(re.test('/l/recipes-core/busybox_1.0.bb')).toBe(false);
    expect(globToRegExp('/l/?.bb').test('/l/ab.bb')).toBe(false);
  });

  it('supports [abc] and [!abc] classes and escapes regex characters', () => {
    expect(globToRegExp('/l/[ab].bb').test('/l/a.bb')).toBe(true);
    expect(globToRegExp('/l/[!ab].bb').test('/l/a.bb')).toBe(false);
    expect(globToRegExp('/l/[!ab].bb').test('/l/c.bb')).toBe(true);
    expect(globToRegExp('/l/c++/*.bb').test('/l/c++/x.bb')).toBe(true);
    expect(globToRegExp('/l/x.bb').test('/l/xxbb')).toBe(false);
  });

  it('normalizes Windows separators', () => {
    expect(globToRegExp('C:\\l\\*.bb').test('C:/l/x.bb')).toBe(true);
    expect(new BbfilesMatcher(['C:\\l\\*\\*.bb']).matches('C:\\l\\a\\x.bb')).toBe(true);
  });
});

describe('BbfilesMatcher', () => {
  it('treats a plain directory entry as "everything below"', () => {
    const m = new BbfilesMatcher(['/l/recipes']);
    expect(m.matches('/l/recipes/a/b/c.bb')).toBe(true);
    expect(m.matches('/l/recipes-x/a.bb')).toBe(false);
  });
});

describe('effectiveBbfiles', () => {
  it('adds BBFILES_DYNAMIC entries according to loaded collections', () => {
    const layers = [
      {
        bbfiles: ['/a/*.bb'],
        bbfilesDynamic: [
          { collection: 'x', negate: false, pattern: '/a/dyn-x/*.bb' },
          { collection: 'y', negate: false, pattern: '/a/dyn-y/*.bb' },
          { collection: 'y', negate: true, pattern: '/a/no-y/*.bb' },
          { collection: 'x', negate: true, pattern: '/a/no-x/*.bb' },
        ],
        bbfilesPerCollection: [],
      },
    ];
    expect(effectiveBbfiles(layers, new Set(['x']))).toEqual([
      '/a/*.bb',
      '/a/dyn-x/*.bb',
      '/a/no-y/*.bb',
    ]);
  });
});

describe('effectiveBbfiles per-collection templates', () => {
  it('repeats a %s template for every loaded collection', () => {
    const layers = [
      { bbfiles: [], bbfilesDynamic: [], bbfilesPerCollection: ['/r/dynamic-layers/%s/*.bb'] },
    ];
    expect(effectiveBbfiles(layers, new Set(['core', 'meta-python']))).toEqual([
      '/r/dynamic-layers/core/*.bb',
      '/r/dynamic-layers/meta-python/*.bb',
    ]);
  });
});

describe('scanLayerFiles', () => {
  it('lists .bb, .bbappend and .inc files, sorted, skipping nested layers', async () => {
    const meta = fixture('poky-mini', 'meta');
    const files = await scanLayerFiles(meta);
    expect(files).toEqual({
      bb: [
        fixture('poky-mini', 'meta', 'recipes-core', 'base-files', 'base-files_3.0.14.bb'),
        fixture('poky-mini', 'meta', 'recipes-core', 'busybox', 'busybox_1.36.1.bb'),
      ],
      bbappend: [],
      inc: [fixture('poky-mini', 'meta', 'recipes-core', 'busybox', 'busybox.inc')],
    });
  });
});

describe('indexLayerFiles', () => {
  it('keeps BBFILES matches only and reports ignored and badly named files', () => {
    const matcher = new BbfilesMatcher(['/l/recipes-*/*/*.bb', '/l/recipes-*/*/*.bbappend']);
    const r = indexLayerFiles(
      '/l',
      {
        bb: ['/l/recipes-a/foo/foo_1.0.bb', '/l/recipes-a/bar/a_b_c_d.bb', '/l/old/x/y/z_1.bb'],
        bbappend: ['/l/recipes-a/foo/foo_%.bbappend', '/l/elsewhere/foo_%.bbappend'],
        inc: ['/l/recipes-a/foo/foo.inc'],
      },
      matcher,
    );
    expect(r.recipes).toEqual([
      {
        pn: 'foo',
        pv: '1.0',
        path: '/l/recipes-a/foo/foo_1.0.bb',
        layer: '/l',
        fileName: 'foo_1.0.bb',
        category: 'recipes-a',
      },
    ]);
    expect(r.appends.map((a) => [a.fileName, a.wildcard])).toEqual([['foo_%.bbappend', true]]);
    expect(r.includes.map((i) => i.fileName)).toEqual(['foo.inc']);
    expect(r.ignored).toEqual(['/l/old/x/y/z_1.bb', '/l/elsewhere/foo_%.bbappend']);
    expect(r.badNames).toEqual(['/l/recipes-a/bar/a_b_c_d.bb']);
  });
});
