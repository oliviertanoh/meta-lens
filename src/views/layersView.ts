import * as vscode from 'vscode';
import type { Diagnostic, Layer } from '../core/model';

function worstSeverity(diags: Diagnostic[]): 'error' | 'warning' | undefined {
  if (diags.some((d) => d.severity === 'error')) return 'error';
  if (diags.some((d) => d.severity === 'warning')) return 'warning';
  return undefined;
}

function tooltip(layer: Layer): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.appendMarkdown(`**${layer.name}**\n\n`);
  md.appendMarkdown(`\`${layer.path}\`\n\n`);
  const row = (k: string, v: string) => md.appendMarkdown(`${k}: ${v}  \n`);
  row(
    'Collection',
    layer.collections.length ? layer.collections.map((c) => `\`${c}\``).join(', ') : '—',
  );
  row('Priority', layer.priority !== undefined ? String(layer.priority) : '—');
  row('Recipes', String(layer.recipeCount));
  row(
    'Depends on',
    layer.depends.length
      ? layer.depends
          .map((d) => `\`${d.collection}\`${d.version ? ` (${d.version})` : ''}`)
          .join(', ')
      : '—',
  );
  row('Compatible with', layer.seriesCompat.length ? layer.seriesCompat.join(', ') : '—');
  const shown = layer.diagnostics.filter((d) => d.severity !== 'info');
  if (shown.length) {
    md.appendMarkdown('\n---\n\n');
    for (const d of shown) {
      md.appendMarkdown(`$(${d.severity === 'error' ? 'error' : 'warning'}) `);
      md.appendText(d.message);
      md.appendMarkdown('  \n');
    }
  }
  return md;
}

export class LayerItem extends vscode.TreeItem {
  constructor(readonly layer: Layer) {
    super(layer.name, vscode.TreeItemCollapsibleState.None);
    const prio = layer.priority !== undefined ? `prio ${layer.priority}` : 'prio ?';
    const recipes = `${layer.recipeCount} ${layer.recipeCount === 1 ? 'recipe' : 'recipes'}`;
    this.description = `${recipes} · ${prio}`;
    this.tooltip = tooltip(layer);
    this.id = layer.path;

    const severity = worstSeverity(layer.diagnostics);
    this.iconPath =
      severity === 'error'
        ? new vscode.ThemeIcon('error', new vscode.ThemeColor('list.errorForeground'))
        : severity === 'warning'
          ? new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'))
          : new vscode.ThemeIcon('layers');
    this.contextValue = severity ? `layer.${severity}` : 'layer';

    if (layer.layerConf) {
      this.resourceUri = vscode.Uri.file(layer.layerConf);
      this.command = {
        command: 'vscode.open',
        title: 'Open layer.conf',
        arguments: [vscode.Uri.file(layer.layerConf)],
      };
    }
  }
}

export class LayersViewProvider implements vscode.TreeDataProvider<LayerItem> {
  private layers: Layer[] = [];
  private readonly emitter = new vscode.EventEmitter<LayerItem | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  setLayers(layers: Layer[]): void {
    this.layers = layers;
    this.emitter.fire(undefined);
  }

  getLayers(): readonly Layer[] {
    return this.layers;
  }

  getTreeItem(item: LayerItem): vscode.TreeItem {
    return item;
  }

  getChildren(element?: LayerItem): LayerItem[] {
    if (element) return [];
    return this.layers.map((l) => new LayerItem(l));
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
