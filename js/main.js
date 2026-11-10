import * as THREE from 'three';
import { EffectComposer } from '../vendor/addons/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/addons/postprocessing/OutputPass.js';
import { World } from './world.js';
import { Truck } from './truck.js';
import { Traffic } from './traffic.js';
import { HUD } from './hud.js';
import { GameAudio } from './audio.js';
import {
  clamp, lerp, damp, wrapAngle, formatMoney, formatDistance, formatTime,
  mulberry32, TAU,
} from './utils.js';

const SAVE_KEY = 'eurohaul.career.v1';
const SETTINGS_KEY = 'eurohaul.settings.v1';
const DISPLAY_SCALE = 6;

const CARGO_TYPES = [
  { cargo: 'Fresh Produce', tag: 'CHILL', weight: 18.4, style: 'box', brand: 'NORDVIK', color: '#e4e0d5', trailer: 'REFRIGERATED', desc: 'Palletised fresh produce. Keep it rolling — the dock closes on time.' },
  { cargo: 'Automotive Parts', tag: 'JIT', weight: 22.1, style: 'curtain', brand: 'REDLINE', color: '#d7d4ca', trailer: 'CURTAINSIDE', desc: 'Just-in-time parts for the assembly line. Every minute counts.' },
  { cargo: 'Bulk Chemicals', tag: 'ADR', weight: 24.0, style: 'tanker', brand: 'SEAWAY', color: '#c7ccce', trailer: 'TANKER', desc: 'Sealed chemical tanker. Smooth inputs, no sudden stops.' },
  { cargo: 'Timber', tag: 'HEAVY', weight: 26.8, style: 'flatbed', brand: 'HAULWAY', color: '#6b5a44', trailer: 'FLATBED', desc: 'Kiln-dried timber, loaded and strapped. Watch the crosswinds.' },
  { cargo: 'Consumer Goods', tag: 'RETAIL', weight: 16.2, style: 'container', brand: 'SEAWAY', color: '#3f6e86', trailer: 'CONTAINER', desc: 'Retail stock for the coast. The store opens at nine sharp.' },
  { cargo: 'Machine Tools', tag: 'HEAVY', weight: 27.5, style: 'flatbed', brand: 'REDLINE', color: '#8a6a45', trailer: 'FLATBED', desc: 'Precision machinery on a flatbed. Heavy, tall and unforgiving.' },
  { cargo: 'Dairy & Cheese', tag: 'CHILL', weight: 15.8, style: 'box', brand: 'NORDVIK', color: '#e8e4d9', trailer: 'REFRIGERATED', desc: 'Temperature-controlled dairy run. Keep the wheels turning.' },
  { cargo: 'Building Supplies', tag: 'BULK', weight: 25.3, style: 'container', brand: 'REDLINE', color: '#9a4b3c', trailer: 'CONTAINER', desc: 'Cement and steel for the northern yard. Heavy on the axles.' },
];

const CAMERA_NAMES = { cockpit: 'COCKPIT', chase: 'CHASE', hood: 'BUMPER' };

function defaultCareer() {
  return {
    money: 14250, xp: 1860, level: 3, deliveries: 0, distance: 0, onTime: 0,
    fuel: 78, damage: 2.5, odometerKm: 14203, paint: '#c75d2d',
    tutorialDone: false, totalEarned: 0,
  };
}
function defaultSettings() {
  return { quality: 'high', volume: 0.75, weather: 'clear', shake: true };
}
function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) };
  } catch { return fallback; }
}
function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}
function levelForXp(xp) { return Math.max(1, Math.floor(Math.sqrt(xp / 200))); }
function levelProgress(xp) {
  const level = levelForXp(xp);
  const lo = 200 * (level - 1) * (level - 1);
  const hi = 200 * level * level;
  return { level, progress: clamp((xp - lo) / Math.max(1, hi - lo), 0, 1), lo, hi };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

class Game {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.05, 6000);
    this.camera.rotation.order = 'YXZ';
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.02;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    document.getElementById('scene').appendChild(this.renderer.domElement);

    const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, {
      type: THREE.HalfFloatType, samples: 4,
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.42, 0.7, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.audio = new GameAudio();
    this.career = loadJSON(SAVE_KEY, defaultCareer());
    this.settings = loadJSON(SETTINGS_KEY, defaultSettings());
    this.state = 'loading';
    this.cameraMode = 'cockpit';
    this.look = { yaw: 0, pitch: 0 };
    this.dragging = false;
    this.lastMouse = { x: 0, y: 0 };
    this.keys = Object.create(null);
    this.touch = { throttle: 0, brake: 0, steer: 0, horn: false };
    this.game = {
      state: 'menu', career: this.career, settings: this.settings, jobs: [], job: null,
      jobIndex: 0, nav: null, distanceScale: DISPLAY_SCALE, target: null, eta: 8,
      time: 8.2, limit: 90, speeding: false, prompt: '', weather: this.settings.weather,
      truckFuel: this.career.fuel, tutorial: false,
    };
    this.selectedJob = 0;
    this.elapsed = 0;
    this.deliveryHold = 0;
    this.speedingTime = 0;
    this.fineTimer = 0;
    this.collisionCooldown = 0;
    this.lastCam = 'cockpit';
    this.menuTime = 8.2;
    this.attractAngle = 2.2;
    this.globalToasts = document.createElement('div');
    this.globalToasts.className = 'global-toasts';
    document.body.appendChild(this.globalToasts);
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._lastTruckGear = null;
    this._initialized = false;
  }

  async boot() {
    this.setLoad(12, 'Surveying the northern ring…');
    await wait(30);
    this.world = new World(this.scene, this.renderer);
    this.setLoad(48, 'Building depots and freight yards…');
    await wait(30);
    this.truck = new Truck(this.scene);
    this.setLoad(66, 'Waking the night traffic…');
    await wait(30);
    this.traffic = new Traffic(this.scene, this.world, this.settings.quality);
    this.hud = new HUD(this.world, this.truck);
    this.setLoad(82, 'Calibrating the instrument cluster…');
    await wait(30);
    this.bindUI();
    this.applyCareerToTruck();
    this.setQuality(this.settings.quality || 'high', true);
    this.audio.setVolume(this.settings.volume);
    this.truck.cameraShake = this.settings.shake !== false;
    this.game.jobs = this.generateJobs();
    this.positionForMenu();
    this.setLoad(96, 'Loading dispatch board…');
    await wait(120);
    await document.fonts.ready;
    this.setLoad(100, 'Ready.');
    await wait(280);
    document.getElementById('loading').classList.add('done');
    this.showMenu();
    this._initialized = true;
    this.hud.resizeCanvases();
    this.resize();
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
    window.setTimeout(() => {
      if (this.career.tutorialDone === false) this.toast('Tip: press C to change camera · H for the air horn', '', 5200);
    }, 4000);
  }

  setLoad(p, text) {
    const bar = document.getElementById('load-bar');
    const t = document.getElementById('load-text');
    if (bar) bar.style.width = p + '%';
    if (t) t.textContent = text;
  }

  applyCareerToTruck() {
    const c = this.career;
    c.level = levelForXp(c.xp);
    this.truck.fuel = clamp(c.fuel, 0, 100);
    this.truck.damage = clamp(c.damage, 0, 100);
    this.truck.odometer = (c.odometerKm || 14203) * 1000;
    if (c.paint) this.truck.setPaint(c.paint);
  }

  syncCareerFromTruck() {
    this.career.fuel = this.truck.fuel;
    this.career.damage = this.truck.damage;
    this.career.odometerKm = this.truck.odometer / 1000;
    this.career.level = levelForXp(this.career.xp);
  }

  save() {
    this.syncCareerFromTruck();
    saveJSON(SAVE_KEY, this.career);
    saveJSON(SETTINGS_KEY, this.settings);
  }

  positionForMenu() {
    const d = this.world.depots[0];
    const pos = new THREE.Vector3(
      d.center.x - d.outward.x * 16,
      0,
      d.center.z - d.outward.z * 16
    );
    this.truck.resetTo(pos, d.yaw + 0.18);
    this.truck.showExterior(true);
    this.truck.lightsOn = true;
    this.truck.engineOn = true;
    this.truck.speed = 0;
    this.truck.attachTrailer({
      brand: 'HAULWAY', trailerStyle: 'box', trailerColor: '#dedbd1', cargo: 'General Freight',
    });
    this.world.setDestination(null);
    this.world.setTime(this.menuTime);
    this.world.setWeather('clear');
    this.truck.setNav(null, null, 0, '');
  }

  // ------------------------------------------------------------- jobs
  generateJobs() {
    const seed = 731 + (this.career.deliveries || 0) * 53 + (this.career.level || 1) * 11;
    const rand = mulberry32(seed);
    const depots = this.world.depots;
    const jobs = [];
    for (let i = 0; i < 4; i++) {
      const fromIdx = Math.floor(rand() * depots.length);
      let toIdx = Math.floor(rand() * depots.length);
      if (toIdx === fromIdx) toIdx = (toIdx + 1 + Math.floor(rand() * 3)) % depots.length;
      const from = depots[fromIdx], to = depots[toIdx];
      const cargo = CARGO_TYPES[Math.floor(rand() * CARGO_TYPES.length)];
      const a = this.world.nearestOnRing(from.center.x, from.center.z).s;
      const b = this.world.nearestOnRing(to.center.x, to.center.z).s;
      const total = this.world.ringLength;
      let arc = Math.abs(b - a);
      if (arc > total / 2) arc = total - arc;
      const actualDistance = arc + 320 + rand() * 180;
      const displayKm = (actualDistance * DISPLAY_SCALE) / 1000;
      const startTime = 7.4 + i * 0.18;
      const travelHours = actualDistance / 22.2 / 60;
      const deadline = startTime + travelHours * 1.9 + 1.1;
      const rating = 4.2 + rand() * 0.8;
      const urgency = rand() < 0.3 ? 1.18 : 1;
      const pay = Math.round(((620 + displayKm * 41 + cargo.weight * 19) * urgency) / 10) * 10;
      jobs.push({
        id: `HWL-${2800 + Math.floor(rand() * 900)}`, from, to, fromIdx, toIdx,
        cargo: cargo.cargo, tag: cargo.tag, weight: cargo.weight, trailerStyle: cargo.style,
        brand: cargo.brand, trailerColor: cargo.color, trailerType: cargo.trailer, desc: cargo.desc,
        actualDistance, displayKm, distance: displayKm * 1000, pay, deadline, startTime, rating,
        trailer: cargo.trailer, truck: '6×4 · AUTO',
      });
    }
    return jobs;
  }

  // ------------------------------------------------------------- UI
  bindUI() {
    const $ = (id) => document.getElementById(id);
    document.addEventListener('pointerdown', () => this.audio.init(), { once: true });
    document.querySelectorAll('button').forEach((b) => {
      b.addEventListener('pointerdown', (e) => {
        this.audio.init();
        if (!b.disabled) this.audio.click();
      });
    });
    $('btn-continue').addEventListener('click', () => this.openJobBoard('menu'));
    $('btn-new').addEventListener('click', () => {
      this.career = defaultCareer();
      this.applyCareerToTruck();
      this.game.career = this.career;
      this.game.jobs = this.generateJobs();
      this.selectedJob = 0;
      this.save();
      this.updateMenuStats();
      this.toast('New career created. The road is yours.', 'good');
      this.openJobBoard('menu');
    });
    $('btn-how').addEventListener('click', () => this.openHelp('menu'));
    $('menu-help').addEventListener('click', () => this.openHelp('menu'));
    $('jb-back').addEventListener('click', () => this.showMenu());
    $('btn-pause').addEventListener('click', () => this.openPause());
    $('btn-resume').addEventListener('click', () => this.resumeGame());
    $('btn-to-jobs').addEventListener('click', () => {
      this.abandonJob();
      this.openJobBoard('pause');
    });
    $('btn-settings').addEventListener('click', () => this.openSettings('pause'));
    $('btn-mainmenu').addEventListener('click', () => {
      this.abandonJob();
      this.save();
      this.showMenu();
    });
    $('settings-close').addEventListener('click', () => this.closeSettings());
    $('settings-done').addEventListener('click', () => this.closeSettings());
    $('help-close').addEventListener('click', () => this.closeHelp());
    $('help-done').addEventListener('click', () => this.closeHelp());
    $('map-close').addEventListener('click', () => this.closeMap());
    $('map-wrap').addEventListener('click', () => this.openMap());
    $('del-next').addEventListener('click', () => this.openJobBoard('delivery'));
    $('del-garage').addEventListener('click', () => {
      this.openJobBoard('delivery');
      this.setTab('garage');
    });
    $('del-menu').addEventListener('click', () => this.showMenu());
    $('tut-close').addEventListener('click', () => {
      this.hud.showTutorial(false);
      this.career.tutorialDone = true;
      this.game.tutorial = false;
      this.save();
    });
    $('btn-start-job').addEventListener('click', () => this.startSelectedJob());
    // tabs
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => this.setTab(tab.dataset.tab));
    });
    // garage services
    $('btn-refuel').addEventListener('click', () => {
      const missing = 100 - this.truck.fuel;
      const cost = Math.ceil(missing / 100 * 620 * 1.42);
      if (missing < 1) { this.toast('Tank is already full.'); return; }
      if (this.career.money < cost) { this.toast('Not enough balance for a full tank.', 'bad'); return; }
      this.career.money -= cost;
      this.truck.fuel = 100;
      this.audio.airBrake();
      this.save();
      this.refreshGarage();
      this.toast(`Refuelled — €${cost}`, 'good');
    });
    $('btn-repair').addEventListener('click', () => {
      const cost = Math.ceil(this.truck.damage * 18 + (this.truck.damage > 0.1 ? 40 : 0));
      if (this.truck.damage < 0.5) { this.toast('No repairs required.'); return; }
      if (this.career.money < cost) { this.toast('Not enough balance for repairs.', 'bad'); return; }
      this.career.money -= cost;
      this.truck.damage = 0;
      this.save();
      this.refreshGarage();
      this.toast(`Inspection complete — €${cost}`, 'good');
    });
    $('btn-wash').addEventListener('click', () => {
      if (this.career.money < 60) { this.toast('Not enough balance.', 'bad'); return; }
      this.career.money -= 60;
      this.save();
      this.refreshGarage();
      this.toast('Washed and polished.', 'good');
    });
    document.querySelectorAll('.swatch').forEach((sw) => {
      sw.addEventListener('click', () => {
        document.querySelectorAll('.swatch').forEach((s) => s.classList.remove('selected'));
        sw.classList.add('selected');
        this.career.paint = sw.dataset.color;
        this.truck.setPaint(sw.dataset.color);
        document.getElementById('feature-color').textContent = sw.dataset.color.toUpperCase();
        this.save();
        this.toast('Paint applied.', 'good');
      });
    });
    // settings
    document.querySelectorAll('#quality-seg button').forEach((b) => {
      b.addEventListener('click', () => {
        document.querySelectorAll('#quality-seg button').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        this.setQuality(b.dataset.q);
        this.settings.quality = b.dataset.q;
        this.save();
      });
    });
    document.querySelectorAll('#weather-seg button').forEach((b) => {
      b.addEventListener('click', () => {
        document.querySelectorAll('#weather-seg button').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        this.settings.weather = b.dataset.w;
        this.world.setWeather(b.dataset.w);
        this.game.weather = b.dataset.w;
        this.save();
        this.toast(`Weather set to ${b.dataset.w}.`);
      });
    });
    $('volume').addEventListener('input', (e) => {
      this.settings.volume = Number(e.target.value) / 100;
      this.audio.setVolume(this.settings.volume);
      this.save();
    });
    $('toggle-shake').addEventListener('click', () => {
      const on = !this.settings.shake;
      this.settings.shake = on;
      this.truck.cameraShake = on;
      $('toggle-shake').classList.toggle('on', on);
      this.save();
    });
    // keyboard
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.onKeyUp(e));
    window.addEventListener('blur', () => { this.keys = Object.create(null); this.audio.setHorn(false); });
    // pointer look
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', (e) => {
      if (this.state !== 'driving') return;
      this.dragging = true;
      this.lastMouse = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture?.(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastMouse.x;
      const dy = e.clientY - this.lastMouse.y;
      this.lastMouse = { x: e.clientX, y: e.clientY };
      this.look.yaw = clamp(this.look.yaw - dx * 0.0028, -1.3, 1.3);
      this.look.pitch = clamp(this.look.pitch - dy * 0.0025, -0.5, 0.45);
    });
    const endDrag = () => { this.dragging = false; };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('pointerleave', endDrag);
    // touch controls
    document.querySelectorAll('[data-touch]').forEach((btn) => {
      const action = btn.dataset.touch;
      const down = (e) => {
        e.preventDefault();
        if (action === 'throttle') this.touch.throttle = 1;
        if (action === 'brake') this.touch.brake = 1;
        if (action === 'left') this.touch.steer = 1;
        if (action === 'right') this.touch.steer = -1;
        if (action === 'horn') { this.audio.setHorn(true); this.touch.horn = true; }
        if (action === 'camera') this.cycleCamera();
      };
      const up = (e) => {
        e.preventDefault();
        if (action === 'throttle') this.touch.throttle = 0;
        if (action === 'brake') this.touch.brake = 0;
        if (action === 'left' || action === 'right') this.touch.steer = 0;
        if (action === 'horn') { this.audio.setHorn(false); this.touch.horn = false; }
      };
      btn.addEventListener('pointerdown', down);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('pointerleave', up);
    });
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('beforeunload', () => this.save());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'driving') this.openPause();
    });
  }

  onKeyDown(e) {
    const code = e.code;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(code)) e.preventDefault();
    if (e.repeat) return;
    this.keys[code] = true;
    if (code === 'Escape') {
      if (this.state === 'driving') this.openPause();
      else if (this.state === 'paused') this.resumeGame();
      else if (this.state === 'settings') this.closeSettings();
      else if (this.state === 'help') this.closeHelp();
      else if (this.state === 'map') this.closeMap();
      return;
    }
    if (this.state !== 'driving') return;
    if (code === 'KeyC') this.cycleCamera();
    else if (code === 'KeyH') this.audio.setHorn(true);
    else if (code === 'KeyL') {
      this.truck.lightsOn = !this.truck.lightsOn;
      this.toast(this.truck.lightsOn ? 'Headlights on.' : 'Headlights off.');
    } else if (code === 'KeyE') {
      if (this.truck.fuel <= 0) { this.toast('No fuel. Call recovery with R.', 'bad'); return; }
      this.truck.engineOn = !this.truck.engineOn;
      this.audio.airBrake();
      this.toast(this.truck.engineOn ? 'Engine started.' : 'Engine stopped.');
    } else if (code === 'KeyM') this.openMap();
    else if (code === 'KeyR') this.recoverTruck();
    else if (code === 'Enter' && this.nearDeliveryZone() && this.truck.getSpeedKmh() < 2) {
      this.deliveryHold = 2.6;
    }
  }

  onKeyUp(e) {
    this.keys[e.code] = false;
    if (e.code === 'KeyH') this.audio.setHorn(false);
  }

  cycleCamera() {
    const modes = ['cockpit', 'chase', 'hood'];
    this.cameraMode = modes[(modes.indexOf(this.cameraMode) + 1) % modes.length];
    this.look.yaw = 0; this.look.pitch = 0;
    this.truck.cameraYaw = 0; this.truck.cameraPitch = 0;
    this.toast(`Camera: ${CAMERA_NAMES[this.cameraMode]}`);
  }

  showMenu() {
    this.state = 'menu';
    this.game.state = 'menu';
    this.hud.setVisible(false);
    this.hideAllScreens();
    document.getElementById('menu').classList.remove('hidden');
    this.updateMenuStats();
    this.positionForMenu();
    this.audio.setHorn(false);
    document.getElementById('hud').classList.add('hidden');
  }

  hideAllScreens() {
    for (const id of ['menu', 'jobboard', 'pause', 'settings', 'help', 'map-overlay', 'delivery']) {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    }
  }

  openJobBoard(origin = 'menu') {
    this.state = 'jobboard';
    this.game.state = 'jobboard';
    this.hud.setVisible(false);
    this.hideAllScreens();
    if (this.game.jobs.length === 0) this.game.jobs = this.generateJobs();
    document.getElementById('jobboard').classList.remove('hidden');
    this.refreshJobBoard();
    this.updateMenuStats();
    if (origin === 'pause' || origin === 'delivery') {
      // the contract was already completed/abandoned; park the rig at its depot
      this.truck.speed = 0;
    }
    this.audio.setHorn(false);
    if (this.state === 'jobboard') requestAnimationFrame(() => this.hud.drawPreview(this.game.jobs[this.selectedJob]));
  }

  refreshJobBoard() {
    const $ = (id) => document.getElementById(id);
    const jobs = this.game.jobs;
    $('jb-money').textContent = formatMoney(this.career.money);
    $('jb-level').textContent = String(levelForXp(this.career.xp)).padStart(2, '0');
    $('jb-clock').textContent = formatTime(this.menuTime);
    const list = $('job-list');
    list.innerHTML = '';
    jobs.forEach((job, i) => {
      const item = document.createElement('div');
      item.className = 'job-item' + (i === this.selectedJob ? ' selected' : '');
      item.innerHTML = `
        <div class="job-icon">${job.tag}</div>
        <div class="job-main">
          <strong>${job.cargo}</strong>
          <span>${job.from.name} → ${job.to.name} · ${job.trailerType}</span>
        </div>
        <div class="job-route"><b>${job.weight.toFixed(1)} t</b><span>${job.id}</span></div>
        <div class="job-money"><b>${formatMoney(job.pay)}</b><span>${job.displayKm.toFixed(1)} km · by ${formatTime(job.deadline)}</span></div>
        <div class="job-go">→</div>`;
      item.addEventListener('click', () => {
        this.selectedJob = i;
        document.querySelectorAll('.job-item').forEach((el) => el.classList.remove('selected'));
        item.classList.add('selected');
        this.renderJobDetail(job);
      });
      item.addEventListener('dblclick', () => { this.selectedJob = i; this.startSelectedJob(); });
      list.appendChild(item);
    });
    if (jobs[this.selectedJob]) this.renderJobDetail(jobs[this.selectedJob]);
    this.refreshGarage();
  }

  renderJobDetail(job) {
    const $ = (id) => document.getElementById(id);
    $('pv-id').textContent = job.id;
    $('detail-cargo').textContent = job.cargo;
    $('detail-pay').textContent = formatMoney(job.pay);
    $('detail-dist').textContent = `${job.displayKm.toFixed(1)} km`;
    $('detail-deadline').textContent = formatTime(job.deadline);
    $('detail-weight').textContent = `${job.weight.toFixed(1)} t`;
    $('detail-truck').textContent = job.truck;
    $('detail-desc').textContent = job.desc;
    $('preview-route').innerHTML = `
      <div class="pv-city"><i></i><span>${job.from.name}</span></div>
      <div class="pv-line"></div>
      <div class="pv-city end"><i></i><span>${job.to.name}</span></div>`;
    this.hud.drawPreview(job);
  }

  setTab(tab) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
    document.getElementById('tab-contracts').classList.toggle('hidden', tab !== 'contracts');
    document.getElementById('tab-garage').classList.toggle('hidden', tab !== 'garage');
    if (tab === 'garage') this.refreshGarage();
    else requestAnimationFrame(() => this.hud.drawPreview(this.game.jobs[this.selectedJob]));
  }

  updateMenuStats() {
    const $ = (id) => document.getElementById(id);
    const level = levelForXp(this.career.xp);
    const levelStr = String(level).padStart(2, '0');
    $('stat-deliveries').textContent = this.career.deliveries;
    $('stat-distance').textContent = Math.round(this.career.distance).toLocaleString('en-US') + ' km';
    $('stat-balance').textContent = formatMoney(this.career.money);
    $('stat-level').textContent = levelStr;
    $('feature-color').textContent = (this.career.paint || '#c75d2d').toUpperCase();
    this.refreshGarage();
    // selected paint swatch
    document.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('selected', s.dataset.color === this.career.paint));
    const q = this.settings.quality;
    document.querySelectorAll('#quality-seg button').forEach((b) => b.classList.toggle('active', b.dataset.q === q));
    const w = this.settings.weather;
    document.querySelectorAll('#weather-seg button').forEach((b) => b.classList.toggle('active', b.dataset.w === w));
    document.getElementById('volume').value = Math.round((this.settings.volume ?? 0.75) * 100);
    document.getElementById('toggle-shake').classList.toggle('on', this.settings.shake !== false);
  }

  refreshGarage() {
    if (!this.truck) return;
    const $ = (id) => document.getElementById(id);
    const missing = 100 - this.truck.fuel;
    const refuelCost = Math.ceil(missing / 100 * 620 * 1.42);
    const repairCost = Math.ceil(this.truck.damage * 18 + (this.truck.damage > 0.1 ? 40 : 0));
    $('gar-odo').textContent = Math.round(this.truck.odometer / 1000).toLocaleString('en-US') + ' km';
    $('gar-damage').textContent = `${Math.round(100 - this.truck.damage)}%`;
    $('gar-fuel').textContent = `${Math.round(this.truck.fuel)}%`;
    $('gar-deliveries').textContent = this.career.deliveries;
    $('gar-distance').textContent = Math.round(this.career.distance).toLocaleString('en-US') + ' km';
    $('gar-ontime').textContent = this.career.deliveries ? `${Math.round(this.career.onTime / this.career.deliveries * 100)}%` : '—';
    $('gar-balance').textContent = formatMoney(this.career.money);
    $('refuel-cost').textContent = refuelCost.toLocaleString('en-US');
    $('repair-cost').textContent = repairCost.toLocaleString('en-US');
    $('btn-refuel').disabled = missing < 1 || this.career.money < refuelCost;
    $('btn-repair').disabled = this.truck.damage < 0.5 || this.career.money < repairCost;
    $('jb-money').textContent = formatMoney(this.career.money);
    $('jb-level').textContent = String(levelForXp(this.career.xp)).padStart(2, '0');
  }

  startSelectedJob() {
    const job = this.game.jobs[this.selectedJob];
    if (!job) return;
    this.startJob(job);
  }

  startJob(job) {
    this.audio.init();
    this.game.job = job;
    this.game.time = job.startTime;
    this.game.weather = this.settings.weather || 'clear';
    this.world.setTime(job.startTime);
    this.world.setWeather(this.game.weather);
    this.game.target = job.to.target.clone();
    this.world.setDestination(job.to.target);
    this.game.limit = 25;
    this.elapsed = 0;
    this.deliveryHold = 0;
    this.speedingTime = 0;
    this.fineTimer = 0;
    this.collisionCooldown = 0;
    // spawn in the pickup depot, facing the exit
    const d = job.from;
    const pos = new THREE.Vector3(
      d.center.x - d.outward.x * 7,
      0,
      d.center.z - d.outward.z * 7
    );
    this.truck.resetTo(pos, d.yaw);
    this.truck.fuel = clamp(this.career.fuel, 4, 100);
    this.truck.damage = clamp(this.career.damage, 0, 100);
    this.truck.odometer = (this.career.odometerKm || 14203) * 1000;
    this.truck.lightsOn = false;
    this.truck.engineOn = true;
    this.truck.speed = 0;
    this.truck.reverseTimer = 0;
    this.truck.reversing = false;
    this.truck.attachTrailer({
      brand: job.brand, trailerStyle: job.trailerStyle, trailerColor: job.trailerColor,
      cargo: job.cargo,
    });
    this.cameraMode = 'cockpit';
    this.truck.cameraMode = 'cockpit';
    this.look.yaw = 0; this.look.pitch = 0;
    this.truck.cameraYaw = 0; this.truck.cameraPitch = 0;
    this.hideAllScreens();
    this.hud.setVisible(true);
    this.state = 'driving';
    this.game.state = 'driving';
    this.game.tutorial = !this.career.tutorialDone;
    this.hud.showTutorial(!this.career.tutorialDone);
    this.toast(`Contract ${job.id} accepted · ${job.from.name} → ${job.to.name}`, 'good', 4200);
    this.toast(`Deadline ${formatTime(job.deadline)} · ${formatMoney(job.pay)} on delivery`, '', 4200);
    this.audio.airBrake();
    this.hud.resizeCanvases();
    this.hud.drawPreview(job);
    this.syncCareerFromTruck();
  }

  abandonJob() {
    if (this.game.job) {
      this.syncCareerFromTruck();
      this.game.job = null;
      this.game.target = null;
      this.world.setDestination(null);
    }
    this.state = 'menu';
    this.game.state = 'menu';
    this.hud.showTutorial(false);
    this.hud.setVisible(false);
    this.audio.setHorn(false);
  }

  openPause() {
    if (this.state !== 'driving') return;
    this.state = 'paused';
    this.game.state = 'paused';
    document.getElementById('pause').classList.remove('hidden');
    document.getElementById('pause-money').textContent = formatMoney(this.career.money);
    document.getElementById('pause-dist').textContent = formatDistance((this.game.nav?.distance || 0));
    document.getElementById('pause-cargo').textContent = this.game.job?.cargo || '—';
    this.syncCareerFromTruck();
    this.save();
    this.audio.setHorn(false);
  }

  resumeGame() {
    if (this.state !== 'paused') return;
    this.state = 'driving';
    this.game.state = 'driving';
    document.getElementById('pause').classList.add('hidden');
    this.last = performance.now();
  }

  openSettings(origin) {
    this.settingsOrigin = origin;
    this.hideAllScreens();
    if (origin === 'pause') { /* keep HUD visible underneath */ } else this.hud.setVisible(false);
    document.getElementById('settings').classList.remove('hidden');
    this.state = 'settings';
    this.updateMenuStats();
  }

  closeSettings() {
    document.getElementById('settings').classList.add('hidden');
    if (this.settingsOrigin === 'pause') {
      this.state = 'paused';
      document.getElementById('pause').classList.remove('hidden');
    } else {
      this.state = 'menu';
      document.getElementById('menu').classList.remove('hidden');
    }
    this.applyQualityVisuals();
    this.save();
  }

  openHelp(origin) {
    this.helpOrigin = origin;
    this.hideAllScreens();
    this.hud.setVisible(false);
    document.getElementById('help').classList.remove('hidden');
    this.state = 'help';
  }

  closeHelp() {
    document.getElementById('help').classList.add('hidden');
    if (this.helpOrigin === 'pause') {
      this.state = 'paused';
      this.hud.setVisible(true);
      document.getElementById('pause').classList.remove('hidden');
    } else {
      this.state = 'menu';
      document.getElementById('menu').classList.remove('hidden');
      this.updateMenuStats();
    }
  }

  openMap() {
    if (this.state !== 'driving') return;
    this.prevMapState = this.state;
    this.state = 'map';
    document.getElementById('map-overlay').classList.remove('hidden');
    requestAnimationFrame(() => this.hud.drawFullMap(this.game));
  }

  closeMap() {
    document.getElementById('map-overlay').classList.add('hidden');
    this.state = 'driving';
    this.game.state = 'driving';
    this.last = performance.now();
  }

  toast(text, type = '', ms = 3000) {
    if (this.state === 'driving' && this.hud) {
      this.hud.toast(text, type, ms);
      return;
    }
    const el = document.createElement('div');
    el.className = `toast global ${type}`;
    el.innerHTML = text;
    this.globalToasts.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0'; el.style.transform = 'translateY(-6px)';
      el.style.transition = 'all .35s';
      setTimeout(() => el.remove(), 380);
    }, ms);
    while (this.globalToasts.children.length > 3) this.globalToasts.firstChild.remove();
  }

  setQuality(q, initial = false) {
    this.settings.quality = q;
    this.world.setQuality(q);
    const dpr = Math.min(devicePixelRatio || 1, q === 'high' ? 1.5 : q === 'medium' ? 1 : 0.7);
    this.renderer.setPixelRatio(dpr);
    this.bloom.enabled = q !== 'low';
    this.bloom.strength = q === 'high' ? 0.42 : q === 'medium' ? 0.32 : 0;
    this.renderer.shadowMap.enabled = q !== 'low';
    this.world.sunLight.castShadow = q !== 'low';
    this.resize();
    if (!initial) this.toast(`Graphics quality: ${q.toUpperCase()}`);
  }

  applyQualityVisuals() {
    this.setQuality(this.settings.quality || 'high', true);
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, this.settings.quality === 'high' ? 1.5 : this.settings.quality === 'medium' ? 1 : 0.7));
    this.hud?.resizeCanvases();
    if (this.state === 'map') this.hud?.drawFullMap(this.game);
  }

  // ------------------------------------------------------------- simulation
  readInput() {
    let throttle = 0, brake = 0, steer = 0, handbrake = 0;
    const k = this.keys;
    if (k.KeyW || k.ArrowUp) throttle = 1;
    if (k.KeyS || k.ArrowDown) brake = 1;
    if (k.KeyA || k.ArrowLeft) steer += 1;
    if (k.KeyD || k.ArrowRight) steer -= 1;
    if (k.Space) handbrake = 1;
    throttle += this.touch.throttle; brake += this.touch.brake; steer += this.touch.steer;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && pads[0];
    if (gp) {
      steer += -gp.axes[0];
      throttle += gp.buttons[7]?.value || 0;
      brake += gp.buttons[6]?.value || 0;
      if (gp.buttons[0]?.pressed) handbrake = 1;
    }
    return {
      throttle: clamp(throttle, 0, 1),
      brake: clamp(brake, 0, 1),
      steer: clamp(steer, -1, 1),
      handbrake: handbrake > 0,
    };
  }

  updateDriving(dt) {
    const input = this.readInput();
    this.elapsed += dt;
    this.game.time = (this.game.time + dt / 60) % 24;
    this.truck.update(dt, input, this.world, this.settings.quality);
    // player position after update
    const pos = this.truck.group.position;
    this.world.update(dt, this.camera, pos, this.game.time, this.game.weather);
    this.traffic.update(dt, pos, this.world.isNight);
    this.collisionCooldown = Math.max(0, this.collisionCooldown - dt);
    const col = this.traffic.checkCollision(this.truck.group, this.truck.speed);
    if (col && this.collisionCooldown <= 0 && this.truck.speed > 1.0) {
      this.truck.applyImpact(clamp(this.truck.speed * 0.55, 1.2, 9));
      this.audio.crash();
      this.collisionCooldown = 1.4;
      this.toast('Collision! Watch the traffic.', 'bad');
    }
    // look recenter
    if (!this.dragging && this.state === 'driving') {
      this.look.yaw = damp(this.look.yaw, 0, 0.65, dt);
      this.look.pitch = damp(this.look.pitch, 0, 0.65, dt);
    }
    this.truck.updateCamera(this.camera, this.cameraMode, dt, this.look);
    // zone and speed
    const zoneInfo = this.world.zoneAt(pos.x, pos.z);
    this.game.limit = zoneInfo.limit;
    const kmh = this.truck.getSpeedKmh();
    const speeding = kmh > zoneInfo.limit + 4 && this.truck.speed > 0;
    this.game.speeding = speeding;
    if (speeding) {
      this.speedingTime += dt;
      this.fineTimer += dt;
      if (this.fineTimer > 6) {
        this.fineTimer = 0;
        const fine = zoneInfo.limit >= 80 ? 90 : 55;
        this.career.money = Math.max(0, this.career.money - fine);
        this.toast(`Speed fine · −€${fine}`, 'bad');
        this.audio.tick();
        this.save();
      }
    } else { this.speedingTime = 0; this.fineTimer = 0; }
    // navigation
    const target = this.game.target;
    if (target) {
      const dx = target.x - pos.x, dz = target.z - pos.z;
      const actual = Math.hypot(dx, dz);
      const bearing = Math.atan2(dx, dz);
      const relative = wrapAngle(bearing - this.truck.heading);
      const actualTravelHours = actual / 22.2 / 60;
      const eta = this.game.time + actualTravelHours;
      this.game.nav = {
        distance: actual * DISPLAY_SCALE,
        actual,
        relative,
        bearing,
        name: this.game.job?.to.name || 'Destination',
      };
      this.game.eta = eta;
      if (this._lastNavUpdate === undefined || performance.now() - this._lastNavUpdate > 500) {
        this._lastNavUpdate = performance.now();
        this.truck.setNav(this.world, target, actual * DISPLAY_SCALE, formatTime(eta));
      }
    }
    // delivery
    let prompt = '';
    if (target) {
      const dx = target.x - pos.x, dz = target.z - pos.z;
      const actual = Math.hypot(dx, dz);
      const inZone = actual < 25;
      if (inZone) {
        if (kmh < 2.0) {
          this.deliveryHold += dt;
          prompt = `HOLD POSITION · UNLOADING ${Math.min(100, Math.round(this.deliveryHold / 2.6 * 100))}%`;
          if (this.deliveryHold > 2.6) this.completeDelivery();
        } else {
          prompt = 'STOP INSIDE THE AMBER ZONE TO UNLOAD';
        }
      } else {
        this.deliveryHold = 0;
      }
    }
    if (!this.career.tutorialDone) prompt = '';
    if (!prompt) {
      if (this.truck.fuel <= 0) prompt = 'OUT OF FUEL — PRESS <b>R</b> FOR RECOVERY (€350)';
      else if (this.truck.inWater) prompt = 'IN DEEP WATER — PRESS <b>R</b> TO RECOVER';
      else if (this.truck.damage > 75) prompt = 'CRITICAL DAMAGE — LIMP TO A DEPOT';
      else if (this.world.isNight && !this.truck.lightsOn) prompt = 'LIGHTS OFF — PRESS <b>L</b>';
      else if (this.world.weather.type === 'rain' && kmh > 60) prompt = 'WET ROAD · REDUCE SPEED';
    }
    this.game.prompt = prompt;
    this.hud.update(dt, this.game);
    this.audio.update({
      rpm: this.truck.rpm, throttle: input.throttle, speed: this.truck.speed,
      engineOn: this.truck.engineOn, rain: this.world.weather.type === 'rain',
    });
    this.audio.setHorn(this.keys.KeyH || this.touch.horn);
  }

  nearDeliveryZone() {
    if (!this.game.target) return false;
    const p = this.truck.group.position;
    return Math.hypot(p.x - this.game.target.x, p.z - this.game.target.z) < 25;
  }

  recoverTruck() {
    const cost = 350;
    if (this.career.money < cost) { this.toast('Not enough balance for recovery.', 'bad'); return; }
    this.career.money -= cost;
    let best = this.world.depots[0], bd = Infinity;
    const p = this.truck.group.position;
    for (const d of this.world.depots) {
      const dd = Math.hypot(p.x - d.center.x, p.z - d.center.z);
      if (dd < bd) { bd = dd; best = d; }
    }
    const pos = new THREE.Vector3(best.center.x + best.outward.x * 4, 0, best.center.z + best.outward.z * 4);
    this.truck.resetTo(pos, best.yaw);
    this.truck.fuel = Math.max(this.truck.fuel, 12);
    this.truck.damage = Math.min(this.truck.damage, 90);
    this.audio.airBrake();
    this.toast(`Recovered to ${best.name} — €${cost}`, 'good');
    this.save();
  }

  completeDelivery() {
    const job = this.game.job;
    if (!job) return;
    const late = Math.max(0, this.game.time - job.deadline);
    const latePenalty = clamp(late * 0.16, 0, 0.42);
    const damagePenalty = clamp(this.truck.damage * 0.006, 0, 0.28);
    const pay = Math.max(120, Math.round(job.pay * (1 - latePenalty - damagePenalty) / 10) * 10);
    const xpGain = Math.round(pay * 0.16 + 70);
    const oldLevel = levelForXp(this.career.xp);
    this.career.money += pay;
    this.career.xp += xpGain;
    this.career.deliveries += 1;
    this.career.distance += job.displayKm;
    this.career.totalEarned += pay;
    const onTime = late <= 0.01;
    if (onTime) this.career.onTime += 1;
    const newLevel = levelForXp(this.career.xp);
    this.career.level = newLevel;
    this.truck.speed = 0;
    this.game.time = this.game.time % 24;
    const stars = clamp(Math.round(5 - this.truck.damage / 18 - late * 1.6), 2.5, 5);
    document.getElementById('del-pay').textContent = formatMoney(pay);
    document.getElementById('del-sub').textContent = `${job.cargo} · ${job.from.name} → ${job.to.name}${late > 0.05 ? ' · LATE' : ''}`;
    document.getElementById('del-distance').textContent = `${job.displayKm.toFixed(1)} km`;
    const secs = Math.round(this.elapsed);
    document.getElementById('del-time').textContent = `${String(Math.floor(secs / 3600)).padStart(2, '0')}:${String(Math.floor(secs / 60) % 60).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
    document.getElementById('del-damage').textContent = `${this.truck.damage.toFixed(1)}%`;
    const full = Math.floor(stars), half = stars % 1 >= 0.5;
    document.getElementById('del-rating').textContent = '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(Math.max(0, 5 - full - (half ? 1 : 0)));
    document.getElementById('del-xp').textContent = `+${xpGain} XP`;
    const prog = levelProgress(this.career.xp);
    document.getElementById('del-xp-bar').style.width = `${Math.round(prog.progress * 100)}%`;
    this.hideAllScreens();
    document.getElementById('delivery').classList.remove('hidden');
    this.hud.setVisible(false);
    this.state = 'delivery';
    this.game.state = 'delivery';
    this.audio.chime();
    this.world.setDestination(null);
    this.game.target = null;
    this.game.job = null;
    this.truck.setNav(null, null, 0, '');
    this.game.jobs = this.generateJobs();
    this.selectedJob = 0;
    this.syncCareerFromTruck();
    this.career.odometerKm = this.truck.odometer / 1000;
    this.save();
    if (newLevel > oldLevel) setTimeout(() => this.toast(`Level up! You are now level ${newLevel}.`, 'good', 5000), 600);
    setTimeout(() => this.showTutorialIfNeeded(), 400);
  }

  showTutorialIfNeeded() { /* tutorial only on first drive */ }

  updateAttract(dt) {
    this.attractAngle += dt * 0.035;
    const t = this.truck.group.position;
    const fwd = new THREE.Vector3(Math.sin(this.truck.heading), 0, Math.cos(this.truck.heading));
    const a = this.attractAngle;
    const dist = 21;
    this.camera.position.set(t.x + Math.cos(a) * dist, 6.3, t.z + Math.sin(a) * dist);
    const look = new THREE.Vector3(t.x - fwd.x * 2.6, 2.0, t.z - fwd.z * 2.6);
    this.camera.lookAt(look);
    this.camera.fov = 52;
    this.camera.updateProjectionMatrix();
    this.world.update(dt, this.camera, t, this.menuTime, 'clear');
    this.traffic.update(dt, t, false);
    this.truck.lightsOn = true;
    // keep cab lights alive but no motion
    const idle = { throttle: 0, brake: 0, steer: 0, handbrake: true };
    this.truck.speed = 0;
    this.truck.update(dt, idle, this.world);
    this.audio.update({ rpm: 640, throttle: 0, speed: 0, engineOn: true, rain: false });
  }

  updateBackground(dt) {
    const t = this.truck.group.position;
    this.world.update(dt, this.camera, t, this.game.time, this.game.weather);
    this.audio.update({ rpm: this.truck.rpm, throttle: 0, speed: 0, engineOn: this.truck.engineOn, rain: this.world.weather.type === 'rain' });
  }

  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    if (!this._initialized) return;
    const dt = Math.min(0.06, Math.max(0.0001, (now - this.last) / 1000));
    this.last = now;
    try {
      if (this.state === 'driving') {
        this.updateDriving(dt);
      } else if (this.state === 'delivery') {
        this.world.update(dt, this.camera, this.truck.group.position, this.game.time, this.game.weather);
        this.truck.updateCamera(this.camera, 'chase', dt, { yaw: 0.35, pitch: 0 });
      } else if (this.state === 'paused' || this.state === 'settings' || this.state === 'map') {
        this.updateBackground(dt * 0.2);
      } else if (this.state === 'menu' || this.state === 'jobboard' || this.state === 'help') {
        this.updateAttract(dt);
      } else if (this.state === 'loading') {
        this.renderer.render(this.scene, this.camera);
        return;
      }
      // global overlays
      if (this.state === 'map' && performance.now() % 100 < 20) this.hud.drawFullMap(this.game);
      // Low quality skips the post-processing chain entirely, which makes the
      // software-rendered fallback and integrated GPUs far more responsive.
      if (this.settings.quality === 'low') this.renderer.render(this.scene, this.camera);
      else this.composer.render();
    } catch (err) {
      console.error(err);
      this.fatal(err.message);
    }
  }

  fatal(msg) {
    this._initialized = false;
    document.getElementById('fatal').classList.remove('hidden');
    document.getElementById('fatal-msg').textContent = msg || 'A graphics error occurred.';
  }
}

async function main() {
  // seed the UI even if the WebGL boot fails
  try {
    const g = new Game();
    window.__game = g;
    await g.boot();
  } catch (err) {
    console.error(err);
    const fatal = document.getElementById('fatal');
    if (fatal) {
      fatal.classList.remove('hidden');
      document.getElementById('fatal-msg').textContent = err?.message || String(err);
    }
    const loading = document.getElementById('loading');
    if (loading) loading.classList.add('done');
  }
}
main();
