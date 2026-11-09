import * as vscode from 'vscode';

/**
 * URI scheme used only by RECIPES tree items, so the `+N` badge never shows
 * up on the real files in the Explorer.
 */
export const RECIPE_SCHEME = 'meta-lens-recipe';

export function recipeBadgeUri(file: string, appendCount: number): vscode.Uri {
  return vscode.Uri.from({ scheme: RECIPE_SCHEME, path: file, query: `appends=${appendCount}` });
}

/** VS Code only accepts 1–2 character badges. */
export function badgeText(n: number): string {
  if (n < 10) return `+${n}`;
  return n < 100 ? String(n) : '99';
}

export class AppendBadgeProvider implements vscode.FileDecorationProvider {
  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== RECIPE_SCHEME) return undefined;
    const n = Number(new URLSearchParams(uri.query).get('appends') ?? 0);
    if (!n) return undefined;
    return new vscode.FileDecoration(badgeText(n), `Extended by ${n} bbappend${n > 1 ? 's' : ''}`);
  }
}
