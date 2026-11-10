import * as THREE from 'three';
import { RoundedBoxGeometry } from '../vendor/addons/RoundedBoxGeometry.js';

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (v - a) / (b - a);
export const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const TAU = Math.PI * 2;

export function wrapAngle(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}
export function dampAngle(a, b, lambda, dt) {
  return a + wrapAngle(b - a) * (1 - Math.exp(-lambda * dt));
}

export function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}
export function valueNoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
export function fbm(x, y, octaves = 4) {
  let sum = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq);
    freq *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export function canvasTexture(canvas, { repeat, srgb = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  t.anisotropy = 8;
  return t;
}

export function makeAsphaltTextures() {
  const size = 512;
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  g.fillStyle = '#33363a'; g.fillRect(0, 0, size, size);
  const img = g.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 26;
    img.data[i] = clamp(img.data[i] + n, 0, 255);
    img.data[i + 1] = clamp(img.data[i + 1] + n, 0, 255);
    img.data[i + 2] = clamp(img.data[i + 2] + n + 2, 0, 255);
  }
  g.putImageData(img, 0, 0);
  for (let i = 0; i < 1400; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = Math.random() * 1.9 + 0.3;
    g.fillStyle = `rgba(${170 + Math.random() * 40},${170 + Math.random() * 40},${165 + Math.random() * 40},${0.05 + Math.random() * 0.12})`;
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }
  // faint longitudinal tyre polish
  const grad = g.createLinearGradient(0, 0, size, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.22, 'rgba(255,255,255,0.035)');
  grad.addColorStop(0.3, 'rgba(0,0,0,0.05)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.02)');
  grad.addColorStop(0.7, 'rgba(0,0,0,0.05)');
  grad.addColorStop(0.78, 'rgba(255,255,255,0.035)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, size, size);
  // cracks
  g.strokeStyle = 'rgba(15,15,17,0.35)'; g.lineWidth = 1;
  for (let k = 0; k < 9; k++) {
    g.beginPath();
    let x = Math.random() * size, y = Math.random() * size;
    g.moveTo(x, y);
    for (let s = 0; s < 8; s++) { x += (Math.random() - 0.5) * 22; y += (Math.random () - 0.5) * 22; g.lineTo(x, y); }
    g.stroke();
  }
  const map = canvasTexture(c, { repeat: [2, 2] });
  return map;
}

export function makeConcreteTexture(shade = 140) {
  const size = 256;
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  g.fillStyle = `rgb(${shade},${shade},${shade + 2})`; g.fillRect(0, 0, size, size);
  const img = g.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 18;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = 'rgba(70,70,72,0.4)'; g.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    g.beginPath(); g.moveTo((i / 4) * size, 0); g.lineTo((i / 4) * size, size); g.stroke();
    g.beginPath(); g.moveTo(0, (i / 4) * size); g.lineTo(size, (i / 4) * size); g.stroke();
  }
  return canvasTexture(c, { repeat: [10, 10] });
}

export function makeGravelTexture() {
  const size = 256;
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  g.fillStyle = '#776b58'; g.fillRect(0, 0, size, size);
  for (let i = 0; i < 2400; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = Math.random() * 2.2 + 0.4;
    const v = 90 + Math.random() * 90;
    g.fillStyle = `rgba(${v},${v * 0.9},${v * 0.75},${0.5 + Math.random() * 0.4})`;
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }
  return canvasTexture(c, { repeat: [3, 30] });
}

export function makeScuffTexture() {
  const c = makeCanvas(256, 256);
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 45; i++) {
    g.strokeStyle = `rgba(0,0,0,${Math.random() * 0.07})`;
    g.lineWidth = Math.random() * 2 + 0.4;
    g.beginPath();
    g.moveTo(Math.random() * 256, Math.random() * 256);
    g.lineTo(Math.random() * 256, Math.random() * 256);
    g.stroke();
  }
  return canvasTexture(c);
}

export function makeBuildingTextures(rand = Math.random, style = 'office') {
  const w = 256, h = 512;
  const c = makeCanvas(w, h);
  const e = makeCanvas(w, h);
  const g = c.getContext('2d');
  const ge = e.getContext('2d');
  ge.fillStyle = '#000'; ge.fillRect(0, 0, w, h);
  const base = style === 'apartment' ? '#cfc3ac' : style === 'industrial' ? '#9aa0a3' : '#b8bcc0';
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  // subtle panel noise
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.025})`;
    g.fillRect(Math.random() * w, Math.random() * h, Math.random() * 14, Math.random() * 3);
  }
  const cols = style === 'industrial' ? 4 : 5;
  const rows = style === 'industrial' ? 5 : 10;
  const cw = w / cols, ch = h / rows;
  const litCols = ['#ffd38a', '#ffe9bd', '#bcd6e8'];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const px = x * cw + cw * 0.18, py = y * ch + ch * 0.18;
      const ww = cw * 0.64, wh = ch * (style === 'industrial' ? 0.5 : 0.56);
      g.fillStyle = '#303d48'; g.fillRect(px, py, ww, wh);
      g.fillStyle = 'rgba(160,200,225,0.18)'; g.fillRect(px, py, ww, wh * 0.45);
      if (rand() < 0.34) {
        ge.fillStyle = litCols[Math.floor(rand() * litCols.length)];
        ge.globalAlpha = 0.55 + rand() * 0.45;
        ge.fillRect(px, py, ww, wh);
        ge.globalAlpha = 1;
      }
    }
  }
  if (style === 'industrial') {
    g.fillStyle = 'rgba(60,65,68,0.35)';
    for (let i = 0; i < 5; i++) g.fillRect(0, i * (h / 5), w, 3);
  }
  return {
    map: canvasTexture(c, { repeat: [1, 1] }),
    emissive: canvasTexture(e, { repeat: [1, 1] }),
  };
}

export function makeSignTexture(lines, opts = {}) {
  const w = opts.w || 1024, h = opts.h || 320;
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  if (opts.bg !== false) {
    g.fillStyle = opts.bg || '#0e6b3d';
    if (opts.round) {
      g.fillRect(0, 0, w, h);
    } else {
      g.fillRect(0, 0, w, h);
    }
  } else {
    g.clearRect(0, 0, w, h);
  }
  if (opts.border) {
    g.strokeStyle = opts.border; g.lineWidth = opts.borderWidth || 12;
    g.strokeRect(10, 10, w - 20, h - 20);
  }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const fs = opts.fontSize || Math.floor(h / (lines.length + 0.7));
  g.font = `${opts.weight || 700} ${fs}px "Barlow Condensed", Arial Narrow, sans-serif`;
  g.fillStyle = opts.color || '#ffffff';
  const total = lines.length;
  lines.forEach((line, i) => {
    const y = h / 2 + (i - (total - 1) / 2) * fs * 1.02;
    g.fillText(line, w / 2, y);
  });
  if (opts.accent) {
    g.fillStyle = opts.accent; g.fillRect(0, h - 22, w, 22);
  }
  return canvasTexture(c);
}

export function makeTrailerSideTexture({ brand = 'HAULWAY', color = '#e9e5dc', textColor = '#1e2a33', kind = 'box' } = {}) {
  const w = 1024, h = 256;
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  g.fillStyle = color; g.fillRect(0, 0, w, h);
  if (kind === 'container') {
    for (let x = 0; x < w; x += 15) {
      const grd = g.createLinearGradient(x, 0, x + 15, 0);
      grd.addColorStop(0, 'rgba(0,0,0,0.16)');
      grd.addColorStop(0.35, 'rgba(255,255,255,0.10)');
      grd.addColorStop(0.65, 'rgba(0,0,0,0.03)');
      grd.addColorStop(1, 'rgba(0,0,0,0.18)');
      g.fillStyle = grd; g.fillRect(x, 0, 15, h);
    }
  } else if (kind === 'curtain') {
    for (let x = 0; x < w; x += 6) {
      g.fillStyle = x % 12 === 0 ? 'rgba(0,0,0,0.045)' : 'rgba(255,255,255,0.03)';
      g.fillRect(x, 0, 2, h);
    }
    g.fillStyle = 'rgba(0,0,0,0.1)'; g.fillRect(0, h - 32, w, 4);
  } else {
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, 6, w, 4);
    for (let x = 0; x < w; x += 34) {
      g.fillStyle = 'rgba(0,0,0,0.05)'; g.fillRect(x, 0, 2, h);
    }
  }
  // branded stripe
  g.fillStyle = textColor; g.globalAlpha = 0.9;
  g.fillRect(0, h * 0.64, w, 10);
  g.globalAlpha = 1;
  g.font = '800 92px "Barlow Condensed", Arial Narrow, sans-serif';
  g.fillStyle = textColor; g.textBaseline = 'middle'; g.textAlign = 'left';
  g.fillText(brand, 46, h * 0.42);
  g.font = '600 25px "Inter", Arial, sans-serif';
  g.globalAlpha = 0.6;
  g.fillText('EUROPEAN LOGISTICS  ·  SINCE 1987', 49, h * 0.58);
  g.globalAlpha = 1;
  // little mark
  g.fillStyle = '#d97a2b';
  g.beginPath(); g.moveTo(w - 190, h * 0.18); g.lineTo(w - 70, h * 0.18); g.lineTo(w - 100, h * 0.3); g.lineTo(w - 160, h * 0.3); g.closePath(); g.fill();
  return canvasTexture(c);
}

export function makeDoorLogoTexture() {
  const w = 512, h = 256;
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#e8a13a'; g.fillRect(0, 148, w, 12);
  g.font = '800 88px "Barlow Condensed", Arial Narrow, sans-serif';
  g.fillStyle = '#f5f1e8'; g.textBaseline = 'middle';
  g.fillText('HAULWAY', 10, 100);
  g.font = '600 27px "Inter", Arial, sans-serif';
  g.fillStyle = 'rgba(245,241,232,0.7)';
  g.fillText('TRANS-CONTINENTAL', 14, 182);
  return canvasTexture(c);
}

export function makeBillboardTexture(title, sub, { bg = '#101820', accent = '#e8a13a' } = {}) {
  const w = 1024, h = 512;
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  const grad = g.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, 'rgba(255,255,255,0.07)');
  grad.addColorStop(1, 'rgba(0,0,0,0.2)');
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  g.fillStyle = accent; g.fillRect(0, 0, 18, h);
  g.font = '800 142px "Barlow Condensed", Arial Narrow, sans-serif';
  g.fillStyle = '#f6f1e6'; g.textBaseline = 'middle';
  g.fillText(title, 64, 200);
  g.font = '500 39px "Inter", Arial, sans-serif';
  g.fillStyle = 'rgba(246,241,230,0.68)';
  g.fillText(sub, 68, 310);
  g.fillStyle = accent;
  g.beginPath(); g.arc(w - 110, h - 90, 38, 0, TAU); g.fill();
  g.fillStyle = bg; g.font = '800 38px "Barlow Condensed", sans-serif'; g.textAlign = 'center';
  g.fillText('H', w - 110, h - 86);
  return canvasTexture(c);
}

export function makeCloudTexture() {
  const s = 256;
  const c = makeCanvas(s, s);
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 8, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(255,255,255,0.85)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.5)');
  grd.addColorStop(0.7, 'rgba(255,255,255,0.14)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, s, s);
  // puffy detail
  const rand = mulberry32(11);
  for (let i = 0; i < 40; i++) {
    const x = s * 0.5 + (rand() - 0.5) * s * 0.7;
    const y = s * 0.5 + (rand() - 0.5) * s * 0.5;
    const r = 10 + rand() * 34;
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, 'rgba(255,255,255,0.22)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }
  return canvasTexture(c);
}

export function makeRadialTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const s = 128;
  const c = makeCanvas(s, s);
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd; g.fillRect(0, 0, s, s);
  return canvasTexture(c);
}

export function makeSoftShadowTexture() {
  return makeRadialTexture('rgba(0,0,0,0.5)', 'rgba(0,0,0,0)');
}

export function roundedBoxMesh(w, h, d, radius, material, segments = 2) {
  const geo = new RoundedBoxGeometry(w, h, d, segments, Math.min(radius, Math.min(w, h, d) / 2));
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

export function boxMesh(w, h, d, material) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

export function cylinderMesh(rTop, rBottom, h, material, seg = 20) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, seg), material);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

const _standardCache = new Map();
export function standard(color, opts = {}) {
  // Shared materials keep the draw-call count low for the many small
  // procedural props scattered around the ring. None of these are mutated.
  const key = String(color) + '|' + JSON.stringify(opts);
  let mat = _standardCache.get(key);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.05, ...opts });
    _standardCache.set(key, mat);
  }
  return mat;
}

/**
 * Bake every static child mesh of `root` into one mesh per material.
 * Animated nodes (wheels, rotors, gauges…) can be protected with
 * `userData.noMerge = true` or by passing them in `exclude`.
 * Returns the number of source meshes removed.
 */
export function mergeStaticMeshes(root, exclude = []) {
  if (!root) return 0;
  root.updateMatrixWorld(true);
  const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const excluded = new Set(exclude);
  const buckets = new Map();
  const sources = [];
  const relative = new THREE.Matrix4();

  const isExcluded = (node) => {
    let p = node;
    while (p && p !== root) {
      if (excluded.has(p) || p.userData.noMerge) return true;
      p = p.parent;
    }
    return false;
  };

  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) return;
    if (!o.material || Array.isArray(o.material)) return;
    if (o.material.transparent || o.material.isShaderMaterial) return;
    if (!o.geometry || !o.geometry.attributes.position) return;
    if (isExcluded(o)) return;

    // Normalise to non-indexed triangles so differently-built primitives can
    // share a single buffer. UVs are required by most of the world materials.
    let geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    relative.multiplyMatrices(rootInverse, o.matrixWorld);
    geo.applyMatrix4(relative);
    if (!geo.attributes.uv) {
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    }
    // Merge only the attributes the material actually consumes.
    for (const name of Object.keys(geo.attributes)) {
      if (!['position', 'normal', 'uv', 'color'].includes(name)) geo.deleteAttribute(name);
    }
    if (!geo.attributes.normal) geo.computeVertexNormals();
    if (!o.material.vertexColors && geo.attributes.color) geo.deleteAttribute('color');

    const list = buckets.get(o.material) || [];
    list.push(geo);
    buckets.set(o.material, list);
    sources.push(o);
  });

  if (sources.length === 0) return 0;

  let removed = 0;
  for (const [material, geometries] of buckets) {
    if (geometries.length === 0) continue;
    let vertexCount = 0;
    const hasColor = geometries.every((g) => !!g.attributes.color);
    for (const geo of geometries) vertexCount += geo.attributes.position.count;

    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const colors = hasColor ? new Float32Array(vertexCount * 3) : null;
    let offset = 0;
    for (const geo of geometries) {
      const count = geo.attributes.position.count;
      positions.set(geo.attributes.position.array, offset * 3);
      normals.set(geo.attributes.normal.array, offset * 3);
      uvs.set(geo.attributes.uv.array, offset * 2);
      if (colors) colors.set(geo.attributes.color.array, offset * 3);
      offset += count;
      geo.dispose();
    }

    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    if (colors) merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    merged.computeBoundingSphere();

    const mesh = new THREE.Mesh(merged, material);
    let cast = false;
    let receive = false;
    for (const src of sources) {
      if (src.material === material) {
        if (src.castShadow) cast = true;
        if (src.receiveShadow) receive = true;
      }
    }
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    mesh.name = 'merged-static';
    root.add(mesh);
  }

  for (const mesh of sources) {
    if (mesh.parent) mesh.parent.remove(mesh);
    mesh.geometry?.dispose?.();
    removed++;
  }
  return removed;
}

export function makeGradientEnv(top, bottom, sun, sunColor) {
  const w = 512, h = 256;
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, top);
  grd.addColorStop(0.45, new THREE.Color(top).lerp(new THREE.Color(bottom), 0.45).getStyle());
  grd.addColorStop(0.52, bottom);
  grd.addColorStop(1, '#2b2b28');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  if (sun) {
    const sx = ((sun.x + 1) / 2) * w, sy = ((1 - sun.y) / 2) * h;
    const rg = g.createRadialGradient(sx, sy, 0, sx, sy, 80);
    rg.addColorStop(0, sunColor);
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg; g.fillRect(0, 0, w, h);
  }
  const t = canvasTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}

export function formatMoney(v) {
  return '€' + Math.round(v).toLocaleString('en-US');
}
export function formatDistance(m) {
  if (m >= 1000) return (m / 1000).toFixed(1) + ' km';
  return Math.round(m) + ' m';
}
export function formatTime(hours) {
  const h = Math.floor(((hours % 24) + 24) % 24);
  const m = Math.floor((hours * 60) % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
export function disposeObject(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => {
        for (const k of Object.keys(m)) {
          const v = m[k];
          if (v && v.isTexture && !v.userData?.shared) v.dispose();
        }
        m.dispose();
      });
    }
  });
}
