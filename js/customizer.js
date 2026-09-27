// Minimal OpenSCAD Customizer: finds top-level parameters (before the first
// module/function) and their `// [..]` hints, following OpenSCAD's conventions.
//
//   width = 20;        // [5:100]        -> slider
//   holes = 4;         // [2:2:12]       -> slider with step
//   style = "round";   // [round, square] -> dropdown
//   hollow = true;                        -> checkbox
//   /* [Hidden] */                        -> everything after is ignored

export function parseParameters(code) {
  const params = [];
  const lines = code.split('\n');
  let group = 'Parameters';
  let depth = 0;
  let inBlock = false;
  let prevComment = '';

  for (const raw of lines) {
    const line = raw.trim();

    const groupMatch = line.match(/^\/\*\s*\[([^\]]+)\]\s*\*\/$/);
    if (groupMatch) { group = groupMatch[1].trim(); prevComment = ''; continue; }

    if (inBlock) { if (line.includes('*/')) inBlock = false; continue; }
    if (line.startsWith('/*')) { if (!line.includes('*/')) inBlock = true; continue; }

    if (depth === 0 && /^(module|function)\b/.test(line)) break;

    if (depth === 0) {
      const m = line.match(/^([A-Za-z_$][\w$]*)\s*=\s*([^;]+);\s*(?:\/\/\s*(.*))?$/);
      if (m && !m[1].startsWith('$') && group.toLowerCase() !== 'hidden') {
        const p = makeParam(m[1], m[2].trim(), (m[3] || '').trim(), prevComment, group);
        if (p) params.push(p);
      }
    }

    if (line.startsWith('//')) prevComment = line.replace(/^\/\/\s*/, '');
    else prevComment = '';

    depth += countBraces(line);
    if (depth < 0) depth = 0;
  }
  return params;
}

function countBraces(line) {
  let d = 0, inStr = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '/' && line[i + 1] === '/') break;
    else if (c === '{') d++;
    else if (c === '}') d--;
  }
  return d;
}

function makeParam(name, valueSrc, hint, description, group) {
  const base = { name, group, description, default: valueSrc };
  if (/^(true|false)$/.test(valueSrc)) return { ...base, type: 'bool', value: valueSrc === 'true' };

  if (/^-?\d*\.?\d+(e[-+]?\d+)?$/i.test(valueSrc)) {
    const value = parseFloat(valueSrc);
    const range = hint.match(/^\[\s*(-?[\d.]+)\s*:\s*(-?[\d.]+)\s*(?::\s*(-?[\d.]+))?\s*\]/);
    if (range) {
      const [a, b, c] = range.slice(1).map((x) => (x === undefined ? undefined : parseFloat(x)));
      const [min, step, max] = c === undefined ? [a, undefined, b] : [a, b, c];
      return { ...base, type: 'range', value, min, max, step: step ?? guessStep(value, min, max) };
    }
    const opts = parseOptions(hint);
    if (opts) return { ...base, type: 'select', value: String(value), options: opts, numeric: true };
    const single = hint.match(/^\[\s*(-?[\d.]+)\s*\]/);
    if (single) return { ...base, type: 'range', value, min: 0, max: parseFloat(single[1]), step: guessStep(value, 0, parseFloat(single[1])) };
    return { ...base, type: 'number', value };
  }

  const str = valueSrc.match(/^"((?:[^"\\]|\\.)*)"$/);
  if (str) {
    const opts = parseOptions(hint);
    if (opts) return { ...base, type: 'select', value: str[1], options: opts, numeric: false };
    return { ...base, type: 'string', value: str[1] };
  }

  if (/^\[\s*-?[\d.]+(\s*,\s*-?[\d.]+)*\s*\]$/.test(valueSrc)) {
    return { ...base, type: 'vector', value: valueSrc.slice(1, -1).split(',').map((s) => parseFloat(s)) };
  }
  return null; // expressions are left to the source code
}

function parseOptions(hint) {
  const m = hint.match(/^\[(.+)\]/);
  if (!m || m[1].includes(':') && !m[1].includes(',')) return null;
  if (!m[1].includes(',')) return null;
  return m[1].split(',').map((s) => {
    const [v, label] = s.split(':').map((x) => x.trim().replace(/^"|"$/g, ''));
    return { value: v, label: label ?? v };
  });
}

function guessStep(value, min, max) {
  const decimals = (n) => (String(n).split('.')[1] || '').length;
  const d = Math.max(decimals(value), decimals(min), decimals(max));
  if (d > 0) return Math.pow(10, -d);
  return max - min > 1000 ? 10 : 1;
}

/** Converts current UI values to `-D name=value` definitions for OpenSCAD. */
export function toDefines(params, values) {
  const out = {};
  for (const p of params) {
    if (!(p.name in values)) continue;
    const v = values[p.name];
    switch (p.type) {
      case 'bool': out[p.name] = v ? 'true' : 'false'; break;
      case 'range': case 'number': out[p.name] = String(Number(v)); break;
      case 'select': out[p.name] = p.numeric ? String(Number(v)) : JSON.stringify(String(v)); break;
      case 'string': out[p.name] = JSON.stringify(String(v)); break;
      case 'vector': out[p.name] = '[' + v.map(Number).join(',') + ']'; break;
    }
  }
  return out;
}
