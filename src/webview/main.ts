// Webview side of the sidebar: receives the model, renders, handles clicks and keys.

import type { RecipeFilter, RecipeKind, RecipeScope } from '../core/recipeTree';
import type { SidebarModel } from '../core/sidebarModel';
import {
  DEFAULT_STATE,
  isOpen,
  recipeTreeOf,
  recipesCount,
  renderBuiltImages,
  renderChips,
  renderLayers,
  renderProject,
  renderRecipeList,
  sectionHeader,
  type UiState,
} from './render';

/** Messages sent to the extension. */
export type ToHost =
  | { type: 'ready' }
  | { type: 'open'; file: string; line?: number }
  | { type: 'reveal'; file: string }
  /** A recipe row was clicked: open it and maybe its overlay chain. */
  | { type: 'openRecipe'; file: string }
  | { type: 'state'; filter: RecipeFilter };

/** Messages received from the extension. */
export type FromHost =
  | { type: 'model'; model: SidebarModel }
  | { type: 'focusFilter' }
  /** Complete filter that replaces the current one. */
  | { type: 'setFilter'; filter: RecipeFilter };

declare function acquireVsCodeApi(): {
  postMessage(msg: ToHost): void;
  getState(): UiState | undefined;
  setState(s: UiState): void;
};

const vscode = acquireVsCodeApi();
let state: UiState = vscode.getState() ?? structuredClone(DEFAULT_STATE);
let model: SidebarModel | undefined;

const $ = (id: string) => document.getElementById(id) as HTMLElement;

function save(): void {
  vscode.setState(state);
  vscode.postMessage({ type: 'state', filter: state.filter });
}

function renderSections(): void {
  if (!model) return;
  const tree = recipeTreeOf(model, state);
  const sec = (key: string, label: string, count: string) => {
    const open = isOpen(state, key, true);
    $(`${key}-header`).outerHTML = sectionHeader(key, label, count, open).replace(
      '<div class="section-header"',
      `<div id="${key}-header" class="section-header"`,
    );
    $(`${key}-body`).hidden = !open;
  };
  sec('sec-project', 'Project', '');
  sec('sec-layers', 'Layers', model.layers.length ? String(model.layers.length) : '');
  sec('sec-recipes', 'Recipes', recipesCount(tree));
  sec(
    'sec-images',
    'Built images',
    model.builtImages.length ? String(model.builtImages.length) : '',
  );
  $('images').innerHTML = renderBuiltImages(model, state);
  $('project').innerHTML = renderProject(model);
  $('layers').innerHTML = renderLayers(model, state);
  $('chips').innerHTML = renderChips(state.filter, model.layerNames);
  $('recipes').innerHTML = renderRecipeList(model, state, tree);
}

/** Keep keyboard focus on the same row across re-renders. */
function rerender(): void {
  const active = document.activeElement as HTMLElement | null;
  const key = active?.dataset.toggle ?? active?.dataset.layer ?? active?.dataset.file;
  renderSections();
  if (key && active !== $('filter')) {
    const again = document.querySelector<HTMLElement>(
      `[data-toggle="${CSS.escape(key)}"], [data-layer="${CSS.escape(key)}"], [data-file="${CSS.escape(key)}"]`,
    );
    again?.focus();
  }
}

function toggle(key: string): void {
  const el = document.querySelector<HTMLElement>(`[data-toggle="${CSS.escape(key)}"]`);
  const open = el?.getAttribute('aria-expanded') === 'true';
  state = { ...state, open: { ...state.open, [key]: !open } };
  save();
  rerender();
}

function setFilter(f: Partial<RecipeFilter>): void {
  state = { ...state, filter: { ...state.filter, ...f } };
  save();
  rerender();
}

document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const chip = target.closest<HTMLElement>('[data-scope], [data-kind], [data-clear-layer]');
  if (chip) {
    if (chip.dataset.scope) {
      setFilter({ scope: chip.dataset.scope as RecipeScope, layer: undefined });
    } else if (chip.dataset.kind) {
      const k = chip.dataset.kind as RecipeKind;
      setFilter({ kind: state.filter.kind === k ? undefined : k });
    } else {
      setFilter({ layer: undefined });
    }
    return;
  }
  // Hover icon (e.g. open layer.conf) wins over the row action.
  const action = target.closest<HTMLElement>('.row-action[data-file]');
  if (action?.dataset.file) {
    vscode.postMessage({ type: 'open', file: action.dataset.file });
    return;
  }
  const reveal = target.closest<HTMLElement>('[data-reveal]');
  if (reveal?.dataset.reveal) {
    reveal.focus();
    vscode.postMessage({ type: 'reveal', file: reveal.dataset.reveal });
    return;
  }
  const layerRowEl = target.closest<HTMLElement>('[data-layer]');
  if (layerRowEl?.dataset.layer) {
    const layer = layerRowEl.dataset.layer;
    // Second click on the selected layer goes back to the previous scope.
    state = {
      ...state,
      open: { ...state.open, 'sec-recipes': true },
      filter: { ...state.filter, layer: state.filter.layer === layer ? undefined : layer },
    };
    save();
    rerender();
    document.getElementById('sec-recipes-header')?.scrollIntoView({ block: 'nearest' });
    return;
  }
  const el = target.closest<HTMLElement>('[data-toggle], [data-file]');
  if (!el) return;
  el.focus();
  // The chevron only expands/collapses; the rest of a recipe row opens the file.
  const onTwisty = !!target.closest('.twisty');
  if (el.dataset.toggle && (onTwisty || !el.dataset.file)) {
    toggle(el.dataset.toggle);
  } else if (el.dataset.file && el.dataset.recipe) {
    vscode.postMessage({ type: 'openRecipe', file: el.dataset.file });
  } else if (el.dataset.file) {
    vscode.postMessage({
      type: 'open',
      file: el.dataset.file,
      line: el.dataset.line ? Number(el.dataset.line) : undefined,
    });
  }
});

document.addEventListener('keydown', (e) => {
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === $('filter')) {
    if (e.key === 'ArrowDown' && el === $('filter')) {
      document.querySelector<HTMLElement>('#recipes .row')?.focus();
      e.preventDefault();
    }
    return;
  }
  const rows = [
    ...document.querySelectorAll<HTMLElement>('.section-header, .row:not([hidden])'),
  ].filter((r) => r.offsetParent !== null);
  const i = rows.indexOf(el);
  const expanded = el.getAttribute('aria-expanded');
  switch (e.key) {
    case 'ArrowDown':
      rows[i + 1]?.focus();
      break;
    case 'ArrowUp':
      rows[i - 1]?.focus();
      break;
    case 'ArrowRight':
      if (expanded === 'false' && el.dataset.toggle) toggle(el.dataset.toggle);
      break;
    case 'ArrowLeft':
      if (expanded === 'true' && el.dataset.toggle) toggle(el.dataset.toggle);
      break;
    case 'Enter':
    case ' ':
      el.click();
      break;
    default:
      return;
  }
  e.preventDefault();
});

let typing: ReturnType<typeof setTimeout> | undefined;
document.addEventListener('input', (e) => {
  if (e.target !== $('filter')) return;
  if (typing) clearTimeout(typing);
  typing = setTimeout(() => setFilter({ text: ($('filter') as HTMLInputElement).value }), 120);
});

window.addEventListener('message', (e: MessageEvent<FromHost>) => {
  const msg = e.data;
  if (msg.type === 'model') {
    model = msg.model;
    rerender();
  } else if (msg.type === 'focusFilter') {
    state = { ...state, open: { ...state.open, 'sec-recipes': true } };
    rerender();
    $('filter').focus();
  } else if (msg.type === 'setFilter') {
    state = { ...state, filter: msg.filter };
    ($('filter') as HTMLInputElement).value = msg.filter.text ?? '';
    save();
    rerender();
  }
});

($('filter') as HTMLInputElement).value = state.filter.text ?? '';
vscode.postMessage({ type: 'ready' });
vscode.postMessage({ type: 'state', filter: state.filter });
