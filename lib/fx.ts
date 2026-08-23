import * as THREE from "three";
import { groundHeight, isWater } from "./terrain";

/**
 * Particles & debris, low-poly and shaped per material: metal shards, glowing embers, soft dust, water droplets
 * with ring ripples, fluttering feathers, rising smoke. Explosions are staged (flash → shards/embers → smoke →
 * glints) instead of a single-frame blink, and debris shrinks near the camera so it never fills the screen.
 */

/** A fading ribbon that follows a world-space point (wingtip vapor, contrails). */
export class Ribbon {
  mesh: THREE.Mesh;
  private pts: THREE.Vector3[] = [];
  private ints: number[] = [];
  private pos: THREE.BufferAttribute;
  private col: THREE.BufferAttribute;

  constructor(scene: THREE.Scene, private n: number, private width: number, private color: THREE.Color) {
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3);
    this.col = new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3);
    geo.setAttribute("position", this.pos);
    geo.setAttribute("color", this.col);
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    geo.setIndex(idx);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    for (let i = 0; i < n; i++) { this.pts.push(new THREE.Vector3()); this.ints.push(0); }
  }

  reset(at: THREE.Vector3) {
    for (const p of this.pts) p.copy(at);
    this.ints.fill(0);
    for (let i = 0; i < this.n * 2; i++) { this.pos.setXYZ(i, at.x, at.y, at.z); this.col.setXYZ(i, 0, 0, 0); }
    this.pos.needsUpdate = true; this.col.needsUpdate = true;
  }

  update(head: THREE.Vector3, up: THREE.Vector3, intensity: number) {
    const last = this.pts.pop()!;
    this.pts.unshift(last.copy(head));
    this.ints.pop(); this.ints.unshift(intensity);
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const p = this.pts[i];
      const fade = (1 - i / n) * this.ints[i];
      const w = this.width * (0.4 + 0.6 * fade);
      this.pos.setXYZ(i * 2, p.x + up.x * w, p.y + up.y * w, p.z + up.z * w);
      this.pos.setXYZ(i * 2 + 1, p.x - up.x * w, p.y - up.y * w, p.z - up.z * w);
      const c = fade * fade;
      this.col.setXYZ(i * 2, this.color.r * c, this.color.g * c, this.color.b * c);
      this.col.setXYZ(i * 2 + 1, this.color.r * c, this.color.g * c, this.color.b * c);
    }
    this.pos.needsUpdate = true; this.col.needsUpdate = true;
  }

  dispose(scene: THREE.Scene) { scene.remove(this.mesh); this.mesh.geometry.dispose(); }
}

type Kind = "part" | "shard" | "ember" | "dust" | "droplet" | "ripple" | "feather" | "flash" | "smoke" | "puff" | "streak" | "spark" | "chute" | "slick" | "glint";
export type Fragment = { m: THREE.Object3D; v: THREE.Vector3; spin: THREE.Vector3; life: number; maxLife: number; kind: Kind; delay: number; bounced?: boolean };

const EMBERS = [0xff5d2e, 0xffb52e, 0xffe56b];

export class Fx {
  private items: Fragment[] = [];
  private shardGeo = new THREE.ConeGeometry(0.55, 1.6, 3); // three-sided sliver of metal
  private emberGeo = new THREE.ConeGeometry(0.14, 0.9, 4);
  private dustGeo = new THREE.IcosahedronGeometry(0.7, 0);
  private dropGeo = new THREE.SphereGeometry(0.6, 5, 4);
  private rippleGeo = new THREE.RingGeometry(0.82, 1, 20);
  private featherGeo = new THREE.PlaneGeometry(0.9, 0.32, 2, 1);
  private streakGeo = new THREE.ConeGeometry(0.07, 6, 3);
  private puffGeo = new THREE.IcosahedronGeometry(1, 0);
  private cube = new THREE.BoxGeometry(1, 1, 1);
  private mats = new Map<number, THREE.MeshLambertMaterial>();

  constructor(private scene: THREE.Scene) { this.dropGeo.scale(0.55, 1.4, 0.55); this.featherGeo.rotateX(-0.4); }

  private mat(color: number) {
    let m = this.mats.get(color);
    if (!m) { m = new THREE.MeshLambertMaterial({ color, flatShading: true }); this.mats.set(color, m); }
    return m;
  }

  private add(m: THREE.Object3D, v: THREE.Vector3, life: number, kind: Kind, spin = new THREE.Vector3(), delay = 0) {
    if (delay > 0) m.visible = false;
    this.scene.add(m);
    this.items.push({ m, v, spin, life, maxLife: life, kind, delay });
  }

  count() { return this.items.length; }

  /** Paint colours actually on the model — shards and embers die in the plane's own livery. */
  static tintsOf(parts: THREE.Mesh[]): number[] {
    const seen = new Set<number>();
    for (const p of parts) {
      const m = p.material as THREE.MeshLambertMaterial;
      if (m?.color) seen.add(m.color.getHex());
      if (seen.size >= 3) break;
    }
    return seen.size ? [...seen] : [0x8a96a8];
  }

  /** Throw the plane's actual parts + a staged explosion. */
  shred(parts: THREE.Mesh[], from: THREE.Object3D, scale = 1) {
    from.updateWorldMatrix(true, false);
    for (const part of parts) {
      const m = part.clone();
      m.castShadow = false;
      part.getWorldPosition(m.position);
      part.getWorldQuaternion(m.quaternion);
      m.scale.copy(part.getWorldScale(new THREE.Vector3()));
      const v = new THREE.Vector3().randomDirection().multiplyScalar(9 + Math.random() * 16);
      v.y += 7;
      this.add(m, v, 1.7 + Math.random() * 0.6, "part", new THREE.Vector3().randomDirection().multiplyScalar(4));
    }
    const at = from.getWorldPosition(new THREE.Vector3());
    this.explosion(at, Fx.tintsOf(parts), scale);
  }

  /** flash now → shards + embers → smoke drifts up late → a couple of glints linger. */
  explosion(at: THREE.Vector3, tints: number[], scale = 1) {
    const flash = new THREE.Mesh(this.puffGeo, new THREE.MeshBasicMaterial({ color: 0xffd070, transparent: true, opacity: 0.9 }));
    flash.position.copy(at); flash.scale.setScalar(scale);
    this.add(flash, new THREE.Vector3(), 0.4, "flash");
    const nShards = Math.round(10 * scale);
    for (let i = 0; i < nShards; i++) {
      const m = new THREE.Mesh(this.shardGeo, this.mat(tints[i % tints.length]));
      m.position.copy(at); m.scale.setScalar((0.6 + Math.random() * 0.8) * scale);
      const v = new THREE.Vector3().randomDirection().multiplyScalar((14 + Math.random() * 26) * scale);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.clone().normalize());
      this.add(m, v, 1.1 + Math.random() * 0.5, "shard", new THREE.Vector3().randomDirection().multiplyScalar(9));
    }
    for (let i = 0; i < Math.round(8 * scale); i++) {
      const m = new THREE.Mesh(this.emberGeo, new THREE.MeshBasicMaterial({ color: EMBERS[i % 3], transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.position.copy(at); m.scale.setScalar(1 + Math.random());
      const v = new THREE.Vector3().randomDirection().multiplyScalar((18 + Math.random() * 24) * scale);
      this.add(m, v, 0.6 + Math.random() * 0.4, "ember");
    }
    for (let i = 0; i < Math.round(5 * scale); i++) {
      this.smokeAt(at.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(2 * scale)), 0.7 + scale * 0.4, 0.2 + i * 0.22);
    }
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Mesh(this.puffGeo, new THREE.MeshBasicMaterial({ color: 0xfff1b0, transparent: true, opacity: 0.9 }));
      g.position.copy(at).add(new THREE.Vector3().randomDirection().multiplyScalar(3 * scale));
      g.scale.setScalar(0.18);
      this.add(g, new THREE.Vector3((Math.random() - 0.5) * 3, -2 - Math.random() * 3, (Math.random() - 0.5) * 3), 0.25, "glint", new THREE.Vector3(), 0.45 + i * 0.4);
    }
  }

  burst(at: THREE.Vector3, tints: number[] | number, count: number, scale = 1) {
    this.explosion(at, Array.isArray(tints) ? tints : [tints], Math.min(1.4, (count / 24) * scale + 0.35));
  }

  private smokeAt(at: THREE.Vector3, size: number, delay: number) {
    const m = new THREE.Mesh(this.puffGeo, new THREE.MeshLambertMaterial({ color: 0x5a5a5a, transparent: true, opacity: 0.7, flatShading: true }));
    m.position.copy(at);
    m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    m.scale.setScalar(size * (0.5 + Math.random() * 0.3));
    this.add(m, new THREE.Vector3((Math.random() - 0.5) * 1.4, 1.6 + Math.random() * 1.4, (Math.random() - 0.5) * 1.4), 1.5 + Math.random() * 0.5, "smoke", new THREE.Vector3(0, 0.8, 0), delay);
  }
  smoke(at: THREE.Vector3, big = true) { if (big) this.smokeAt(at, 1, 0); else this.puff(at); }
  puff(at: THREE.Vector3) {
    const m = new THREE.Mesh(this.puffGeo, new THREE.MeshLambertMaterial({ color: 0x7a7a7a, transparent: true, opacity: 0.7, flatShading: true }));
    m.position.copy(at).add(new THREE.Vector3().randomDirection().multiplyScalar(0.15));
    m.scale.setScalar(0.12);
    this.add(m, new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.5 + Math.random() * 0.4, 0.9 + Math.random() * 0.5), 0.6, "puff", new THREE.Vector3(0, 0.8, 0));
  }

  dust(at: THREE.Vector3, n: number, color = 0xd9c77a) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.dustGeo, this.mat(color));
      m.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 3, 0, (Math.random() - 0.5) * 3));
      m.scale.setScalar(0.5 + Math.random() * 0.7);
      this.add(m, new THREE.Vector3((Math.random() - 0.5) * 5, 3 + Math.random() * 5, (Math.random() - 0.5) * 5), 0.5 + Math.random() * 0.4, "dust", new THREE.Vector3().randomDirection().multiplyScalar(2));
    }
  }

  splash(at: THREE.Vector3, n: number) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.dropGeo, this.mat(i % 3 === 0 ? 0xf4f8ff : 0x7fc4ff));
      m.position.copy(at);
      m.scale.setScalar(0.5 + Math.random() * 0.6);
      this.add(m, new THREE.Vector3((Math.random() - 0.5) * 9, 9 + Math.random() * 12, (Math.random() - 0.5) * 9), 0.7 + Math.random() * 0.35, "droplet");
    }
    for (let i = 0; i < 2; i++) {
      const r = new THREE.Mesh(this.rippleGeo, new THREE.MeshBasicMaterial({ color: 0xdff2ff, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
      r.rotation.x = -Math.PI / 2; r.position.set(at.x, 0.35, at.z); r.scale.setScalar(1.5);
      this.add(r, new THREE.Vector3(), 0.9, "ripple", new THREE.Vector3(), i * 0.18);
    }
  }

  feathers(at: THREE.Vector3, n = 7) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.featherGeo, new THREE.MeshLambertMaterial({ color: i % 3 ? 0xffffff : 0xd8dde3, side: THREE.DoubleSide, flatShading: true }));
      m.position.copy(at);
      m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      const v = new THREE.Vector3().randomDirection().multiplyScalar(4 + Math.random() * 5);
      this.add(m, v, 1.4 + Math.random() * 0.8, "feather", new THREE.Vector3(0, 0, 4 + Math.random() * 4));
    }
    this.dust(at, 2, 0xffffff);
  }

  chute(at: THREE.Vector3): THREE.Object3D {
    const g = new THREE.Group();
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(1.6, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), this.mat(0xf3e7d2));
    canopy.position.y = 3; g.add(canopy);
    const pilot = new THREE.Mesh(this.cube, this.mat(0x4a3a2a)); pilot.scale.set(0.5, 0.9, 0.5); g.add(pilot);
    for (const s of [-1, 1]) { const line = new THREE.Mesh(this.cube, this.mat(0x222222)); line.scale.set(0.04, 3, 0.04); line.position.set(s * 0.7, 1.5, 0); line.rotation.z = s * 0.22; g.add(line); }
    g.position.copy(at).add(new THREE.Vector3(0, 2, 0));
    this.add(g, new THREE.Vector3((Math.random() - 0.5) * 2, -2.5, (Math.random() - 0.5) * 2), 18, "chute");
    return g;
  }
  remove(obj: THREE.Object3D) { const i = this.items.findIndex((p) => p.m === obj); if (i >= 0) { this.scene.remove(obj); this.items.splice(i, 1); } }
  chutes(): THREE.Object3D[] { return this.items.filter((p) => p.kind === "chute").map((p) => p.m); }

  slick(at: THREE.Vector3) {
    const water = isWater(at.x, at.z);
    const m = new THREE.Mesh(new THREE.CircleGeometry(4 + Math.random() * 3, 9), new THREE.MeshLambertMaterial({ color: water ? 0x101820 : 0x1a1410, transparent: true, opacity: 0.75, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.rotation.z = Math.random() * 6;
    m.position.set(at.x, groundHeight(at.x, at.z) + 0.15, at.z);
    this.add(m, new THREE.Vector3(), 40, "slick");
  }

  sparks(at: THREE.Vector3, n = 8) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.emberGeo, new THREE.MeshBasicMaterial({ color: i % 2 ? 0xffe56b : 0xffb52e, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.position.copy(at); m.scale.set(0.6, 2.4, 0.6);
      const v = new THREE.Vector3().randomDirection().multiplyScalar(20 + Math.random() * 20);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.clone().normalize());
      this.add(m, v, 0.25 + Math.random() * 0.2, "spark");
    }
  }

  streak(cameraPos: THREE.Vector3, forward: THREE.Vector3, n: number) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.streakGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }));
      const side = new THREE.Vector3().randomDirection();
      side.addScaledVector(forward, -forward.dot(side)).normalize().multiplyScalar(4 + Math.random() * 10);
      m.position.copy(cameraPos).addScaledVector(forward, 40 + Math.random() * 30).add(side);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), forward);
      this.add(m, forward.clone().multiplyScalar(-90), 0.5, "streak");
    }
  }

  update(dt: number, cameraPos?: THREE.Vector3) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      if (p.delay > 0) { p.delay -= dt; if (p.delay <= 0) p.m.visible = true; else continue; }
      p.life -= dt;
      const t = p.life / p.maxLife;
      switch (p.kind) {
        case "flash":
          p.m.scale.addScalar(60 * dt);
          (p.m as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material.opacity = t * 0.9;
          break;
        case "glint":
          p.m.position.addScaledVector(p.v, dt);
          p.m.scale.setScalar(0.18 + Math.sin((1 - t) * Math.PI) * 0.5);
          (p.m as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material.opacity = t;
          break;
        case "smoke":
        case "puff": {
          p.m.position.addScaledVector(p.v, dt);
          p.m.rotation.y += p.spin.y * dt;
          p.m.scale.addScalar((p.kind === "smoke" ? 1.1 : 0.35) * dt);
          (p.m as THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>).material.opacity = 0.7 * Math.min(1, t * 1.6);
          break;
        }
        case "streak":
          p.m.position.addScaledVector(p.v, dt);
          break;
        case "spark":
        case "ember": {
          p.v.y -= (p.kind === "ember" ? 10 : 20) * dt;
          p.v.multiplyScalar(1 - dt * 1.2);
          p.m.position.addScaledVector(p.v, dt);
          const mat = (p.m as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material;
          mat.opacity = t * (0.75 + Math.random() * 0.25); // flicker
          break;
        }
        case "droplet":
          p.v.y -= 34 * dt;
          p.m.position.addScaledVector(p.v, dt);
          p.m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p.v.clone().normalize());
          if (p.m.position.y < 0.2) p.life = 0;
          break;
        case "ripple":
          p.m.scale.addScalar(9 * dt);
          (p.m as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material.opacity = 0.55 * Math.max(0, t);
          break;
        case "feather": {
          p.v.y = Math.max(p.v.y - 12 * dt, -2.2);
          p.v.x *= 1 - dt * 0.6; p.v.z *= 1 - dt * 0.6;
          p.m.position.addScaledVector(p.v, dt);
          p.m.rotation.z += Math.sin((1 - t) * p.spin.z * 2) * dt * 6; // rocking flutter
          p.m.rotation.y += dt * 1.5;
          break;
        }
        case "chute": {
          p.m.position.addScaledVector(p.v, dt);
          p.m.rotation.z = Math.sin(p.life * 2) * 0.15;
          const g = groundHeight(p.m.position.x, p.m.position.z);
          if (p.m.position.y <= g) { p.m.position.y = g; p.life = Math.min(p.life, 2); p.v.set(0, 0, 0); }
          break;
        }
        case "slick": {
          const mat = (p.m as THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>).material;
          mat.opacity = 0.75 * Math.min(1, t * 4);
          break;
        }
        default: { // part, shard, dust
          p.v.y -= (p.kind === "part" ? 22 : 26) * dt;
          p.m.position.addScaledVector(p.v, dt);
          p.m.rotation.x += p.spin.x * dt; p.m.rotation.y += p.spin.y * dt; p.m.rotation.z += p.spin.z * dt;
          if (t < 0.4) p.m.scale.multiplyScalar(1 - dt * 1.1);
          if (p.kind !== "dust") {
            const g = groundHeight(p.m.position.x, p.m.position.z);
            if (p.m.position.y < g + 0.3) {
              p.m.position.y = g + 0.3;
              if (isWater(p.m.position.x, p.m.position.z)) {
                if (!p.bounced) this.splash(p.m.position, 3);
                p.v.set(p.v.x * 0.4, 0, p.v.z * 0.4); p.spin.multiplyScalar(0.4);
              } else {
                if (!p.bounced && p.kind === "part") { this.smokeAt(p.m.position, 0.5, 0); this.dust(p.m.position, 2); }
                p.v.y = Math.abs(p.v.y) * 0.35; p.v.x *= 0.6; p.v.z *= 0.6; p.spin.multiplyScalar(0.6);
              }
              p.bounced = true;
            }
          }
        }
      }
      // debris never fills the screen: shrink pieces close to the camera
      if (cameraPos && (p.kind === "part" || p.kind === "shard")) {
        const d = p.m.position.distanceTo(cameraPos);
        if (d < 14) p.m.scale.multiplyScalar(Math.max(0.3, d / 14) ** 0.5);
      }
      if (p.life <= 0) {
        this.scene.remove(p.m);
        const mm = p.m as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
        if (["flash", "streak", "smoke", "puff", "slick", "spark", "ember", "ripple", "feather", "glint"].includes(p.kind) && mm.material) mm.material.dispose();
        this.items.splice(i, 1);
      }
    }
  }

  clear() { for (const p of this.items) this.scene.remove(p.m); this.items = []; }
}
