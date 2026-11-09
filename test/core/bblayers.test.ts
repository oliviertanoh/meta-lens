import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseBblayers } from '../../src/core/bblayers';
import { fixture } from './helpers';

describe('parseBblayers', () => {
  it('expands ${TOPDIR} in a multi-line BBLAYERS (poky-mini)', () => {
    const file = fixture('poky-mini', 'build', 'conf', 'bblayers.conf');
    const r = parseBblayers(fs.readFileSync(file, 'utf8'), file);
    expect(r.topdir).toBe(fixture('poky-mini', 'build'));
    expect(r.entries.map((e) => e.path)).toEqual([
      fixture('poky-mini', 'meta'),
      fixture('poky-mini', 'meta-poky'),
    ]);
    expect(r.diagnostics).toEqual([]);
  });

  it('resolves BSPDIR from inline python, += and :append (bsp-custom)', () => {
    const file = fixture('bsp-custom', 'build', 'conf', 'bblayers.conf');
    const r = parseBblayers(fs.readFileSync(file, 'utf8'), file);
    const src = (p: string) => fixture('bsp-custom', 'sources', p);
    expect(r.entries.map((e) => e.path)).toEqual([
      src('poky/meta'),
      src('poky/meta-poky'),
      src('meta-acme-bsp'),
      path.resolve('/home/builder/bsp/sources/meta-openembedded/meta-oe'),
      src('meta-qt6'),
      src('meta-acme'),
    ]);
  });

  it('warns on unresolvable variables without throwing', () => {
    const file = '/w/build/conf/bblayers.conf';
    const r = parseBblayers('BBLAYERS = "${OEROOT}/meta ${TOPDIR}/../meta-x"', file);
    expect(r.entries[0]).toMatchObject({ raw: '${OEROOT}/meta', unresolved: ['OEROOT'] });
    expect(r.entries[0]?.path).toBeUndefined();
    expect(r.entries[1]?.path).toBe(path.resolve('/w/meta-x'));
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]?.message).toContain('${OEROOT}');
    expect(r.diagnostics[0]?.line).toBe(1);
  });

  it('accepts extra variables from the caller', () => {
    const r = parseBblayers('BBLAYERS = "${OEROOT}/meta"', '/w/build/conf/bblayers.conf', {
      vars: { OEROOT: '/poky' },
    });
    expect(r.entries[0]?.path).toBe(path.resolve('/poky/meta'));
  });

  it('reports a missing BBLAYERS', () => {
    const r = parseBblayers('BBPATH = "${TOPDIR}"', '/w/build/conf/bblayers.conf');
    expect(r.entries).toEqual([]);
    expect(r.diagnostics[0]?.severity).toBe('warning');
  });
});
