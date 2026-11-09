// Images already built: `${TMPDIR}/deploy/images/<machine>/`. Directory listing
// and stat only, never reads an image file.

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { expand, evaluate, parseAssignments } from './bbvars';
import type { BuiltImage, BuiltImageFile } from './model';

/** Timestamp BitBake puts in versioned deploy names: -20261016075738. */
const STAMP = /-\d{14}(?=[.-]|$)/;

/**
 * TMPDIR candidates for a build directory: the value set in local.conf /
 * auto.conf when there is one, otherwise the usual defaults.
 */
export async function tmpDirCandidates(topdir: string, confFiles: string[]): Promise<string[]> {
  const texts = await Promise.all(confFiles.map((f) => fs.readFile(f, 'utf8').catch(() => '')));
  const store = evaluate(
    texts.flatMap((t) => parseAssignments(t)),
    { TOPDIR: topdir },
  );
  const raw = store.raw('TMPDIR');
  if (raw) {
    const e = expand(raw, store.lookup);
    if (e.unresolved.length === 0) return [path.resolve(topdir, e.value)];
  }
  return ['tmp', 'tmp-glibc', 'tmp-musl'].map((d) => path.join(topdir, d));
}

async function listDir(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

async function statFile(file: string): Promise<{ size: number; mtime: number } | undefined> {
  try {
    const s = await fs.stat(file); // follows the "latest" symlinks
    return s.isFile() ? { size: s.size, mtime: s.mtimeMs } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Images of one machine directory. An image is identified by its
 * `<image>-<machine>[.rootfs].manifest` (the unversioned "latest" link);
 * its files are every unversioned file starting with the same link name.
 */
export async function imagesInMachineDir(dir: string, machine: string): Promise<BuiltImage[]> {
  const names = await listDir(dir);
  const images: BuiltImage[] = [];
  for (const manifest of names) {
    const m = /^(.+?)(\.rootfs)?\.manifest$/.exec(manifest);
    if (!m?.[1] || STAMP.test(manifest)) continue;
    const linkName = `${m[1]}${m[2] ?? ''}`;
    const suffix = `-${machine}`;
    const name = m[1].endsWith(suffix) ? m[1].slice(0, -suffix.length) : m[1];

    const files: BuiltImageFile[] = [];
    for (const f of names.filter((n) => n.startsWith(`${linkName}.`) && !STAMP.test(n)).sort()) {
      const st = await statFile(path.join(dir, f));
      if (st)
        files.push({ path: path.join(dir, f), name: f, ext: f.slice(linkName.length), ...st });
    }
    const builds = new Set(
      names
        .filter((n) => n.startsWith(`${linkName}-`) || n.startsWith(`${linkName}.`))
        .map((n) => STAMP.exec(n)?.[0])
        .filter(Boolean),
    ).size;
    const manifestFile = files.find((f) => f.name === manifest);
    images.push({
      machine,
      name,
      dir,
      files,
      builtAt: manifestFile?.mtime,
      builds,
    });
  }
  return images;
}

/** Every built image under `<tmpdir>/deploy/images`, sorted by machine then name. */
export async function findBuiltImages(tmpDirs: string[]): Promise<BuiltImage[]> {
  for (const tmp of tmpDirs) {
    const root = path.join(tmp, 'deploy', 'images');
    const machines = (await listDir(root)).sort();
    if (machines.length === 0) continue;
    const all = await Promise.all(machines.map((m) => imagesInMachineDir(path.join(root, m), m)));
    return all
      .flat()
      .sort((a, b) => a.machine.localeCompare(b.machine) || a.name.localeCompare(b.name));
  }
  return [];
}
