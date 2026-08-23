import * as THREE from "three";

/** One cross-section of a lofted hull: elliptical, centred at (0, y, z). `arc` limits the ring to a partial shell. */
export type Section = { z: number; w: number; h: number; y?: number; arc?: [number, number] };

/**
 * Low-poly loft: rings of `segs` vertices per section, quads between consecutive rings, fan caps on closed ends.
 * Angle φ runs counter-clockwise from +X (right side): top is π/2, bottom is 3π/2.
 */
export function loft(sections: Section[], segs = 8, caps = true): THREE.BufferGeometry {
  const rings = sections.map((s) => ringPoints(s, segs));
  const tris: number[] = [];
  const push = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => tris.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  const closed = !sections.some((s) => s.arc);
  for (let i = 0; i < rings.length - 1; i++) {
    const r0 = rings[i], r1 = rings[i + 1];
    const n = r0.length;
    for (let j = 0; j < (closed ? n : n - 1); j++) {
      const k = (j + 1) % n;
      // wound so the faces point outward (φ runs CCW seen from the nose, z grows toward the tail)
      push(r0[j], r1[k], r1[j]);
      push(r0[j], r0[k], r1[k]);
    }
  }
  if (caps && closed) {
    for (const [ring, front] of [[rings[0], true], [rings[rings.length - 1], false]] as const) {
      const c = new THREE.Vector3();
      for (const p of ring) c.add(p);
      c.divideScalar(ring.length);
      for (let j = 0; j < ring.length; j++) {
        const k = (j + 1) % ring.length;
        if (front) push(c, ring[j], ring[k]); else push(c, ring[k], ring[j]);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(tris, 3));
  g.computeVertexNormals();
  return g;
}

function ringPoints(s: Section, segs: number): THREE.Vector3[] {
  const [a0, a1] = s.arc ?? [0, Math.PI * 2];
  const n = s.arc ? segs + 1 : segs;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const t = s.arc ? i / segs : i / segs;
    const phi = a0 + (a1 - a0) * t;
    pts.push(new THREE.Vector3(Math.cos(phi) * s.w, (s.y ?? 0) + Math.sin(phi) * s.h, s.z));
  }
  return pts;
}

/** Point on a section's ellipse at angle φ (for placing teeth, decals, exhausts on the skin). */
export function onSkin(s: Section, phi: number, out = 0): THREE.Vector3 {
  return new THREE.Vector3(Math.cos(phi) * (s.w + out), (s.y ?? 0) + Math.sin(phi) * (s.h + out), s.z);
}

/** Linear interpolation of a section list at depth z (clamped). */
export function sectionAt(sections: Section[], z: number): Section {
  if (z <= sections[0].z) return sections[0];
  for (let i = 0; i < sections.length - 1; i++) {
    const a = sections[i], b = sections[i + 1];
    if (z <= b.z) {
      const t = (z - a.z) / (b.z - a.z);
      return { z, w: THREE.MathUtils.lerp(a.w, b.w, t), h: THREE.MathUtils.lerp(a.h, b.h, t), y: THREE.MathUtils.lerp(a.y ?? 0, b.y ?? 0, t) };
    }
  }
  return sections[sections.length - 1];
}
