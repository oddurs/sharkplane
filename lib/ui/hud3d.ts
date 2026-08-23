import * as THREE from "three";
import { Label, Spring, arcSegment, corner, dart, hexPuck, hexRing, mat, resolveFont, sector, silhouette, slab, type PaletteKey } from "./kit";
import type { Hud, Options } from "../store";

/**
 * The in-game HUD as real low-poly geometry: an orthographic scene rendered on top of the world, lit with a
 * raked key light so every plate reads as a bevelled slab. Layout is in CSS pixels with y up; anchors handle
 * safe areas and the coarse-pointer (phone) profile.
 */

type Anchor = "tl" | "tc" | "tr" | "bl" | "bc" | "br";
const TILT = -0.18; // every plate lies back a little toward the camera

class Plate extends THREE.Group {
  body: THREE.Mesh;
  label: Label | null = null;
  pop = new Spring(1);
  constructor(w: number, h: number, color: PaletteKey, text?: { size: number; color: string; stroke?: string; font?: "display" | "body" }, depth = 8, skew = 0.06) {
    super();
    this.body = new THREE.Mesh(slab(w, h, depth, skew), mat(color));
    this.add(this.body);
    if (text) { this.label = new Label({ ...text, align: "center" }); this.label.position.z = depth + 3; this.add(this.label); }
    this.rotation.x = TILT;
  }
  get text() { return this.label?.text ?? ""; }
  setText(t: string) { const changed = this.label && this.label.text !== t; this.label?.set(t); if (changed) this.pop.kick(6); }
  tick(dt: number) { const s = this.pop.update(dt); this.scale.setScalar(s); }
}

type Contact = { mesh: THREE.Mesh; pin: THREE.Mesh };

export class Hud3D {
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -500, 500);
  private w = 1; private h = 1; private ui = 1; // ui scale
  private coarse = false;
  private safe = { t: 0, r: 0, b: 0, l: 0 };
  private t = 0;
  private shake = new THREE.Vector2();

  // elements
  private score: Plate; private eaten: Plate; private timer: Plate; private wave: Plate; private stats: Plate;
  private comboGroup = new THREE.Group(); private comboSegs: THREE.Mesh[] = []; private comboChip: Label;
  private radar = new THREE.Group(); private sweep: THREE.Mesh; private contacts: Contact[] = []; private playerChip: THREE.Mesh; private radarRoll = new Spring(0);
  private gauges: { group: THREE.Group; fill: THREE.Mesh; needle: THREE.Mesh; label: Label; value: Spring }[] = [];
  private compass = new THREE.Group(); private compassArrow: THREE.Mesh; private lockChip: Plate;
  private markers: { group: THREE.Group; corners: THREE.Mesh[]; dart: THREE.Mesh; label: Label; lockScale: Spring }[] = [];
  private objectives: { plate: Plate; check: THREE.Mesh; flip: Spring }[] = [];
  private boss = new THREE.Group(); private bossFill: THREE.Mesh; private bossLabel: Label;
  private msg: Plate; private msgScale = new Spring(0); private msgBits: THREE.Mesh[] = []; private lastMsg = "";
  private banner: Plate; private bannerSpin = new Spring(0); private bannerText = "";
  private countdown: Label; private countdownDrop = new Spring(0); private lastCountdown = "";
  private subtitle: Plate; private subtitleWho: THREE.Mesh; private subtitleSlide = new Spring(0);
  private caption: Plate; private toast: Plate; private muted: Plate;
  private lastBoss = 0;

  constructor() {
    resolveFont();
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(-0.6, 1, 1.4); this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xbfe3ff, 0.5); fill.position.set(0.8, -0.4, 1); this.scene.add(fill);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    this.camera.position.z = 300;

    this.score = new Plate(150, 58, "ink", { size: 40, color: "#ffd84a" }, 10, 0.08); this.scene.add(this.score);
    this.eaten = new Plate(230, 34, "red", { size: 18, color: "#fff" }, 7); this.scene.add(this.eaten);
    this.timer = new Plate(140, 50, "cream", { size: 34, color: "#1b2a44" }, 9, 0.05); this.scene.add(this.timer);
    this.wave = new Plate(120, 22, "yellow", { size: 12, color: "#1b2a44" }, 5); this.scene.add(this.wave);
    this.stats = new Plate(210, 64, "ink", { size: 15, color: "#fff" }, 7); this.scene.add(this.stats);

    // combo ring: 10 segments
    for (let i = 0; i < 10; i++) {
      const a0 = Math.PI / 2 - (i / 10) * Math.PI * 2, a1 = a0 - (1 / 10) * Math.PI * 2 + 0.08;
      const seg = new THREE.Mesh(arcSegment(30, 22, a1, a0, 5), mat("inkDark")); seg.position.z = 0; this.comboGroup.add(seg); this.comboSegs.push(seg);
    }
    const comboCore = new THREE.Mesh(hexPuck(20, 6, 2), mat("ink")); this.comboGroup.add(comboCore);
    this.comboChip = new Label({ size: 16, color: "#ffd84a", stroke: "#1b2a44" }); this.comboChip.position.z = 12; this.comboGroup.add(this.comboChip);
    this.comboGroup.rotation.x = TILT; this.scene.add(this.comboGroup);

    // radar puck
    const base = new THREE.Mesh(hexPuck(100, 10, 4), mat("ink")); this.radar.add(base);
    const dish = new THREE.Mesh(hexPuck(84, 3, 0), mat("inkDark")); dish.position.z = 10; this.radar.add(dish);
    const rim = new THREE.Mesh(hexRing(100, 86, 7), mat("ink")); rim.position.z = 10; this.radar.add(rim);
    for (const r of [42, 78]) { const ring = new THREE.Mesh(hexRing(r, r - 2, 1), mat("grey", { opacity: 0.55 })); ring.position.z = 13; this.radar.add(ring); }
    const line = new THREE.Mesh(new THREE.BoxGeometry(2, 80, 1), mat("grey", { opacity: 0.4 })); line.position.set(0, 40, 13.5); this.radar.add(line);
    this.sweep = new THREE.Mesh(sector(82, Math.PI / 2 - 0.6, Math.PI / 2, 2), mat("sky", { opacity: 0.28 })); this.sweep.position.z = 13; this.radar.add(this.sweep);
    this.playerChip = new THREE.Mesh(silhouette("player", 12), mat("white")); this.playerChip.position.z = 14; this.radar.add(this.playerChip);
    for (let i = 0; i < 24; i++) {
      const pin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1), mat("grey")); pin.visible = false;
      const m = new THREE.Mesh(silhouette("fighter", 7), mat("yellow")); m.visible = false;
      this.radar.add(pin, m); this.contacts.push({ mesh: m, pin });
    }
    this.radar.rotation.x = TILT * 1.6; this.scene.add(this.radar);

    // gauges
    for (const [name, color] of [["THR", "orange"], ["BST", "sky"], ["FOOD", "green"]] as const) {
      const g = new THREE.Group();
      const trough = new THREE.Mesh(slab(26, 170, 8, 0.02, 2), mat("ink")); g.add(trough);
      const fill = new THREE.Mesh(new THREE.BoxGeometry(16, 1, 6), mat(color)); fill.position.z = 8; g.add(fill);
      const needle = new THREE.Mesh(dart(14, 10, 3), mat("white")); needle.rotation.z = Math.PI / 2; needle.position.set(-20, 0, 10); g.add(needle);
      const label = new Label({ size: 9, color: "#1b2a44" }); label.position.set(0, -100, 12); g.add(label); label.set(name);
      const tag = new THREE.Mesh(slab(32, 14, 4, 0.05, 1), mat("cream")); tag.position.set(0, -100, 8); g.add(tag);
      g.rotation.x = TILT; this.scene.add(g);
      this.gauges.push({ group: g, fill, needle, label, value: new Spring(0) });
    }

    // compass
    this.compassArrow = new THREE.Mesh(dart(30, 42, 12), mat("white")); this.compass.add(this.compassArrow);
    this.lockChip = new Plate(74, 22, "ink", { size: 13, color: "#ffd84a" }, 5); this.lockChip.position.y = -38; this.compass.add(this.lockChip);
    this.scene.add(this.compass);

    // target markers pool
    for (let i = 0; i < 16; i++) {
      const g = new THREE.Group(); const corners: THREE.Mesh[] = [];
      for (let c = 0; c < 4; c++) { const m = new THREE.Mesh(corner(14, 4, 4), mat("white")); m.rotation.z = (-c * Math.PI) / 2; corners.push(m); g.add(m); }
      const d = new THREE.Mesh(dart(26, 34, 8), mat("white")); d.visible = false; g.add(d);
      const label = new Label({ size: 12, color: "#fff", stroke: "#1b2a44" }); label.position.y = -36; g.add(label);
      g.visible = false; this.scene.add(g);
      this.markers.push({ group: g, corners, dart: d, label, lockScale: new Spring(1) });
    }

    // objectives (2)
    for (let i = 0; i < 2; i++) {
      const plate = new Plate(250, 30, "cream", { size: 13, color: "#1b2a44", font: "body" }, 6, 0.05);
      const check = new THREE.Mesh(hexPuck(8, 4, 1), mat("yellow")); check.position.set(-112, 0, 8); plate.add(check);
      this.scene.add(plate); this.objectives.push({ plate, check, flip: new Spring(0) });
    }

    // boss girder
    const girder = new THREE.Mesh(slab(260, 22, 8, 0.02, 2), mat("ink")); this.boss.add(girder);
    this.bossFill = new THREE.Mesh(new THREE.BoxGeometry(1, 12, 4), mat("orange")); this.bossFill.position.z = 9; this.boss.add(this.bossFill);
    this.bossLabel = new Label({ size: 12, color: "#ff5d2e", stroke: "#1b2a44" }); this.bossLabel.position.set(0, 22, 12); this.boss.add(this.bossLabel); this.bossLabel.set("ZEPPELIN");
    this.boss.rotation.x = TILT; this.boss.visible = false; this.scene.add(this.boss);

    // messages
    this.msg = new Plate(10, 10, "yellow", { size: 64, color: "#ffd84a", stroke: "#b3261e" }, 0); this.msg.body.visible = false; this.scene.add(this.msg);
    for (let i = 0; i < 8; i++) { const b = new THREE.Mesh(hexPuck(6, 4, 1), mat(i % 2 ? "yellow" : "orange")); b.visible = false; this.scene.add(b); this.msgBits.push(b); }
    this.banner = new Plate(360, 64, "blue", { size: 44, color: "#fff" }, 14, 0.04); this.scene.add(this.banner);
    this.countdown = new Label({ size: 150, color: "#ffd84a", stroke: "#b3261e" }); this.scene.add(this.countdown);
    this.subtitle = new Plate(520, 44, "ink", { size: 18, color: "#fff", font: "body" }, 8, 0.03); this.scene.add(this.subtitle);
    this.subtitleWho = new THREE.Mesh(hexPuck(12, 6, 2), mat("yellow")); this.subtitleWho.position.set(-240, 0, 12); this.subtitle.add(this.subtitleWho);
    this.caption = new Plate(300, 26, "inkDark", { size: 13, color: "#ffd84a", font: "body" }, 5, 0.03); this.scene.add(this.caption);
    this.toast = new Plate(420, 34, "ink", { size: 14, color: "#ffd84a", font: "body" }, 7, 0.03); this.scene.add(this.toast);
    this.muted = new Plate(250, 30, "orange", { size: 13, color: "#fff", font: "body" }, 6); this.scene.add(this.muted);
  }

  resize(w: number, h: number, coarse: boolean, safe: { t: number; r: number; b: number; l: number }) {
    this.w = w; this.h = h; this.coarse = coarse; this.safe = safe;
    this.ui = coarse ? Math.max(0.55, Math.min(0.8, h / 520)) : Math.max(0.75, Math.min(1.15, h / 800));
    this.camera.left = -w / 2; this.camera.right = w / 2; this.camera.top = h / 2; this.camera.bottom = -h / 2;
    this.camera.updateProjectionMatrix();
  }

  /** Position in CSS px from an anchor (x right, y down), returns world coords (y up). */
  private at(anchor: Anchor, x: number, y: number, out: THREE.Object3D) {
    const s = this.ui;
    const L = -this.w / 2 + this.safe.l, R = this.w / 2 - this.safe.r, T = this.h / 2 - this.safe.t, B = -this.h / 2 + this.safe.b;
    const px = anchor.endsWith("l") ? L + x * s : anchor.endsWith("r") ? R - x * s : (L + R) / 2 + x * s;
    const py = anchor.startsWith("t") ? T - y * s : B + y * s;
    out.position.set(px + this.shake.x, py + this.shake.y, out.position.z);
    out.scale.setScalar(s);
  }
  private ndcToWorld(xPct: number, yPct: number) {
    return new THREE.Vector2((xPct / 100 - 0.5) * this.w, (0.5 - yPct / 100) * this.h);
  }

  setShake(x: number, y: number) { this.shake.set(x, y); }

  update(hud: Hud, o: Options, dt: number) {
    this.t += dt;
    const s = this.ui, bob = (i: number) => Math.sin(this.t * 1.3 + i) * 0.6 * (o.reducedMotion ? 0 : 1);
    const mm = Math.floor(hud.timeLeft / 60), ss = String(hud.timeLeft % 60).padStart(2, "0");

    // top-left: score + combo + stats
    this.at("tl", 92, 40, this.score); this.score.position.y += bob(0); this.score.setText(String(hud.score)); this.score.tick(dt); this.score.scale.multiplyScalar(s); this.score.rotation.z = -0.035;
    this.at("tl", 212, 40, this.comboGroup); this.comboGroup.visible = hud.combo > 1;
    if (hud.combo > 1) {
      const lit = Math.min(10, Math.round((hud.combo / 5) * 10));
      this.comboSegs.forEach((seg, i) => { seg.material = mat(i < lit ? (hud.frenzy > 0 ? "orange" : "yellow") : "inkDark"); });
      this.comboChip.set(`x${hud.combo}`); this.comboGroup.rotation.z = Math.sin(this.t * 6) * 0.08 * (o.reducedMotion ? 0 : 1);
    }
    this.at("tl", this.coarse ? 70 : 122, this.coarse ? 84 : 90, this.stats); this.stats.setText(`SPD ${hud.speed}   ALT ${hud.alt}`); this.stats.tick(dt); this.stats.scale.multiplyScalar(s * (this.coarse ? 0.5 : 0.9)); this.stats.rotation.z = -0.02;

    // top-centre: timer, wave, compass
    this.at("tc", 0, 38, this.timer); this.timer.setText(`${mm}:${ss}`); this.timer.tick(dt); this.timer.scale.multiplyScalar(s); this.timer.body.material = mat(hud.timeLeft <= 10 ? "orange" : "cream"); this.timer.rotation.z = 0.02;
    this.at("tc", 0, 74, this.wave); this.wave.setText(`${hud.frenzy > 0 ? `FRENZY ${Math.ceil(hud.frenzy)}s` : `WAVE ${hud.wave}`}${hud.weather === "rain" ? " ☂" : ""}`); this.wave.tick(dt); this.wave.scale.multiplyScalar(s); this.wave.body.material = mat(hud.frenzy > 0 ? "orange" : "yellow");
    this.at("tc", 0, 122, this.compass); this.compass.scale.multiplyScalar(s);
    this.compassArrow.rotation.set(-hud.lockPitch * 0.9, 0, -hud.compassAngle); this.compassArrow.material = mat(hud.compassNear ? "orange" : "white");
    this.lockChip.setText(hud.lockDist !== null ? `${hud.lockDist}m` : ""); this.lockChip.tick(dt);

    // top-right: eaten + objectives + boss
    this.at("tr", this.coarse ? 200 : 130, 32, this.eaten); this.eaten.setText(`PLANES EATEN: ${hud.eaten}`); this.eaten.tick(dt); this.eaten.scale.multiplyScalar(s); this.eaten.rotation.z = 0.03;
    hud.objectives.forEach((ob, i) => {
      const e = this.objectives[i]; if (!e) return;
      this.at("tr", this.coarse ? 190 : 140, (this.coarse ? 64 : 70) + i * (this.coarse ? 28 : 34), e.plate); e.plate.position.y += bob(i + 2);
      e.plate.setText(`${ob.text}${ob.target > 1 ? `  ${ob.progress}/${ob.target}` : ""}`); e.plate.tick(dt); e.plate.scale.multiplyScalar(s * (this.coarse ? 0.78 : 0.95));
      e.flip.target = ob.done ? 1 : 0; const f = e.flip.update(dt);
      e.plate.body.material = mat(ob.done ? "green" : "cream"); e.plate.rotation.x = TILT + f * Math.PI * 2 * 0; e.check.material = mat(ob.done ? "white" : "yellow"); e.check.rotation.z = f * Math.PI;
      e.plate.rotation.z = 0.02 + (1 - Math.abs(Math.cos(f * Math.PI))) * 0.3;
    });
    for (let i = hud.objectives.length; i < this.objectives.length; i++) this.objectives[i].plate.visible = false;
    this.boss.visible = !!hud.boss;
    if (hud.boss) { this.at("tr", 150, 150, this.boss); this.boss.scale.multiplyScalar(s); const frac = hud.boss.hp / hud.boss.max; this.bossFill.scale.x = 240 * frac; this.bossFill.position.x = -120 + (240 * frac) / 2; if (hud.boss.hp !== this.lastBoss) { this.boss.rotation.z = 0.08; } this.lastBoss = hud.boss.hp; this.boss.rotation.z *= 0.9; }

    // gauges (bottom-right on desktop, bottom-centre row on phones)
    const vals = [hud.throttle, hud.boost, hud.hunger];
    this.gauges.forEach((g, i) => {
      if (this.coarse) { this.at("bc", -150 + i * 30, 70, g.group); g.group.scale.multiplyScalar(s * 0.5); } else { this.at("br", 36 + i * 42, 110, g.group); g.group.scale.multiplyScalar(s); }
      g.value.target = vals[i]; const v = g.value.update(dt);
      g.fill.scale.y = Math.max(0.01, v * 156); g.fill.position.y = -78 + (v * 156) / 2; g.needle.position.y = -78 + v * 156;
      const low = i === 2 && hud.hunger < 0.25;
      g.fill.material = mat(low ? (Math.sin(this.t * 10) > 0 ? "orange" : "red") : (["orange", "sky", "green"] as const)[i]);
      g.group.rotation.z = (this.coarse ? 0 : 0.03) + (low ? Math.sin(this.t * 30) * 0.02 : 0);
    });

    // radar (bottom-right beside gauges; bottom-centre on phones)
    if (this.coarse) { this.at("bc", 0, 90, this.radar); this.radar.scale.multiplyScalar(s * 0.5); } else { this.at("br", 230, 125, this.radar); this.radar.scale.multiplyScalar(s); }
    this.radarRoll.target = hud.bank * 0.06; this.radar.rotation.y = this.radarRoll.update(dt) * (o.reducedMotion ? 0 : 1);
    this.sweep.rotation.z = -this.t * 2.6;
    hud.radar.forEach((b, i) => {
      const c = this.contacts[i]; if (!c) return;
      c.mesh.visible = c.pin.visible = true;
      const x = b.x * 82, y = -b.y * 82, lift = THREE.MathUtils.clamp(b.dAlt / 40, -1, 1) * 10;
      c.mesh.geometry = silhouette(b.kind, b.kind === "bomber" ? 13 : 10);
      c.mesh.material = mat(b.locked ? "yellow" : b.kind === "bomber" ? "orange" : b.kind === "escort" ? "sky" : "white", { emissive: b.locked ? 0x554400 : 0 });
      c.mesh.position.set(x, y, 14 + 6 + lift); c.mesh.rotation.z = -b.heading; c.mesh.scale.setScalar(b.locked ? 1.35 + Math.sin(this.t * 8) * 0.15 : 1);
      c.pin.position.set(x, y, 14 + (6 + lift) / 2); c.pin.scale.z = Math.max(1, 6 + lift);
    });
    for (let i = hud.radar.length; i < this.contacts.length; i++) this.contacts[i].mesh.visible = this.contacts[i].pin.visible = false;

    // target markers
    hud.targets.forEach((tg, i) => {
      const m = this.markers[i]; if (!m) return;
      m.group.visible = true;
      const p = this.ndcToWorld(tg.x, tg.y); m.group.position.set(p.x, p.y, 20);
      const col: PaletteKey = tg.locked ? "yellow" : tg.kind === "bomber" ? "orange" : tg.kind === "escort" ? "sky" : "white";
      m.lockScale.target = tg.locked ? 0.78 : 1; const ls = m.lockScale.update(dt);
      const size = (tg.kind === "bomber" ? 34 : 26) * s * ls;
      m.corners.forEach((c, ci) => { c.visible = tg.onScreen; c.material = mat(col); const sx = ci === 0 || ci === 3 ? -1 : 1, sy = ci < 2 ? 1 : -1; c.position.set(sx * size, sy * size, 0); c.scale.setScalar(s * (tg.locked ? 1.2 : 1)); });
      m.dart.visible = !tg.onScreen; m.dart.material = mat(col); m.dart.rotation.z = -tg.angle - Math.PI / 2; m.dart.scale.setScalar(s * (tg.locked ? 1.3 : 1));
      m.label.set(`${tg.dist}m${tg.onScreen && Math.abs(tg.dAlt) > 15 ? (tg.dAlt > 0 ? ` ▲${tg.dAlt}` : ` ▼${-tg.dAlt}`) : ""}`); m.label.position.y = -(size + 16); m.label.scale.multiplyScalar(s);
      m.group.rotation.z = tg.locked ? Math.sin(this.t * 5) * 0.06 : 0;
    });
    for (let i = hud.targets.length; i < this.markers.length; i++) this.markers[i].group.visible = false;

    // message (yell) with squash-and-stretch + bits
    if (hud.msgVisible && hud.msg !== this.lastMsg) { this.lastMsg = hud.msg; this.msgScale.set(0); this.msgScale.kick(40); this.msgBits.forEach((b, i) => { b.visible = true; b.userData = { a: (i / 8) * Math.PI * 2, t: 0 }; }); }
    if (!hud.msgVisible) { this.msgScale.target = 0; this.lastMsg = ""; } else this.msgScale.target = 1;
    const ms = this.msgScale.update(dt);
    this.msg.setText(hud.msg); this.at("tc", 0, this.h * (this.coarse ? 0.42 : 0.34) / s, this.msg);
    this.msg.scale.set(s * Math.max(0, ms) * (1 + this.msgScale.v * 0.004), s * Math.max(0, ms) * (1 - this.msgScale.v * 0.004), s); this.msg.rotation.z = -0.06; this.msg.visible = ms > 0.02;
    this.msgBits.forEach((b) => { if (!b.visible) return; const d = b.userData as { a: number; t: number }; d.t += dt; b.position.set(this.msg.position.x + Math.cos(d.a) * d.t * 260 * s, this.msg.position.y + Math.sin(d.a) * d.t * 180 * s - d.t * d.t * 300 * s, 30); b.scale.setScalar(s * Math.max(0, 1 - d.t * 1.4)); b.rotation.z += dt * 8; if (d.t > 0.7) b.visible = false; });

    // banner
    this.banner.visible = !!hud.waveBanner; if (hud.waveBanner) { this.banner.setText(hud.waveBanner); this.at("tc", 0, this.h * 0.24 / s, this.banner); this.bannerSpin.target = 0; if (this.bannerText !== hud.waveBanner) { this.bannerSpin.set(1.2); this.bannerText = hud.waveBanner; } this.banner.rotation.y = this.bannerSpin.update(dt); this.banner.scale.multiplyScalar(s); this.banner.rotation.z = 0.02; }

    // countdown / resume
    const cd = hud.countdown || (hud.resumeIn > 0 ? String(hud.resumeIn) : "");
    this.countdown.set(cd); if (cd && cd !== this.lastCountdown) { this.countdownDrop.set(-1); this.countdownDrop.kick(18); this.lastCountdown = cd; } if (!cd) this.lastCountdown = "";
    const cdp = this.countdownDrop.update(dt); this.countdown.position.set(0, this.h * 0.1 + cdp * 40, 40); this.countdown.scale.multiplyScalar(1); this.countdown.rotation.z = cdp * 0.1;

    // subtitle / caption / toast / muted
    this.subtitle.visible = !!hud.subtitle;
    if (hud.subtitle) { this.subtitle.setText(hud.subtitle.text); this.subtitleWho.material = mat(hud.subtitle.who === "enemy" ? "orange" : hud.subtitle.who === "tower" ? "sky" : "yellow"); this.at("bc", 0, this.coarse ? 175 : 110, this.subtitle); this.subtitle.scale.multiplyScalar(s * (this.coarse ? 0.7 : 1)); }
    this.caption.visible = !!hud.caption; if (hud.caption) { this.caption.setText(hud.caption); this.at("bc", 0, this.coarse ? 205 : 74, this.caption); this.caption.scale.multiplyScalar(s * 0.9); }
    this.toast.visible = !!hud.toast; if (hud.toast) { this.toast.setText(hud.toast); this.at("tc", 0, 160, this.toast); this.toast.scale.multiplyScalar(s); }
    this.muted.visible = hud.muted; if (hud.muted) { this.muted.setText("🔇 click or press a key for sound"); this.at("tl", 140, this.coarse ? 140 : 130, this.muted); this.muted.scale.multiplyScalar(s * 0.9); this.muted.rotation.z = -0.03; }
  }

  /** Hide everything (title / score card / intro). */
  setVisible(v: boolean) { this.scene.visible = v; }
}
