# Changelog

## 0.1.0 (pre-release)

First public version, for early testers. Static analysis only: no sourced
environment, no bitbake run.

### Sidebar (Secondary Side Bar by default)
- **Project**: config source (`bblayers.conf` or kas file), `local.conf` / `auto.conf`,
  Yocto release from `LAYERSERIES_COMPAT_core`, MACHINE and DISTRO with a link to their
  `.conf` definition.
- **Layers**: BBLAYERS order, recipe count, priority, warnings (missing layer, missing
  `LAYERDEPENDS`, orphan bbappend...). Click a layer to see its recipes. Layers present on
  disk but not in BBLAYERS are listed, greyed.
- **Recipes**: project recipes by default (created or extended by your layers), or all of
  them. Filters: Has appends, Overlayed. `+N` bbappend count, `OVR` badge.
- **Built images**: images found in `tmp/deploy/images/<machine>/`, with their files.

### Overlay chain panel
- Base recipe then bbappends in BitBake's order, with priorities and key assignments.
- Files overridden through `FILESEXTRAPATHS`, final `SRC_URI` additions, orphan bbappends,
  overlay winner, legacy `_append` syntax flagged.

### Parsing
- `bblayers.conf` with `${TOPDIR}`, `${BSPDIR}` and the usual `${@os.path...}` idioms;
  absolute paths from another machine are relocated.
- `layer.conf`, `BBFILES`, `BBFILES_DYNAMIC` and the per-collection idiom used by
  meta-raspberrypi.
- bbappend matching identical to BitBake's `cooker.py`, including the `%` wildcard.

### Known limitations
- kas files are detected but not parsed: layers are found by scanning the folder.
- `BBMASK`, `PREFERRED_VERSION` and `PREFERRED_PROVIDER` are not read.
- Tested on Linux only so far.
