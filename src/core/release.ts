// Yocto release detection from LAYERSERIES_COMPAT of the core layer (collection "core").

import type { Layer, Release } from './model';

/** Codename → version. LTS releases are flagged. */
export const YOCTO_RELEASES: Readonly<Record<string, { version: string; lts?: boolean }>> = {
  rocko: { version: '2.4' },
  sumo: { version: '2.5' },
  thud: { version: '2.6' },
  warrior: { version: '2.7' },
  zeus: { version: '3.0' },
  dunfell: { version: '3.1', lts: true },
  gatesgarth: { version: '3.2' },
  hardknott: { version: '3.3' },
  honister: { version: '3.4' },
  kirkstone: { version: '4.0', lts: true },
  langdale: { version: '4.1' },
  mickledore: { version: '4.2' },
  nanbield: { version: '4.3' },
  scarthgap: { version: '5.0', lts: true },
  styhead: { version: '5.1' },
  walnascar: { version: '5.2' },
  whinlatter: { version: '5.3' },
  wrynose: { version: '6.0', lts: true },
};

export function releaseLabel(name: string): string {
  const r = YOCTO_RELEASES[name];
  if (!r) return name;
  return `${name} (${r.version}${r.lts ? ' LTS' : ''})`;
}

/** Release of the project = LAYERSERIES_COMPAT of the layer providing the "core" collection. */
export function detectRelease(layers: readonly Layer[]): Release | undefined {
  const core = layers.find((l) => l.collections.includes('core'));
  if (!core || core.seriesCompat.length === 0) return undefined;
  return {
    names: core.seriesCompat,
    label: core.seriesCompat.map(releaseLabel).join(' / '),
    layer: core.path,
  };
}
