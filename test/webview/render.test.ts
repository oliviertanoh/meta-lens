import * as path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadProject } from '../../src/core/project';
import { buildSidebarModel, type SidebarModel } from '../../src/core/sidebarModel';
import {
  DEFAULT_STATE,
  esc,
  formatSize,
  renderBuiltImages,
  layerRow,
  recipeTreeOf,
  recipesCount,
  renderChips,
  renderLayers,
  renderProject,
  renderRecipeList,
  type UiState,
} from '../../src/webview/render';
import { fixture } from '../core/helpers';

let m: SidebarModel;
const root = fixture('bsp-custom');
beforeAll(async () => {
  m = buildSidebarModel([await loadProject(root)], (f) => path.relative(root, f));
});

/** Visible text of an HTML fragment, rows separated by "|". */
const text = (html: string) =>
  html
    .replace(/<div[^>]*>/g, '|')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);

describe('esc', () => {
  it('escapes HTML special characters', () => {
    expect(esc(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });
});

describe('renderProject', () => {
  it('shows key/value rows with tones and links', () => {
    const html = renderProject(m);
    expect(text(html).slice(0, 5)).toEqual([
      `Config ${path.join('build', 'conf', 'bblayers.conf')}`,
      `Local conf ${path.join('build', 'conf', 'local.conf')}`,
      'Release scarthgap (5.0 LTS)',
      'MACHINE acme-rpi4',
      'DISTRO acme-distro',
    ]);
    expect(html).toContain('tone-orange');
    expect(html).toContain('tone-blue');
    expect(html).toContain(
      `data-file="${esc(fixture('bsp-custom', 'build', 'conf', 'local.conf'))}"`,
    );
    expect(html).not.toContain('Mode');
  });
});

describe('renderLayers', () => {
  it('one row per layer: name, warning, count, priority pill', () => {
    expect(text(renderLayers(m))).toEqual([
      'meta 4 5',
      'meta-poky 0 5',
      'meta-acme-bsp 0 10',
      'meta-oe 3 6',
      'meta-qt6 0 ?',
      'meta-acme 3 10',
      'Not in BBLAYERS 1',
    ]);
    const acme = layerRow(m.layers[5]!);
    expect(acme).toContain('codicon-warning');
    expect(acme).toContain('<span class="pill">10</span>');
    // Layer icons use the theme's icon color; color is kept for warnings and errors.
    expect(layerRow(m.layers[0]!)).toContain('codicon-layers ');
    expect(layerRow(m.layers[0]!)).not.toContain('tone-');
  });
});

describe('layer interactions', () => {
  it('a layer row filters recipes; layer.conf opens from the hover icon', () => {
    const l = m.layers[0]!;
    const html = layerRow(l);
    expect(html).toContain(`data-layer="${esc(l.path)}"`);
    expect(html).toMatch(/class="row-action codicon codicon-go-to-file"[^>]*data-file=/);
    expect(html).not.toMatch(/class="row layer[^"]*"[^>]*data-file=/);
  });

  it('the selected layer is highlighted', () => {
    const l = m.layers[2]!;
    const html = renderLayers(m, { ...DEFAULT_STATE, filter: { layer: l.path } });
    expect(html.match(/row layer clickable selected/g)).toHaveLength(1);
  });

  it('inactive layers open on demand, greyed', () => {
    const html = renderLayers(m, { ...DEFAULT_STATE, open: { inactive: true } });
    expect(text(html).at(-1)).toBe('meta-unused 7');
    expect(html).toContain('row layer clickable inactive');
  });
});

describe('renderChips', () => {
  it('Project | All selector and kind chips', () => {
    const html = renderChips({ scope: 'project', kind: 'overlayed' });
    expect(html.match(/class="seg active"/g)).toHaveLength(1);
    expect(html).toContain('class="seg active" data-scope="project"');
    expect(html).toContain('class="chip active" data-kind="overlayed"');
    expect(text(html.replace(/<button/g, '<div'))).toEqual([
      'Project',
      'All',
      'Has appends',
      'Overlayed',
    ]);
  });

  it('a selected layer shows a removable chip and no active scope', () => {
    const layer = m.layers[0]!.path;
    const html = renderChips({ scope: 'project', layer }, m.layerNames);
    expect(html).not.toContain('seg active');
    expect(html).toContain('data-clear-layer');
    expect(text(html.replace(/<button/g, '<div')).at(-1)).toBe('meta');
  });
});

describe('renderRecipeList', () => {
  it('default state: project recipes, categories open (short list)', () => {
    expect(text(renderRecipeList(m, DEFAULT_STATE))).toEqual([
      'recipes-acme 1',
      'acme-app 1.0 · meta-acme',
      'recipes-connectivity 1',
      'openssh 9.6p1 · meta-acme OVR',
      'recipes-core 2',
      'base-files 3.0.14 · meta +1',
      'busybox 1.36.1 · meta +2',
      'recipes-images 1',
      'acme-image meta-acme',
      'recipes-support 1',
      'htop 3.3.0 · meta-oe +1',
      'Orphan bbappends 1',
      'psplash_1.2.bbappend meta-acme',
    ]);
  });

  it('opening a recipe lists its bbappends in order', () => {
    const busybox = m.recipes.find((r) => r.pn === 'busybox')!;
    const state: UiState = { ...DEFAULT_STATE, open: { [`recipe:${busybox.path}`]: true } };
    const rows = text(renderRecipeList(m, state));
    const i = rows.indexOf('busybox 1.36.1 · meta +2');
    expect(rows.slice(i + 1, i + 3)).toEqual([
      'busybox_%.bbappend meta-acme-bsp',
      'busybox_%.bbappend meta-acme',
    ]);
  });

  it('a closed category hides its recipes', () => {
    const state: UiState = { ...DEFAULT_STATE, open: { 'cat:recipes-core': false } };
    const rows = text(renderRecipeList(m, state));
    expect(rows).toContain('recipes-core 2');
    expect(rows).not.toContain('busybox 1.36.1 · meta +2');
  });

  it('the overlayed recipe that loses is dimmed', () => {
    const all: UiState = { ...DEFAULT_STATE, filter: { scope: 'all', kind: 'overlayed' } };
    const html = renderRecipeList(m, all);
    expect(html.match(/recipe clickable shadowed/g)).toHaveLength(1);
    expect(html).toContain('Overlayed: BitBake uses the one from meta-acme');
  });

  it('empty result', () => {
    const state: UiState = { ...DEFAULT_STATE, filter: { text: 'nothing-matches' } };
    expect(text(renderRecipeList(m, state))).toEqual(['No recipe matches.']);
  });

  it('count label', () => {
    expect(recipesCount(recipeTreeOf(m, DEFAULT_STATE))).toBe('6 / 10');
    expect(recipesCount(recipeTreeOf(m, { ...DEFAULT_STATE, filter: { scope: 'all' } }))).toBe(
      '10',
    );
  });

  it('escapes file names', () => {
    const evil = structuredClone(m);
    evil.recipes[0]!.pn = '<img src=x onerror=alert(1)>';
    expect(renderRecipeList(evil, { ...DEFAULT_STATE, filter: { scope: 'all' } })).not.toContain(
      '<img',
    );
  });
});

describe('renderBuiltImages', () => {
  it('groups by machine, the current MACHINE open by default', () => {
    const rows = text(renderBuiltImages(m));
    expect(rows[0]).toBe('acme-rpi4 MACHINE 1');
    expect(rows[1]).toMatch(/^acme-image \w{3} \d+, \d{4} · 2 builds$/);
    expect(rows[2]).toBe('qemuarm64 1');
    expect(rows).toHaveLength(3);
  });

  it('opening an image lists its files: text ones open, binaries are revealed', () => {
    const html = renderBuiltImages(m, {
      ...DEFAULT_STATE,
      open: { 'image:acme-rpi4/acme-image': true },
    });
    expect(text(html).slice(2, 5)).toEqual(['.manifest 53 B', '.wic 2.0 KB', '.wic.bmap 8 B']);
    expect(html).toMatch(/data-file="[^"]*rootfs\.manifest"/);
    expect(html).toMatch(/data-reveal="[^"]*rootfs\.wic"/);
  });

  it('the image row opens its recipe', () => {
    expect(renderBuiltImages(m)).toMatch(/class="row image[^>]*data-file="[^"]*acme-image\.bb"/);
  });

  it('empty state', () => {
    expect(text(renderBuiltImages({ ...m, builtImages: [] }))).toEqual([
      'No image built yet: tmp/deploy/images is empty or missing.',
    ]);
  });

  it('formatSize', () => {
    expect([0, 1023, 2048, 435_000_000, 3 * 1024 ** 3].map(formatSize)).toEqual([
      '0 B',
      '1023 B',
      '2.0 KB',
      '415 MB',
      '3.0 GB',
    ]);
  });
});

describe('no em dash in the UI', () => {
  it('rendered HTML has none', () => {
    const html =
      renderProject(m) +
      renderLayers(m) +
      renderRecipeList(m, DEFAULT_STATE) +
      renderChips({}) +
      renderBuiltImages(m);
    expect(html).not.toContain('—');
  });
});
