# SCAD Online

An OpenSCAD viewer, editor and customizer built for **iPhone 16 / Safari**. Everything runs in the browser.
OpenSCAD itself is compiled to WebAssembly and runs inside a Web Worker, so no server is needed.

## Features

- **Open `.scad` files** from the Files app (iCloud Drive, On My iPhone, …). Pick several at once to make
  `include<>` / `use<>` files available.
- **Fast rendering** with OpenSCAD 2025 and the Manifold backend, off the main thread, with a Cancel button.
- **Touch 3D viewer** (three.js): one finger orbits, pinch zooms, two fingers pan. Fit / Top / Front / Right views
  and an edges overlay. Shows dimensions and triangle count.
- **Customizer**: top-level parameters with OpenSCAD's `// [min:max]`, `// [min:step:max]`, `// [a, b, c]` and
  `/* [Group] */` comments become sliders, dropdowns and checkboxes. Changing one re-renders the model.
- **Code editor** with a symbol bar (`{ } ( ) [ ] ; = " …`), undo/redo and automatic fixing of iOS "smart quotes".
- **Export**: share the STL through the iOS share sheet (Save to Files, AirDrop, slicer apps), download STL/.scad,
  save a PNG snapshot, or copy a share link that holds the code in the URL.
- **Console** with OpenSCAD output. Tap an error line to jump to that line in the code.
- **Installable & offline**: in Safari, tap Share → *Add to Home Screen*. After the first load the app works offline.
- Portrait uses tabs. Landscape puts the model beside the editor. Supports light/dark mode and the Dynamic Island
  and home-indicator safe areas.

## Running

It's a static site with no build step. Serve the folder over HTTP(S):

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

To use it on an iPhone, host it on any static host with HTTPS. For GitHub Pages: *Settings → Pages →
Deploy from a branch* and pick the branch and `/ (root)`. The service worker (offline mode) needs HTTPS.

## Limitations

- `text()` has no fonts bundled, so text will not render.
- Only 3D output is shown. Wrap 2D shapes in `linear_extrude()`.
- Very large models are limited by Safari's per-tab memory.

## Layout

```
index.html            app shell
css/app.css           styles (safe areas, light/dark, portrait/landscape)
js/app.js             UI, files, export, share links
js/viewer.js          three.js viewer + binary STL parser
js/worker.js          runs OpenSCAD WASM in a Web Worker
js/customizer.js      parameter parsing → -D overrides
js/examples.js        bundled examples
sw.js                 offline cache (bump VERSION when files change)
vendor/openscad/      openscad-wasm-prebuilt 1.2.0 (GPL-2.0-or-later)
vendor/three/         three.js r186 (MIT)
```

## License notes

The bundled OpenSCAD WebAssembly build is GPL-2.0-or-later (see `vendor/openscad/COPYING`).
three.js is MIT (see `vendor/three/LICENSE`).
