// Find Yocto config files and layer directories in a workspace, using async fs only.

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/** Directories never descended into. */
export const DEFAULT_EXCLUDES = [
  'build',
  'tmp',
  'sstate-cache',
  'downloads',
  '.git',
  'node_modules',
];

/**
 * Build directories (`build/`, `build-xyz/`, `builds/build-a/`…) are never
 * walked, because they hold tmp/, sstate-cache/ and downloads/. We only look
 * for `conf/bblayers.conf` at their top and one level below.
 */
const BUILD_DIR_RE = /^build/;

export interface DiscoveryOptions {
  /** Extra directory names to skip, on top of DEFAULT_EXCLUDES. */
  excludeDirs?: string[];
  /** Max directory depth searched for layers outside other layers. Default 6. */
  maxDepth?: number;
}

export interface DiscoveryResult {
  root: string;
  /** Absolute paths of `conf/bblayers.conf` files, shallowest first. */
  bblayersFiles: string[];
  /** Absolute paths of kas configuration files, shallowest first. */
  kasFiles: string[];
  /** Absolute paths of layer directories (each contains `conf/layer.conf`). */
  layerDirs: string[];
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile();
  } catch {
    return false;
  }
}

async function readHead(p: string, bytes = 4096): Promise<string> {
  let fh: fs.FileHandle | undefined;
  try {
    fh = await fs.open(p, 'r');
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead).toString('utf8');
  } catch {
    return '';
  } finally {
    await fh?.close();
  }
}

/** A kas file is a YAML file with a top-level `header:` block holding `version:`. */
export async function isKasFile(p: string): Promise<boolean> {
  const head = await readHead(p);
  return /^header:\s*$/m.test(head) && /^\s+version:/m.test(head);
}

async function listDirs(dir: string) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function depthOf(root: string, p: string): number {
  return path.relative(root, p).split(path.sep).length;
}

export async function discover(
  root: string,
  opts: DiscoveryOptions = {},
): Promise<DiscoveryResult> {
  const excludes = new Set([...DEFAULT_EXCLUDES, ...(opts.excludeDirs ?? [])]);
  const maxDepth = opts.maxDepth ?? 6;
  const bblayersFiles = new Set<string>();
  const kasCandidates: string[] = [];
  const layerDirs: string[] = [];

  const probeBblayers = async (dir: string) => {
    const f = path.join(dir, 'conf', 'bblayers.conf');
    if (await isFile(f)) bblayersFiles.add(f);
  };

  const probeBuildDir = async (dir: string, levels: number): Promise<void> => {
    await probeBblayers(dir);
    if (levels <= 0) return;
    const children = (await listDirs(dir)).filter(
      (c) =>
        c.isDirectory() && c.name !== 'conf' && !excludes.has(c.name) && !c.name.startsWith('.'),
    );
    await Promise.all(children.map((c) => probeBuildDir(path.join(dir, c.name), levels - 1)));
  };

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (await isFile(path.join(dir, 'conf', 'layer.conf'))) {
      layerDirs.push(dir);
      // Nested layers (e.g. meta-security/meta-tpm) live right under the layer.
      const children = await listDirs(dir);
      await Promise.all(
        children
          .filter((c) => c.isDirectory() && !excludes.has(c.name) && !c.name.startsWith('.'))
          .map(async (c) => {
            const sub = path.join(dir, c.name);
            if (await isFile(path.join(sub, 'conf', 'layer.conf'))) layerDirs.push(sub);
          }),
      );
      return;
    }
    await probeBblayers(dir);
    if (depth >= maxDepth) return;

    const entries = await listDirs(dir);
    const tasks: Promise<void>[] = [];
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (BUILD_DIR_RE.test(e.name)) {
          tasks.push(probeBuildDir(full, 1));
          continue;
        }
        if (excludes.has(e.name) || e.name.startsWith('.')) continue;
        tasks.push(walk(full, depth + 1));
      } else if (e.isFile() && /\.ya?ml$/.test(e.name)) {
        kasCandidates.push(full);
      }
    }
    await Promise.all(tasks);
  };

  await walk(root, 0);

  const kasChecks = await Promise.all(
    kasCandidates.map(async (f) => [f, await isKasFile(f)] as const),
  );
  const byDepth = (a: string, b: string) =>
    depthOf(root, a) - depthOf(root, b) || a.localeCompare(b);

  return {
    root,
    bblayersFiles: [...bblayersFiles].sort(byDepth),
    kasFiles: kasChecks
      .filter(([, ok]) => ok)
      .map(([f]) => f)
      .sort(byDepth),
    layerDirs: [...new Set(layerDirs)].sort((a, b) => a.localeCompare(b)),
  };
}

/**
 * Count `.bb` files under a layer (no parsing). Nested layers and excluded
 * directories are skipped so a recipe is only counted once.
 */
export async function countRecipes(layerDir: string, excludeDirs: string[] = []): Promise<number> {
  const excludes = new Set([...DEFAULT_EXCLUDES, ...excludeDirs]);
  const walk = async (dir: string, isRoot: boolean): Promise<number> => {
    if (!isRoot && (await isFile(path.join(dir, 'conf', 'layer.conf')))) return 0;
    const entries = await listDirs(dir);
    let n = 0;
    const subs: Promise<number>[] = [];
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!excludes.has(e.name) && !e.name.startsWith('.')) {
          subs.push(walk(path.join(dir, e.name), false));
        }
      } else if (e.isFile() && e.name.endsWith('.bb')) {
        n++;
      }
    }
    for (const s of await Promise.all(subs)) n += s;
    return n;
  };
  return walk(layerDir, true);
}
