import * as path from 'node:path';
import * as vscode from 'vscode';
import type { BbAppend, Layer, Recipe } from '../core/model';
import { recipeBadgeUri } from './badges';
import {
  buildRecipeTree,
  type RecipeFilter,
  type RecipeGroup,
  type RecipeTree,
} from '../core/recipeTree';

export interface RecipeCounts {
  shown: number;
  total: number;
  noProjectLayer: boolean;
}

type Node =
  | { kind: 'category'; group: RecipeGroup }
  | { kind: 'recipe'; recipe: Recipe }
  | { kind: 'append'; append: BbAppend; parent?: string }
  | { kind: 'orphans'; appends: BbAppend[] };

const openCommand = (file: string): vscode.Command => ({
  command: 'vscode.open',
  title: 'Open',
  arguments: [vscode.Uri.file(file)],
});

export class RecipesViewProvider implements vscode.TreeDataProvider<Node> {
  private recipes: readonly Recipe[] = [];
  private appends: readonly BbAppend[] = [];
  private appendsByPath = new Map<string, BbAppend>();
  private layerNames = new Map<string, string>();
  private filter: RecipeFilter = { projectOnly: true };
  private projectLayers: ReadonlySet<string> = new Set();
  private readonly emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  /** Fired after every rebuild with the recipe counts. */
  private readonly countsEmitter = new vscode.EventEmitter<RecipeCounts>();
  readonly onDidChangeCounts = this.countsEmitter.event;

  setData(recipes: readonly Recipe[], appends: readonly BbAppend[], layers: readonly Layer[]) {
    this.recipes = recipes;
    this.appends = appends;
    this.appendsByPath = new Map(appends.map((a) => [a.path, a]));
    this.layerNames = new Map(layers.map((l) => [l.path, l.name]));
    this.projectLayers = new Set(
      layers.filter((l) => l.origin.kind === 'project').map((l) => l.path),
    );
    this.rebuild();
  }

  setFilter(filter: RecipeFilter) {
    this.filter = filter;
    this.rebuild();
  }

  getFilter(): RecipeFilter {
    return this.filter;
  }

  private tree: RecipeTree = buildRecipeTree([], []);

  private rebuild(): void {
    this.tree = buildRecipeTree(this.recipes, this.appends, this.filter, this.projectLayers);
    this.countsEmitter.fire({
      shown: this.tree.shown,
      total: this.tree.total,
      noProjectLayer: this.tree.noProjectLayer,
    });
    this.emitter.fire(undefined);
  }

  private layerName(layerPath: string): string {
    return this.layerNames.get(layerPath) ?? path.basename(layerPath);
  }

  /** Changes when the filter changes, so VS Code applies our default expansion again. */
  private filterKey(): string {
    return `${this.filter.projectOnly ? 'P' : ''}${this.filter.hasAppends ? 'A' : ''}|${this.filter.text?.trim() ?? ''}`;
  }

  getChildren(node?: Node): Node[] {
    if (!node) {
      const tree = this.tree;
      const roots: Node[] = tree.groups.map((group) => ({ kind: 'category', group }));
      if (tree.orphans.length) roots.push({ kind: 'orphans', appends: tree.orphans });
      return roots;
    }
    switch (node.kind) {
      case 'category':
        return node.group.recipes.map((recipe) => ({ kind: 'recipe', recipe }));
      case 'recipe':
        return node.recipe.appends
          .map((p) => this.appendsByPath.get(p))
          .filter((a): a is BbAppend => !!a)
          .map((append) => ({ kind: 'append', append, parent: node.recipe.path }));
      case 'orphans':
        return node.appends.map((append) => ({ kind: 'append', append }));
      case 'append':
        return [];
    }
  }

  getTreeItem(node: Node): vscode.TreeItem {
    const filtering = !!this.filter.text?.trim();
    const expandGroups = filtering
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.Collapsed;

    switch (node.kind) {
      case 'category': {
        const item = new vscode.TreeItem(node.group.category || '(other)', expandGroups);
        item.id = `cat:${node.group.category}:${this.filterKey()}`;
        item.description = String(node.group.recipes.length);
        item.iconPath = new vscode.ThemeIcon('folder');
        item.contextValue = 'category';
        return item;
      }
      case 'recipe': {
        const r = node.recipe;
        const item = new vscode.TreeItem(
          r.pn,
          r.appends.length
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None,
        );
        item.id = `recipe:${r.path}:${this.filterKey()}`;
        item.description = [r.pv, this.layerName(r.layer)].filter(Boolean).join(' · ');
        item.iconPath = new vscode.ThemeIcon('file-code');
        item.resourceUri = recipeBadgeUri(r.path, r.appends.length);
        item.command = openCommand(r.path);
        item.contextValue = r.appends.length ? 'recipe.extended' : 'recipe';
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**${r.pn}** ${r.pv ?? ''}\n\n`);
        md.appendMarkdown(`Layer: ${this.layerName(r.layer)}  \n`);
        md.appendText(r.path);
        if (r.appends.length) {
          md.appendMarkdown(`\n\nExtended by ${r.appends.length} bbappend(s), in order:\n`);
          r.appends.forEach((a, i) => {
            const ap = this.appendsByPath.get(a);
            md.appendMarkdown(`\n${i + 1}. `);
            md.appendText(`${path.basename(a)} — ${ap ? this.layerName(ap.layer) : ''}`);
          });
        }
        item.tooltip = md;
        return item;
      }
      case 'append': {
        const a = node.append;
        const item = new vscode.TreeItem(a.fileName, vscode.TreeItemCollapsibleState.None);
        item.id = `append:${node.parent ?? 'orphan'}:${a.path}:${this.filterKey()}`;
        item.description = this.layerName(a.layer);
        item.iconPath = node.parent
          ? new vscode.ThemeIcon('add')
          : new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
        item.command = openCommand(a.path);
        item.contextValue = node.parent ? 'append' : 'append.orphan';
        item.tooltip = node.parent ? a.path : `Orphan bbappend: no recipe matches.\n${a.path}`;
        return item;
      }
      case 'orphans': {
        const item = new vscode.TreeItem('Orphan bbappends', expandGroups);
        item.id = `orphans:${this.filterKey()}`;
        item.description = String(node.appends.length);
        item.iconPath = new vscode.ThemeIcon(
          'warning',
          new vscode.ThemeColor('list.warningForeground'),
        );
        item.tooltip =
          'bbappend files that match no recipe (BitBake fails on them unless BB_DANGLINGAPPENDS_WARNONLY is set).';
        return item;
      }
    }
  }

  dispose(): void {
    this.emitter.dispose();
    this.countsEmitter.dispose();
  }
}
