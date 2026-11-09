// Build a Project model (config source + layers + diagnostics) from a workspace root.

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { parseBblayers, type BblayersEntry } from './bblayers';
import { matchAppends, type LayerRank } from './appendMatch';
import { readConfVars, readKasVars, type ConfFile } from './confVars';
import { discover, type DiscoveryOptions } from './discovery';
import { parseLayerConf } from './layerConf';
import type {
  ConfigSource,
  ConfSetting,
  ConfValue,
  Diagnostic,
  IncludeFile,
  Layer,
  Project,
  ProjectConfig,
  RecipeFile,
} from './model';
import { classifyLayers } from './layerOrigin';
import { detectRelease } from './release';
import {
  BbfilesMatcher,
  effectiveBbfiles,
  indexLayerFiles,
  scanLayerFiles,
  type LayerFiles,
} from './recipes';

async function isDir(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Try to locate a BBLAYERS entry that does not resolve as written:
 * - unresolved `${VAR}` (OEROOT, BSPDIR…) → try a few plausible base dirs;
 * - absolute path from another machine (`/home/bob/poky/meta`) → match the
 *   longest path suffix that exists under the workspace.
 */
async function relocate(
  entry: BblayersEntry,
  root: string,
  topdir: string,
): Promise<string | undefined> {
  const bases = [...new Set([root, path.dirname(topdir), topdir])];

  if (entry.unresolved.length > 0) {
    for (const base of bases) {
      const candidate = path.resolve(topdir, entry.expanded.replace(/\$\{[^}]*\}/g, base));
      if (await isDir(candidate)) return candidate;
    }
    return undefined;
  }

  const parts = (entry.path ?? '').split(/[\\/]+/).filter(Boolean);
  for (let i = 1; i < parts.length; i++) {
    const suffix = parts.slice(i).join(path.sep);
    for (const base of bases) {
      const candidate = path.join(base, suffix);
      if (await isDir(path.join(candidate, 'conf'))) return candidate;
    }
  }
  return undefined;
}

function emptyLayer(name: string, dir: string): Layer {
  return {
    name,
    path: dir,
    collections: [],
    depends: [],
    seriesCompat: [],
    bbfiles: [],
    bbfilesDynamic: [],
    bbfilesPerCollection: [],
    origin: { kind: 'project', reason: 'part of this repository' },
    recipeCount: 0,
    appendCount: 0,
    diagnostics: [],
  };
}

interface LoadedLayer {
  layer: Layer;
  files: LayerFiles;
}

async function loadLayer(dir: string, excludeDirs: string[] | undefined): Promise<LoadedLayer> {
  const layer = emptyLayer(path.basename(dir), dir);
  const files = await scanLayerFiles(dir, excludeDirs);
  const confFile = path.join(dir, 'conf', 'layer.conf');
  let text: string;
  try {
    text = await fs.readFile(confFile, 'utf8');
  } catch {
    layer.diagnostics.push({
      severity: 'warning',
      message: 'conf/layer.conf not found: this directory is not a valid layer.',
    });
    return { layer, files };
  }
  layer.layerConf = confFile;
  const info = parseLayerConf(text, confFile);
  layer.collections = info.collections.map((c) => c.name);
  layer.priority = info.collections[0]?.priority;
  layer.depends = info.collections.flatMap((c) =>
    c.depends.map((d) => ({ ...d, line: c.dependsLine })),
  );
  layer.seriesCompat = [...new Set(info.collections.flatMap((c) => c.seriesCompat))];
  layer.bbfiles = info.bbfiles;
  layer.bbfilesDynamic = info.bbfilesDynamic;
  layer.bbfilesPerCollection = info.bbfilesPerCollection;
  layer.diagnostics.push(...info.diagnostics);
  return { layer, files };
}

function missingLayer(entry: BblayersEntry, file: string): Layer {
  const shown = entry.path ?? entry.expanded;
  const layer = emptyLayer(path.basename(shown) || entry.raw, shown);
  layer.diagnostics.push({
    severity: 'error',
    message: `Layer listed in BBLAYERS not found: ${entry.raw}`,
    file,
  });
  return layer;
}

/**
 * Build the recipe / append index of the loaded layers: apply BBFILES (and
 * the enabled BBFILES_DYNAMIC entries), then match appends to recipes.
 */
function buildIndex(loaded: LoadedLayer[]) {
  const layers = loaded.map((l) => l.layer);
  const collections = new Set(layers.flatMap((l) => l.collections));
  const matcher = new BbfilesMatcher(effectiveBbfiles(layers, collections));

  const recipeFiles: RecipeFile[] = [];
  const appendFiles: (RecipeFile & { wildcard: boolean })[] = [];
  const includes: IncludeFile[] = [];
  const ranks = new Map<string, LayerRank>();

  loaded.forEach(({ layer, files }, index) => {
    ranks.set(layer.path, { priority: layer.priority ?? 0, index });
    const idx = indexLayerFiles(layer.path, files, matcher);
    recipeFiles.push(...idx.recipes);
    appendFiles.push(...idx.appends);
    includes.push(...idx.includes);
    layer.recipeCount = idx.recipes.length;
    layer.appendCount = idx.appends.length;
    if (idx.ignored.length > 0) {
      layer.diagnostics.push({
        severity: 'info',
        message: `${idx.ignored.length} .bb/.bbappend file(s) not matched by BBFILES are ignored, e.g. ${path.relative(layer.path, idx.ignored[0] as string)}.`,
        file: layer.layerConf,
      });
    }
    for (const f of idx.badNames) {
      layer.diagnostics.push({
        severity: 'warning',
        message: `Too many underscores in ${path.basename(f)}: BitBake cannot derive PN/PV from it.`,
        file: f,
      });
    }
  });

  const match = matchAppends(recipeFiles, appendFiles, ranks);
  for (const layer of layers) layer.diagnostics.push(...(match.diagnostics.get(layer.path) ?? []));

  const recipes = match.recipes.sort(
    (a, b) =>
      a.category.localeCompare(b.category) ||
      a.pn.localeCompare(b.pn) ||
      a.path.localeCompare(b.path),
  );
  return { recipes, appends: match.appends, includes };
}

/** Cross-layer checks: missing LAYERDEPENDS collections, duplicate collection names. */
function checkLayers(layers: Layer[]): void {
  const owners = new Map<string, Layer[]>();
  for (const l of layers) {
    for (const c of l.collections) owners.set(c, [...(owners.get(c) ?? []), l]);
  }
  for (const l of layers) {
    for (const d of l.depends) {
      if (!owners.has(d.collection)) {
        l.diagnostics.push({
          severity: 'warning',
          message: `LAYERDEPENDS: collection "${d.collection}" is required but no loaded layer provides it.`,
          file: l.layerConf,
          line: d.line,
        });
      }
    }
  }
  for (const [coll, ls] of owners) {
    if (ls.length < 2) continue;
    for (const l of ls) {
      l.diagnostics.push({
        severity: 'warning',
        message: `Collection "${coll}" is also declared by ${ls
          .filter((o) => o !== l)
          .map((o) => o.name)
          .join(', ')}.`,
        file: l.layerConf,
      });
    }
  }
}

async function readIfExists(file: string): Promise<ConfFile | undefined> {
  try {
    return { file, text: await fs.readFile(file, 'utf8') };
  } catch {
    return undefined;
  }
}

/** Raw MACHINE / DISTRO from local.conf + auto.conf (next to bblayers.conf) or the kas file. */
async function readMachineDistro(
  source: ConfigSource,
): Promise<{ machine?: ConfValue; distro?: ConfValue }> {
  if (source.kind === 'bblayers' && source.file) {
    const confDir = path.dirname(source.file);
    const files = (
      await Promise.all(['local.conf', 'auto.conf'].map((f) => readIfExists(path.join(confDir, f))))
    ).filter((f): f is ConfFile => !!f);
    const v = readConfVars(files, ['MACHINE', 'DISTRO']);
    return { machine: v.MACHINE, distro: v.DISTRO };
  }
  if (source.kind === 'kas' && source.file) {
    const f = await readIfExists(source.file);
    if (!f) return {};
    const v = readKasVars(f.text, f.file, ['machine', 'distro']);
    return { machine: v.machine, distro: v.distro };
  }
  return {};
}

/** Find `conf/<kind>/<name>.conf` in the loaded layers (first match in BBLAYERS order). */
async function locate(
  value: ConfValue | undefined,
  kind: 'machine' | 'distro',
  layers: readonly Layer[],
  diagnostics: Diagnostic[],
): Promise<ConfSetting | undefined> {
  if (!value) return undefined;
  if (value.value.includes('${')) return value;
  for (const l of layers) {
    const f = path.join(l.path, 'conf', kind, `${value.value}.conf`);
    if (await readIfExists(f)) return { ...value, definition: f, definitionLayer: l.path };
  }
  if (!(kind === 'distro' && value.value === 'nodistro')) {
    diagnostics.push({
      severity: 'warning',
      message: `${kind.toUpperCase()} "${value.value}" is not provided by any loaded layer (no conf/${kind}/${value.value}.conf).`,
      file: value.file,
      line: value.line,
    });
  }
  return value;
}

async function loadConfig(
  source: ConfigSource,
  layers: readonly Layer[],
  diagnostics: Diagnostic[],
): Promise<ProjectConfig> {
  const raw = await readMachineDistro(source);
  return {
    machine: await locate(raw.machine, 'machine', layers, diagnostics),
    distro: await locate(raw.distro, 'distro', layers, diagnostics),
    release: detectRelease(layers),
  };
}

export interface LoadOptions extends DiscoveryOptions {
  /** Force a specific bblayers.conf instead of the shallowest one found. */
  bblayersFile?: string;
  /** Layer directory names to treat as project layers (`metaLens.projectLayers`). */
  projectLayers?: string[];
}

export async function loadProject(root: string, opts: LoadOptions = {}): Promise<Project> {
  const found = await discover(root, opts);
  const diagnostics: Diagnostic[] = [];
  let source: ConfigSource;
  let layerDirs: (string | Layer)[];

  const bblayersFile = opts.bblayersFile ?? found.bblayersFiles[0];
  if (bblayersFile) {
    source = { kind: 'bblayers', file: bblayersFile };
    if (found.bblayersFiles.length > 1 && !opts.bblayersFile) {
      diagnostics.push({
        severity: 'info',
        message: `${found.bblayersFiles.length} bblayers.conf files found; using ${path.relative(root, bblayersFile)}.`,
        file: bblayersFile,
      });
    }
    const text = await fs.readFile(bblayersFile, 'utf8');
    const parsed = parseBblayers(text, bblayersFile);
    layerDirs = [];
    for (const entry of parsed.entries) {
      if (entry.path && (await isDir(entry.path))) {
        layerDirs.push(entry.path);
        continue;
      }
      const moved = await relocate(entry, root, parsed.topdir);
      if (moved) {
        layerDirs.push(moved);
        diagnostics.push({
          severity: 'info',
          message: `BBLAYERS entry "${entry.raw}" resolved to ${path.relative(root, moved) || '.'} by guess.`,
          file: bblayersFile,
        });
      } else {
        layerDirs.push(missingLayer(entry, bblayersFile));
      }
    }
    // Unresolved-variable warnings are superseded by a successful guess or a "not found" error.
    diagnostics.push(...parsed.diagnostics.filter((d) => !d.message.startsWith('Cannot resolve')));
  } else if (found.kasFiles[0]) {
    source = { kind: 'kas', file: found.kasFiles[0] };
    diagnostics.push({
      severity: 'info',
      message: 'kas files are not parsed yet: layers were inferred from a workspace scan.',
      file: found.kasFiles[0],
    });
    layerDirs = found.layerDirs;
  } else {
    source = { kind: 'scan' };
    if (found.layerDirs.length > 0) {
      diagnostics.push({
        severity: 'info',
        message: 'No bblayers.conf or kas file found: layers were inferred from a workspace scan.',
      });
    }
    layerDirs = found.layerDirs;
  }

  // Deduplicate while keeping BBLAYERS order.
  const seen = new Set<string>();
  const unique = layerDirs.filter((d) => {
    const key = typeof d === 'string' ? d : `missing:${d.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const loaded = await Promise.all(
    unique.map((d) =>
      typeof d === 'string'
        ? loadLayer(d, opts.excludeDirs)
        : Promise.resolve({ layer: d, files: { bb: [], bbappend: [], inc: [] } }),
    ),
  );
  const layers = loaded.map((l) => l.layer);
  checkLayers(layers);
  const origins = await classifyLayers(layers, root, { projectLayers: opts.projectLayers });
  for (const l of layers) l.origin = origins.get(l.path) ?? l.origin;
  const index = buildIndex(loaded);
  const config = await loadConfig(source, layers, diagnostics);

  return {
    root,
    source,
    bblayersFiles: found.bblayersFiles,
    kasFiles: found.kasFiles,
    layers,
    ...index,
    config,
    diagnostics,
  };
}
