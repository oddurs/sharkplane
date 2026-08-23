import * as THREE from "three";

export type TimeOfDay = "dawn" | "noon" | "sunset" | "dusk";
export const TIMES_OF_DAY: readonly TimeOfDay[] = ["dawn", "noon", "sunset", "dusk"];

type Palette = {
  top: number; horizon: number; sun: number; sunDir: THREE.Vector3;
  sunIntensity: number; hemiSky: number; hemiGround: number; hemiIntensity: number; fog: [number, number];
};

const PALETTES: Record<TimeOfDay, Palette> = {
  dawn: { top: 0x4d7fc0, horizon: 0xffc59a, sun: 0xffd9b0, sunDir: new THREE.Vector3(0.9, 0.25, 0.3), sunIntensity: 1.1, hemiSky: 0xffd4b0, hemiGround: 0x4a6a3a, hemiIntensity: 0.8, fog: [380, 1500] },
  noon: { top: 0x3f8fe8, horizon: 0xcfe9ff, sun: 0xfff4d6, sunDir: new THREE.Vector3(0.4, 0.9, 0.3), sunIntensity: 1.4, hemiSky: 0xbfe3ff, hemiGround: 0x4a7a32, hemiIntensity: 0.9, fog: [450, 1700] },
  sunset: { top: 0x2b3f7a, horizon: 0xff8c5a, sun: 0xffb070, sunDir: new THREE.Vector3(-0.9, 0.18, -0.2), sunIntensity: 1.2, hemiSky: 0xffa070, hemiGround: 0x3a4a2a, hemiIntensity: 0.7, fog: [320, 1400] },
  dusk: { top: 0x141c3c, horizon: 0x6a7ab8, sun: 0xd0d8ff, sunDir: new THREE.Vector3(-0.5, 0.35, 0.8), sunIntensity: 0.55, hemiSky: 0x6a7ab8, hemiGround: 0x1e2a1e, hemiIntensity: 0.9, fog: [260, 1200] },
};

const skyVert = `
  varying vec3 vWorld;
  void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }
`;
const skyFrag = `
  uniform vec3 top; uniform vec3 horizon; uniform vec3 sunColor; uniform vec3 sunDir;
  varying vec3 vWorld;
  void main() {
    vec3 d = normalize(vWorld);
    float h = clamp(d.y, 0.0, 1.0);
    vec3 col = mix(horizon, top, pow(h, 0.55));
    float s = max(dot(d, normalize(sunDir)), 0.0);
    col += sunColor * (pow(s, 600.0) * 0.9 + pow(s, 12.0) * 0.08);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class Sky {
  dome: THREE.Mesh;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  private uniforms: { top: { value: THREE.Color }; horizon: { value: THREE.Color }; sunColor: { value: THREE.Color }; sunDir: { value: THREE.Vector3 } };

  constructor(private scene: THREE.Scene) {
    this.uniforms = {
      top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() },
      sunColor: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3() },
    };
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(2600, 24, 12),
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false, fog: false }),
    );
    this.dome.renderOrder = -1;
    scene.add(this.dome);

    this.hemi = new THREE.HemisphereLight(0xbfe3ff, 0x4a7a32, 0.9);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff2d0, 1.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.near = 10; sc.far = 900; sc.left = -220; sc.right = 220; sc.top = 220; sc.bottom = -220;
    this.sun.shadow.bias = -0.0008;
    scene.add(this.sun, this.sun.target);
    this.apply("noon");
  }

  /** Continuous sun arc: blend between two palettes (t 0..1) — used for the in-round day cycle. */
  blend(a: TimeOfDay, b: TimeOfDay, t: number, rain = 0) {
    const pa = PALETTES[a], pb = PALETTES[b];
    const mixC = (x: number, y: number) => new THREE.Color(x).lerp(new THREE.Color(y), t);
    const p: Palette = {
      top: mixC(pa.top, pb.top).getHex(), horizon: mixC(pa.horizon, pb.horizon).getHex(), sun: mixC(pa.sun, pb.sun).getHex(),
      sunDir: pa.sunDir.clone().lerp(pb.sunDir, t).normalize(),
      sunIntensity: THREE.MathUtils.lerp(pa.sunIntensity, pb.sunIntensity, t), hemiSky: mixC(pa.hemiSky, pb.hemiSky).getHex(),
      hemiGround: mixC(pa.hemiGround, pb.hemiGround).getHex(), hemiIntensity: THREE.MathUtils.lerp(pa.hemiIntensity, pb.hemiIntensity, t),
      fog: [THREE.MathUtils.lerp(pa.fog[0], pb.fog[0], t), THREE.MathUtils.lerp(pa.fog[1], pb.fog[1], t)],
    };
    if (rain > 0) {
      const grey = new THREE.Color(0x6f7a88);
      p.top = new THREE.Color(p.top).lerp(grey, rain * 0.7).getHex(); p.horizon = new THREE.Color(p.horizon).lerp(grey, rain * 0.6).getHex();
      p.sunIntensity *= 1 - rain * 0.6; p.fog = [p.fog[0] * (1 - rain * 0.5), p.fog[1] * (1 - rain * 0.4)];
    }
    this.applyPalette(p);
  }

  apply(t: TimeOfDay) { this.applyPalette(PALETTES[t]); }

  private applyPalette(p: Palette) {
    this.uniforms.top.value.set(p.top);
    this.uniforms.horizon.value.set(p.horizon);
    this.uniforms.sunColor.value.set(p.sun);
    this.uniforms.sunDir.value.copy(p.sunDir).normalize();
    this.sun.color.set(p.sun); this.sun.intensity = p.sunIntensity;
    this.hemi.color.set(p.hemiSky); this.hemi.groundColor.set(p.hemiGround); this.hemi.intensity = p.hemiIntensity;
    this.scene.fog = new THREE.Fog(p.horizon, p.fog[0], p.fog[1]);
    this.scene.background = new THREE.Color(p.horizon);
  }

  /** Keep the dome and the shadow frustum centred on the player. */
  follow(pos: THREE.Vector3) {
    this.dome.position.copy(pos);
    const dir = this.uniforms.sunDir.value;
    this.sun.position.copy(pos).addScaledVector(dir, 400);
    this.sun.target.position.copy(pos);
  }

  setShadows(on: boolean) { this.sun.castShadow = on; }
}
