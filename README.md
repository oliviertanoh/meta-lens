# meta-lens

**Understand any Yocto repo in minutes: layers, recipes, bbappends and overlay chains, right in your VS Code sidebar.**

meta-lens is a VS Code extension that maps a Yocto/OpenEmbedded project as soon as you open it. You don't need a sourced environment or a bitbake run.
It shows your layers with their priorities and dependencies, every recipe with the bbappends applied to it, and the full overlay chain, so you can see which layer changes what, and why.

> Status: early development (v0.1 in progress).

## Features
- **Layers**: from `bblayers.conf` or kas files, with priority, recipe count and compatibility warnings
- **Recipes**: browse `recipes-*` and see each recipe's bbappends (with `%` wildcard matching)
- **Overlay chain**: base recipe → bbappends in priority order, with files shadowed through `FILESEXTRAPATHS`
- **Diagnostics**: orphan bbappends, overlayed recipes, `LAYERSERIES_COMPAT` mismatches
- **Static first**: works right after `git clone`, on any OS

## Mockup
https://claude.ai/artifact/4pk1v5wm3GEPo2eCeKXKnw

## Development
```bash
npm install
npm run watch
# press F5 in VS Code to launch the Extension Development Host
npm test          # unit tests (vitest)
npm run test:e2e  # VS Code smoke test (downloads VS Code on first run)
```

## License
MIT
