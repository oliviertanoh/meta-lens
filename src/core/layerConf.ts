// Parse a layer's conf/layer.conf.

import * as path from 'node:path';
import { evaluate, parseAssignments, splitList, type VarStore } from './bbvars';
import type { Diagnostic, LayerDependency } from './model';

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
  diagnostics: Diagnostic[];
}

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

  const bbfiles = splitList(store.get('BBFILES')?.value ?? '');

  return { file, layerDir, collections, bbfiles, diagnostics };
}
