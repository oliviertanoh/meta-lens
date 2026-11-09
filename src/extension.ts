import * as vscode from 'vscode';
import type { Diagnostic, Project } from './core/model';
import { loadProject } from './core/project';
import type { RecipeFilter } from './core/recipeTree';
import { buildSidebarModel } from './core/sidebarModel';
import { SIDEBAR_VIEW_ID, SidebarViewProvider } from './views/sidebarView';

/** Public API returned by activate(), used by integration tests. */
export interface MetaLensApi {
  getProjects(): readonly Project[];
  refresh(): Promise<void>;
  /** Resolves when the sidebar webview script is running. */
  sidebarReady(): Promise<void>;
  /** Recipe filter as last reported by the webview. */
  getRecipeFilter(): RecipeFilter;
}

/** Any change to these files triggers a rescan (debounced). */
const WATCH_GLOBS = [
  '**/conf/*.conf', // layer.conf, bblayers.conf, local.conf, auto.conf
  '**/conf/{machine,distro}/*.conf',
  '**/*.{bb,bbappend,inc}',
  '**/*.{yml,yaml}', // kas files
];
const DEBOUNCE_MS = 300;

export function activate(context: vscode.ExtensionContext): MetaLensApi {
  const output = vscode.window.createOutputChannel('meta-lens', { log: true });
  const sidebar = new SidebarViewProvider(context.extensionUri);
  const ready = sidebar.whenReady();
  context.subscriptions.push(
    output,
    sidebar,
    vscode.window.registerWebviewViewProvider(SIDEBAR_VIEW_ID, sidebar),
  );

  let projects: Project[] = [];
  let generation = 0;

  const logDiag = (d: Diagnostic) => {
    const where = d.file
      ? ` (${vscode.workspace.asRelativePath(d.file)}${d.line ? `:${d.line}` : ''})`
      : '';
    const msg = d.message + where;
    if (d.severity === 'error') output.error(msg);
    else if (d.severity === 'warning') output.warn(msg);
    else output.info(msg);
  };

  const refresh = async (): Promise<void> => {
    const gen = ++generation;
    const folders = vscode.workspace.workspaceFolders ?? [];
    const config = vscode.workspace.getConfiguration('metaLens');
    const excludeDirs = config.get<string[]>('excludeDirs', []);
    const projectLayers = config.get<string[]>('projectLayers', []);
    const started = Date.now();

    const loaded = await Promise.all(
      folders
        .filter((f) => f.uri.scheme === 'file')
        .map((f) =>
          loadProject(f.uri.fsPath, { excludeDirs, projectLayers }).catch((err: unknown) => {
            output.error(`Scan of ${f.uri.fsPath} failed: ${String(err)}`);
            return undefined;
          }),
        ),
    );
    if (gen !== generation) return; // A newer refresh superseded this one.

    projects = loaded.filter((p): p is Project => p !== undefined);
    sidebar.setModel(buildSidebarModel(projects, (f) => vscode.workspace.asRelativePath(f, false)));

    const layers = projects.flatMap((p) => p.layers);
    output.info(
      `Scanned ${projects.length} folder(s) in ${Date.now() - started} ms: ${layers.length} layer(s), ${projects.reduce((n, p) => n + p.recipes.length, 0)} recipe(s), ${projects.reduce((n, p) => n + p.appends.length, 0)} bbappend(s).`,
    );
    for (const p of projects) {
      if (p.source.file) output.info(`Config source (${p.source.kind}): ${p.source.file}`);
      p.diagnostics.forEach(logDiag);
      for (const l of p.layers) l.diagnostics.forEach(logDiag);
    }
  };

  // Debounced refresh for file system events.
  let timer: NodeJS.Timeout | undefined;
  const scheduleRefresh = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void refresh();
    }, DEBOUNCE_MS);
  };
  context.subscriptions.push({ dispose: () => timer && clearTimeout(timer) });

  for (const glob of WATCH_GLOBS) {
    const watcher = vscode.workspace.createFileSystemWatcher(glob);
    watcher.onDidCreate(scheduleRefresh);
    watcher.onDidChange(scheduleRefresh);
    watcher.onDidDelete(scheduleRefresh);
    context.subscriptions.push(watcher);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('meta-lens.refresh', () => refresh()),
    vscode.commands.registerCommand('meta-lens.filterRecipes', () => sidebar.focusFilter()),
    vscode.commands.registerCommand('meta-lens.filterAppends', () =>
      sidebar.setFilter({
        kind: sidebar.getFilter().kind === 'appends' ? undefined : 'appends',
      }),
    ),
    vscode.commands.registerCommand('meta-lens.showAllRecipes', () =>
      sidebar.setFilter({ scope: 'all', layer: undefined }),
    ),
    vscode.commands.registerCommand('meta-lens.showProjectRecipes', () =>
      sidebar.setFilter({ scope: 'project', layer: undefined }),
    ),
    vscode.workspace.onDidChangeWorkspaceFolders(scheduleRefresh),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('metaLens')) scheduleRefresh();
    }),
  );

  const initial = refresh();

  return {
    getProjects: () => projects,
    refresh: async () => {
      await initial;
      await refresh();
    },
    sidebarReady: () => ready,
    getRecipeFilter: () => sidebar.getFilter(),
  };
}

export function deactivate(): void {
  // Everything is disposed through context.subscriptions.
}
