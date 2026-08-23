import * as THREE from "three";

export const WORLD_RADIUS = 1400;
/** Runway strip: centred on x=0, runs along z. */
export const RUNWAY = { halfWidth: 9, zMin: -180, zMax: 60 };
export const PEAK = { x: -620, z: -520 };

const mat = (color: number) => new THREE.MeshLambertMaterial({ color, flatShading: true });

/** Distance from (x,z) to the padded runway rectangle (0 inside). */
function runwayPadDistance(x: number, z: number) {
  const dx = Math.max(0, Math.abs(x) - 30);
  const dz = Math.max(0, Math.max(RUNWAY.zMin - 20 - z, z - (RUNWAY.zMax + 20)));
  return Math.hypot(dx, dz);
}

/** Raw terrain height; negative = sea bed (water surface is y=0). */
export function terrainHeight(x: number, z: number): number {
  // continents
  const m = Math.sin(x * 0.0023 + 1.3) * Math.cos(z * 0.0019 - 0.4) + 0.55 * Math.sin(x * 0.0041 - z * 0.0037 + 0.7);
  // detail
  const d =
    Math.sin(x * 0.011) * Math.cos(z * 0.009) +
    0.5 * Math.sin(x * 0.027 + z * 0.019) +
    0.25 * Math.sin(z * 0.05 - x * 0.031);
  let h = m * 38 + d * 16 - 4;
  // cliffs: steepen the band just above the beach
  if (h > 6) h += 8 * THREE.MathUtils.smoothstep(h, 6, 18);
  // the peak
  const pd = Math.hypot(x - PEAK.x, z - PEAK.z);
  h += 150 * Math.exp(-(pd * pd) / (2 * 190 * 190));
  // airfield pad (flat grass at y=0.5 so the runway sits on dry land)
  const pad = 1 - THREE.MathUtils.smoothstep(runwayPadDistance(x, z), 0, 260);
  h = THREE.MathUtils.lerp(h, 0.5, pad);
  return Math.max(-14, h);
}

/** Collision height: terrain or the water surface. */
export function groundHeight(x: number, z: number) { return Math.max(0, terrainHeight(x, z)); }
export function isWater(x: number, z: number) { return terrainHeight(x, z) < 0; }
export function isOnRunway(x: number, z: number) {
  return Math.abs(x) < RUNWAY.halfWidth && z > RUNWAY.zMin && z < RUNWAY.zMax;
}

export type World = { water: THREE.Mesh; update: (t: number) => void };

export function buildWorld(scene: THREE.Scene): World {
  const size = 3200, seg = 150;
  let g: THREE.BufferGeometry = new THREE.PlaneGeometry(size, size, seg, seg);
  g.rotateX(-Math.PI / 2);
  g = g.toNonIndexed();
  const pos = g.attributes.position as THREE.BufferAttribute;
  const colors: number[] = [];
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i += 3) {
    let avg = 0;
    for (let k = 0; k < 3; k++) {
      const h = terrainHeight(pos.getX(i + k), pos.getZ(i + k));
      pos.setY(i + k, h);
      avg += h / 3;
    }
    if (avg < -3) c.set(0x1f5fa8);
    else if (avg < 0.8) c.set(0xe8d9a0);
    else if (avg < 4) c.set(0xd9c77a);
    else if (avg < 28) c.set(0x5fae3f);
    else if (avg < 55) c.set(0x3f8a3a);
    else if (avg < 95) c.set(0x8a6f4a);
    else if (avg < 125) c.set(0x6f6a66);
    else c.set(0xf4f4f8);
    // a little per-face variation so big flats don't band
    const v = 0.94 + ((i * 7919) % 13) / 100;
    c.multiplyScalar(v);
    for (let k = 0; k < 3; k++) colors.push(c.r, c.g, c.b);
  }
  g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  const terrain = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  terrain.receiveShadow = true;
  scene.add(terrain);

  const water = buildWater(scene);
  buildAirfield(scene);
  buildTrees(scene);
  buildClouds(scene);

  const wpos = water.geometry.attributes.position as THREE.BufferAttribute;
  const base = wpos.array.slice() as Float32Array;
  return {
    water,
    update(t) {
      for (let i = 0; i < wpos.count; i++) {
        const x = base[i * 3], z = base[i * 3 + 2];
        wpos.setY(i, 0.5 * Math.sin(x * 0.05 + t * 1.1) + 0.35 * Math.cos(z * 0.07 + t * 1.7) + 0.2 * Math.sin((x + z) * 0.03 - t));
      }
      wpos.needsUpdate = true;
      water.geometry.computeVertexNormals();
    },
  };
}

function buildWater(scene: THREE.Scene) {
  const g = new THREE.PlaneGeometry(3400, 3400, 56, 56);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.MeshPhongMaterial({ color: 0x2f86d8, specular: 0xffffff, shininess: 90, flatShading: true, transparent: true, opacity: 0.92 });
  const water = new THREE.Mesh(g, m);
  water.position.y = 0;
  water.receiveShadow = true;
  scene.add(water);
  return water;
}

function buildAirfield(scene: THREE.Scene) {
  const len = RUNWAY.zMax - RUNWAY.zMin, zc = (RUNWAY.zMax + RUNWAY.zMin) / 2;
  const rw = new THREE.Mesh(new THREE.BoxGeometry(RUNWAY.halfWidth * 2, 0.4, len), mat(0x444a55));
  rw.position.set(0, 0.7, zc);
  rw.receiveShadow = true;
  scene.add(rw);
  const white = mat(0xffffff);
  for (let z = RUNWAY.zMin + 24; z < RUNWAY.zMax - 20; z += 16) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.1, 7), white);
    s.position.set(0, 0.95, z);
    scene.add(s);
  }
  for (const zEnd of [RUNWAY.zMin + 6, RUNWAY.zMax - 6]) {
    for (let i = -3; i <= 3; i++) {
      if (i === 0) continue;
      const k = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 8), white);
      k.position.set(i * 2.2, 0.95, zEnd);
      scene.add(k);
    }
  }
  const lightGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff1b0 });
  for (let z = RUNWAY.zMin; z <= RUNWAY.zMax; z += 20) {
    for (const s of [-1, 1]) {
      const l = new THREE.Mesh(lightGeo, lightMat);
      l.position.set(s * (RUNWAY.halfWidth + 1.5), 1, z);
      scene.add(l);
    }
  }
  // hangar
  const hangar = new THREE.Group();
  const hb = new THREE.Mesh(new THREE.BoxGeometry(26, 9, 20), mat(0x9aa3ad)); hb.position.y = 4.5;
  const hr = new THREE.Mesh(new THREE.CylinderGeometry(13, 13, 20, 8, 1, false, 0, Math.PI), mat(0xc44b3b));
  hr.rotation.z = Math.PI / 2; hr.rotation.y = Math.PI / 2; hr.position.y = 9; hr.scale.x = 0.5;
  const door = new THREE.Mesh(new THREE.BoxGeometry(14, 7, 0.4), mat(0x3a4450)); door.position.set(0, 3.5, -10.1);
  hangar.add(hb, hr, door);
  hangar.position.set(40, 0.5, 20);
  hangar.traverse((o) => { o.castShadow = true; });
  scene.add(hangar);
  // control tower
  const tower = new THREE.Group();
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.8, 16, 6), mat(0xd8dde3)); stem.position.y = 8;
  const cab = new THREE.Mesh(new THREE.CylinderGeometry(4, 3, 4, 6), mat(0x2b4c7e)); cab.position.y = 18;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(4.4, 2, 6), mat(0xd8dde3)); roof.position.y = 21;
  tower.add(stem, cab, roof);
  tower.position.set(-30, 0.5, -40);
  tower.traverse((o) => { o.castShadow = true; });
  scene.add(tower);
  // wind sock
  const sock = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 8, 4), mat(0xffffff)); pole.position.y = 4;
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.8, 4, 6, 1, true), mat(0xff7a1a));
  cone.rotation.z = Math.PI / 2; cone.position.set(-2.2, 8, 0);
  cone.name = "sock";
  sock.add(pole, cone);
  sock.position.set(22, 0.5, -120);
  sock.rotation.y = 0.6;
  scene.add(sock);
}

function buildTrees(scene: THREE.Scene) {
  const trunk = new THREE.CylinderGeometry(0.4, 0.6, 3, 5);
  const leaf = new THREE.ConeGeometry(2.6, 7, 6);
  const spots: THREE.Matrix4[] = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  // deterministic scatter so the map is the same every day
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 1400 && spots.length < 700; i++) {
    const x = (rnd() - 0.5) * 2700, z = (rnd() - 0.5) * 2700;
    const h = terrainHeight(x, z);
    if (h < 3 || h > 60 || runwayPadDistance(x, z) < 70) continue;
    const sc = 1 + rnd();
    spots.push(m.compose(p.set(x, h, z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6), s.set(sc, sc, sc)).clone());
  }
  const trunks = new THREE.InstancedMesh(trunk.translate(0, 1.5, 0), mat(0x6b4a2b), spots.length);
  const leaves = new THREE.InstancedMesh(leaf.translate(0, 6, 0), mat(0x2e8b3a), spots.length);
  spots.forEach((mtx, i) => { trunks.setMatrixAt(i, mtx); leaves.setMatrixAt(i, mtx); });
  leaves.castShadow = true;
  scene.add(trunks, leaves);
}

function buildClouds(scene: THREE.Scene) {
  const puff = new THREE.IcosahedronGeometry(1, 0);
  const count = 40 * 5;
  const inst = new THREE.InstancedMesh(puff, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, transparent: true, opacity: 0.95 }), count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  let seed = 777;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  let i = 0;
  for (let c = 0; c < 40; c++) {
    const cx = (rnd() - 0.5) * 2800, cy = 140 + rnd() * 140, cz = (rnd() - 0.5) * 2800;
    for (let j = 0; j < 5; j++) {
      const sc = 7 + rnd() * 9;
      p.set(cx + (rnd() - 0.5) * 34, cy + (rnd() - 0.5) * 6, cz + (rnd() - 0.5) * 16);
      inst.setMatrixAt(i++, m.compose(p, q, s.set(sc, sc * 0.7, sc)));
    }
  }
  inst.castShadow = true;
  scene.add(inst);
}
