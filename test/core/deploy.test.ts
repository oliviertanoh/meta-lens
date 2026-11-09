import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findBuiltImages, tmpDirCandidates } from '../../src/core/deploy';
import { loadProject } from '../../src/core/project';
import { fixture } from './helpers';

const deploy = (...p: string[]) => fixture('bsp-custom', 'build', 'tmp', 'deploy', 'images', ...p);

describe('tmpDirCandidates', () => {
  it('uses the usual defaults when TMPDIR is not set', async () => {
    const top = fixture('bsp-custom', 'build');
    expect(await tmpDirCandidates(top, [path.join(top, 'conf', 'local.conf')])).toEqual([
      path.join(top, 'tmp'),
      path.join(top, 'tmp-glibc'),
      path.join(top, 'tmp-musl'),
    ]);
  });

  it('follows TMPDIR from local.conf', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'meta-lens-tmpdir-'));
    try {
      const conf = path.join(dir, 'local.conf');
      await fs.writeFile(conf, 'TMPDIR = "${TOPDIR}/../shared-tmp"\n');
      expect(await tmpDirCandidates('/w/build', [conf])).toEqual([path.resolve('/w/shared-tmp')]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('findBuiltImages (bsp-custom)', () => {
  it('finds images per machine, both naming styles, ignoring kernels and timestamps', async () => {
    const images = await findBuiltImages([fixture('bsp-custom', 'build', 'tmp')]);
    expect(images.map((i) => [i.machine, i.name, i.builds, i.files.map((f) => f.ext)])).toEqual([
      ['acme-rpi4', 'acme-image', 2, ['.manifest', '.wic', '.wic.bmap']],
      ['qemuarm64', 'core-image-minimal', 0, ['.ext4', '.manifest']],
    ]);
    const wic = images[0]!.files.find((f) => f.ext === '.wic')!;
    expect(wic.path).toBe(deploy('acme-rpi4', 'acme-image-acme-rpi4.rootfs.wic'));
    expect(wic.size).toBe(2048);
    expect(images[0]!.builtAt).toBeGreaterThan(0);
  });

  it('returns nothing when nothing was built', async () => {
    expect(await findBuiltImages([fixture('poky-mini', 'build', 'tmp')])).toEqual([]);
  });
});

describe('built images in the project', () => {
  it('links each image to its recipe', async () => {
    const p = await loadProject(fixture('bsp-custom'));
    expect(p.builtImages.map((i) => [i.name, i.recipe && path.basename(i.recipe)])).toEqual([
      ['acme-image', 'acme-image.bb'],
      ['core-image-minimal', 'core-image-minimal.bb'],
    ]);
  });
});
