import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { evalPython, evaluate, expand, parseAssignments } from '../../src/core/bbvars';

describe('parseAssignments', () => {
  it('parses every operator', () => {
    const ops = ['=', '?=', '??=', ':=', '+=', '=+', '.=', '=.'];
    const text = ops.map((op, i) => `V${i} ${op} "x"`).join('\n');
    expect(parseAssignments(text).map((a) => a.op)).toEqual(ops);
  });

  it('accepts operators without surrounding spaces', () => {
    const [a] = parseAssignments('A+="x"');
    expect(a).toMatchObject({ name: 'A', op: '+=', value: 'x' });
  });

  it('joins line continuations and keeps the starting line', () => {
    const text = '# comment\nBBLAYERS ?= " \\\n  /a \\\n  /b \\\n  "\nNEXT = "1"';
    const [bbl, next] = parseAssignments(text);
    expect(bbl?.line).toBe(2);
    expect(bbl?.value.split(/\s+/).filter(Boolean)).toEqual(['/a', '/b']);
    expect(next).toMatchObject({ name: 'NEXT', line: 6 });
  });

  it('ignores comments, including comment lines ending with a backslash', () => {
    const text = '# A = "no" \\\nB = "yes"';
    expect(parseAssignments(text).map((a) => a.name)).toEqual(['B']);
  });

  it('handles single quotes, export, flags and override syntax', () => {
    const text = [
      "export A = 'single'",
      'B[doc] = "flag"',
      'FILESEXTRAPATHS:prepend := "${THISDIR}/files:"',
      'BBFILE_PRIORITY_openembedded-layer = "6"',
    ].join('\n');
    const [a, b, f, p] = parseAssignments(text);
    expect(a).toMatchObject({ name: 'A', value: 'single', exported: true });
    expect(b).toMatchObject({ name: 'B', flag: 'doc' });
    expect(f).toMatchObject({ name: 'FILESEXTRAPATHS', override: 'prepend', op: ':=' });
    expect(p).toMatchObject({ name: 'BBFILE_PRIORITY_openembedded-layer', value: '6' });
  });

  it('skips lines that are not assignments', () => {
    expect(parseAssignments('include foo.inc\nrequire bar.inc\ninherit x\n')).toEqual([]);
  });
});

describe('evaluate', () => {
  const run = (text: string, init?: Record<string, string>) =>
    evaluate(parseAssignments(text), init);

  it('applies =, ?=, ??=, +=, =+, .=, =.', () => {
    const s = run(
      [
        'A = "1"',
        'A ?= "ignored"',
        'B ?= "b"',
        'C ??= "weak"',
        'D ??= "weak"',
        'D = "strong"',
        'A += "2"',
        'A =+ "0"',
        'A .= "x"',
        'A =. "y"',
      ].join('\n'),
    );
    expect(s.raw('A')).toBe('y0 1 2x');
    expect(s.raw('B')).toBe('b');
    expect(s.raw('C')).toBe('weak');
    expect(s.raw('D')).toBe('strong');
  });

  it('expands = lazily and := immediately', () => {
    const s = run('X = "1"\nLAZY = "${X}"\nNOW := "${X}"\nX = "2"');
    expect(s.get('LAZY')?.value).toBe('2');
    expect(s.get('NOW')?.value).toBe('1');
  });

  it('applies :append, :prepend and :remove after normal assignments', () => {
    const s = run('L:append = " c"\nL = "a b"\nL:prepend = "z "\nL:remove = "b"');
    expect(s.raw('L')).toBe('z a c');
  });

  it('records the line of the last assignment', () => {
    expect(run('A = "1"\n\nA += "2"').lineOf('A')).toBe(3);
  });
});

describe('expand', () => {
  const vars: Record<string, string> = { TOPDIR: '/b', NESTED: '${TOPDIR}/x' };
  const lookup = (n: string) => vars[n];

  it('expands nested variables', () => {
    expect(expand('${NESTED}/y', lookup)).toEqual({ value: '/b/x/y', unresolved: [] });
  });

  it('keeps unknown variables raw and reports them', () => {
    expect(expand('${OEROOT}/meta', lookup)).toEqual({
      value: '${OEROOT}/meta',
      unresolved: ['OEROOT'],
    });
  });

  it('does not loop on self references', () => {
    const r = expand('${A}', (n) => (n === 'A' ? '${A}' : undefined));
    expect(r.unresolved.length).toBeGreaterThan(0);
  });

  it('evaluates supported inline python after expanding variables inside it', () => {
    const r = expand("${@os.path.abspath('${TOPDIR}/../sources')}", lookup);
    expect(r).toEqual({ value: path.resolve('/b/../sources'), unresolved: [] });
  });

  it('leaves unsupported inline python raw', () => {
    const src = "${@bb.utils.contains('DISTRO_FEATURES', 'x11', 'a', 'b', d)}";
    const r = expand(src, lookup);
    expect(r.value).toBe(src);
    expect(r.unresolved).toEqual(["@bb.utils.contains('DISTRO_FEATURES', 'x11', 'a', 'b', d)"]);
  });
});

describe('evalPython', () => {
  const lookup = (n: string) => (n === 'FILE' ? '/w/build/conf/bblayers.conf' : undefined);

  it('handles the classic BSPDIR idiom', () => {
    const src = "os.path.abspath(os.path.dirname(d.getVar('FILE', True)) + '/../..')";
    expect(evalPython(src, lookup)).toBe(path.resolve('/w'));
  });

  it('handles os.path.join and d.getVar without flag', () => {
    expect(evalPython("os.path.join(d.getVar('FILE'), '..')", lookup)).toBe(
      path.join('/w/build/conf/bblayers.conf', '..'),
    );
  });

  it('returns undefined for unknown variables or syntax', () => {
    expect(evalPython("d.getVar('NOPE')", lookup)).toBeUndefined();
    expect(evalPython('1 + 1', lookup)).toBeUndefined();
    expect(evalPython("'a' 'b'", lookup)).toBeUndefined();
  });
});
