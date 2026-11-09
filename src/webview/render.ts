// HTML rendering of the sidebar. Pure string functions (no DOM), unit-tested.

import type { BbAppend, Recipe } from '../core/model';
import {
  buildRecipeTree,
  scopeOf,
  type RecipeFilter,
  type RecipeKind,
  type RecipeScope,
  type RecipeTree,
} from '../core/recipeTree';
import type { LayerVM, Link, NoteVM, ProjectRowVM, SidebarModel } from '../core/sidebarModel';

export interface UiState {
  filter: RecipeFilter;
  /** Explicit open/closed state per key; missing key → default. */
  open: Record<string, boolean>;
}

export const DEFAULT_STATE: UiState = { filter: { scope: 'project' }, open: {} };

/** Categories start expanded when the list is short or a text filter is active. */
export const AUTO_EXPAND_LIMIT = 60;

export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const icon = (name: string, cls = '') => `<span class="codicon codicon-${name} ${cls}"></span>`;

const openAttrs = (l: Link | undefined) =>
  l ? ` data-file="${esc(l.file)}"${l.line ? ` data-line="${l.line}"` : ''}` : '';

const titleAttr = (t: string | undefined) => (t ? ` title="${esc(t)}"` : '');

export function isOpen(state: UiState, key: string, byDefault: boolean): boolean {
  return state.open[key] ?? byDefault;
}

function twisty(open: boolean): string {
  return icon(open ? 'chevron-down' : 'chevron-right', 'twisty');
}

export function sectionHeader(key: string, label: string, count: string, open: boolean): string {
  return (
    `<div class="section-header" role="button" tabindex="0" data-toggle="${esc(key)}" aria-expanded="${open}">` +
    `${twisty(open)}<span class="section-title">${esc(label)}</span>` +
    `<span class="grow"></span><span class="section-count">${esc(count)}</span></div>`
  );
}

// ---------------------------------------------------------------------------
// PROJECT

function projectRow(r: ProjectRowVM): string {
  const value =
    `<span class="value${r.tone ? ` tone-${r.tone}` : ''}">${esc(r.value)}</span>` +
    (r.warning ? icon('warning', 'warn') : '');
  const clickable = r.open ? ' row clickable' : '';
  return (
    `<div class="kv${clickable}"${r.open ? ' tabindex="-1" role="treeitem"' : ''}${openAttrs(r.open)}${titleAttr(r.title)}>` +
    `<span class="key">${esc(r.key)}</span>${value}</div>`
  );
}

function noteRow(n: NoteVM): string {
  const ic =
    n.severity === 'error'
      ? icon('error', 'err')
      : n.severity === 'warning'
        ? icon('warning', 'warn')
        : icon('info', 'muted');
  return `<div class="note row${n.open ? ' clickable' : ''}" tabindex="-1" role="treeitem"${openAttrs(n.open)}${titleAttr(n.message)}>${ic}<span class="note-text">${esc(n.message)}</span></div>`;
}

export function renderProject(m: SidebarModel): string {
  if (m.projects.length === 0)
    return '<div class="empty">No Yocto project found in this workspace.</div>';
  return m.projects
    .map(
      (p) =>
        (m.projects.length > 1 ? `<div class="subhead">${esc(p.name)}</div>` : '') +
        `<div class="kv-grid">${p.rows.map(projectRow).join('')}</div>` +
        p.notes.map(noteRow).join(''),
    )
    .join('');
}

// ---------------------------------------------------------------------------
// LAYERS

/** Small icon on the right of a row, visible on hover, that opens a file. */
const rowAction = (l: Link | undefined, name: string, title: string) =>
  l
    ? `<span class="row-action codicon codicon-${name}" role="button" aria-label="${esc(title)}" title="${esc(title)}"${openAttrs(l)}></span>`
    : '';

/** A click on the row shows the layer's recipes; the hover icon opens layer.conf. */
export function layerRow(l: LayerVM, selected = false): string {
  const ic = l.severity === 'error' ? icon('error', 'err') : icon('layers');
  const warn = l.severity === 'warning' ? icon('warning', 'warn after-name') : '';
  const prio = `<span class="pill">${l.priority ?? '?'}</span>`;
  return (
    `<div class="row layer clickable${selected ? ' selected' : ''}" tabindex="-1" role="treeitem" aria-selected="${selected}" data-layer="${esc(l.path)}"${titleAttr(`${l.title}\n\nClick to show its recipes.`)}>` +
    `${ic}<span class="name mono">${esc(l.name)}</span>${warn}<span class="grow"></span>` +
    rowAction(l.open, 'go-to-file', 'Open layer.conf') +
    `<span class="count">${l.recipeCount}</span>${prio}</div>`
  );
}

export function renderLayers(m: SidebarModel, state: UiState = DEFAULT_STATE): string {
  if (m.layers.length === 0) return '<div class="empty">No layer found.</div>';
  const rows = m.layers.map((l) => layerRow(l, state.filter.layer === l.path));
  if (m.inactiveLayers.length) {
    const key = 'inactive';
    const open = isOpen(state, key, false);
    rows.push(
      `<div class="row category clickable inactive" tabindex="-1" role="treeitem" data-toggle="${key}" aria-expanded="${open}" title="Layers found in the workspace but not listed in BBLAYERS: BitBake ignores them.">` +
        `${twisty(open)}<span class="name">Not in BBLAYERS</span><span class="grow"></span>` +
        `<span class="count">${m.inactiveLayers.length}</span></div>`,
    );
    if (open) {
      rows.push(
        ...m.inactiveLayers.map(
          (l) =>
            `<div class="row layer clickable inactive" tabindex="-1" role="treeitem" style="--depth:1"${openAttrs(l.open)}${titleAttr(l.title)}>` +
            `${icon('layers', 'muted')}<span class="name mono">${esc(l.name)}</span><span class="grow"></span>` +
            `<span class="pill">${l.priority ?? '?'}</span></div>`,
        ),
      );
    }
  }
  return rows.join('');
}

// ---------------------------------------------------------------------------
// RECIPES

export const KINDS: { kind: RecipeKind; label: string; title: string }[] = [
  { kind: 'appends', label: 'Has appends', title: 'Recipes extended by at least one bbappend' },
  { kind: 'overlayed', label: 'Overlayed', title: 'Same recipe name provided by several layers' },
];

/** Project | All selector, then the kind chips (at most one active), then the layer chip. */
export function renderChips(filter: RecipeFilter, layerNames: Record<string, string> = {}): string {
  const scope = scopeOf(filter);
  const seg = (s: RecipeScope, label: string, title: string) => {
    const on = !filter.layer && scope === s;
    return `<button class="seg${on ? ' active' : ''}" data-scope="${s}" aria-pressed="${on}" title="${esc(title)}">${label}</button>`;
  };
  const kinds = KINDS.map(
    (k) =>
      `<button class="chip${filter.kind === k.kind ? ' active' : ''}" data-kind="${k.kind}" aria-pressed="${filter.kind === k.kind}" title="${esc(k.title)}">${esc(k.label)}</button>`,
  ).join('');
  const layer = filter.layer
    ? `<button class="chip active layer-chip" data-clear-layer="1" title="Recipes of this layer. Click to go back.">${icon('layers')}${esc(layerNames[filter.layer] ?? filter.layer)}${icon('close')}</button>`
    : '';
  return (
    `<span class="segmented" role="group" aria-label="Scope">` +
    seg('project', 'Project', 'Recipes created or extended by your layers') +
    seg('all', 'All', 'Every recipe of every loaded layer') +
    `</span>${kinds}${layer}`
  );
}

function recipeRow(r: Recipe, m: SidebarModel, state: UiState): string {
  const key = `recipe:${r.path}`;
  const open = isOpen(state, key, false);
  const hasChildren = r.appends.length > 0;
  const layer = m.layerNames[r.layer] ?? r.layer;
  const loses = r.overlay && r.overlay.winner !== r.path;
  const titleLines = [r.path];
  if (r.appends.length) titleLines.push(`Extended by ${r.appends.length} bbappend(s)`);
  if (r.overlay) {
    const w = m.recipes.find((x) => x.path === r.overlay?.winner);
    titleLines.push(
      loses
        ? `Overlayed: BitBake uses the one from ${w ? (m.layerNames[w.layer] ?? w.layer) : 'another layer'}`
        : `Overlayed: this one is used (highest priority)`,
    );
  }
  const badges =
    (r.overlay ? `<span class="pill pill-ovr">OVR</span>` : '') +
    (r.appends.length ? `<span class="pill pill-blue">+${r.appends.length}</span>` : '');
  const html =
    `<div class="row recipe clickable${loses ? ' shadowed' : ''}" tabindex="-1" role="treeitem" style="--depth:1"` +
    `${hasChildren ? ` data-toggle="${esc(key)}" aria-expanded="${open}"` : ''}${openAttrs({ file: r.path })} data-recipe="1"${titleAttr(titleLines.join('\n'))}>` +
    (hasChildren ? twisty(open) : '<span class="twisty-space"></span>') +
    icon(r.image ? 'file-media' : 'file-code', 'tone-yellow') +
    `<span class="name">${esc(r.pn)}</span>` +
    `<span class="meta">${esc([r.pv, layer].filter(Boolean).join(' · '))}</span>` +
    `<span class="grow"></span>${badges}</div>`;
  if (!hasChildren || !open) return html;
  const byPath = new Map(m.appends.map((a) => [a.path, a]));
  return (
    html +
    r.appends
      .map((p) => byPath.get(p))
      .filter((a): a is BbAppend => !!a)
      .map((a) => appendRow(a, m, 2, false))
      .join('')
  );
}

function appendRow(a: BbAppend, m: SidebarModel, depth: number, orphan: boolean): string {
  return (
    `<div class="row append clickable" tabindex="-1" role="treeitem" style="--depth:${depth}"${openAttrs({ file: a.path })}${titleAttr(orphan ? `Orphan bbappend: no recipe matches.\n${a.path}` : a.path)}>` +
    '<span class="twisty-space"></span>' +
    (orphan ? icon('warning', 'warn') : icon('add', 'tone-blue')) +
    `<span class="name tone-blue mono">${esc(a.fileName)}</span>` +
    `<span class="meta">${esc(m.layerNames[a.layer] ?? '')}</span></div>`
  );
}

export function recipeTreeOf(m: SidebarModel, state: UiState): RecipeTree {
  return buildRecipeTree(m.recipes, m.appends, state.filter, new Set(m.projectLayers));
}

export function recipesCount(tree: RecipeTree): string {
  if (tree.total === 0) return '';
  return tree.shown === tree.total ? `${tree.total}` : `${tree.shown} / ${tree.total}`;
}

export function renderRecipeList(
  m: SidebarModel,
  state: UiState,
  tree = recipeTreeOf(m, state),
): string {
  const parts: string[] = [];
  if (tree.noProjectLayer) {
    parts.push(
      '<div class="hint">No project layer detected: showing all recipes. Set metaLens.projectLayers to choose yours.</div>',
    );
  }
  const autoOpen = !!state.filter.text?.trim() || tree.shown <= AUTO_EXPAND_LIMIT;
  for (const g of tree.groups) {
    const key = `cat:${g.category}`;
    const open = isOpen(state, key, autoOpen);
    parts.push(
      `<div class="row category clickable" tabindex="-1" role="treeitem" data-toggle="${esc(key)}" aria-expanded="${open}" style="--depth:0">` +
        `${twisty(open)}${icon(open ? 'folder-opened' : 'folder', 'muted')}` +
        `<span class="name mono">${esc(g.category || '(other)')}</span><span class="grow"></span>` +
        `<span class="count">${g.recipes.length}</span></div>`,
    );
    if (open) parts.push(...g.recipes.map((r) => recipeRow(r, m, state)));
  }
  if (tree.orphans.length) {
    const key = 'orphans';
    const open = isOpen(state, key, true);
    parts.push(
      `<div class="row category clickable" tabindex="-1" role="treeitem" data-toggle="${key}" aria-expanded="${open}" style="--depth:0" title="bbappends that match no recipe: BitBake fails on them unless BB_DANGLINGAPPENDS_WARNONLY is set.">` +
        `${twisty(open)}${icon('warning', 'warn')}<span class="name">Orphan bbappends</span>` +
        `<span class="grow"></span><span class="count">${tree.orphans.length}</span></div>`,
    );
    if (open) parts.push(...tree.orphans.map((a) => appendRow(a, m, 1, true)));
  }
  if (parts.length === 0) parts.push('<div class="empty">No recipe matches.</div>');
  return parts.join('');
}

// ---------------------------------------------------------------------------
// BUILT IMAGES

export function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? v : v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function renderBuiltImages(m: SidebarModel, state: UiState = DEFAULT_STATE): string {
  if (m.builtImages.length === 0) {
    return '<div class="empty">No image built yet: tmp/deploy/images is empty or missing.</div>';
  }
  const machines = [...new Set(m.builtImages.map((i) => i.machine))];
  const parts: string[] = [];
  for (const machine of machines) {
    const imgs = m.builtImages.filter((i) => i.machine === machine);
    const current = imgs.some((i) => i.current);
    const key = `machine:${machine}`;
    const open = isOpen(state, key, current || machines.length === 1);
    parts.push(
      `<div class="row category clickable" tabindex="-1" role="treeitem" data-toggle="${esc(key)}" aria-expanded="${open}" style="--depth:0"${titleAttr(current ? 'MACHINE of the active configuration' : undefined)}>` +
        `${twisty(open)}${icon('circuit-board', current ? 'tone-blue' : 'muted')}` +
        `<span class="name mono">${esc(machine)}</span>` +
        (current ? '<span class="pill pill-outline">MACHINE</span>' : '') +
        `<span class="grow"></span><span class="count">${imgs.length}</span></div>`,
    );
    if (!open) continue;
    for (const img of imgs) {
      const ikey = `image:${machine}/${img.name}`;
      const iopen = isOpen(state, ikey, false);
      const meta = [
        img.builtAt ? formatDate(img.builtAt) : undefined,
        img.builds > 1 ? `${img.builds} builds` : undefined,
      ]
        .filter(Boolean)
        .join(' · ');
      const title = [
        img.recipe ? `Recipe: ${img.recipe.file}` : 'No matching image recipe in the loaded layers',
        img.builds ? `${img.builds} timestamped build(s) still in deploy/images` : '',
      ]
        .filter(Boolean)
        .join('\n');
      parts.push(
        `<div class="row image clickable" tabindex="-1" role="treeitem" style="--depth:1" data-toggle="${esc(ikey)}" aria-expanded="${iopen}"${openAttrs(img.recipe)}${titleAttr(title)}>` +
          `${twisty(iopen)}${icon('file-media', 'tone-yellow')}<span class="name">${esc(img.name)}</span>` +
          `<span class="meta">${esc(meta)}</span><span class="grow"></span></div>`,
      );
      if (!iopen) continue;
      for (const f of img.files) {
        const action = f.text ? openAttrs({ file: f.path }) : ` data-reveal="${esc(f.path)}"`;
        parts.push(
          `<div class="row clickable" tabindex="-1" role="treeitem" style="--depth:2"${action}${titleAttr(`${f.path}\n${f.text ? 'Click to open' : 'Click to reveal in the file manager'}`)}>` +
            `<span class="twisty-space"></span>${icon(f.text ? 'file' : 'file-binary', 'muted')}` +
            `<span class="name mono">${esc(f.ext)}</span><span class="grow"></span>` +
            `<span class="count">${formatSize(f.size)}</span></div>`,
        );
      }
    }
  }
  return parts.join('');
}
