// Build a Project model (config source + layers + diagnostics) from a workspace root.

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { parseBblayers, type BblayersEntry } from './bblayers';
import { countRecipes, discover, type DiscoveryOptions } from './discovery';
import { parseLayerConf } from './layerConf';
import type { ConfigSource, Diagnostic, Layer, Project } from './model';

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

async function loadLayer(dir: string, excludeDirs: string[] | undefined): Promise<Layer> {
  const layer: Layer = {
    name: path.basename(dir),
    path: dir,
    collections: [],
    depends: [],
    seriesCompat: [],
    bbfiles: [],
    recipeCount: 0,
    diagnostics: [],
  };
  const confFile = path.join(dir, 'conf', 'layer.conf');
  let text: string;
  try {
    text = await fs.readFile(confFile, 'utf8');
  } catch {
    layer.diagnostics.push({
      severity: 'warning',
      message: 'conf/layer.conf not found: this directory is not a valid layer.',
    });
    return layer;
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
  layer.diagnostics.push(...info.diagnostics);
  layer.recipeCount = await countRecipes(dir, excludeDirs);
  return layer;
}

function missingLayer(entry: BblayersEntry, file: string): Layer {
  const shown = entry.path ?? entry.expanded;
  return {
    name: path.basename(shown) || entry.raw,
    path: shown,
    collections: [],
    depends: [],
    seriesCompat: [],
    bbfiles: [],
    recipeCount: 0,
    diagnostics: [
      {
        severity: 'error',
        message: `Layer listed in BBLAYERS not found: ${entry.raw}`,
        file,
      },
    ],
  };
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

export interface LoadOptions extends DiscoveryOptions {
  /** Force a specific bblayers.conf instead of the shallowest one found. */
  bblayersFile?: string;
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

  const layers = await Promise.all(
    unique.map((d) =>
      typeof d === 'string' ? loadLayer(d, opts.excludeDirs) : Promise.resolve(d),
    ),
  );
  checkLayers(layers);

  return {
    root,
    source,
    bblayersFiles: found.bblayersFiles,
    kasFiles: found.kasFiles,
    layers,
    diagnostics,
  };
}
