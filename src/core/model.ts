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

export interface LayerOrigin {
  /** `project`: written in this repo. `upstream`: community / vendor layer. */
  kind: 'project' | 'upstream';
  /** Human-readable reason, shown in tooltips. */
  reason: string;
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
  /** BBFILES_DYNAMIC entries, with ${LAYERDIR} expanded. */
  bbfilesDynamic: DynamicBbfiles[];
  /**
   * BBFILES patterns repeated for every loaded collection, `%s` being the
   * collection name (meta-raspberrypi's `' '.join(... for layer in BBFILE_COLLECTIONS.split())`).
   */
  bbfilesPerCollection: string[];
  /** Project or upstream layer (see layerOrigin.ts). */
  origin: LayerOrigin;
  /** Number of recipes (`.bb` files picked up by BBFILES) in this layer. */
  recipeCount: number;
  /** Number of `.bbappend` files picked up by BBFILES in this layer. */
  appendCount: number;
  diagnostics: Diagnostic[];
}

/** One `{!}<collection>:<pattern>` entry of BBFILES_DYNAMIC. */
export interface DynamicBbfiles {
  collection: string;
  /** `!collection:...`: the pattern applies when the collection is NOT loaded. */
  negate: boolean;
  pattern: string;
}

/** Name parts derived from a file name, like BitBake's `vars_from_file`. */
export interface RecipeName {
  pn: string;
  pv?: string;
  pr?: string;
}

export interface RecipeFile extends RecipeName {
  /** Absolute path of the `.bb`. */
  path: string;
  /** Path of the layer that holds it (key into Project.layers). */
  layer: string;
  fileName: string;
  /** `recipes-*` folder the recipe lives in (e.g. `recipes-core`), or its first folder. */
  category: string;
}

export interface Recipe extends RecipeFile {
  /** Paths of the bbappends applied to this recipe, in application order. */
  appends: string[];
  /** Image recipe (guessed from its name or `images/` folder). */
  image?: boolean;
  /** Set when the same PN is provided by several layers. */
  overlay?: {
    /** Path of the recipe BitBake would pick (highest priority, then version). */
    winner: string;
    /** Every recipe with this PN, preferred first. */
    candidates: string[];
  };
}

export interface BbAppend extends RecipeName {
  /** Absolute path of the `.bbappend`. */
  path: string;
  layer: string;
  fileName: string;
  category: string;
  /** True when the name holds a `%` wildcard. */
  wildcard: boolean;
  /** Paths of the recipes this append applies to. Empty → orphan. */
  recipes: string[];
}

export interface IncludeFile {
  path: string;
  layer: string;
  fileName: string;
}

/** A configuration value and where it is set. */
export interface ConfValue {
  value: string;
  /** File where the winning assignment is written. */
  file: string;
  /** 1-based line of the winning assignment. */
  line?: number;
}

export interface ConfSetting extends ConfValue {
  /** `conf/machine/<MACHINE>.conf` or `conf/distro/<DISTRO>.conf` found in a loaded layer. */
  definition?: string;
  /** Path of the layer holding `definition`. */
  definitionLayer?: string;
}

export interface Release {
  /** Codenames from LAYERSERIES_COMPAT_core, e.g. ["scarthgap"]. */
  names: string[];
  /** Display label, e.g. "scarthgap (5.0 LTS)". */
  label: string;
  /** Path of the core layer it was read from. */
  layer: string;
}

export interface ProjectConfig {
  machine?: ConfSetting;
  distro?: ConfSetting;
  release?: Release;
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
  /** Every recipe picked up by BBFILES, sorted by category, PN, then path. */
  recipes: Recipe[];
  /** Every bbappend picked up by BBFILES, in application order (priority, BBLAYERS, path). */
  appends: BbAppend[];
  /** `.inc` files found in the layers (indexed only, never parsed at startup). */
  includes: IncludeFile[];
  /** MACHINE, DISTRO and Yocto release. */
  config: ProjectConfig;
  /** Project-level diagnostics (not tied to a single layer). */
  diagnostics: Diagnostic[];
}
