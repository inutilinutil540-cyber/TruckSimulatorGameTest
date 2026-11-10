import { TAU, clamp, lerp, formatMoney, formatDistance, formatTime } from './utils.js';

const WEATHER_ICON = { clear: '☀', cloudy: '☁', rain: '☂' };

export class HUD {
  constructor(world, truck) {
    this.world = world;
    this.truck = truck;
    this.$ = (id) => document.getElementById(id);
    this.minimap = this.$('minimap');
    this.miniCtx = this.minimap.getContext('2d');
    this.speedo = this.$('speedo');
    this.speedoCtx = this.speedo.getContext('2d');
    this.fullmap = this.$('fullmap');
    this.fullCtx = this.fullmap.getContext('2d');
    this.preview = this.$('preview-map');
    this.previewCtx = this.preview.getContext('2d');
    this._mapTimer = 0;
    this._speedTimer = 0;
    this._navTimer = 0;
    this._lastSpeed = 0;
    this._notifications = this.$('notifications');
    this._promptEl = this.$('prompt');
    this._arrowEl = this.$('nav-arrow');
    this.tutorialVisible = false;
  }

  setVisible(v) {
    this.$('hud').classList.toggle('hidden', !v);
  }

  resizeCanvases() {
    for (const [el, id] of [[this.minimap, 'minimap'], [this.fullmap, 'fullmap']]) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        el.width = Math.round(rect.width * dpr);
        el.height = Math.round(rect.height * dpr);
      }
    }
  }

  update(dt, game) {
    const truck = this.truck;
    const world = this.world;
    const job = game.job;
    const now = performance.now();
    // speed / rpm canvas at ~30fps
    this._speedTimer += dt;
    if (this._speedTimer > 1 / 30) {
      this._speedTimer = 0;
      this.drawSpeedo(truck);
    }
    // map at ~8fps
    this._mapTimer += dt;
    if (this._mapTimer > 1 / 8) {
      this._mapTimer = 0;
      this.drawMinimap(game);
      const nav = game.nav;
      if (nav) {
        this.$('nav-dist').textContent = formatDistance(nav.distance);
        this.$('nav-eta').textContent = formatTime(game.eta);
        this.$('nav-dest').textContent = nav.name;
        this._arrowEl.style.transform = `rotate(${(-nav.relative * 180 / Math.PI).toFixed(1)}deg)`;
        this._arrowEl.style.color = Math.abs(nav.relative) > 1.8 ? 'var(--red)' : 'var(--orange)';
      }
    }
    // text HUD every frame, cheap
    this.$('hud-clock').textContent = formatTime(world.time);
    this.$('hud-weather').textContent = `${WEATHER_ICON[world.weather.type] || '☀'} ${world.weather.type[0].toUpperCase() + world.weather.type.slice(1)}`;
    this.$('hud-money').textContent = formatMoney(game.career.money);
    this.$('hud-level').textContent = `LEVEL ${String(game.career.level).padStart(2, '0')} · ${game.career.xp.toLocaleString('en-US')} XP`;
    this.$('fuel-bar').style.width = `${clamp(truck.fuel, 0, 100)}%`;
    this.$('fuel-bar').style.background = truck.fuel < 18 ? 'var(--red)' : 'var(--green)';
    this.$('fuel-val').textContent = `${Math.round(truck.fuel)}%`;
    this.$('damage-bar').style.width = `${clamp(truck.damage, 0, 100)}%`;
    this.$('damage-bar').style.background = truck.damage > 55 ? 'var(--red)' : 'var(--orange)';
    this.$('damage-val').textContent = `${Math.round(truck.damage)}%`;
    this.$('odo-val').textContent = `${Math.round(truck.odometer / 1000).toLocaleString('en-US')} km`;
    if (job) {
      this.$('hud-cargo').textContent = job.cargo;
      this.$('hud-pay').textContent = formatMoney(job.pay);
      this.$('hud-origin').textContent = job.from.name;
      this.$('hud-dest').textContent = job.to.name;
      this.$('hud-distance').textContent = formatDistance(game.nav ? game.nav.distance : job.distance);
      this.$('hud-deadline').textContent = `Deadline ${formatTime(job.deadline)}`;
      this.$('hud-rating').textContent = `★ ${job.rating.toFixed(1)}`;
      const city = world.zoneAt(truck.group.position.x, truck.group.position.z);
      const nearest = city.depot || this.nearestDepot(truck.group.position);
      this.$('map-city').textContent = (nearest?.name || 'NORTHERN RING').toUpperCase();
      const fx = Math.sin(truck.heading), fz = Math.cos(truck.heading);
      const headingDeg = ((Math.atan2(fx, -fz) * 180 / Math.PI) + 360) % 360;
      const compass = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(headingDeg / 45) % 8];
      this.$('map-heading').textContent = `${compass} ${Math.round(headingDeg)}°`;
    }
    const limit = game.limit || 90;
    this.$('speed-limit').querySelector('span').textContent = limit;
    this.$('speed-limit').classList.toggle('speeding', game.speeding);
    // warnings
    const warnings = [];
    if (truck.fuel < 15) warnings.push('LOW FUEL');
    if (truck.damage > 60) warnings.push('TRUCK DAMAGED');
    if (game.speeding) warnings.push('OVER LIMIT');
    if (!truck.engineOn && truck.fuel > 0) warnings.push('ENGINE OFF');
    if (truck.fuel <= 0) warnings.push('OUT OF FUEL');
    const wEl = this.$('warnings');
    if (warnings.length) {
      wEl.innerHTML = warnings.map((w) => `<span class="warn-chip">${w}</span>`).join('');
    } else wEl.innerHTML = '';
    this.setPrompt(game.prompt || '');
  }

  nearestDepot(pos) {
    let best = null, bd = Infinity;
    for (const d of this.world.depots) {
      const dd = Math.hypot(pos.x - d.center.x, pos.z - d.center.z);
      if (dd < bd) { bd = dd; best = d; }
    }
    return best;
  }

  setPrompt(html) {
    if (!html) {
      this._promptEl.classList.add('hidden');
      return;
    }
    this._promptEl.innerHTML = html;
    this._promptEl.classList.remove('hidden');
  }

  toast(text, type = '', ms = 3400) {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = text;
    this._notifications.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(-6px)';
      el.style.transition = 'all .4s';
      setTimeout(() => el.remove(), 420);
    }, ms);
    while (this._notifications.children.length > 3) this._notifications.firstChild.remove();
  }

  showTutorial(show) {
    this.tutorialVisible = show;
    this.$('tutorial').classList.toggle('hidden', !show);
  }

  drawSpeedo(truck) {
    const c = this.speedo, g = this.speedoCtx;
    const dpr = c.width / 460;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, 460, 460);
    const cx = 230, cy = 236, R = 170;
    // outer tick ring
    g.save();
    g.translate(cx, cy);
    // background arc
    g.lineWidth = 12;
    g.strokeStyle = 'rgba(255,255,255,0.09)';
    g.beginPath(); g.arc(0, 0, R, Math.PI * 0.72, Math.PI * 2.28); g.stroke();
    const kmh = Math.min(120, Math.abs(truck.speed) * 3.6);
    const frac = kmh / 120;
    const grad = g.createLinearGradient(-R, 0, R, 0);
    grad.addColorStop(0, '#8e6b3b'); grad.addColorStop(0.6, '#e8a13a'); grad.addColorStop(1, '#e86a3a');
    g.strokeStyle = grad;
    g.lineWidth = 12;
    g.beginPath(); g.arc(0, 0, R, Math.PI * 0.72, Math.PI * 0.72 + Math.PI * 1.56 * frac); g.stroke();
    // ticks
    for (let i = 0; i <= 24; i++) {
      const a = Math.PI * 0.72 + (i / 24) * Math.PI * 1.56;
      const major = i % 4 === 0;
      const r1 = R - 14, r2 = R - (major ? 29 : 21);
      g.strokeStyle = major ? 'rgba(240,236,226,0.85)' : 'rgba(240,236,226,0.3)';
      g.lineWidth = major ? 2.5 : 1;
      g.beginPath(); g.moveTo(Math.cos(a) * r1, Math.sin(a) * r1); g.lineTo(Math.cos(a) * r2, Math.sin(a) * r2); g.stroke();
      if (major) {
        g.fillStyle = 'rgba(240,236,226,0.6)';
        g.font = '500 15px "Barlow Condensed", Arial Narrow, sans-serif';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(String((i / 24) * 120), Math.cos(a) * (R - 46), Math.sin(a) * (R - 46));
      }
    }
    // rpm inner arc
    const rpmFrac = clamp(truck.rpm / 2200, 0, 1);
    g.lineWidth = 4;
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.beginPath(); g.arc(0, 0, 126, Math.PI * 0.8, Math.PI * 2.2); g.stroke();
    g.strokeStyle = rpmFrac > 0.85 ? '#d95e47' : 'rgba(232,161,58,0.8)';
    g.beginPath(); g.arc(0, 0, 126, Math.PI * 0.8, Math.PI * 0.8 + Math.PI * 1.4 * rpmFrac); g.stroke();
    // needle
    const na = Math.PI * 0.72 + Math.PI * 1.56 * frac;
    g.strokeStyle = '#f0ece2'; g.lineWidth = 3; g.lineCap = 'round';
    g.shadowColor = 'rgba(232,161,58,0.6)'; g.shadowBlur = 12;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(na) * (R - 34), Math.sin(na) * (R - 34)); g.stroke();
    g.shadowBlur = 0;
    g.fillStyle = '#e8a13a'; g.beginPath(); g.arc(0, 0, 7, 0, TAU); g.fill();
    g.fillStyle = '#0c1116'; g.beginPath(); g.arc(0, 0, 3, 0, TAU); g.fill();
    // digital speed
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#f4f0e6';
    g.font = '700 84px "Barlow Condensed", Arial Narrow, sans-serif';
    g.fillText(String(Math.round(Math.abs(truck.speed) * 3.6)), 0, 74);
    g.fillStyle = 'rgba(240,236,226,0.45)';
    g.font = '600 18px "Barlow Condensed", sans-serif';
    g.fillText('km/h', 0, 122);
    // gear badge
    g.fillStyle = 'rgba(255,255,255,0.055)';
    g.beginPath(); g.roundRect(112, -38, 52, 48, 4); g.fill();
    g.fillStyle = '#e8a13a';
    g.font = '700 36px "Barlow Condensed", sans-serif';
    g.fillText(String(truck.gear), 138, -12);
    g.fillStyle = 'rgba(240,236,226,0.35)';
    g.font = '500 9px "Inter", sans-serif';
    g.fillText(truck.reversing ? 'REVERSE' : 'AUTO', 138, 5);
    g.restore();
  }

  drawMinimap(game) {
    const c = this.minimap, g = this.miniCtx;
    const w = c.width, h = c.height;
    g.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    g.fillStyle = '#0a1116'; g.fillRect(0, 0, w, h);
    // faint grid
    g.strokeStyle = 'rgba(120,150,165,0.07)'; g.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      g.beginPath(); g.moveTo((i / 8) * w, 0); g.lineTo((i / 8) * w, h); g.stroke();
      g.beginPath(); g.moveTo(0, (i / 8) * h); g.lineTo(w, (i / 8) * h); g.stroke();
    }
    const scale = (w * 0.36) / 620;
    g.save();
    g.translate(cx, cy);
    this._drawRing(g, scale, true);
    this._drawDepots(g, scale, false);
    this._drawRoute(g, scale, game, true);
    // player
    const p = this.truck.group.position;
    const fx = Math.sin(this.truck.heading), fz = Math.cos(this.truck.heading);
    const px = p.x * scale, py = p.z * scale;
    g.save();
    g.translate(px, py);
    g.fillStyle = '#f4f0e6';
    g.shadowColor = 'rgba(0,0,0,0.8)'; g.shadowBlur = 4;
    g.beginPath();
    g.moveTo(fx * 12, fz * 12);
    g.lineTo(-fx * 5 - fz * 6, -fz * 5 + fx * 6);
    g.lineTo(-fx * 2, -fz * 2);
    g.lineTo(-fx * 5 + fz * 6, -fz * 5 - fx * 6);
    g.closePath(); g.fill();
    g.restore();
    // north marker
    g.fillStyle = 'rgba(240,236,226,0.6)';
    g.font = '600 11px "Barlow Condensed", sans-serif';
    g.textAlign = 'center';
    g.fillText('N', 0, -cy + 36);
    g.restore();
    // dark edge vignette
    const grd = g.createRadialGradient(cx, cy, w * 0.25, cx, cy, w * 0.52);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  }

  _drawRing(g, scale, withFill) {
    const pts = this.world.ringPoints;
    g.beginPath();
    pts.forEach((p, i) => {
      const x = p.x * scale, y = p.z * scale;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    });
    g.closePath();
    if (withFill) {
      g.fillStyle = 'rgba(70,120,130,0.06)'; g.fill();
    }
    g.strokeStyle = 'rgba(105,160,170,0.62)'; g.lineWidth = Math.max(2, 16 * scale);
    g.stroke();
    g.strokeStyle = 'rgba(10,17,22,0.9)'; g.lineWidth = Math.max(1, 7 * scale);
    g.stroke();
    g.strokeStyle = 'rgba(105,160,170,0.4)'; g.lineWidth = Math.max(1, 2 * scale);
    g.stroke();
    // access roads
    g.strokeStyle = 'rgba(105,160,170,0.28)'; g.lineWidth = Math.max(1, 7 * scale);
    for (const d of this.world.depots) {
      g.beginPath(); g.moveTo(d.start.x * scale, d.start.z * scale); g.lineTo(d.center.x * scale, d.center.z * scale); g.stroke();
    }
  }

  _drawDepots(g, scale, labels) {
    for (const d of this.world.depots) {
      const x = d.center.x * scale, y = d.center.z * scale;
      g.fillStyle = 'rgba(105,160,170,0.55)';
      g.beginPath(); g.arc(x, y, Math.max(2.5, 7 * scale), 0, TAU); g.fill();
      if (labels) {
        g.fillStyle = 'rgba(240,236,226,0.72)';
        g.font = `${Math.max(9, 22 * scale)}px "Barlow Condensed", sans-serif`;
        g.textAlign = 'center';
        g.fillText(d.name.toUpperCase(), x, y - 11 * scale - 3);
      }
    }
  }

  _drawRoute(g, scale, game, includePlayer) {
    if (!game.job) return;
    const target = game.target;
    if (!target) return;
    const dest = target;
    const p = this.truck.group.position;
    const a = this.world.nearestOnRing(p.x, p.z);
    const b = this.world.nearestOnRing(dest.x, dest.z);
    const total = this.world.ringLength;
    let d1 = b.s - a.s;
    if (d1 > total / 2) d1 -= total;
    if (d1 < -total / 2) d1 += total;
    const steps = Math.max(4, Math.ceil(Math.abs(d1) / 26));
    g.beginPath();
    g.moveTo(p.x * scale, p.z * scale);
    g.lineTo(a.p.x * scale, a.p.z * scale);
    for (let i = 1; i <= steps; i++) {
      const s = a.s + (d1 * i) / steps;
      const sample = this.world.sampleRing(s);
      g.lineTo(sample.p.x * scale, sample.p.z * scale);
    }
    g.lineTo(dest.x * scale, dest.z * scale);
    g.strokeStyle = 'rgba(232,161,58,0.9)';
    g.lineWidth = Math.max(2, 10 * scale);
    g.shadowColor = 'rgba(232,161,58,0.55)'; g.shadowBlur = 8;
    g.stroke();
    g.shadowBlur = 0;
    const pulse = 1 + Math.sin(performance.now() * 0.005) * 0.18;
    g.fillStyle = '#e8a13a';
    g.beginPath(); g.arc(dest.x * scale, dest.z * scale, Math.max(5, 14 * scale) * pulse, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(232,161,58,0.5)'; g.lineWidth = 2;
    g.beginPath(); g.arc(dest.x * scale, dest.z * scale, Math.max(9, 24 * scale) * pulse, 0, TAU); g.stroke();
  }

  drawFullMap(game) {
    const c = this.fullmap, g = this.fullCtx;
    const rect = c.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.max(600, Math.round(rect.width * dpr));
    c.height = Math.round(c.width * (rect.height / Math.max(1, rect.width)));
    const w = c.width, h = c.height;
    g.fillStyle = '#080f14'; g.fillRect(0, 0, w, h);
    // grid
    g.strokeStyle = 'rgba(110,150,165,0.09)'; g.lineWidth = 1;
    for (let i = 0; i < 16; i++) {
      g.beginPath(); g.moveTo((i / 16) * w, 0); g.lineTo((i / 16) * w, h); g.stroke();
      g.beginPath(); g.moveTo(0, (i / 16) * h); g.lineTo(w, (i / 16) * h); g.stroke();
    }
    const scale = Math.min(w, h) / 1500;
    g.save();
    g.translate(w / 2, h / 2);
    // lake fill
    g.fillStyle = 'rgba(35,75,90,0.35)';
    g.beginPath(); g.arc(0, 0, 320 * scale, 0, TAU); g.fill();
    g.fillStyle = 'rgba(240,236,226,0.35)';
    g.font = '500 13px "Inter", sans-serif'; g.textAlign = 'center';
    g.fillText('GRAND LAKE', 0, -160 * scale);
    this._drawRing(g, scale, true);
    this._drawDepots(g, scale, true);
    this._drawRoute(g, scale, game, true);
    const p = this.truck.group.position;
    const fx = Math.sin(this.truck.heading), fz = Math.cos(this.truck.heading);
    g.save(); g.translate(p.x * scale, p.z * scale);
    g.fillStyle = '#f4f0e6';
    g.shadowColor = 'rgba(0,0,0,0.9)'; g.shadowBlur = 15;
    g.beginPath();
    g.moveTo(fx * 22, fz * 22);
    g.lineTo(-fx * 10 - fz * 11, -fz * 10 + fx * 11);
    g.lineTo(-fx * 4, -fz * 4);
    g.lineTo(-fx * 10 + fz * 11, -fz * 10 - fx * 11);
    g.closePath(); g.fill();
    g.restore();
    g.restore();
    // compass
    g.fillStyle = 'rgba(240,236,226,0.55)';
    g.textAlign = 'center'; g.font = '600 18px "Barlow Condensed", sans-serif';
    g.fillText('N', w - 38, 44);
    g.beginPath(); g.moveTo(w - 38, 52); g.lineTo(w - 42, 66); g.lineTo(w - 34, 66); g.closePath(); g.fill();
    // scale bar
    g.textAlign = 'left';
    g.font = '500 12px "Inter", sans-serif';
    g.fillText('0', 34, h - 34);
    g.fillText('2 km', 34 + 2000 * scale - 20, h - 34);
    g.strokeStyle = 'rgba(240,236,226,0.55)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(34, h - 24); g.lineTo(34 + 2000 * scale, h - 24); g.stroke();
  }

  drawPreview(job) {
    const c = this.preview, g = this.previewCtx;
    const w = c.width, h = c.height;
    g.fillStyle = '#0a1116'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(110,150,165,0.1)'; g.lineWidth = 1;
    for (let i = 0; i < 12; i++) {
      g.beginPath(); g.moveTo((i / 12) * w, 0); g.lineTo((i / 12) * w, h); g.stroke();
      g.beginPath(); g.moveTo(0, (i / 12) * h); g.lineTo(w, (i / 12) * h); g.stroke();
    }
    const scale = Math.min(w, h) / 1400;
    g.save(); g.translate(w / 2, h / 2);
    g.fillStyle = 'rgba(35,75,90,0.3)';
    g.beginPath(); g.arc(0, 0, 310 * scale, 0, TAU); g.fill();
    this._drawRing(g, scale, true);
    this._drawDepots(g, scale, true);
    if (job) {
      const from = job.from, to = job.to;
      const a = this.world.nearestOnRing(from.center.x, from.center.z).s;
      let d = this.world.nearestOnRing(to.center.x, to.center.z).s - a;
      const total = this.world.ringLength;
      if (d > total / 2) d -= total;
      if (d < -total / 2) d += total;
      g.beginPath();
      const steps = Math.max(6, Math.ceil(Math.abs(d) / 30));
      for (let i = 0; i <= steps; i++) {
        const sm = this.world.sampleRing(a + (d * i) / steps);
        const x = sm.p.x * scale, y = sm.p.z * scale;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.strokeStyle = '#e8a13a';
      g.lineWidth = Math.max(3, 14 * scale);
      g.shadowColor = 'rgba(232,161,58,0.5)'; g.shadowBlur = 14; g.stroke(); g.shadowBlur = 0;
      // markers
      g.fillStyle = '#f4f0e6';
      g.beginPath(); g.arc(from.center.x * scale, from.center.z * scale, 8, 0, TAU); g.fill();
      const pulse = 1 + Math.sin(performance.now() * 0.005) * 0.2;
      g.fillStyle = '#e8a13a';
      g.beginPath(); g.arc(to.center.x * scale, to.center.z * scale, 10 * pulse, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(232,161,58,0.5)'; g.lineWidth = 2;
      g.beginPath(); g.arc(to.center.x * scale, to.center.z * scale, 19 * pulse, 0, TAU); g.stroke();
    }
    g.restore();
    // vignette
    const grd = g.createRadialGradient(w / 2, h / 2, w * 0.2, w / 2, h / 2, w * 0.7);
    grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(0,0,0,0.45)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  }
}
