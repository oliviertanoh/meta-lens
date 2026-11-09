// Pure grouping / filtering logic behind the RECIPES view.

import type { BbAppend, Recipe } from './model';

export interface RecipeFilter {
  /** Case-insensitive substring matched against PN and file names. */
  text?: string;
  /** Keep only recipes extended by at least one bbappend. */
  hasAppends?: boolean;
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
}

export function isFilterActive(f: RecipeFilter): boolean {
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
): RecipeTree {
  const needle = filter.text?.trim().toLowerCase() ?? '';
  const textOk = (...names: string[]) =>
    !needle || names.some((n) => n.toLowerCase().includes(needle));

  const byCategory = new Map<string, Recipe[]>();
  let shown = 0;
  for (const r of recipes) {
    if (filter.hasAppends && r.appends.length === 0) continue;
    if (!textOk(r.pn, r.fileName)) continue;
    byCategory.set(r.category, [...(byCategory.get(r.category) ?? []), r]);
    shown++;
  }

  const groups = [...byCategory]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, list]) => ({ category, recipes: list }));

  const orphans = appends.filter((a) => a.recipes.length === 0 && textOk(a.pn, a.fileName));

  return { groups, orphans, total: recipes.length, shown };
}
