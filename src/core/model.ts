// Shared data model. Pure types, no runtime dependency.

export type Severity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  severity: Severity;
  message: string;
  /** Absolute path of the file the diagnostic refers to, if any. */
  file?: string;
  /** 1-based line number in `file`, if known. */
  line?: number;
}

export interface LayerDependency {
  collection: string;
  /** Optional version constraint, e.g. `meta:5` → "5". */
  version?: string;
  /** Line of the LAYERDEPENDS assignment in layer.conf. */
  line?: number;
}

export interface Layer {
  /** Display name: the layer directory basename (e.g. `meta-poky`). */
  name: string;
  /** Absolute path of the layer directory. */
  path: string;
  /** Absolute path of `conf/layer.conf`, if it exists. */
  layerConf?: string;
  /** Collection names declared in BBFILE_COLLECTIONS (usually one). */
  collections: string[];
  /** BBFILE_PRIORITY of the first collection, if set and numeric. */
  priority?: number;
  depends: LayerDependency[];
  /** LAYERSERIES_COMPAT, e.g. ["scarthgap", "styhead"]. */
  seriesCompat: string[];
  /** BBFILES patterns, with ${LAYERDIR} expanded. */
  bbfiles: string[];
  /** Number of `.bb` files found under the layer (light count, no parse). */
  recipeCount: number;
  diagnostics: Diagnostic[];
}

export type ConfigSourceKind = 'bblayers' | 'kas' | 'scan';

export interface ConfigSource {
  kind: ConfigSourceKind;
  /** Absolute path of the config file (bblayers.conf or kas yml). Absent for `scan`. */
  file?: string;
}

export interface Project {
  root: string;
  source: ConfigSource;
  /** Every candidate config file found, so the UI can offer a picker later. */
  bblayersFiles: string[];
  kasFiles: string[];
  /** Layers in BBLAYERS order. */
  layers: Layer[];
  /** Project-level diagnostics (not tied to a single layer). */
  diagnostics: Diagnostic[];
}
