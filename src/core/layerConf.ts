// Parse a layer's conf/layer.conf.

import * as path from 'node:path';
import {
  evaluate,
  expand,
  parseAssignments,
  splitList,
  stripInlinePython,
  type VarStore,
} from './bbvars';
import type { Diagnostic, DynamicBbfiles, LayerDependency } from './model';

export interface CollectionInfo {
  name: string;
  priority?: number;
  depends: LayerDependency[];
  /** Line of the LAYERDEPENDS assignment, for diagnostics. */
  dependsLine?: number;
  seriesCompat: string[];
}

export interface LayerConfInfo {
  file: string;
  layerDir: string;
  collections: CollectionInfo[];
  bbfiles: string[];
  bbfilesDynamic: DynamicBbfiles[];
  bbfilesPerCollection: string[];
  diagnostics: Diagnostic[];
}

/**
 * `${@' '.join('<template>' % x for x in BBFILE_COLLECTIONS.split())}`: one
 * BBFILES pattern per loaded collection (idiom used by meta-raspberrypi).
 */
const PER_COLLECTION_RE =
  /\$\{@\s*(['"])\s*\1\s*\.join\(\s*(['"])(.*?)\2\s*%\s*(\w+)\s+for\s+\4\s+in\s+(?:BBFILE_COLLECTIONS|d\.getVar\(\s*['"]BBFILE_COLLECTIONS['"]\s*\))\.split\(\)\s*\)\s*\}/g;

/** Read `NAME_<collection>`, falling back to the override form `NAME:<collection>`. */
function collVar(store: VarStore, base: string, coll: string) {
  const key = store.raw(`${base}_${coll}`) !== undefined ? `${base}_${coll}` : `${base}:${coll}`;
  return { value: store.get(key), line: store.lineOf(key) };
}

/**
 * Parse LAYERDEPENDS: `core openembedded-layer:4 meta-python (>= 3)`.
 * Version constraints in parentheses are attached to the preceding name.
 */
export function parseDepends(value: string): LayerDependency[] {
  const deps: LayerDependency[] = [];
  const re = /([^\s()]+)(?:\s*\(([^)]*)\))?/g;
  for (const m of value.matchAll(re)) {
    const tok = m[1] ?? '';
    const paren = m[2]?.trim();
    const colon = tok.indexOf(':');
    if (colon > 0) {
      deps.push({ collection: tok.slice(0, colon), version: tok.slice(colon + 1) });
    } else {
      deps.push(paren ? { collection: tok, version: paren } : { collection: tok });
    }
  }
  return deps;
}

/**
 * @param file absolute path of the layer.conf. LAYERDIR is `dirname(dirname(file))`.
 */
export function parseLayerConf(text: string, file: string): LayerConfInfo {
  const layerDir = path.dirname(path.dirname(file));
  const diagnostics: Diagnostic[] = [];
  const store = evaluate(parseAssignments(text), { LAYERDIR: layerDir, FILE: file });

  const names = splitList(store.get('BBFILE_COLLECTIONS')?.value ?? '');
  if (names.length === 0) {
    diagnostics.push({
      severity: 'warning',
      message: 'BBFILE_COLLECTIONS is not set: this layer has no collection name.',
      file,
    });
  }

  const collections: CollectionInfo[] = names.map((name) => {
    const info: CollectionInfo = { name, depends: [], seriesCompat: [] };

    const prio = collVar(store, 'BBFILE_PRIORITY', name);
    if (prio.value === undefined) {
      diagnostics.push({
        severity: 'warning',
        message: `BBFILE_PRIORITY_${name} is not set.`,
        file,
      });
    } else if (/^-?\d+$/.test(prio.value.value.trim())) {
      info.priority = Number(prio.value.value.trim());
    } else {
      diagnostics.push({
        severity: 'warning',
        message: `BBFILE_PRIORITY_${name} is not a number: "${prio.value.value}".`,
        file,
        line: prio.line,
      });
    }

    const deps = collVar(store, 'LAYERDEPENDS', name);
    if (deps.value) {
      info.depends = parseDepends(deps.value.value).filter((d) => !d.collection.includes('${'));
      info.dependsLine = deps.line;
    }

    const compat = collVar(store, 'LAYERSERIES_COMPAT', name);
    if (compat.value) {
      info.seriesCompat = splitList(compat.value.value).filter((s) => !s.includes('${'));
    } else {
      diagnostics.push({
        severity: 'info',
        message: `LAYERSERIES_COMPAT_${name} is not set.`,
        file,
      });
    }
    return info;
  });

  // BBFILES: handle the per-collection idiom, then drop any other inline Python.
  const bbfilesPerCollection: string[] = [];
  const rawBbfiles = (store.raw('BBFILES') ?? '').replace(PER_COLLECTION_RE, (_m, _q, _q2, tpl) => {
    bbfilesPerCollection.push(expand(tpl as string, store.lookup).value);
    return ' ';
  });
  const stripped = stripInlinePython(expand(rawBbfiles, store.lookup).value);
  const bbfiles = splitList(stripped.value).filter((p) => !p.includes('${'));
  if (stripped.removed.length > 0) {
    diagnostics.push({
      severity: 'warning',
      message: `BBFILES uses inline Python that meta-lens cannot evaluate (${stripped.removed[0]}); some recipes of this layer may be missing.`,
      file,
      line: store.lineOf('BBFILES'),
    });
  }

  const bbfilesDynamic: DynamicBbfiles[] = [];
  for (const entry of splitList(store.get('BBFILES_DYNAMIC')?.value ?? '')) {
    const colon = entry.indexOf(':');
    if (colon <= 0) {
      diagnostics.push({
        severity: 'warning',
        message: `BBFILES_DYNAMIC entry must be "{!}<collection>:<pattern>", not "${entry}".`,
        file,
        line: store.lineOf('BBFILES_DYNAMIC'),
      });
      continue;
    }
    const negate = entry.startsWith('!');
    bbfilesDynamic.push({
      collection: entry.slice(negate ? 1 : 0, colon),
      negate,
      pattern: entry.slice(colon + 1),
    });
  }

  return {
    file,
    layerDir,
    collections,
    bbfiles,
    bbfilesDynamic,
    bbfilesPerCollection,
    diagnostics,
  };
}
