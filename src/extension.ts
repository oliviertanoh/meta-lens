import * as vscode from 'vscode';
import type { Diagnostic, Project } from './core/model';
import { loadProject } from './core/project';
import { isFilterActive, type RecipeFilter } from './core/recipeTree';
import { BadgeProvider } from './views/badges';
import { LayersViewProvider } from './views/layersView';
import { ProjectViewProvider } from './views/projectView';
import { RecipesViewProvider } from './views/recipesView';

/** Public API returned by activate(), used by integration tests. */
export interface MetaLensApi {
  getProjects(): readonly Project[];
  refresh(): Promise<void>;
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
  const projectProvider = new ProjectViewProvider();
  const projectView = vscode.window.createTreeView('metaLens.project', {
    treeDataProvider: projectProvider,
  });
  context.subscriptions.push(projectProvider, projectView);
  const layersProvider = new LayersViewProvider();
  const layersView = vscode.window.createTreeView('metaLens.layers', {
    treeDataProvider: layersProvider,
    showCollapseAll: false,
  });
  context.subscriptions.push(vscode.window.registerFileDecorationProvider(new BadgeProvider()));
  const recipesProvider = new RecipesViewProvider();
  const recipesView = vscode.window.createTreeView('metaLens.recipes', {
    treeDataProvider: recipesProvider,
    showCollapseAll: true,
  });
  recipesProvider.onDidChangeCounts(({ shown, total, noProjectLayer }) => {
    recipesView.description =
      total === 0 ? undefined : shown === total ? `${total}` : `${shown} / ${total}`;
    const f = recipesProvider.getFilter();
    const lines: string[] = [];
    if (total > 0 && f.projectOnly) {
      lines.push(
        noProjectLayer
          ? 'No project layer detected: showing all recipes (see metaLens.projectLayers).'
          : 'Project recipes: created or extended by your layers.',
      );
    }
    const parts = [
      f.text?.trim() ? `"${f.text.trim()}"` : undefined,
      f.hasAppends ? 'has bbappends' : undefined,
    ].filter(Boolean);
    if (parts.length) lines.push(`Filter: ${parts.join(' · ')}`);
    recipesView.message = lines.length ? lines.join(' ') : undefined;
  });
  void vscode.commands.executeCommand('setContext', 'metaLens.projectOnly', true);
  context.subscriptions.push(output, layersProvider, layersView, recipesProvider, recipesView);

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
    const layers = projects.flatMap((p) => p.layers);
    layersProvider.setLayers(layers);
    layersView.description = layers.length ? String(layers.length) : undefined;
    projectProvider.setProjects(projects);
    recipesProvider.setData(
      projects.flatMap((p) => p.recipes),
      projects.flatMap((p) => p.appends),
      layers,
    );

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

  // RECIPES filters
  const applyRecipeFilter = (filter: RecipeFilter) => {
    recipesProvider.setFilter(filter);
    void vscode.commands.executeCommand(
      'setContext',
      'metaLens.hasAppendsFilter',
      !!filter.hasAppends,
    );
    void vscode.commands.executeCommand(
      'setContext',
      'metaLens.recipeFilterActive',
      isFilterActive(filter),
    );
    void vscode.commands.executeCommand('setContext', 'metaLens.projectOnly', !!filter.projectOnly);
  };

  const editTextFilter = () => {
    const input = vscode.window.createInputBox();
    input.title = 'Filter recipes';
    input.placeholder = 'Filter recipes… (PN or file name)';
    input.value = recipesProvider.getFilter().text ?? '';
    let timer: NodeJS.Timeout | undefined;
    input.onDidChangeValue((value) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(
        () => applyRecipeFilter({ ...recipesProvider.getFilter(), text: value }),
        150,
      );
    });
    input.onDidAccept(() => input.hide());
    input.onDidHide(() => {
      if (timer) clearTimeout(timer);
      applyRecipeFilter({ ...recipesProvider.getFilter(), text: input.value });
      input.dispose();
    });
    input.show();
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('meta-lens.filterRecipes', editTextFilter),
    vscode.commands.registerCommand('meta-lens.filterAppends', () =>
      applyRecipeFilter({ ...recipesProvider.getFilter(), hasAppends: true }),
    ),
    vscode.commands.registerCommand('meta-lens.filterAppendsOff', () =>
      applyRecipeFilter({ ...recipesProvider.getFilter(), hasAppends: false }),
    ),
    vscode.commands.registerCommand('meta-lens.clearRecipeFilter', () =>
      applyRecipeFilter({ projectOnly: recipesProvider.getFilter().projectOnly }),
    ),
    vscode.commands.registerCommand('meta-lens.showAllRecipes', () =>
      applyRecipeFilter({ ...recipesProvider.getFilter(), projectOnly: false }),
    ),
    vscode.commands.registerCommand('meta-lens.showProjectRecipes', () =>
      applyRecipeFilter({ ...recipesProvider.getFilter(), projectOnly: true }),
    ),
  );

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
