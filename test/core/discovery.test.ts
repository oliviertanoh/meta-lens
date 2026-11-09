import { describe, expect, it } from 'vitest';
import { discover, isKasFile } from '../../src/core/discovery';
import { fixture } from './helpers';

describe('discover', () => {
  it('finds bblayers.conf under build/ but never walks build/tmp', async () => {
    const r = await discover(fixture('poky-mini'));
    expect(r.bblayersFiles).toEqual([fixture('poky-mini', 'build', 'conf', 'bblayers.conf')]);
    expect(r.layerDirs).toEqual([fixture('poky-mini', 'meta'), fixture('poky-mini', 'meta-poky')]);
    expect(r.kasFiles).toEqual([]);
  });

  it('finds bblayers.conf in nested build dirs (builds/build-*), not under tmp/', async () => {
    const r = await discover(fixture('multi-build'));
    expect(r.bblayersFiles).toEqual([
      fixture('multi-build', 'builds', 'build-a', 'conf', 'bblayers.conf'),
      fixture('multi-build', 'builds', 'build-b', 'conf', 'bblayers.conf'),
    ]);
  });

  it('finds nested layers (meta-openembedded/meta-oe)', async () => {
    const r = await discover(fixture('bsp-custom'));
    expect(r.layerDirs).toEqual(
      [
        'sources/meta-acme',
        'sources/meta-acme-bsp',
        'sources/meta-openembedded/meta-oe',
        'sources/meta-unused',
        'sources/poky/meta',
        'sources/poky/meta-poky',
      ].map((p) => fixture('bsp-custom', ...p.split('/'))),
    );
  });

  it('detects kas files and ignores other YAML files', async () => {
    const r = await discover(fixture('kas-project'));
    expect(r.kasFiles).toEqual([fixture('kas-project', 'kas', 'project.yml')]);
    expect(r.bblayersFiles).toEqual([]);
    expect(r.layerDirs).toEqual([fixture('kas-project', 'meta-custom')]);
  });

  it('honours extra excludeDirs', async () => {
    const r = await discover(fixture('bsp-custom'), { excludeDirs: ['meta-openembedded'] });
    expect(r.layerDirs.some((d) => d.includes('meta-oe'))).toBe(false);
  });

  it('respects maxDepth', async () => {
    const r = await discover(fixture('bsp-custom'), { maxDepth: 1 });
    expect(r.layerDirs).toEqual([]);
  });

  it('returns empty results for a missing directory', async () => {
    const r = await discover(fixture('does-not-exist'));
    expect(r).toMatchObject({ bblayersFiles: [], kasFiles: [], layerDirs: [] });
  });
});

describe('isKasFile', () => {
  it('requires a header with a version', async () => {
    expect(await isKasFile(fixture('kas-project', 'kas', 'project.yml'))).toBe(true);
    expect(await isKasFile(fixture('kas-project', 'docker-compose.yml'))).toBe(false);
  });
});
