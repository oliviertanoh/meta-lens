// Parse conf/bblayers.conf into a list of layer path entries.

import * as path from 'node:path';
import { evaluate, expand, parseAssignments, splitList } from './bbvars';
import type { Diagnostic } from './model';

export interface BblayersEntry {
  /** Entry as written in BBLAYERS, e.g. `${TOPDIR}/../meta`. */
  raw: string;
  /** Expanded value. Still contains `${...}` when `unresolved` is non-empty. */
  expanded: string;
  /** Absolute normalized path when fully resolved. */
  path?: string;
  unresolved: string[];
}

export interface BblayersResult {
  file: string;
  topdir: string;
  entries: BblayersEntry[];
  diagnostics: Diagnostic[];
}

export interface BblayersOptions {
  /** Extra variables known by the caller (e.g. a guessed OEROOT). */
  vars?: Record<string, string>;
}

/**
 * @param file absolute path of the bblayers.conf (used for TOPDIR and `FILE`).
 */
export function parseBblayers(
  text: string,
  file: string,
  opts: BblayersOptions = {},
): BblayersResult {
  // TOPDIR is the build directory, i.e. the parent of `conf/`.
  const topdir = path.dirname(path.dirname(file));
  const diagnostics: Diagnostic[] = [];
  const store = evaluate(parseAssignments(text), { TOPDIR: topdir, FILE: file, ...opts.vars });

  const rawValue = store.raw('BBLAYERS');
  if (rawValue === undefined) {
    diagnostics.push({ severity: 'warning', message: 'BBLAYERS is not set in this file.', file });
    return { file, topdir, entries: [], diagnostics };
  }

  const line = store.lineOf('BBLAYERS');
  const entries: BblayersEntry[] = [];
  // Split the raw value so each entry is reported as written, then expand it.
  for (const raw of splitList(rawValue)) {
    const exp = expand(raw, store.lookup);
    // A single raw entry may be a variable that expands to several layers.
    for (const piece of splitList(exp.value)) {
      const unresolved = piece.includes('${') ? exp.unresolved : [];
      const entry: BblayersEntry = { raw, expanded: piece, unresolved };
      if (unresolved.length === 0) {
        entry.path = path.resolve(topdir, piece);
      } else {
        diagnostics.push({
          severity: 'warning',
          message: `Cannot resolve ${unresolved.map((u) => '${' + u + '}').join(', ')} in BBLAYERS entry "${raw}".`,
          file,
          line,
        });
      }
      entries.push(entry);
    }
  }
  return { file, topdir, entries, diagnostics };
}
