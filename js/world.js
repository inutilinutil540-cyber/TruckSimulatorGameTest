import * as THREE from 'three';
import {
  TAU, clamp, lerp, smoothstep, fbm, mulberry32, makeCanvas, canvasTexture,
  makeAsphaltTextures, makeConcreteTexture, makeGravelTexture, makeBuildingTextures,
  makeSignTexture, makeBillboardTexture, makeCloudTexture, makeRadialTexture,
  makeTrailerSideTexture, makeGradientEnv, boxMesh, cylinderMesh, standard, formatTime,
  mergeStaticMeshes,
} from './utils.js';

const RING_N = 720;
const ROAD_HALF = 8.5;

function terrainTexture() {
  const s = 512;
  const c = makeCanvas(s, s);
  const g = c.getContext('2d');
  g.fillStyle = '#4f6a35'; g.fillRect(0, 0, s, s);
  const img = g.getImageData(0, 0, s, s);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 34;
    img.data[i] += n * 0.9; img.data[i + 1] += n; img.data[i + 2] += n * 0.4;
  }
  g.putImageData(img, 0, 0);
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * s, y = Math.random() * s, r = Math.random() * 22 + 3;
    const v = Math.random() > 0.5 ? 'rgba(120,146,72,0.07)' : 'rgba(62,56,32,0.06)';
    g.fillStyle = v; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }
  const t = canvasTexture(c, { repeat: [40, 40] });
  t.anisotropy = 4;
  return t;
}

function speedSignTexture(limit) {
  const s = 256;
  const c = makeCanvas(s, s);
  const g = c.getContext('2d');
  g.clearRect(0, 0, s, s);
  g.fillStyle = '#f4f1e8'; g.beginPath(); g.arc(s / 2, s / 2, s * 0.47, 0, TAU); g.fill();
  g.strokeStyle = '#c82a2a'; g.lineWidth = s * 0.1; g.beginPath(); g.arc(s / 2, s / 2, s * 0.42, 0, TAU); g.stroke();
  g.fillStyle = '#16191d'; g.font = '800 104px "Barlow Condensed", Arial Narrow, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(limit), s / 2, s / 2 + 5);
  return canvasTexture(c);
}

export class World {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.animated = [];
    this.colliders = [];
    this.depots = [];
    this.weather = { type: 'clear', intensity: 0 };
    this.time = 8.2;
    this.quality = 'high';
    this.destination = null;
    this._lastPaletteKey = '';
    this._buildRing();
    this._buildAccessRoads();
    this._buildTerrain();
    this._buildRoad();
    this._buildGuardrails();
    this._buildLake();
    this._buildDepots();
    this._buildScenery();
    this._buildRoadFurniture();
    this._buildSky();
    this._buildRain();
    this._buildEnvironmentMaps();
    this._initBeacon();
    this._optimiseStaticGeometry();
    this.setTime(8.2);
  }

  _optimiseStaticGeometry() {
    // Keep animated nodes out of the bake.
    for (const a of this.animated) if (a.obj) a.obj.userData.noMerge = true;
    if (this.lighthouseLamp) this.lighthouseLamp.userData.noMerge = true;
    if (this.terrain) this.terrain.userData.noMerge = true;
    if (this.water) this.water.userData.noMerge = true;
    mergeStaticMeshes(this.group);
    this.group.updateMatrixWorld(true);
  }

  // ---------------------------------------------------------------- geometry
  _buildRing() {
    this.ring = [];
    this.ringLength = 0;
    for (let i = 0; i <= RING_N; i++) {
      const a = (i / RING_N) * TAU;
      const r = 505 + Math.sin(a * 3 + 0.4) * 22 + Math.sin(a * 7 + 1.1) * 10 + Math.sin(a * 11 + 2.4) * 5;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      this.ring.push({ p: new THREE.Vector3(x, 0, z), a, r });
    }
    for (let i = 0; i <= RING_N; i++) {
      const prev = this.ring[(i - 1 + RING_N) % RING_N].p;
      const next = this.ring[(i + 1) % RING_N].p;
      const t = new THREE.Vector3().subVectors(next, prev).normalize();
      this.ring[i].t = t;
      this.ring[i].right = new THREE.Vector3(-t.z, 0, t.x);
      this.ring[i].s = i === 0 ? 0 : this.ring[i - 1].s + this.ring[i].p.distanceTo(prev);
    }
    this.ringLength = this.ring[RING_N - 1].s;
    this.ringPoints = [];
    for (let i = 0; i < RING_N; i += 6) this.ringPoints.push(this.ring[i].p);
  }

  ringRadiusAtAngle(a) {
    return 505 + Math.sin(a * 3 + 0.4) * 22 + Math.sin(a * 7 + 1.1) * 10 + Math.sin(a * 11 + 2.4) * 5;
  }

  sampleRing(s) {
    s = ((s % this.ringLength) + this.ringLength) % this.ringLength;
    let lo = 0, hi = RING_N - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (this.ring[mid].s < s) lo = mid; else hi = mid;
    }
    const a = this.ring[lo], b = this.ring[lo + 1];
    const t = (s - a.s) / Math.max(0.0001, b.s - a.s);
    const p = new THREE.Vector3().lerpVectors(a.p, b.p, t);
    const tangent = new THREE.Vector3().lerpVectors(a.t, b.t, t).normalize();
    return { p, t: tangent, right: new THREE.Vector3(-tangent.z, 0, tangent.x), index: lo, s };
  }

  nearestOnRing(x, z) {
    let best = { d: Infinity, s: 0, p: null, right: null, t: null, index: 0 };
    const px = x, pz = z;
    for (let i = 0; i < RING_N; i++) {
      const a = this.ring[i].p, b = this.ring[i + 1].p;
      const abx = b.x - a.x, abz = b.z - a.z;
      const apx = px - a.x, apz = pz - a.z;
      const denom = abx * abx + abz * abz;
      const t = clamp((apx * abx + apz * abz) / denom, 0, 1);
      const qx = a.x + abx * t, qz = a.z + abz * t;
      const dx = px - qx, dz = pz - qz;
      const d = dx * dx + dz * dz;
      if (d < best.d) {
        best = { d, s: this.ring[i].s + Math.sqrt(denom) * t, p: new THREE.Vector3(qx, 0, qz), index: i, t: null, right: null };
      }
    }
    best.d = Math.sqrt(best.d);
    const sample = this.sampleRing(best.s);
    best.t = sample.t; best.right = sample.right;
    return best;
  }

  _buildAccessRoads() {
    const names = [
      { name: 'Northgate', color: '#d97b2c', brand: 'HAULWAY', angle: 0.42 },
      { name: 'Pinecrest', color: '#3d7d68', brand: 'NORDVIK', angle: 1.98 },
      { name: 'Redstone', color: '#a84a35', brand: 'REDLINE', angle: 3.55 },
      { name: 'Port Vale', color: '#3f648c', brand: 'SEAWAY', angle: 5.13 },
    ];
    this.accessRoads = [];
    for (const def of names) {
      const idx = Math.round((def.angle / TAU) * RING_N) % RING_N;
      const base = this.ring[idx];
      const outward = new THREE.Vector3(base.p.x, 0, base.p.z).normalize();
      const padDist = 128;
      const center = new THREE.Vector3(base.p.x + outward.x * padDist, 0, base.p.z + outward.z * padDist);
      const padInner = new THREE.Vector3(base.p.x + outward.x * 58, 0, base.p.z + outward.z * 58);
      const start = new THREE.Vector3(base.p.x + outward.x * 8.0, 0, base.p.z + outward.z * 8.0);
      const depot = {
        ...def, idx, ringSample: base, outward, center, start, padInner,
        target: new THREE.Vector3(),
        yaw: Math.atan2(-outward.x, -outward.z),
      };
      depot.target.set(
        center.x + outward.x * 12,
        0,
        center.z + outward.z * 12
      );
      depot.zoneRadius = 18;
      this.depots.push(depot);
      this.accessRoads.push({ start, end: center, width: 4.4, depot, inner: padInner });
    }
  }

  _buildTerrain() {
    const size = 2800, seg = 180;
    const geo = new THREE.PlaneGeometry(size, size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const tex = terrainTexture();
    const cGrass = new THREE.Color('#718b4c');
    const cDark = new THREE.Color('#40552e');
    const cDry = new THREE.Color('#8f8a56');
    const cRock = new THREE.Color('#6d6a5e');
    const cSand = new THREE.Color('#9c8c61');
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const y = this.groundHeight(x, z);
      pos.setY(i, y);
      const r = Math.hypot(x, z);
      const roadR = this.ringRadiusAtAngle(Math.atan2(z, x));
      const n = fbm(x * 0.02 + 3, z * 0.02 + 8, 3);
      const outer = smoothstep(roadR + 30, roadR + 480, r);
      const dry = smoothstep(0.55, 0.85, n) * 0.7;
      tmp.copy(cGrass).lerp(cDark, n * 0.75).lerp(cDry, dry);
      if (outer > 0.3) tmp.lerp(cRock, (outer - 0.3) * 0.7 * smoothstep(0.4, 0.75, n));
      if (y < -1.2) tmp.lerp(cSand, smoothstep(-1.2, -3.2, y));
      if (Math.abs(r - roadR) < 5) tmp.lerp(cDry, 0.35);
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, map: tex, roughness: 0.97, metalness: 0, color: 0xffffff,
    });
    const terrain = new THREE.Mesh(geo, mat);
    terrain.receiveShadow = true;
    this.terrain = terrain;
    this.group.add(terrain);
  }

  groundHeight(x, z) {
    const r = Math.hypot(x, z);
    const a = Math.atan2(z, x);
    const roadR = this.ringRadiusAtAngle(a);
    const dRoad = Math.abs(r - roadR);
    const flat = smoothstep(16, 95, dRoad);
    let h = 0;
    const outer = smoothstep(roadR + 40, roadR + 520, r);
    h += outer * (11 + 30 * fbm(x * 0.0022 + 4, z * 0.0022 + 9, 4));
    const lake = smoothstep(roadR - 110, roadR - 320, r);
    h -= lake * 8.5;
    h += (fbm(x * 0.011, z * 0.011, 4) - 0.5) * 6 * flat;
    h += (fbm(x * 0.05, z * 0.05, 2) - 0.5) * 0.5 * flat;
    // flatten road corridor / access roads / depots
    let flatten = smoothstep(30, 110, dRoad);
    for (const d of this.depots) {
      const dd = Math.hypot(x - d.center.x, z - d.center.z);
      flatten = Math.min(flatten, smoothstep(36, 82, dd));
      const ax = d.start.x, az = d.start.z, bx = d.center.x, bz = d.center.z;
      const abx = bx - ax, abz = bz - az;
      const t = clamp(((x - ax) * abx + (z - az) * abz) / (abx * abx + abz * abz), 0, 1);
      const ex = ax + abx * t, ez = az + abz * t;
      const ad = Math.hypot(x - ex, z - ez);
      flatten = Math.min(flatten, smoothstep(7, 32, ad));
    }
    return h * flatten;
  }

  _buildRoad() {
    const asphalt = makeAsphaltTextures();
    this.asphaltMap = asphalt;
    this.roadMaterial = new THREE.MeshStandardMaterial({
      map: asphalt, color: 0xffffff, roughness: 0.8, metalness: 0.02,
    });
    const shoulderMat = new THREE.MeshStandardMaterial({
      map: makeGravelTexture(), color: 0x9a8a6d, roughness: 1,
    });
    const roadGeo = this._ringRibbon(-ROAD_HALF, ROAD_HALF, 0.02, 14);
    const road = new THREE.Mesh(roadGeo, this.roadMaterial);
    road.receiveShadow = true;
    this.group.add(road);
    for (const s of [-1, 1]) {
      const geo = this._ringRibbon(s * ROAD_HALF, s * (ROAD_HALF + 3.6), 0.008, 10);
      const m = new THREE.Mesh(geo, shoulderMat);
      m.receiveShadow = true;
      this.group.add(m);
    }
    // road markings
    const lineMat = new THREE.MeshStandardMaterial({
      color: 0xf1eee2, roughness: 0.55, metalness: 0.02, emissive: 0x27251e, emissiveIntensity: 0.4,
    });
    this.lineMat = lineMat;
    const center = this._ringRibbon(-0.17, 0.17, 0.055, 10);
    this.group.add(new THREE.Mesh(center, lineMat));
    for (const off of [-7.7, 7.7]) {
      const edge = this._ringRibbon(off - 0.09, off + 0.09, 0.055, 10);
      this.group.add(new THREE.Mesh(edge, lineMat));
    }
    for (const off of [-4.15, 4.15]) {
      const geo = this._dashedRibbon(off, 0.09, 3.2, 9.0);
      const m = new THREE.Mesh(geo, lineMat);
      this.group.add(m);
    }
    // access roads
    const accMat = new THREE.MeshStandardMaterial({ map: asphalt, color: 0xf4f4f4, roughness: 0.82 });
    this.accessRoadMaterial = accMat;
    for (const a of this.accessRoads) {
      const len = a.start.distanceTo(a.end);
      const dir = new THREE.Vector3().subVectors(a.end, a.start).normalize();
      const mid = new THREE.Vector3().addVectors(a.start, a.end).multiplyScalar(0.5);
      const geo = new THREE.PlaneGeometry(a.width * 2, len, 1, 12);
      const m = new THREE.Mesh(geo, accMat);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = -Math.atan2(dir.x, dir.z);
      m.position.set(mid.x, 0.025, mid.z);
      m.receiveShadow = true;
      this.group.add(m);
      const shoulderGeo = new THREE.PlaneGeometry(a.width * 2 + 5, len, 1, 1);
      const sm = new THREE.Mesh(shoulderGeo, shoulderMat);
      sm.rotation.copy(m.rotation); sm.position.set(mid.x, 0.005, mid.z);
      sm.receiveShadow = true;
      this.group.add(sm);
      // edge markings
      for (const side of [-1, 1]) {
        const lineGeo = new THREE.PlaneGeometry(0.16, len);
        const lm = new THREE.Mesh(lineGeo, lineMat);
        lm.rotation.copy(m.rotation);
        lm.position.set(mid.x + dir.z * side * (a.width - 0.4), 0.05, mid.z - dir.x * side * (a.width - 0.4));
        this.group.add(lm);
      }
      // depot pad
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(92, 64), new THREE.MeshStandardMaterial({
        map: makeConcreteTexture(105), roughness: 0.9, color: 0xb9b7ae,
      }));
      pad.rotation.x = -Math.PI / 2;
      pad.rotation.z = -a.depot.yaw;
      pad.position.set(a.depot.center.x, 0.03, a.depot.center.z);
      pad.receiveShadow = true;
      this.group.add(pad);
      // painted lines on pad
      for (let k = -2; k <= 2; k++) {
        const g2 = new THREE.PlaneGeometry(0.18, 34);
        const l2 = new THREE.Mesh(g2, lineMat);
        l2.rotation.x = -Math.PI / 2;
        l2.rotation.z = -a.depot.yaw;
        l2.position.set(
          a.depot.center.x + Math.cos(a.depot.yaw) * (k * 7) + Math.sin(a.depot.yaw) * 2,
          0.045,
          a.depot.center.z - Math.sin(a.depot.yaw) * (k * 7) + Math.cos(a.depot.yaw) * 2
        );
        this.group.add(l2);
      }
    }
  }

  _ringRibbon(offA, offB, y, uvScale) {
    const verts = [], uvs = [], indices = [];
    for (let i = 0; i <= RING_N; i++) {
      const r = this.ring[i];
      const p = r.p;
      verts.push(p.x + r.right.x * offA, y, p.z + r.right.z * offA);
      verts.push(p.x + r.right.x * offB, y, p.z + r.right.z * offB);
      const v = r.s / uvScale;
      uvs.push(0, v, 1, v);
      if (i < RING_N) {
        const a = i * 2;
        indices.push(a, a + 2, a + 1, a + 2, a + 3, a + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    const normals = new Float32Array(verts.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    return geo;
  }

  _dashedRibbon(off, width, dash, gap) {
    const verts = [], uvs = [], indices = [];
    let vi = 0;
    const period = dash + gap;
    for (let i = 0; i < RING_N; i++) {
      const s = this.ring[i].s;
      const s2 = this.ring[i + 1].s;
      if (s % period > dash && s2 % period > dash) continue;
      if (s2 % period < s % period) continue;
      const r = this.ring[i], r2 = this.ring[i + 1];
      const push = (rr) => {
        const p = rr.p, right = rr.right;
        verts.push(p.x + right.x * (off - width), 0.056, p.z + right.z * (off - width));
        verts.push(p.x + right.x * (off + width), 0.056, p.z + right.z * (off + width));
      };
      push(r); push(r2);
      indices.push(vi, vi + 2, vi + 1, vi + 1, vi + 2, vi + 3);
      vi += 4;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(verts.length / 3 * 2), 2));
    geo.setIndex(indices);
    const normals = new Float32Array(verts.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    return geo;
  }

  _buildGuardrails() {
    const railMat = new THREE.MeshStandardMaterial({ color: 0xb6bab9, roughness: 0.4, metalness: 0.75 });
    this.railMaterial = railMat;
    const depotIdx = new Set();
    for (const d of this.depots) for (let k = -12; k <= 12; k++) depotIdx.add((d.idx + k + RING_N) % RING_N);
    const postGeo = new THREE.BoxGeometry(0.13, 0.95, 0.13);
    const posts = [];
    for (const side of [-1, 1]) {
      const off = side * 9.35;
      const verts = [], indices = [];
      let vi = 0;
      for (let i = 0; i < RING_N; i++) {
        const r = this.ring[i], r2 = this.ring[i + 1];
        if (depotIdx.has(i) || depotIdx.has((i + 1) % RING_N)) continue;
        const p = r.p, p2 = r2.p;
        // vertical beam strip
        verts.push(p.x + r.right.x * off, 0.48, p.z + r.right.z * off);
        verts.push(p.x + r.right.x * off, 0.86, p.z + r.right.z * off);
        verts.push(p2.x + r2.right.x * off, 0.48, p2.z + r2.right.z * off);
        verts.push(p2.x + r2.right.x * off, 0.86, p2.z + r2.right.z * off);
        indices.push(vi, vi + 2, vi + 1, vi + 1, vi + 2, vi + 3);
        vi += 4;
        if (i % 8 === 0 && !depotIdx.has(i)) posts.push({ p: p.clone().addScaledVector(r.right, off), yaw: Math.atan2(r.t.x, r.t.z) });
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      const rail = new THREE.Mesh(geo, railMat);
      rail.castShadow = false; rail.receiveShadow = true;
      this.group.add(rail);
    }
    const inst = new THREE.InstancedMesh(postGeo, railMat, posts.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    posts.forEach((p, i) => {
      q.setFromAxisAngle(up, p.yaw);
      m4.compose(new THREE.Vector3(p.p.x, 0.42, p.p.z), q, new THREE.Vector3(1, 1, 1));
      inst.setMatrixAt(i, m4);
    });
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = true;
    this.group.add(inst);
    // delineator posts with reflectors
    const delGeo = new THREE.BoxGeometry(0.1, 0.75, 0.16);
    const delMat = new THREE.MeshStandardMaterial({ color: 0xe8e4d8, roughness: 0.7 });
    const reflMat = new THREE.MeshBasicMaterial({ color: 0xff9d3c });
    const dels = [];
    for (const side of [-1, 1]) {
      for (let i = 0; i < RING_N; i += 13) {
        const r = this.ring[i];
        dels.push({ p: r.p.clone().addScaledVector(r.right, side * 8.9), yaw: Math.atan2(r.t.x, r.t.z) });
      }
    }
    const dInst = new THREE.InstancedMesh(delGeo, delMat, dels.length);
    const rInst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.11, 0.12, 0.02), reflMat, dels.length);
    dels.forEach((p, i) => {
      q.setFromAxisAngle(up, p.yaw);
      m4.compose(new THREE.Vector3(p.p.x, 0.38, p.p.z), q, new THREE.Vector3(1, 1, 1));
      dInst.setMatrixAt(i, m4);
      const off = new THREE.Vector3(0, 0, 0.095).applyQuaternion(q);
      m4.compose(new THREE.Vector3(p.p.x + off.x, 0.6, p.p.z + off.z), q, new THREE.Vector3(1, 1, 1));
      rInst.setMatrixAt(i, m4);
    });
    this.group.add(dInst, rInst);
  }

  _buildLake() {
    const geo = new THREE.CircleGeometry(315, 96);
    geo.rotateX(-Math.PI / 2);
    this.waterUniforms = {
      uTime: { value: 0 },
      uSky: { value: new THREE.Color('#9cc9e8') },
      uDeep: { value: new THREE.Color('#183d4a') },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color('#fff0c0') },
      uNight: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.waterUniforms,
      transparent: true,
      vertexShader: `
        varying vec2 vUv; varying vec3 vPos;
        void main(){ vUv=uv; vPos=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }
      `,
      fragmentShader: `
        uniform float uTime; uniform vec3 uSky; uniform vec3 uDeep; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uNight;
        varying vec2 vUv; varying vec3 vPos;
        float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
        float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
          return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
        void main(){
          vec2 p = vPos.xz*0.035;
          float n = noise(p+vec2(uTime*0.08,uTime*0.03))*0.6 + noise(p*2.1-vec2(uTime*0.05,uTime*0.09))*0.4;
          vec3 col = mix(uDeep, uSky, 0.45 + 0.25*n);
          vec3 viewDir = normalize(cameraPosition - vPos);
          float fres = pow(1.0 - clamp(viewDir.y,0.0,1.0), 2.5);
          col = mix(col, uSky, fres*0.55);
          vec3 nrm = normalize(vec3((n-0.5)*0.35, 1.0, (noise(p*1.7+3.0)-0.5)*0.35));
          float spec = pow(max(dot(reflect(-uSunDir,nrm),viewDir),0.0), 90.0);
          col += uSunColor*spec*(1.0-uNight)*0.9;
          col += vec3(0.03,0.07,0.08)*(1.0-uNight);
          gl_FragColor = vec4(col, 0.94);
        }
      `,
    });
    const water = new THREE.Mesh(geo, mat);
    water.position.y = -2.75;
    this.group.add(water);
    this.water = water;
    // small island
    const island = new THREE.Mesh(new THREE.IcosahedronGeometry(11, 2), new THREE.MeshStandardMaterial({ color: 0x667451, roughness: 1 }));
    island.scale.set(2.2, 0.35, 1.3);
    island.position.set(-70, -3.2, 85);
    this.group.add(island);
    const lighthouse = new THREE.Group();
    const tower = cylinderMesh(0.9, 1.5, 9, standard(0xe8e4da, { roughness: 0.8 }));
    tower.position.y = 4.5; lighthouse.add(tower);
    const red = cylinderMesh(1, 1, 2.2, standard(0xb63a2e, { roughness: 0.7 }));
    red.position.y = 9.3; lighthouse.add(red);
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xffd98a });
    const lantern = cylinderMesh(0.6, 0.6, 1.1, lightMat);
    lantern.position.y = 10.9; lighthouse.add(lantern);
    lighthouse.position.set(-58, -2.7, 94);
    this.group.add(lighthouse);
    this.lighthouseLamp = lantern;
  }

  _buildDepots() {
    const warehouseMat = new THREE.MeshStandardMaterial({ color: 0xb4b6b3, roughness: 0.75, metalness: 0.15 });
    const darkMetal = new THREE.MeshStandardMaterial({ color: 0x4a5052, roughness: 0.55, metalness: 0.4 });
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x9aa3a4, roughness: 0.5, metalness: 0.5 });
    const officeMat = new THREE.MeshStandardMaterial({ color: 0xd6d1c4, roughness: 0.8 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x1d3742, roughness: 0.12, metalness: 0.6 });
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffd38a });
    const terminal = makeTrailerSideTexture({ brand: 'HAULWAY', color: '#d8d5c9', kind: 'box' });

    for (let di = 0; di < this.depots.length; di++) {
      const d = this.depots[di];
      const g = new THREE.Group();
      g.position.set(d.center.x, 0, d.center.z);
      g.rotation.y = d.yaw;
      this.group.add(g);
      // warehouse
      const wh = boxMesh(34, 11, 17, warehouseMat);
      wh.position.set(0, 5.5, -27);
      g.add(wh);
      // curved roof
      const roof = cylinderMesh(9, 9, 34.4, darkMetal, 24);
      roof.rotation.z = Math.PI / 2;
      roof.scale.set(1, 1, 0.32);
      roof.position.set(0, 11, -27);
      g.add(roof);
      // loading doors
      for (let k = -1; k <= 1; k++) {
        const door = boxMesh(6.2, 5.4, 0.3, doorMat);
        door.position.set(k * 8.5, 3.0, -18.4);
        g.add(door);
        for (let r = 0; r < 5; r++) {
          const rib = boxMesh(6.2, 0.06, 0.06, darkMetal);
          rib.position.set(k * 8.5, 0.9 + r * 1.08, -18.22);
          g.add(rib);
        }
        const bump = boxMesh(6.4, 0.5, 0.6, standard(0x24282b, { roughness: 0.8 }));
        bump.position.set(k * 8.5, 0.28, -17.9);
        g.add(bump);
        const light = boxMesh(0.4, 0.16, 0.2, lampMat);
        light.position.set(k * 8.5, 6.15, -18.2);
        g.add(light);
      }
      // fascia sign
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(19, 3.2), new THREE.MeshStandardMaterial({
        map: makeSignTexture([d.brand + ' LOGISTICS', d.name.toUpperCase() + ' HUB'], {
          bg: '#162129', color: '#f3eee2', accent: d.color, fontSize: 64, h: 256,
        }), roughness: 0.6, emissive: 0x151515,
      }));
      sign.position.set(0, 8.9, -18.35);
      g.add(sign);
      // office block
      const office = boxMesh(13, 4.4, 8, officeMat);
      office.position.set(-31, 2.2, 8);
      g.add(office);
      for (let k = 0; k < 3; k++) {
        const win = boxMesh(3.2, 1.5, 0.15, glassMat);
        win.position.set(-35 + k * 4, 2.3, 12.06);
        g.add(win);
      }
      const officeSign = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 1.1), new THREE.MeshStandardMaterial({
        map: makeSignTexture(['DISPATCH'], { bg: '#20272b', color: '#f0a13a', fontSize: 74, h: 128 }),
      }));
      officeSign.position.set(-31, 4.6, 12.1);
      g.add(officeSign);
      // canopy / fuel station
      const canopy = boxMesh(17, 0.7, 10, standard(0xf1ede2, { roughness: 0.6 }));
      canopy.position.set(30, 5.6, 6);
      g.add(canopy);
      const fascia = boxMesh(17.2, 0.7, 0.4, standard(d.color, { roughness: 0.5, metalness: 0.2 }));
      fascia.position.set(30, 5.0, 11.1); g.add(fascia);
      for (const px of [23, 37]) for (const pz of [1.6, 10.4]) {
        const col = cylinderMesh(0.22, 0.22, 5.6, standard(0xd8d4c8, { roughness: 0.5 }), 10);
        col.position.set(px, 2.8, pz); g.add(col);
      }
      for (const px of [27, 33]) {
        const pump = boxMesh(1.1, 1.9, 0.7, standard(0xe4e0d5, { roughness: 0.55 }));
        pump.position.set(px, 0.95, 6); g.add(pump);
        const screen = boxMesh(0.6, 0.55, 0.05, new THREE.MeshBasicMaterial({ color: 0x8fdcb0 }));
        screen.position.set(px, 1.4, 6.38); g.add(screen);
      }
      const price = new THREE.Mesh(new THREE.PlaneGeometry(6, 4), new THREE.MeshStandardMaterial({
        map: makeSignTexture(['DIESEL', '1.719', 'per litre'], { bg: '#101820', color: '#f4efe4', accent: d.color, fontSize: 58, h: 320 }),
        emissive: 0x141414,
      }));
      price.position.set(44, 4.4, 12);
      price.rotation.y = -Math.PI / 2;
      g.add(price);
      // entrance sign
      const ent = boxMesh(0.35, 6.4, 0.35, darkMetal);
      ent.position.set(-36, 3.2, 26); g.add(ent);
      const entSign = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.3), new THREE.MeshStandardMaterial({
        map: makeSignTexture([d.brand, 'FREIGHT TERMINAL'], { bg: '#121b21', color: '#f6f1e5', accent: d.color, fontSize: 58, h: 200 }),
        side: THREE.DoubleSide,
      }));
      entSign.position.set(-31, 5.3, 26.1); entSign.rotation.y = 0;
      g.add(entSign);
      // parked containers
      const rand = mulberry32(200 + di * 7);
      for (let k = 0; k < 4; k++) {
        const cmat = new THREE.MeshStandardMaterial({ color: [0x9a4b3c, 0x3f6e86, 0x6f7a51, 0xa8823f][k % 4], roughness: 0.7, metalness: 0.2 });
        const con = boxMesh(12, 2.7, 2.6, cmat);
        con.position.set(46 + rand() * 5, 1.38 + (k > 1 ? 2.72 : 0), -22 + (k % 2) * 3);
        con.rotation.y = Math.PI / 2;
        g.add(con);
      }
      // street lights
      for (const [lx, lz] of [[-44, 20], [44, 20], [-44, -14], [44, -14], [0, 28]]) {
        const pole = cylinderMesh(0.12, 0.17, 9, darkMetal, 8);
        pole.position.set(lx, 4.5, lz); g.add(pole);
        const arm = boxMesh(2.2, 0.14, 0.14, darkMetal);
        arm.position.set(lx + (lx > 0 ? -1 : 1), 8.8, lz); g.add(arm);
        const lamp = boxMesh(1.2, 0.2, 0.5, lampMat);
        lamp.position.set(lx + (lx > 0 ? -2.1 : 2.1), 8.7, lz); g.add(lamp);
      }
      // AI-ish parked trailer (static)
      const parked = new THREE.Group();
      const body = boxMesh(2.55, 2.7, 12.8, new THREE.MeshStandardMaterial({ map: terminal, roughness: 0.62 }));
      body.position.set(0, 2.45, -6.4);
      parked.add(body);
      const skirts = boxMesh(2.2, 0.6, 9.5, standard(0xd8d6cd, { roughness: 0.7 }));
      skirts.position.set(0, 0.7, -7.3); parked.add(skirts);
      for (const wx of [-1.1, 1.1]) for (const wz of [-10.2, -11.3]) {
        const wheel = cylinderMesh(0.52, 0.52, 0.32, standard(0x111214, { roughness: 0.9 }), 16);
        wheel.rotation.z = Math.PI / 2; wheel.position.set(wx, 0.52, wz); parked.add(wheel);
      }
      parked.position.set(27, 0, -16);
      parked.rotation.y = Math.PI / 2;
      g.add(parked);
      // colliders
      const whWorld = new THREE.Vector3(0, 0, -27).applyEuler(new THREE.Euler(0, d.yaw, 0)).add(new THREE.Vector3(d.center.x, 0, d.center.z));
      this.colliders.push({ x: whWorld.x, z: whWorld.z, r: 22 });
      const ofWorld = new THREE.Vector3(-31, 0, 8).applyEuler(new THREE.Euler(0, d.yaw, 0)).add(new THREE.Vector3(d.center.x, 0, d.center.z));
      this.colliders.push({ x: ofWorld.x, z: ofWorld.z, r: 10 });
      d.group = g;
      // city blocks behind the depot
      this._buildTown(di, d, rand);
    }
  }

  _buildTown(di, depot, rand) {
    const styles = ['office', 'apartment', 'industrial'];
    const tex = {};
    this._townMats ||= new Map();
    for (let i = 0; i < 3; i++) {
      const style = styles[i];
      tex[style] = makeBuildingTextures(mulberry32(900 + di * 13 + i), style);
      if (!this._townMats.has(style)) {
        this._townMats.set(style, new THREE.MeshStandardMaterial({
          map: tex[style].map, emissiveMap: tex[style].emissive, emissive: new THREE.Color(0xffc46d),
          emissiveIntensity: 0, roughness: 0.82, metalness: 0.05, color: 0xffffff,
        }));
      }
    }
    const outward = depot.outward;
    const tangent = new THREE.Vector3(-outward.z, 0, outward.x);
    for (let k = 0; k < 16; k++) {
      const style = styles[Math.floor(rand() * 3)];
      const h = style === 'office' ? 14 + rand() * 26 : style === 'apartment' ? 8 + rand() * 13 : 7 + rand() * 8;
      const w = 9 + rand() * 13, depth = 9 + rand() * 13;
      const along = (rand() - 0.5) * 240;
      const distance = 210 + rand() * 200;
      const pos = new THREE.Vector3(
        depot.center.x + outward.x * distance + tangent.x * along,
        0,
        depot.center.z + outward.z * distance + tangent.z * along
      );
      const y = this.groundHeight(pos.x, pos.z);
      const mat = this._townMats.get(style);
      const b = boxMesh(w, h, depth, mat);
      b.position.set(pos.x, y + h / 2, pos.z);
      b.rotation.y = Math.atan2(outward.x, outward.z) + (rand() - 0.5) * 0.5;
      this.group.add(b);
      // rooftop details
      if (style === 'office' && h > 25) {
        const antenna = cylinderMesh(0.08, 0.12, 7, standard(0x7d8588, { metalness: 0.6, roughness: 0.4 }), 6);
        antenna.position.set(pos.x, y + h + 3.5, pos.z);
        this.group.add(antenna);
        const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3b2a }));
        beacon.position.set(pos.x, y + h + 7, pos.z);
        this.group.add(beacon);
        this.animated.push({ type: 'blink', obj: beacon, phase: rand() * 10 });
      }
      if (style === 'industrial') {
        const tank = cylinderMesh(3, 3, 8, standard(0xb4b1a4, { metalness: 0.4, roughness: 0.5 }), 16);
        tank.position.set(pos.x + 10, y + 4, pos.z + 6);
        this.group.add(tank);
      }
    }
    // water tower
    const wt = new THREE.Group();
    const legs = cylinderMesh(0.4, 0.55, 16, standard(0x8a8f8e, { metalness: 0.4, roughness: 0.5 }), 8);
    legs.position.y = 8; wt.add(legs);
    const tank = cylinderMesh(4.3, 4.3, 4.5, standard(0xcfcabc, { roughness: 0.65 }), 20);
    tank.position.y = 18.5; wt.add(tank);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(4.6, 1.6, 20), standard(0x8f4f38, { roughness: 0.7 }));
    cap.position.y = 21.5; wt.add(cap);
    const tx = depot.center.x + depot.outward.x * 230 - depot.outward.z * 75;
    const tz = depot.center.z + depot.outward.z * 230 + depot.outward.x * 75;
    wt.position.set(tx, this.groundHeight(tx, tz), tz);
    this.group.add(wt);
    depot.waterTower = wt;
  }

  _buildScenery() {
    const rand = mulberry32(4242);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a4630, roughness: 0.95 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x3c5e32, roughness: 0.85, flatShading: true });
    const leafMat2 = new THREE.MeshStandardMaterial({ color: 0x54733b, roughness: 0.85, flatShading: true });
    const positions = [];
    let guard = 0;
    while (positions.length < 1150 && guard++ < 8000) {
      const r = 120 + rand() * 1000;
      const a = rand() * TAU;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = this.groundHeight(x, z);
      if (y < -1.3) continue;
      const nr = this.nearestOnRing(x, z);
      if (nr.d < 22) continue;
      let nearDepot = false;
      for (const d of this.depots) {
        if (Math.hypot(x - d.center.x, z - d.center.z) < 70) nearDepot = true;
      }
      const radial = Math.abs(Math.hypot(x, z) - this.ringRadiusAtAngle(Math.atan2(z, x)));
      if (radial < 20) continue;
      if (nearDepot) continue;
      positions.push({ x, y, z, s: 0.75 + rand() * 1.15, rot: rand() * TAU, type: rand() > 0.35 ? 0 : 1 });
    }
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.28, 2.4, 6), trunkMat, positions.length);
    const foliageA = new THREE.InstancedMesh(new THREE.ConeGeometry(1.55, 4.6, 7), leafMat, positions.length);
    const foliageB = new THREE.InstancedMesh(new THREE.ConeGeometry(1.1, 3.1, 7), leafMat2, positions.length);
    const foliageC = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.65, 0), leafMat2, positions.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3();
    const color = new THREE.Color();
    positions.forEach((p, i) => {
      q.setFromAxisAngle(up, p.rot);
      const trunkScale = new THREE.Vector3(p.s * 0.9, p.s, p.s * 0.9);
      m4.compose(new THREE.Vector3(p.x, p.y + 1.2 * p.s, p.z), q, trunkScale);
      trunks.setMatrixAt(i, m4);
      if (p.type === 0) {
        m4.compose(new THREE.Vector3(p.x, p.y + 2.6 * p.s, p.z), q, new THREE.Vector3(p.s, p.s, p.s));
        foliageA.setMatrixAt(i, m4);
        m4.compose(new THREE.Vector3(p.x, p.y + 4.4 * p.s, p.z), q, new THREE.Vector3(p.s * 0.85, p.s * 0.9, p.s * 0.85));
        foliageB.setMatrixAt(i, m4);
        m4.compose(new THREE.Vector3(0, -999, 0), q, sc.set(0.001, 0.001, 0.001));
        foliageC.setMatrixAt(i, m4);
      } else {
        m4.compose(new THREE.Vector3(p.x, p.y + 4.0 * p.s, p.z), q, new THREE.Vector3(p.s * 1.15, p.s * 1.25, p.s * 1.15));
        foliageC.setMatrixAt(i, m4);
        m4.compose(new THREE.Vector3(0, -999, 0), q, sc.set(0.001, 0.001, 0.001));
        foliageA.setMatrixAt(i, m4);
        foliageB.setMatrixAt(i, m4);
      }
      color.setHSL(0.24 + rand() * 0.07, 0.3 + rand() * 0.2, 0.25 + rand() * 0.18);
      foliageA.setColorAt(i, color);
      foliageB.setColorAt(i, color.clone().offsetHSL(0.01, 0, 0.04));
      foliageC.setColorAt(i, color.clone().offsetHSL(0.01, 0, 0.03));
    });
    [trunks, foliageA, foliageB, foliageC].forEach((m) => {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.castShadow = true; m.receiveShadow = true;
      m.frustumCulled = false;
      this.group.add(m);
    });
    // bushes
    const bushPos = [];
    for (let i = 0; i < 900; i++) {
      const r = 150 + rand() * 900, a = rand() * TAU;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = this.groundHeight(x, z);
      if (y < -1.4) continue;
      if (this.nearestOnRing(x, z).d < 15) continue;
      let nearDepot = false;
      for (const d of this.depots) if (Math.hypot(x - d.center.x, z - d.center.z) < 55) nearDepot = true;
      if (nearDepot) continue;
      bushPos.push({ x, y, z, s: 0.4 + rand() * 0.9 });
    }
    const bush = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), leafMat, bushPos.length);
    bushPos.forEach((p, i) => {
      m4.compose(new THREE.Vector3(p.x, p.y + p.s * 0.55, p.z), q.identity(), new THREE.Vector3(p.s * 1.3, p.s * 0.8, p.s * 1.3));
      bush.setMatrixAt(i, m4);
      color.setHSL(0.23 + rand() * 0.06, 0.35, 0.24 + rand() * 0.1);
      bush.setColorAt(i, color);
    });
    bush.castShadow = true; bush.frustumCulled = false; this.group.add(bush);
    // rocks
    const rockPos = [];
    for (let i = 0; i < 160; i++) {
      const r = 200 + rand() * 800, a = rand() * TAU;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = this.groundHeight(x, z);
      if (y < -1.6) continue;
      if (this.nearestOnRing(x, z).d < 14) continue;
      rockPos.push({ x, y, z, s: 0.6 + rand() * 3.2 });
    }
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x777568, roughness: 0.95, flatShading: true });
    const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), rockMat, rockPos.length);
    rockPos.forEach((p, i) => {
      q.setFromAxisAngle(up, rand() * TAU);
      m4.compose(new THREE.Vector3(p.x, p.y + p.s * 0.35, p.z), q, new THREE.Vector3(p.s, p.s * 0.55, p.s * 0.8));
      rocks.setMatrixAt(i, m4);
    });
    rocks.castShadow = true; rocks.receiveShadow = true; this.group.add(rocks);

    // mountains
    const mountainMat = new THREE.MeshStandardMaterial({ color: 0x59675d, roughness: 1, flatShading: true });
    const snowMat = new THREE.MeshStandardMaterial({ color: 0xd9dfe3, roughness: 0.9, flatShading: true });
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * TAU + rand() * 0.15;
      const r = 1080 + rand() * 320;
      const h = 110 + rand() * 190;
      const base = 170 + rand() * 190;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const mount = new THREE.Mesh(new THREE.ConeGeometry(base, h, 7, 4), mountainMat);
      mount.position.set(x, h * 0.34 - 12, z);
      mount.rotation.y = rand() * TAU;
      mount.scale.z = 0.55 + rand() * 0.5;
      this.group.add(mount);
      if (h > 190) {
        const snow = new THREE.Mesh(new THREE.ConeGeometry(base * 0.36, h * 0.33, 7, 2), snowMat);
        snow.position.set(x, h * 0.34 - 12 + h * 0.335, z);
        snow.rotation.y = mount.rotation.y;
        snow.scale.z = mount.scale.z;
        this.group.add(snow);
      }
    }
    // wind turbines
    for (let i = 0; i < 4; i++) {
      const a = 0.8 + i * 1.35;
      const r = 760 + i * 60;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = this.groundHeight(x, z);
      const turb = new THREE.Group();
      const tower = cylinderMesh(1.1, 2.2, 62, standard(0xe3e4df, { roughness: 0.5 }), 12);
      tower.position.y = 31; turb.add(tower);
      const nacelle = boxMesh(2.2, 2.2, 5, standard(0xf0f0e8, { roughness: 0.5 }));
      nacelle.position.set(0, 62.5, -1); turb.add(nacelle);
      const rotor = new THREE.Group();
      rotor.position.set(0, 62.5, 2.4);
      for (let b = 0; b < 3; b++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(1.1, 29, 0.22), standard(0xecece6, { roughness: 0.6 }));
        blade.position.y = 14.5;
        const bg = new THREE.Group(); bg.rotation.z = (b / 3) * TAU; bg.add(blade); rotor.add(bg);
      }
      turb.add(rotor);
      turb.position.set(x, y, z);
      turb.rotation.y = rand() * TAU;
      this.group.add(turb);
      this.animated.push({ type: 'rotor', obj: rotor, speed: 0.35 + rand() * 0.25 });
    }
    // hay bales and farm silos
    for (let i = 0; i < 28; i++) {
      const a = rand() * TAU, r = 600 + rand() * 280;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (this.nearestOnRing(x, z).d < 30) continue;
      let nearDepot = false;
      for (const d of this.depots) if (Math.hypot(x - d.center.x, z - d.center.z) < 80) nearDepot = true;
      if (nearDepot) continue;
      const y = this.groundHeight(x, z);
      const bale = cylinderMesh(1.1, 1.1, 1.4, standard(0xc7b375, { roughness: 0.95 }), 12);
      bale.rotation.z = Math.PI / 2;
      bale.position.set(x, y + 1.0, z);
      this.group.add(bale);
    }
    // fence along outside of highway
    const fenceMat = standard(0x766246, { roughness: 0.95 });
    const fencePosts = [];
    for (let i = 0; i < RING_N; i += 4) {
      const r = this.ring[i];
      const p = r.p.clone().addScaledVector(r.right, 26);
      const y = this.groundHeight(p.x, p.z);
      fencePosts.push({ p: new THREE.Vector3(p.x, y, p.z), yaw: Math.atan2(r.t.x, r.t.z) });
    }
    const fp = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 1.2, 0.12), fenceMat, fencePosts.length);
    fencePosts.forEach((p, i) => {
      q.setFromAxisAngle(up, p.yaw);
      m4.compose(new THREE.Vector3(p.p.x, p.p.y + 0.6, p.p.z), q, new THREE.Vector3(1, 1, 1));
      fp.setMatrixAt(i, m4);
    });
    fp.castShadow = true; this.group.add(fp);
    // long rails as thin boxes between posts
    for (let i = 0; i < fencePosts.length - 1; i += 1) {
      const a = fencePosts[i].p, b = fencePosts[i + 1].p;
      if (a.distanceTo(b) > 30) continue;
      const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
      const len = a.distanceTo(b);
      const rail = boxMesh(0.06, 0.09, len, fenceMat);
      rail.position.set(mid.x, mid.y + 0.85, mid.z);
      rail.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
      rail.receiveShadow = false;
      this.group.add(rail);
    }
  }

  _buildRoadFurniture() {
    const postMat = new THREE.MeshStandardMaterial({ color: 0x8d9697, roughness: 0.5, metalness: 0.6 });
    const greenMat = new THREE.MeshStandardMaterial({ color: 0x1a6b45, roughness: 0.55 });
    const lightMat = new THREE.MeshBasicMaterial({ color: 0xffd68c });

    // overhead gantries at each depot
    for (const d of this.depots) {
      const idx = (d.idx + 30) % RING_N;
      const r = this.ring[idx];
      const g = new THREE.Group();
      g.position.copy(r.p);
      g.rotation.y = Math.atan2(r.t.x, r.t.z);
      for (const side of [-1, 1]) {
        const post = cylinderMesh(0.22, 0.3, 7.2, postMat, 10);
        post.position.set(side * 10.4, 3.6, 0);
        g.add(post);
      }
      const beam = boxMesh(21.5, 0.55, 0.7, postMat);
      beam.position.y = 7.3; g.add(beam);
      const signTex = makeSignTexture([d.name.toUpperCase(), 'EXIT  ' + (2 + this.depots.indexOf(d) * 3) + '   ·   1 km'], {
        bg: '#0e5b3a', color: '#f2f0e6', fontSize: 88, h: 300, border: '#f2f0e6', borderWidth: 8,
      });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(13, 3.8), new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.6 }));
      sign.position.set(0, 5.1, -0.4);
      sign.rotation.y = Math.PI;
      g.add(sign);
      const signBack = boxMesh(13, 3.8, 0.14, standard(0x3a4142, { roughness: 0.7 }));
      signBack.position.set(0, 5.1, 0);
      g.add(signBack);
      for (const side of [-1, 1]) {
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), lightMat);
        lamp.position.set(side * 5.2, 7.9, 0.4); g.add(lamp);
      }
      this.group.add(g);
    }
    // speed limit signs
    this.speedSigns = [];
    for (let i = 0; i < 10; i++) {
      const idx = Math.floor((i / 10) * RING_N + 45) % RING_N;
      const r = this.ring[idx];
      const side = i % 2 === 0 ? 1 : -1;
      const p = r.p.clone().addScaledVector(r.right, side * 10.6);
      const pole = cylinderMesh(0.06, 0.08, 3.2, postMat, 8);
      pole.position.set(p.x, 1.6, p.z); this.group.add(pole);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), new THREE.MeshStandardMaterial({
        map: speedSignTexture(i % 3 === 2 ? 80 : 90), transparent: true, side: THREE.DoubleSide, roughness: 0.6,
      }));
      sign.position.set(p.x, 3.4, p.z);
      sign.rotation.y = Math.atan2(r.t.x, r.t.z) + Math.PI / 2;
      this.group.add(sign);
    }
    // billboards
    const billboards = [
      ['HAULWAY', 'YOUR ROAD. YOUR CAREER.'],
      ['NORDVIK', 'HEAVY DUTY TYRES'],
      ['DIESEL 24/7', 'NORTHGATE SERVICES'],
      ['DRIVE SAFE', 'ARRIVE READY'],
    ];
    for (let i = 0; i < 6; i++) {
      const angle = 0.55 + i * 1.03;
      const rr = this.ringRadiusAtAngle(angle) + 46;
      const x = Math.cos(angle) * rr, z = Math.sin(angle) * rr;
      const y = this.groundHeight(x, z);
      const b = new THREE.Group();
      const pole = cylinderMesh(0.25, 0.35, 8, postMat, 8);
      pole.position.y = 4; b.add(pole);
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(12, 6), new THREE.MeshStandardMaterial({
        map: makeBillboardTexture(...billboards[i % billboards.length]), roughness: 0.6,
        emissive: 0x2a2a2a, side: THREE.DoubleSide,
      }));
      panel.position.y = 9.4; b.add(panel);
      const frame = boxMesh(12.4, 6.4, 0.3, standard(0x2a2e31, { roughness: 0.8 }));
      frame.position.y = 9.4; frame.position.z = -0.2; b.add(frame);
      b.position.set(x, y, z);
      b.rotation.y = Math.atan2(-x, -z) + Math.PI;
      this.group.add(b);
    }
    // access road lights
    for (const d of this.depots) {
      for (let i = 0; i < 4; i++) {
        const t = i / 4;
        const x = lerp(d.start.x, d.center.x, t), z = lerp(d.start.z, d.center.z, t);
        const side = i % 2 ? 1 : -1;
        const px = d.outerward ? 0 : 0;
        const perp = new THREE.Vector3(-d.outward.z, 0, d.outward.x);
        const pole = cylinderMesh(0.11, 0.15, 8, postMat, 8);
        pole.position.set(x + perp.x * side * 7, 4, z + perp.z * side * 7);
        this.group.add(pole);
        const head = boxMesh(1.1, 0.15, 0.35, lightMat);
        head.position.set(x + perp.x * side * 6.3, 7.9, z + perp.z * side * 6.3);
        this.group.add(head);
      }
    }
  }

  _buildSky() {
    this.skyUniforms = {
      uTop: { value: new THREE.Color('#2d6fb5') },
      uHorizon: { value: new THREE.Color('#c9dfea') },
      uSunColor: { value: new THREE.Color('#fff0c4') },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunStrength: { value: 1 },
      uNight: { value: 0 },
      uTime: { value: 0 },
    };
    const skyMat = new THREE.ShaderMaterial({
      uniforms: this.skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: `
        varying vec3 vWorld;
        void main(){ vWorld = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
      `,
      fragmentShader: `
        uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSunColor; uniform vec3 uSunDir;
        uniform float uSunStrength; uniform float uNight; uniform float uTime;
        varying vec3 vWorld;
        float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
        float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
          return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
        void main(){
          vec3 dir = normalize(vWorld - cameraPosition);
          float h = clamp(dir.y, -0.1, 1.0);
          vec3 col = mix(uHorizon, uTop, pow(clamp(h,0.0,1.0), 0.55));
          float sd = max(dot(dir, normalize(uSunDir)), 0.0);
          col += uSunColor * pow(sd, 900.0) * 3.2 * uSunStrength;
          col += uSunColor * pow(sd, 8.0) * 0.55 * uSunStrength;
          col += uSunColor * pow(sd, 2.0) * 0.13 * uSunStrength;
          // moon
          vec3 moonDir = -normalize(uSunDir);
          float md = max(dot(dir, moonDir), 0.0);
          col += vec3(0.75,0.82,0.95) * pow(md, 2400.0) * 2.2 * uNight;
          col += vec3(0.45,0.55,0.75) * pow(md, 18.0) * 0.16 * uNight;
          // high cloud veil
          if (h > 0.02) {
            vec2 uv = dir.xz / max(dir.y, 0.06) * 0.08 + vec2(uTime*0.002, uTime*0.0007);
            float n = noise(uv*1.5)*0.6 + noise(uv*3.2)*0.4;
            col = mix(col, mix(uHorizon, vec3(1.0), 0.35), smoothstep(0.55,0.85,n)*0.20*(1.0-uNight));
          }
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(4200, 48, 32), skyMat);
    sky.frustumCulled = false;
    this.scene.add(sky);
    this.sky = sky;

    // stars
    const starCount = 1600;
    const starPos = new Float32Array(starCount * 3);
    const rand = mulberry32(73);
    for (let i = 0; i < starCount; i++) {
      const theta = rand() * TAU;
      const phi = Math.acos(rand() * 0.95);
      const r = 3800;
      starPos[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
      starPos[i * 3 + 1] = Math.cos(phi) * r;
      starPos[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xdfe9ff, size: 10, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.stars = new THREE.Points(sg, this.starMat);
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);

    // clouds
    const cloudTex = makeCloudTexture();
    this.clouds = new THREE.Group();
    const crand = mulberry32(99);
    for (let i = 0; i < 16; i++) {
      const a = crand() * TAU;
      const r = 900 + crand() * 1700;
      const y = 180 + crand() * 210;
      const cluster = new THREE.Group();
      const puffs = 3 + Math.floor(crand() * 4);
      for (let j = 0; j < puffs; j++) {
        const mat = new THREE.SpriteMaterial({
          map: cloudTex, color: 0xffffff, transparent: true, opacity: 0.32,
          depthWrite: false, fog: false,
        });
        const sp = new THREE.Sprite(mat);
        sp.position.set((j - puffs / 2) * 80 + (crand() - 0.5) * 60, (crand() - 0.5) * 35, (crand() - 0.5) * 60);
        const scale = 170 + crand() * 190;
        sp.scale.set(scale, scale * 0.48, 1);
        cluster.add(sp);
      }
      cluster.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      this.clouds.add(cluster);
    }
    this.scene.add(this.clouds);

    this.sunLight = new THREE.DirectionalLight(0xfff2d8, 3.0);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 1;
    this.sunLight.shadow.camera.far = 500;
    this.sunLight.shadow.camera.left = -130;
    this.sunLight.shadow.camera.right = 130;
    this.sunLight.shadow.camera.top = 130;
    this.sunLight.shadow.camera.bottom = -130;
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.shadow.normalBias = 0.5;
    this.scene.add(this.sunLight);
    this.sunTarget = new THREE.Object3D();
    this.scene.add(this.sunTarget);
    this.sunLight.target = this.sunTarget;

    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x48523a, 0.75);
    this.scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0x606a75, 0.35);
    this.scene.add(this.ambient);
    this.scene.fog = new THREE.FogExp2(0xc9dfea, 0.00028);
  }

  _buildRain() {
    const count = 2500;
    const positions = new Float32Array(count * 6);
    this.rainDrops = [];
    const rand = mulberry32(8);
    for (let i = 0; i < count; i++) {
      this.rainDrops.push({
        x: (rand() - 0.5) * 130,
        y: rand() * 60,
        z: (rand() - 0.5) * 130,
        v: 36 + rand() * 22,
      });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xbcd2df, transparent: true, opacity: 0.32, depthWrite: false });
    this.rain = new THREE.LineSegments(geo, mat);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.scene.add(this.rain);
  }

  _buildEnvironmentMaps() {
    this.envMaps = {
      day: makeGradientEnv('#3b81c4', '#d8e8ef', { x: 0.4, y: 0.6 }, 'rgba(255,246,214,0.95)'),
      dusk: makeGradientEnv('#283a67', '#e6a06a', { x: 0.7, y: 0.1 }, 'rgba(255,176,92,0.95)'),
      night: makeGradientEnv('#03060f', '#101c2c', null, ''),
    };
    this.scene.environment = this.envMaps.day;
    this.scene.environmentIntensity = 0.8;
  }

  _initBeacon() {
    const g = new THREE.Group();
    const ringMat = new THREE.MeshBasicMaterial({
      map: makeRadialTexture('rgba(255,178,70,0.95)', 'rgba(255,178,70,0)'),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), ringMat);
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.12; g.add(ring);
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xffb046, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const beam = cylinderMesh(2.6, 5.5, 26, beamMat, 24);
    beam.position.y = 13; beam.castShadow = false; g.add(beam);
    const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(1.8, 0), new THREE.MeshBasicMaterial({ color: 0xffc76a }));
    diamond.position.y = 20; g.add(diamond);
    g.visible = false;
    this.scene.add(g);
    this.beacon = g;
    this.beaconRing = ring;
    this.beaconDiamond = diamond;
  }

  setDestination(pos) {
    if (!pos) { this.beacon.visible = false; this.destination = null; return; }
    this.destination = pos.clone();
    this.beacon.position.set(pos.x, 0, pos.z);
    this.beacon.visible = true;
  }

  setQuality(q) {
    this.quality = q;
    const high = q === 'high';
    this.sunLight.castShadow = high;
    this.sunLight.shadow.mapSize.set(high ? 2048 : q === 'medium' ? 1024 : 512, high ? 2048 : q === 'medium' ? 1024 : 512);
    this.rain.visible = this.weather.type === 'rain';
  }

  setTime(t) {
    this.time = t % 24;
    this._updateLighting(true);
  }

  _paletteFor(hour, weather) {
    const sunElev = Math.sin((hour - 6) / 12 * Math.PI);
    const night = smoothstep(0.16, -0.14, sunElev);
    const dusk = clamp(1 - Math.abs(sunElev) * 3.3, 0, 1) * (night < 0.98 ? 1 : 0.4);
    const rain = weather.type === 'rain' ? 1 : weather.type === 'cloudy' ? 0.5 : 0;
    const dayCol = new THREE.Color('#2d6fb5');
    const dayHor = new THREE.Color('#c9dfea');
    const duskCol = new THREE.Color('#283b64');
    const duskHor = new THREE.Color('#f0a261');
    const nightCol = new THREE.Color('#040812');
    const nightHor = new THREE.Color('#0e1c33');
    let top = dayCol.clone().lerp(duskCol, dusk).lerp(nightCol, night);
    let hor = dayHor.clone().lerp(duskHor, dusk).lerp(nightHor, night);
    if (rain) {
      top.lerp(new THREE.Color('#4a5b68'), rain * 0.55);
      hor.lerp(new THREE.Color('#8d9aa2'), rain * 0.6);
    }
    const sunColor = new THREE.Color('#fff0c4').lerp(new THREE.Color('#ff9a52'), dusk * 0.8).lerp(new THREE.Color('#9fb6da'), night);
    return { top, hor, sunColor, night, dusk, sunElev, rain };
  }

  _updateLighting(force = false) {
    const p = this._paletteFor(this.time, this.weather);
    const key = `${Math.round(this.time * 4)}-${this.weather.type}`;
    const isNight = p.night > 0.55;
    this.nightFactor = p.night;
    const elev = p.sunElev;
    const azimuth = ((this.time - 6) / 12) * Math.PI;
    const sunDir = new THREE.Vector3(Math.cos(azimuth) * 0.75, Math.max(-0.2, Math.sin(azimuth)), Math.sin(azimuth) * 0.5 - 0.35).normalize();
    this.sunDir = sunDir;
    this.skyUniforms.uTop.value.copy(p.top);
    this.skyUniforms.uHorizon.value.copy(p.hor);
    this.skyUniforms.uSunColor.value.copy(p.sunColor);
    this.skyUniforms.uSunDir.value.copy(sunDir);
    this.skyUniforms.uSunStrength.value = clamp(elev * 3, 0, 1.4);
    this.skyUniforms.uNight.value = p.night;
    this.skyUniforms.uTime.value = performance.now() * 0.001;
    this.starMat.opacity = clamp((p.night - 0.35) * 1.4, 0, 0.9);
    this.clouds.visible = p.rain < 0.8;
    for (const cluster of this.clouds.children) {
      for (const sp of cluster.children) {
        if (sp.material) {
          sp.material.opacity = (0.28 + p.rain * 0.18) * (1 - p.night * 0.55);
          sp.material.color.copy(p.hor).lerp(new THREE.Color(0xffffff), 0.55);
        }
      }
    }
    const lightIntensity = clamp(elev, 0, 1) * (3.4 - p.rain * 1.1);
    this.sunLight.intensity = Math.max(0.12, lightIntensity);
    this.sunLight.color.copy(p.sunColor);
    this.hemi.intensity = 0.18 + clamp(elev, 0, 1) * 0.75;
    this.hemi.color.copy(p.hor).lerp(new THREE.Color(0x9fc4ff), 0.45);
    this.hemi.groundColor.set('#3d4a32');
    this.ambient.intensity = 0.14 + clamp(elev, 0, 1) * 0.2;
    this.scene.fog.color.copy(p.hor);
    this.scene.fog.density = 0.00022 + p.rain * 0.0004 + p.night * 0.00015;
    this.waterUniforms.uSky.value.copy(p.hor);
    this.waterUniforms.uDeep.value.set('#173d49').multiplyScalar(1 - p.night * 0.5);
    this.waterUniforms.uSunDir.value.copy(sunDir);
    this.waterUniforms.uSunColor.value.copy(p.sunColor);
    this.waterUniforms.uNight.value = p.night;
    this.skyUniforms.uTime.value = performance.now() * 0.001;
    if (this.stars) this.stars.rotation.y += 0.0001;
    if (this.lineMat) {
      this.lineMat.emissiveIntensity = 0.15 + p.night * 0.25;
    }
    if (this.roadMaterial) {
      const wet = this.weather.type === 'rain' ? 1 : 0;
      this.roadMaterial.roughness = 0.8 - wet * 0.62;
      this.roadMaterial.metalness = 0.02 + wet * 0.32;
      this.roadMaterial.color.setScalar(1 - wet * 0.18 - p.night * 0.1);
      this.accessRoadMaterial.roughness = this.roadMaterial.roughness;
      this.accessRoadMaterial.metalness = this.roadMaterial.metalness;
      this.accessRoadMaterial.color.copy(this.roadMaterial.color);
    }
    // swap env map 4 times per day
    if (force || key !== this._lastPaletteKey) {
      this._lastPaletteKey = key;
      const env = p.night > 0.5 ? this.envMaps.night : p.dusk > 0.4 ? this.envMaps.dusk : this.envMaps.day;
      this.scene.environment = env;
      this.scene.environmentIntensity = 0.35 + (1 - p.night) * 0.7;
      this._setLightsNight(isNight);
    }
    this.isNight = isNight;
  }

  _setLightsNight(isNight) {
    if (!this._nightMatCache) {
      this._nightMatCache = [];
      this.group.traverse((o) => {
        if (o.isMesh && o.material && o.material.emissiveMap) this._nightMatCache.push(o.material);
      });
    }
    for (const m of this._nightMatCache) m.emissiveIntensity = isNight ? 1.15 : 0;
    if (this.lighthouseLamp) this.lighthouseLamp.material.color.set(isNight ? 0xffe6a0 : 0xffd98a);
  }

  setWeather(type) {
    this.weather.type = type;
    this.weather.intensity = type === 'rain' ? 1 : 0;
    this.rain.visible = type === 'rain';
    this._updateLighting(true);
  }

  zoneAt(x, z) {
    const nr = this.nearestOnRing(x, z);
    if (nr.d <= ROAD_HALF + 0.6) return { zone: 'road', limit: 90, road: nr };
    for (const d of this.depots) {
      if (Math.hypot(x - d.center.x, z - d.center.z) < 52) return { zone: 'depot', limit: 25, road: nr, depot: d };
      const a = d.start, b = d.center;
      const abx = b.x - a.x, abz = b.z - a.z;
      const t = clamp(((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz), 0, 1);
      const ex = a.x + abx * t, ez = a.z + abz * t;
      if (Math.hypot(x - ex, z - ez) < 5.6) return { zone: 'access', limit: 55, road: nr, depot: d };
    }
    return { zone: 'offroad', limit: 30, road: nr };
  }

  update(dt, camera, playerPos, gameTime, weather) {
    if (gameTime !== undefined) {
      this.time = gameTime % 24;
    }
    if (weather && weather !== this.weather.type) {
      this.weather.type = weather;
      this.weather.intensity = weather === 'rain' ? 1 : 0;
      this.rain.visible = weather === 'rain';
      this._updateLighting(true);
    }
    this.skyUniforms.uTime.value += dt;
    this.waterUniforms.uTime.value += dt;
    this.water.rotation.y += dt * 0.0004;
    this._updateLighting();
    if (playerPos) {
      const t = this.sunTarget;
      t.position.copy(playerPos);
      this.sunTarget.position.set(playerPos.x, 0, playerPos.z);
      this.sunLight.position.set(
        playerPos.x + this.sunDir.x * 220,
        Math.max(40, this.sunDir.y * 240 + 60),
        playerPos.z + this.sunDir.z * 220
      );
      this.sunTarget.updateMatrixWorld();
    }
    for (const a of this.animated) {
      if (a.type === 'rotor') a.obj.rotation.z += dt * a.speed;
      else if (a.type === 'blink') a.obj.visible = (performance.now() * 0.001 + a.phase) % 2 > 1.5;
    }
    if (this.beacon.visible) {
      const tt = performance.now() * 0.001;
      this.beaconRing.scale.setScalar(1 + Math.sin(tt * 2.2) * 0.08);
      this.beaconRing.material.opacity = 0.65 + Math.sin(tt * 2.2) * 0.2;
      this.beaconDiamond.position.y = 20 + Math.sin(tt * 1.5) * 0.8;
      this.beaconDiamond.rotation.y += dt * 0.6;
    }
    this.clouds.rotation.y += dt * 0.0009;
    if (this.rain.visible && camera) {
      const pos = this.rain.geometry.attributes.position;
      const arr = pos.array;
      this.rain.position.set(camera.position.x, 0, camera.position.z);
      for (let i = 0; i < this.rainDrops.length; i++) {
        const d = this.rainDrops[i];
        d.y -= d.v * dt;
        if (d.y < 0) d.y += 60;
        if (d.y > 60) d.y -= 60;
        const j = i * 6;
        arr[j] = d.x; arr[j + 1] = d.y; arr[j + 2] = d.z;
        arr[j + 3] = d.x + 0.05; arr[j + 4] = d.y - 1.4; arr[j + 5] = d.z;
      }
      pos.needsUpdate = true;
    }
  }

  getTimeOfDayName() {
    const t = this.time;
    if (t < 5 || t >= 21.5) return 'Night';
    if (t < 7.5) return 'Dawn';
    if (t < 17.5) return 'Day';
    return 'Dusk';
  }

  formatClock() { return formatTime(this.time); }
}
