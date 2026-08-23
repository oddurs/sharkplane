import * as THREE from "three";
import { loft, onSkin, sectionAt, type Section } from "./loft";
import type { EnemyKind } from "./store";

const mat = (color: number) => new THREE.MeshLambertMaterial({ color, flatShading: true });
const glass = () => new THREE.MeshPhongMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0.45, shininess: 120, flatShading: true });

export type PlaneModel = {
  group: THREE.Group;
  prop: THREE.Group;
  propDisc: THREE.Mesh;
  jaw: THREE.Group | null;
  gear: THREE.Group | null;
  wingtips: [THREE.Object3D, THREE.Object3D];
  exhausts: THREE.Vector3[];
  /** Parts that fly off when the plane is eaten. */
  parts: THREE.Mesh[];
  /** Enemy only: show scared eyes. */
  setScared?: (on: boolean) => void;
};

export type Livery = {
  name: string; top: number; belly: number; mouth: number; teeth: number; spinner: number;
  roundel: [number, number, number]; eye: number; glow?: boolean; doubleTeeth?: boolean; unlockAt: number;
};
export const LIVERIES: readonly Livery[] = [
  { name: "Flying Tiger", top: 0x5b6b3a, belly: 0x9aa7b0, mouth: 0xd6233a, teeth: 0xffffff, spinner: 0xd6233a, roundel: [0x1b3a8a, 0xffffff, 0xd6233a], eye: 0xffffff, unlockAt: 0 },
  { name: "Desert Fang", top: 0xc9a26b, belly: 0x8fb0d0, mouth: 0xd6233a, teeth: 0xffffff, spinner: 0x3a8be0, roundel: [0x3a8be0, 0xffffff, 0xd6233a], eye: 0xffffff, unlockAt: 10 },
  { name: "Night Hunter", top: 0x23262d, belly: 0x3a3f4a, mouth: 0xd6233a, teeth: 0xbfc4c9, spinner: 0x23262d, roundel: [0x444a55, 0x23262d, 0xd6233a], eye: 0xffd84a, unlockAt: 50 },
  { name: "Bare Metal", top: 0xcfd4d8, belly: 0xe8ecef, mouth: 0xd6233a, teeth: 0xffffff, spinner: 0xffd84a, roundel: [0x1b3a8a, 0xffffff, 0xd6233a], eye: 0xffffff, unlockAt: 200 },
  { name: "Megalodon", top: 0x2b4a70, belly: 0xcfe0f0, mouth: 0x8c0f22, teeth: 0xfff7d0, spinner: 0x2b4a70, roundel: [0x0b1a2e, 0xcfe0f0, 0x8c0f22], eye: 0xff4020, glow: true, doubleTeeth: true, unlockAt: 1000 },
];

type Scheme = { top: number; belly: number; marking: "roundel" | "meatball" | "cross"; colors: [number, number, number] };
const SCHEMES: Scheme[] = [
  { top: 0x4f6b3a, belly: 0xb9c2c8, marking: "roundel", colors: [0x1b3a8a, 0xffffff, 0xc9302c] },
  { top: 0x6b6f5a, belly: 0x9fb7c8, marking: "cross", colors: [0x111111, 0xffffff, 0x111111] },
  { top: 0x3f5a3a, belly: 0xd8d8d0, marking: "meatball", colors: [0xffffff, 0xc9302c, 0xc9302c] },
  { top: 0x5a5f3a, belly: 0x8a9099, marking: "roundel", colors: [0x1b3a8a, 0xffffff, 0x1b3a8a] },
  { top: 0x8a3a2a, belly: 0xd9c9a0, marking: "meatball", colors: [0xffffff, 0x1b3a8a, 0x1b3a8a] },
];

function shadowed<T extends THREE.Object3D>(o: T): T { o.castShadow = true; return o; }

function marking(style: Scheme["marking"], c: [number, number, number], r = 0.7) {
  const g = new THREE.Group();
  if (style === "cross") {
    const a = new THREE.Mesh(new THREE.BoxGeometry(r * 2, 0.06, r * 0.6), mat(c[0]));
    const b = new THREE.Mesh(new THREE.BoxGeometry(r * 0.6, 0.06, r * 2), mat(c[0]));
    const bg = new THREE.Mesh(new THREE.BoxGeometry(r * 2.3, 0.05, r * 2.3), mat(c[1]));
    g.add(bg, a, b);
  } else {
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.06, 10), mat(c[0])));
    if (style === "roundel") g.add(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.62, r * 0.62, 0.08, 10), mat(c[1])));
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(r * (style === "roundel" ? 0.28 : 0.6), r * (style === "roundel" ? 0.28 : 0.6), 0.1, 10), mat(c[2])));
  }
  return g;
}

/** Hull profiles, nose at -Z. */
const FIGHTER_HULL: Section[] = [
  { z: -5.2, w: 0.35, h: 0.35, y: -0.05 },
  { z: -4.6, w: 1.1, h: 1.15, y: -0.05 },
  { z: -3.4, w: 1.25, h: 1.4, y: 0 },
  { z: -2.0, w: 1.2, h: 1.35, y: 0.02 },
  { z: -0.4, w: 1.05, h: 1.25, y: 0.05 },
  { z: 1.4, w: 0.8, h: 1.0, y: 0.12 },
  { z: 3.2, w: 0.5, h: 0.7, y: 0.22 },
  { z: 4.8, w: 0.22, h: 0.35, y: 0.3 },
];
const BOMBER_HULL: Section[] = [
  { z: -6.2, w: 0.9, h: 0.9, y: -0.1 },
  { z: -4.8, w: 1.5, h: 1.5, y: 0 },
  { z: -2.0, w: 1.7, h: 1.7, y: 0.05 },
  { z: 1.0, w: 1.6, h: 1.6, y: 0.1 },
  { z: 4.0, w: 1.0, h: 1.1, y: 0.25 },
  { z: 6.5, w: 0.4, h: 0.5, y: 0.4 },
];

/** Common parts: wings, tail, prop, canopy, gear, exhausts. */
function airframe(g: THREE.Group, hull: Section[], top: number, belly: number, opts: { span: number; twinFin?: boolean; biplane?: boolean; spinner: number; propZ: number }) {
  const parts: THREE.Mesh[] = [];
  const body = shadowed(new THREE.Mesh(loft(hull, 8), mat(top)));
  g.add(body); parts.push(body);
  // belly: lower half shell in the second colour
  const bellyShell = shadowed(new THREE.Mesh(loft(hull.map((s) => ({ ...s, w: s.w * 1.02, h: s.h * 1.02, arc: [Math.PI + 0.25, 2 * Math.PI - 0.25] })), 8, false), mat(belly)));
  g.add(bellyShell);

  const wingZ = -0.6;
  const wing = shadowed(new THREE.Mesh(new THREE.BoxGeometry(opts.span, 0.22, 2.4), mat(top)));
  wing.position.set(0, -0.35, wingZ); g.add(wing); parts.push(wing);
  const wingBelly = new THREE.Mesh(new THREE.BoxGeometry(opts.span, 0.06, 2.4), mat(belly));
  wingBelly.position.set(0, -0.49, wingZ); g.add(wingBelly);
  const leading = new THREE.Mesh(new THREE.BoxGeometry(opts.span, 0.24, 0.25), mat(0xcfd4d8));
  leading.position.set(0, -0.35, wingZ - 1.2); g.add(leading);
  if (opts.biplane) {
    const upper = shadowed(new THREE.Mesh(new THREE.BoxGeometry(opts.span, 0.2, 2.2), mat(top)));
    upper.position.set(0, 2.1, wingZ - 0.3); g.add(upper); parts.push(upper);
    for (const x of [-opts.span * 0.36, opts.span * 0.36]) for (const s of [-1, 1]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.6, 0.14), mat(0x333333));
      strut.position.set(x + s * 0.5, 0.85, wingZ - 0.3 + s * 0.6); strut.rotation.x = s * 0.45; g.add(strut);
    }
  }
  const tailZ = hull[hull.length - 1].z - 1.0, tailY = (hull[hull.length - 1].y ?? 0) + 0.1;
  const tailH = shadowed(new THREE.Mesh(new THREE.BoxGeometry(opts.span * 0.36, 0.16, 1.3), mat(top)));
  tailH.position.set(0, tailY, tailZ); g.add(tailH); parts.push(tailH);
  if (opts.twinFin) {
    for (const s of [-1, 1]) {
      const fin = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.8, 1.3), mat(top)));
      fin.position.set(s * opts.span * 0.18, tailY + 0.9, tailZ); g.add(fin); parts.push(fin);
    }
  } else {
    const fin = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.9, 1.6), mat(top)));
    fin.position.set(0, tailY + 0.95, tailZ + 0.1); fin.rotation.x = -0.15; g.add(fin); parts.push(fin);
  }
  // tail wheel
  const tw = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.15, 8), mat(0x222222));
  tw.rotation.z = Math.PI / 2; tw.position.set(0, tailY - 0.75, tailZ); g.add(tw);

  // canopy: framed 3-panel glass
  const cz = sectionAt(hull, -1.0);
  const canopy = new THREE.Group();
  const glassMesh = new THREE.Mesh(loft([
    { z: -2.0, w: 0.05, h: 0.05, y: cz.h * 0.9 },
    { z: -1.3, w: 0.55, h: 0.6, y: cz.h * 0.85 },
    { z: 0.2, w: 0.55, h: 0.6, y: cz.h * 0.85 },
    { z: 1.4, w: 0.05, h: 0.05, y: cz.h * 0.9 },
  ], 6), glass());
  canopy.add(glassMesh);
  for (const z of [-1.3, -0.5, 0.2]) {
    const frame = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.04, 4, 8, Math.PI), mat(0x333333));
    frame.position.set(0, cz.h * 0.85, z); canopy.add(frame);
  }
  g.add(canopy);

  // prop + spinner + translucent disc
  const prop = new THREE.Group();
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.4, 1.0, 8), mat(opts.spinner));
  spinner.rotation.x = -Math.PI / 2; spinner.position.z = -0.4; prop.add(spinner);
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Group();
    const root = new THREE.Mesh(new THREE.BoxGeometry(0.26, 2.6, 0.08), mat(0x222222)); root.position.y = 1.3;
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.5, 0.08), mat(0xffd84a)); tip.position.y = 2.85;
    blade.add(root, tip); blade.rotation.z = (i * Math.PI * 2) / 3; prop.add(blade);
  }
  prop.position.z = opts.propZ; g.add(prop);
  const propDisc = new THREE.Mesh(new THREE.CircleGeometry(3.1, 18), new THREE.MeshBasicMaterial({ color: 0xbbbbbb, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
  propDisc.position.z = opts.propZ; propDisc.visible = false; g.add(propDisc);

  // exhaust stacks along the cowl sides
  const exhausts: THREE.Vector3[] = [];
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
    const z = -3.6 + i * 0.45;
    const sec = sectionAt(hull, z);
    const p = onSkin(sec, s > 0 ? -0.25 : Math.PI + 0.25, 0.05);
    const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.45, 5), mat(0x3a3a3a));
    ex.rotation.z = Math.PI / 2; ex.rotation.y = s * 0.5; ex.position.copy(p); g.add(ex);
    if (i === 2) exhausts.push(p.clone().add(new THREE.Vector3(s * 0.3, 0, 0.4)));
  }

  // oil streak along the belly
  const streak = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.03, 3.5), mat(0x2a2a2a));
  streak.position.set(0.3, -1.25, 0.6); g.add(streak);

  // retractable gear
  const gear = new THREE.Group();
  const strutGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.1, 4), wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.26, 8);
  for (const x of [-1.7, 1.7]) {
    const strut = new THREE.Mesh(strutGeo, mat(0x444444)); strut.position.set(x, -1.0, wingZ - 0.3);
    const wheel = new THREE.Mesh(wheelGeo, mat(0x222222)); wheel.rotation.z = Math.PI / 2; wheel.position.set(x, -1.55, wingZ - 0.3);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.3, 8), mat(0xbbbbbb)); hub.rotation.z = Math.PI / 2; hub.position.copy(wheel.position);
    gear.add(strut, wheel, hub);
  }
  g.add(gear);

  const tipL = new THREE.Object3D(); tipL.position.set(-opts.span / 2, -0.35, wingZ);
  const tipR = new THREE.Object3D(); tipR.position.set(opts.span / 2, -0.35, wingZ);
  g.add(tipL, tipR);
  return { parts, prop, propDisc, gear, exhausts, wingtips: [tipL, tipR] as [THREE.Object3D, THREE.Object3D], wingZ };
}

/** Painted shark mouth that comes alive: red lip shells, zig-zag teeth, dark throat, hinged lower jaw. */
function sharkMouth(g: THREE.Group, hull: Section[], liv: Livery) {
  const zFront = -5.0, zBack = -2.2;
  const grin = (z: number) => 0.08 + 0.42 * ((z - zFront) / (zBack - zFront)); // lip angle above horizontal, rising toward the rear
  const lipSections = (sign: 1 | -1, scale: number, inset = 0): Section[] => {
    const out: Section[] = [];
    for (let z = zFront; z <= zBack + 1e-6; z += (zBack - zFront) / 6) {
      const s = sectionAt(hull, z);
      const t = grin(z);
      // upper band (sign=1): from lip up a little; lower band (sign=-1): from lip down to the belly
      const arc: [number, number] = sign > 0 ? [t, Math.PI - t] : [Math.PI - t, 2 * Math.PI + t];
      out.push({ z, w: s.w * scale + inset, h: s.h * scale + inset, y: s.y, arc });
    }
    return out;
  };
  // upper lip: thin red band just above the lip line (the "gum")
  const upperLip = new THREE.Mesh(loft(lipSections(1, 1.03).map((s) => ({ ...s, arc: [s.arc![0], s.arc![0] + 0.28] })), 6, false), mat(liv.mouth));
  const upperLipR = new THREE.Mesh(loft(lipSections(1, 1.03).map((s) => ({ ...s, arc: [s.arc![1] - 0.28, s.arc![1]] })), 6, false), mat(liv.mouth));
  g.add(upperLip, upperLipR);
  // dark throat (part of the hull, revealed when the jaw drops)
  const throat = new THREE.Mesh(loft(lipSections(-1, 0.97), 8, false), mat(0x1a0a0c));
  g.add(throat);
  // lower jaw: red shell + lower teeth, hinged at the rear of the mouth
  const jaw = new THREE.Group();
  jaw.position.set(0, 0, zBack);
  const lowerShell = new THREE.Mesh(loft(lipSections(-1, 1.04).map((s) => ({ ...s, z: s.z - zBack })), 8, false), mat(liv.mouth));
  jaw.add(lowerShell);
  g.add(jaw);
  // teeth: zig-zag along each lip line
  const toothGeo = new THREE.ConeGeometry(0.11, 0.42, 4);
  const rows = liv.doubleTeeth ? 2 : 1;
  for (const side of [-1, 1] as const) {
    for (let z = zFront + 0.35; z < zBack - 0.15; z += 0.34) {
      const s = sectionAt(hull, z);
      const t = grin(z);
      const phi = side > 0 ? t : Math.PI - t;
      const p = onSkin(s, phi, 0.05);
      for (let r = 0; r < rows; r++) {
        const up = new THREE.Mesh(toothGeo, mat(liv.teeth));
        up.rotation.x = Math.PI; up.rotation.z = side * 0.25;
        up.position.copy(p).add(new THREE.Vector3(side * r * 0.12, 0.02 - r * 0.15, 0));
        g.add(up);
        const lo = new THREE.Mesh(toothGeo, mat(liv.teeth));
        lo.rotation.z = -side * 0.25;
        lo.position.copy(p).add(new THREE.Vector3(side * r * 0.12, -0.3 + r * 0.15, -zBack));
        jaw.add(lo);
      }
    }
  }
  // eyes: almond decals above the mouth, angry brow
  for (const side of [-1, 1] as const) {
    const s = sectionAt(hull, -3.3);
    const p = onSkin(s, side > 0 ? 0.95 : Math.PI - 0.95, 0.04);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), liv.glow ? new THREE.MeshBasicMaterial({ color: liv.eye }) : mat(liv.eye));
    eye.scale.set(1.3, 0.7, 0.25); eye.position.copy(p); eye.lookAt(p.clone().multiplyScalar(3).setZ(p.z)); g.add(eye);
    const iris = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 5), mat(0x111111));
    iris.position.copy(onSkin(s, side > 0 ? 0.9 : Math.PI - 0.9, 0.12)).add(new THREE.Vector3(0, -0.02, -0.15)); g.add(iris);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.16, 0.12), mat(0x1a1a1a));
    brow.position.copy(onSkin(s, side > 0 ? 1.25 : Math.PI - 1.25, 0.05)); brow.rotation.z = side * 0.55; brow.rotation.y = side * 0.6; g.add(brow);
  }
  // chin radiator scoop the mouth "eats" around
  const scoop = shadowed(new THREE.Mesh(loft([
    { z: -4.3, w: 0.55, h: 0.35, y: -1.35 }, { z: -3.2, w: 0.7, h: 0.5, y: -1.45 }, { z: -1.6, w: 0.55, h: 0.4, y: -1.4 },
  ], 6), mat(liv.top)));
  g.add(scoop);
  return jaw;
}

/** Low-poly WW2-style single-prop plane, nose facing -Z. */
export function makePlane(colorIndex: number, opts: { livery?: Livery; kind?: EnemyKind } = {}): PlaneModel {
  const g = new THREE.Group();
  const kind = opts.kind ?? "fighter";
  const liv = opts.livery;
  const scheme = SCHEMES[Math.abs(colorIndex) % SCHEMES.length];
  const top = liv ? liv.top : scheme.top, belly = liv ? liv.belly : scheme.belly;
  const hull = kind === "bomber" ? BOMBER_HULL : FIGHTER_HULL;
  const af = airframe(g, hull, top, belly, {
    span: kind === "bomber" ? 18 : 12, twinFin: kind === "bomber", biplane: kind === "escort",
    spinner: liv ? liv.spinner : scheme.colors[2], propZ: hull[0].z - 0.3,
  });
  const parts = af.parts;

  if (kind === "bomber") {
    // glazed nose + wing nacelles with their own props
    const nose = new THREE.Mesh(loft([{ z: -7.4, w: 0.2, h: 0.2, y: -0.1 }, { z: -6.2, w: 0.9, h: 0.9, y: -0.1 }], 8), glass());
    g.add(nose);
    af.prop.visible = false; af.propDisc.visible = false;
    for (const s of [-1, 1]) {
      const nac = shadowed(new THREE.Mesh(loft([{ z: -3.2, w: 0.5, h: 0.5 }, { z: -2.4, w: 0.85, h: 0.85 }, { z: 0.6, w: 0.75, h: 0.75 }, { z: 2.0, w: 0.3, h: 0.3 }], 6), mat(top)));
      nac.position.set(s * 5, -0.2, af.wingZ); g.add(nac); parts.push(nac);
      const pr = new THREE.Group();
      for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.4, 0.08), mat(0x222222)); b.rotation.z = i * Math.PI * 2 / 3; pr.add(b); }
      pr.position.set(s * 5, -0.2, af.wingZ - 3.5); g.add(pr);
      pr.name = "nacelleProp";
    }
  }

  // markings
  const mk = liv ? { style: "roundel" as const, colors: liv.roundel } : { style: scheme.marking, colors: scheme.colors };
  for (const s of [-1, 1]) {
    const m = marking(mk.style, mk.colors, kind === "bomber" ? 0.9 : 0.7);
    m.position.set(s * (kind === "bomber" ? 6.5 : 4.1), -0.22, af.wingZ); g.add(m);
    const side = marking(mk.style, mk.colors, 0.5);
    const sec = sectionAt(hull, 1.2);
    side.position.copy(onSkin(sec, s > 0 ? 0 : Math.PI, 0.04)); side.rotation.z = Math.PI / 2; g.add(side);
  }

  let jaw: THREE.Group | null = null;
  let setScared: PlaneModel["setScared"];
  if (liv) {
    jaw = sharkMouth(g, hull, liv);
    // dorsal fin on the spine
    const fin = shadowed(new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.7, 3), mat(liv.top)));
    fin.scale.set(0.22, 1, 1); fin.rotation.x = -0.35; fin.position.set(0, 1.75, 1.6); g.add(fin);
  } else {
    // scared-eyes decal, hidden until they spot you
    const eyes = new THREE.Group();
    for (const s of [-1, 1]) {
      const sec = sectionAt(hull, -3.6);
      const p = onSkin(sec, s > 0 ? 0.6 : Math.PI - 0.6, 0.05);
      const w = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      w.scale.set(1, 1.2, 0.3); w.position.copy(p); w.lookAt(p.clone().multiplyScalar(3).setZ(p.z));
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.13, 6, 5), new THREE.MeshBasicMaterial({ color: 0x111111 }));
      pupil.position.copy(onSkin(sec, s > 0 ? 0.55 : Math.PI - 0.55, 0.14)).add(new THREE.Vector3(0, 0.1, 0.05));
      eyes.add(w, pupil);
    }
    eyes.visible = false; g.add(eyes);
    setScared = (on) => { eyes.visible = on; };
  }

  return { group: g, prop: af.prop, propDisc: af.propDisc, jaw, gear: af.gear, wingtips: af.wingtips, exhausts: af.exhausts, parts, setScared };
}

/** The boss: a zeppelin with glowing weak points. Nose faces -Z. */
export function makeZeppelin(): { group: THREE.Group; weakPoints: THREE.Mesh[]; parts: THREE.Mesh[]; props: THREE.Group[] } {
  const g = new THREE.Group();
  const parts: THREE.Mesh[] = [];
  const hull = shadowed(new THREE.Mesh(loft([
    { z: -30, w: 1, h: 1 }, { z: -22, w: 6, h: 6 }, { z: -8, w: 9, h: 9 }, { z: 8, w: 9, h: 9 }, { z: 22, w: 6, h: 6 }, { z: 30, w: 1.5, h: 1.5 },
  ], 12), mat(0xb8b2a0)));
  g.add(hull); parts.push(hull);
  const stripe = new THREE.Mesh(loft([{ z: -9, w: 9.1, h: 9.1, arc: [0.2, 1.2] }, { z: 9, w: 9.1, h: 9.1, arc: [0.2, 1.2] }], 6, false), mat(0xc9302c));
  g.add(stripe);
  for (let i = 0; i < 4; i++) {
    const fin = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.3, 8, 7), mat(0xc9302c)));
    fin.position.z = 24; fin.rotation.z = (i * Math.PI) / 2 + Math.PI / 4; g.add(fin); parts.push(fin);
  }
  const gondola = shadowed(new THREE.Mesh(new THREE.BoxGeometry(4, 2.4, 10), mat(0x4a3a2a)));
  gondola.position.set(0, -9.5, -2); g.add(gondola); parts.push(gondola);
  const props: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const pod = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 3, 6), mat(0x444444)));
    pod.rotation.x = Math.PI / 2; pod.position.set(s * 7, -6, 4); g.add(pod);
    const pr = new THREE.Group();
    for (let i = 0; i < 2; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3, 0.08), mat(0x222222)); b.rotation.z = i * Math.PI / 2; pr.add(b); }
    pr.position.set(s * 7, -6, 2.3); g.add(pr); props.push(pr);
  }
  const weakPoints: THREE.Mesh[] = [];
  for (const [x, y, z] of [[0, 9.5, -8], [0, 9.5, 8], [-8.5, 2, 0], [8.5, 2, 0], [0, -2, -29]]) {
    const w = new THREE.Mesh(new THREE.SphereGeometry(1.6, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff4020 }));
    w.position.set(x, y, z); g.add(w); weakPoints.push(w);
  }
  return { group: g, weakPoints, parts, props };
}
