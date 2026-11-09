// Overlayed recipes: the same PN provided by several layers
// (what `bitbake-layers show-overlayed` reports).

import type { LayerRank } from './appendMatch';
import type { Recipe } from './model';

/**
 * Compare two versions roughly like BitBake's vercmp: digit runs compare
 * numerically, other runs lexically; a missing part is lower.
 */
export function compareVersions(a = '', b = ''): number {
  const parts = (v: string) => v.match(/\d+|[a-zA-Z]+/g) ?? [];
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i];
    const y = pb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) {
      const d = Number(x) - Number(y);
      if (d) return d;
    } else if (nx !== ny) {
      return nx ? 1 : -1; // a number beats a word
    } else {
      const d = x.localeCompare(y);
      if (d) return d;
    }
  }
  return 0;
}

/**
 * Mark recipes whose PN exists in more than one layer. The preferred one is
 * the highest layer priority, then the highest version, then the earliest
 * layer in BBLAYERS (PREFERRED_VERSION / PREFERRED_PROVIDER are not read).
 */
export function markOverlays(recipes: Recipe[], ranks: Map<string, LayerRank>): void {
  const byPn = new Map<string, Recipe[]>();
  for (const r of recipes) byPn.set(r.pn, [...(byPn.get(r.pn) ?? []), r]);

  const rank = (r: Recipe) => ranks.get(r.layer) ?? { priority: 0, index: Number.MAX_SAFE_INTEGER };
  for (const list of byPn.values()) {
    if (new Set(list.map((r) => r.layer)).size < 2) continue;
    const ordered = [...list].sort(
      (a, b) =>
        rank(b).priority - rank(a).priority ||
        compareVersions(b.pv, a.pv) ||
        rank(a).index - rank(b).index,
    );
    const candidates = ordered.map((r) => r.path);
    const winner = candidates[0] as string;
    for (const r of list) r.overlay = { winner, candidates };
  }
}
