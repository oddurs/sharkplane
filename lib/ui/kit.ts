import * as THREE from "three";

/**
 * Low-poly UI kit: bevelled extruded shapes, a palette of flat-shaded materials, canvas text on quads, and springs.
 * Everything lives in an orthographic "UI units" space where 1 unit = 1 CSS pixel at the reference scale.
 */

export const PALETTE = {
  ink: 0x1b2a44, inkDark: 0x0f1a2e, cream: 0xfff6dc, yellow: 0xffd84a, orange: 0xff5d2e, red: 0xd6233a,
  blue: 0x3a8be0, sky: 0x8ad8ff, green: 0x4ac96b, white: 0xffffff, grey: 0x8a96a8,
} as const;
export type PaletteKey = keyof typeof PALETTE;

const mats = new Map<string, THREE.Material>();
export function mat(color: PaletteKey | number, opts: { opacity?: number; emissive?: number } = {}): THREE.Material {
  const hex = typeof color === "number" ? color : PALETTE[color];
  const key = `${hex}:${opts.opacity ?? 1}:${opts.emissive ?? 0}`;
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: hex, flatShading: true, transparent: (opts.opacity ?? 1) < 1, opacity: opts.opacity ?? 1, emissive: opts.emissive ?? 0 });
    mats.set(key, m);
  }
  return m;
}

const geos = new Map<string, THREE.BufferGeometry>();
function cached(key: string, build: () => THREE.BufferGeometry) {
  let g = geos.get(key);
  if (!g) { g = build(); geos.set(key, g); }
  return g;
}

const extrude = (shape: THREE.Shape, depth: number, bevel: number) =>
  new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 6 });

/** Skewed rectangle slab (the "sticker" silhouette), centred at origin, extruded toward +z. */
export function slab(w: number, h: number, depth = 8, skew = 0.06, bevel = 2.5) {
  return cached(`slab:${w}:${h}:${depth}:${skew}:${bevel}`, () => {
    const s = new THREE.Shape();
    const k = w * skew, j = h * skew * 0.6;
    s.moveTo(-w / 2 + k * 0.3, -h / 2 + j); s.lineTo(w / 2, -h / 2); s.lineTo(w / 2 - k * 0.4, h / 2 - j * 0.5); s.lineTo(-w / 2, h / 2); s.closePath();
    return extrude(s, depth, bevel);
  });
}

export function hexShape(r: number, rot = Math.PI / 6) {
  const s = new THREE.Shape();
  for (let i = 0; i < 6; i++) { const a = rot + (i * Math.PI) / 3; const x = Math.cos(a) * r, y = Math.sin(a) * r; if (i === 0) s.moveTo(x, y); else s.lineTo(x, y); }
  s.closePath();
  return s;
}
export function hexPuck(r: number, depth: number, bevel = 3) { return cached(`hex:${r}:${depth}:${bevel}`, () => extrude(hexShape(r), depth, bevel)); }
/** Hex ring (rim) */
export function hexRing(rOuter: number, rInner: number, depth: number) {
  return cached(`hexring:${rOuter}:${rInner}:${depth}`, () => { const s = hexShape(rOuter); const hole = hexShape(rInner); s.holes.push(hole); return extrude(s, depth, 1.5); });
}
/** Circular ring segment (for the combo gauge) */
export function arcSegment(rOuter: number, rInner: number, a0: number, a1: number, depth: number) {
  return cached(`arc:${rOuter}:${rInner}:${a0.toFixed(3)}:${a1.toFixed(3)}:${depth}`, () => {
    const s = new THREE.Shape();
    s.absarc(0, 0, rOuter, a0, a1, false);
    s.absarc(0, 0, rInner, a1, a0, true);
    s.closePath();
    return extrude(s, depth, 1);
  });
}
/** Pie sector (radar sweep) */
export function sector(r: number, a0: number, a1: number, depth: number) {
  return cached(`sector:${r}:${a0.toFixed(3)}:${a1.toFixed(3)}:${depth}`, () => { const s = new THREE.Shape(); s.moveTo(0, 0); s.absarc(0, 0, r, a0, a1, false); s.closePath(); return extrude(s, depth, 0); });
}
/** Arrowhead pointing +y, extruded */
export function dart(w: number, h: number, depth: number) {
  return cached(`dart:${w}:${h}:${depth}`, () => { const s = new THREE.Shape(); s.moveTo(0, h / 2); s.lineTo(w / 2, -h / 2); s.lineTo(0, -h / 4); s.lineTo(-w / 2, -h / 2); s.closePath(); return extrude(s, depth, 1.5); });
}
/** L-shaped bracket corner (top-left orientation), arm length `l`, thickness `t` */
export function corner(l: number, t: number, depth: number) {
  return cached(`corner:${l}:${t}:${depth}`, () => { const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(l, 0); s.lineTo(l, -t); s.lineTo(t, -t); s.lineTo(t, -l); s.lineTo(0, -l); s.closePath(); return extrude(s, depth, 1); });
}
/** Tiny plane silhouettes for radar contacts (top-down), pointing +y */
export function silhouette(kind: "fighter" | "bomber" | "escort" | "player", size: number) {
  return cached(`sil:${kind}:${size}`, () => {
    const s = new THREE.Shape(), u = size;
    if (kind === "bomber") { s.moveTo(0, u); s.lineTo(0.25 * u, 0.2 * u); s.lineTo(1.1 * u, 0.1 * u); s.lineTo(1.1 * u, -0.2 * u); s.lineTo(0.25 * u, -0.3 * u); s.lineTo(0.5 * u, -0.9 * u); s.lineTo(0, -0.8 * u); s.lineTo(-0.5 * u, -0.9 * u); s.lineTo(-0.25 * u, -0.3 * u); s.lineTo(-1.1 * u, -0.2 * u); s.lineTo(-1.1 * u, 0.1 * u); s.lineTo(-0.25 * u, 0.2 * u); }
    else if (kind === "player") { s.moveTo(0, u); s.lineTo(0.55 * u, -0.6 * u); s.lineTo(0, -0.3 * u); s.lineTo(-0.55 * u, -0.6 * u); }
    else { s.moveTo(0, u); s.lineTo(0.18 * u, 0.15 * u); s.lineTo(0.85 * u, 0); s.lineTo(0.85 * u, -0.22 * u); s.lineTo(0.18 * u, -0.25 * u); s.lineTo(0.35 * u, -0.8 * u); s.lineTo(0, -0.7 * u); s.lineTo(-0.35 * u, -0.8 * u); s.lineTo(-0.18 * u, -0.25 * u); s.lineTo(-0.85 * u, -0.22 * u); s.lineTo(-0.85 * u, 0); s.lineTo(-0.18 * u, 0.15 * u); }
    s.closePath();
    return extrude(s, size * 0.35, 0);
  });
}

// ---------- text ----------
let fontFamily = "Arial Black, Impact, sans-serif";
export function resolveFont() {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--font-display").trim();
    if (v) fontFamily = `${v}, ${fontFamily}`;
    void document.fonts?.load(`32px ${v.split(",")[0]}`);
  } catch { /* SSR or no fonts API */ }
}

type TextOpts = { size: number; color?: string; stroke?: string; font?: "display" | "body"; align?: "left" | "center" | "right"; maxWidth?: number; weight?: string };
const textCache = new Map<string, { tex: THREE.CanvasTexture; w: number; h: number }>();

/** Render text to a cached canvas texture (2× DPR, ink stroke for the sticker look). */
export function textTexture(text: string, o: TextOpts) {
  const key = `${text}|${o.size}|${o.color}|${o.stroke}|${o.font}|${o.align}|${o.maxWidth}`;
  const hit = textCache.get(key);
  if (hit) return hit;
  const dpr = Math.min(2, Math.max(1, typeof devicePixelRatio === "number" ? devicePixelRatio : 1));
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  const font = `${o.weight ?? ""} ${o.size * dpr}px ${o.font === "body" ? "Arial, Helvetica, sans-serif" : fontFamily}`.trim();
  ctx.font = font;
  const metrics = ctx.measureText(text);
  const pad = o.size * 0.25 * dpr;
  let w = Math.ceil(metrics.width + pad * 2);
  const h = Math.ceil(o.size * 1.3 * dpr + pad);
  if (o.maxWidth) w = Math.min(w, Math.ceil(o.maxWidth * dpr));
  c.width = Math.max(2, w); c.height = h;
  ctx.font = font; ctx.textBaseline = "middle"; ctx.textAlign = o.align ?? "center";
  const x = o.align === "left" ? pad : o.align === "right" ? w - pad : w / 2;
  if (o.stroke) { ctx.lineJoin = "round"; ctx.lineWidth = o.size * 0.14 * dpr; ctx.strokeStyle = o.stroke; ctx.strokeText(text, x, h / 2, w - pad * 2); }
  ctx.fillStyle = o.color ?? "#fff";
  ctx.fillText(text, x, h / 2, w - pad * 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.anisotropy = 4;
  const entry = { tex, w: w / dpr, h: h / dpr };
  if (textCache.size > 400) { const first = textCache.keys().next().value!; textCache.get(first)!.tex.dispose(); textCache.delete(first); }
  textCache.set(key, entry);
  return entry;
}

/** A quad showing `text`, re-textured only when the string changes. */
export class Label extends THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  private current = "";
  w = 0; h = 0;
  constructor(private opts: TextOpts) {
    super(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false }));
    this.renderOrder = 10;
  }
  set(text: string) {
    if (text === this.current) return;
    this.current = text;
    if (!text) { this.visible = false; return; }
    this.visible = true;
    const t = textTexture(text, this.opts);
    this.material.map = t.tex; this.material.needsUpdate = true;
    this.scale.set(t.w, t.h, 1); this.w = t.w; this.h = t.h;
  }
  get text() { return this.current; }
}

// ---------- springs ----------
/** Critically-damped-ish spring for one value. */
export class Spring {
  v = 0;
  constructor(public x: number, public target: number = x, private k = 180, private d = 18) {}
  update(dt: number) {
    const a = (this.target - this.x) * this.k - this.v * this.d;
    this.v += a * dt; this.x += this.v * dt;
    return this.x;
  }
  set(x: number) { this.x = x; this.target = x; this.v = 0; }
  kick(impulse: number) { this.v += impulse; }
}
