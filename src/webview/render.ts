// HTML rendering of the sidebar. Pure string functions (no DOM), unit-tested.

import type { BbAppend, Recipe } from '../core/model';
import { buildRecipeTree, type RecipeFilter, type RecipeTree } from '../core/recipeTree';
import type { LayerVM, Link, NoteVM, ProjectRowVM, SidebarModel } from '../core/sidebarModel';

export interface UiState {
  filter: RecipeFilter;
  /** Explicit open/closed state per key; missing key → default. */
  open: Record<string, boolean>;
}

export const DEFAULT_STATE: UiState = { filter: { projectOnly: true }, open: {} };

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
    (r.dot ? '<span class="dot"></span>' : '') +
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

export function layerRow(l: LayerVM): string {
  const ic = l.severity === 'error' ? icon('error', 'err') : icon('layers', 'tone-purple');
  const warn = l.severity === 'warning' ? icon('warning', 'warn after-name') : '';
  const prio = `<span class="pill">${l.priority ?? '?'}</span>`;
  return (
    `<div class="row layer clickable" tabindex="-1" role="treeitem"${openAttrs(l.open)}${titleAttr(l.title)}>` +
    `${ic}<span class="name mono">${esc(l.name)}</span>${warn}<span class="grow"></span>` +
    `<span class="count">${l.recipeCount}</span>${prio}</div>`
  );
}

export function renderLayers(m: SidebarModel): string {
  if (m.layers.length === 0) return '<div class="empty">No layer found.</div>';
  return m.layers.map(layerRow).join('');
}

// ---------------------------------------------------------------------------
// RECIPES

export const CHIPS: { key: keyof RecipeFilter; label: string; title: string }[] = [
  { key: 'projectOnly', label: 'Project', title: 'Recipes created or extended by your layers' },
  { key: 'hasAppends', label: 'Has appends', title: 'Recipes extended by at least one bbappend' },
  { key: 'overlayed', label: 'Overlayed', title: 'Same recipe name provided by several layers' },
  { key: 'images', label: 'Images', title: 'Image recipes' },
];

export function renderChips(filter: RecipeFilter): string {
  return CHIPS.map(
    (c) =>
      `<button class="chip${filter[c.key] ? ' active' : ''}" data-chip="${c.key}" aria-pressed="${!!filter[c.key]}" title="${esc(c.title)}">${esc(c.label)}</button>`,
  ).join('');
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
    `${hasChildren ? ` data-toggle="${esc(key)}" aria-expanded="${open}"` : ''}${openAttrs({ file: r.path })}${titleAttr(titleLines.join('\n'))}>` +
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
