// Pure grouping / filtering logic behind the RECIPES view.

import type { BbAppend, Recipe } from './model';

export interface RecipeFilter {
  /** Case-insensitive substring matched against PN and file names. */
  text?: string;
  /** Keep only recipes extended by at least one bbappend. */
  hasAppends?: boolean;
  /**
   * Keep only recipes created by a project layer, or extended by a bbappend
   * from a project layer. Ignored when there is no project layer.
   */
  projectOnly?: boolean;
}

export interface RecipeGroup {
  /** `recipes-*` folder, or '' for recipes outside any folder. */
  category: string;
  recipes: Recipe[];
}

export interface RecipeTree {
  groups: RecipeGroup[];
  /** bbappends that match no recipe, after the text filter. */
  orphans: BbAppend[];
  /** Number of recipes before / after filtering. */
  total: number;
  shown: number;
  /** `projectOnly` was requested but no project layer exists, so it was ignored. */
  noProjectLayer: boolean;
}

export function isFilterActive(f: RecipeFilter): boolean {
  // `projectOnly` is a scope, not a filter: clearing filters keeps it.
  return !!f.hasAppends || !!f.text?.trim();
}

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
  const noProjectLayer = !!filter.projectOnly && projectLayers.size === 0;
  const projectOnly = !!filter.projectOnly && !noProjectLayer;
  const appendLayer = new Map(appends.map((a) => [a.path, a.layer]));
  const inProject = (r: Recipe) =>
    projectLayers.has(r.layer) ||
    r.appends.some((a) => projectLayers.has(appendLayer.get(a) ?? ''));

  const needle = filter.text?.trim().toLowerCase() ?? '';
  const textOk = (...names: string[]) =>
    !needle || names.some((n) => n.toLowerCase().includes(needle));

  const byCategory = new Map<string, Recipe[]>();
  let shown = 0;
  for (const r of recipes) {
    if (filter.hasAppends && r.appends.length === 0) continue;
    if (projectOnly && !inProject(r)) continue;
    if (!textOk(r.pn, r.fileName)) continue;
    byCategory.set(r.category, [...(byCategory.get(r.category) ?? []), r]);
    shown++;
  }

  const groups = [...byCategory]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, list]) => ({ category, recipes: list }));

  const orphans = appends.filter(
    (a) =>
      a.recipes.length === 0 &&
      textOk(a.pn, a.fileName) &&
      (!projectOnly || projectLayers.has(a.layer)),
  );

  return { groups, orphans, total: recipes.length, shown, noProjectLayer };
}
