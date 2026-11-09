import * as fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDepends, parseLayerConf } from '../../src/core/layerConf';
import { fixture } from './helpers';

const load = (...p: string[]) => {
  const file = fixture(...p, 'conf', 'layer.conf');
  return parseLayerConf(fs.readFileSync(file, 'utf8'), file);
};

describe('parseLayerConf', () => {
  it('reads collection, priority, compat and BBFILES with ${LAYERDIR}', () => {
    const r = load('poky-mini', 'meta');
    expect(r.layerDir).toBe(fixture('poky-mini', 'meta'));
    expect(r.collections).toEqual([
      { name: 'core', priority: 5, depends: [], seriesCompat: ['scarthgap'] },
    ]);
    expect(r.bbfiles).toEqual([
      `${fixture('poky-mini', 'meta')}/recipes-*/*/*.bb`,
      `${fixture('poky-mini', 'meta')}/recipes-*/*/*.bbappend`,
    ]);
    expect(r.diagnostics).toEqual([]);
  });

  it('handles hyphenated collection names', () => {
    const r = load('bsp-custom', 'sources', 'meta-openembedded', 'meta-oe');
    expect(r.collections[0]).toMatchObject({
      name: 'openembedded-layer',
      priority: 6,
      depends: [{ collection: 'core' }],
    });
  });

  it('reads versioned LAYERDEPENDS and its line', () => {
    const r = load('bsp-custom', 'sources', 'meta-acme');
    expect(r.collections[0]?.depends).toEqual([
      { collection: 'core' },
      { collection: 'acme-bsp' },
      { collection: 'openembedded-layer', version: '1' },
      { collection: 'qt6-layer' },
    ]);
    expect(r.collections[0]?.dependsLine).toBe(8);
  });

  it('reports missing collection, priority and compat', () => {
    const r = parseLayerConf('BBPATH .= ":${LAYERDIR}"', '/l/conf/layer.conf');
    expect(r.collections).toEqual([]);
    expect(r.diagnostics.map((d) => d.severity)).toEqual(['warning']);

    const r2 = parseLayerConf('BBFILE_COLLECTIONS += "x"', '/l/conf/layer.conf');
    expect(r2.collections[0]?.priority).toBeUndefined();
    expect(r2.diagnostics.map((d) => d.message)).toEqual([
      'BBFILE_PRIORITY_x is not set.',
      'LAYERSERIES_COMPAT_x is not set.',
    ]);
  });

  it('flags a non-numeric priority', () => {
    const r = parseLayerConf(
      'BBFILE_COLLECTIONS += "x"\nBBFILE_PRIORITY_x = "${@foo()}"\nLAYERSERIES_COMPAT_x = "scarthgap"',
      '/l/conf/layer.conf',
    );
    expect(r.collections[0]?.priority).toBeUndefined();
    expect(r.diagnostics[0]).toMatchObject({ severity: 'warning', line: 2 });
  });

  it('supports several collections in one layer', () => {
    const r = parseLayerConf(
      'BBFILE_COLLECTIONS += "a"\nBBFILE_COLLECTIONS += "b"\nBBFILE_PRIORITY_a = "1"\nBBFILE_PRIORITY_b = "2"',
      '/l/conf/layer.conf',
    );
    expect(r.collections.map((c) => [c.name, c.priority])).toEqual([
      ['a', 1],
      ['b', 2],
    ]);
  });
});

describe('parseDepends', () => {
  it('parses plain, colon-versioned and parenthesized constraints', () => {
    expect(parseDepends('core  meta-python:3 networking-layer (>= 2)')).toEqual([
      { collection: 'core' },
      { collection: 'meta-python', version: '3' },
      { collection: 'networking-layer', version: '>= 2' },
    ]);
  });
});
