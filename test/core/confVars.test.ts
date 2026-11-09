import * as fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readConfVars, readKasVars } from '../../src/core/confVars';
import { fixture } from './helpers';

const conf = (...p: string[]) => {
  const file = fixture(...p);
  return { file, text: fs.readFileSync(file, 'utf8') };
};

describe('readConfVars', () => {
  it('a hard assignment wins over a later ?= (bsp-custom local.conf)', () => {
    const c = conf('bsp-custom', 'build', 'conf', 'local.conf');
    expect(readConfVars([c], ['MACHINE', 'DISTRO'])).toEqual({
      MACHINE: { value: 'acme-rpi4', file: c.file, line: 3 },
      DISTRO: { value: 'acme-distro', file: c.file, line: 2 },
    });
  });

  it('auto.conf ?= beats a local.conf ??= weak default (poky-mini)', () => {
    const local = conf('poky-mini', 'build', 'conf', 'local.conf');
    const auto = conf('poky-mini', 'build', 'conf', 'auto.conf');
    expect(readConfVars([local, auto], ['MACHINE', 'DISTRO'])).toEqual({
      MACHINE: { value: 'qemuarm64', file: auto.file, line: 2 },
      DISTRO: { value: 'poky', file: local.file, line: 2 },
    });
  });

  it('first ?= wins among soft assignments', () => {
    const r = readConfVars([{ file: '/c', text: 'MACHINE ?= "a"\nMACHINE ?= "b"' }], ['MACHINE']);
    expect(r.MACHINE).toEqual({ value: 'a', file: '/c', line: 1 });
  });

  it('returns undefined for unset or empty variables', () => {
    const r = readConfVars([{ file: '/c', text: 'DISTRO = ""' }], ['MACHINE', 'DISTRO']);
    expect(r).toEqual({ MACHINE: undefined, DISTRO: undefined });
  });
});

describe('readKasVars', () => {
  it('reads top-level machine and distro', () => {
    const c = conf('kas-project', 'kas', 'project.yml');
    expect(readKasVars(c.text, c.file, ['machine', 'distro'])).toEqual({
      machine: { value: 'qemuarm64', file: c.file, line: 4 },
      distro: { value: 'poky', file: c.file, line: 5 },
    });
  });

  it('handles quotes and comments, ignores nested keys', () => {
    const text = 'repos:\n  machine: nested\nmachine: "rpi4" # board\ndistro:\n';
    expect(readKasVars(text, '/k.yml', ['machine', 'distro'])).toEqual({
      machine: { value: 'rpi4', file: '/k.yml', line: 3 },
      distro: undefined,
    });
  });
});
