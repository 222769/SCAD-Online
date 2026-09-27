// Runs OpenSCAD (WebAssembly) off the main thread so the UI stays responsive.
// A fresh OpenSCAD instance is created for every render: once callMain() hits an
// error the Emscripten runtime is left in an unusable state, and instances are
// cheap (~100 ms) to create.
import { createOpenSCAD } from '../vendor/openscad/openscad.js';

const NOISE = /^Could not initialize localization/;

self.onmessage = async (e) => {
  const { id, code, files = {}, defines = {} } = e.data;
  const log = [];
  const push = (line) => {
    if (NOISE.test(line)) return;
    log.push(line);
    self.postMessage({ id, type: 'log', line });
  };

  try {
    const started = performance.now();
    const openscad = await createOpenSCAD({ noInitialRun: true, print: push, printErr: push });
    const inst = openscad.getInstance();

    // Extra files (for include<> / use<>) live next to the main file.
    for (const [name, text] of Object.entries(files)) {
      mkdirs(inst.FS, '/work/' + name);
      inst.FS.writeFile('/work/' + name, text);
    }
    mkdirs(inst.FS, '/work/main.scad');
    inst.FS.writeFile('/work/main.scad', code);

    const args = ['/work/main.scad', '--backend=manifold', '--export-format=binstl', '-o', '/work/out.stl'];
    for (const [k, v] of Object.entries(defines)) args.push('-D', `${k}=${v}`);

    let rc;
    try {
      rc = inst.callMain(args);
    } catch (err) {
      rc = typeof err === 'number' ? 1 : (err?.status ?? 1);
      if (typeof err !== 'number' && err?.name !== 'ExitStatus') push(String(err?.message || err));
    }

    let stl = null;
    try { stl = inst.FS.readFile('/work/out.stl'); } catch { /* no output */ }

    if (rc !== 0 || !stl || stl.length < 84) {
      const is2d = log.some((l) => /top level object is not a 3D object/i.test(l));
      const empty = log.some((l) => /Current top level object is empty/i.test(l));
      let message = 'Render failed – see console for details.';
      if (is2d) message = 'The model is 2D. Wrap it in linear_extrude() to view it in 3D.';
      else if (empty) message = 'The model is empty (nothing to render).';
      self.postMessage({ id, type: 'error', message, ms: performance.now() - started });
      return;
    }

    const buf = stl.buffer.slice(stl.byteOffset, stl.byteOffset + stl.byteLength);
    self.postMessage({ id, type: 'done', stl: buf, ms: performance.now() - started }, [buf]);
  } catch (err) {
    self.postMessage({ id, type: 'error', message: String(err?.message || err) });
  }
};

function mkdirs(FS, filePath) {
  const parts = filePath.split('/').slice(1, -1);
  let p = '';
  for (const part of parts) {
    p += '/' + part;
    try { FS.mkdir(p); } catch { /* exists */ }
  }
}
