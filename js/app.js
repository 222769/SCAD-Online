import { Viewer } from './viewer.js';
import { parseParameters, toDefines } from './customizer.js';
import { EXAMPLES } from './examples.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

// ---------- Persistent state (per-device convenience only) ----------
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem('scad:' + key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('scad:' + key, JSON.stringify(value)); } catch { /* private mode / quota */ }
  },
};

const state = {
  fileName: store.get('fileName', 'untitled.scad'),
  code: store.get('code', null),
  libs: store.get('libs', {}),          // extra files for include<>/use<>
  paramValues: store.get('params', {}), // customizer overrides
  params: [],
  stl: null,
  renderId: 0,
  rendering: false,
  dirty: store.get('dirty', false),
};

const editor = $('#code');
const viewer = new Viewer($('#viewer'));

// ---------- Tabs ----------
function isWide() { return matchMedia('(orientation: landscape) and (min-width: 700px)').matches; }

function setTab(tab) {
  if (isWide() && tab === 'model') tab = document.body.dataset.side || 'code';
  document.body.dataset.tab = tab;
  if (tab !== 'model') document.body.dataset.side = tab;
  for (const b of $$('[role="tab"]')) {
    const sel = b.closest('.segmented') ? b.dataset.tab === document.body.dataset.side : b.dataset.tab === tab;
    b.setAttribute('aria-selected', String(sel));
  }
  if (tab === 'console') setBadge(null);
  if (tab === 'model') viewer.resize();
  store.set('tab', tab);
}
for (const b of $$('[role="tab"]')) b.addEventListener('click', () => setTab(b.dataset.tab));
matchMedia('(orientation: landscape) and (min-width: 700px)').addEventListener('change', () => {
  setTab(document.body.dataset.tab);
  requestAnimationFrame(() => viewer.resize());
});
document.body.dataset.side = 'code';

// ---------- Editor ----------
const KEYS = ['{', '}', '(', ')', '[', ']', ';', '=', '"', ',', '<', '>', '$', '#', '*', '/', '%', '!', '⇥', '↶', '↷'];
for (const k of KEYS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = k;
  b.setAttribute('aria-label', { '⇥': 'Indent', '↶': 'Undo', '↷': 'Redo' }[k] || `Insert ${k}`);
  // pointerdown + preventDefault keeps focus (and the keyboard) in the textarea.
  b.addEventListener('pointerdown', (e) => e.preventDefault());
  b.addEventListener('click', () => {
    editor.focus();
    if (k === '↶') document.execCommand('undo');
    else if (k === '↷') document.execCommand('redo');
    else insertText(k === '⇥' ? '  ' : k);
  });
  $('#keybar').appendChild(b);
}

function insertText(text) {
  // execCommand keeps the native undo stack intact; fall back to setRangeText.
  if (!document.execCommand('insertText', false, text)) {
    editor.setRangeText(text, editor.selectionStart, editor.selectionEnd, 'end');
    editor.dispatchEvent(new Event('input'));
  }
}

editor.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') { e.preventDefault(); insertText('  '); }
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); render(); }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); downloadScad(); }
});

let paramTimer;
editor.addEventListener('input', () => {
  // iOS "Smart Punctuation" can sneak curly quotes into code; OpenSCAD rejects them.
  if (/[“”‘’]/.test(editor.value)) {
    const pos = editor.selectionStart;
    editor.value = editor.value.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
    editor.setSelectionRange(pos, pos);
  }
  state.code = editor.value;
  store.set('code', state.code);
  setDirty(true);
  clearTimeout(paramTimer);
  paramTimer = setTimeout(refreshParams, 400);
});

function setDirty(d) {
  state.dirty = d;
  store.set('dirty', d);
  $('#dirty-dot').hidden = !d;
}

function setFile(name, code, { resetParams = true } = {}) {
  state.fileName = name;
  state.code = code;
  editor.value = code;
  $('#file-name').textContent = name;
  document.title = `${name} – SCAD Online`;
  store.set('fileName', name);
  store.set('code', code);
  if (resetParams) { state.paramValues = {}; store.set('params', {}); }
  setDirty(false);
  refreshParams();
  state.stl = null;
  viewer.clear();
  $('#stats').hidden = true;
  $('#empty-hint').hidden = false;
}

// ---------- Customizer ----------
function refreshParams() {
  state.params = parseParameters(editor.value);
  const known = new Set(state.params.map((p) => p.name));
  for (const k of Object.keys(state.paramValues)) if (!known.has(k)) delete state.paramValues[k];
  buildParamsUI();
}

function buildParamsUI() {
  const root = $('#params');
  root.textContent = '';
  if (!state.params.length) {
    root.innerHTML = `<p class="no-params">No customizable parameters found.<br><br>
      Add top-level variables like<br><code>width = 20; // [5:100]</code><br>before any module to control them here.</p>`;
    $('#reset-params').hidden = true;
    return;
  }
  $('#reset-params').hidden = false;
  const groups = new Map();
  for (const p of state.params) {
    if (!groups.has(p.group)) groups.set(p.group, []);
    groups.get(p.group).push(p);
  }
  for (const [name, params] of groups) {
    const g = el('div', 'param-group');
    g.appendChild(el('h3', '', name));
    const list = el('div', 'param-list');
    for (const p of params) list.appendChild(paramRow(p));
    g.appendChild(list);
    root.appendChild(g);
  }
}

function paramRow(p) {
  const row = el('div', 'param ' + p.type);
  const head = el('div', 'param-head');
  const label = el('label', 'param-name', p.name.replace(/_/g, ' '));
  const id = 'param-' + p.name;
  label.htmlFor = id;
  head.appendChild(label);
  row.appendChild(head);
  const current = p.name in state.paramValues ? state.paramValues[p.name] : p.value;
  const commit = (v) => { state.paramValues[p.name] = v; store.set('params', state.paramValues); scheduleAutoRender(); };

  switch (p.type) {
    case 'bool': {
      const cb = el('input');
      cb.type = 'checkbox'; cb.id = id; cb.checked = !!current;
      cb.addEventListener('change', () => commit(cb.checked));
      head.appendChild(cb);
      break;
    }
    case 'range': {
      const val = el('span', 'param-value', String(current));
      head.appendChild(val);
      const r = el('input');
      Object.assign(r, { type: 'range', id, min: p.min, max: p.max, step: p.step, value: current });
      r.addEventListener('input', () => { val.textContent = r.value; });
      r.addEventListener('change', () => commit(Number(r.value)));
      row.appendChild(r);
      break;
    }
    case 'number': {
      const n = el('input');
      Object.assign(n, { type: 'number', id, value: current, step: 'any', inputMode: 'decimal' });
      n.addEventListener('change', () => n.value !== '' && commit(Number(n.value)));
      row.appendChild(n);
      break;
    }
    case 'string': {
      const t = el('input');
      Object.assign(t, { type: 'text', id, value: current, autocapitalize: 'off', autocomplete: 'off' });
      t.setAttribute('autocorrect', 'off');
      t.addEventListener('change', () => commit(t.value));
      row.appendChild(t);
      break;
    }
    case 'select': {
      const s = el('select');
      s.id = id;
      for (const o of p.options) {
        const opt = el('option', '', o.label);
        opt.value = o.value;
        s.appendChild(opt);
      }
      s.value = String(current);
      s.addEventListener('change', () => commit(s.value));
      row.appendChild(s);
      break;
    }
    case 'vector': {
      const wrap = el('div', 'vec');
      const vals = [...current];
      vals.forEach((v, i) => {
        const n = el('input');
        Object.assign(n, { type: 'number', value: v, step: 'any', inputMode: 'decimal' });
        n.setAttribute('aria-label', `${p.name} [${i}]`);
        if (i === 0) n.id = id;
        n.addEventListener('change', () => { vals[i] = Number(n.value); commit([...vals]); });
        wrap.appendChild(n);
      });
      row.appendChild(wrap);
      break;
    }
  }
  if (p.description) row.appendChild(el('div', 'param-desc', p.description));
  return row;
}

let autoTimer;
function scheduleAutoRender() {
  if (!$('#auto-render').checked) return;
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => render({ keepCamera: true }), 250);
}
$('#auto-render').checked = store.get('autoRender', true);
$('#auto-render').addEventListener('change', (e) => store.set('autoRender', e.target.checked));
$('#reset-params').addEventListener('click', () => {
  state.paramValues = {};
  store.set('params', {});
  buildParamsUI();
  scheduleAutoRender();
});

// ---------- Rendering ----------
let worker = null;
function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = onWorkerMessage;
    worker.onerror = (e) => {
      finishRender();
      showStatus('The rendering engine failed to load. ' + (e.message || ''), true);
      worker = null;
    };
  }
  return worker;
}

let startedAt = 0, tick;
let pendingKeepCamera = false;
function render({ keepCamera = false } = {}) {
  if (state.rendering) {
    // Restart with the latest code rather than queueing stale renders.
    cancelRender(false);
  }
  const code = editor.value;
  state.rendering = true;
  pendingKeepCamera = keepCamera && !!state.stl;
  const id = ++state.renderId;
  clearConsole();
  logLine(`Rendering ${state.fileName}…`, 'dim');
  $('#render-btn').disabled = true;
  startedAt = performance.now();
  showStatus('Rendering…');
  clearInterval(tick);
  tick = setInterval(() => {
    $('#status-text').textContent = `Rendering… ${((performance.now() - startedAt) / 1000).toFixed(1)}s`;
  }, 100);
  getWorker().postMessage({ id, code, files: state.libs, defines: toDefines(state.params, state.paramValues) });
}

let counts = { err: 0, warn: 0 };
function onWorkerMessage(e) {
  const msg = e.data;
  if (msg.id !== state.renderId) return;
  if (msg.type === 'log') return logLine(msg.line);
  finishRender();
  if (msg.type === 'done') {
    state.stl = msg.stl;
    const { triangles, size } = viewer.loadSTL(msg.stl, { keepCamera: pendingKeepCamera });
    $('#empty-hint').hidden = true;
    const f = (n) => +n.toFixed(2);
    $('#stats').textContent = `${f(size.x)} × ${f(size.y)} × ${f(size.z)} mm\n${triangles.toLocaleString()} triangles`;
    $('#stats').style.whiteSpace = 'pre';
    $('#stats').hidden = false;
    logLine(`Done in ${(msg.ms / 1000).toFixed(2)}s.`, 'dim');
    hideStatus();
    if (counts.warn || counts.err) setBadge(counts.err ? 'err' : 'warn');
  } else {
    logLine(msg.message, 'err');
    showStatus(msg.message, true);
    setBadge('err');
  }
}

function finishRender() {
  state.rendering = false;
  clearInterval(tick);
  $('#render-btn').disabled = false;
}

function cancelRender(announce = true) {
  // The WASM call is synchronous inside the worker, so terminating is the only way to stop it.
  if (worker) { worker.terminate(); worker = null; }
  state.renderId++;
  finishRender();
  if (announce) { hideStatus(); logLine('Render cancelled.', 'dim'); }
}

$('#render-btn').addEventListener('click', () => {
  render();
  if (!isWide() && document.body.dataset.tab !== 'customize') setTab('model');
});

let statusTimer;
function showStatus(text, isError = false) {
  clearTimeout(statusTimer);
  $('#status').hidden = false;
  $('#status').classList.toggle('error', isError);
  $('#status-text').textContent = text;
  $('#cancel-btn').textContent = isError ? 'Details' : 'Cancel';
  $('#cancel-btn').onclick = isError ? () => { hideStatus(); setTab('console'); } : () => cancelRender();
  if (isError) statusTimer = setTimeout(hideStatus, 8000);
}
function hideStatus() { $('#status').hidden = true; }

// ---------- Console ----------
function clearConsole() { $('#console').textContent = ''; counts = { err: 0, warn: 0 }; }
function logLine(line, cls) {
  const div = el('div');
  if (!cls) {
    if (/^(ERROR|Parser error|Assertion|.*\bfailed\b)/i.test(line)) cls = 'err';
    else if (/^(WARNING|DEPRECATED)/i.test(line)) cls = 'warn';
    else if (/^ECHO:/.test(line)) cls = 'echo';
  }
  if (cls === 'err') counts.err++;
  if (cls === 'warn') counts.warn++;
  if (cls) div.className = cls;
  div.textContent = line;
  const m = line.match(/in file (?:\/work\/)?([^,]+), line (\d+)/);
  if (m) {
    div.classList.add('jump');
    div.title = 'Show in code';
    div.addEventListener('click', () => {
      if (m[1] !== 'main.scad') return;
      jumpToLine(Number(m[2]));
    });
  }
  $('#console').appendChild(div);
  $('#console').scrollTop = $('#console').scrollHeight;
}
function setBadge(kind) {
  for (const b of $$('.badge')) {
    b.hidden = !kind;
    b.classList.toggle('warn', kind === 'warn');
  }
}
function jumpToLine(n) {
  setTab('code');
  const lines = editor.value.split('\n');
  const start = lines.slice(0, n - 1).reduce((a, l) => a + l.length + 1, 0);
  editor.focus();
  editor.setSelectionRange(start, start + (lines[n - 1] || '').length);
  const lh = parseFloat(getComputedStyle(editor).lineHeight) || 20;
  editor.scrollTop = Math.max(0, (n - 4) * lh);
}

// ---------- Viewer tools ----------
for (const b of $$('[data-view]')) b.addEventListener('click', () => viewer.fit(b.dataset.view));
$('#edges-btn').addEventListener('click', (e) => {
  const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
  e.currentTarget.setAttribute('aria-pressed', String(on));
  viewer.setEdges(on);
});
// Stop Safari's page pinch-zoom from fighting the 3D controls.
for (const ev of ['gesturestart', 'gesturechange']) $('#viewer').addEventListener(ev, (e) => e.preventDefault());

// ---------- Files ----------
const APP_VERSION = 3;
$('#app-version').textContent = `SCAD Online v${APP_VERSION}`;

for (const input of $$('.file-overlay')) {
  input.addEventListener('change', async () => {
    const files = [...(input.files || [])];
    input.value = '';
    if (menu.open) menu.close();
    if (!files.length) return;
    try {
      await openFiles(files);
    } catch (err) {
      toast(`Couldn't read ${files[0].name}: ${err?.message || err}`);
    }
  });
}

function readText(file) {
  if (file.text) return file.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

async function openFiles(files) {
  toast(`Reading ${files[0].name}…`);
  const entries = await Promise.all(files.map(async (f) => [f.name, await readText(f)]));
  const scad = entries.filter(([n]) => /\.scad$/i.test(n));
  const pool = scad.length ? scad : entries;
  // The main file is the one no other opened file includes.
  const referenced = (name) => pool.some(([, t]) => new RegExp(`(include|use)\\s*<[^>]*\\b${escapeRe(name)}>`).test(t));
  const main = pool.find(([n]) => !referenced(n)) || pool[0];
  const libs = {};
  for (const [n, t] of entries) if (n !== main[0]) libs[n] = t;
  state.libs = libs;
  store.set('libs', libs);
  setFile(main[0], main[1]);
  updateLibsNote();
  toast(entries.length > 1 ? `Opened ${main[0]} + ${entries.length - 1} file(s)` : `Opened ${main[0]}`);
  render();
  if (!isWide()) setTab('model');
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function updateLibsNote() {
  const names = Object.keys(state.libs);
  $('#libs-group').hidden = !names.length;
  $('#libs-note').textContent = names.length ? `Extra files available to include/use: ${names.join(', ')}` : '';
}

// Drag & drop (iPad, desktop Safari).
let dragDepth = 0;
addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  const files = [...(e.dataTransfer?.files || [])];
  if (files.length) openFiles(files);
});

function baseName() { return state.fileName.replace(/\.[^.]+$/, '') || 'model'; }

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = el('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function stlFile() {
  return new File([state.stl], baseName() + '.stl', { type: 'model/stl' });
}

async function shareStl() {
  const file = stlFile();
  // iOS share sheet: Save to Files, AirDrop, open in a slicer app, …
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: file.name }); } catch (e) { if (e.name !== 'AbortError') toast('Sharing failed'); }
  } else {
    saveBlob(file, file.name);
  }
}

function downloadScad() {
  saveBlob(new Blob([editor.value], { type: 'text/plain' }), state.fileName.endsWith('.scad') ? state.fileName : state.fileName + '.scad');
  setDirty(false);
}

async function snapshot() {
  const url = viewer.snapshot();
  const blob = await (await fetch(url)).blob();
  const file = new File([blob], baseName() + '.png', { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); } catch { /* cancelled */ }
  } else saveBlob(file, file.name);
}

// ---------- Share links (#code=…) ----------
const b64url = {
  enc: (bytes) => {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  dec: (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
};
async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}
async function encodeShare(code) {
  const raw = new TextEncoder().encode(code);
  if ('CompressionStream' in window) return 'z' + b64url.enc(await pipe(raw, new CompressionStream('deflate-raw')));
  return 'p' + b64url.enc(raw);
}
async function decodeShare(s) {
  const bytes = b64url.dec(s.slice(1));
  const out = s[0] === 'z' ? await pipe(bytes, new DecompressionStream('deflate-raw')) : bytes;
  return new TextDecoder().decode(out);
}

async function copyLink() {
  const enc = await encodeShare(editor.value);
  const url = `${location.origin}${location.pathname}#name=${encodeURIComponent(state.fileName)}&code=${enc}`;
  if (navigator.share && !isWide()) {
    try { await navigator.share({ url, title: state.fileName }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { prompt('Copy this link', url); }
}

// ---------- Menus ----------
const menu = $('#menu');
$('#menu-btn').addEventListener('click', () => {
  for (const b of $$('.needs-model')) b.disabled = !state.stl;
  updateLibsNote();
  menu.showModal();
});
menu.addEventListener('click', (e) => { if (e.target === menu) menu.close('cancel'); });
menu.addEventListener('close', () => {
  const v = menu.returnValue;
  menu.returnValue = '';
  switch (v) {
    case 'new':
      if (state.dirty && !confirm('Discard unsaved changes?')) return;
      state.libs = {}; store.set('libs', {});
      setFile('untitled.scad', '// New model\n\ncube(10);\n');
      setTab('code');
      break;
    case 'examples': $('#examples').showModal(); break;
    case 'share-stl': shareStl(); break;
    case 'download-stl': saveBlob(stlFile(), baseName() + '.stl'); break;
    case 'download-scad': downloadScad(); break;
    case 'snapshot': snapshot(); break;
    case 'link': copyLink(); break;
    case 'clear-libs': state.libs = {}; store.set('libs', {}); toast('Extra files removed'); break;
  }
});

const exDialog = $('#examples');
for (const [i, ex] of EXAMPLES.entries()) {
  const b = el('button', '', ex.name);
  b.value = String(i);
  $('#examples-list').appendChild(b);
}
exDialog.addEventListener('click', (e) => { if (e.target === exDialog) exDialog.close(''); });
exDialog.addEventListener('close', () => {
  const v = exDialog.returnValue;
  exDialog.returnValue = '';
  if (v === '') return;
  if (state.dirty && !confirm('Discard unsaved changes?')) return;
  const ex = EXAMPLES[Number(v)];
  state.libs = {}; store.set('libs', {});
  setFile(ex.name.toLowerCase().replace(/\s+/g, '-') + '.scad', ex.code);
  render();
  if (!isWide()) setTab('model');
});

// ---------- Helpers ----------
function el(tag, cls = '', text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
let toastTimer;
function toast(text) {
  const t = $('#toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}

// ---------- Boot ----------
async function boot() {
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get('code')) {
    try {
      const code = await decodeShare(hash.get('code'));
      state.libs = {}; store.set('libs', {});
      setFile(hash.get('name') || 'shared.scad', code);
      history.replaceState(null, '', location.pathname + location.search);
      render();
      setTab('model');
      return;
    } catch { toast('Could not read the shared link'); }
  }
  if (state.code !== null) {
    const dirty = state.dirty;
    setFile(state.fileName, state.code, { resetParams: false });
    setDirty(dirty);
    updateLibsNote();
  } else {
    setFile('parametric-box.scad', EXAMPLES[0].code);
  }
  setTab(store.get('tab', 'model'));
  render();
}
boot();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
    .then((reg) => reg.update())
    .catch(() => {});
  // When a newer service worker takes over, reload once so the page runs the new code.
  let reloaded = false;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloaded) { reloaded = true; location.reload(); }
  });
}
