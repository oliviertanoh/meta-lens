// Pure grouping / filtering logic behind the RECIPES section.

import type { BbAppend, Recipe } from './model';

/** Which layers count: only the project's, or every loaded layer. */
export type RecipeScope = 'project' | 'all';

/** Optional extra filter; at most one is active (single-select chips). */
export type RecipeKind = 'appends' | 'overlayed';

export interface RecipeFilter {
  /** Case-insensitive substring matched against PN and file names. */
  text?: string;
  /** Missing → 'project'. */
  scope?: RecipeScope;
  kind?: RecipeKind;
  /**
   * Layer path: keep recipes created by this layer or extended by one of its
   * bbappends (set when the user clicks a layer). Replaces the scope.
   */
  layer?: string;
}

export interface RecipeGroup {
  /** `recipes-*` folder, or '' for recipes outside any folder. */
  category: string;
  recipes: Recipe[];
}

export interface RecipeTree {
  groups: RecipeGroup[];
  /** bbappends that match no recipe, after filtering. */
  orphans: BbAppend[];
  /** Number of recipes before / after filtering. */
  total: number;
  shown: number;
  /** The project scope was requested but no project layer exists: showing all. */
  noProjectLayer: boolean;
}

export const scopeOf = (f: RecipeFilter): RecipeScope => f.scope ?? 'project';

/**
 * Group recipes by category. Input order is kept inside a group (the project
 * index is already sorted by category, PN, path); groups are sorted by name.
 */
export function buildRecipeTree(
  recipes: readonly Recipe[],
  appends: readonly BbAppend[],
  filter: RecipeFilter = {},
  projectLayers: ReadonlySet<string> = new Set(),
): RecipeTree {
  const appendLayer = new Map(appends.map((a) => [a.path, a.layer]));
  const touchedBy = (r: Recipe, inLayer: (l: string) => boolean) =>
    inLayer(r.layer) || r.appends.some((a) => inLayer(appendLayer.get(a) ?? ''));

  // A clicked layer replaces the scope; otherwise project or all.
  const projectScope = !filter.layer && scopeOf(filter) === 'project';
  const noProjectLayer = projectScope && projectLayers.size === 0;
  const inScope = (layer: string) =>
    filter.layer
      ? layer === filter.layer
      : !projectScope || noProjectLayer || projectLayers.has(layer);

  const kindOk = (r: Recipe) =>
    filter.kind === 'appends'
      ? r.appends.length > 0
      : filter.kind === 'overlayed'
        ? !!r.overlay
        : true;

  const needle = filter.text?.trim().toLowerCase() ?? '';
  const textOk = (...names: string[]) =>
    !needle || names.some((n) => n.toLowerCase().includes(needle));

  const byCategory = new Map<string, Recipe[]>();
  let shown = 0;
  for (const r of recipes) {
    if (!touchedBy(r, inScope) || !kindOk(r) || !textOk(r.pn, r.fileName)) continue;
    byCategory.set(r.category, [...(byCategory.get(r.category) ?? []), r]);
    shown++;
  }

  const groups = [...byCategory]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, list]) => ({ category, recipes: list }));

  // Orphan bbappends are relevant unless the user asked for overlays only.
  const orphans =
    filter.kind === 'overlayed'
      ? []
      : appends.filter(
          (a) => a.recipes.length === 0 && inScope(a.layer) && textOk(a.pn, a.fileName),
        );

  return { groups, orphans, total: recipes.length, shown, noProjectLayer };
}
