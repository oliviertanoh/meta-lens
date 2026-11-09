import * as vscode from 'vscode';
import type { OverlayChain } from '../core/overlayChain';
import { renderChain } from '../webview/chainRender';

/** The OVERLAY CHAIN panel, opened beside the editor and reused for every recipe. */
export class ChainPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  get isOpen(): boolean {
    return !!this.panel;
  }

  show(chain: OverlayChain): void {
    const dist = vscode.Uri.joinPath(this.extensionUri, 'dist');
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'metaLens.overlayChain',
        'Overlay chain',
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
        { enableScripts: true, localResourceRoots: [dist] },
      );
      this.panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'media', 'logo-color.svg');
      this.panel.onDidDispose(() => (this.panel = undefined));
      this.panel.webview.onDidReceiveMessage((m: { type: 'open'; file: string; line?: number }) => {
        if (m.type !== 'open') return;
        const options: vscode.TextDocumentShowOptions = { viewColumn: vscode.ViewColumn.One };
        if (m.line) {
          const pos = new vscode.Position(m.line - 1, 0);
          options.selection = new vscode.Range(pos, pos);
        }
        void vscode.commands.executeCommand('vscode.open', vscode.Uri.file(m.file), options);
      });
    } else {
      this.panel.reveal(undefined, true);
    }
    this.panel.title = `Overlay chain: ${chain.recipe.pn}`;
    this.panel.webview.html = this.html(this.panel.webview, dist, chain);
  }

  private html(webview: vscode.Webview, dist: vscode.Uri, chain: OverlayChain): string {
    const n = Array.from({ length: 32 }, () => Math.floor(Math.random() * 36).toString(36)).join(
      '',
    );
    const uri = (...p: string[]) => webview.asWebviewUri(vscode.Uri.joinPath(dist, ...p));
    const csp = `default-src 'none'; style-src ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${n}'`;
    const rel = (f: string) => vscode.workspace.asRelativePath(f, false);
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<link href="${uri('codicons', 'codicon.css')}" rel="stylesheet"><link href="${uri('chain.css')}" rel="stylesheet">
</head><body>${renderChain(chain, rel)}
<script nonce="${n}">
const vscode = acquireVsCodeApi();
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-file]');
  if (!a) return;
  e.preventDefault();
  vscode.postMessage({ type: 'open', file: a.dataset.file, line: a.dataset.line ? Number(a.dataset.line) : undefined });
});
</script></body></html>`;
  }

  dispose(): void {
    this.panel?.dispose();
  }
}
