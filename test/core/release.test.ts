import { describe, expect, it } from 'vitest';
import type { Layer } from '../../src/core/model';
import { detectRelease, releaseLabel } from '../../src/core/release';

const layer = (name: string, collections: string[], seriesCompat: string[]): Layer => ({
  name,
  path: `/${name}`,
  collections,
  depends: [],
  seriesCompat,
  bbfiles: [],
  bbfilesDynamic: [],
  bbfilesPerCollection: [],
  origin: { kind: 'upstream', reason: '' },
  recipeCount: 0,
  appendCount: 0,
  diagnostics: [],
});

describe('releaseLabel', () => {
  it('adds version and LTS flag for known codenames', () => {
    expect(releaseLabel('scarthgap')).toBe('scarthgap (5.0 LTS)');
    expect(releaseLabel('styhead')).toBe('styhead (5.1)');
    expect(releaseLabel('kirkstone')).toBe('kirkstone (4.0 LTS)');
    expect(releaseLabel('future-name')).toBe('future-name');
  });
});

describe('detectRelease', () => {
  it('reads LAYERSERIES_COMPAT of the "core" collection only', () => {
    const r = detectRelease([
      layer('meta-bsp', ['bsp'], ['kirkstone']),
      layer('meta', ['core'], ['scarthgap']),
    ]);
    expect(r).toEqual({ names: ['scarthgap'], label: 'scarthgap (5.0 LTS)', layer: '/meta' });
  });

  it('joins several codenames', () => {
    expect(detectRelease([layer('meta', ['core'], ['styhead', 'walnascar'])])?.label).toBe(
      'styhead (5.1) / walnascar (5.2)',
    );
  });

  it('is undefined without a core layer or compat', () => {
    expect(detectRelease([layer('meta-x', ['x'], ['scarthgap'])])).toBeUndefined();
    expect(detectRelease([layer('meta', ['core'], [])])).toBeUndefined();
  });
});
