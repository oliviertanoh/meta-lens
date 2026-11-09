# Changelog

## 0.1.0 (pre-release)

First public version. meta-lens reads the repository files only: no sourced environment, no
bitbake run.

Side panel, in the Secondary Side Bar by default:

- Project: config source (`bblayers.conf` or kas file), `local.conf` and `auto.conf`, Yocto
  release from `LAYERSERIES_COMPAT_core`, MACHINE and DISTRO linked to their `.conf`.
- Layers in BBLAYERS order with recipe count, priority and problems (missing path, missing
  `LAYERDEPENDS`, orphan bbappend). A click filters the recipes on the layer. Layers on disk
  but not in BBLAYERS are listed apart.
- Recipes added or modified by your layers by default, or all of them. Filters for recipes
  with bbappends and for overlayed recipes.
- Images found in `tmp/deploy/images/<machine>/`, with their files.

Overlay chain next to the editor: the recipe then its bbappends in BitBake's order, files
replaced through `FILESEXTRAPATHS`, `SRC_URI` additions, orphan bbappends, which overlayed
recipe BitBake uses, legacy `_append` syntax.

Parsing:

- `bblayers.conf` with `${TOPDIR}`, `${BSPDIR}` and the usual `${@os.path...}` forms.
  Absolute paths written on another machine are found again in the workspace.
- `layer.conf`, `BBFILES`, `BBFILES_DYNAMIC`, and the per-collection `BBFILES` form used by
  meta-raspberrypi.
- bbappend matching follows BitBake's `cooker.py`, `%` wildcard included.

Not done yet: kas files are detected but not parsed (layers come from a folder scan);
`BBMASK`, `PREFERRED_VERSION` and `PREFERRED_PROVIDER` are not read; tested on Linux only.
