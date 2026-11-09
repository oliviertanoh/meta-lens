// HTML of the OVERLAY CHAIN panel. Pure string functions, unit-tested.

import type { OverlayChain } from '../core/overlayChain';
import { esc } from './render';

type Rel = (file: string) => string;

const icon = (name: string, cls = '') => `<span class="codicon codicon-${name} ${cls}"></span>`;
const link = (file: string, label: string, line?: number) =>
  `<a class="file-link" href="#" data-file="${esc(file)}"${line ? ` data-line="${line}"` : ''}>${esc(label)}</a>`;
/** `file` relative to the folder of `recipe` when it is below it (files/defconfig). */
function nextTo(recipe: string, file: string): string {
  const dir = recipe.replace(/[\\/][^\\/]*$/, '');
  return file.startsWith(dir) ? file.slice(dir.length + 1).replace(/\\/g, '/') : file;
}

const fileName = (entry: string) => entry.replace(/^file:\/\//, '').split(';')[0] ?? entry;

export function renderChain(c: OverlayChain, rel: Rel): string {
  const parts: string[] = [];
  parts.push(
    `<header><span class="title">Overlay chain</span><span class="sep">·</span>` +
      `<span class="pn">${esc(c.recipe.pn)}</span>` +
      (c.recipe.pv ? `<span class="muted">${esc(c.recipe.pv)}</span>` : '') +
      `</header>`,
  );

  // Timeline
  parts.push('<ol class="timeline">');
  for (const s of c.steps) {
    const base = s.kind === 'base';
    const lines = s.lines.length
      ? `<div class="code">${s.lines
          .map(
            (l) =>
              `<a class="code-line${l.legacy ? ' legacy' : ''}" href="#" data-file="${esc(s.file)}" data-line="${l.line}" title="Line ${l.line}${l.legacy ? ': legacy _append/_prepend/_remove syntax, use :append/:prepend/:remove' : ''}">${esc(l.text)}</a>`,
          )
          .join('')}</div>`
      : '';
    const shadows = s.shadows
      .map((f) =>
        f.replaces
          ? `<div class="shadow" title="${esc(`${rel(f.file)}\nreplaces ${rel(f.replaces)}`)}">${icon('arrow-right')}<span>overrides ${link(f.file, nextTo(c.recipe.path, f.replaces))}</span></div>`
          : `<div class="shadow" title="${esc(rel(f.file))}">${icon('add')}<span>adds ${link(f.file, f.name)}</span></div>`,
      )
      .join('');
    const legacyNote = s.lines.some((l) => l.legacy)
      ? `<div class="legacy-note">${icon('warning')} Legacy override syntax: use <code>:append</code> instead of <code>_append</code>.</div>`
      : '';
    parts.push(
      `<li class="step ${base ? 'base' : 'append'}">` +
        `<div class="step-head"><span class="layer">${esc(s.layerName)}</span>` +
        (s.priority !== undefined ? `<span class="pill">prio ${s.priority}</span>` : '') +
        `<span class="grow"></span><span class="kind">${base ? 'base recipe' : 'bbappend'}</span></div>` +
        `<div class="path">${link(s.file, rel(s.file))}</div>` +
        lines +
        shadows +
        legacyNote +
        `</li>`,
    );
  }
  parts.push('</ol>');

  // Final values
  const f = c.final;
  const rows: string[] = [];
  if (f.srcUriAdded.length || f.srcUriRemoved.length) {
    rows.push(
      `<div class="key">SRC_URI</div><div class="val">${[
        ...f.srcUriAdded.map((e) => `+ ${esc(fileName(e))}`),
        ...f.srcUriRemoved.map((e) => `- ${esc(fileName(e))}`),
      ].join(', ')}</div>`,
    );
  }
  if (f.filesExtraPaths.length) {
    rows.push(
      `<div class="key">FILESEXTRAPATHS</div><div class="val">${f.filesExtraPaths.map((d) => esc(rel(d))).join('<br>')}</div>`,
    );
  }
  for (const o of f.overridden) {
    rows.push(
      `<div class="key">${esc(o.name)}</div><div class="val">overridden by ${esc(o.layerName)}</div>`,
    );
  }
  if (rows.length) {
    parts.push(`<section><h2>Final values</h2><div class="final">${rows.join('')}</div></section>`);
  } else if (c.steps.length === 1) {
    parts.push('<p class="muted">No bbappend: the recipe is used as is.</p>');
  }

  // Overlay: one row per candidate, the one BitBake uses marked with a check.
  if (c.overlay) {
    parts.push(
      `<section><h2>Overlayed</h2>` +
        `<p class="note">Same recipe in ${c.overlay.length} layers. BitBake uses the one with the highest layer priority, then the highest version.</p>` +
        `<ul class="rows">` +
        c.overlay
          .map(
            (o) =>
              `<li class="${o.winner ? 'used' : 'unused'}">${o.winner ? icon('check', 'ok') : icon('circle-small', 'muted')}` +
              `<span class="row-main">${link(o.path, `${o.layerName}${o.pv ? ` ${o.pv}` : ''}`)}</span>` +
              `<span class="row-side">${o.winner ? 'used' : 'ignored'}</span></li>`,
          )
          .join('') +
        `</ul></section>`,
    );
  }

  // Orphans: same list style, only the icon is colored.
  if (c.orphans.length) {
    parts.push(
      `<section><h2>Orphan bbappends</h2><ul class="rows">` +
        c.orphans
          .map(
            (o) =>
              `<li>${icon('warning', 'warn')}<span class="row-main">${link(o.path, o.fileName)}</span>` +
              `<span class="row-side">${esc(o.layerName)} · no matching recipe version</span></li>`,
          )
          .join('') +
        `</ul></section>`,
    );
  }

  if (c.unreadable.length) {
    parts.push(
      `<p class="muted">Could not read: ${c.unreadable.map((u) => esc(rel(u))).join(', ')}</p>`,
    );
  }
  return parts.join('');
}
