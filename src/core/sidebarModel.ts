// Everything the sidebar webview displays, as plain JSON. Pure: no vscode import.

import * as path from 'node:path';
import type {
  BbAppend,
  ConfSetting,
  Diagnostic,
  Layer,
  LayerOrigin,
  Project,
  Recipe,
} from './model';

export interface Link {
  file: string;
  line?: number;
}

export type Tone = 'orange' | 'blue';

export interface ProjectRowVM {
  key: string;
  value: string;
  tone?: Tone;
  open?: Link;
  /** Hover text. */
  title?: string;
  warning?: boolean;
}

export interface NoteVM {
  severity: Diagnostic['severity'];
  message: string;
  open?: Link;
}

export interface ProjectVM {
  name: string;
  rows: ProjectRowVM[];
  notes: NoteVM[];
}

export interface LayerVM {
  name: string;
  path: string;
  open?: Link;
  priority?: number;
  recipeCount: number;
  appendCount: number;
  origin: LayerOrigin;
  severity?: 'warning' | 'error';
  /** Hover text, one fact per line. */
  title: string;
}

export interface InactiveLayerVM {
  name: string;
  path: string;
  open: Link;
  priority?: number;
  title: string;
}

export interface BuiltFileVM {
  path: string;
  ext: string;
  size: number;
  mtime: number;
  /** Small text file that can be opened in the editor (manifest, json, bmap...). */
  text: boolean;
}

export interface BuiltImageVM {
  machine: string;
  /** True for the MACHINE of the active configuration. */
  current: boolean;
  name: string;
  recipe?: Link;
  builtAt?: number;
  builds: number;
  files: BuiltFileVM[];
}

const TEXT_EXT = /\.(manifest|json|bmap|env|txt|conf)$/;

export interface SidebarModel {
  projects: ProjectVM[];
  layers: LayerVM[];
  /** On disk but not in BBLAYERS. */
  inactiveLayers: InactiveLayerVM[];
  /** Images found in tmp/deploy/images. */
  builtImages: BuiltImageVM[];
  recipes: Recipe[];
  appends: BbAppend[];
  /** Layer path → display name. */
  layerNames: Record<string, string>;
  /** Paths of the project layers (for the "Project" recipe scope). */
  projectLayers: string[];
}

type Rel = (file: string) => string;

const note = (d: Diagnostic): NoteVM => ({
  severity: d.severity,
  message: d.message,
  open: d.file ? { file: d.file, line: d.line } : undefined,
});

function settingRow(key: string, s: ConfSetting | undefined, kind: string, rel: Rel): ProjectRowVM {
  if (!s)
    return { key, value: 'not set', title: `${key} is not set in the files meta-lens reads.` };
  const where = `Set in ${rel(s.file)}${s.line ? `:${s.line}` : ''}.`;
  const missing = !s.definition && !s.value.includes('${');
  return {
    key,
    value: s.value,
    tone: 'blue',
    warning: missing,
    open: s.definition ? { file: s.definition } : { file: s.file, line: s.line },
    title: s.definition
      ? `${where}\nDefined in ${rel(s.definition)}.`
      : `${where}\nNo conf/${kind}/${s.value}.conf in the loaded layers.`,
  };
}

function projectVM(p: Project, rel: Rel): ProjectVM {
  const rows: ProjectRowVM[] = [];
  const src = p.source.file;
  rows.push(
    src
      ? {
          key: 'Config',
          value: rel(src),
          tone: 'orange',
          open: { file: src },
          title:
            p.source.kind === 'kas'
              ? 'kas file: layers, MACHINE and DISTRO come from it.'
              : 'bblayers.conf: the list of layers (BBLAYERS).',
        }
      : {
          key: 'Config',
          value: 'workspace scan',
          title: 'No bblayers.conf or kas file found: layers were found by scanning the folder.',
        },
  );
  for (const f of p.config.confFiles) {
    rows.push({
      key: path.basename(f) === 'auto.conf' ? 'Auto conf' : 'Local conf',
      value: rel(f),
      tone: 'orange',
      open: { file: f },
      title: `${path.basename(f)}: MACHINE, DISTRO and build settings.`,
    });
  }
  const r = p.config.release;
  rows.push(
    r
      ? {
          key: 'Release',
          value: r.label,
          open: { file: path.join(r.layer, 'conf', 'layer.conf') },
          title: `From LAYERSERIES_COMPAT_core in ${path.basename(r.layer)}.`,
        }
      : { key: 'Release', value: 'unknown', title: 'No layer provides the "core" collection.' },
  );
  rows.push(settingRow('MACHINE', p.config.machine, 'machine', rel));
  rows.push(settingRow('DISTRO', p.config.distro, 'distro', rel));
  return { name: path.basename(p.root), rows, notes: p.diagnostics.map(note) };
}

function layerVM(l: Layer): LayerVM {
  const shown = l.diagnostics.filter((d) => d.severity !== 'info');
  const severity = shown.some((d) => d.severity === 'error')
    ? 'error'
    : shown.length
      ? 'warning'
      : undefined;
  const lines = [
    l.path,
    `Collection: ${l.collections.join(', ') || 'none'}`,
    `Priority: ${l.priority ?? 'not set'}`,
    `Origin: ${l.origin.kind} (${l.origin.reason})`,
    `Recipes: ${l.recipeCount} · bbappends: ${l.appendCount}`,
    `Depends on: ${l.depends.map((d) => d.collection + (d.version ? ` (${d.version})` : '')).join(', ') || 'nothing'}`,
    `Compatible with: ${l.seriesCompat.join(', ') || 'not set'}`,
    ...shown.map((d) => `⚠ ${d.message}`),
  ];
  return {
    name: l.name,
    path: l.path,
    open: l.layerConf ? { file: l.layerConf } : undefined,
    priority: l.priority,
    recipeCount: l.recipeCount,
    appendCount: l.appendCount,
    origin: l.origin,
    severity,
    title: lines.join('\n'),
  };
}

export function buildSidebarModel(projects: readonly Project[], rel: Rel): SidebarModel {
  const withLayers = projects.filter((p) => p.layers.length > 0);
  const layers = withLayers.flatMap((p) => p.layers);
  return {
    projects: withLayers.map((p) => projectVM(p, rel)),
    layers: layers.map(layerVM),
    builtImages: withLayers.flatMap((p) =>
      p.builtImages.map((i) => ({
        machine: i.machine,
        current: i.machine === p.config.machine?.value,
        name: i.name,
        recipe: i.recipe ? { file: i.recipe } : undefined,
        builtAt: i.builtAt,
        builds: i.builds,
        files: i.files.map((f) => ({
          path: f.path,
          ext: f.ext,
          size: f.size,
          mtime: f.mtime,
          text: TEXT_EXT.test(f.name),
        })),
      })),
    ),
    inactiveLayers: withLayers.flatMap((p) =>
      p.inactiveLayers.map((l) => ({
        name: l.name,
        path: l.path,
        open: { file: l.layerConf },
        priority: l.priority,
        title: `${l.path}\nNot listed in BBLAYERS: BitBake ignores this layer.\nCollection: ${l.collections.join(', ') || 'none'}`,
      })),
    ),
    recipes: withLayers.flatMap((p) => p.recipes),
    appends: withLayers.flatMap((p) => p.appends),
    layerNames: Object.fromEntries(layers.map((l) => [l.path, l.name])),
    projectLayers: layers.filter((l) => l.origin.kind === 'project').map((l) => l.path),
  };
}
