import * as vscode from 'vscode';
import type { Diagnostic, Project } from './core/model';
import { loadProject } from './core/project';
import { LayersViewProvider } from './views/layersView';

/** Public API returned by activate(), used by integration tests. */
export interface MetaLensApi {
  getProjects(): readonly Project[];
  refresh(): Promise<void>;
}

const WATCH_GLOBS = ['**/conf/layer.conf', '**/conf/bblayers.conf', '**/*.bb'];
const DEBOUNCE_MS = 300;

export function activate(context: vscode.ExtensionContext): MetaLensApi {
  const output = vscode.window.createOutputChannel('meta-lens', { log: true });
  const layersProvider = new LayersViewProvider();
  const layersView = vscode.window.createTreeView('metaLens.layers', {
    treeDataProvider: layersProvider,
    showCollapseAll: false,
  });
  context.subscriptions.push(output, layersProvider, layersView);

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
    const excludeDirs = vscode.workspace
      .getConfiguration('metaLens')
      .get<string[]>('excludeDirs', []);
    const started = Date.now();

    const loaded = await Promise.all(
      folders
        .filter((f) => f.uri.scheme === 'file')
        .map((f) =>
          loadProject(f.uri.fsPath, { excludeDirs }).catch((err: unknown) => {
            output.error(`Scan of ${f.uri.fsPath} failed: ${String(err)}`);
            return undefined;
          }),
        ),
    );
    if (gen !== generation) return; // A newer refresh superseded this one.

    projects = loaded.filter((p): p is Project => p !== undefined);
    const layers = projects.flatMap((p) => p.layers);
    layersProvider.setLayers(layers);
    layersView.description = layers.length ? String(layers.length) : undefined;

    output.info(
      `Scanned ${projects.length} folder(s) in ${Date.now() - started} ms: ${layers.length} layer(s).`,
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
  };
}

export function deactivate(): void {
  // Everything is disposed through context.subscriptions.
}
