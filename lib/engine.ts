import * as THREE from "three";
import { groundHeight, isWater, isOnRunway, buildWorld, DETAIL, WORLD_RADIUS, type World } from "./terrain";
import { detectTier, isIOS, isTouch, type Tier } from "./device";
import { Hud3D } from "./ui/hud3d";
import { makePlane, makeZeppelin, LIVERIES, type PlaneModel } from "./models";
import { Sky, TIMES_OF_DAY, type TimeOfDay } from "./sky";
import { Fx, Ribbon } from "./fx";
import { Post } from "./post";
import { Audio, EnemyVoice } from "./audio";
import { Birds, WorldLife, Rain } from "./life";
import { t as tr, setLang } from "./i18n";
import { Input, Tilt, touchState } from "./input";
import { Rng, hashString, todayKey } from "./rng";
import { BIG_MOMENT_QUIET, TIERS, type Tier as JuiceTier } from "./tuning";
import { Fx as FxKit } from "./fx";
import { store, type EnemyKind, type Alert, type RadarBlip, type Target, type Objective, type Options } from "./store";
import { BOSS_BANNER, LEVELS, dailyLevel, getLevel, levelById, setLevel, starsFor } from "./levels";

const FWD = new THREE.Vector3(0, 0, -1);
const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);

const MAX_SPEED = 62;
const V_ROTATE = 30;
const V_FLOAT = 48;
const ROUND_TIME = 180;
const WAVE_TIME = 45;
const RADAR_RANGE = 400;
const TETHER = 420;
const FRENZY_AT = 5;
const FRENZY_TIME = 10;

const YELLS = ["CHOMP!", "NOM NOM!", "DELICIOUS!", "GULP!", "MMM, PLANE!", "TASTY!"];
const PALETTE = [0xe05a3a, 0x3a8be0, 0x4ac96b, 0xf2c53d, 0xb35ae0, 0xff8ad8, 0xff9a3a];

const KINDS: Record<EnemyKind, { speed: number; scale: number; hp: number; pts: number; flee: number; turn: number; food: number }> = {
  fighter: { speed: 30, scale: 0.8, hp: 1, pts: 100, flee: 120, turn: 1.4, food: 0.3 },
  escort: { speed: 30, scale: 0.8, hp: 1, pts: 150, flee: 110, turn: 1.3, food: 0.3 },
  bomber: { speed: 20, scale: 1.4, hp: 2, pts: 300, flee: 80, turn: 0.6, food: 0.5 },
};

type Enemy = {
  lastDist: number;
  kind: EnemyKind; model: PlaneModel; mesh: THREE.Group;
  pos: THREE.Vector3; q: THREE.Quaternion; speed: number; target: THREE.Vector3;
  roll: number; wob: number; color: number; hp: number;
  fleeTimer: number; fleeSide: number; spookTimer: number; alertTimer: number; biteCooldown: number; stamina: number;
  smokeAcc: number; leader: Enemy | null;
  rival?: boolean;
  chainId?: number; chainIndex?: number;
};

type Boss = {
  mesh: THREE.Group; weakPoints: THREE.Mesh[]; parts: THREE.Mesh[]; props: THREE.Group[];
  pos: THREE.Vector3; q: THREE.Quaternion; target: THREE.Vector3; hp: number; max: number; dropTimer: number; hitCooldown: number;
};

const OBJECTIVES: Array<{ id: string; text: string; target: number }> = [
  { id: "bombers", text: "Eat 3 bombers", target: 3 },
  { id: "low", text: "Eat a plane below 20 m", target: 1 },
  { id: "ten", text: "Eat 10 planes", target: 10 },
  { id: "combo4", text: "Reach a x4 combo", target: 1 },
  { id: "boost", text: "Eat 3 planes while boosting", target: 3 },
  { id: "pair", text: "Eat an escort pair within 5 s", target: 1 },
  { id: "clean", text: "Finish a wave without touching the ground", target: 1 },
  { id: "land", text: "Land on the runway mid-sortie", target: 1 },
];

const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

export class Engine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private sky: Sky;
  private world: World;
  private worldGroup!: THREE.Group;
  private builtLevel = "";
  private post: Post;
  private hud3d: Hud3D;
  private fx: Fx;
  private input: Input;
  private sound: Audio | null = null;
  private birds!: Birds;
  private life!: WorldLife;
  private rain!: Rain;
  private rainLevel = 0;
  private rainy = false;
  private wind = new THREE.Vector3();
  private nextTod: TimeOfDay = "noon";
  private voices = new Map<Enemy, EnemyVoice>();
  private tutorialStep = 0; private tutorialTimer = 0;
  private resumeIn = 0;
  private tilt = 0; private zoomPunch = 0;
  private lastRadio = new Map<string, number>();
  private subtitleTimer = 0; private captionTimer = 0;
  private raf = 0;
  private last = 0;
  private rng = new Rng(1);
  private dateKey = "";
  private timeOfDay: TimeOfDay = "noon";

  private model!: PlaneModel;
  private liveryIndex = -1;
  private introT = 0;
  private player = {
    mesh: new THREE.Group(), pos: new THREE.Vector3(), q: new THREE.Quaternion(),
    speed: 0, throttle: 0, boost: 1, jaw: 0, gearUp: 0, gulp: 0,
    state: "rolling" as "rolling" | "airborne",
  };
  private trails: Ribbon[] = [];
  private contrail!: Ribbon;
  private enemies: Enemy[] = [];
  private boss: Boss | null = null;
  private boss2: Boss | null = null;
  private crates: { mesh: THREE.Group; pos: THREE.Vector3; v: THREE.Vector3 }[] = [];
  private rivalLives = 0;

  // round
  private time = 0; private timeLeft = ROUND_TIME; private wave = 1; private waveTimer = WAVE_TIME;
  private score = 0; private eaten = 0; private eatenByKind = { fighter: 0, bomber: 0, escort: 0, boss: 0 };
  private combo = 0; private comboTimer = 0; private bestCombo = 0; private firstBite: number | null = null;
  private msg = ""; private msgTimer = 0; private waveBanner = ""; private waveBannerTimer = 0;
  private countdownT = 0; private countdownShown = ""; private spawnCooldown = 0;
  private objectives: Objective[] = [];
  private touchedGroundThisWave = false; private hasBeenAirborne = false; private lastEscortEat = -99;

  // feel
  private shake = 0; private hitStop = 0; private lunge = 0; private boostMeter = 1; private boosting = false;
  private hunger = 1; private frenzy = 0; private handsOff = 0; private autoRotate = 0; private bounceTimer = 0;
  private dustAcc = 0; private streakAcc = 0; private heartAcc = 0;
  private camQ = new THREE.Quaternion(); private titleAngle = 0;
  private frameEma = 0.016; private slowFor = 0; private autoDropped = 0;
  private lockRef: object | null = null;
  private crashTimer = 0; private crashPos = new THREE.Vector3(); private crashYaw = 0;
  private bigUntil = -99; private crashFade = 0;
  private wipeT = 0; private wipeDir = 0; private wipeAction: (() => void) | null = null;
  private menuHover = "";
  private pointer = { x: -1, y: -1 };
  private gForce = 0; private lastVel = new THREE.Vector3();
  private tier: Tier = "high";
  private tiltInput: Tilt | null = null;
  private toastTimer = 0;

  constructor(root: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    root.prepend(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.5, 5000);
    addEventListener("resize", this.onResize);

    this.tier = detectTier();
    const o0 = store.get().options;
    if (!o0.qualitySet) store.setOptions({ quality: this.tier, qualitySet: true, touch: o0.touch || isTouch() });
    this.sky = new Sky(this.scene);
    setLevel(levelById(store.get().levelId));
    this.worldGroup = new THREE.Group();
    this.scene.add(this.worldGroup);
    this.world = buildWorld(this.worldGroup as unknown as THREE.Scene, DETAIL[store.get().options.quality]);
    this.builtLevel = getLevel().id;
    this.fx = new Fx(this.scene);
    this.post = new Post(this.renderer, this.scene, this.camera);
    this.hud3d = new Hud3D();
    this.renderer.autoClear = false;
    this.input = new Input(this.renderer.domElement);
    this.renderer.domElement.addEventListener("pointermove", this.onMenuMove);
    this.renderer.domElement.addEventListener("pointerdown", this.onMenuClick);

    this.rng = new Rng(hashString("sharkplane:" + todayKey()));
    this.birds = new Birds(this.worldGroup as unknown as THREE.Scene, this.rng);
    this.life = new WorldLife(this.worldGroup as unknown as THREE.Scene, this.rng);
    this.rain = new Rain(this.scene);
    document.addEventListener("visibilitychange", this.onHidden);
    this.buildPlayer(store.get().options.livery);
    this.applyOptions(store.get().options);
    this.resetWorld();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);

  }

  /** Exposed as window.__game in dev / with ?debug — used by the headless test driver. */
  debugHandle() {
    const self = this; // eslint-disable-line @typescript-eslint/no-this-alias
    return { engine: this, player: this.player, get enemies() { return self.enemies; }, get score() { return self.score; }, get boss() { return self.boss; }, ground: groundHeight, get phase() { return store.get().phase; }, get hud() { return store.get().hud; } };
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    removeEventListener("resize", this.onResize);
    document.removeEventListener("visibilitychange", this.onHidden);
    removeEventListener("pointerdown", this.kickAudio); removeEventListener("keydown", this.kickAudio); removeEventListener("touchend", this.kickAudio);
    this.renderer.domElement.removeEventListener("pointermove", this.onMenuMove);
    this.renderer.domElement.removeEventListener("pointerdown", this.onMenuClick);
    this.tiltInput?.dispose();
    this.input.dispose();
    this.sound?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private buildPlayer(liveryIndex: number) {
    this.liveryIndex = Math.min(liveryIndex, LIVERIES.length - 1);
    if (this.model) this.scene.remove(this.model.group);
    for (const t of this.trails) t.dispose(this.scene);
    this.contrail?.dispose(this.scene);
    this.model = makePlane(0, { livery: LIVERIES[Math.min(liveryIndex, LIVERIES.length - 1)] });
    this.player.mesh = this.model.group;
    this.scene.add(this.player.mesh);
    this.trails = [new Ribbon(this.scene, 40, 0.25, new THREE.Color(0xffffff)), new Ribbon(this.scene, 40, 0.25, new THREE.Color(0xffffff))];
    this.contrail = new Ribbon(this.scene, 140, 0.7, new THREE.Color(0xcfd8e0));
  }

  // ---------- phase control ----------
  startRound() {
    this.ensureSound();
    this.rebuildWorld();
    this.resetWorld();
    this.introT = 0;
    this.camQ.identity();
    this.tiltInput?.calibrate();
    if (this.sound) { this.sound.music.play("play"); this.sound.music.intensity = 0; }
    store.set({ phase: "intro", menuPage: "main" });
  }
  private beginCountdown() {
    this.countdownT = 3.2; this.countdownShown = "";
    store.setHud({ intro: null });
    store.set({ phase: "countdown" });
  }
  pause() { if (store.get().phase !== "playing") return; this.sound?.suspend(); store.set({ phase: "paused", menuPage: "main" }); }
  resume() {
    if (store.get().phase !== "paused") return;
    this.sound?.resume(); this.last = performance.now();
    this.resumeIn = 3; // 3-2-1 so you're not eaten blind
    store.set({ phase: "playing" });
  }
  restart() { this.sound?.resume(); this.wipe(() => this.startRound()); }
  quitToTitle() { this.sound?.resume(); this.wipe(() => { this.resetWorld(); store.set({ phase: "title", menuPage: "main" }); this.sound?.music.play("title"); }); }

  /** Everything passes through the mouth: jaws snap shut, the action happens, jaws open. */
  private wipe(action: () => void) {
    if (this.wipeDir !== 0) { this.wipeAction = action; return; }
    this.wipeAction = action; this.wipeDir = 1;
    this.sound?.bite();
  }

  applyOptions(o: Options) {
    this.sound?.setVolumes({ master: o.volume, music: o.music, sfx: o.sfx, ui: o.ui });
    setLang(o.lang);
    const q = o.quality;
    this.renderer.shadowMap.enabled = q === "high";
    this.sky.setShadows(q === "high");
    this.post.enabled = q !== "low";
    this.post.setBloomResolution(q === "high" ? 1 : 0.5);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, q === "high" ? 1.5 : q === "medium" ? 1.25 : 1));
    this.onResize();
    if (o.touch && o.scheme === "tilt") { if (!this.tiltInput) this.tiltInput = new Tilt(); this.tiltInput.enabled = true; } else if (this.tiltInput) this.tiltInput.enabled = false;
    if (Math.min(o.livery, LIVERIES.length - 1) !== this.liveryIndex) {
      this.buildPlayer(o.livery);
      this.player.mesh.position.copy(this.player.pos); this.player.mesh.quaternion.copy(this.player.q);
    }
  }

  private onHidden = () => { if (document.hidden && store.get().phase === "playing") this.pause(); };
  private menuItems(): { id: string; label: string; primary?: boolean }[] {
    const phase = store.get().phase;
    if (phase === "title") {
      if (store.get().menuPage === "levels") {
        const stars = store.totalStars();
        const daily = dailyLevel(todayKey(), LEVELS.filter((l) => l.unlockStars <= stars).length);
        const items: { id: string; label: string; primary?: boolean; sub?: string; locked?: boolean }[] = LEVELS.map((l) => {
          const rec = store.get().progress.levels[l.id];
          const locked = l.unlockStars > stars;
          return { id: `level:${l.id}`, label: l.name, sub: locked ? `LOCKED · ${l.unlockStars}★ NEEDED` : `${"★".repeat(rec?.stars ?? 0)}${"☆".repeat(3 - (rec?.stars ?? 0))}${rec?.bestScore ? ` · BEST ${rec.bestScore}` : ""}`, locked, primary: !locked && !(rec?.stars) };
        });
        items.push({ id: "daily", label: `DAILY · ${daily.name}`, sub: todayKey() });
        items.push({ id: "back", label: tr("back") });
        return items;
      }
      return [{ id: "sortie", label: tr("sortie"), primary: true }, { id: "controls", label: tr("controls") }, { id: "options", label: tr("options") }];
    }
    return [{ id: "resume", label: tr("resume"), primary: true }, { id: "restart", label: tr("restart") }, { id: "controls", label: tr("controls") }, { id: "options", label: tr("options") }, { id: "quit", label: tr("quit") }];
  }
  private menuActive() { const ph = store.get().phase; const pg = store.get().menuPage; return (ph === "title" && (pg === "main" || pg === "levels")) || (ph === "paused" && pg === "main"); }
  /** Activate a 3-D menu button (also used by the keyboard mirror + e2e). */
  menuAction(id: string) {
    this.hud3d.pressMenu(id);
    if (id === "sortie") { this.ui("confirm"); store.set({ menuPage: "levels" }); }
    else if (id === "back") { this.ui("back"); store.set({ menuPage: "main" }); }
    else if (id === "daily") { this.ui("confirm"); const stars = store.totalStars(); const lvl = dailyLevel(todayKey(), LEVELS.filter((l) => l.unlockStars <= stars).length); store.set({ levelId: lvl.id, daily: true, menuPage: "main" }); this.wipe(() => this.startRound()); }
    else if (id.startsWith("level:")) {
      const lvl = levelById(id.slice(6));
      if (lvl.unlockStars > store.totalStars()) { this.sound?.back(); return; }
      this.ui("confirm"); store.set({ levelId: lvl.id, daily: false, menuPage: "main" });
      this.wipe(() => this.startRound());
    }
    else if (id === "resume") { this.ui("confirm"); this.resume(); }
    else if (id === "restart") { this.ui("confirm"); this.restart(); }
    else if (id === "quit") { this.ui("back"); this.quitToTitle(); }
    else if (id === "controls" || id === "options") { this.ui("confirm"); store.set({ menuPage: id }); }
  }
  setMenuHover(id: string) { if (id !== this.menuHover) { this.menuHover = id; if (id) this.sound?.hover(); } }
  private onMenuMove = (e: PointerEvent) => {
    this.pointer.x = e.clientX; this.pointer.y = e.clientY;
    if (!this.menuActive()) return;
    const id = this.hud3d.pickMenu(e.clientX, e.clientY) ?? "";
    this.renderer.domElement.style.cursor = id ? "pointer" : "";
    this.setMenuHover(id);
  };
  private onMenuClick = (e: PointerEvent) => {
    if (!this.menuActive()) return;
    const id = this.hud3d.pickMenu(e.clientX, e.clientY);
    if (id) this.menuAction(id);
  };

  /** Tear down and rebuild the whole island for a different level. Runs behind the jaw-wipe. */
  private rebuildWorld() {
    const id = store.get().levelId;
    if (id === this.builtLevel) return;
    setLevel(levelById(id));
    this.scene.remove(this.worldGroup);
    this.worldGroup.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose()); else mat?.dispose();
    });
    this.worldGroup = new THREE.Group();
    this.scene.add(this.worldGroup);
    const g = this.worldGroup as unknown as THREE.Scene;
    this.world = buildWorld(g, DETAIL[store.get().options.quality]);
    this.birds = new Birds(g, new Rng(hashString("birds:" + id)));
    this.life = new WorldLife(g, new Rng(hashString("life:" + id)));
    this.builtLevel = id;
  }

  private ensureSound() {
    if (this.sound) { this.sound.resume(); return; }
    void isIOS; void touchState;
    const o = store.get().options;
    this.sound = new Audio({ master: o.volume, music: o.music, sfx: o.sfx, ui: o.ui });
    addEventListener("pointerdown", this.kickAudio); addEventListener("keydown", this.kickAudio); addEventListener("touchend", this.kickAudio); // iOS unlocks on touchend
    this.sound.onCaption = (c) => { if (store.get().options.captions) { store.setHud({ caption: c.text }); this.captionTimer = 1.5; } };
  }
  /** UI feedback from the menus. Hover never creates the context (autoplay policy would leave it suspended). */
  ui(kind: "hover" | "confirm" | "back") {
    if (kind === "hover") { this.sound?.hover(); return; }
    this.ensureSound(); this.sound![kind]();
  }
  /** Any user gesture resumes a suspended context (browsers suspend it until the first real interaction). */
  private kickAudio = () => { if (this.sound && this.sound.ctx.state !== "running" && store.get().phase !== "paused") this.sound.resume(); };
  /** Radio line with a cooldown per key so it never nags. */
  private radio(key: Parameters<typeof tr>[0], cooldown = 12) {
    const now = this.time;
    if (now < this.bigUntil && !key.startsWith("t_") && key !== "r_bossDown" && key !== "r_frenzy") return; // don't talk over the big moment
    if ((this.lastRadio.get(key) ?? -99) + cooldown > now) return;
    this.lastRadio.set(key, now);
    const text = tr(key);
    const who = text.startsWith("Tower") || text.startsWith("Turn") ? "tower" : text.startsWith("Enemy") || text.startsWith("Óvinur") ? "enemy" : "you";
    this.sound?.radio.say(who, text, (w, txt) => { store.setHud({ subtitle: { who: w, text: txt } }); this.subtitleTimer = 3.5; });
  }
  private onResize = () => {
    this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight); this.post.resize();
    const css = getComputedStyle(document.documentElement);
    const safe = (k: string) => parseFloat(css.getPropertyValue(`--safe-${k}`)) || 0;
    this.hud3d.resize(innerWidth, innerHeight, isTouch() || innerHeight < 520, { t: safe("t"), r: safe("r"), b: safe("b"), l: safe("l") });
  };

  private resetWorld() {
    this.dateKey = todayKey();
    this.rng = new Rng(hashString("sharkplane:" + this.dateKey));
    const level = getLevel();
    this.timeOfDay = this.rng.pick(level.times as unknown as TimeOfDay[]);
    this.nextTod = TIMES_OF_DAY[(TIMES_OF_DAY.indexOf(this.timeOfDay) + 1) % TIMES_OF_DAY.length];
    this.rainy = this.rng.next() < level.rainChance;
    this.rainLevel = 0; this.rain.intensity = 0;
    const wa = this.rng.range(0, Math.PI * 2), ws = this.rng.range(2, 7);
    this.wind.set(Math.cos(wa) * ws, 0, Math.sin(wa) * ws);
    if (getLevel().gimmick === "gusts") this.wind.set(0.707 * 14, 0, 0.707 * 14); // down the fjords, and it means it
    this.sky.apply(this.timeOfDay);
    for (const v of this.voices.values()) v.dispose();
    this.voices.clear();
    this.tutorialStep = store.get().options.tutorialDone ? 99 : 0; this.tutorialTimer = 0;
    this.resumeIn = 0; this.tilt = 0; this.zoomPunch = 0; this.lastRadio.clear();
    this.crashTimer = 0; this.player.mesh.visible = true;
    store.setHud({ subtitle: null, caption: "", weather: this.rainy ? "rain" : "clear", resumeIn: 0 });

    const p = this.player;
    p.pos.set(0, groundHeight(0, 20) + 1.7, 20); p.q.identity(); p.speed = 0; p.throttle = 0; p.boost = 1; p.jaw = 0; p.gearUp = 0; p.gulp = 0; p.state = "rolling";
    p.mesh.position.copy(p.pos); p.mesh.quaternion.copy(p.q); p.mesh.scale.setScalar(1);
    for (const t of this.trails) t.reset(p.pos); this.contrail.reset(p.pos);
    for (const e of this.enemies) this.scene.remove(e.mesh);
    this.enemies = [];
    this.removeBoss();
    this.fx.clear();
    this.time = 0; this.timeLeft = getLevel().roundTime; this.wave = 1; this.waveTimer = WAVE_TIME;
    this.score = 0; this.eaten = 0; this.eatenByKind = { fighter: 0, bomber: 0, escort: 0, boss: 0 };
    this.combo = 0; this.comboTimer = 0; this.bestCombo = 0; this.firstBite = null;
    this.msg = ""; this.msgTimer = 0; this.waveBanner = ""; this.waveBannerTimer = 0;
    this.shake = 0; this.hitStop = 0; this.lunge = 0; this.boostMeter = 1; this.boosting = false; this.hunger = 1; this.frenzy = 0;
    this.handsOff = 0; this.autoRotate = 0; this.bounceTimer = 0; this.spawnCooldown = 0;
    this.touchedGroundThisWave = false; this.hasBeenAirborne = false; this.lastEscortEat = -99;
    this.camQ.identity();
    this.camera.position.set(0, 8, 40);
    this.post.setTint(new THREE.Color(0xff5d2e), 0);

    // two daily objectives
    const pool = [...OBJECTIVES];
    this.objectives = [0, 1].map(() => {
      const o = pool.splice(Math.floor(this.rng.next() * pool.length), 1)[0];
      return { ...o, progress: 0, done: false };
    });

    // three slow bait fighters lined up off the runway end
    for (let i = 0; i < 3; i++) {
      const e = this.spawnEnemy(true, "fighter");
      const bx = (i - 1) * 40, bz = -320 - i * 90;
      e.pos.set(bx, groundHeight(bx, bz) + 40 + i * 8, bz);
      e.speed = 22;
      e.target.set((i - 1) * 60, 45, -900);
      e.q.setFromUnitVectors(FWD, e.target.clone().sub(e.pos).normalize());
    }
    for (let i = 3; i < this.populationTarget(); i++) this.spawnEnemy(true);
  }

  // ---------- objectives ----------
  private objective(id: string, add = 1) {
    const o = this.objectives.find((x) => x.id === id);
    if (!o || o.done) return;
    o.progress = Math.min(o.target, o.progress + add);
    if (o.progress >= o.target) { o.done = true; this.score += 500; this.showMsg("OBJECTIVE ✓"); this.sound?.fanfare(); }
  }

  // ---------- enemies ----------
  private populationTarget() { const w = getLevel().waves; return w.base + w.perWave * (this.wave - 1); }
  private pickKind(): EnemyKind {
    const w = getLevel().waves;
    const r = Math.random();
    if (this.wave >= w.escortFrom && r < 0.25) return "escort";
    if (this.wave >= w.bomberFrom && r < 0.5) return "bomber";
    return "fighter";
  }
  private pickTarget(e: { pos: THREE.Vector3; target: THREE.Vector3 }) {
    const x = THREE.MathUtils.clamp(e.pos.x + (Math.random() - 0.5) * 700, -1300, 1300);
    const z = THREE.MathUtils.clamp(e.pos.z + (Math.random() - 0.5) * 700, -1300, 1300);
    e.target.set(x, groundHeight(x, z) + 50 + Math.random() * 100, z);
  }

  private spawnEnemy(nearPlayer: boolean, kind: EnemyKind = this.pickKind(), leader: Enemy | null = null, at?: THREE.Vector3): Enemy {
    const k = KINDS[kind];
    const colorIndex = Math.floor(Math.random() * PALETTE.length);
    const color = PALETTE[colorIndex];
    const model = makePlane(colorIndex, { kind });
    model.group.scale.setScalar(k.scale);
    const e: Enemy = {
      kind, model, mesh: model.group, pos: new THREE.Vector3(), q: new THREE.Quaternion(),
      speed: k.speed * getLevel().waves.enemySpeed * (1 + 0.05 * (this.wave - 1)) * (0.9 + Math.random() * 0.2),
      target: new THREE.Vector3(), roll: 0, wob: Math.random() * 10, color, hp: k.hp,
      fleeTimer: 0, fleeSide: 1, spookTimer: 0, alertTimer: 0, biteCooldown: 0, stamina: 3, smokeAcc: 0, leader, lastDist: 1e9,
    };
    if (at) e.pos.copy(at);
    else if (leader) e.pos.copy(leader.pos).add(new THREE.Vector3(12, 2, 8));
    else {
      const a = Math.random() * Math.PI * 2, r = nearPlayer ? 150 + Math.random() * 200 : 350 + Math.random() * 250;
      e.pos.set(this.player.pos.x + Math.cos(a) * r, 0, this.player.pos.z + Math.sin(a) * r);
      e.pos.y = groundHeight(e.pos.x, e.pos.z) + 30 + Math.random() * 50;
    }
    this.pickTarget(e);
    e.q.setFromUnitVectors(FWD, e.target.clone().sub(e.pos).normalize());
    this.scene.add(e.mesh);
    this.enemies.push(e);
    if (this.sound && this.voices.size < 8) this.voices.set(e, new EnemyVoice(this.sound.ctx, this.sound["buses"].sfx, kind));
    if (kind === "escort" && !leader) this.spawnEnemy(nearPlayer, "escort", e);
    return e;
  }

  private chainSeq = 0;
  /** A cargo convoy: four planes in a line. Eat the tail-most survivor for a chain bonus. */
  private spawnConvoy() {
    const id = ++this.chainSeq;
    let leader: Enemy | null = null;
    for (let i = 0; i < 4; i++) {
      const e = this.spawnEnemy(true, "fighter", leader);
      e.chainId = id; e.chainIndex = i; e.speed = 22; e.stamina = 0.5;
      leader = e;
    }
  }

  private updateEnemies(dt: number) {
    const p = this.player;
    const pf = FWD.clone().applyQuaternion(p.q);
    const mouth = p.pos.clone().addScaledVector(pf, 4.5);
    let nearestAhead = Infinity;
    const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion();

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      const k = KINDS[e.kind];
      if (e.leader && !this.enemies.includes(e.leader)) e.leader = null;
      const toP = p.pos.clone().sub(e.pos);
      const dist = toP.length();
      if (dist > 900) {
        this.dropEnemy(e, i);
        this.spawnEnemy(true, e.kind === "escort" ? "fighter" : e.kind);
        continue;
      }
      const eFwd = FWD.clone().applyQuaternion(e.q);
      const playerBehind = eFwd.dot(toP.clone().normalize()) < -0.5;

      e.fleeTimer -= dt; e.spookTimer -= dt; e.alertTimer -= dt; e.biteCooldown -= dt;
      const threatened = dist < k.flee && playerBehind;
      e.stamina = THREE.MathUtils.clamp(e.stamina + (threatened ? -dt : dt * 0.5), -4, 3);
      const tired = e.stamina <= 0;
      if (threatened && !tired && e.fleeTimer <= -1.5 && e.spookTimer <= 0) {
        e.fleeTimer = 1.0; e.fleeSide = Math.random() < 0.5 ? -1 : 1; e.alertTimer = 1.0;
        if (Math.random() < 0.1) e.spookTimer = 1.2;
        this.sound?.yelp(e.pos);
        this.radio(e.leader || this.enemies.some((o) => o.leader === e) ? "r_enemyPair" : "r_enemySpot", 25);
      }

      let desired: THREE.Vector3;
      let turnRate = k.turn;
      if (e.rival) {
        // the rival hunts your prey — and eats it in front of you
        let prey: Enemy | null = null, pd = 1e9;
        for (const o of this.enemies) { if (o === e || o.rival) continue; const d2 = o.pos.distanceToSquared(e.pos); if (d2 < pd) { pd = d2; prey = o; } }
        if (prey && Math.sqrt(pd) < 9) { this.dropEnemy(prey, this.enemies.indexOf(prey)); this.fx.burst(prey.pos, FxKit.tintsOf(prey.model.parts), 10, 0.7); this.sound?.crash(prey.pos); this.showMsg("KILL STOLEN!"); }
        desired = prey ? prey.pos.clone().sub(e.pos).normalize() : toP.clone().normalize();
        if (dist < 70 && playerBehind) { const away = e.pos.clone().sub(p.pos).normalize(); desired.lerp(away, 0.7).normalize(); }
        turnRate = 2.2;
      } else if (e.spookTimer > 0) {
        desired = toP.clone().normalize(); turnRate = k.turn * 1.5;
      } else if (e.fleeTimer > 0) {
        const away = e.pos.clone().sub(p.pos).normalize();
        const side = RIGHT.clone().applyQuaternion(e.q).multiplyScalar(e.fleeSide);
        desired = away.add(side.multiplyScalar(1.2)).setY(away.y + 0.3).normalize(); turnRate = k.turn * 1.5;
      } else if (threatened && !tired) {
        desired = e.pos.clone().sub(p.pos).normalize();
        desired.y += 0.15; desired.x += Math.sin(this.time * 2 + e.wob) * 0.5; desired.normalize();
      } else if (tired) {
        desired = eFwd.clone().setY(-0.05).normalize(); turnRate = k.turn * 0.4;
      } else if (dist > TETHER) {
        desired = p.pos.clone().addScaledVector(pf, 120).sub(e.pos).normalize();
      } else if (e.leader) {
        const lf = FWD.clone().applyQuaternion(e.leader.q), lr = RIGHT.clone().applyQuaternion(e.leader.q);
        const slot = e.leader.pos.clone().addScaledVector(lr, 14 + Math.sin(this.time * 1.3 + e.wob) * 8).addScaledVector(lf, -10);
        desired = slot.sub(e.pos).normalize();
        e.speed = THREE.MathUtils.lerp(e.speed, e.leader.speed * (slot.length() > 30 ? 1.25 : 1), dt);
      } else {
        if (e.pos.distanceTo(e.target) < 50) this.pickTarget(e);
        desired = e.target.clone().sub(e.pos).normalize();
      }
      // terrain avoidance: look ahead along the flight path, pull up before the ground arrives
      const gh = groundHeight(e.pos.x, e.pos.z);
      let ghAhead = gh;
      for (const secs of [1, 2.5, 4]) {
        const look = e.pos.clone().addScaledVector(eFwd, e.speed * secs);
        ghAhead = Math.max(ghAhead, groundHeight(look.x, look.z));
      }
      const clearance = e.pos.y - ghAhead;
      const span = 7 * k.scale; // half wingspan-ish: keep the whole airframe clear, not just the centre
      if (clearance < 18 + span) {
        // emergency pull-up: forget everything else
        desired = eFwd.clone().setY(0).normalize().multiplyScalar(0.5).setY(1);
        turnRate = k.turn * 3;
      } else if (clearance < 50 + span) {
        desired.y += (50 + span - clearance) / 50 * 1.5 + 0.3;
        turnRate = Math.max(turnRate, k.turn * 1.5);
      }
      if (e.pos.y > 260) desired.y -= 0.5;
      desired.normalize();
      tmpM.lookAt(new THREE.Vector3(), desired, UP); // eye→target puts -Z (our nose) on `desired`
      tmpQ.setFromRotationMatrix(tmpM);
      e.q.slerp(tmpQ, Math.min(1, turnRate * dt));
      const after = FWD.clone().applyQuaternion(e.q);
      const yawDelta = eFwd.clone().setY(0).cross(after.clone().setY(0)).y;
      e.roll = THREE.MathUtils.lerp(e.roll, (-yawDelta / Math.max(dt, 1e-4)) * 1.2, dt * 4);
      e.pos.addScaledVector(after, e.speed * (tired ? 0.8 : 1) * dt);
      // hit the ground or the sea: crash
      // any part of the airframe touching terrain or water is a crash — sample the centre and both wingtips
      const eRight = RIGHT.clone().applyQuaternion(e.q).multiplyScalar(6 * k.scale);
      const lowest = Math.min(
        e.pos.y - groundHeight(e.pos.x, e.pos.z),
        e.pos.y + eRight.y - groundHeight(e.pos.x + eRight.x, e.pos.z + eRight.z),
        e.pos.y - eRight.y - groundHeight(e.pos.x - eRight.x, e.pos.z - eRight.z),
      );
      const overLava = getLevel().lava && isWater(e.pos.x, e.pos.z);
      if (lowest < 1.2 * k.scale || (overLava && e.pos.y < 3)) { this.crash(e, i, threatened || e.fleeTimer > 0 || e.spookTimer > 0); continue; }
      const toE = e.pos.clone().sub(p.pos);
      if (e.biteCooldown <= 0 && dist < 30 && pf.dot(toE.normalize()) > 0.75) e.pos.lerp(mouth, damp(4, dt));
      e.mesh.position.copy(e.pos);
      e.mesh.quaternion.copy(e.q).multiply(new THREE.Quaternion().setFromAxisAngle(FWD, THREE.MathUtils.clamp(e.roll, -1, 1)));
      e.model.prop.rotation.z += 25 * dt;
      for (const c of e.mesh.children) if (c.name === "nacelleProp") c.rotation.z += 25 * dt;
      e.model.setScared?.(e.alertTimer > 0 || threatened);
      if (e.hp < k.hp) { e.smokeAcc += dt; if (e.smokeAcc > 0.14) { e.smokeAcc = 0; this.fx.smoke(e.pos.clone().addScaledVector(after, -3)); } }

      const ahead = pf.dot(e.pos.clone().sub(p.pos));
      if (ahead > 0 && dist < nearestAhead) nearestAhead = dist;
      // near miss: passed within 9 m without a bite → sparks + zing
      if (e.lastDist < 9 && dist > e.lastDist && e.biteCooldown <= 0 && dist < 12) { this.fx.sparks(e.pos.clone().lerp(p.pos, 0.5)); this.sound?.spark(e.pos); e.lastDist = 1e9; } else e.lastDist = dist;
      const voice = this.voices.get(e);
      if (voice && this.sound) { const radial = after.clone().multiplyScalar(e.speed).sub(pf.clone().multiplyScalar(p.speed)).dot(toP.clone().normalize()); voice.update(this.sound.spatial(e.pos, 350), radial, e.alertTimer > 0); }
      if (e.biteCooldown <= 0 && mouth.distanceTo(e.pos) < 7 + 2 * k.scale) this.bite(e, i);
      if (e.rival) { e.stamina = 99; e.fleeTimer = -9; }
    }

    p.jaw = THREE.MathUtils.lerp(p.jaw, nearestAhead < 40 || (this.boss && this.boss.pos.distanceTo(p.pos) < 60) ? 1 : 0, dt * 6);
    if (this.model.jaw) this.model.jaw.rotation.x = -p.jaw * 0.55;

    this.spawnCooldown -= dt;
    if (this.enemies.length < this.populationTarget() && this.spawnCooldown <= 0) {
      if (getLevel().gimmick === "convoy" && Math.random() < 0.45 && this.enemies.length + 4 <= this.populationTarget() + 3) this.spawnConvoy();
      else this.spawnEnemy(true);
      this.spawnCooldown = 1.5;
    }
  }

  private feed(pts: number, food: number, kind: EnemyKind | "boss", at: THREE.Vector3) {
    const p = this.player;
    this.combo = this.comboTimer > 0 ? this.combo + 1 : 1;
    this.comboTimer = 4;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    if (this.combo >= 4) this.objective("combo4");
    if (this.combo === FRENZY_AT && this.frenzy <= 0) { this.frenzy = FRENZY_TIME; this.showMsg("FEEDING FRENZY!"); this.sound?.frenzy(); this.radio("r_frenzy", 5); }
    if (this.firstBite === null) this.firstBite = this.time;
    this.score += pts * this.combo * (this.frenzy > 0 ? 2 : 1);
    this.eaten++; this.eatenByKind[kind]++;
    this.hunger = Math.min(1, this.hunger + food);
    this.boostMeter = Math.min(1, this.boostMeter + 0.5);
    this.objective("ten");
    if (kind === "bomber") this.objective("bombers");
    if (this.boosting) this.objective("boost");
    if (at.y - groundHeight(at.x, at.z) < 20) this.objective("low");
    if (kind === "escort") { if (this.time - this.lastEscortEat < 5) this.objective("pair"); this.lastEscortEat = this.time; }
    const tier: JuiceTier = kind === "boss" || this.combo >= FRENZY_AT ? "milestone" : kind === "bomber" || this.combo >= 3 ? "notable" : "routine";
    const T = TIERS[tier];
    if (T.yell) this.showMsg(YELLS[Math.floor(Math.random() * YELLS.length)] + (this.combo > 1 ? ` x${this.combo}` : ""));
    else if (this.combo > 1) this.showMsg(`x${this.combo}`);
    if (tier === "milestone") this.bigUntil = this.time + BIG_MOMENT_QUIET;
    const combo = this.combo, snd = this.sound;
    snd?.music.onNextEighth(() => snd.chomp(kind, combo));
    this.input.rumble(T.rumble[0], T.rumble[1], T.rumble[2]);
    if (this.eaten === 1) this.radio("r_firstEat", 60); else if (this.combo >= 3) this.radio("r_combo", 30);
    if (kind === "boss") this.radio("r_bossDown", 5);
    if (this.tutorialStep === 3) { this.tutorialStep = 4; this.tutorialTimer = 0; }
    p.jaw = 1.5; p.gulp = Math.min(2, p.gulp + 1);
    p.speed = Math.min(p.speed + 8, MAX_SPEED * 1.6);
    this.shake = Math.max(this.shake, T.shake); this.hitStop = T.hitStop;
  }

  private bite(e: Enemy, index: number) {
    const k = KINDS[e.kind];
    e.hp -= 1;
    if (e.rival && e.hp <= 0) {
      this.fx.shred(e.model.parts, e.mesh, 1.4);
      this.dropEnemy(e, index);
      this.rivalLives--;
      if (this.rivalLives > 0) {
        this.showMsg(`RIVAL DOWN — ${this.rivalLives} MORE`);
        this.feed(400, 0.6, "bomber", e.pos);
        setTimeout(() => { if (store.get().phase === "playing") this.spawnRivalBody(); }, 4000);
      } else {
        this.feed(1200, 1, "boss", e.pos);
        this.showMsg("RIVAL DEVOURED!");
        this.sound?.music.play("play");
      }
      return;
    }
    if (e.hp > 0) {
      this.fx.burst(e.pos, FxKit.tintsOf(e.model.parts), 12, 0.6);
      e.speed *= 0.7; e.alertTimer = 1; e.biteCooldown = 1.0;
      e.pos.addScaledVector(RIGHT.clone().applyQuaternion(this.player.q), (Math.random() < 0.5 ? -1 : 1) * 8).y += 3;
      this.score += 50; this.showMsg("BITE!"); this.sound?.bite(); this.sound?.ow(e.pos); this.input.rumble(0.4, 0.6, 120);
      this.shake = Math.max(this.shake, 0.4); this.hitStop = 0.05;
      return;
    }
    this.fx.shred(e.model.parts, e.mesh, k.scale);
    const chainBonus = e.chainId !== undefined && !this.enemies.some((o) => o !== e && o.chainId === e.chainId && (o.chainIndex ?? 0) > (e.chainIndex ?? 0));
    this.dropEnemy(e, index);
    this.feed(k.pts, k.food, e.kind, e.pos);
    if (chainBonus && e.chainId !== undefined) { this.score += 150; this.showMsg("CABOOSE! +150"); this.sound?.fanfare(); }
  }

  private crash(e: Enemy, index: number, yourFault: boolean) {
    const k = KINDS[e.kind];
    e.pos.y = groundHeight(e.pos.x, e.pos.z) + 1;
    if (isWater(e.pos.x, e.pos.z)) this.fx.splash(e.pos, 20);
    this.fx.shred(e.model.parts, e.mesh, k.scale);
    this.fx.slick(e.pos);
    this.fx.chute(e.pos.clone().add(new THREE.Vector3(0, 6, 0)));
    this.dropEnemy(e, index);
    this.sound?.crash(e.pos);
    if (yourFault) { this.score += 25; this.showMsg("CRASHED!"); this.radio("r_crash", 20); }
  }
  private dropEnemy(e: Enemy, index: number) {
    this.scene.remove(e.mesh);
    this.enemies.splice(index, 1);
    this.voices.get(e)?.dispose(); this.voices.delete(e);
  }

  // ---------- boss ----------
  private makeBossAt(offsetAngle: number): Boss {
    const z = makeZeppelin();
    const a = Math.random() * Math.PI * 2 + offsetAngle;
    const pos = this.player.pos.clone().add(new THREE.Vector3(Math.cos(a) * 350, 60, Math.sin(a) * 350));
    pos.y = groundHeight(pos.x, pos.z) + 90;
    const b: Boss = { mesh: z.group, weakPoints: z.weakPoints, parts: z.parts, props: z.props, pos, q: new THREE.Quaternion(), target: new THREE.Vector3(), hp: z.weakPoints.length, max: z.weakPoints.length, dropTimer: 4, hitCooldown: 0 };
    this.pickTarget(b);
    if (getLevel().boss === "blimp") {
      const beam = new THREE.Mesh(new THREE.ConeGeometry(9, 120, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff1b0, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
      beam.position.set(0, -66, -2); z.group.add(beam);
    }
    this.scene.add(z.group);
    return b;
  }
  private spawnBoss() {
    const kind = getLevel().boss;
    if (kind === "rival") { this.spawnRival(); return; }
    this.boss = this.makeBossAt(0);
    if (kind === "twin") this.boss2 = this.makeBossAt(Math.PI * 0.5);
    this.waveBanner = BOSS_BANNER[kind];
    this.waveBannerTimer = 3; this.sound?.horn(); this.sound?.music.play("boss"); this.radio("r_boss", 5);
  }
  private spawnRivalBody() {
    const e = this.spawnEnemy(true, "fighter");
    e.rival = true; e.hp = 3; e.speed = 46 + (3 - this.rivalLives) * 4; e.stamina = 99;
    this.scene.remove(e.mesh);
    const m = makePlane(0, { livery: LIVERIES[LIVERIES.length - 1] });
    m.group.scale.setScalar(1.0 + (3 - this.rivalLives) * 0.18);
    e.model = m; e.mesh = m.group; this.scene.add(e.mesh);
    this.waveBanner = "IT'S BACK — BIGGER"; this.waveBannerTimer = 2.5; this.sound?.horn();
  }
  private spawnRival() {
    this.rivalLives = 3;
    this.spawnRivalBody();
    this.waveBanner = "RIVAL SHARK INBOUND"; this.waveBannerTimer = 3; this.sound?.horn(); this.sound?.music.play("boss"); this.radio("r_boss", 5);
  }
  private removeBoss() {
    if (this.boss) { this.scene.remove(this.boss.mesh); this.boss = null; }
    if (this.boss2) { this.scene.remove(this.boss2.mesh); this.boss2 = null; }
    for (const c of this.crates) this.scene.remove(c.mesh);
    this.crates = [];
  }

  private updateBoss(dt: number) {
    for (const b of [this.boss, this.boss2]) if (b) this.updateOneBoss(b, dt);
    this.updateCrates(dt);
  }
  private updateOneBoss(b: Boss, dt: number) {
    const p = this.player;
    if (b.pos.distanceTo(b.target) < 60 || b.pos.distanceTo(p.pos) > TETHER) b.target.copy(p.pos).add(new THREE.Vector3((Math.random() - 0.5) * 300, 70, (Math.random() - 0.5) * 300));
    const desired = b.target.clone().sub(b.pos).normalize();
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), desired, UP);
    b.q.slerp(new THREE.Quaternion().setFromRotationMatrix(m), Math.min(1, 0.3 * dt));
    b.pos.addScaledVector(FWD.clone().applyQuaternion(b.q), 12 * dt);
    b.pos.y = Math.max(b.pos.y, groundHeight(b.pos.x, b.pos.z) + 50);
    b.mesh.position.copy(b.pos); b.mesh.quaternion.copy(b.q);
    for (const pr of b.props) pr.rotation.z += 10 * dt;
    b.dropTimer -= dt; b.hitCooldown -= dt;
    if (b.dropTimer <= 0) {
      b.dropTimer = 8;
      if (getLevel().boss === "lifter") this.dropCrate(b.pos.clone().add(new THREE.Vector3(0, -12, 0)));
      else { const e = this.spawnEnemy(true, "fighter", null, b.pos.clone().add(new THREE.Vector3(0, -12, 0))); e.speed = 26; }
    }
    const pulse = 0.8 + 0.2 * Math.sin(this.time * 6);
    for (const w of b.weakPoints) w.scale.setScalar(pulse);
    const pf = FWD.clone().applyQuaternion(p.q);
    const mouth = p.pos.clone().addScaledVector(pf, 4.5);
    if (b.hitCooldown <= 0) {
      for (let i = b.weakPoints.length - 1; i >= 0; i--) {
        const w = b.weakPoints[i];
        const wp = w.getWorldPosition(new THREE.Vector3());
        if (mouth.distanceTo(wp) < 11) {
          b.weakPoints.splice(i, 1); b.mesh.remove(w); b.hp--; b.hitCooldown = 0.8;
          this.fx.burst(wp, [0xff4020, 0xb8b2a0], 18, 1.2);
          this.score += 200; this.showMsg(b.hp > 0 ? `WEAK POINT! ${b.hp} LEFT` : "ZEPPELIN DOWN!");
          this.sound?.chomp("bomber", 1); this.shake = Math.max(this.shake, 0.8); this.hitStop = 0.08; this.zoomPunch = 1; this.input.rumble(1, 0.5, 250);
          p.speed = Math.max(p.speed * 0.85, 25);
          if (b.hp <= 0) {
            this.fx.shred(b.parts, b.mesh, 2.5);
            this.feed(1000, 1, "boss", b.pos);
            if (b === this.boss) { this.scene.remove(b.mesh); this.boss = null; } else { this.scene.remove(b.mesh); this.boss2 = null; }
            if (!this.boss && !this.boss2) { this.removeBoss(); this.sound?.music.play("play"); }
          }
          break;
        }
      }
    }
  }

  private dropCrate(at: THREE.Vector3) {
    const g = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), new THREE.MeshLambertMaterial({ color: 0x8a6f4a, flatShading: true }));
    const band = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.5, 3.2), new THREE.MeshLambertMaterial({ color: 0xffd84a, flatShading: true }));
    const chute = new THREE.Mesh(new THREE.SphereGeometry(2.4, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xf3e7d2, flatShading: true, side: THREE.DoubleSide }));
    chute.position.y = 4; g.add(box, band, chute);
    g.position.copy(at);
    this.scene.add(g);
    this.crates.push({ mesh: g, pos: g.position, v: new THREE.Vector3((Math.random() - 0.5) * 2, -4, (Math.random() - 0.5) * 2) });
  }
  private updateCrates(dt: number) {
    const p = this.player;
    const mouth = p.pos.clone().addScaledVector(FWD.clone().applyQuaternion(p.q), 4.5);
    for (let i = this.crates.length - 1; i >= 0; i--) {
      const c = this.crates[i];
      c.pos.addScaledVector(c.v, dt);
      c.mesh.rotation.y += dt * 0.6;
      const gh = groundHeight(c.pos.x, c.pos.z);
      if (c.pos.y < gh + 1.5) c.pos.y = gh + 1.5;
      if (mouth.distanceTo(c.pos) < 7) {
        this.scene.remove(c.mesh); this.crates.splice(i, 1);
        this.score += 100; this.hunger = Math.min(1, this.hunger + 0.25);
        this.showMsg("SUPPLY SNACK +100"); this.sound?.chomp("fighter", 1);
        this.fx.burst(c.pos, [0x8a6f4a, 0xffd84a], 8, 0.5);
      }
    }
  }

  // ---------- player ----------
  private updatePlayer(dt: number) {
    const p = this.player, inp = this.input;
    const tmpQ = new THREE.Quaternion();
    const starving = this.hunger <= 0;

    if (inp.throttleAxis !== null) p.throttle = inp.throttleAxis;
    else p.throttle = THREE.MathUtils.clamp(p.throttle + inp.throttleDelta * 2 * dt, 0, 1);
    const maxThrottle = starving ? 0.7 : 1;

    const airborne = p.state === "airborne";
    if (inp.consumeBoostTap() && airborne && this.boostMeter > 0.15 && !starving) { this.lunge = 1; this.boostMeter -= 0.15; this.sound?.lunge(); this.tilt = 1; this.input.rumble(0.2, 0.8, 150); }
    this.boosting = airborne && inp.boostHeld && this.boostMeter > 0 && this.lunge <= 0 && !starving;
    this.boostMeter = THREE.MathUtils.clamp(this.boostMeter + (this.boosting ? -0.35 : 0.15) * dt, 0, 1);
    p.boost = THREE.MathUtils.lerp(p.boost, this.boosting ? 1.6 : 1, dt * 3);
    this.lunge = Math.max(0, this.lunge - dt / 0.6);
    this.hunger = Math.max(0, this.hunger - dt / 70);
    if (starving) { this.shake = Math.max(this.shake, 0.1); this.radio("r_starving", 40); } else if (this.hunger < 0.25) this.radio("r_hungry", 40);

    const targetSpeed = Math.min(p.throttle, maxThrottle) * MAX_SPEED * p.boost + this.lunge * 30;
    const gh = groundHeight(p.pos.x, p.pos.z);
    const onRunway = isOnRunway(p.pos.x, p.pos.z);
    const water = isWater(p.pos.x, p.pos.z);

    if (p.state === "rolling") {
      const f = FWD.clone().applyQuaternion(p.q);
      let yaw = Math.atan2(-f.x, -f.z);
      yaw += (inp.roll + inp.yaw) * 1.0 * Math.min(1, p.speed / 15) * dt;
      p.q.slerp(tmpQ.setFromAxisAngle(UP, yaw), damp(8, dt));
      p.speed += (targetSpeed - p.speed) * 0.3 * dt;
      const friction = (onRunway ? 4 : water ? 20 : 12) + (inp.brake ? 25 : 0);
      p.speed = Math.max(0, p.speed - friction * dt);
      p.pos.addScaledVector(FWD.clone().applyQuaternion(p.q), p.speed * dt);
      p.pos.y = gh + 1.7;
      if (p.speed > 5) {
        if (water) this.emitDust(dt, p.speed / 40, "splash");
        else if (!onRunway) this.emitDust(dt, p.speed / 60, "dust");
      }
      const rotating = p.speed > V_ROTATE && inp.pitch > 0.2;
      if (rotating || p.speed > V_FLOAT) { p.state = "airborne"; if (!rotating) this.autoRotate = 0.8; if (this.tutorialStep === 1) { this.tutorialStep = 2; this.tutorialTimer = 0; } this.radio("r_takeoff", 120); }
      if (p.speed > V_ROTATE && this.tutorialStep === 1) this.radio("r_rotate", 6);
    } else {
      this.hasBeenAirborne = true;
      const authority = p.speed < 30 ? THREE.MathUtils.lerp(0.5, 1, p.speed / 30) : 1;
      const pitchCmd = inp.pitch + (this.autoRotate > 0 ? 0.5 : 0) + (this.bounceTimer > 0 ? 1.2 : 0);
      this.autoRotate -= dt; this.bounceTimer -= dt;
      p.q.multiply(tmpQ.setFromAxisAngle(RIGHT, pitchCmd * 1.7 * authority * dt));
      p.q.multiply(tmpQ.setFromAxisAngle(FWD, -inp.roll * 3.2 * authority * dt));
      p.q.multiply(tmpQ.setFromAxisAngle(UP, inp.yaw * 1.0 * authority * dt));
      const r = RIGHT.clone().applyQuaternion(p.q), u = UP.clone().applyQuaternion(p.q);
      this.handsOff = Math.abs(inp.roll) < 0.05 && Math.abs(inp.pitch) < 0.05 ? this.handsOff + dt : 0;
      if (this.handsOff > 1) {
        const lvl = u.y >= 0 ? r.y : Math.sign(r.y || 1);
        p.q.multiply(tmpQ.setFromAxisAngle(FWD, lvl * 0.6 * dt));
      }
      if (p.speed < 22) {
        this.shake = Math.max(this.shake, (22 - p.speed) / 22 * 0.25); this.input.rumble(0.15, 0.3, 100);
        p.q.multiply(tmpQ.setFromAxisAngle(RIGHT, -(22 - p.speed) * 0.015 * dt));
      }
      p.q.normalize();
      p.speed += (targetSpeed - p.speed) * 0.9 * dt;
      const f = FWD.clone().applyQuaternion(p.q);
      p.pos.addScaledVector(f, p.speed * dt);
      const gust = getLevel().gimmick === "gusts" ? 0.6 + 0.9 * Math.sin(this.time * 0.35) : 0.6;
      p.pos.addScaledVector(this.wind, dt * gust);
      p.pos.y -= (1 - Math.min(1, p.speed / 30)) * 10 * dt;

      if (water && p.pos.y - gh < 4 && p.speed > 30 && !getLevel().lava) this.emitDust(dt, 1.5, "splash");
      if (getLevel().gimmick === "volcano" && gh > 60 && p.pos.y - gh < 60) p.pos.y += 8 * dt; // thermal updrafts over the cone

      // wingtips + nose: a real crash if you plough in nose-down or fast; a bounce if you merely skim
      const pr = RIGHT.clone().applyQuaternion(p.q).multiplyScalar(6);
      const tipLow = Math.min(p.pos.y + pr.y - groundHeight(p.pos.x + pr.x, p.pos.z + pr.z), p.pos.y - pr.y - groundHeight(p.pos.x - pr.x, p.pos.z - pr.z));
      const noseDown = f.y < -0.35;
      if ((p.pos.y < gh + 1.7 && (noseDown || p.speed > 52) && !(onRunway && p.speed < 40)) || tipLow < -1.5) { this.crashPlayer(); return; }
      if (p.pos.y < gh + 1.7) {
        p.pos.y = gh + 1.7;
        this.touchedGroundThisWave = true;
        if (water && getLevel().lava) { this.crashPlayer(); return; }
      const landing = p.speed < 28 || (onRunway && p.speed < 40);
        if (landing) {
          p.state = "rolling"; this.shake = Math.max(this.shake, 0.3); this.sound?.thud(0.25); if (onRunway) { this.sound?.screech(); this.radio("r_land", 30); }
          this.input.rumble(0.5, 0.5, 200);
          if (onRunway && this.hasBeenAirborne && this.time > 15) this.objective("land");
        } else {
          if (this.bounceTimer <= 0) { this.sound?.thud(0.4); this.shake = Math.max(this.shake, 0.5); this.input.rumble(0.8, 0.3, 250); if (water) { this.fx.splash(p.pos, 16); this.sound?.splash(p.pos); } }
          this.bounceTimer = 0.5;
          p.speed = Math.max(20, p.speed - 20 * dt);
          this.emitDust(dt, 2, water ? "splash" : "dust");
        }
      }
      if (p.pos.y > 400) p.q.multiply(tmpQ.setFromAxisAngle(RIGHT, -0.6 * dt));
      if (Math.hypot(p.pos.x, p.pos.z) > WORLD_RADIUS) {
        const toCenter = new THREE.Vector3(-p.pos.x, 0, -p.pos.z).normalize();
        const cross = f.clone().setY(0).normalize().cross(toCenter).y;
        p.q.premultiply(tmpQ.setFromAxisAngle(UP, Math.sign(cross) * 1.2 * dt));
      }
    }

    // felt acceleration for HUD inertia
    const vel = FWD.clone().applyQuaternion(p.q).multiplyScalar(p.speed);
    this.gForce = THREE.MathUtils.lerp(this.gForce, Math.min(2, vel.distanceTo(this.lastVel) / Math.max(dt, 1e-3) / 60), 0.2);
    this.lastVel.copy(vel);
    // visuals: gear, prop disc, gulp bulge, trails, speed streaks
    p.mesh.position.copy(p.pos); p.mesh.quaternion.copy(p.q);
    this.model.prop.rotation.z += (2 + p.speed * 0.6) * dt;
    this.model.propDisc.visible = p.throttle > 0.4;
    const alt = p.pos.y - gh;
    const wantGear = p.state === "rolling" || alt < 12 ? 0 : 1;
    const prevGear = p.gearUp;
    p.gearUp = THREE.MathUtils.lerp(p.gearUp, wantGear, damp(3, dt));
    if ((prevGear < 0.9 && p.gearUp >= 0.9) || (prevGear > 0.1 && p.gearUp <= 0.1)) this.sound?.gearClunk();
    if (this.model.gear) { this.model.gear.position.y = p.gearUp * 1.3; this.model.gear.visible = p.gearUp < 0.95; }
    p.gulp = Math.max(0, p.gulp - dt * 2);
    const bulge = 1 + 0.22 * Math.sin(Math.PI * Math.min(1, p.gulp)) + 0.08 * Math.max(0, p.gulp - 1);
    p.mesh.scale.set(bulge, bulge, 1);
    const turning = Math.min(1, (Math.abs(inp.roll) * 0.6 + Math.abs(inp.pitch) * 1.2 + (this.boosting ? 0.8 : 0)) * Math.min(1, p.speed / 40));
    const up = UP.clone().applyQuaternion(p.q);
    this.model.wingtips.forEach((tip, i) => this.trails[i].update(tip.getWorldPosition(new THREE.Vector3()), up, p.state === "airborne" ? turning : 0));
    this.contrail.update(p.pos.clone().addScaledVector(FWD.clone().applyQuaternion(p.q), -4), up, alt > 150 && p.throttle > 0.3 ? 0.55 : 0);
    // birds: snack on anything in front of the mouth; eat a parachute for a bonus
    const mouthB = p.pos.clone().addScaledVector(FWD.clone().applyQuaternion(p.q), 4.5);
    const bi = this.birds.near(mouthB, 5);
    if (bi >= 0) { this.birds.eat(bi); this.fx.feathers(this.birds.pos[bi]); this.sound?.feathers(this.birds.pos[bi]); this.score += 10; this.hunger = Math.min(1, this.hunger + 0.05); this.radio("r_bird", 30); }
    for (const c of this.fx.chutes()) if (c.position.distanceTo(mouthB) < 6) { const at = c.position.clone(); this.fx.remove(c); this.fx.burst(at, [0xf3e7d2, 0x4a3a2a], 10, 0.5); this.score += 50; this.showMsg("PILOT SNACK +50"); this.sound?.chomp("fighter", 1); }
    if (this.boosting || this.lunge > 0.3) {
      this.streakAcc += dt * 40;
      const n = Math.floor(this.streakAcc);
      if (n > 0) { this.streakAcc -= n; this.fx.streak(this.camera.position, FWD.clone().applyQuaternion(p.q), Math.min(n, 3)); }
    }
  }

  /** You hit the ground for real: airframe shreds, short blackout, respawn in the air nearby. Combo is lost; the clock keeps running. */
  private crashPlayer() {
    const p = this.player;
    this.crashTimer = 2.6;
    this.crashPos.copy(p.pos);
    const f = FWD.clone().applyQuaternion(p.q); this.crashYaw = Math.atan2(-f.x, -f.z);
    if (isWater(p.pos.x, p.pos.z)) { this.fx.splash(p.pos, 30); this.sound?.splash(p.pos); } else { this.fx.slick(p.pos); }
    this.fx.shred(this.model.parts, p.mesh, 1.2);
    p.mesh.visible = false;
    for (const t of this.trails) t.reset(p.pos); this.contrail.reset(p.pos);
    this.sound?.crash(p.pos); this.sound?.thud(0.8); this.sound?.setMuffled(true);
    this.input.rumble(1, 1, 500);
    this.shake = 1.4; this.hitStop = 0.12;
    this.combo = 0; this.comboTimer = 0; this.frenzy = 0; this.post.setTint(new THREE.Color(0xff5d2e), 0);
    this.touchedGroundThisWave = true;
    p.speed = 0; p.throttle = 0; this.boosting = false; this.lunge = 0;
    this.showMsg("CRASHED!");
    this.radio("r_playerCrash", 5);
  }
  private updateCrash(dt: number) {
    this.crashTimer -= dt;
    this.post.setTint(new THREE.Color(0x000000), Math.min(1, Math.max(0, (1.6 - this.crashTimer) * 1.2)) * 0.9);
    if (this.crashTimer > 0) return;
    // respawn: 80 m up over the crash site, level, heading the same way, with flying speed
    const p = this.player;
    p.pos.copy(this.crashPos); p.pos.y = groundHeight(p.pos.x, p.pos.z) + 80;
    p.q.setFromAxisAngle(UP, this.crashYaw); p.speed = 45; p.throttle = 0.8; p.state = "airborne"; p.gearUp = 1;
    p.mesh.visible = true; p.mesh.position.copy(p.pos); p.mesh.quaternion.copy(p.q);
    this.camQ.copy(p.q);
    for (const t of this.trails) t.reset(p.pos); this.contrail.reset(p.pos);
    this.sound?.setMuffled(false);
    this.post.setTint(new THREE.Color(0xffffff), 0.7); // wake up inside a cloud, fade to clear
    this.crashFade = 0.7;
    this.bounceTimer = 0; this.autoRotate = 0; this.handsOff = 0;
  }

  private emitDust(dt: number, rate: number, kind: "dust" | "splash") {
    this.dustAcc += dt * 20 * rate;
    const n = Math.floor(this.dustAcc);
    if (n > 0) {
      this.dustAcc -= n;
      const at = this.player.pos.clone().setY(this.player.pos.y - 1);
      if (kind === "splash") this.fx.splash(at, Math.min(n, 3)); else this.fx.dust(at, Math.min(n, 4));
    }
  }

  // ---------- camera ----------
  private updateCamera(dt: number, follow: boolean) {
    const p = this.player, o = store.get().options;
    if (follow) this.camQ.slerp(p.q, damp(7, dt));
    const look = this.input;
    const off = new THREE.Vector3(0, 4.5, 14)
      .applyEuler(new THREE.Euler(-look.lookY * 0.6, look.lookX * Math.PI * 0.75, 0, "YXZ"))
      .applyQuaternion(this.camQ);
    const desired = p.pos.clone().add(off);
    desired.y = Math.max(desired.y, groundHeight(desired.x, desired.z) + 2);
    this.camera.position.lerp(desired, damp(14, dt));
    this.camera.up.copy(UP).applyQuaternion(this.camQ);
    this.camera.lookAt(p.pos.clone().addScaledVector(FWD.clone().applyQuaternion(p.q), 8));
    const motion = o.reducedMotion ? 0 : 1;
    this.tilt = Math.max(0, this.tilt - dt * 2); this.zoomPunch = Math.max(0, this.zoomPunch - dt * 3);
    this.camera.rotateZ(Math.sin(this.tilt * Math.PI) * 0.12 * motion);
    const sh = this.shake * o.shake * motion;
    if (sh > 0.01) {
      this.camera.position.add(new THREE.Vector3().randomDirection().multiplyScalar(sh * 0.8));
      this.camera.rotateZ((Math.random() - 0.5) * sh * 0.05);
    }
    this.shake *= Math.exp(-6 * dt);
    // final safety clamp: the lerped/shaken position must never sink under the terrain (looking through a
    // back-face-culled hill washes the whole frame with fog colour)
    const camFloor = groundHeight(this.camera.position.x, this.camera.position.z) + 1.5;
    if (this.camera.position.y < camFloor) this.camera.position.y = camFloor;
    const fovBoost = ((this.boosting || this.lunge > 0.3 ? 15 : 0) - this.zoomPunch * 18) * (o.reducedMotion ? 0.3 : 1);
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, o.fov + fovBoost, dt * 4);
    this.camera.updateProjectionMatrix();
  }

  /** Title: the hero sits on the apron in front of the hangar and slowly turns on a turntable. */
  private titleScene(dt: number) {
    this.titleAngle += dt * 0.25;
    const p = this.player;
    const apron = new THREE.Vector3(28, groundHeight(28, 52) + 1.7, 52);
    p.pos.copy(apron);
    p.q.setFromAxisAngle(UP, this.titleAngle + 0.6);
    p.mesh.position.copy(p.pos); p.mesh.quaternion.copy(p.q); p.mesh.scale.setScalar(1);
    this.model.prop.rotation.z += 2 * dt; this.model.propDisc.visible = false;
    if (this.model.gear) { this.model.gear.visible = true; this.model.gear.position.y = 0; }
    if (this.model.jaw) this.model.jaw.rotation.x = -0.08 - 0.06 * Math.sin(this.titleAngle * 3);
    for (const t of this.trails) t.update(p.pos, UP, 0);
    this.contrail.update(p.pos, UP, 0);
    this.camera.position.set(apron.x + 18, apron.y + 7, apron.z + 22);
    this.camera.up.copy(UP);
    this.camera.lookAt(apron.x, apron.y + 1, apron.z);
    this.camera.fov = 40; this.camera.updateProjectionMatrix();
    this.updateEnemiesIdle(dt);
  }

  /** Intro: 5 s dolly from teeth-in-your-face to the rear hero shot, then straight into the countdown. */
  private introScene(dt: number) {
    const p = this.player;
    this.introT += dt;
    const u = THREE.MathUtils.smoothstep(Math.min(1, this.introT / 5.5), 0, 1);
    p.mesh.position.copy(p.pos); p.mesh.quaternion.copy(p.q); p.mesh.scale.setScalar(1);
    // prop spins up, gear stays down, jaw snaps once as the camera passes the mouth
    this.model.prop.rotation.z += (2 + u * 60) * dt;
    this.model.propDisc.visible = u > 0.6;
    if (this.model.gear) { this.model.gear.visible = true; this.model.gear.position.y = 0; }
    const snap = THREE.MathUtils.clamp(1 - Math.abs(this.introT - 1.6) / 0.35, 0, 1);
    if (this.model.jaw) this.model.jaw.rotation.x = -snap * 0.55;
    if (u > 0.25 && Math.random() < dt * 10) for (const ex of this.model.exhausts) this.fx.puff(ex.clone().applyQuaternion(p.q).add(p.pos));
    // camera on an arc: front-left low (az 215°, r 8, h -0.3) → rear high (az 360°, r 14, h 4.5)
    const az = THREE.MathUtils.degToRad(THREE.MathUtils.lerp(215, 360, u));
    const r = THREE.MathUtils.lerp(9, 14, u), h = THREE.MathUtils.lerp(0.9, 4.5, u);
    const local = new THREE.Vector3(Math.sin(az) * r, h, Math.cos(az) * r); // az 180 = nose, 360 = tail
    const desired = p.pos.clone().add(local.applyQuaternion(p.q));
    desired.y = Math.max(desired.y, groundHeight(desired.x, desired.z) + 1.2);
    this.camera.position.lerp(desired, this.introT < 0.05 ? 1 : damp(10, dt));
    this.camera.up.copy(UP);
    const look = p.pos.clone().add(new THREE.Vector3(0, THREE.MathUtils.lerp(0.1, 0.5, u), THREE.MathUtils.lerp(-4.0, -8, u)).applyQuaternion(p.q));
    this.camera.lookAt(look);
    this.camera.fov = THREE.MathUtils.lerp(48, store.get().options.fov, u); this.camera.updateProjectionMatrix();
    this.fx.update(dt);
    this.sound?.engine.set(u * 0.4, u * 0.5, 0, false, dt, () => {});
    store.setHud({ intro: { t: u, caption: LIVERIES[this.liveryIndex].name } });
    if (this.introT > 6 || this.input.consumeSkip()) { this.camQ.copy(p.q); this.beginCountdown(); }
  }

  private updateEnemiesIdle(dt: number) {
    for (const e of this.enemies) {
      if (e.pos.distanceTo(e.target) < 50) this.pickTarget(e);
      const desired = e.target.clone().sub(e.pos).normalize();
      const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), desired, UP);
      e.q.slerp(new THREE.Quaternion().setFromRotationMatrix(m), Math.min(1, dt));
      e.pos.addScaledVector(FWD.clone().applyQuaternion(e.q), e.speed * dt);
      e.mesh.position.copy(e.pos); e.mesh.quaternion.copy(e.q); e.model.prop.rotation.z += 25 * dt;
    }
  }

  // ---------- round ----------
  private showMsg(t: string) { this.msg = t; this.msgTimer = 1.2; }
  toast(t: string) { store.setHud({ toast: t }); this.toastTimer = 3.5; }

  private updateRound(dt: number) {
    this.time += dt; this.timeLeft -= dt;
    if (this.comboTimer > 0) { this.comboTimer -= dt; if (this.comboTimer <= 0) this.combo = 0; }
    this.msgTimer -= dt; this.waveBannerTimer -= dt; this.waveTimer -= dt;
    if (this.frenzy > 0) { this.frenzy -= dt; if (this.frenzy <= 0) this.post.setTint(new THREE.Color(0xff5d2e), 0); }
    if (this.crashFade > 0) { this.crashFade = Math.max(0, this.crashFade - dt * 0.6); this.post.setTint(new THREE.Color(0xffffff), this.crashFade); }
    if (this.waveTimer <= 0) {
      if (!this.touchedGroundThisWave && this.hasBeenAirborne) this.objective("clean");
      this.touchedGroundThisWave = false;
      this.wave++; this.waveTimer = WAVE_TIME;
      this.waveBanner = `WAVE ${this.wave}`; this.waveBannerTimer = 2.5; this.sound?.horn(); this.radio("r_wave", 10);
      if (this.wave % getLevel().bossEvery === 0 && !this.boss) this.spawnBoss();
    }
    if (this.timeLeft <= 0 && this.wipeDir === 0) this.wipe(() => this.finish());

    // day cycle + weather
    const prog = 1 - this.timeLeft / getLevel().roundTime;
    const rainTarget = this.rainy ? THREE.MathUtils.smoothstep(prog, 0.2, 0.45) * (1 - THREE.MathUtils.smoothstep(prog, 0.75, 0.95)) : 0;
    this.rainLevel = THREE.MathUtils.lerp(this.rainLevel, rainTarget, dt * 0.5);
    this.rain.intensity = this.rainLevel;
    (this.rain.mesh.material as THREE.MeshBasicMaterial).color.setHex(getLevel().gimmick === "volcano" ? 0x54423a : 0xcfe0f0);
    this.sky.blend(this.timeOfDay, this.nextTod, prog, this.rainLevel);
    (this.world.water.material as THREE.MeshPhongMaterial).shininess = 90 + this.rainLevel * 120;
    this.world.leaves.color.setHex(0x2e8b3a).lerp(new THREE.Color(0x16321f), 1 - Math.min(1, this.sky.sun.intensity / 1.4));
    store.setHud({ weather: this.rainLevel > 0.3 ? "rain" : "clear" });
    // music follows the action
    if (this.sound) this.sound.music.intensity = this.frenzy > 0 ? 3 : this.combo >= 2 ? 2 : this.eaten > 0 ? 1 : 0;
    // tutorial beats (first sortie only)
    this.tutorialTimer += dt;
    if (this.tutorialStep === 0 && this.tutorialTimer > 1) { this.tutorialStep = 1; this.radio("t_throttle", 0); this.tutorialTimer = 0; }
    else if (this.tutorialStep === 1 && this.tutorialTimer > 8 && this.player.speed > V_ROTATE) { this.radio("t_rotate", 0); this.tutorialTimer = 0; }
    else if (this.tutorialStep === 2 && this.tutorialTimer > 2) { this.tutorialStep = 3; this.radio("t_find", 0); this.tutorialTimer = 0; }
    else if (this.tutorialStep === 3 && this.tutorialTimer > 10) { this.radio("t_bite", 0); this.tutorialTimer = 0; }
    else if (this.tutorialStep === 4 && this.tutorialTimer > 1.5) { this.tutorialStep = 99; this.radio("t_done", 0); store.setOptions({ tutorialDone: true }); }
    if (this.subtitleTimer > 0) { this.subtitleTimer -= dt; if (this.subtitleTimer <= 0) store.setHud({ subtitle: null }); }
    if (this.captionTimer > 0) { this.captionTimer -= dt; if (this.captionTimer <= 0) store.setHud({ caption: "" }); }
    if (this.toastTimer > 0) { this.toastTimer -= dt; if (this.toastTimer <= 0) store.setHud({ toast: "" }); }
  }

  private finish() {
    this.timeLeft = 0;
    this.sound?.engine.silence();
    this.sound?.music.play("title");
    const snd = this.sound; setTimeout(() => snd?.music.sting(true), 300);
    for (const v of this.voices.values()) v.dispose(); this.voices.clear();
    this.post.setTint(new THREE.Color(0xff5d2e), 0);
    const done = this.objectives.filter((o) => o.done).length;
    const medal = done === 2 ? (this.score >= 1500 ? "gold" : "silver") : done === 1 ? (this.score >= 1000 ? "silver" : "bronze") : this.score >= 800 ? "bronze" : "none";
    const before = store.get().progress.totalEaten;
    const stars = starsFor(medal, done);
    store.finishRound({
      score: this.score, eaten: this.eaten, eatenByKind: { ...this.eatenByKind }, bestCombo: this.bestCombo, firstBite: this.firstBite,
      objectives: this.objectives.map((o) => ({ ...o })), medal, dateKey: this.dateKey,
    }, getLevel().id, stars);
    const after = store.get().progress.totalEaten;
    const unlocked = LIVERIES.find((l) => l.unlockAt > before && l.unlockAt <= after);
    if (unlocked) store.set({ round: { ...store.get().round, unlocked: unlocked.name } });
    if (medal !== "none") setTimeout(() => this.sound?.medal(), 900);
  }

  private pushHud() {
    const p = this.player;
    const f = FWD.clone().applyQuaternion(p.q);
    const fh = f.clone().setY(0).normalize(), rh = new THREE.Vector3(-fh.z, 0, fh.x);
    const radar: RadarBlip[] = [], alerts: Alert[] = [], targets: Target[] = [];
    const dark = getLevel().gimmick === "dark";
    type Contact = { ref: object; pos: THREE.Vector3; fwd: THREE.Vector3; kind: EnemyKind | "boss"; alert: boolean; hurt: boolean };
    const contacts: Contact[] = this.enemies.map((e) => ({ ref: e, pos: e.pos, fwd: FWD.clone().applyQuaternion(e.q), kind: e.kind, alert: e.alertTimer > 0, hurt: e.hp < KINDS[e.kind].hp }));
    if (this.boss) contacts.push({ ref: this.boss, pos: this.boss.pos, fwd: FWD.clone().applyQuaternion(this.boss.q), kind: "boss", alert: false, hurt: false });
    let lock: Contact | null = null, lockScore = Infinity, nearest: Contact | null = null, nearestD = Infinity, current: Contact | null = null, currentScore = Infinity;
    const scoreOf = (c: Contact) => { const rel = c.pos.clone().sub(p.pos); const d = rel.length(); const ahead = f.dot(rel.clone().normalize()); return { d, sc: ahead > 0.5 && d < 300 ? d : d + 10000 }; };
    for (const c of contacts) {
      const { d, sc } = scoreOf(c);
      if (d < nearestD) { nearestD = d; nearest = c; }
      if (sc < lockScore) { lockScore = sc; lock = c; }
      if (c.ref === this.lockRef) { current = c; currentScore = sc; }
    }
    if (!lock) lock = nearest;
    // hysteresis: keep the current lock unless the best candidate is clearly better (20 %) or the current one fell out of the cone
    if (current && lock !== current && currentScore < 10000 && lockScore > currentScore * 0.8) { lock = current; lockScore = currentScore; }
    this.lockRef = lock ? lock.ref : null;
    const camInv = this.camera.quaternion.clone().invert();
    for (const c of contacts) {
      const rel = c.pos.clone().sub(p.pos); const d = rel.length();
      const dAlt = Math.round(c.pos.y - p.pos.y);
      const kind: EnemyKind = c.kind === "boss" ? "bomber" : c.kind;
      if (d < RADAR_RANGE) {
        const ef = c.fwd;
        const heading = Math.atan2(ef.dot(rh), ef.dot(fh)); // relative to our heading, for the silhouette
        radar.push({ x: rel.dot(rh) / RADAR_RANGE, y: -rel.dot(fh) / RADAR_RANGE, kind, dAlt, heading, locked: c === lock });
      }
      // camera-space depth FIRST: anything behind the camera must use the edge arrow — its NDC projection
      // flips and can land inside the view, which made markers streak across the screen on the runway
      const v = c.pos.clone().sub(this.camera.position).applyQuaternion(camInv);
      const behind = v.z > -1;
      const ndc = c.pos.clone().project(this.camera);
      const onScreen = !behind && ndc.z < 1 && Math.abs(ndc.x) < 0.95 && Math.abs(ndc.y) < 0.92;
      let x = (ndc.x + 1) * 50, y = (1 - ndc.y) * 50, angle = 0;
      if (!onScreen) {
        const sx = v.x, sy = v.y * (behind ? -1 : 1);
        angle = Math.atan2(-sy, sx);
        const ax = Math.cos(angle), ay = Math.sin(angle);
        const m = 0.86 / Math.max(Math.abs(ax), Math.abs(ay));
        x = THREE.MathUtils.clamp(50 + ax * m * 50, 6, 94); y = THREE.MathUtils.clamp(50 + ay * m * 50, 10, 88);
      }
      if (!dark || d < 320 || c === lock) targets.push({ x, y, onScreen, angle, dist: Math.round(d), dAlt, kind, locked: c === lock });
      if (c.alert && onScreen) alerts.push({ x, y, text: c.hurt ? "OW!" : "!" });
    }
    let compassAngle = 0, lockPitch = 0;
    if (lock) { const rel = lock.pos.clone().sub(p.pos); const toN = rel.clone().setY(0).normalize(); compassAngle = Math.atan2(fh.x * toN.z - fh.z * toN.x, fh.dot(toN)); lockPitch = Math.atan2(rel.y, Math.hypot(rel.x, rel.z)); }
    const bank = RIGHT.clone().applyQuaternion(p.q).y;
    if (lock && lockScore < 40 && store.get().phase === "playing") { this.heartAcc += 0.016; if (this.heartAcc > 0.55) { this.heartAcc = 0; this.sound?.heart(); } }
    this.sound?.setListener(this.camera.position, this.camera.getWorldDirection(new THREE.Vector3()));

    store.setHud({
      score: this.score, combo: this.combo, eaten: this.eaten,
      speed: Math.round(p.speed * 5), alt: Math.round(p.pos.y - groundHeight(p.pos.x, p.pos.z)),
      throttle: p.throttle, boost: this.boostMeter, boosting: this.boosting, groundState: p.state,
      compassAngle, compassNear: lockScore < 80, lockPitch, bank, gForce: this.gForce, comboFrac: this.comboTimer > 0 ? this.comboTimer / 4 : 0,
      msg: this.msg, msgVisible: this.msgTimer > 0,
      timeLeft: Math.ceil(this.timeLeft), wave: this.wave, waveBanner: this.waveBannerTimer > 0 ? this.waveBanner : "",
      countdown: this.countdownShown, hunger: this.hunger, frenzy: Math.max(0, this.frenzy),
      objectives: this.objectives.map((o) => ({ ...o })), boss: this.boss ? { hp: this.boss.hp, max: this.boss.max } : null,
      timeOfDay: this.timeOfDay, resumeIn: Math.ceil(this.resumeIn), muted: !this.sound || this.sound.ctx.state !== "running", rolling: p.state === "rolling", tier: store.get().options.quality, radar, alerts, targets, lockDist: lock ? Math.round(lock.pos.distanceTo(p.pos)) : null,
    });
  }

  // ---------- main loop ----------
  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    const realDt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    this.tick(realDt, true);
  };

  /** Debug/test hook: advance the simulation by `seconds` in fixed 60 Hz steps without waiting for frames. */
  advance(seconds: number) {
    const steps = Math.round(seconds * 60);
    for (let i = 0; i < steps; i++) this.tick(1 / 60, i === steps - 1);
    this.last = performance.now();
  }

  private clock = 0; private frameParity = false;
  private tick(realDt: number, render: boolean) {
    this.clock += realDt;
    const now = this.clock * 1000;
    // the wipe can change the phase (its action fires startRound/finish) — progress it BEFORE reading the phase,
    // otherwise this frame still runs the old scene, which can teleport the player (title turntable) after a reset
    if (this.wipeDir !== 0) {
      this.wipeT += realDt * this.wipeDir / 0.32;
      if (this.wipeDir > 0 && this.wipeT >= 1) { this.wipeT = 1; this.wipeAction?.(); this.wipeAction = null; this.wipeDir = -1; }
      else if (this.wipeDir < 0 && this.wipeT <= 0) { this.wipeT = 0; this.wipeDir = 0; }
    }
    const phase = store.get().phase;
    const opts = store.get().options;
    this.input.update(realDt, opts);
    this.world.update(now / 1000);
    // fade the cloud layer out when the camera is inside a puff so it never white-out the view
    {
      let nearest = Infinity;
      for (const c of this.world.clouds.centers) { const d = c.distanceToSquared(this.camera.position); if (d < nearest) nearest = d; }
      const m = this.world.clouds.mesh.material as THREE.MeshLambertMaterial;
      const inside = THREE.MathUtils.smoothstep(Math.sqrt(nearest), 18, 55);
      m.opacity = THREE.MathUtils.lerp(m.opacity, 0.15 + 0.8 * inside, 0.15);
    }
    this.sky.follow(this.player.pos);
    const sock = this.scene.getObjectByName("sock");
    if (sock) sock.rotation.y = Math.atan2(this.wind.x, this.wind.z) + Math.sin(now / 700) * 0.25;
    for (const f of this.scene.children) if (f.name === "flag") f.rotation.y = Math.sin(now / 500) * 0.3;
    if (phase !== "paused") {
      this.birds.update(realDt);
      const dusk = this.timeOfDay === "dusk" || this.nextTod === "dusk" ? 1 : 0;
      this.life.update(realDt, this.player.pos, dusk);
      this.rain.update(realDt, this.camera.position, this.wind);
    }

    if (this.input.consumePause()) {
      if (phase === "playing") { this.pause(); return; }
      if (phase === "paused") { this.resume(); return; }
    }

    switch (phase) {
      case "title":
      case "roundOver":
        this.input.consumeSkip();
        if (render && isTouch() && (this.frameParity = !this.frameParity)) return;
        if (this.sound && this.sound.music["mode"] === "off") this.sound.music.play("title");
        this.titleScene(realDt);
        this.fx.update(realDt, this.camera.position);
        break;
      case "intro":
        this.input.consumePause();
        this.introScene(realDt);
        this.updateEnemiesIdle(realDt);
        break;
      case "countdown": {
        this.countdownT -= realDt;
        const label = this.countdownT > 0.4 ? String(Math.ceil(this.countdownT - 0.4)) : "GO!";
        if (label !== this.countdownShown) { this.countdownShown = label; if (label === "GO!") this.sound?.go(); else this.sound?.tick(); }
        this.updateEnemiesIdle(realDt);
        this.updateCamera(realDt, true);
        if (this.countdownT <= 0) { this.countdownShown = ""; store.set({ phase: "playing" }); }
        this.pushHud();
        break;
      }
      case "playing": {
        // auto quality: sustained slow frames → drop to Low once, with a toast
        this.frameEma = THREE.MathUtils.lerp(this.frameEma, realDt, 0.05);
        this.slowFor = this.frameEma > 0.045 ? this.slowFor + realDt : 0;
        if (this.slowFor > 4 && opts.quality !== "low" && this.autoDropped < 2) {
          this.autoDropped++; this.slowFor = 0;
          const next = opts.quality === "high" ? "medium" : "low";
          store.setOptions({ quality: next }); this.applyOptions(store.get().options);
          this.toast(next === "medium" ? "Dropped to MEDIUM quality to keep it smooth" : "Dropped to LOW quality to keep it smooth");
        }
        let dt = realDt;
        if (this.resumeIn > 0) { const prev = Math.ceil(this.resumeIn); this.resumeIn -= realDt; if (Math.ceil(this.resumeIn) !== prev) this.sound?.tick(); dt = 0; }
        if (this.hitStop > 0) { this.hitStop -= realDt; dt = 0; }
        if (dt > 0) {
          if (this.crashTimer > 0) this.updateCrash(dt); else this.updatePlayer(dt);
          const enemyDt = this.frenzy > 0 ? dt * 0.5 : dt; // frenzy: they slow down, you don't
          this.updateEnemies(enemyDt);
          this.updateBoss(enemyDt);
          this.fx.update(dt, this.camera.position);
          this.updateRound(dt);
          if (this.frenzy > 0) this.post.setTint(new THREE.Color(0xff5d2e), 0.18 + 0.06 * Math.sin(this.time * 8));
        }
        this.updateCamera(realDt, true);
        if (this.sound) {
          const p = this.player, r = RIGHT.clone().applyQuaternion(p.q);
          this.sound.engine.set(Math.min(1, p.speed / MAX_SPEED), p.throttle, this.boosting ? 1 : 0, this.hunger <= 0, dt, () => { this.sound?.sputter(); this.shake = Math.max(this.shake, 0.15); });
          const ground = p.state === "rolling" ? (isOnRunway(p.pos.x, p.pos.z) ? "runway" : isWater(p.pos.x, p.pos.z) ? "water" : "grass") : null;
          this.sound.setFlight(Math.min(1, p.speed / (MAX_SPEED * 1.6)), Math.abs(r.y), ground, p.state === "airborne" && p.speed < 22 ? (22 - p.speed) / 22 : 0);
        }
        this.pushHud();
        break;
      }
      case "paused":
        break; // world stays frozen but keeps rendering so the pause cinema can swim over it
    }
    if (render) {
      this.renderer.clear();
      this.post.render(this.scene, this.camera);
      const menuMain = store.get().menuPage === "main";
      const menuPage = store.get().menuPage;
      const mode = phase === "playing" || phase === "countdown" ? "game" : phase === "intro" ? "intro" : phase === "paused" ? "pause" : phase === "title" && (menuMain || menuPage === "levels") ? "title" : "none";
      this.hud3d.setMode(mode);
      if (mode === "game") {
        const o = store.get().options;
        const sh = this.shake * o.shake * (o.reducedMotion ? 0 : 1) * 2;
        this.hud3d.setShake((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh);
        this.hud3d.update(store.get().hud, o, realDt);
      } else if (mode === "intro") {
        this.hud3d.updateIntro(realDt, Math.min(1, this.introT / 5.5), LIVERIES[this.liveryIndex].name, tr("yourRide"), tr("skip"));
      } else if (mode === "pause") {
        this.hud3d.updatePause(realDt, tr("paused"));
        if (menuMain) this.hud3d.updateMenu(realDt, "pause", this.menuItems(), this.menuHover, {});
        else this.hud3d.setMode("none");
      } else if (mode === "title") {
        const pr = store.get().progress;
        if (menuPage === "levels") {
          this.hud3d.updateMenu(realDt, "levels", this.menuItems(), this.menuHover, { tagline: `PICK YOUR HUNTING GROUND · ${store.totalStars()}★` });
        } else {
          this.hud3d.updateMenu(realDt, "title", this.menuItems(), this.menuHover, {
            tagline: `${tr("tagline")} ${tr("eatThem")}`,
            progress: pr.totalEaten > 0 ? `${pr.bestScore > 0 ? `BEST ${pr.bestScore} · ` : ""}${pr.totalEaten} PLANES EATEN · ${pr.medals} MEDALS · ${store.totalStars()}★` : "",
          });
        }
      }
      this.hud3d.updateWipe(Math.max(0, Math.min(1, this.wipeT)));
      if (mode !== "none" || this.wipeT > 0) {
        this.renderer.clearDepth();
        this.renderer.render(this.hud3d.scene, this.hud3d.camera);
      }
    }
  }
}
