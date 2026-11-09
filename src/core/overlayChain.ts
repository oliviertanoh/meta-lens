// Overlay chain of one recipe: base recipe then its bbappends in application
// order, with the interesting assignments and the files shadowed through
// FILESEXTRAPATHS. Files are read lazily, only for the recipe asked for.

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { type Assignment, expand, parseAssignments } from './bbvars';
import type { Project, Recipe } from './model';

/** Variables worth showing in a chain step. */
const INTERESTING =
  /^(SRC_URI|FILESEXTRAPATHS|SRCREV\w*|SRCBRANCH|PV|PR|DEPENDS|RDEPENDS\w*|RRECOMMENDS\w*|PACKAGECONFIG\w*|EXTRA_OE\w*|KERNEL_\w+|KBUILD_DEFCONFIG\w*|LICENSE|LIC_FILES_CHKSUM|SUMMARY|COMPATIBLE_MACHINE\w*|IMAGE_INSTALL\w*|DISTRO_FEATURES\w*|MACHINE_FEATURES\w*)$/;
/** Legacy override syntax: VAR_append / VAR_prepend / VAR_remove. */
const LEGACY = /_(append|prepend|remove)(_|$)/;

export interface ChainLine {
  line: number;
  /** One-line rendering of the assignment. */
  text: string;
  legacy?: boolean;
}

export interface ShadowedFile {
  /** Name as written after file:// (may contain a sub-path). */
  name: string;
  /** File this step provides. */
  file: string;
  /** File of the base recipe it replaces; undefined when the file is new. */
  replaces?: string;
}

export interface ChainStep {
  kind: 'base' | 'append';
  file: string;
  layerName: string;
  priority?: number;
  lines: ChainLine[];
  /** Files from this step's FILESEXTRAPATHS that win the FILESPATH search. */
  shadows: ShadowedFile[];
}

export interface OverlayChain {
  recipe: { pn: string; pv?: string; path: string; layerName: string };
  steps: ChainStep[];
  final: {
    srcUriAdded: string[];
    srcUriRemoved: string[];
    /** Extra search paths, searched first to last. */
    filesExtraPaths: string[];
    overridden: { name: string; layerName: string; file: string; replaces: string }[];
  };
  /** Same PN in other layers, preferred first. */
  overlay?: { layerName: string; path: string; pv?: string; winner: boolean }[];
  /** Orphan bbappends of the layers involved in this chain. */
  orphans: { fileName: string; path: string; layerName: string }[];
  /** Files that could not be read. */
  unreadable: string[];
}

function oneLine(a: Assignment): string {
  const name = `${a.name}${a.override ? `:${a.override}` : ''}${a.flag ? `[${a.flag}]` : ''}`;
  return `${name} ${a.op} "${a.value.replace(/\s+/g, ' ').trim()}"`;
}

/** file:// entries of a SRC_URI value, without parameters (`;subdir=...`). */
export function fileEntries(value: string): string[] {
  return value
    .split(/\s+/)
    .filter((e) => e.startsWith('file://'))
    .map((e) => e.slice('file://'.length).split(';')[0] as string)
    .filter(Boolean);
}

async function exists(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile();
  } catch {
    return false;
  }
}

async function firstExisting(dirs: string[], name: string): Promise<string | undefined> {
  for (const d of dirs) {
    const f = path.join(d, name);
    if (await exists(f)) return f;
  }
  return undefined;
}

export async function buildOverlayChain(
  project: Project,
  recipePath: string,
): Promise<OverlayChain | undefined> {
  const recipe = project.recipes.find((r) => r.path === recipePath);
  if (!recipe) return undefined;
  const layerOf = new Map(project.layers.map((l) => [l.path, l]));
  const appendByPath = new Map(project.appends.map((a) => [a.path, a]));
  const name = (layer: string) => layerOf.get(layer)?.name ?? path.basename(layer);

  const unreadable: string[] = [];
  const read = async (f: string) => {
    try {
      return await fs.readFile(f, 'utf8');
    } catch {
      unreadable.push(f);
      return '';
    }
  };

  const vars = (file: string): Record<string, string> => {
    const pn = recipe.pn;
    const pv = recipe.pv ?? '1.0';
    return { THISDIR: path.dirname(file), PN: pn, BPN: pn, PV: pv, BP: `${pn}-${pv}` };
  };

  // Base recipe
  const baseText = await read(recipe.path);
  const baseAssign = parseAssignments(baseText);
  const steps: ChainStep[] = [
    {
      kind: 'base',
      file: recipe.path,
      layerName: name(recipe.layer),
      priority: layerOf.get(recipe.layer)?.priority,
      lines: baseAssign
        .filter((a) => INTERESTING.test(a.name) || LEGACY.test(a.name))
        .map((a) => ({ line: a.line, text: oneLine(a), legacy: LEGACY.test(a.name) || undefined })),
      shadows: [],
    },
  ];
  const baseFiles = baseAssign
    .filter((a) => a.name === 'SRC_URI' && !a.flag && a.override !== 'remove')
    .flatMap((a) => fileEntries(a.value));

  // Appends, in application order
  const srcUriAdded: string[] = [];
  const srcUriRemoved: string[] = [];
  const extraByStep: string[][] = [];
  const appendFiles: string[] = [];
  for (const ap of recipe.appends) {
    const a = appendByPath.get(ap);
    const text = await read(ap);
    const assign = parseAssignments(text);
    const extra: string[] = [];
    for (const x of assign) {
      const base = x.name.replace(LEGACY, '');
      const legacyOp = LEGACY.exec(x.name)?.[1];
      if (base === 'SRC_URI' && !x.flag) {
        const entries = x.value.split(/\s+/).filter(Boolean);
        const op = x.override ?? legacyOp;
        if (op === 'remove') srcUriRemoved.push(...entries);
        else if (op || ['+=', '=+', '.=', '=.'].includes(x.op)) srcUriAdded.push(...entries);
        appendFiles.push(...fileEntries(x.value).filter(() => op !== 'remove'));
      }
      if (base === 'FILESEXTRAPATHS') {
        const v = expand(x.value, (n) => vars(ap)[n]).value;
        extra.push(...v.split(':').filter((d) => d && !d.includes('${')));
      }
    }
    extraByStep.push(extra);
    steps.push({
      kind: 'append',
      file: ap,
      layerName: name(a?.layer ?? path.dirname(ap)),
      priority: a ? layerOf.get(a.layer)?.priority : undefined,
      lines: assign
        .filter((x) => INTERESTING.test(x.name.replace(LEGACY, '')) || LEGACY.test(x.name))
        .map((x) => ({ line: x.line, text: oneLine(x), legacy: LEGACY.test(x.name) || undefined })),
      shadows: [],
    });
  }

  // FILESPATH search: each append prepends, so the last applied is searched first.
  const recipeDir = path.dirname(recipe.path);
  const v = vars(recipe.path);
  const baseDirs = [v.BP, v.BPN, 'files'].map((d) => path.join(recipeDir, d as string));
  const searchOrder = extraByStep.map((dirs, i) => ({ dirs, step: i + 1 })).reverse();
  const overridden: OverlayChain['final']['overridden'] = [];
  for (const fname of [...new Set([...baseFiles, ...appendFiles])]) {
    for (const { dirs, step } of searchOrder) {
      const hit = await firstExisting(dirs, fname);
      if (!hit) continue;
      const replaces = await firstExisting(baseDirs, fname);
      const s = steps[step] as ChainStep;
      s.shadows.push({ name: fname, file: hit, replaces });
      if (replaces) overridden.push({ name: fname, layerName: s.layerName, file: hit, replaces });
      break;
    }
  }

  // Overlay candidates
  let overlay: OverlayChain['overlay'];
  if (recipe.overlay) {
    const byPath = new Map(project.recipes.map((r) => [r.path, r]));
    overlay = recipe.overlay.candidates.map((p) => {
      const r = byPath.get(p) as Recipe;
      return { layerName: name(r.layer), path: p, pv: r.pv, winner: p === recipe.overlay?.winner };
    });
  }

  // Orphans in the layers involved
  const involved = new Set([
    recipe.layer,
    ...recipe.appends.map((p) => appendByPath.get(p)?.layer),
  ]);
  const orphans = project.appends
    .filter((a) => a.recipes.length === 0 && involved.has(a.layer))
    .map((a) => ({ fileName: a.fileName, path: a.path, layerName: name(a.layer) }));

  return {
    recipe: { pn: recipe.pn, pv: recipe.pv, path: recipe.path, layerName: name(recipe.layer) },
    steps,
    final: {
      srcUriAdded,
      srcUriRemoved,
      filesExtraPaths: searchOrder.flatMap((s) => s.dirs),
      overridden,
    },
    overlay,
    orphans,
    unreadable,
  };
}
