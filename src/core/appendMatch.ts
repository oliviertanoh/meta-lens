// bbappend ↔ recipe matching, following BitBake's cooker.py exactly:
//
//   base = basename(append).replace('.bbappend', '.bb')
//   match = base == f or ('%' in base and base.startswith(f[:base.index('%')]))
//
// where `f` is the recipe file name. `%` is documented as valid only right
// before `.bbappend`; elsewhere BitBake still matches on the prefix before
// `%`, so we do the same and flag it.

import type { BbAppend, Diagnostic, Recipe, RecipeFile } from './model';

/** BitBake's file-name test: does `appendFileName` apply to `recipeFileName`? */
export function appendMatches(appendFileName: string, recipeFileName: string): boolean {
  const base = appendFileName.replaceAll('.bbappend', '.bb');
  if (base === recipeFileName) return true;
  const pct = base.indexOf('%');
  return pct >= 0 && base.startsWith(recipeFileName.slice(0, pct));
}

/** Warn about a `%` that is not right before `.bbappend` (BitBake's doc says it must be). */
export function wildcardIssue(appendFileName: string): string | undefined {
  const pct = appendFileName.indexOf('%');
  if (pct < 0 || pct === appendFileName.length - '%.bbappend'.length) return undefined;
  return `"%" is only supported right before ".bbappend" in "${appendFileName}"; BitBake will match every recipe starting with "${appendFileName.slice(0, pct)}".`;
}

export interface LayerRank {
  priority: number;
  /** Position in BBLAYERS. */
  index: number;
}

export interface MatchResult {
  recipes: Recipe[];
  appends: BbAppend[];
  /** Diagnostics keyed by layer path (orphans, misplaced wildcards). */
  diagnostics: Map<string, Diagnostic[]>;
}

/**
 * Link every append to the recipes it applies to.
 *
 * Application order: layer priority ascending, then BBLAYERS order (this is
 * how BitBake sorts BBFILES), then path.
 */
export function matchAppends(
  recipeFiles: RecipeFile[],
  appendFiles: (RecipeFile & { wildcard: boolean })[],
  ranks: Map<string, LayerRank>,
): MatchResult {
  const rank = (layer: string) =>
    ranks.get(layer) ?? { priority: 0, index: Number.MAX_SAFE_INTEGER };
  const order = (a: { layer: string; path: string }, b: { layer: string; path: string }) => {
    const ra = rank(a.layer);
    const rb = rank(b.layer);
    return ra.priority - rb.priority || ra.index - rb.index || a.path.localeCompare(b.path);
  };

  const recipes: Recipe[] = recipeFiles.map((r) => ({ ...r, appends: [] }));
  const byFileName = new Map<string, Recipe[]>();
  for (const r of recipes) byFileName.set(r.fileName, [...(byFileName.get(r.fileName) ?? []), r]);

  const diagnostics = new Map<string, Diagnostic[]>();
  const report = (layer: string, d: Diagnostic) =>
    diagnostics.set(layer, [...(diagnostics.get(layer) ?? []), d]);

  const appends: BbAppend[] = [...appendFiles].sort(order).map((a) => {
    let targets: Recipe[];
    if (a.wildcard) {
      targets = recipes.filter((r) => appendMatches(a.fileName, r.fileName));
      const issue = wildcardIssue(a.fileName);
      if (issue) report(a.layer, { severity: 'warning', message: issue, file: a.path });
    } else {
      targets = byFileName.get(a.fileName.replaceAll('.bbappend', '.bb')) ?? [];
    }
    for (const r of targets) r.appends.push(a.path);
    if (targets.length === 0) {
      report(a.layer, {
        severity: 'warning',
        message: `Orphan bbappend: no recipe matches ${a.fileName}.`,
        file: a.path,
      });
    }
    return { ...a, recipes: targets.map((r) => r.path) };
  });

  return { recipes, appends, diagnostics };
}
