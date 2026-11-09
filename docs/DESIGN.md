# meta-lens — UI design

Dark VS Code window with a dedicated **meta-lens** icon (stacked layers) in the Activity Bar.
The extension must use theme colors and codicons; the mockup colors are only indicative.

## Sidebar — "META-LENS"
Title actions: Refresh, Filter.

### PROJECT (collapsible section)
Key/value grid:
| Key | Example |
|---|---|
| Config | `kas/acme-rpi4.yml` (or `build/conf/bblayers.conf`) |
| Release | scarthgap (5.0) |
| MACHINE | `raspberrypi4-64` |
| DISTRO | `acme-distro` |
| Mode | green dot + "Static scan · no bitbake env" (later: "Precise · bitbake env") |

### LAYERS (count in header)
One row per layer: layers icon, monospace name, optional ⚠ (deps/compat issue or orphan append), recipe count (muted), priority badge (pill).
Example: meta 5 · meta-poky 5 · meta-oe 6 · meta-networking 5 · meta-raspberrypi 9 · meta-acme-bsp 10 · meta-acme 10 ⚠

### RECIPES (count in header)
- Filter input "Filter recipes…"
- Filter chips: **Has appends** (active), Overlayed, Images
- Tree: `recipes-*` folder → recipe (`busybox` + muted "1.36.1 · meta") → its bbappends (`busybox_%.bbappend` + muted layer name)
- Right side badges: `+N` (number of bbappends, blue pill), `OVR` (overlayed recipe, yellow outline)

### IMAGES · MACHINES · DISTROS (collapsed)
Lists `*-image*.bb`, `conf/machine/*.conf`, `conf/distro/*.conf` with their layer.

## Editor
- Opening a `.bb` shows lines touched by appends with a subtle highlight; lines whose file is shadowed (e.g. `file://defconfig`) get a yellow highlight.
- CodeLens/inline hint under the recipe: "+ Extended by 2 bbappends · final value differs on 3 variables · **Show overlay chain**".

## OVERLAY CHAIN panel (right side or panel area)
Title: `OVERLAY CHAIN — <recipe>`
Vertical timeline, one step per file, in application order:
1. ● orange — `meta` · prio 5 · base recipe — `recipes-core/busybox/busybox_1.36.1.bb` — summary `SRC_URI = defconfig, syslog-startup.conf …`
2. ● blue — `meta-acme-bsp` · prio 10 · bbappend — `FILESEXTRAPATHS:prepend …`, `SRC_URI += "file://acme.cfg"`, "→ overrides files/defconfig"
3. ● blue — `meta-acme` · prio 10 · bbappend — `SRC_URI += "file://syslog-acme.patch"`

Then **FINAL VALUES**: SRC_URI additions, FILESEXTRAPATHS, overridden files.
Then a warning box: orphan bbappends of the layers involved.

## Status bar
`Yocto: scarthgap · raspberrypi4-64` · `7 layers · 1 284 recipes · 37 bbappends` · `2 warnings` (click → Problems view).
