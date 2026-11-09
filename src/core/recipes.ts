// Index .bb / .bbappend / .inc files by name, from file names only (no content parse).

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { DEFAULT_EXCLUDES } from './discovery';
import type { DynamicBbfiles, IncludeFile, RecipeFile, RecipeName } from './model';

// ---------------------------------------------------------------------------
// File names

/**
 * Split a recipe or append file name into PN / PV / PR, like BitBake's
 * `vars_from_file`: `<PN>[_<PV>[_<PR>]].bb`. Returns undefined when the name
 * has more than two underscores (BitBake refuses to parse such a file).
 */
export function parseRecipeName(fileName: string): RecipeName | undefined {
  const stem = fileName.replace(/\.(bb|bbappend)$/, '');
  const parts = stem.split('_');
  if (parts.length > 3 || !parts[0]) return undefined;
  const [pn, pv, pr] = parts as [string, string?, string?];
  const name: RecipeName = { pn };
  if (pv !== undefined) name.pv = pv;
  if (pr !== undefined) name.pr = pr;
  return name;
}

/** `recipes-*` folder of a file relative to its layer, or its first folder, or ''. */
export function categoryOf(relPath: string): string {
  const dirs = relPath.split(/[\\/]+/).slice(0, -1);
  return dirs.find((d) => d.startsWith('recipes-')) ?? dirs[0] ?? '';
}

/**
 * Image recipe guess from the path only (no parse): the file sits in an
 * `images/` folder (the OE convention), or the PN has "image" as a whole
 * dash-separated word and is not a library (libsdl-image, xcb-util-image).
 */
export function isImageRecipe(relPath: string, pn: string): boolean {
  if (
    relPath
      .split(/[\\/]+/)
      .slice(0, -1)
      .includes('images')
  )
    return true;
  return /(^|-)image(-|$)/.test(pn) && !/^(lib|xcb-|packagegroup-)/.test(pn);
}

// ---------------------------------------------------------------------------
// BBFILES patterns (Python glob semantics: `*` and `?` never match `/`)

const toPosix = (p: string) => p.replace(/\\/g, '/');

export function globToRegExp(pattern: string): RegExp {
  const p = toPosix(pattern);
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i] as string;
    if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '[') {
      const end = p.indexOf(']', i + 2);
      if (end < 0) {
        re += '\\[';
        continue;
      }
      let body = p.slice(i + 1, end);
      if (body.startsWith('!')) body = '^' + body.slice(1);
      re += '[' + body.replace(/\\/g, '\\\\') + ']';
      i = end;
    } else re += c.replace(/[.+^${}()|\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$');
}

const hasGlob = (p: string) => /[*?[]/.test(p);

/**
 * Compiled BBFILES: a file is used by BitBake when it matches one of the glob
 * patterns, or lives under a pattern that is a plain directory.
 */
export class BbfilesMatcher {
  private readonly globs: RegExp[] = [];
  private readonly dirs: string[] = [];

  constructor(patterns: string[]) {
    for (const p of patterns) {
      if (hasGlob(p)) this.globs.push(globToRegExp(p));
      else this.dirs.push(toPosix(p).replace(/\/+$/, '') + '/');
    }
  }

  matches(file: string): boolean {
    const f = toPosix(file);
    return this.globs.some((g) => g.test(f)) || this.dirs.some((d) => f.startsWith(d));
  }
}

/**
 * BBFILES of every layer, expanded per-collection templates, plus the
 * BBFILES_DYNAMIC entries enabled by the loaded collections.
 */
export function effectiveBbfiles(
  layers: { bbfiles: string[]; bbfilesDynamic: DynamicBbfiles[]; bbfilesPerCollection: string[] }[],
  collections: Set<string>,
): string[] {
  const out = layers.flatMap((l) => l.bbfiles);
  for (const l of layers) {
    for (const tpl of l.bbfilesPerCollection) {
      for (const c of collections) out.push(tpl.replaceAll('%s', c));
    }
  }
  for (const l of layers) {
    for (const d of l.bbfilesDynamic) {
      if (collections.has(d.collection) !== d.negate) out.push(d.pattern);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Layer scan

export interface LayerFiles {
  bb: string[];
  bbappend: string[];
  inc: string[];
}

/**
 * List `.bb`, `.bbappend` and `.inc` files under a layer, sorted by path.
 * Nested layers and excluded directories are skipped.
 */
export async function scanLayerFiles(
  layerDir: string,
  excludeDirs: string[] = [],
): Promise<LayerFiles> {
  const excludes = new Set([...DEFAULT_EXCLUDES, ...excludeDirs]);
  const files: LayerFiles = { bb: [], bbappend: [], inc: [] };

  const walk = async (dir: string, isRoot: boolean): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (!isRoot && entries.some((e) => e.name === 'conf' && e.isDirectory())) {
      try {
        if ((await fs.stat(path.join(dir, 'conf', 'layer.conf'))).isFile()) return; // nested layer
      } catch {
        // not a layer, keep walking
      }
    }
    const subs: Promise<void>[] = [];
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!excludes.has(e.name) && !e.name.startsWith('.')) subs.push(walk(full, false));
      } else if (e.isFile()) {
        if (e.name.endsWith('.bb')) files.bb.push(full);
        else if (e.name.endsWith('.bbappend')) files.bbappend.push(full);
        else if (e.name.endsWith('.inc')) files.inc.push(full);
      }
    }
    await Promise.all(subs);
  };

  await walk(layerDir, true);
  files.bb.sort();
  files.bbappend.sort();
  files.inc.sort();
  return files;
}

export interface IndexedFiles {
  recipes: RecipeFile[];
  /** Appends with their name parts; matching happens in appendMatch.ts. */
  appends: (RecipeFile & { wildcard: boolean })[];
  includes: IncludeFile[];
  /** `.bb` / `.bbappend` files present on disk but not matched by BBFILES. */
  ignored: string[];
  /** Files whose name BitBake cannot split (too many underscores). */
  badNames: string[];
}

/** Turn the raw file lists of one layer into index entries, keeping only BBFILES matches. */
export function indexLayerFiles(
  layerDir: string,
  files: LayerFiles,
  matcher: BbfilesMatcher,
): IndexedFiles {
  const out: IndexedFiles = { recipes: [], appends: [], includes: [], ignored: [], badNames: [] };
  const entry = (file: string): RecipeFile | undefined => {
    const fileName = path.basename(file);
    const name = parseRecipeName(fileName);
    if (!name) {
      out.badNames.push(file);
      return undefined;
    }
    return {
      ...name,
      path: file,
      layer: layerDir,
      fileName,
      category: categoryOf(path.relative(layerDir, file)),
    };
  };

  for (const f of files.bb) {
    if (!matcher.matches(f)) out.ignored.push(f);
    else {
      const r = entry(f);
      if (r) out.recipes.push(r);
    }
  }
  for (const f of files.bbappend) {
    if (!matcher.matches(f)) out.ignored.push(f);
    else {
      const a = entry(f);
      if (a) out.appends.push({ ...a, wildcard: a.fileName.includes('%') });
    }
  }
  for (const f of files.inc) {
    out.includes.push({ path: f, layer: layerDir, fileName: path.basename(f) });
  }
  return out;
}
