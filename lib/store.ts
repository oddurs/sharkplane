import { useSyncExternalStore } from "react";

export type Phase = "title" | "intro" | "countdown" | "playing" | "paused" | "roundOver";

export type LevelRecord = { bestScore: number; stars: number; medals: number; sorties: number; bestCombo: number };

export type Options = {
  invertY: boolean; // true = flight-stick: pull back (S/↓) to climb
  sensitivity: number; // 0.5 .. 2
  volume: number; // 0 .. 1
  gamepad: boolean;
  quality: "high" | "medium" | "low"; // high: shadows+post · medium: post only, lighter world · low: plain
  fov: number; // 60 .. 100
  shake: number; // 0 .. 1
  colorblind: boolean; // letter tags on markers instead of colour alone
  livery: number; // index into LIVERIES
  touch: boolean; // on-screen controls
  scheme: "anywhere" | "stick" | "tilt"; // touch steering scheme
  autoThrottle: boolean; // hold 100% in the air automatically (one-thumb play)
  tiltInvert: boolean;
  music: number; sfx: number; ui: number; // 0..1 sub-mixes
  captions: boolean; // caption every sound event
  reducedMotion: boolean; // no shake/tilt/zoom punches
  highContrast: boolean;
  lang: "en" | "is";
  tutorialDone: boolean;
  qualitySet: boolean; // quality chosen (by the user or the device tier) at least once
};

export type Objective = { id: string; text: string; target: number; progress: number; done: boolean };

export type Progress = { totalEaten: number; medals: number; sorties: number; bestScore: number; levels: Record<string, LevelRecord> };

export type RadarBlip = { x: number; y: number; kind: EnemyKind; dAlt: number; heading: number; locked: boolean };
export type EnemyKind = "fighter" | "bomber" | "escort";
export type Alert = { x: number; y: number; text: string };
export type Target = {
  x: number; y: number; // screen %, on-screen position or edge position
  onScreen: boolean;
  angle: number; // radians, for the off-screen arrow
  dist: number; // metres
  dAlt: number; // + above you, - below
  kind: EnemyKind;
  locked: boolean;
};

export type Hud = {
  score: number;
  combo: number;
  eaten: number;
  speed: number;
  alt: number;
  throttle: number;
  boost: number; // reserve 0..1
  boosting: boolean;
  groundState: "rolling" | "airborne";
  compassAngle: number;
  compassNear: boolean;
  lockPitch: number; // radians, + = above you
  bank: number; // -1..1
  gForce: number; // felt acceleration 0..2, for HUD inertia
  comboFrac: number; // combo timer remaining 0..1
  msg: string;
  msgVisible: boolean;
  timeLeft: number;
  wave: number;
  waveBanner: string;
  countdown: string;
  hunger: number; // 0..1
  frenzy: number; // seconds left, 0 = off
  objectives: Objective[];
  boss: { hp: number; max: number } | null;
  timeOfDay: string;
  intro: { t: number; caption: string } | null;
  subtitle: { who: string; text: string } | null;
  caption: string;
  weather: "clear" | "rain";
  resumeIn: number; // >0 while the unpause countdown runs
  muted: boolean; // audio context not running (needs a gesture)
  rolling: boolean; // on the ground (touch HUD shows BRAKE)
  tier: "high" | "medium" | "low";
  toast: string;
  radar: RadarBlip[];
  alerts: Alert[];
  targets: Target[];
  lockDist: number | null;
};

export type RoundStats = {
  score: number;
  eaten: number;
  eatenByKind: Record<EnemyKind | "boss", number>;
  bestCombo: number;
  firstBite: number | null; // seconds
  objectives: Objective[];
  medal: "none" | "bronze" | "silver" | "gold";
  dateKey: string;
  highScore: number;
  isHighScore: boolean;
  unlocked: string | null; // livery name unlocked this round
};

export type State = {
  phase: Phase;
  options: Options;
  hud: Hud;
  round: RoundStats;
  progress: Progress;
  menuPage: "main" | "levels" | "controls" | "options";
  levelId: string; // the level being played / selected
  daily: boolean; // current run is the daily sortie
};

const OPTIONS_KEY = "sharkplane.options";
const HIGH_KEY = "sharkplane.highscore";
const PROGRESS_KEY = "sharkplane.progress";

const defaultOptions: Options = {
  invertY: true, sensitivity: 1, volume: 0.7, gamepad: true,
  quality: "high", fov: 70, shake: 1, colorblind: false, livery: 0,
  touch: typeof navigator !== "undefined" && /Android|iPhone|iPad/i.test(navigator.userAgent),
  scheme: "anywhere", autoThrottle: true, tiltInvert: false,
  music: 0.8, sfx: 1, ui: 0.8, captions: false, reducedMotion: false, highContrast: false, lang: "en", tutorialDone: false, qualitySet: false,
};
const defaultProgress: Progress = { totalEaten: 0, medals: 0, sorties: 0, bestScore: 0, levels: {} };
const emptyRound: RoundStats = {
  score: 0, eaten: 0, eatenByKind: { fighter: 0, bomber: 0, escort: 0, boss: 0 }, bestCombo: 0, firstBite: null,
  objectives: [], medal: "none", dateKey: "", highScore: 0, isHighScore: false, unlocked: null,
};

/** Read a stored value, but only accept keys/types that exist in the fallback; numbers are clamped to sane ranges. */
function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw || raw.length > 4096) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (typeof fallback !== "object" || fallback === null) {
      return typeof parsed === typeof fallback ? (typeof parsed === "number" ? (Math.max(0, Math.min(1e9, parsed)) as T) : (parsed as T)) : fallback;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return fallback;
    const out = { ...fallback } as Record<string, unknown>;
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!(k in out) || typeof v !== typeof out[k]) continue;
      out[k] = typeof v === "number" ? Math.max(0, Math.min(1e9, v)) : typeof v === "string" ? v.slice(0, 32) : v;
    }
    return out as T;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode etc. */ }
}

export const emptyHud: Hud = {
  score: 0, combo: 0, eaten: 0, speed: 0, alt: 0, throttle: 0, boost: 1, boosting: false,
  groundState: "rolling", compassAngle: 0, compassNear: false, lockPitch: 0, bank: 0, gForce: 0, comboFrac: 0, msg: "", msgVisible: false,
  timeLeft: 180, wave: 1, waveBanner: "", countdown: "", hunger: 1, frenzy: 0, objectives: [], boss: null, timeOfDay: "noon", intro: null, subtitle: null, caption: "", weather: "clear", resumeIn: 0, muted: true, rolling: true, tier: "high", toast: "",
  radar: [], alerts: [], targets: [], lockDist: null,
};

let state: State = {
  phase: "title",
  options: defaultOptions,
  hud: emptyHud,
  round: emptyRound,
  progress: defaultProgress,
  menuPage: "main",
  levelId: "bay",
  daily: false,
};

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const store = {
  get: () => state,
  set(patch: Partial<State>) {
    state = { ...state, ...patch };
    emit();
  },
  setHud(patch: Partial<Hud>) {
    state = { ...state, hud: { ...state.hud, ...patch } };
    emit();
  },
  setOptions(patch: Partial<Options>) {
    const options = { ...state.options, ...patch };
    save(OPTIONS_KEY, options);
    store.set({ options });
  },
  /** Call once on the client to pull persisted values in. */
  hydrate() {
    store.set({
      options: load(OPTIONS_KEY, defaultOptions),
      round: { ...state.round, highScore: load<number>(HIGH_KEY, 0) },
      progress: load(PROGRESS_KEY, defaultProgress),
    });
  },
  addProgress(patch: Partial<Progress>) {
    const progress = { ...state.progress, ...patch };
    save(PROGRESS_KEY, progress);
    store.set({ progress });
  },
  finishRound(stats: Omit<RoundStats, "highScore" | "isHighScore" | "unlocked">, levelId: string, stars: number) {
    const prev = load<number>(HIGH_KEY, 0);
    const isHighScore = stats.score > prev;
    if (isHighScore) save(HIGH_KEY, stats.score);
    const before = state.progress;
    const lv = before.levels[levelId] ?? { bestScore: 0, stars: 0, medals: 0, sorties: 0, bestCombo: 0 };
    const progress: Progress = {
      totalEaten: before.totalEaten + stats.eaten,
      medals: before.medals + (stats.medal === "none" ? 0 : 1),
      sorties: before.sorties + 1,
      bestScore: Math.max(before.bestScore, stats.score),
      levels: {
        ...before.levels,
        [levelId]: {
          bestScore: Math.max(lv.bestScore, stats.score),
          stars: Math.max(lv.stars, stars),
          medals: lv.medals + (stats.medal === "none" ? 0 : 1),
          sorties: lv.sorties + 1,
          bestCombo: Math.max(lv.bestCombo, stats.bestCombo),
        },
      },
    };
    save(PROGRESS_KEY, progress);
    store.set({ phase: "roundOver", progress, round: { ...stats, highScore: Math.max(prev, stats.score), isHighScore, unlocked: null } });
  },
  totalStars(): number { return Object.values(state.progress.levels).reduce((a, l) => a + l.stars, 0); },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => { listeners.delete(l); };
  },
};

export function useGame<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(state), () => selector(state));
}
