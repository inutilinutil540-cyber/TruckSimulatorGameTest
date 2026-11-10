import * as THREE from 'three';
import {
  TAU, clamp, lerp, damp, wrapAngle, boxMesh, cylinderMesh, roundedBoxMesh,
  standard, makeCanvas, canvasTexture, makeDoorLogoTexture, makeTrailerSideTexture,
  makeRadialTexture, formatMoney, mergeStaticMeshes,
} from './utils.js';

const WHEEL_R = 0.53;
const TRUCK_MASS = 35500;

function addShadow(obj) {
  obj.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });
  return obj;
}

export class Truck {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.body = new THREE.Group();
    this.group.add(this.body);
    scene.add(this.group);
    this.steer = 0;
    this.speed = 0;
    this.heading = 0;
    this.trailerHeading = 0;
    this.trailer = null;
    this.trailerSlot = null;
    this.wheels = [];
    this.frontCameraOffset = new THREE.Vector3();
    this.cameraYaw = 0;
    this.cameraPitch = 0;
    this.cameraYawTarget = 0;
    this.cameraPitchTarget = 0;
    this.cameraMode = 'cockpit';
    this.cameraPos = new THREE.Vector3();
    this.cameraLook = new THREE.Vector3();
    this.lastCamMode = '';
    this.bob = 0;
    this.bobVel = 0;
    this.engineOn = true;
    this.lightsOn = false;
    this.gear = 1;
    this.rpm = 620;
    this.fuel = 78;
    this.fuelCapacity = 620;
    this.damage = 0;
    this.odometer = 0;
    this.paintColor = '#c75d2d';
    this.reverseTimer = 0;
    this.reversing = false;
    this.shiftTimer = 0;
    this.steerWheelAngle = 0;
    this.temp = 78;
    this._gaugeTimer = 0;
    this._navTimer = 0;
    this.lookAtTarget = new THREE.Vector3();
    this._cockpitPos = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this.wheelSpin = 0;
    this._buildMaterials();
    this._buildTruck();
    this._buildLights();
    this._buildGauges();
    this._optimiseGeometry();
    this.setPaint(this.paintColor);
    this.showExterior(true);
  }

  _optimiseGeometry() {
    // Wheels, the wheel itself and the wipers rotate every frame, so keep
    // those as their own small merged units rather than baking them into the
    // body. Everything else becomes one draw per material.
    for (const wheel of this.wheels) {
      wheel.spin.userData.noMerge = true;
      mergeStaticMeshes(wheel.spin);
    }
    this.steeringWheel.userData.noMerge = true;
    mergeStaticMeshes(this.steeringWheel);
    for (const wiper of this.wipers) {
      wiper.pivot.userData.noMerge = true;
      mergeStaticMeshes(wiper.pivot);
    }
    this.gaugeScreen.userData.noMerge = true;
    this.navScreen.userData.noMerge = true;
    mergeStaticMeshes(this.cabExterior);
    mergeStaticMeshes(this.mirrors);
    mergeStaticMeshes(this.interior, [
      this.steeringWheel, this.gaugeScreen, this.navScreen,
      ...this.wipers.map((w) => w.pivot),
    ]);
    mergeStaticMeshes(this.body, [this.cabExterior, this.mirrors, this.interior]);
  }

  _buildMaterials() {
    this.mat = {
      paint: new THREE.MeshPhysicalMaterial({
        color: 0xc75d2d, roughness: 0.26, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.12,
        envMapIntensity: 1.4,
      }),
      paintDark: new THREE.MeshPhysicalMaterial({
        color: 0x1c2228, roughness: 0.32, metalness: 0.5, clearcoat: 0.6, clearcoatRoughness: 0.2,
      }),
      chrome: new THREE.MeshStandardMaterial({ color: 0xd7dee2, roughness: 0.14, metalness: 1, envMapIntensity: 1.5 }),
      darkChrome: new THREE.MeshStandardMaterial({ color: 0x787f84, roughness: 0.3, metalness: 0.9 }),
      black: new THREE.MeshStandardMaterial({ color: 0x0c0e10, roughness: 0.72, metalness: 0.1 }),
      plastic: new THREE.MeshStandardMaterial({ color: 0x262b30, roughness: 0.62, metalness: 0.15 }),
      rubber: new THREE.MeshStandardMaterial({ color: 0x101113, roughness: 0.92, metalness: 0 }),
      glass: new THREE.MeshPhysicalMaterial({
        color: 0x0f1d26, roughness: 0.04, metalness: 0.35, transparent: true, opacity: 0.72,
        envMapIntensity: 2.2, side: THREE.DoubleSide,
      }),
      interior: new THREE.MeshStandardMaterial({ color: 0x101214, roughness: 0.9, metalness: 0.02 }),
      interiorSoft: new THREE.MeshStandardMaterial({ color: 0x191c1f, roughness: 0.96 }),
      leather: new THREE.MeshStandardMaterial({ color: 0x241f1b, roughness: 0.85 }),
      chromeDark: new THREE.MeshStandardMaterial({ color: 0x3b4145, roughness: 0.35, metalness: 0.9 }),
      headlight: new THREE.MeshStandardMaterial({ color: 0xe8edf0, emissive: 0xffe6b0, emissiveIntensity: 0.2, roughness: 0.2 }),
      taillight: new THREE.MeshStandardMaterial({ color: 0x84241d, emissive: 0xff1808, emissiveIntensity: 0.3, roughness: 0.3 }),
      amber: new THREE.MeshStandardMaterial({ color: 0xb8731e, emissive: 0xff8c16, emissiveIntensity: 0.4, roughness: 0.3 }),
      reverse: new THREE.MeshStandardMaterial({ color: 0xd8d8d0, emissive: 0xfff6d0, emissiveIntensity: 0.1 }),
      white: new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 0.5 }),
      red: new THREE.MeshStandardMaterial({ color: 0x9e2d24, roughness: 0.5, metalness: 0.2 }),
      tire: new THREE.MeshStandardMaterial({ color: 0x0b0c0d, roughness: 0.94 }),
      rim: new THREE.MeshStandardMaterial({ color: 0x8d9498, roughness: 0.28, metalness: 0.9 }),
      orange: new THREE.MeshStandardMaterial({ color: 0xd97a2b, roughness: 0.5 }),
    };
  }

  _wheel(x, z, steerable = false, dual = false) {
    const pivot = new THREE.Group();
    pivot.position.set(x, WHEEL_R, z);
    const spin = new THREE.Group();
    pivot.add(spin);
    const width = dual ? 0.62 : 0.34;
    const tire = cylinderMesh(WHEEL_R, WHEEL_R, width, this.mat.tire, 26);
    tire.rotation.z = Math.PI / 2;
    spin.add(tire);
    // sidewall shoulders
    for (const side of [-1, 1]) {
      const ring = cylinderMesh(WHEEL_R * 0.86, WHEEL_R * 0.86, 0.035, this.mat.tire, 24);
      ring.rotation.z = Math.PI / 2;
      ring.position.x = side * width / 2;
      spin.add(ring);
    }
    // tread blocks
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * TAU;
      const block = boxMesh(0.1, 0.11, width * 0.92, this.mat.rubber);
      block.position.set(0, Math.cos(a) * (WHEEL_R - 0.015), Math.sin(a) * (WHEEL_R - 0.015));
      block.rotation.x = -a;
      spin.add(block);
    }
    const hub = cylinderMesh(0.32, 0.32, width + 0.03, this.mat.rim, 18);
    hub.rotation.z = Math.PI / 2;
    spin.add(hub);
    const cap = cylinderMesh(0.13, 0.13, width + 0.07, this.mat.chrome, 14);
    cap.rotation.z = Math.PI / 2;
    spin.add(cap);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      const bolt = cylinderMesh(0.023, 0.023, 0.03, this.mat.chrome, 6);
      bolt.rotation.z = Math.PI / 2;
      bolt.position.set(width / 2 + 0.03, Math.cos(a) * 0.21, Math.sin(a) * 0.21);
      spin.add(bolt);
    }
    this.group.add(pivot);
    const entry = { pivot, spin, steerable };
    this.wheels.push(entry);
    return entry;
  }

  _buildTruck() {
    const b = this.body;
    this.cabExterior = new THREE.Group();
    this.mirrors = new THREE.Group();
    this.interior = new THREE.Group();
    b.add(this.cabExterior, this.mirrors, this.interior);
    // chassis rails
    for (const x of [-0.52, 0.52]) {
      const rail = boxMesh(0.16, 0.28, 6.6, this.mat.chromeDark);
      rail.position.set(x, 0.72, -0.4);
      b.add(rail);
    }
    // cross members
    for (const z of [2.2, 0.8, -0.8, -2.2]) {
      const cm = boxMesh(1.2, 0.14, 0.18, this.mat.chromeDark);
      cm.position.set(0, 0.68, z);
      b.add(cm);
    }
    // cab main body
    const cab = roundedBoxMesh(2.47, 2.42, 2.68, 0.2, this.mat.paint, 4);
    cab.position.set(0, 2.18, 1.52);
    this.cabExterior.add(cab);
    // high roof fairing
    const roof = roundedBoxMesh(2.3, 0.52, 1.5, 0.14, this.mat.paint, 3);
    roof.position.set(0, 3.55, 1.24);
    this.cabExterior.add(roof);
    const deflector = boxMesh(2.2, 0.22, 0.65, this.mat.paint);
    deflector.position.set(0, 3.76, 1.9);
    deflector.rotation.x = -0.12;
    this.cabExterior.add(deflector);
    // windshield
    const wsMat = new THREE.MeshPhysicalMaterial({
      color: 0x050c12, roughness: 0.05, metalness: 0.55, transparent: true, opacity: 0.86,
      envMapIntensity: 2.5, side: THREE.DoubleSide,
    });
    this.windshieldMat = wsMat;
    const ws = new THREE.Mesh(new THREE.PlaneGeometry(2.12, 1.16), wsMat);
    ws.position.set(0, 2.72, 2.872);
    this.cabExterior.add(ws);
    const wsTop = boxMesh(2.24, 0.09, 0.08, this.mat.black);
    wsTop.position.set(0, 3.3, 2.88); this.cabExterior.add(wsTop);
    const wsBot = boxMesh(2.24, 0.1, 0.08, this.mat.black);
    wsBot.position.set(0, 2.13, 2.88); this.cabExterior.add(wsBot);
    const wsMid = boxMesh(0.055, 1.16, 0.02, this.mat.black);
    wsMid.position.set(0, 2.72, 2.9); this.cabExterior.add(wsMid);
    // side windows
    for (const side of [-1, 1]) {
      const sw = new THREE.Mesh(new THREE.PlaneGeometry(1.28, 0.86), wsMat);
      sw.rotation.y = side * Math.PI / 2;
      sw.position.set(side * 1.251, 2.7, 1.62);
      this.cabExterior.add(sw);
      const divider = boxMesh(0.06, 0.9, 0.06, this.mat.black);
      divider.position.set(side * 1.26, 2.7, 2.11); this.cabExterior.add(divider);
      // door seam
      const seam = boxMesh(0.02, 1.7, 0.035, this.mat.black);
      seam.position.set(side * 1.248, 1.8, 0.28); this.cabExterior.add(seam);
      const handle = boxMesh(0.03, 0.07, 0.28, this.mat.chrome);
      handle.position.set(side * 1.27, 1.82, 1.25); this.cabExterior.add(handle);
      // steps
      for (let i = 0; i < 2; i++) {
        const step = boxMesh(0.55, 0.06, 0.58, this.mat.chromeDark);
        step.position.set(side * 1.04, 0.72 + i * 0.38, 0.85);
        this.cabExterior.add(step);
        const tread = boxMesh(0.45, 0.015, 0.48, this.mat.chrome);
        tread.position.set(side * 1.04, 0.76 + i * 0.38, 0.85);
        this.cabExterior.add(tread);
      }
      // side skirts
      const skirt = boxMesh(0.18, 0.52, 2.5, this.mat.paintDark);
      skirt.position.set(side * 1.19, 0.61, -0.9);
      this.cabExterior.add(skirt);
      // reflective stripe
      const stripe = boxMesh(0.015, 0.05, 2.2, this.mat.orange);
      stripe.position.set(side * 1.285, 1.12, 0.2);
      this.cabExterior.add(stripe);
      // door logo
      const logo = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.62), new THREE.MeshStandardMaterial({
        map: makeDoorLogoTexture(), transparent: true, roughness: 0.5, metalness: 0.1, depthWrite: false,
      }));
      logo.rotation.y = side * Math.PI / 2;
      logo.position.set(side * 1.254, 2.04, 1.56);
      this.cabExterior.add(logo);
      // mirror arms
      const arm = cylinderMesh(0.025, 0.025, 0.55, this.mat.darkChrome, 8);
      arm.rotation.z = Math.PI / 2;
      arm.position.set(side * 1.46, 2.98, 3.12);
      this.mirrors.add(arm);
      const arm2 = cylinderMesh(0.025, 0.025, 0.45, this.mat.darkChrome, 8);
      arm2.rotation.z = Math.PI / 2;
      arm2.position.set(side * 1.42, 2.32, 3.18);
      this.mirrors.add(arm2);
      const housing = roundedBoxMesh(0.16, 0.6, 0.34, 0.05, this.mat.paintDark, 2);
      housing.position.set(side * 1.68, 2.74, 3.10);
      this.mirrors.add(housing);
      const mirror = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 0.5), new THREE.MeshPhysicalMaterial({
        color: 0x1f2b33, roughness: 0.03, metalness: 0.9, envMapIntensity: 2,
      }));
      mirror.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      mirror.position.set(side * 1.77, 2.74, 3.0);
      this.mirrors.add(mirror);
      const mirrorLamp = boxMesh(0.03, 0.05, 0.2, this.mat.amber);
      mirrorLamp.position.set(side * 1.675, 2.40, 3.10);
      this.mirrors.add(mirrorLamp);
    }
    // front fascia / bumper
    const bumper = roundedBoxMesh(2.5, 0.52, 0.34, 0.08, this.mat.paintDark, 2);
    bumper.position.set(0, 0.82, 2.86);
    this.cabExterior.add(bumper);
    const spoiler = boxMesh(2.35, 0.18, 0.2, this.mat.black);
    spoiler.position.set(0, 0.58, 2.96);
    this.cabExterior.add(spoiler);
    // grille
    const grille = boxMesh(1.85, 0.78, 0.1, this.mat.black);
    grille.position.set(0, 1.58, 2.885);
    this.cabExterior.add(grille);
    for (let i = 0; i < 4; i++) {
      const bar = boxMesh(1.75, 0.045, 0.06, this.mat.chrome);
      bar.position.set(0, 1.3 + i * 0.18, 2.94);
      this.cabExterior.add(bar);
    }
    const emblem = new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0), this.mat.chrome);
    emblem.position.set(0, 1.74, 2.96); emblem.scale.z = 0.3;
    this.cabExterior.add(emblem);
    // headlights
    for (const side of [-1, 1]) {
      const housing = roundedBoxMesh(0.56, 0.32, 0.12, 0.04, this.mat.darkChrome, 2);
      housing.position.set(side * 0.83, 1.12, 2.91);
      this.cabExterior.add(housing);
      const lamp = boxMesh(0.42, 0.13, 0.035, this.mat.headlight);
      lamp.position.set(side * 0.83, 1.15, 2.975);
      this.cabExterior.add(lamp);
      const drl = boxMesh(0.4, 0.035, 0.03, this.mat.headlight);
      drl.position.set(side * 0.83, 1.26, 2.98);
      this.cabExterior.add(drl);
      const fog = boxMesh(0.19, 0.1, 0.03, this.mat.amber);
      fog.position.set(side * 0.83, 0.78, 3.035);
      this.cabExterior.add(fog);
      // indicator
      const ind = boxMesh(0.1, 0.08, 0.04, this.mat.amber);
      ind.position.set(side * 1.14, 1.04, 2.94);
      this.cabExterior.add(ind);
    }
    // sun visor
    const visor = boxMesh(2.3, 0.18, 0.45, this.mat.paintDark);
    visor.position.set(0, 3.42, 2.62); visor.rotation.x = 0.15;
    this.cabExterior.add(visor);
    // roof marker lights
    for (let i = -2; i <= 2; i++) {
      const lamp = boxMesh(0.13, 0.07, 0.07, this.mat.amber);
      lamp.position.set(i * 0.4, 3.63, 2.78);
      this.cabExterior.add(lamp);
    }
    // air horns
    for (const side of [-1, 1]) {
      const horn = cylinderMesh(0.055, 0.055, 0.46, this.mat.chrome, 10);
      horn.rotation.x = Math.PI / 2;
      horn.position.set(side * 0.5, 3.68, 1.0);
      this.cabExterior.add(horn);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.12, 10), this.mat.chrome);
      cap.rotation.x = Math.PI / 2; cap.position.set(side * 0.5, 3.68, 1.25);
      this.cabExterior.add(cap);
    }
    // antenna
    const ant = cylinderMesh(0.008, 0.008, 0.9, this.mat.black, 4);
    ant.position.set(-1.0, 3.7, 0.8); ant.rotation.z = -0.15; this.cabExterior.add(ant);
    // exhaust stacks
    for (const side of [-1, 1]) {
      const stack = cylinderMesh(0.085, 0.1, 2.0, this.mat.chrome, 12);
      stack.position.set(side * 1.02, 1.95, -0.2);
      this.cabExterior.add(stack);
      const shield = boxMesh(0.18, 1.4, 0.3, this.mat.darkChrome);
      shield.position.set(side * 1.04, 1.8, -0.2);
      this.cabExterior.add(shield);
      const tip = cylinderMesh(0.105, 0.095, 0.18, this.mat.black, 10);
      tip.position.set(side * 1.02, 3.03, -0.2);
      this.cabExterior.add(tip);
    }
    // fuel tanks
    for (const side of [-1, 1]) {
      const tank = cylinderMesh(0.35, 0.35, 1.55, this.mat.chrome, 20);
      tank.rotation.x = Math.PI / 2;
      tank.position.set(side * 0.95, 0.76, -0.22);
      this.cabExterior.add(tank);
      for (const zz of [-0.75, 0.32]) {
        const strap = cylinderMesh(0.362, 0.362, 0.05, this.mat.darkChrome, 20);
        strap.rotation.x = Math.PI / 2; strap.position.set(side * 0.95, 0.76, zz);
        this.cabExterior.add(strap);
      }
      const cap = cylinderMesh(0.09, 0.09, 0.05, this.mat.chrome, 12);
      cap.rotation.x = Math.PI / 2;
      cap.position.set(side * 0.95, 1.12, 0.4);
      this.cabExterior.add(cap);
    }
    // fifth wheel
    const plate = boxMesh(1.25, 0.14, 1.15, this.mat.darkChrome);
    plate.position.set(0, 1.02, -1.8);
    b.add(plate);
    const pin = cylinderMesh(0.09, 0.09, 0.22, this.mat.chrome, 10);
    pin.position.set(0, 1.13, -1.82);
    b.add(pin);
    // rear chassis tail
    const tail = boxMesh(2.2, 0.2, 0.2, this.mat.darkChrome);
    tail.position.set(0, 0.72, -3.0); b.add(tail);
    for (const side of [-1, 1]) {
      const lamp = boxMesh(0.2, 0.16, 0.05, this.mat.taillight);
      lamp.position.set(side * 0.85, 0.78, -3.1); b.add(lamp);
    }
    // fenders
    for (const [x, z] of [[-1.12, 2.15], [1.12, 2.15], [-1.12, -1.6], [1.12, -1.6], [-1.12, -2.78], [1.12, -2.78]]) {
      const fender = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.68, 0.44, 16, 1, true, Math.PI * 0.08, Math.PI * 0.84), this.mat.paintDark);
      fender.rotation.z = Math.PI / 2;
      fender.rotation.y = Math.PI / 2;
      fender.position.set(x, 0.72, z);
      fender.material.side = THREE.DoubleSide;
      b.add(fender);
    }
    // mudflaps
    for (const side of [-1, 1]) {
      const flap = boxMesh(0.42, 0.48, 0.03, this.mat.rubber);
      flap.position.set(side * 1.14, 0.4, -3.34);
      b.add(flap);
    }
    // wheels
    this._wheel(-1.13, 2.15, true);
    this._wheel(1.13, 2.15, true);
    this._wheel(-1.14, -1.6, false, true);
    this._wheel(1.14, -1.6, false, true);
    this._wheel(-1.14, -2.78, false, true);
    this._wheel(1.14, -2.78, false, true);

    // ---- interior ----
    const i = this.interior;
    const dashMat = this.mat.interior;
    // floor
    const floor = boxMesh(2.25, 0.08, 2.45, this.mat.interiorSoft);
    floor.position.set(0, 1.03, 1.55); i.add(floor);
    // dashboard
    const dash = roundedBoxMesh(2.3, 0.48, 0.7, 0.08, dashMat, 2);
    dash.position.set(0, 1.8, 2.18); i.add(dash);
    const dashPad = roundedBoxMesh(2.32, 0.13, 0.7, 0.05, this.mat.interiorSoft, 2);
    dashPad.position.set(0, 2.0, 2.16); i.add(dashPad);
    // center stack
    const center = roundedBoxMesh(0.55, 0.6, 0.28, 0.04, dashMat, 2);
    center.position.set(-0.16, 1.95, 2.44); center.rotation.x = 0.1; i.add(center);
    // instrument binnacle
    const bin = roundedBoxMesh(0.7, 0.3, 0.22, 0.05, this.mat.black, 2);
    bin.position.set(0.6, 2.19, 2.24); bin.rotation.x = 0.3; i.add(bin);
    // gauge screen
    this.gaugeCanvas = makeCanvas(512, 256);
    this.gaugeTexture = canvasTexture(this.gaugeCanvas);
    const gauge = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.28), new THREE.MeshBasicMaterial({ map: this.gaugeTexture }));
    gauge.position.set(0.6, 2.2, 2.07);
    gauge.rotation.y = Math.PI;
    gauge.rotateX(-0.26);
    i.add(gauge);
    this.gaugeScreen = gauge;
    // nav display
    this.navCanvas = makeCanvas(512, 256);
    this.navTexture = canvasTexture(this.navCanvas);
    const nav = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.23), new THREE.MeshBasicMaterial({ map: this.navTexture }));
    nav.position.set(-0.16, 2.16, 2.291);
    nav.rotation.y = Math.PI;
    nav.rotateX(-0.22);
    i.add(nav);
    this.navScreen = nav;
    // steering column
    const column = cylinderMesh(0.06, 0.08, 0.55, this.mat.black, 12);
    column.rotation.x = Math.PI / 2 - 0.2;
    column.position.set(0.6, 2.02, 2.02); i.add(column);
    this.steeringWheel = new THREE.Group();
    this.steeringWheel.position.set(0.6, 2.0, 1.8);
    this.steeringWheel.rotation.x = -0.34;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.225, 0.026, 10, 36), this.mat.leather);
    this.steeringWheel.add(rim);
    for (let s = 0; s < 3; s++) {
      const spoke = boxMesh(0.32, 0.035, 0.02, this.mat.chromeDark);
      spoke.rotation.z = (s / 3) * TAU + 0.5;
      spoke.position.set(Math.cos((s / 3) * TAU + 0.5) * 0.12, Math.sin((s / 3) * TAU + 0.5) * 0.12, 0);
      this.steeringWheel.add(spoke);
    }
    const hub = cylinderMesh(0.065, 0.065, 0.03, this.mat.chrome, 16);
    hub.rotation.x = Math.PI / 2;
    this.steeringWheel.add(hub);
    i.add(this.steeringWheel);
    // seats
    for (const side of [-1, 1]) {
      const seat = roundedBoxMesh(0.55, 0.16, 0.58, 0.07, this.mat.leather, 2);
      seat.position.set(side * 0.62, 1.28, 0.82); i.add(seat);
      const back = roundedBoxMesh(0.55, 0.8, 0.16, 0.07, this.mat.leather, 2);
      back.position.set(side * 0.62, 1.72, 0.58); back.rotation.x = -0.13; i.add(back);
      const head = roundedBoxMesh(0.32, 0.22, 0.12, 0.06, this.mat.leather, 2);
      head.position.set(side * 0.62, 2.13, 0.52); head.rotation.x = -0.13; i.add(head);
      const belt = boxMesh(0.06, 0.9, 0.025, this.mat.black);
      belt.position.set(side * 0.81, 1.66, 0.63); belt.rotation.x = -0.12; i.add(belt);
    }
    // center console / bunk
    const consoleBox = roundedBoxMesh(0.38, 0.42, 1.25, 0.06, this.mat.interiorSoft, 2);
    consoleBox.position.set(0, 1.25, 1.18); i.add(consoleBox);
    const cup = cylinderMesh(0.045, 0.04, 0.1, this.mat.white, 10);
    cup.position.set(-0.1, 1.56, 1.75); i.add(cup);
    const shift = cylinderMesh(0.02, 0.025, 0.28, this.mat.chrome, 8);
    shift.position.set(-0.16, 1.5, 1.44); shift.rotation.x = 0.2; i.add(shift);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 8), this.mat.black);
    knob.position.set(-0.16, 1.64, 1.46); i.add(knob);
    // rear bunk / curtain
    const bunk = boxMesh(2.05, 0.18, 0.62, this.mat.leather);
    bunk.position.set(0, 1.42, -0.02); i.add(bunk);
    const curtain = boxMesh(2.15, 1.5, 0.05, new THREE.MeshStandardMaterial({ color: 0x343a40, roughness: 1 }));
    curtain.position.set(0, 1.05, 0.2); i.add(curtain);
    // A pillars / roof
    for (const side of [-1, 1]) {
      const pillar = boxMesh(0.08, 1.55, 0.11, this.mat.interiorSoft);
      pillar.position.set(side * 1.17, 2.45, 2.73); pillar.rotation.z = side * 0.05; i.add(pillar);
      const door = boxMesh(0.05, 1.0, 1.7, this.mat.interiorSoft);
      door.position.set(side * 1.2, 1.7, 1.35); i.add(door);
      const sill = boxMesh(0.12, 0.08, 1.7, this.mat.interiorSoft);
      sill.position.set(side * 1.13, 2.15, 1.35); i.add(sill);
      const speaker = cylinderMesh(0.09, 0.09, 0.02, this.mat.black, 16);
      speaker.rotation.z = Math.PI / 2; speaker.position.set(side * 1.2, 1.55, 0.78); i.add(speaker);
    }
    const header = boxMesh(2.3, 0.18, 0.3, this.mat.interiorSoft);
    header.position.set(0, 3.38, 2.6); i.add(header);
    const roofLiner = boxMesh(2.25, 0.05, 2.3, this.mat.interiorSoft);
    roofLiner.position.set(0, 3.44, 1.45); i.add(roofLiner);
    // sun visors
    for (const side of [-1, 1]) {
      const visor = boxMesh(0.78, 0.025, 0.22, this.mat.interiorSoft);
      visor.position.set(side * 0.55, 3.3, 2.68); visor.rotation.x = -0.2; i.add(visor);
    }
    // windshield frame / glass
    const frameMat = this.mat.black;
    const fBot = boxMesh(2.2, 0.07, 0.06, frameMat); fBot.position.set(0, 2.08, 2.86); i.add(fBot);
    const fTop = boxMesh(2.2, 0.07, 0.06, frameMat); fTop.position.set(0, 3.34, 2.86); i.add(fTop);
    const fLeft = boxMesh(0.07, 1.2, 0.06, frameMat); fLeft.position.set(-1.1, 2.72, 2.86); i.add(fLeft);
    const fRight = boxMesh(0.07, 1.2, 0.06, frameMat); fRight.position.set(1.1, 2.72, 2.86); i.add(fRight);
    const interiorGlass = new THREE.Mesh(new THREE.PlaneGeometry(2.18, 1.15), new THREE.MeshPhysicalMaterial({
      color: 0x0a151e, transparent: true, opacity: 0.06, roughness: 0.02, metalness: 0.3, envMapIntensity: 1.5,
      side: THREE.DoubleSide,
    }));
    interiorGlass.position.set(0, 2.72, 2.84);
    i.add(interiorGlass);
    const tintBand = new THREE.Mesh(new THREE.PlaneGeometry(2.18, 0.2), new THREE.MeshBasicMaterial({ color: 0x0a1a22, transparent: true, opacity: 0.55 }));
    tintBand.position.set(0, 3.2, 2.83); i.add(tintBand);
    // wipers
    this.wipers = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.55, 2.15, 2.9);
      const arm = boxMesh(0.035, 0.6, 0.025, this.mat.black);
      arm.position.y = 0.3;
      pivot.add(arm);
      const blade = boxMesh(0.03, 0.5, 0.02, this.mat.rubber);
      blade.position.set(0.02, 0.5, 0.015);
      pivot.add(blade);
      pivot.rotation.z = side * 1.45;
      i.add(pivot);
      this.wipers.push({ pivot, side });
    }
    // rear view mirror inside
    const rv = boxMesh(0.28, 0.1, 0.06, this.mat.black);
    rv.position.set(-0.3, 3.1, 2.75); i.add(rv);
    // cab interior lights
    const ambient = new THREE.PointLight(0xffd8a0, 0.55, 6, 2);
    ambient.position.set(0, 3.05, 1.5); i.add(ambient);
    const dashFill = new THREE.PointLight(0xcfe0ff, 0.28, 3.2, 2);
    dashFill.position.set(0.5, 2.15, 1.1); i.add(dashFill);
    // seatbelt buckle
    const buckle = boxMesh(0.04, 0.08, 0.03, this.mat.chrome);
    buckle.position.set(0.56, 1.47, 0.95); i.add(buckle);
    addShadow(this.cabExterior);
    addShadow(this.mirrors);
    this.interior.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
  }

  _buildLights() {
    this.headlights = [];
    for (const side of [-1, 1]) {
      const spot = new THREE.SpotLight(0xffe0a8, 0, 115, 0.52, 0.65, 1.35);
      spot.position.set(side * 0.83, 1.2, 2.95);
      spot.target.position.set(side * 0.4, 0.1, 50);
      spot.castShadow = false;
      this.group.add(spot, spot.target);
      this.headlights.push(spot);
    }
    this.lightMats = [this.mat.headlight, this.mat.taillight, this.mat.amber];
  }

  _buildGauges() {
    this._drawGauge();
    this._drawNavStatic();
  }

  _drawGauge() {
    const c = this.gaugeCanvas, g = c.getContext('2d');
    const w = c.width, h = c.height;
    g.fillStyle = '#0b0d0f'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 3;
    g.strokeRect(2, 2, w - 4, h - 4);
    const cx = w * 0.5, cy = h * 0.56, R = h * 0.4;
    // rpm arc
    g.lineWidth = 10;
    g.strokeStyle = '#1e252b';
    g.beginPath(); g.arc(cx, cy, R, Math.PI * 0.78, Math.PI * 2.22); g.stroke();
    const rpmFrac = clamp(this.rpm / 2200, 0, 1);
    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, '#e0a33b'); grad.addColorStop(0.75, '#e8a13a'); grad.addColorStop(1, '#d9533a');
    g.strokeStyle = grad;
    g.beginPath(); g.arc(cx, cy, R, Math.PI * 0.78, Math.PI * 0.78 + Math.PI * 1.44 * rpmFrac); g.stroke();
    // ticks
    for (let i = 0; i <= 16; i++) {
      const a = Math.PI * 0.78 + (i / 16) * Math.PI * 1.44;
      const r1 = R - 14, r2 = R - (i % 4 === 0 ? 26 : 20);
      g.strokeStyle = i > 12 ? '#d9533a' : 'rgba(235,235,225,0.7)';
      g.lineWidth = i % 4 === 0 ? 4 : 2;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); g.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); g.stroke();
    }
    // needle
    const na = Math.PI * 0.78 + Math.PI * 1.44 * clamp(this.rpm / 2200, 0, 1);
    g.strokeStyle = '#ffb14a'; g.lineWidth = 5; g.lineCap = 'round';
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(na) * (R - 10), cy + Math.sin(na) * (R - 10)); g.stroke();
    g.fillStyle = '#ffb14a'; g.beginPath(); g.arc(cx, cy, 8, 0, TAU); g.fill();
    // digital speed
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#f4f0e6';
    g.font = '700 78px "Barlow Condensed", Arial Narrow, sans-serif';
    g.fillText(String(Math.round(Math.abs(this.speed) * 3.6)), cx - 24, cy + 44);
    g.font = '600 25px "Inter", sans-serif'; g.fillStyle = 'rgba(240,236,226,0.55)';
    g.fillText('km/h', cx + 62, cy + 65);
    // gear box
    g.strokeStyle = 'rgba(255,255,255,0.15)'; g.lineWidth = 2;
    g.strokeRect(w - 92, 18, 66, 66);
    g.fillStyle = '#e8a13a';
    g.font = '700 47px "Barlow Condensed", sans-serif';
    g.fillText(this.reversing ? 'R' : String(this.gear), w - 59, 53);
    // fuel + damage bars
    g.textAlign = 'left'; g.font = '600 17px "Inter", sans-serif'; g.fillStyle = 'rgba(240,236,226,0.55)';
    g.fillText('FUEL', 22, h - 30);
    g.fillText('DAMAGE', 22, h - 12);
    g.fillStyle = 'rgba(255,255,255,0.13)'; g.fillRect(92, h - 37, 148, 8); g.fillRect(92, h - 19, 148, 8);
    g.fillStyle = this.fuel < 20 ? '#d9533a' : '#7fbf7a'; g.fillRect(92, h - 37, 148 * clamp(this.fuel / 100, 0, 1), 8);
    g.fillStyle = this.damage > 65 ? '#d9533a' : '#d9a43a'; g.fillRect(92, h - 19, 148 * clamp(this.damage / 100, 0, 1), 8);
    this.gaugeTexture.needsUpdate = true;
  }

  _drawNavStatic() {
    const c = this.navCanvas, g = c.getContext('2d');
    g.fillStyle = '#0a1218'; g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = 'rgba(95,160,175,0.25)'; g.lineWidth = 2;
    for (let i = 0; i < 8; i++) { g.beginPath(); g.moveTo((i / 8) * c.width, 0); g.lineTo((i / 8) * c.width, c.height); g.stroke(); }
    g.fillStyle = '#d9a43a'; g.font = '600 20px "Inter", sans-serif';
    g.fillText('HAULWAY NAV', 18, 28);
    this.navTexture.needsUpdate = true;
  }

  setNav(world, destination, distance, clock) {
    if (!world || !destination) {
      const c = this.navCanvas, g = c.getContext('2d');
      g.fillStyle = '#0a1218'; g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = 'rgba(220,220,210,0.45)'; g.font = '600 24px "Inter", sans-serif';
      g.fillText('NO ACTIVE CONTRACT', 18, 128);
      this.navTexture.needsUpdate = true;
      return;
    }
    const c = this.navCanvas, g = c.getContext('2d');
    const w = c.width, h = c.height;
    g.fillStyle = '#0a1218'; g.fillRect(0, 0, w, h);
    g.save();
    g.translate(w * 0.52, h * 0.56);
    const scale = 0.075;
    // ring
    g.strokeStyle = 'rgba(95,160,175,0.5)'; g.lineWidth = 7;
    g.beginPath();
    world.ringPoints.forEach((p, i) => {
      const x = p.x * scale, y = p.z * scale;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    });
    g.closePath(); g.stroke();
    // access roads
    g.strokeStyle = 'rgba(95,160,175,0.3)'; g.lineWidth = 3;
    for (const d of world.depots) {
      g.beginPath(); g.moveTo(d.start.x * scale, d.start.z * scale); g.lineTo(d.center.x * scale, d.center.z * scale); g.stroke();
    }
    // destination
    const dx = destination.x * scale, dy = destination.z * scale;
    g.fillStyle = '#e8a13a';
    g.beginPath(); g.arc(dx, dy, 10 + Math.sin(performance.now() * 0.006) * 2, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(232,161,58,0.6)'; g.lineWidth = 3;
    g.beginPath(); g.arc(dx, dy, 18 + Math.sin(performance.now() * 0.005) * 3, 0, TAU); g.stroke();
    // player
    const px = world._playerX * scale, py = world._playerZ * scale;
    g.save(); g.translate(px, py); g.rotate(-this.heading);
    g.fillStyle = '#f4f0e6';
    g.beginPath(); g.moveTo(0, -13); g.lineTo(8, 9); g.lineTo(0, 5); g.lineTo(-8, 9); g.closePath(); g.fill();
    g.restore();
    g.restore();
    g.fillStyle = 'rgba(240,236,226,0.55)'; g.font = '600 18px "Inter", sans-serif';
    g.fillText((distance / 1000).toFixed(1) + ' km', 18, h - 18);
    g.textAlign = 'right'; g.fillStyle = '#e8a13a'; g.font = '700 22px "Barlow Condensed", sans-serif';
    g.fillText('ETA ' + clock, w - 18, h - 18);
    g.textAlign = 'left';
    this.navTexture.needsUpdate = true;
  }

  setPaint(hex) {
    this.paintColor = hex;
    this.mat.paint.color.set(hex);
    this.mat.paint.needsUpdate = true;
  }

  setExteriorVisible(v) { this.cabExterior.visible = v; }
  setInteriorVisible(v) { this.interior.visible = v; }

  showExterior(v) {
    this.setExteriorVisible(v);
    this.setInteriorVisible(!v);
  }

  resetTo(pos, heading) {
    this.group.position.set(pos.x, 0.02, pos.z);
    this.group.rotation.y = 0;
    this.heading = heading;
    this.trailerHeading = heading;
    this.speed = 0;
    this.steer = 0;
    this.reversing = false;
    this.reverseTimer = 0;
    this.updateTransform(0);
  }

  attachTrailer(job) {
    if (this.trailer) {
      this.scene.remove(this.trailer.group);
      this.trailer.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => { m.dispose(); });
        }
      });
      this.trailer = null;
    }
    this.trailer = new Trailer(this.scene, job);
    this.trailerHeading = this.heading;
    this.updateTransform(0);
  }

  getSpeedKmh() { return Math.abs(this.speed) * 3.6; }
  getRangeKm() { return (this.fuel / 100) * this.fuelCapacity / 32 * 100 / 100; }

  update(dt, input, world, quality = 'high') {
    dt = Math.min(dt, 0.05);
    const throttle = clamp(input.throttle, 0, 1);
    const brake = clamp(input.brake, 0, 1);
    const steerInput = clamp(input.steer, -1, 1);
    const zone = world.zoneAt(this.group.position.x, this.group.position.z);
    const onRoad = zone.zone !== 'offroad';
    const wet = world.weather.type === 'rain';
    const maxGrip = onRoad ? 1 : 0.55;

    // reverse handling
    if (Math.abs(this.speed) < 0.35 && brake > 0.45 && !this.reversing) {
      this.reverseTimer += dt;
      if (this.reverseTimer > 0.55) { this.reversing = true; this.reverseTimer = 0; }
    } else if (brake < 0.1 || throttle > 0.2 || this.speed > 1.0) {
      this.reverseTimer = 0;
      if (throttle > 0.2 && this.reversing && this.speed > -0.3) this.reversing = false;
    }

    let accel = 0;
    const powers = { 1: 1, 2: 1.0, 3: 1.0 };
    const power = 365000 * (this.damage > 65 ? 0.6 : 1);
    if (this.engineOn && this.fuel > 0) {
      if (this.reversing) {
        accel -= brake * 1.25;
      } else {
        const gov = clamp((92 - this.getSpeedKmh()) / 8, 0, 1);
        const traction = onRoad ? 1 : 0.55;
        const force = Math.min(65000, power / Math.max(4, Math.abs(this.speed))) * throttle * gov * traction;
        accel += force / TRUCK_MASS;
      }
    }
    // resistance
    const drag = 3.6 * this.speed * Math.abs(this.speed);
    const roll = (onRoad ? 3300 : 8800) * Math.sign(this.speed || 1);
    accel -= drag / TRUCK_MASS;
    if (Math.abs(this.speed) > 0.01) accel -= roll / TRUCK_MASS;
    if (!onRoad && Math.abs(this.speed) > 15) accel -= 1.8;
    // brakes
    if (brake > 0 && !this.reversing) {
      const brakeForce = brake * (wet ? 65000 : 82000);
      accel -= Math.sign(this.speed || 1) * brakeForce / TRUCK_MASS;
    }
    if (input.handbrake) {
      accel -= Math.sign(this.speed || 1) * 4.5;
    }
    this.speed += accel * dt;
    if (Math.abs(this.speed) < 0.08 && brake > 0.1) this.speed = 0;
    if (!this.engineOn) this.speed = damp(this.speed, 0, 0.7, dt);
    if (this.fuel <= 0) {
      this.speed = damp(this.speed, 0, 0.6, dt);
      this.engineOn = false;
    }
    // top speed limit
    if (this.speed > 25.6) this.speed = damp(this.speed, 25.6, 8, dt);
    if (this.reversing && this.speed < -5.2) this.speed = -5.2;

    // steering
    const speedKm = Math.abs(this.speed) * 3.6;
    const maxSteer = lerp(0.6, 0.075, clamp(speedKm / 70, 0, 1));
    const steerTarget = steerInput * maxSteer;
    this.steer = damp(this.steer, steerTarget, 7, dt);
    const wheelbase = 3.75;
    if (Math.abs(this.speed) > 0.01) {
      const yawRate = (this.speed / wheelbase) * Math.tan(this.steer) * (wet ? 0.9 : 1);
      this.heading += yawRate * dt;
      this.heading = wrapAngle(this.heading);
    }
    // visual lean
    const targetRoll = -this.steer * clamp(this.speed / 18, 0, 1) * 0.09;
    this.body.rotation.z = damp(this.body.rotation.z, targetRoll, 5, dt);
    this.body.rotation.x = damp(this.body.rotation.x, -accel * 0.008, 4, dt);

    // integrate
    const fwd = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    this.group.position.addScaledVector(fwd, this.speed * dt);
    this.group.position.y = world.groundHeight(this.group.position.x, this.group.position.z) + 0.02;
    this.group.rotation.y = this.heading;

    // collisions with static buildings
    for (const c of world.colliders) {
      const dx = this.group.position.x - c.x, dz = this.group.position.z - c.z;
      const d = Math.hypot(dx, dz);
      if (d < c.r + 2.2) {
        const push = (c.r + 2.2 - d);
        this.group.position.x += (dx / Math.max(d, 0.01)) * push;
        this.group.position.z += (dz / Math.max(d, 0.01)) * push;
        if (Math.abs(this.speed) > 2) this.applyImpact(Math.min(14, Math.abs(this.speed) * 1.1));
        this.speed *= -0.12;
      }
    }
    // lake safety
    const waterLevel = -2.4;
    if (this.group.position.y < waterLevel && world.groundHeight(this.group.position.x, this.group.position.z) < -2.4) {
      this.speed *= 0.94;
      this.inWater = true;
    } else this.inWater = false;

    // wheels
    this.wheelSpin += (this.speed / WHEEL_R) * dt;
    for (const w of this.wheels) {
      w.spin.rotation.x = this.wheelSpin;
      if (w.steerable) w.pivot.rotation.y = this.steer * 0.95;
    }
    this.steeringWheel.rotation.z = -this.steer * 4.6;
    // trailer
    if (this.trailer) {
      const hitch = new THREE.Vector3(Math.sin(this.heading) * -2.15, 0, Math.cos(this.heading) * -2.15).add(this.group.position);
      const diff = wrapAngle(this.heading - this.trailerHeading);
      const clamped = clamp(diff, -1.15, 1.15);
      this.trailerHeading = wrapAngle(this.trailerHeading + (this.speed / 10.6) * Math.sin(clamped) * dt);
      this.trailer.group.position.set(hitch.x, this.group.position.y, hitch.z);
      this.trailer.group.rotation.y = this.trailerHeading;
      this.trailer.update(dt, this.wheelSpin);
    }
    // body bob
    const rumble = zone.zone === 'offroad' ? Math.sin(performance.now() * 0.03) * 0.03 * clamp(this.speed / 8, 0, 1) : 0;
    this.bob = Math.sin(performance.now() * 0.012) * 0.003 * clamp(this.speed / 10, 0, 1) + rumble;
    this.body.position.y = this.bob;
    // engine
    const kmh = Math.abs(this.speed) * 3.6;
    let gear = 1;
    const thresholds = [0, 11, 21, 33, 45, 58, 72, 84];
    for (let i = 0; i < thresholds.length; i++) if (kmh >= thresholds[i]) gear = i + 1;
    this.gear = this.reversing ? 'R' : gear;
    const gearMax = thresholds[Math.min(7, gear)] + 12;
    const targetRpm = this.engineOn
      ? (this.reversing ? 700 + Math.abs(this.speed) * 70 : 620 + clamp(kmh / Math.max(12, gearMax), 0, 1.05) * 1250 + throttle * 180)
      : 0;
    this.rpm = damp(this.rpm, targetRpm, 4.2, dt);
    this.fuel = clamp(this.fuel - (0.22 + kmh * 0.007 + throttle * 0.24) * dt * 0.16, 0, 100);
    this.odometer += Math.abs(this.speed) * dt;
    this.temp = damp(this.temp, 82 + clamp(Math.abs(this.speed) / 20, 0, 1) * 12, 0.4, dt);
    if (this.speed < 0.5 && brake > 0) this.fuel = clamp(this.fuel - 0.01 * dt, 0, 100);
    // wipers
    if (world.weather.type === 'rain') {
      const phase = (performance.now() * 0.0022) % 1;
      const sweep = Math.sin(phase * TAU) * 0.55;
      for (const w of this.wipers) w.pivot.rotation.z = w.side * 1.45 + sweep * w.side * 0.32;
    }
    // headlights
    const wantLights = this.lightsOn;
    for (const h of this.headlights) h.intensity = wantLights ? 720 : 0;
    for (const m of this.lightMats) m.emissiveIntensity = wantLights ? (m === this.mat.taillight ? 1.4 : 2.2) : 0.25;
    // gauges
    this._gaugeTimer += dt;
    if (this._gaugeTimer > 0.1) { this._gaugeTimer = 0; this._drawGauge(); }
    world._playerX = this.group.position.x;
    world._playerZ = this.group.position.z;
  }

  applyImpact(amount) {
    this.damage = clamp(this.damage + amount, 0, 100);
    this.speed *= 0.55;
    this.bobVel += 0.6;
  }

  updateTransform() {
    this.group.rotation.y = this.heading;
    if (this.trailer) {
      const hitch = new THREE.Vector3(Math.sin(this.heading) * -2.15, 0, Math.cos(this.heading) * -2.15).add(this.group.position);
      this.trailer.group.position.set(hitch.x, this.group.position.y, hitch.z);
      this.trailer.group.rotation.y = this.trailerHeading;
    }
  }

  _cameraBaseFov(mode) {
    return mode === 'cockpit' ? 68 : mode === 'hood' ? 76 : 62;
  }

  updateCamera(camera, mode, dt, lookInput) {
    const cockpit = mode === 'cockpit';
    this.setExteriorVisible(!cockpit);
    this.setInteriorVisible(cockpit);
    const fwd = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const pos = this.group.position;
    camera.rotation.order = 'YXZ';
    if (cockpit) {
      this.cameraYaw = damp(this.cameraYaw, clamp(lookInput?.yaw || 0, -1.35, 1.35), 8, dt);
      this.cameraPitch = damp(this.cameraPitch, clamp(lookInput?.pitch || 0, -0.5, 0.42), 8, dt);
      const bob = this.bob + Math.sin(performance.now() * 0.02) * Math.abs(this.speed) * 0.00018;
      camera.position.set(
        pos.x + fwd.x * 0.62 - right.x * 0.54,
        pos.y + 2.56 + bob,
        pos.z + fwd.z * 0.62 - right.z * 0.54
      );
      camera.rotation.set(-0.04 + this.cameraPitch, this.heading + Math.PI + this.cameraYaw, this.body.rotation.z * 0.35);
      camera.fov = damp(camera.fov, this._cameraBaseFov(mode), 4, dt);
      camera.updateProjectionMatrix();
      this._cockpitPos.copy(camera.position);
      camera.updateMatrixWorld();
    } else if (mode === 'hood') {
      this.cameraYaw = damp(this.cameraYaw, clamp(lookInput?.yaw || 0, -1.1, 1.1), 8, dt);
      camera.position.set(
        pos.x + fwd.x * 3.15,
        pos.y + 1.35 + this.bob,
        pos.z + fwd.z * 3.15
      );
      camera.rotation.set(-0.04 + (lookInput?.pitch || 0) * 0.4, this.heading + Math.PI + this.cameraYaw, 0);
      camera.fov = damp(camera.fov, 78, 4, dt);
      camera.updateProjectionMatrix();
    } else {
      const orbit = this.cameraYaw;
      const dist = 18.5 + clamp(Math.abs(this.speed) * 0.1, 0, 2.5);
      const desired = new THREE.Vector3(
        pos.x - fwd.x * dist * Math.cos(orbit) + right.x * (Math.sin(orbit) * dist + 4.0),
        pos.y + 7.0,
        pos.z - fwd.z * dist * Math.cos(orbit) + right.z * (Math.sin(orbit) * dist + 4.0)
      );
      if (this.lastCamMode !== 'chase') {
        this.cameraPos.copy(desired);
        this.lastCamMode = 'chase';
      }
      this.cameraPos.x = damp(this.cameraPos.x, desired.x, 4.2, dt);
      this.cameraPos.y = damp(this.cameraPos.y, desired.y, 4.2, dt);
      this.cameraPos.z = damp(this.cameraPos.z, desired.z, 4.2, dt);
      camera.position.copy(this.cameraPos);
      this.cameraLook.lerp(this._tmp.set(pos.x + fwd.x * 5.0, pos.y + 2.5, pos.z + fwd.z * 5.0), 1 - Math.exp(-5 * dt));
      camera.lookAt(this.cameraLook);
      camera.fov = damp(camera.fov, 62 + clamp(Math.abs(this.speed) * 0.1, 0, 2), 3, dt);
      camera.updateProjectionMatrix();
    }
    if (!cockpit) this.lastCamMode = mode;
    else if (this.lastCamMode !== 'cockpit') {
      this.cameraYaw = 0; this.cameraPitch = 0; this.lastCamMode = 'cockpit';
    }
    if (!cockpit) camera.rotation.z = this.body.rotation.z * 0.22;
  }
}

// ---------------------------------------------------------------------------
export class Trailer {
  constructor(scene, job = {}) {
    this.scene = scene;
    this.job = job;
    this.style = job.trailerStyle || 'box';
    this.group = new THREE.Group();
    scene.add(this.group);
    this.wheelSpin = 0;
    this._build();
  }

  _build() {
    const g = this.group;
    const dark = new THREE.MeshStandardMaterial({ color: 0x20252a, roughness: 0.6, metalness: 0.5 });
    const black = new THREE.MeshStandardMaterial({ color: 0x0d0f11, roughness: 0.9 });
    const chrome = new THREE.MeshStandardMaterial({ color: 0xbfc7cb, roughness: 0.2, metalness: 1 });
    const baseColor = this.job.trailerColor || '#dedbd1';
    const bodyMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.58, metalness: 0.08 });
    const sideTex = makeTrailerSideTexture({
      brand: this.job.brand || 'HAULWAY',
      color: baseColor,
      kind: this.style === 'container' ? 'container' : this.style === 'curtain' ? 'curtain' : 'box',
    });
    const sideMat = new THREE.MeshStandardMaterial({ map: sideTex, roughness: 0.58, metalness: 0.06 });
    // chassis
    for (const x of [-0.55, 0.55]) {
      const rail = boxMesh(0.16, 0.25, 13.0, dark);
      rail.position.set(x, 0.88, -6.9);
      g.add(rail);
    }
    for (const z of [-1.4, -4.4, -7.4, -10.4, -13.2]) {
      const cm = boxMesh(1.2, 0.16, 0.16, dark);
      cm.position.set(0, 0.85, z);
      g.add(cm);
    }
    // landing gear
    for (const x of [-0.72, 0.72]) {
      const leg = boxMesh(0.13, 1.0, 0.13, chrome);
      leg.position.set(x, 0.5, -2.05);
      g.add(leg);
      const foot = boxMesh(0.35, 0.09, 0.5, dark);
      foot.position.set(x, 0.05, -2.05);
      g.add(foot);
      const crank = boxMesh(0.13, 0.1, 0.1, chrome);
      crank.position.set(x + 0.12, 0.9, -2.1);
      g.add(crank);
    }
    // kingpin plate
    const plate = boxMesh(1.3, 0.14, 1.1, dark);
    plate.position.set(0, 0.92, -0.55);
    g.add(plate);
    if (this.style === 'flatbed') {
      const deck = boxMesh(2.5, 0.22, 13.1, new THREE.MeshStandardMaterial({ color: 0x6b5a44, roughness: 0.9 }));
      deck.position.set(0, 1.06, -6.8);
      g.add(deck);
      const logMat = new THREE.MeshStandardMaterial({ color: 0x7a5a36, roughness: 0.95 });
      for (let row = 0; row < 3; row++) {
        for (let i = 0; i < 3 - row; i++) {
          const log = cylinderMesh(0.22, 0.25, 11.5, logMat, 10);
          log.rotation.x = Math.PI / 2;
          log.position.set((i - (2 - row) / 2) * 0.48, 1.42 + row * 0.42, -6.8);
          log.rotation.z = (Math.random() - 0.5) * 0.02;
          g.add(log);
        }
      }
      for (const z of [-3.0, -7.2, -11.0]) {
        const strap = boxMesh(2.62, 0.035, 0.08, black);
        strap.position.set(0, 2.05, z);
        g.add(strap);
      }
    } else if (this.style === 'tanker') {
      const tank = cylinderMesh(1.25, 1.25, 11.6, new THREE.MeshStandardMaterial({
        color: 0xc7ccce, roughness: 0.25, metalness: 0.85, envMapIntensity: 1.4,
      }), 32);
      tank.rotation.x = Math.PI / 2;
      tank.position.set(0, 2.48, -6.9);
      g.add(tank);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(1.25, 24, 12, 0, TAU, 0, Math.PI / 2), tank.material);
      cap.rotation.x = Math.PI / 2; cap.position.set(0, 2.48, -12.7); g.add(cap);
      const cap2 = new THREE.Mesh(new THREE.SphereGeometry(1.25, 24, 12, 0, TAU, 0, Math.PI / 2), tank.material);
      cap2.rotation.x = -Math.PI / 2; cap2.position.set(0, 2.48, -1.1); g.add(cap2);
      const stripe = boxMesh(0.02, 0.3, 10.6, new THREE.MeshStandardMaterial({ color: 0xd97a2b, roughness: 0.6 }));
      stripe.position.set(1.24, 2.48, -6.9);
      g.add(stripe);
      const walk = boxMesh(0.65, 0.05, 10.6, dark);
      walk.position.set(0, 3.8, -6.8); g.add(walk);
      const ladder = boxMesh(0.05, 1.4, 0.4, chrome);
      ladder.position.set(0.5, 3.1, -12.2); g.add(ladder);
      for (const x of [-1.25, 1.25]) {
        const frame = boxMesh(0.1, 0.16, 11.4, dark);
        frame.position.set(x, 1.15, -6.9); g.add(frame);
      }
    } else {
      // box / curtain
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.55, 2.68, 13.15), [
        sideMat, sideMat, bodyMat, bodyMat, bodyMat, bodyMat,
      ]);
      body.position.set(0, 2.48, -6.9);
      body.castShadow = true; body.receiveShadow = true;
      g.add(body);
      // side branding panels to keep text readable on both sides
      for (const side of [-1, 1]) {
        const panel = new THREE.Mesh(new THREE.PlaneGeometry(12.85, 2.3), sideMat);
        panel.rotation.y = side * Math.PI / 2;
        panel.position.set(side * 1.277, 2.58, -6.9);
        g.add(panel);
        // top and bottom rails
        const topRail = boxMesh(0.05, 0.12, 12.9, dark);
        topRail.position.set(side * 1.29, 3.8, -6.9); g.add(topRail);
        const botRail = boxMesh(0.05, 0.12, 12.9, dark);
        botRail.position.set(side * 1.29, 1.2, -6.9); g.add(botRail);
        // side skirt
        const skirt = boxMesh(0.1, 0.5, 9.3, new THREE.MeshStandardMaterial({ color: 0xc7c4bb, roughness: 0.7 }));
        skirt.position.set(side * 1.22, 0.72, -8.3); g.add(skirt);
        // reflective strip
        const strip = boxMesh(0.02, 0.07, 11.4, new THREE.MeshBasicMaterial({ color: 0xe3a33a }));
        strip.position.set(side * 1.288, 1.28, -6.9); g.add(strip);
      }
      // roof
      const roof = boxMesh(2.6, 0.07, 13.2, new THREE.MeshStandardMaterial({ color: 0xbdbab0, roughness: 0.8 }));
      roof.position.set(0, 3.82, -6.9); g.add(roof);
      // rear doors
      const rear = boxMesh(2.56, 2.66, 0.1, bodyMat);
      rear.position.set(0, 2.48, -13.49); g.add(rear);
      for (const side of [-1, 1]) {
        const door = boxMesh(1.22, 2.6, 0.03, new THREE.MeshStandardMaterial({ color: 0xcbc8bf, roughness: 0.65 }));
        door.position.set(side * 0.64, 2.48, -13.56); g.add(door);
        for (const xx of [-0.35, 0.35]) {
          const rod = cylinderMesh(0.022, 0.022, 2.4, chrome, 8);
          rod.position.set(side * 0.64 + xx, 2.48, -13.6); g.add(rod);
        }
        const hinge = boxMesh(0.08, 0.28, 0.05, dark);
        hinge.position.set(side * 1.37, 2.9, -13.58); g.add(hinge);
        const hinge2 = boxMesh(0.08, 0.28, 0.05, dark);
        hinge2.position.set(side * 1.37, 2.0, -13.58); g.add(hinge2);
      }
      // rear bumper / lights
      const bar = boxMesh(2.45, 0.15, 0.16, dark);
      bar.position.set(0, 0.7, -13.55); g.add(bar);
      for (const side of [-1, 1]) {
        const lamp = boxMesh(0.19, 0.22, 0.05, new THREE.MeshBasicMaterial({ color: 0x9f1d14 }));
        lamp.position.set(side * 1.0, 1.0, -13.6); g.add(lamp);
        const orange = boxMesh(0.19, 0.08, 0.05, new THREE.MeshBasicMaterial({ color: 0xd9861e }));
        orange.position.set(side * 1.0, 0.87, -13.6); g.add(orange);
      }
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.22), new THREE.MeshStandardMaterial({ color: 0xe6e2d5, roughness: 0.5 }));
      plate.position.set(0.4, 0.7, -13.65); g.add(plate);
      // underride bars
      for (const side of [-1, 1]) {
        const bar2 = boxMesh(0.09, 0.09, 0.9, new THREE.MeshStandardMaterial({ color: 0xb3362a, roughness: 0.6 }));
        bar2.position.set(side * 0.55, 0.38, -13.15); g.add(bar2);
      }
    }
    // trailer wheels
    this.wheels = [];
    for (const z of [-10.7, -11.85]) {
      for (const x of [-1.08, 1.08]) {
        const pivot = new THREE.Group();
        pivot.position.set(x, 0.53, z);
        const spin = new THREE.Group();
        pivot.add(spin);
        const tire = cylinderMesh(0.53, 0.53, 0.52, black, 22);
        tire.rotation.z = Math.PI / 2; spin.add(tire);
        const hub = cylinderMesh(0.3, 0.3, 0.55, chrome, 16);
        hub.rotation.z = Math.PI / 2; spin.add(hub);
        const cap = cylinderMesh(0.12, 0.12, 0.6, chrome, 12);
        cap.rotation.z = Math.PI / 2; spin.add(cap);
        g.add(pivot);
        this.wheels.push(spin);
      }
    }
    // fenders
    for (const x of [-1.12, 1.12]) {
      const fender = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.68, 0.8, 14, 1, true, Math.PI * 0.1, Math.PI * 0.8), dark);
      fender.rotation.z = Math.PI / 2;
      fender.position.set(x, 0.63, -11.25);
      fender.material.side = THREE.DoubleSide;
      g.add(fender);
    }
    // brake glow? no
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    for (const wheel of this.wheels) {
      wheel.userData.noMerge = true;
      mergeStaticMeshes(wheel);
    }
    mergeStaticMeshes(g);
  }

  update(dt, wheelSpin) {
    this.wheelSpin = wheelSpin;
    for (const w of this.wheels) w.rotation.x = wheelSpin;
  }
}
