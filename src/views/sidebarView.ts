import * as vscode from 'vscode';
import type { RecipeFilter } from '../core/recipeTree';
import type { SidebarModel } from '../core/sidebarModel';
import type { FromHost, ToHost } from '../webview/main';

export const SIDEBAR_VIEW_ID = 'metaLens.sidebar';

function nonce(): string {
  let s = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

/** The single meta-lens sidebar: PROJECT, LAYERS and RECIPES rendered in a webview. */
export class SidebarViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private model: SidebarModel | undefined;
  private filter: RecipeFilter = { scope: 'project' };
  private readyWaiters: (() => void)[] = [];
  private readonly disposables: vscode.Disposable[] = [];
  private readonly filterEmitter = new vscode.EventEmitter<RecipeFilter>();
  /** Fired when the user changes a filter or chip in the webview. */
  readonly onDidChangeFilter = this.filterEmitter.event;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const dist = vscode.Uri.joinPath(this.extensionUri, 'dist');
    view.webview.options = { enableScripts: true, localResourceRoots: [dist] };
    view.webview.html = this.html(view.webview, dist);
    this.disposables.push(
      view.webview.onDidReceiveMessage((msg: ToHost) => this.onMessage(msg)),
      view.onDidDispose(() => {
        if (this.view === view) this.view = undefined;
      }),
    );
  }

  setModel(model: SidebarModel): void {
    this.model = model;
    void this.post({ type: 'model', model });
  }

  focusFilter(): void {
    void this.post({ type: 'focusFilter' });
  }

  /**
   * Merge `changes` into the current filter and send the whole result: JSON
   * messages drop `undefined`, so sending only the changes could not clear a key.
   */
  setFilter(changes: Partial<RecipeFilter>): void {
    const next: RecipeFilter = { ...this.filter, ...changes };
    for (const k of Object.keys(next) as (keyof RecipeFilter)[]) {
      if (next[k] === undefined) delete next[k];
    }
    void this.post({ type: 'setFilter', filter: next });
  }

  getFilter(): RecipeFilter {
    return this.filter;
  }

  /** Resolves once the webview script is running (used by tests). */
  whenReady(): Promise<void> {
    return new Promise((resolve) => this.readyWaiters.push(resolve));
  }

  private post(msg: FromHost): Thenable<boolean> | undefined {
    return this.view?.webview.postMessage(msg);
  }

  private onMessage(msg: ToHost): void {
    switch (msg.type) {
      case 'ready':
        if (this.model) void this.post({ type: 'model', model: this.model });
        this.readyWaiters.splice(0).forEach((r) => r());
        break;
      case 'open': {
        const options: vscode.TextDocumentShowOptions = { preview: true };
        if (msg.line) {
          const pos = new vscode.Position(msg.line - 1, 0);
          options.selection = new vscode.Range(pos, pos);
        }
        void vscode.commands.executeCommand('vscode.open', vscode.Uri.file(msg.file), options);
        break;
      }
      case 'state':
        this.filter = msg.filter;
        this.filterEmitter.fire(msg.filter);
        break;
    }
  }

  private html(webview: vscode.Webview, dist: vscode.Uri): string {
    const n = nonce();
    const uri = (...p: string[]) => webview.asWebviewUri(vscode.Uri.joinPath(dist, ...p));
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${n}'`,
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="${uri('codicons', 'codicon.css')}" rel="stylesheet">
<link href="${uri('webview.css')}" rel="stylesheet">
</head>
<body>
<div id="sec-project-header"></div>
<div id="sec-project-body" class="section-body"><div id="project" role="tree"></div></div>
<div id="sec-layers-header"></div>
<div id="sec-layers-body" class="section-body"><div id="layers" role="tree"></div></div>
<div id="sec-recipes-header"></div>
<div id="sec-recipes-body" class="section-body">
  <div class="filter-box"><input id="filter" type="text" placeholder="Filter recipes..." aria-label="Filter recipes" spellcheck="false"></div>
  <div id="chips" class="chips" role="toolbar" aria-label="Recipe filters"></div>
  <div id="recipes" role="tree"></div>
</div>
<script nonce="${n}" src="${uri('webview.js')}"></script>
</body>
</html>`;
  }

  dispose(): void {
    this.filterEmitter.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
