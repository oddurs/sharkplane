import * as THREE from "three";
import { groundHeight, isWater, terrainHeight, PEAK } from "./terrain";
import type { Rng } from "./rng";

const mat = (color: number) => new THREE.MeshLambertMaterial({ color, flatShading: true });
const UP = new THREE.Vector3(0, 1, 0);

/** Boid flocks of low-poly birds. Eatable: the engine calls `eat(i)`. */
export class Birds {
  mesh: THREE.InstancedMesh;
  pos: THREE.Vector3[] = [];
  vel: THREE.Vector3[] = [];
  alive: boolean[] = [];
  private flockCenters: THREE.Vector3[] = [];
  private dummy = new THREE.Object3D();
  private t = 0;

  constructor(scene: THREE.Scene, rng: Rng, flocks = 6, perFlock = 9) {
    const n = flocks * perFlock;
    const geo = new THREE.ConeGeometry(0.35, 1.6, 3); geo.rotateX(Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(geo, mat(0x2a2a2a), n);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    for (let f = 0; f < flocks; f++) {
      let cx = 0, cz = 0, tries = 0;
      do { cx = rng.range(-900, 900); cz = rng.range(-900, 900); tries++; } while (Math.hypot(cx, cz) < 250 && tries < 20);
      const c = new THREE.Vector3(cx, groundHeight(cx, cz) + 25 + rng.range(0, 30), cz);
      this.flockCenters.push(c);
      for (let i = 0; i < perFlock; i++) {
        this.pos.push(c.clone().add(new THREE.Vector3(rng.range(-8, 8), rng.range(-3, 3), rng.range(-8, 8))));
        this.vel.push(new THREE.Vector3(rng.range(-1, 1), 0, rng.range(-1, 1)).normalize().multiplyScalar(9));
        this.alive.push(true);
      }
    }
  }

  update(dt: number) {
    this.t += dt;
    const n = this.pos.length, per = n / this.flockCenters.length;
    for (let i = 0; i < n; i++) {
      if (!this.alive[i]) continue;
      const f = Math.floor(i / per);
      const c = this.flockCenters[f];
      // the flock centre wanders in a slow circle
      const target = c.clone().add(new THREE.Vector3(Math.cos(this.t * 0.15 + f) * 60, Math.sin(this.t * 0.4 + f) * 6, Math.sin(this.t * 0.15 + f) * 60));
      const p = this.pos[i], v = this.vel[i];
      const steer = target.clone().sub(p).multiplyScalar(0.04);
      // separation from flock-mates
      for (let j = f * per; j < (f + 1) * per; j++) {
        if (j === i || !this.alive[j]) continue;
        const d = p.clone().sub(this.pos[j]); const l = d.length();
        if (l < 3) steer.addScaledVector(d.normalize(), (3 - l) * 0.6);
      }
      const g = groundHeight(p.x, p.z);
      if (p.y < g + 12) steer.y += 2;
      v.addScaledVector(steer, dt * 4).setLength(9 + Math.sin(this.t * 3 + i) * 1.5);
      p.addScaledVector(v, dt);
      this.dummy.position.copy(p);
      this.dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), v.clone().normalize());
      const flap = 1 + 0.5 * Math.sin(this.t * 18 + i);
      this.dummy.scale.set(flap, 1, 1);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Index of a live bird within `r` of `p`, or -1. */
  near(p: THREE.Vector3, r: number) {
    for (let i = 0; i < this.pos.length; i++) if (this.alive[i] && this.pos[i].distanceToSquared(p) < r * r) return i;
    return -1;
  }
  eat(i: number) { this.alive[i] = false; this.dummy.scale.setScalar(0); this.dummy.updateMatrix(); this.mesh.setMatrixAt(i, this.dummy.matrix); }
}

/** A ferry crossing the sea, a lighthouse with a beam at dusk, apron life, rocks and a small town. */
export class WorldLife {
  private ferry: THREE.Group;
  private ferryT = 0;
  private beam: THREE.Mesh;
  private beamPivot: THREE.Group;
  private crew: THREE.Group[] = [];
  private searchlight: THREE.Mesh;
  private t = 0;

  constructor(scene: THREE.Scene, rng: Rng) {
    // ferry: find a stretch of water
    this.ferry = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(6, 2.2, 18), mat(0xf4f4f8)); hull.position.y = 1;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(5, 2, 9), mat(0xc9302c)); deck.position.set(0, 3, -1);
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 2.5, 6), mat(0x222222)); stack.position.set(0, 5, 1);
    this.ferry.add(hull, deck, stack);
    this.ferry.traverse((o) => { o.castShadow = true; });
    scene.add(this.ferry);

    // lighthouse on a shore point
    let lx = 0, lz = 0;
    for (let i = 0; i < 200; i++) {
      const x = rng.range(-1100, 1100), z = rng.range(-1100, 1100);
      const h = terrainHeight(x, z);
      if (h > 1 && h < 6 && Math.hypot(x, z) > 400 && isWater(x + 40, z)) { lx = x; lz = z; break; }
    }
    const lh = new THREE.Group();
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.2, 16, 8), mat(0xffffff)); tower.position.y = 8;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(1.95, 2.05, 3, 8), mat(0xc9302c)); band.position.y = 9;
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 2, 8), new THREE.MeshBasicMaterial({ color: 0xfff1b0 })); lamp.position.y = 17;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1.6, 1.5, 8), mat(0x222222)); cap.position.y = 18.7;
    lh.add(tower, band, lamp, cap);
    lh.position.set(lx, groundHeight(lx, lz), lz);
    scene.add(lh);
    this.beamPivot = new THREE.Group(); this.beamPivot.position.set(lx, groundHeight(lx, lz) + 17, lz); scene.add(this.beamPivot);
    this.beam = new THREE.Mesh(new THREE.ConeGeometry(14, 220, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff1b0, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
    this.beam.rotation.z = Math.PI / 2; this.beam.position.x = 110; this.beamPivot.add(this.beam);

    // apron life: fuel truck, ground crew, a parked plane row of crates, searchlight
    const truck = new THREE.Group();
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.2, 2.2), mat(0xffd84a)); cab.position.set(0, 1.6, -2.2);
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 5, 8), mat(0xd8dde3)); tank.rotation.x = Math.PI / 2; tank.position.set(0, 1.8, 1.2);
    truck.add(cab, tank);
    for (const [x, z] of [[-1.1, -2.2], [1.1, -2.2], [-1.1, 2.5], [1.1, 2.5]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.4, 8), mat(0x222222)); w.rotation.z = Math.PI / 2; w.position.set(x, 0.5, z); truck.add(w); }
    truck.position.set(44, groundHeight(44, 38), 38); truck.rotation.y = 0.4;
    truck.traverse((o) => { o.castShadow = true; });
    scene.add(truck);
    for (let i = 0; i < 4; i++) {
      const c = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.1, 0.4), mat(i % 2 ? 0x4f6b3a : 0xc9a26b)); body.position.y = 0.85;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 6, 5), mat(0xe8b89a)); head.position.y = 1.65;
      const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.15, 6), mat(0x3a3a3a)); hat.position.y = 1.9;
      c.add(body, head, hat);
      c.position.set(36 + i * 2.2, groundHeight(36, 48), 48 + (i % 2) * 1.5);
      c.traverse((o) => { o.castShadow = true; });
      scene.add(c); this.crew.push(c);
    }
    for (let i = 0; i < 6; i++) { const crate = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.4, 1.4), mat(0x8a6f4a)); crate.position.set(52 + (i % 3) * 1.6, groundHeight(52, 30) + 0.7 + Math.floor(i / 3) * 1.4, 30 + Math.floor(i / 3) * 0.1); crate.castShadow = true; scene.add(crate); }
    for (const x of [-12, 12]) { const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 9, 4), mat(0xffffff)); pole.position.set(x, groundHeight(x, 70) + 4.5, 70); scene.add(pole);
      const flag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.6, 2.4), mat(x < 0 ? 0xd6233a : 0x3a8be0)); flag.position.set(x + 0.1, 8, 71.2); flag.name = "flag"; scene.add(flag); }
    this.searchlight = new THREE.Mesh(new THREE.ConeGeometry(10, 160, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xdfe8ff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    this.searchlight.position.set(-40, groundHeight(-40, 60) + 80, 60); scene.add(this.searchlight);

    // rocks + a small town on a gentle slope
    const rock = new THREE.DodecahedronGeometry(1, 0);
    const rocks = new THREE.InstancedMesh(rock, mat(0x6f6a66), 220);
    const d = new THREE.Object3D(); let ri = 0;
    for (let i = 0; i < 2000 && ri < 220; i++) {
      const x = rng.range(-1300, 1300), z = rng.range(-1300, 1300); const h = terrainHeight(x, z);
      if (h < 2 || (h < 60 && Math.random() < 0.7) || Math.hypot(x, z) < 260) continue;
      d.position.set(x, h, z); d.rotation.set(rng.range(0, 3), rng.range(0, 3), 0); const s = rng.range(1, 4); d.scale.set(s, s * 0.7, s); d.updateMatrix(); rocks.setMatrixAt(ri++, d.matrix);
    }
    rocks.count = ri; rocks.castShadow = true; scene.add(rocks);
    const house = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat(0xf3e7d2), 40), roof = new THREE.InstancedMesh(new THREE.ConeGeometry(0.8, 0.6, 4), mat(0xc9302c), 40);
    let tx = 0, tz = 0;
    for (let i = 0; i < 300; i++) { const x = rng.range(-1000, 1000), z = rng.range(-1000, 1000); const h = terrainHeight(x, z); if (h > 4 && h < 20 && Math.hypot(x, z) > 350 && Math.hypot(x - PEAK.x, z - PEAK.z) > 300) { tx = x; tz = z; break; } }
    let hi = 0;
    for (let i = 0; i < 40; i++) {
      const x = tx + rng.range(-45, 45), z = tz + rng.range(-45, 45); const h = terrainHeight(x, z); if (h < 1) continue;
      const w = rng.range(3, 6), hh = rng.range(3, 5);
      d.position.set(x, h + hh / 2, z); d.rotation.set(0, rng.range(0, 3), 0); d.scale.set(w, hh, w); d.updateMatrix(); house.setMatrixAt(hi, d.matrix);
      d.position.y = h + hh + 0.3 * w; d.rotation.y += Math.PI / 4; d.scale.set(w * 1.1, w * 0.9, w * 1.1); d.updateMatrix(); roof.setMatrixAt(hi, d.matrix); hi++;
    }
    house.count = hi; roof.count = hi; house.castShadow = true; scene.add(house, roof);
    const scene_ = scene; void scene_;
  }

  update(dt: number, player: THREE.Vector3, dusk: number) {
    this.t += dt;
    // ferry: slow figure-eight in open water (keeps it away from shores by construction)
    this.ferryT += dt * 0.03;
    const fx = Math.sin(this.ferryT) * 500, fz = Math.sin(this.ferryT * 2) * 300 - 600;
    if (isWater(fx, fz)) { this.ferry.position.set(fx, 0.6 + Math.sin(this.t * 1.2) * 0.2, fz); this.ferry.rotation.y = Math.atan2(Math.cos(this.ferryT) * 500, Math.cos(this.ferryT * 2) * 600); this.ferry.rotation.z = Math.sin(this.t * 0.9) * 0.03; this.ferry.visible = true; }
    else this.ferry.visible = false;
    this.beamPivot.rotation.y = this.t * 0.5;
    (this.beam.material as THREE.MeshBasicMaterial).opacity = 0.14 * dusk;
    (this.searchlight.material as THREE.MeshBasicMaterial).opacity = 0.08 * dusk;
    this.searchlight.rotation.set(Math.sin(this.t * 0.3) * 0.5 + 0.2, 0, Math.cos(this.t * 0.23) * 0.5);
    // ground crew duck when you buzz them
    for (const c of this.crew) {
      const d = c.position.distanceTo(player);
      const duck = d < 40 && player.y - c.position.y < 25 ? 0.45 : 1;
      c.scale.y = THREE.MathUtils.lerp(c.scale.y, duck, dt * 8);
      c.rotation.y = Math.sin(this.t * 0.7 + c.position.x) * 0.3;
    }
  }
}

/** Rain: a curtain of streaks that follows the player. */
export class Rain {
  mesh: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private offsets: THREE.Vector3[] = [];
  intensity = 0;
  constructor(scene: THREE.Scene, n = 600) {
    const geo = new THREE.BoxGeometry(0.05, 1.4, 0.05);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xcfe0f0, transparent: true, opacity: 0.5 }), n);
    this.mesh.frustumCulled = false; this.mesh.visible = false;
    for (let i = 0; i < n; i++) this.offsets.push(new THREE.Vector3(Math.random() * 120 - 60, Math.random() * 60, Math.random() * 120 - 60));
    scene.add(this.mesh);
  }
  update(dt: number, center: THREE.Vector3, wind: THREE.Vector3) {
    this.mesh.visible = this.intensity > 0.02;
    if (!this.mesh.visible) return;
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = 0.5 * this.intensity;
    for (let i = 0; i < this.offsets.length; i++) {
      const o = this.offsets[i];
      o.y -= 40 * dt; o.x += wind.x * dt; o.z += wind.z * dt;
      if (o.y < -10) { o.y += 60; o.x = Math.random() * 120 - 60; o.z = Math.random() * 120 - 60; }
      this.dummy.position.set(center.x + o.x, center.y + o.y - 20, center.z + o.z);
      this.dummy.rotation.set(wind.z * 0.01, 0, -wind.x * 0.01);
      this.dummy.updateMatrix(); this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export { UP };
