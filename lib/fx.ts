import * as THREE from "three";
import { groundHeight, isWater } from "./terrain";

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

  reset(at: THREE.Vector3) { for (const p of this.pts) p.copy(at); this.ints.fill(0); }

  /** Push a new head point; intensity 0..1 controls brightness at the head. */
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

export type Fragment = { m: THREE.Object3D; v: THREE.Vector3; spin: THREE.Vector3; life: number; maxLife: number; kind: "part" | "cube" | "flash" | "dust" | "splash" | "smoke" | "streak" | "puff" | "chute" | "slick" | "spark" };

/** Particle + debris system shared by everything that explodes, splashes or smokes. */
export class Fx {
  private items: Fragment[] = [];
  private cube = new THREE.BoxGeometry(1, 1, 1);
  private streakGeo = new THREE.BoxGeometry(0.08, 0.08, 6);
  private mats = new Map<number, THREE.MeshLambertMaterial>();

  constructor(private scene: THREE.Scene) {}

  private mat(color: number) {
    let m = this.mats.get(color);
    if (!m) { m = new THREE.MeshLambertMaterial({ color, flatShading: true }); this.mats.set(color, m); }
    return m;
  }

  private add(m: THREE.Object3D, v: THREE.Vector3, life: number, kind: Fragment["kind"], spin = new THREE.Vector3()) {
    this.scene.add(m);
    this.items.push({ m, v, spin, life, maxLife: life, kind });
  }

  /** Throw the plane's actual parts around plus a burst of embers and a flash. */
  shred(parts: THREE.Mesh[], from: THREE.Object3D, color: number, scale = 1) {
    from.updateWorldMatrix(true, false);
    for (const part of parts) {
      const m = part.clone();
      m.castShadow = false;
      part.getWorldPosition(m.position);
      part.getWorldQuaternion(m.quaternion);
      m.scale.copy(part.getWorldScale(new THREE.Vector3()));
      const v = new THREE.Vector3().randomDirection().multiplyScalar(10 + Math.random() * 20);
      v.y += 8;
      this.add(m, v, 1.6 + Math.random() * 0.6, "part", new THREE.Vector3().randomDirection().multiplyScalar(5));
    }
    const at = from.getWorldPosition(new THREE.Vector3());
    this.burst(at, color, Math.round(24 * scale), scale);
  }

  burst(at: THREE.Vector3, color: number, count: number, scale = 1) {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(this.cube, this.mat([0xff5d2e, 0xffb52e, 0xffe56b, color][i % 4]));
      m.position.copy(at);
      m.scale.setScalar((0.25 + Math.random() * 0.7) * scale);
      const v = new THREE.Vector3().randomDirection().multiplyScalar((15 + Math.random() * 35) * scale);
      this.add(m, v, 1.0 + Math.random() * 0.6, "cube", new THREE.Vector3().randomDirection().multiplyScalar(6));
    }
    const flash = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffd070, transparent: true, opacity: 0.9 }));
    flash.position.copy(at); flash.scale.setScalar(scale);
    this.add(flash, new THREE.Vector3(), 0.45, "flash");
  }

  dust(at: THREE.Vector3, n: number, color = 0xd9c77a) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.cube, this.mat(color));
      m.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 3, 0, (Math.random() - 0.5) * 3));
      m.scale.setScalar(0.4 + Math.random() * 0.6);
      this.add(m, new THREE.Vector3((Math.random() - 0.5) * 6, 4 + Math.random() * 6, (Math.random() - 0.5) * 6), 0.5 + Math.random() * 0.4, "dust");
    }
  }

  splash(at: THREE.Vector3, n: number) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.cube, this.mat(i % 3 === 0 ? 0xffffff : 0x7fc4ff));
      m.position.copy(at);
      m.scale.set(0.3, 0.8 + Math.random(), 0.3);
      this.add(m, new THREE.Vector3((Math.random() - 0.5) * 10, 10 + Math.random() * 14, (Math.random() - 0.5) * 10), 0.7 + Math.random() * 0.4, "splash");
    }
  }

  private puffGeo = new THREE.IcosahedronGeometry(1, 0);

  /** Soft grey smoke blob: spawns small, drifts up and back, swells a little, fades out. */
  smoke(at: THREE.Vector3, big = true) {
    const m = new THREE.Mesh(this.puffGeo, new THREE.MeshLambertMaterial({ color: big ? 0x5a5a5a : 0x7a7a7a, transparent: true, opacity: 0.75, flatShading: true }));
    m.position.copy(at).add(new THREE.Vector3().randomDirection().multiplyScalar(big ? 0.6 : 0.15));
    m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    m.scale.setScalar(big ? 0.5 + Math.random() * 0.4 : 0.12);
    const v = big
      ? new THREE.Vector3((Math.random() - 0.5) * 1.5, 1.5 + Math.random() * 1.5, (Math.random() - 0.5) * 1.5)
      : new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.5 + Math.random() * 0.4, 0.9 + Math.random() * 0.5);
    this.add(m, v, big ? 1.4 + Math.random() * 0.4 : 0.6, big ? "smoke" : "puff", new THREE.Vector3(0, 0.8, 0));
  }

  /** Tiny exhaust puff (engine start-up, idle). */
  puff(at: THREE.Vector3) { this.smoke(at, false); }

  /** Bail-out parachute: drifts down slowly; the engine can eat it. */
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
  /** Remove a particle object (e.g. an eaten parachute). */
  remove(obj: THREE.Object3D) { const i = this.items.findIndex((p) => p.m === obj); if (i >= 0) { this.scene.remove(obj); this.items.splice(i, 1); } }
  chutes(): THREE.Object3D[] { return this.items.filter((p) => p.kind === "chute").map((p) => p.m); }

  /** Oil slick / scorch decal where something went down. */
  slick(at: THREE.Vector3) {
    const water = isWater(at.x, at.z);
    const m = new THREE.Mesh(new THREE.CircleGeometry(4 + Math.random() * 3, 9), new THREE.MeshLambertMaterial({ color: water ? 0x101820 : 0x1a1410, transparent: true, opacity: 0.75, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.rotation.z = Math.random() * 6;
    m.position.set(at.x, groundHeight(at.x, at.z) + 0.15, at.z);
    this.add(m, new THREE.Vector3(), 40, "slick");
  }

  sparks(at: THREE.Vector3, n = 8) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.cube, new THREE.MeshBasicMaterial({ color: i % 2 ? 0xffe56b : 0xffb52e }));
      m.position.copy(at); m.scale.set(0.08, 0.08, 0.5);
      const v = new THREE.Vector3().randomDirection().multiplyScalar(20 + Math.random() * 20);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), v.clone().normalize());
      this.add(m, v, 0.25 + Math.random() * 0.2, "spark");
    }
  }

  /** Speed streaks rushing past the camera while boosting. */
  streak(cameraPos: THREE.Vector3, forward: THREE.Vector3, n: number) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.streakGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
      const side = new THREE.Vector3().randomDirection();
      side.addScaledVector(forward, -forward.dot(side)).normalize().multiplyScalar(4 + Math.random() * 10);
      m.position.copy(cameraPos).addScaledVector(forward, 40 + Math.random() * 30).add(side);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), forward);
      this.add(m, forward.clone().multiplyScalar(-90), 0.5, "streak");
    }
  }

  update(dt: number) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i];
      p.life -= dt;
      const t = p.life / p.maxLife;
      switch (p.kind) {
        case "flash":
          p.m.scale.addScalar(60 * dt);
          (p.m as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material.opacity = t * 0.9;
          break;
        case "smoke":
        case "puff": {
          p.m.position.addScaledVector(p.v, dt);
          p.m.rotation.y += p.spin.y * dt;
          p.m.scale.addScalar((p.kind === "smoke" ? 1.2 : 0.35) * dt);
          const mat = (p.m as THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>).material;
          mat.opacity = 0.75 * Math.min(1, t * 1.6); // hold, then fade over the last ~60 %
          break;
        }
        case "streak":
        case "spark":
          p.m.position.addScaledVector(p.v, dt);
          if (p.kind === "spark") p.v.y -= 20 * dt;
          break;
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
        default:
          p.v.y -= (p.kind === "part" ? 22 : 30) * dt;
          p.m.position.addScaledVector(p.v, dt);
          p.m.rotation.x += p.spin.x * dt; p.m.rotation.y += p.spin.y * dt; p.m.rotation.z += p.spin.z * dt;
          if (p.kind !== "part" || t < 0.4) p.m.scale.multiplyScalar(1 - dt * 0.9);
          // debris bounces on terrain, floats on water
          if (p.kind === "part" || p.kind === "cube") {
            const g = groundHeight(p.m.position.x, p.m.position.z);
            if (p.m.position.y < g + 0.3) {
              p.m.position.y = g + 0.3;
              if (isWater(p.m.position.x, p.m.position.z)) { p.v.set(p.v.x * 0.5, 0, p.v.z * 0.5); p.spin.multiplyScalar(0.5); }
              else { p.v.y = Math.abs(p.v.y) * 0.35; p.v.x *= 0.6; p.v.z *= 0.6; p.spin.multiplyScalar(0.6); }
            }
          }
      }
      if (p.life <= 0) {
        this.scene.remove(p.m);
        if (["flash", "streak", "smoke", "puff", "slick", "spark"].includes(p.kind)) (p.m as THREE.Mesh<THREE.BufferGeometry, THREE.Material>).material.dispose();
        this.items.splice(i, 1);
      }
    }
  }

  clear() { for (const p of this.items) this.scene.remove(p.m); this.items = []; }
}
