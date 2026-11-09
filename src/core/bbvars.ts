// Minimal BitBake assignment parser and variable expander.
//
// This is NOT a BitBake parser. It understands the subset of syntax found in
// bblayers.conf / layer.conf / local.conf: plain assignments with the usual
// operators, line continuations, comments, `:append` / `:prepend` / `:remove`
// overrides, `${VAR}` expansion and a tiny safe subset of `${@...}` inline
// Python (os.path.* and d.getVar). Anything else is left as raw text and
// reported as unresolved, never thrown.

import * as path from 'node:path';

export type AssignOp = '=' | '?=' | '??=' | ':=' | '+=' | '=+' | '.=' | '=.';

export interface Assignment {
  /** Variable name without override suffix, e.g. `BBLAYERS`. */
  name: string;
  /** `append` / `prepend` / `remove` when written as `NAME:append`. */
  override?: 'append' | 'prepend' | 'remove';
  /** Variable flag, e.g. `doc` in `VAR[doc] = "..."`. */
  flag?: string;
  op: AssignOp;
  /** Unquoted raw value (continuations joined with a space). */
  value: string;
  /** 1-based line where the assignment starts. */
  line: number;
  exported: boolean;
}

const ASSIGN_RE =
  /^(export\s+)?([A-Za-z0-9_\-.+/~${}]+?)(?::(append|prepend|remove))?(\[[A-Za-z0-9_\-.]+\])?\s*(\?\?=|\?=|:=|\+=|=\+|\.=|=\.|=)\s*(.*)$/s;

/** Join `\` continuations and drop comments, keeping the starting line number. */
function logicalLines(text: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  const raw = text.split(/\r?\n/);
  let buf: string | undefined;
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    const cur = raw[i] ?? '';
    if (buf === undefined) {
      // A comment line is a comment even if it ends with `\` (BitBake warns about it).
      if (/^\s*#/.test(cur)) continue;
      buf = '';
      start = i + 1;
    }
    const trimmedEnd = cur.replace(/\s+$/, '');
    if (trimmedEnd.endsWith('\\')) {
      buf += trimmedEnd.slice(0, -1) + ' ';
      continue;
    }
    buf += cur;
    out.push({ text: buf, line: start });
    buf = undefined;
  }
  if (buf !== undefined) out.push({ text: buf, line: start });
  return out;
}

function unquote(raw: string): string {
  const v = raw.trim();
  const q = v[0];
  if (q === '"' || q === "'") {
    const end = v.lastIndexOf(q);
    if (end > 0) return v.slice(1, end);
    return v.slice(1);
  }
  // Unquoted values are invalid BitBake, but be lenient: strip a trailing comment.
  return v.replace(/\s+#.*$/, '');
}

export function parseAssignments(text: string): Assignment[] {
  const result: Assignment[] = [];
  for (const { text: l, line } of logicalLines(text)) {
    const m = ASSIGN_RE.exec(l.trim());
    if (!m) continue;
    const [, exp, name, override, flag, op, value] = m;
    if (!name || !op) continue;
    result.push({
      name,
      override: override as Assignment['override'],
      flag: flag ? flag.slice(1, -1) : undefined,
      op: op as AssignOp,
      value: unquote(value ?? ''),
      line,
      exported: !!exp,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Expansion

export interface Expanded {
  value: string;
  /** Variable names (or `@expr`) that could not be resolved; left as raw text. */
  unresolved: string[];
}

export type Lookup = (name: string) => string | undefined;

const MAX_DEPTH = 20;

/** Find the index of the `}` closing a `${` that starts at `start`. */
function findClose(s: string, start: number): number {
  let depth = 0;
  let quote: string | undefined;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = undefined;
      continue;
    }
    if (c === "'" || c === '"') {
      // Quotes only matter inside inline Python.
      if (s[start + 2] === '@') quote = c;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export function expand(value: string, lookup: Lookup, depth = 0): Expanded {
  const unresolved: string[] = [];
  if (depth > MAX_DEPTH) return { value, unresolved: ['<recursion>'] };
  let out = '';
  let i = 0;
  while (i < value.length) {
    const at = value.indexOf('${', i);
    if (at < 0) {
      out += value.slice(i);
      break;
    }
    out += value.slice(i, at);
    const close = findClose(value, at);
    if (close < 0) {
      out += value.slice(at);
      break;
    }
    const inner = value.slice(at + 2, close);
    const raw = value.slice(at, close + 1);
    if (inner.startsWith('@')) {
      // Expand ${VAR} references inside the expression first, like BitBake does.
      const pre = expand(inner.slice(1), lookup, depth + 1);
      const res = pre.unresolved.length === 0 ? evalPython(pre.value, lookup) : undefined;
      if (res === undefined) {
        out += raw;
        unresolved.push('@' + inner.slice(1).trim());
      } else {
        out += res;
      }
    } else if (/^[A-Za-z0-9_\-.:+/~]+$/.test(inner)) {
      const v = lookup(inner);
      if (v === undefined) {
        out += raw;
        unresolved.push(inner);
      } else {
        const sub = expand(v, lookup, depth + 1);
        out += sub.value;
        unresolved.push(...sub.unresolved);
      }
    } else {
      out += raw;
      unresolved.push(inner);
    }
    i = close + 1;
  }
  return { value: out, unresolved: [...new Set(unresolved)] };
}

// ---------------------------------------------------------------------------
// Tiny inline-Python evaluator.
//
// Grammar (enough for the classic BSPDIR / OEROOT idioms):
//   expr  := term ('+' term)*
//   term  := STRING | call
//   call  := 'os.path.abspath(' expr ')' | 'os.path.dirname(' expr ')'
//          | 'os.path.realpath(' expr ')' | 'os.path.normpath(' expr ')'
//          | 'os.path.join(' expr (',' expr)* ')'
//          | 'd.getVar(' STRING (',' ('True'|'1'|'False'|'0'))? ')'
// Returns undefined for anything else.

class Unsupported extends Error {}

export function evalPython(src: string, lookup: Lookup): string | undefined {
  let pos = 0;
  const ws = () => {
    while (pos < src.length && /\s/.test(src[pos] ?? '')) pos++;
  };
  const eat = (tok: string): boolean => {
    ws();
    if (src.startsWith(tok, pos)) {
      pos += tok.length;
      return true;
    }
    return false;
  };
  const expect = (tok: string) => {
    if (!eat(tok)) throw new Unsupported(tok);
  };
  const str = (): string | undefined => {
    ws();
    const q = src[pos];
    if (q !== '"' && q !== "'") return undefined;
    const end = src.indexOf(q, pos + 1);
    if (end < 0) throw new Unsupported('string');
    const s = src.slice(pos + 1, end);
    pos = end + 1;
    return s;
  };
  const args = (): string[] => {
    const list = [expr()];
    while (eat(',')) list.push(expr());
    expect(')');
    return list;
  };
  const one = (fn: (a: string) => string): string => {
    const a = args();
    if (a.length !== 1) throw new Unsupported('arity');
    return fn(a[0] as string);
  };
  const term = (): string => {
    const s = str();
    if (s !== undefined) return s;
    if (eat('os.path.abspath(')) return one((a) => path.resolve(a));
    if (eat('os.path.realpath(')) return one((a) => path.resolve(a));
    if (eat('os.path.normpath(')) return one((a) => path.normalize(a));
    if (eat('os.path.dirname(')) return one((a) => path.dirname(a));
    if (eat('os.path.join(')) return path.join(...args());
    if (eat('d.getVar(')) {
      const name = str();
      if (name === undefined) throw new Unsupported('getVar');
      if (eat(',')) {
        ws();
        const m = /^(True|False|1|0)/.exec(src.slice(pos));
        if (!m) throw new Unsupported('getVar flag');
        pos += m[0].length;
      }
      expect(')');
      const v = lookup(name);
      if (v === undefined) throw new Unsupported(name);
      const e = expand(v, lookup);
      if (e.unresolved.length) throw new Unsupported(name);
      return e.value;
    }
    throw new Unsupported(src.slice(pos));
  };
  const expr = (): string => {
    let v = term();
    while (eat('+')) v += term();
    return v;
  };
  try {
    const v = expr();
    ws();
    return pos === src.length ? v : undefined;
  } catch (e) {
    if (e instanceof Unsupported) return undefined;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Evaluation of a whole file

export interface VarStore {
  /** Raw (unexpanded) value of a variable after applying every assignment. */
  raw(name: string): string | undefined;
  /** Expanded value. */
  get(name: string): Expanded | undefined;
  lookup: Lookup;
  /** Line of the last assignment that touched `name`. */
  lineOf(name: string): number | undefined;
}

/**
 * Apply assignments in order, BitBake-style:
 * `=` lazy set, `:=` immediate, `?=` set if unset, `??=` weak default,
 * `+=`/`=+` with a space, `.=`/`=.` without, `:append`/`:prepend`/`:remove`
 * applied at the end.
 */
export function evaluate(
  assignments: Assignment[],
  initial: Record<string, string> = {},
): VarStore {
  const vars = new Map<string, string>(Object.entries(initial));
  const weak = new Map<string, string>();
  const lines = new Map<string, number>();
  const overrides: Assignment[] = [];

  const lookup: Lookup = (name) => vars.get(name) ?? weak.get(name);

  for (const a of assignments) {
    if (a.flag) continue;
    if (a.override) {
      overrides.push(a);
      lines.set(a.name, a.line);
      continue;
    }
    const cur = vars.get(a.name);
    lines.set(a.name, a.line);
    switch (a.op) {
      case '=':
        vars.set(a.name, a.value);
        break;
      case ':=':
        vars.set(a.name, expand(a.value, lookup).value);
        break;
      case '?=':
        if (cur === undefined) vars.set(a.name, a.value);
        break;
      case '??=':
        weak.set(a.name, a.value);
        break;
      case '+=':
        vars.set(a.name, cur === undefined ? a.value : `${cur} ${a.value}`);
        break;
      case '=+':
        vars.set(a.name, cur === undefined ? a.value : `${a.value} ${cur}`);
        break;
      case '.=':
        vars.set(a.name, (cur ?? '') + a.value);
        break;
      case '=.':
        vars.set(a.name, a.value + (cur ?? ''));
        break;
    }
  }

  for (const a of overrides) {
    const cur = lookup(a.name) ?? '';
    if (a.override === 'append') vars.set(a.name, cur + a.value);
    else if (a.override === 'prepend') vars.set(a.name, a.value + cur);
    else {
      const drop = new Set(a.value.split(/\s+/).filter(Boolean));
      vars.set(
        a.name,
        cur
          .split(/\s+/)
          .filter((w) => w && !drop.has(w))
          .join(' '),
      );
    }
  }

  return {
    raw: lookup,
    lookup,
    get(name) {
      const v = lookup(name);
      return v === undefined ? undefined : expand(v, lookup);
    },
    lineOf: (name) => lines.get(name),
  };
}

/** Split a whitespace-separated BitBake list value. */
export function splitList(value: string): string[] {
  return value.split(/\s+/).filter(Boolean);
}
