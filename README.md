# meta-lens

A VS Code extension that shows how a Yocto / OpenEmbedded project is put together: which
layers are loaded and in what order, which recipes they add, which bbappends modify them, and
which images were built.

It reads the files of the repository and nothing else. There is no need to source
`oe-init-build-env` or to run bitbake, so it works on a fresh clone.

Version 0.1.0 is a pre-release. Bug reports and odd repositories are welcome in the
[issues](https://github.com/oliviertanoh/meta-lens/issues).

<p>
  <img src="docs/images/sidebar.png" alt="meta-lens side panel" width="340">
  <!-- <img src="docs/images/overlay-chain.png" alt="Overlay chain of busybox" width="420"> -->
</p>

## What it shows

The side panel has four parts.

Project gives the file the layer list comes from (`bblayers.conf` or a kas file), the
`local.conf`, the Yocto release taken from `LAYERSERIES_COMPAT_core`, and the MACHINE and
DISTRO in use. A click on MACHINE or DISTRO opens its `.conf`.

Layers lists the layers in BBLAYERS order with their recipe count and priority, and flags the
ones with a problem: a path that does not exist, a `LAYERDEPENDS` that nothing provides, an
orphan bbappend. A click on a layer filters the recipes on it. Layers present on disk but
missing from BBLAYERS are listed apart, since BitBake ignores them.

Recipes shows by default only what your own layers add or modify. Switch to All for every
recipe. Has appends and Overlayed narrow the list to recipes with bbappends, or to recipe
names provided by several layers (the one BitBake uses is marked).

Built images lists what is in `tmp/deploy/images/<machine>/`, per machine, with the size of
each file.

Clicking a recipe that has bbappends opens the overlay chain next to the editor: the recipe,
then each bbappend in the order BitBake applies them, the files they replace through
`FILESEXTRAPATHS`, what they add to `SRC_URI`, and the orphan bbappends of the layers
involved.

The panel updates when a `.bb`, `.bbappend`, `.conf` or kas file changes, and after a build.
It holds a few MB of memory and starts no background process.

## Install

Download `meta-lens-0.1.0.vsix` from the
[releases](https://github.com/oliviertanoh/meta-lens/releases), then in VS Code use
Install from VSIX in the Extensions view, or:

```bash
code --install-extension meta-lens-0.1.0.vsix
```

Open a Yocto project folder. The panel opens in the Secondary Side Bar on the right (VS Code
1.106 and later, otherwise on the left). The logo in the editor title bar brings it back.

## Settings

| Setting | Default | Effect |
|---|---|---|
| `metaLens.location` | `right` | `left` puts the panel in the Activity Bar |
| `metaLens.projectLayers` | `[]` | Names of your layers, if the automatic guess is wrong |
| `metaLens.excludeDirs` | `[]` | Extra folders to skip while scanning |
| `metaLens.showEditorButton` | `true` | Logo button in the editor title bar |

## Limits

kas files are detected but not parsed yet, so for a kas project the layers come from a scan
of the folder. `BBMASK`, `PREFERRED_VERSION` and `PREFERRED_PROVIDER` are not read. Inline
Python (`${@...}`) is evaluated only for the usual `os.path` forms. It has been tested on
Linux only.

## Development

```bash
npm install
npm run watch       # rebuild on change, then F5 in VS Code
npm run check       # typecheck, lint, format, unit tests
npm run test:e2e    # VS Code integration tests (downloads VS Code once)
npx @vscode/vsce package
```

## License

MIT
