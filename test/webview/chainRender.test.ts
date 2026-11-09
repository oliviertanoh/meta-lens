import * as path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildOverlayChain, type OverlayChain } from '../../src/core/overlayChain';
import { loadProject } from '../../src/core/project';
import { renderChain } from '../../src/webview/chainRender';
import { fixture } from '../core/helpers';

const root = fixture('bsp-custom');
const rel = (f: string) => path.relative(root, f);
const text = (html: string) =>
  html
    .replace(/<(li|div|p|header|h2)[^>]*>/g, '|')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);

let busybox: OverlayChain;
let openssh: OverlayChain;
let htop: OverlayChain;
beforeAll(async () => {
  const p = await loadProject(root);
  const by = (pn: string, layer = '') =>
    p.recipes.find((r) => r.pn === pn && r.layer.endsWith(layer))!.path;
  busybox = (await buildOverlayChain(p, by('busybox')))!;
  openssh = (await buildOverlayChain(p, by('openssh', 'meta')))!;
  htop = (await buildOverlayChain(p, by('htop')))!;
});

describe('renderChain', () => {
  it('busybox: timeline, final values, orphan box', () => {
    const rows = text(renderChain(busybox, rel));
    expect(rows[0]).toBe('Overlay chain · busybox 1.36.1');
    expect(rows).toContain('meta prio 5 base recipe');
    expect(rows).toContain('meta-acme-bsp prio 10 bbappend');
    expect(rows).toContain('overrides files/defconfig');
    expect(rows).toContain('adds acme.cfg');
    expect(rows).toContain('Legacy override syntax: use :append instead of _append .');
    expect(rows).toContain('Final values');
    expect(rows.join(' ')).toContain('SRC_URI + acme.cfg, + syslog-acme.patch');
    expect(rows.join(' ')).toContain('defconfig overridden by meta-acme-bsp');
    expect(rows.slice(-2)).toEqual([
      'Orphan bbappends',
      'psplash_1.2.bbappend meta-acme · no matching recipe version',
    ]);
  });

  it('every line links to its file and line', () => {
    const html = renderChain(busybox, rel);
    expect(html).toMatch(/class="code-line legacy"[^>]*data-line="1"/);
    expect(html.match(/data-file=/g)!.length).toBeGreaterThan(8);
  });

  it('openssh: overlay box with the winner', () => {
    const rows = text(renderChain(openssh, rel));
    expect(rows).toContain('Overlayed');
    expect(rows.join(' ')).toContain('meta-acme 9.6p1 used');
    expect(rows.join(' ')).toContain('meta 9.6p1 ignored');
    expect(rows).toContain('No bbappend: the recipe is used as is.');
  });

  it('htop: dynamic-layer bbappend, nothing to override', () => {
    const rows = text(renderChain(htop, rel));
    expect(rows).toContain('meta-acme-bsp prio 10 bbappend');
    expect(rows).not.toContain('Final values');
  });

  it('no colored boxes: lists with colored icons only', () => {
    const html = renderChain(busybox, rel) + renderChain(openssh, rel);
    expect(html).not.toContain('class="box');
  });

  it('no em dash', () => {
    expect(renderChain(busybox, rel) + renderChain(openssh, rel)).not.toContain('—');
  });
});
