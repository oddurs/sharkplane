import * as THREE from "three";

/**
 * Level definitions: each level is a terrain recipe, a palette, a wave table, a boss and one gimmick.
 * Everything stays procedural — a level is ~40 lines of numbers and two small functions.
 */

export type BossKind = "zeppelin" | "twin" | "lifter" | "blimp" | "rival";
export type Gimmick = "none" | "gusts" | "convoy" | "dark" | "volcano";

/** Boss sighting banners. The rival announces itself separately — it arrives in stages. */
export const BOSS_BANNER: Record<Exclude<BossKind, "rival">, string> = {
  zeppelin: "ZEPPELIN SIGHTED",
  twin: "TWO ZEPPELINS SIGHTED",
  lifter: "CARGO LIFTER SIGHTED",
  blimp: "SEARCHLIGHT BLIMP SIGHTED",
};

export type LevelDef = {
  id: string;
  name: string;
  tagline: string;
  /** Raw height before the runway pad and sea clamp. */
  height: (x: number, z: number) => number;
  /** Vertex colour for an average face height. */
  band: (h: number) => number;
  times: readonly ("dawn" | "noon" | "sunset" | "dusk")[];
  rainChance: number;
  /** Lava level: the "water" plane is emissive orange and touching it is always a crash. */
  lava?: boolean;
  waves: { base: number; perWave: number; bomberFrom: number; escortFrom: number; enemySpeed: number };
  bossEvery: number;
  boss: BossKind;
  roundTime: number;
  gimmick: Gimmick;
  /** Total stars required to unlock (0/1/3/5/7). Every gate is clearable at a 2-star pace — never near-perfection. */
  unlockStars: number;
};

const smoothstep = THREE.MathUtils.smoothstep;

/** The original island — level 0, byte-identical to the pre-level build. */
function bayHeight(x: number, z: number) {
  const m = Math.sin(x * 0.0023 + 1.3) * Math.cos(z * 0.0019 - 0.4) + 0.55 * Math.sin(x * 0.0041 - z * 0.0037 + 0.7);
  const d = Math.sin(x * 0.011) * Math.cos(z * 0.009) + 0.5 * Math.sin(x * 0.027 + z * 0.019) + 0.25 * Math.sin(z * 0.05 - x * 0.031);
  let h = m * 38 + d * 16 - 4;
  if (h > 6) h += 8 * smoothstep(h, 6, 18);
  const pd = Math.hypot(x + 620, z + 520);
  h += 150 * Math.exp(-(pd * pd) / (2 * 190 * 190));
  return h;
}

const bayBand = (h: number) =>
  h < -7 ? 0x174a85 : h < -3 ? 0x1f5fa8 : h < -0.35 ? 0x3d86c9 : h < 0.2 ? 0xfff6dc : h < 0.8 ? 0xe8d9a0 :
  h < 4 ? 0xd9c77a : h < 28 ? 0x5fae3f : h < 55 ? 0x3f8a3a : h < 95 ? 0x8a6f4a : h < 125 ? 0x6f6a66 : 0xf4f4f8;

/** Parallel glacial canyons: ridges along a diagonal with water threading the floors. */
function fjordHeight(x: number, z: number) {
  const along = x * 0.707 + z * 0.707, across = x * 0.707 - z * 0.707;
  const ridge = Math.abs(Math.sin(across * 0.006 + Math.sin(along * 0.0015) * 1.2)); // 0 at canyon floor, 1 at crest
  const spine = Math.pow(ridge, 1.4) * 95 - 18;
  const d = Math.sin(x * 0.013) * Math.cos(z * 0.011) * 8 + Math.sin(along * 0.03) * 5;
  const bowl = smoothstep(Math.hypot(x, z), 1500, 2000) * -40; // open sea past the coast
  return spine + d + bowl;
}
const fjordBand = (h: number) =>
  h < -6 ? 0x123f5e : h < -0.35 ? 0x1e5f7a : h < 0.2 ? 0xe8f2f4 : h < 3 ? 0x9fb7a8 : h < 30 ? 0x4f7a52 :
  h < 60 ? 0x3d5c48 : h < 85 ? 0x6f7a80 : 0xeef4f8;

/** Rolling dune field, essentially dry. */
function duneHeight(x: number, z: number) {
  const d1 = Math.sin(x * 0.008 + Math.sin(z * 0.004) * 2) * 14; // rolling crests, folded positive so the field stays dry
  const d2 = Math.sin((x * 0.6 + z) * 0.011 + 1) * 9;
  const d3 = Math.sin(z * 0.021 - x * 0.006) * 5;
  const mesa = Math.pow(Math.max(0, Math.sin(x * 0.0016 - 1) * Math.cos(z * 0.0019 + 0.5)), 3) * 90;
  const pans = -16 * smoothstep(Math.sin(x * 0.0013 + 0.4) * Math.cos(z * 0.0011 - 1.2), 0.88, 0.98); // rare salt pans
  return 5 + (d1 + 14) * 0.7 + d2 * 0.35 + d3 * 0.3 + mesa + pans;
}
const duneBand = (h: number) =>
  h < 0.2 ? 0xd7f0f2 : h < 2 ? 0xf3ecd7 : h < 14 ? 0xe6cf9a : h < 26 ? 0xd9b878 : h < 45 ? 0xc9a26b : h < 75 ? 0xa87b4e : 0x8a5f3a;

/** Harbour flats: low islands, big bay, city grid rises from the shore. */
function harborHeight(x: number, z: number) {
  const m = Math.sin(x * 0.0021 - 0.4) * Math.cos(z * 0.0024 + 0.9) * 24 - 6;
  const d = Math.sin(x * 0.015) * Math.cos(z * 0.012) * 5 + Math.sin(x * 0.03 + z * 0.02) * 3;
  const hill = Math.pow(Math.max(0, Math.sin(x * 0.0028 + 2) * Math.cos(z * 0.002 - 1.4)), 2) * 55;
  return m + d + hill;
}
const harborBand = (h: number) =>
  h < -6 ? 0x0d2438 : h < -0.35 ? 0x143a52 : h < 0.2 ? 0x9fb4c4 : h < 2 ? 0x5c6470 : h < 20 ? 0x3d4a3f :
  h < 45 ? 0x2f3d33 : 0x55606a;

/** Volcanic caldera: a great cone with lava pools in the lowlands. */
function calderaHeight(x: number, z: number) {
  const pd = Math.hypot(x + 150, z + 500);
  const cone = 190 * Math.exp(-(pd * pd) / (2 * 420 * 420));
  const crater = -150 * Math.exp(-(pd * pd) / (2 * 110 * 110));
  const d = Math.sin(x * 0.012) * Math.cos(z * 0.01) * 10 + Math.sin(x * 0.028 - z * 0.022) * 6;
  const fields = Math.sin(x * 0.003 + 0.8) * Math.cos(z * 0.0026 - 0.2) * 18 - 8;
  return cone + crater + d + fields;
}
const calderaBand = (h: number) =>
  h < -6 ? 0xff5d2e : h < -0.35 ? 0xff8a3a : h < 0.2 ? 0x2a1d1a : h < 3 ? 0x3a2a24 : h < 25 ? 0x54423a :
  h < 60 ? 0x6a5248 : h < 110 ? 0x4a3a36 : h < 150 ? 0x2f2a28 : 0xd94a20;

export const LEVELS: readonly LevelDef[] = [
  {
    id: "bay", name: "Sharkfall Bay", tagline: "Home waters. Easy pickings.",
    height: bayHeight, band: bayBand, times: ["dawn", "noon", "sunset", "dusk"], rainChance: 0.3,
    waves: { base: 7, perWave: 2, bomberFrom: 2, escortFrom: 3, enemySpeed: 1 },
    bossEvery: 3, boss: "zeppelin", roundTime: 180, gimmick: "none", unlockStars: 0,
  },
  {
    id: "fjord", name: "Fjord Run", tagline: "Thread the canyons. Mind the crosswind.",
    height: fjordHeight, band: fjordBand, times: ["dawn", "noon", "dusk"], rainChance: 0.45,
    waves: { base: 8, perWave: 2, bomberFrom: 2, escortFrom: 2, enemySpeed: 1.05 },
    bossEvery: 3, boss: "twin", roundTime: 180, gimmick: "gusts", unlockStars: 1,
  },
  {
    id: "dunes", name: "Dune Sea", tagline: "Cargo convoys, nowhere to hide.",
    height: duneHeight, band: duneBand, times: ["dawn", "noon", "sunset"], rainChance: 0,
    waves: { base: 7, perWave: 3, bomberFrom: 1, escortFrom: 4, enemySpeed: 1 },
    bossEvery: 3, boss: "lifter", roundTime: 180, gimmick: "convoy", unlockStars: 3,
  },
  {
    id: "harbor", name: "Midnight Harbor", tagline: "They can't see you. You can't see them.",
    height: harborHeight, band: harborBand, times: ["dusk"], rainChance: 0.35,
    waves: { base: 9, perWave: 2, bomberFrom: 2, escortFrom: 3, enemySpeed: 1.05 },
    bossEvery: 3, boss: "blimp", roundTime: 180, gimmick: "dark", unlockStars: 5,
  },
  {
    id: "caldera", name: "The Caldera", tagline: "Lava forgives nothing. Neither does the rival.",
    height: calderaHeight, band: calderaBand, times: ["sunset", "dusk"], rainChance: 0.5,
    lava: true,
    waves: { base: 9, perWave: 3, bomberFrom: 1, escortFrom: 2, enemySpeed: 1.15 },
    bossEvery: 3, boss: "rival", roundTime: 210, gimmick: "volcano", unlockStars: 7,
  },
];

let active: LevelDef = LEVELS[0];
export function setLevel(l: LevelDef) { active = l; }
export function getLevel(): LevelDef { return active; }
export function levelById(id: string): LevelDef { return LEVELS.find((l) => l.id === id) ?? LEVELS[0]; }

/** The daily sortie rotates through unlocked levels by date. */
export function dailyLevel(dateKey: string, unlockedCount: number): LevelDef {
  let h = 0;
  for (const ch of dateKey) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return LEVELS[h % Math.max(1, Math.min(unlockedCount, LEVELS.length))];
}

/** Stars: 1 = any medal · 2 = silver+ and both objectives · 3 = gold. */
export function starsFor(medal: "none" | "bronze" | "silver" | "gold", objectivesDone: number): number {
  if (medal === "gold") return 3;
  if ((medal === "silver") && objectivesDone >= 2) return 2;
  return medal === "none" ? 0 : 1;
}
