// Tell project layers (written in this repo) from upstream / vendored ones.

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { Layer, LayerOrigin } from './model';

/**
 * Collections of widely used community / vendor layers. A layer providing one
 * of them is upstream unless `metaLens.projectLayers` says otherwise.
 */
export const UPSTREAM_COLLECTIONS: ReadonlySet<string> = new Set([
  // poky / openembedded-core
  'core',
  'yocto',
  'yoctobsp',
  'selftest',
  'skeleton',
  // meta-openembedded
  'openembedded-layer',
  'meta-python',
  'networking-layer',
  'multimedia-layer',
  'filesystems-layer',
  'gnome-layer',
  'xfce-layer',
  'perl-layer',
  'webserver',
  'meta-initramfs',
  // common BSP / feature layers
  'raspberrypi',
  'qt5-layer',
  'qt6-layer',
  'freescale-layer',
  'intel',
  'clang-layer',
  'virtualization-layer',
  'security',
  'swupdate',
  'mender',
  'rauc',
  'arm',
  'arm-toolchain',
  'meta-ti-bsp',
  'meta-ti-extras',
]);

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Nearest directory at or above `dir` holding a `.git` (directory or submodule file). */
export async function gitRootOf(dir: string): Promise<string | undefined> {
  let cur = path.resolve(dir);
  for (;;) {
    if (await exists(path.join(cur, '.git'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return undefined;
    cur = parent;
  }
}

export interface OriginOptions {
  /** Layer directory names forced as project layers (`metaLens.projectLayers`). */
  projectLayers?: readonly string[];
}

/**
 * Rules, first match wins:
 * 1. `projectLayers` setting set → project iff listed;
 * 2. provides a well-known upstream collection → upstream;
 * 3. workspace is a git repo and the layer sits in another (nested) git checkout → upstream;
 * 4. otherwise → project.
 */
export async function classifyLayers(
  layers: readonly Layer[],
  root: string,
  opts: OriginOptions = {},
): Promise<Map<string, LayerOrigin>> {
  const out = new Map<string, LayerOrigin>();
  const forced = opts.projectLayers?.filter(Boolean) ?? [];
  const rootGit = forced.length ? undefined : await gitRootOf(root);

  for (const l of layers) {
    if (forced.length) {
      out.set(
        l.path,
        forced.includes(l.name)
          ? { kind: 'project', reason: 'listed in metaLens.projectLayers' }
          : { kind: 'upstream', reason: 'not listed in metaLens.projectLayers' },
      );
      continue;
    }
    const known = l.collections.find((c) => UPSTREAM_COLLECTIONS.has(c));
    if (known) {
      out.set(l.path, { kind: 'upstream', reason: `well-known collection "${known}"` });
      continue;
    }
    if (rootGit) {
      const layerGit = await gitRootOf(l.path);
      if (layerGit && layerGit !== rootGit) {
        out.set(l.path, {
          kind: 'upstream',
          reason: `separate git checkout ${path.relative(root, layerGit) || '.'}`,
        });
        continue;
      }
    }
    out.set(l.path, { kind: 'project', reason: 'part of this repository' });
  }
  return out;
}
