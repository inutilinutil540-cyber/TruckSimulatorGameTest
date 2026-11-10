import * as THREE from 'three';
import {
  TAU, clamp, lerp, mulberry32, roundedBoxMesh, boxMesh, cylinderMesh, standard,
  makeRadialTexture, mergeStaticMeshes,
} from './utils.js';

const CAR_COLORS = [0x2b2f36, 0xb8bcc0, 0x8e2d2b, 0x31566b, 0xd8d4c8, 0x53604c, 0x1f2933, 0x9a7b50, 0x3c4560, 0xb54a36];

function makeGlowTexture() {
  return makeRadialTexture('rgba(255,235,190,0.9)', 'rgba(255,235,190,0)');
}

class CarModel {
  constructor(type, color, glowTex) {
    this.group = new THREE.Group();
    this.wheels = [];
    this.type = type;
    const paint = new THREE.MeshPhysicalMaterial({
      color, roughness: 0.33, metalness: 0.55, clearcoat: 0.8, clearcoatRoughness: 0.18, envMapIntensity: 1.2,
    });
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0x101b23, roughness: 0.08, metalness: 0.45, transparent: true, opacity: 0.78, envMapIntensity: 1.7,
    });
    const black = new THREE.MeshStandardMaterial({ color: 0x111316, roughness: 0.8 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xb8c0c4, roughness: 0.25, metalness: 0.9 });
    const head = new THREE.MeshStandardMaterial({ color: 0xf2f0e2, emissive: 0xffe8b0, emissiveIntensity: 0.2, roughness: 0.2 });
    const tail = new THREE.MeshStandardMaterial({ color: 0x8a1e17, emissive: 0xff1a08, emissiveIntensity: 0.4, roughness: 0.3 });
    this.headMats = [head];
    this.tailMats = [tail];

    let length = 4.4, width = 1.82;
    if (type === 'van') { length = 5.3; width = 2.0; }
    if (type === 'lorry') { length = 8.8; width = 2.45; }
    if (type === 'bus') { length = 11.2; width = 2.5; }
    this.length = length;
    this.width = width;

    if (type === 'sedan' || type === 'hatch') {
      const l = type === 'hatch' ? 3.85 : 4.45;
      this.length = l;
      const body = roundedBoxMesh(width, 0.55, l, 0.14, paint, 3);
      body.position.y = 0.68;
      this.group.add(body);
      const cabin = roundedBoxMesh(width * 0.88, 0.6, type === 'hatch' ? 2.1 : 2.35, 0.18, glass, 3);
      cabin.position.set(0, 1.22, type === 'hatch' ? -0.25 : -0.1);
      this.group.add(cabin);
      const roof = roundedBoxMesh(width * 0.8, 0.07, type === 'hatch' ? 1.9 : 2.1, 0.03, paint, 2);
      roof.position.set(0, 1.52, type === 'hatch' ? -0.25 : -0.1);
      this.group.add(roof);
      // bumpers
      for (const z of [-l / 2 + 0.05, l / 2 - 0.05]) {
        const bump = boxMesh(width * 0.96, 0.26, 0.18, black);
        bump.position.set(0, 0.48, z); this.group.add(bump);
      }
      for (const side of [-1, 1]) {
        const lamp = boxMesh(0.38, 0.13, 0.05, head);
        lamp.position.set(side * width * 0.32, 0.73, l / 2 - 0.02);
        this.group.add(lamp);
        const tl = boxMesh(0.34, 0.13, 0.05, tail);
        tl.position.set(side * width * 0.33, 0.72, -l / 2 + 0.02);
        this.group.add(tl);
        // mirrors
        const mir = boxMesh(0.16, 0.1, 0.06, paint);
        mir.position.set(side * width * 0.54, 1.08, 0.45);
        this.group.add(mir);
      }
      const grille = boxMesh(width * 0.55, 0.18, 0.04, black);
      grille.position.set(0, 0.6, l / 2 + 0.005); this.group.add(grille);
      this._addWheels(l, width, black, chrome);
    } else if (type === 'van') {
      const body = roundedBoxMesh(width, 1.62, length, 0.18, paint, 3);
      body.position.y = 1.02;
      this.group.add(body);
      const cab = roundedBoxMesh(width * 0.96, 0.72, 1.8, 0.16, glass, 3);
      cab.position.set(0, 1.45, length / 2 - 0.85);
      this.group.add(cab);
      const hood = roundedBoxMesh(width * 0.94, 0.32, 0.9, 0.1, paint, 2);
      hood.position.set(0, 0.83, length / 2 - 0.1); this.group.add(hood);
      for (const side of [-1, 1]) {
        const lamp = boxMesh(0.36, 0.17, 0.05, head);
        lamp.position.set(side * width * 0.32, 0.82, length / 2 - 0.01); this.group.add(lamp);
        const tl = boxMesh(0.16, 0.55, 0.05, tail);
        tl.position.set(side * width * 0.38, 1.1, -length / 2 + 0.01); this.group.add(tl);
        const stripe = boxMesh(0.01, 0.08, length * 0.7, new THREE.MeshStandardMaterial({ color: 0xf0a13a, roughness: 0.5 }));
        stripe.position.set(side * width / 2 + 0.005, 1.15, -0.3); this.group.add(stripe);
      }
      this._addWheels(length, width, black, chrome);
    } else if (type === 'lorry') {
      const cab = roundedBoxMesh(2.4, 2.3, 2.2, 0.16, paint, 3);
      cab.position.set(0, 1.75, 3.2); this.group.add(cab);
      const ws = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.85), glass);
      ws.position.set(0, 2.25, 4.31); this.group.add(ws);
      const box = new THREE.Mesh(new THREE.BoxGeometry(2.45, 2.5, 5.6), new THREE.MeshStandardMaterial({ color: 0xd8d4c9, roughness: 0.7 }));
      box.position.set(0, 2.25, -0.4); box.castShadow = true; this.group.add(box);
      for (const side of [-1, 1]) {
        const lamp = boxMesh(0.3, 0.15, 0.05, head);
        lamp.position.set(side * 0.95, 1.1, 4.31); this.group.add(lamp);
        const tl = boxMesh(0.2, 0.16, 0.05, tail);
        tl.position.set(side * 0.9, 0.9, -3.22); this.group.add(tl);
      }
      const bumper = boxMesh(2.4, 0.3, 0.2, black);
      bumper.position.set(0, 0.6, 4.3); this.group.add(bumper);
      this._addWheels(7.2, width, black, chrome, 0.42);
    } else if (type === 'bus') {
      const body = roundedBoxMesh(width, 2.65, length, 0.22, paint, 3);
      body.position.y = 1.6; this.group.add(body);
      // window band
      for (const side of [-1, 1]) {
        const win = boxMesh(0.03, 0.9, length * 0.85, glass);
        win.position.set(side * width / 2 + 0.01, 2.35, -0.3); this.group.add(win);
      }
      const front = boxMesh(width * 0.86, 1.1, 0.04, glass);
      front.position.set(0, 2.2, length / 2 + 0.01); this.group.add(front);
      for (const side of [-1, 1]) {
        const lamp = boxMesh(0.35, 0.15, 0.05, head);
        lamp.position.set(side * width * 0.34, 0.85, length / 2 + 0.02); this.group.add(lamp);
        const tl = boxMesh(0.25, 0.18, 0.05, tail);
        tl.position.set(side * width * 0.36, 0.9, -length / 2 - 0.02); this.group.add(tl);
      }
      this._addWheels(8.5, width, black, chrome, 0.46);
    }
    // glow sprites
    this.glows = [];
    const frontZ = this.length / 2 + 0.1;
    for (const side of [-1, 1]) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color: 0xffe3ad, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      sp.position.set(side * this.width * 0.33, 0.75, frontZ);
      sp.scale.set(2.2, 2.2, 1);
      this.group.add(sp);
      this.glows.push(sp);
    }
    this.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    // At traffic scale the wheel spin is imperceptible; baking them into the
    // body cuts each car down to one draw per material.
    mergeStaticMeshes(this.group);
  }

  _addWheels(length, width, black, chrome, radius = 0.34) {
    for (const z of [length * 0.32, -length * 0.32]) {
      for (const x of [-width / 2 + 0.08, width / 2 - 0.08]) {
        const spin = new THREE.Group();
        spin.position.set(x, radius, z);
        const tire = cylinderMesh(radius, radius, 0.24, black, 14);
        tire.rotation.z = Math.PI / 2;
        spin.add(tire);
        const hub = cylinderMesh(radius * 0.55, radius * 0.55, 0.26, chrome, 10);
        hub.rotation.z = Math.PI / 2;
        spin.add(hub);
        this.group.add(spin);
        this.wheels.push(spin);
      }
    }
  }

  setLights(on) {
    for (const m of this.headMats) m.emissiveIntensity = on ? 1.5 : 0.15;
    for (const m of this.tailMats) m.emissiveIntensity = on ? 1.2 : 0.3;
    for (const g of this.glows) g.material.opacity = on ? 0.42 : 0;
  }
}

export class Traffic {
  constructor(scene, world, quality = 'high') {
    this.scene = scene;
    this.world = world;
    this.vehicles = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    this.glowTex = makeGlowTexture();
    this.rand = mulberry32(5150);
    const types = ['sedan', 'sedan', 'hatch', 'van', 'sedan', 'hatch', 'van', 'lorry', 'bus', 'sedan', 'hatch', 'sedan'];
    const count = quality === 'low' ? 12 : quality === 'medium' ? 20 : 30;
    for (let i = 0; i < count; i++) {
      const type = types[i % types.length];
      const dir = i % 2 === 0 ? 1 : -1;
      const lane = i % 4 < 2 ? 2 : 6;
      const color = CAR_COLORS[Math.floor(this.rand() * CAR_COLORS.length)];
      const model = new CarModel(type, color, this.glowTex);
      const speed = type === 'lorry' ? 18 + this.rand() * 3 : type === 'bus' ? 19 + this.rand() * 3 : 20 + this.rand() * 6;
      const s = (i / count) * world.ringLength + this.rand() * 60;
      this.group.add(model.group);
      this.vehicles.push({ model, dir, lane, speed, baseSpeed: speed, s, yaw: 0, pos: new THREE.Vector3() });
    }
    this._tmp = new THREE.Vector3();
  }

  update(dt, player, isNight) {
    for (const v of this.vehicles) {
      const ahead = this.world.sampleRing(v.s + v.dir * 20);
      // crude courtesy: slow if the player is close ahead in our lane
      let targetSpeed = v.baseSpeed;
      if (player) {
        const dx = player.x - v.pos.x, dz = player.z - v.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 26) {
          const fwd = this._tmp.set(Math.sin(v.yaw), 0, Math.cos(v.yaw));
          const proj = dx * fwd.x + dz * fwd.z;
          const lat = Math.abs(dx * fwd.z - dz * fwd.x);
          if (proj > 0 && proj < 18 && lat < 3.4) targetSpeed = Math.max(0, v.speed - 8);
        }
      }
      v.speed = lerp(v.speed, targetSpeed, 1 - Math.exp(-2 * dt));
      v.s += v.speed * v.dir * dt;
      v.s = ((v.s % this.world.ringLength) + this.world.ringLength) % this.world.ringLength;
      const sample = this.world.sampleRing(v.s);
      const off = v.lane * v.dir;
      v.pos.set(
        sample.p.x + sample.right.x * off,
        0.02,
        sample.p.z + sample.right.z * off
      );
      const fx = sample.t.x * v.dir, fz = sample.t.z * v.dir;
      v.yaw = Math.atan2(fx, fz);
      v.model.group.position.copy(v.pos);
      v.model.group.rotation.y = v.yaw;
      for (const w of v.model.wheels) w.rotation.x += v.speed * dt / 0.34;
      v.model.setLights(isNight);
    }
  }

  checkCollision(truckGroup, truckSpeed) {
    for (const v of this.vehicles) {
      const dx = truckGroup.position.x - v.pos.x;
      const dz = truckGroup.position.z - v.pos.z;
      const d = Math.hypot(dx, dz);
      const minDist = 2.2 + v.model.length * 0.38;
      if (d < minDist) {
        return { vehicle: v, dx, dz, d };
      }
    }
    return null;
  }
}
