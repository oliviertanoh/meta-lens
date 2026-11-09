import * as vscode from 'vscode';
import type { Diagnostic, Project } from './core/model';
import { loadBuiltImages, loadProject } from './core/project';
import type { RecipeFilter } from './core/recipeTree';
import { buildSidebarModel } from './core/sidebarModel';
import { buildOverlayChain, type OverlayChain } from './core/overlayChain';
import { ChainPanel } from './views/chainPanel';
import { SIDEBAR_LEFT_VIEW_ID, SIDEBAR_VIEW_ID, SidebarViewProvider } from './views/sidebarView';

/** Public API returned by activate(), used by integration tests. */
export interface MetaLensApi {
  getProjects(): readonly Project[];
  refresh(): Promise<void>;
  /** Resolves when the sidebar webview script is running. */
  sidebarReady(): Promise<void>;
  /** Recipe filter as last reported by the webview. */
  getRecipeFilter(): RecipeFilter;
  /** Whether the OVERLAY CHAIN panel is open. */
  isChainOpen(): boolean;
  /** Chain displayed in the OVERLAY CHAIN panel. */
  currentChain(): OverlayChain | undefined;
  /** Number of full rescans since activation. */
  scanCount(): number;
}

/** Any change to these files triggers a rescan (debounced). */
const WATCH_GLOBS = [
  '**/conf/*.conf', // layer.conf, bblayers.conf, local.conf, auto.conf
  '**/conf/{machine,distro}/*.conf',
  '**/*.{bb,bbappend,inc}',
  '**/*.{yml,yaml}', // kas files
];
/**
 * Built images: only the "latest" manifests, a handful of events per build.
 * They trigger a cheap images-only refresh, not a full rescan.
 */
const DEPLOY_GLOB = '**/deploy/images/*/*.manifest';
/**
 * Deleting a folder (rm -rf tmp, a machine directory...) is reported for the
 * folder only, not for each file inside: watch those deletions too.
 */
const DEPLOY_DIR_DELETE_GLOBS = ['**/{tmp,tmp-glibc,tmp-musl,deploy,images}', '**/deploy/images/*'];
const DEBOUNCE_MS = 300;
/** Builds write many deploy files at the end: wait for the burst to settle. */
const DEPLOY_DEBOUNCE_MS = 1500;

/** First VS Code release where extensions can contribute to the Secondary Side Bar. */
const SECONDARY_SIDEBAR_MIN = [1, 106];

function supportsSecondarySidebar(version = vscode.version): boolean {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  const [wantMajor = 1, wantMinor = 0] = SECONDARY_SIDEBAR_MIN;
  return major > wantMajor || (major === wantMajor && minor >= wantMinor);
}

/** Left when asked, or when this VS Code cannot host views on the right. */
function useLeftSidebar(): boolean {
  const location = vscode.workspace.getConfiguration('metaLens').get<string>('location', 'right');
  return location === 'left' || !supportsSecondarySidebar();
}

export function activate(context: vscode.ExtensionContext): MetaLensApi {
  const output = vscode.window.createOutputChannel('meta-lens', { log: true });
  const sidebar = new SidebarViewProvider(context.extensionUri);
  const ready = sidebar.whenReady();
  context.subscriptions.push(
    output,
    sidebar,
    vscode.window.registerWebviewViewProvider(SIDEBAR_VIEW_ID, sidebar),
    vscode.window.registerWebviewViewProvider(SIDEBAR_LEFT_VIEW_ID, sidebar),
  );
  const applyLocation = () =>
    vscode.commands.executeCommand('setContext', 'metaLens.useLeftSidebar', useLeftSidebar());
  void applyLocation();

  let projects: Project[] = [];

  // OVERLAY CHAIN panel
  const chainPanel = new ChainPanel(context.extensionUri);
  context.subscriptions.push(chainPanel);
  const showChain = async (recipePath: string, force: boolean): Promise<boolean> => {
    const project = projects.find((p) => p.recipes.some((r) => r.path === recipePath));
    const recipe = project?.recipes.find((r) => r.path === recipePath);
    if (!project || !recipe) return false;
    // Open automatically only when there is something to show, or when the panel is already open.
    if (!force && !chainPanel.isOpen && recipe.appends.length === 0 && !recipe.overlay)
      return false;
    const chain = await buildOverlayChain(project, recipePath);
    if (chain) chainPanel.show(chain);
    return !!chain;
  };
  sidebar.onDidOpenRecipe((file) => void showChain(file, false));
  /** Recipe for a .bb or .bbappend path. */
  const recipeFor = (file: string): string | undefined => {
    for (const p of projects) {
      if (p.recipes.some((r) => r.path === file)) return file;
      const a = p.appends.find((x) => x.path === file);
      if (a?.recipes[0]) return a.recipes[0];
    }
    return undefined;
  };
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

  const publish = () =>
    sidebar.setModel(buildSidebarModel(projects, (f) => vscode.workspace.asRelativePath(f, false)));

  const refreshChain = async (recipePath: string) => {
    const project = projects.find((p) => p.recipes.some((r) => r.path === recipePath));
    const chain = project ? await buildOverlayChain(project, recipePath) : undefined;
    if (chain) chainPanel.update(chain);
  };

  /** After a build: re-list deploy/images only (a few readdir + stat). */
  const refreshImages = async (): Promise<void> => {
    if (scanning) return; // a full rescan is running and will include the images
    const gen = generation;
    const images = await Promise.all(projects.map((p) => loadBuiltImages(p)));
    if (gen !== generation) return;
    projects.forEach((p, i) => (p.builtImages = images[i] ?? []));
    publish();
    output.info(`Built images refreshed: ${images.flat().length} image(s).`);
  };

  let scanning = false;
  let scans = 0;
  const refresh = async (): Promise<void> => {
    scanning = true;
    scans++;
    try {
      await rescan();
    } finally {
      scanning = false;
    }
  };

  const rescan = async (): Promise<void> => {
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
    void vscode.commands.executeCommand(
      'setContext',
      'metaLens.hasProject',
      projects.some((p) => p.layers.length > 0),
    );
    publish();
    // Keep the OVERLAY CHAIN panel in sync: only its recipe is re-read.
    if (chainPanel.isOpen && chainPanel.recipe) void refreshChain(chainPanel.recipe);

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
  let deployTimer: NodeJS.Timeout | undefined;
  const scheduleImages = () => {
    if (deployTimer) clearTimeout(deployTimer);
    deployTimer = setTimeout(() => {
      deployTimer = undefined;
      void refreshImages();
    }, DEPLOY_DEBOUNCE_MS);
  };
  context.subscriptions.push({
    dispose: () => {
      if (timer) clearTimeout(timer);
      if (deployTimer) clearTimeout(deployTimer);
    },
  });
  const deployWatcher = vscode.workspace.createFileSystemWatcher(DEPLOY_GLOB);
  deployWatcher.onDidCreate(scheduleImages);
  deployWatcher.onDidChange(scheduleImages);
  deployWatcher.onDidDelete(scheduleImages);
  context.subscriptions.push(deployWatcher);
  for (const glob of DEPLOY_DIR_DELETE_GLOBS) {
    // Deletions only (ignore create and change events).
    const w = vscode.workspace.createFileSystemWatcher(glob, true, true, false);
    w.onDidDelete(scheduleImages);
    context.subscriptions.push(w);
  }

  for (const glob of WATCH_GLOBS) {
    const watcher = vscode.workspace.createFileSystemWatcher(glob);
    watcher.onDidCreate(scheduleRefresh);
    watcher.onDidChange(scheduleRefresh);
    watcher.onDidDelete(scheduleRefresh);
    context.subscriptions.push(watcher);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('meta-lens.refresh', () => refresh()),
    vscode.commands.registerCommand('meta-lens.showOverlayChain', async (uri?: vscode.Uri) => {
      const file = uri?.fsPath ?? vscode.window.activeTextEditor?.document.uri.fsPath;
      const recipe = file ? recipeFor(file) : undefined;
      if (!recipe || !(await showChain(recipe, true))) {
        void vscode.window.showInformationMessage(
          'meta-lens: open a .bb or .bbappend file indexed by meta-lens to see its overlay chain.',
        );
      }
    }),
    vscode.commands.registerCommand('meta-lens.open', () =>
      vscode.commands.executeCommand(
        `${useLeftSidebar() ? SIDEBAR_LEFT_VIEW_ID : SIDEBAR_VIEW_ID}.focus`,
      ),
    ),
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
      if (e.affectsConfiguration('metaLens.location')) void applyLocation();
      else if (e.affectsConfiguration('metaLens')) scheduleRefresh();
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
    isChainOpen: () => chainPanel.isOpen,
    currentChain: () => chainPanel.current,
    scanCount: () => scans,
  };
}

export function deactivate(): void {
  // Everything is disposed through context.subscriptions.
}
