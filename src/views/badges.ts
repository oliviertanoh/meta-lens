import * as vscode from 'vscode';

/**
 * Tree items get a resourceUri in one of these schemes so a FileDecoration
 * can draw a badge on the right. Custom schemes keep the badges out of the
 * Explorer.
 */
export const RECIPE_SCHEME = 'meta-lens-recipe';
export const LAYER_SCHEME = 'meta-lens-layer';

export function recipeBadgeUri(file: string, appendCount: number): vscode.Uri {
  return vscode.Uri.from({ scheme: RECIPE_SCHEME, path: file, query: `appends=${appendCount}` });
}

export function layerBadgeUri(dir: string, priority: number | undefined): vscode.Uri {
  return vscode.Uri.from({
    scheme: LAYER_SCHEME,
    path: dir,
    query: priority === undefined ? '' : `priority=${priority}`,
  });
}

/** VS Code only accepts 1–2 character badges. */
export function badgeText(n: number): string {
  if (n < 10) return `+${n}`;
  return n < 100 ? String(n) : '99';
}

/** Priority badge, or undefined when it does not fit in 2 characters. */
export function priorityBadge(priority: number | undefined): string | undefined {
  if (priority === undefined) return '?';
  return priority >= 0 && priority < 100 ? String(priority) : undefined;
}

export class BadgeProvider implements vscode.FileDecorationProvider {
  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    const q = new URLSearchParams(uri.query);
    if (uri.scheme === RECIPE_SCHEME) {
      const n = Number(q.get('appends') ?? 0);
      if (!n) return undefined;
      return new vscode.FileDecoration(
        badgeText(n),
        `Extended by ${n} bbappend${n > 1 ? 's' : ''}`,
        new vscode.ThemeColor('charts.blue'),
      );
    }
    if (uri.scheme === LAYER_SCHEME) {
      const raw = q.get('priority');
      const prio = raw === null ? undefined : Number(raw);
      const badge = priorityBadge(prio);
      if (!badge) return undefined;
      return new vscode.FileDecoration(
        badge,
        prio === undefined ? 'BBFILE_PRIORITY not set' : `BBFILE_PRIORITY ${prio}`,
      );
    }
    return undefined;
  }
}
