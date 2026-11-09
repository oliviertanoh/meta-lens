// Light reader for MACHINE / DISTRO, from local.conf (+ auto.conf) or a kas file.

import type { Assignment } from './bbvars';
import { evaluate, parseAssignments } from './bbvars';
import type { ConfValue } from './model';

export type { ConfValue };

export interface ConfFile {
  file: string;
  text: string;
}

/**
 * Evaluate `names` across conf files read in order (later files win, like
 * BitBake reading local.conf then auto.conf). Returns the final value and
 * the assignment that produced it:
 * the last hard assignment (`=`, `:=`), else the first `?=`, else the last `??=`.
 */
export function readConfVars(
  files: ConfFile[],
  names: readonly string[],
): Record<string, ConfValue | undefined> {
  const all: (Assignment & { file: string })[] = files.flatMap(({ file, text }) =>
    parseAssignments(text).map((a) => ({ ...a, file })),
  );
  const store = evaluate(all);
  const out: Record<string, ConfValue | undefined> = {};
  for (const name of names) {
    const value = store.get(name)?.value.trim();
    if (!value) {
      out[name] = undefined;
      continue;
    }
    const mine = all.filter((a) => a.name === name && !a.flag && !a.override);
    const winner =
      mine.filter((a) => a.op === '=' || a.op === ':=').pop() ??
      mine.find((a) => a.op === '?=') ??
      mine.filter((a) => a.op === '??=').pop() ??
      mine[mine.length - 1];
    out[name] = winner ? { value, file: winner.file, line: winner.line } : undefined;
  }
  return out;
}

/** Top-level scalar keys of a kas file (`machine:`, `distro:`), without a YAML parser. */
export function readKasVars(
  text: string,
  file: string,
  keys: readonly string[],
): Record<string, ConfValue | undefined> {
  const out: Record<string, ConfValue | undefined> = {};
  const lines = text.split(/\r?\n/);
  for (const key of keys) {
    out[key] = undefined;
    const re = new RegExp(`^${key}:\\s*(['"]?)([^'"#\\s]+)\\1\\s*(#.*)?$`);
    lines.forEach((l, i) => {
      const m = re.exec(l);
      if (m?.[2]) out[key] = { value: m[2], file, line: i + 1 };
    });
  }
  return out;
}
