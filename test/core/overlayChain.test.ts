import * as path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Project } from '../../src/core/model';
import { buildOverlayChain, fileEntries, type OverlayChain } from '../../src/core/overlayChain';
import { loadProject } from '../../src/core/project';
import { fixture } from './helpers';

const src = (...p: string[]) => fixture('bsp-custom', 'sources', ...p);

describe('fileEntries', () => {
  it('keeps file:// names without parameters', () => {
    expect(fileEntries('https://x/y.tar.gz file://a.cfg file://p/b.patch;striplevel=2')).toEqual([
      'a.cfg',
      'p/b.patch',
    ]);
  });
});

describe('buildOverlayChain (busybox, bsp-custom)', () => {
  let p: Project;
  let c: OverlayChain;
  beforeAll(async () => {
    p = await loadProject(fixture('bsp-custom'));
    const busybox = p.recipes.find((r) => r.pn === 'busybox')!;
    c = (await buildOverlayChain(p, busybox.path))!;
  });

  it('base recipe then bbappends in application order', () => {
    expect(c.steps.map((s) => [s.kind, s.layerName, s.priority])).toEqual([
      ['base', 'meta', 5],
      ['append', 'meta-acme-bsp', 10],
      ['append', 'meta-acme', 10],
    ]);
  });

  it('shows the interesting lines, legacy _append flagged', () => {
    expect(c.steps[0]!.lines.map((l) => l.text)).toEqual([
      'SUMMARY = "Tiny versions of many common UNIX utilities"',
      'SRC_URI = "https://busybox.net/downloads/busybox-${PV}.tar.bz2 file://defconfig"',
    ]);
    expect(c.steps[1]!.lines).toEqual([
      { line: 1, text: 'FILESEXTRAPATHS:prepend := "${THISDIR}/files:"' },
      { line: 2, text: 'SRC_URI += "file://acme.cfg"' },
    ]);
    expect(c.steps[2]!.lines).toEqual([
      { line: 1, text: 'SRC_URI_append = "file://syslog-acme.patch"', legacy: true },
    ]);
  });

  it('meta-acme-bsp overrides defconfig and adds acme.cfg', () => {
    const bspFiles = src('meta-acme-bsp', 'recipes-core', 'busybox', 'files');
    expect(c.steps[1]!.shadows).toEqual([
      {
        name: 'defconfig',
        file: path.join(bspFiles, 'defconfig'),
        replaces: src('poky', 'meta', 'recipes-core', 'busybox', 'files', 'defconfig'),
      },
      { name: 'acme.cfg', file: path.join(bspFiles, 'acme.cfg'), replaces: undefined },
    ]);
    expect(c.final.overridden.map((o) => [o.name, o.layerName])).toEqual([
      ['defconfig', 'meta-acme-bsp'],
    ]);
  });

  it('final values', () => {
    expect(c.final.srcUriAdded).toEqual(['file://acme.cfg', 'file://syslog-acme.patch']);
    expect(c.final.srcUriRemoved).toEqual([]);
    expect(c.final.filesExtraPaths).toEqual([
      src('meta-acme-bsp', 'recipes-core', 'busybox', 'files'),
    ]);
  });

  it('orphans of the layers involved', () => {
    expect(c.orphans.map((o) => [o.fileName, o.layerName])).toEqual([
      ['psplash_1.2.bbappend', 'meta-acme'],
    ]);
  });

  it('no overlay for busybox, nothing unreadable', () => {
    expect(c.overlay).toBeUndefined();
    expect(c.unreadable).toEqual([]);
  });
});

describe('buildOverlayChain (openssh overlay)', () => {
  it('lists the candidates, winner first', async () => {
    const p = await loadProject(fixture('bsp-custom'));
    const ssh = p.recipes.find((r) => r.pn === 'openssh' && r.layer.endsWith('meta'))!;
    const c = (await buildOverlayChain(p, ssh.path))!;
    expect(c.overlay?.map((o) => [o.layerName, o.winner])).toEqual([
      ['meta-acme', true],
      ['meta', false],
    ]);
    expect(c.steps).toHaveLength(1);
  });

  it('unknown recipe → undefined', async () => {
    const p = await loadProject(fixture('bsp-custom'));
    expect(await buildOverlayChain(p, '/nope.bb')).toBeUndefined();
  });
});
