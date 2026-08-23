import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { FXAAShader } from "three/addons/shaders/FXAAShader.js";

const VignetteShader = {
  uniforms: { tDiffuse: { value: null }, strength: { value: 0.35 }, tint: { value: new THREE.Vector3(0, 0, 0) }, tintAmount: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float strength; uniform vec3 tint; uniform float tintAmount; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5; float v = 1.0 - dot(d, d) * strength * 2.2;
      c.rgb *= v;
      c.rgb = mix(c.rgb, c.rgb * tint + tint * 0.25, tintAmount);
      gl_FragColor = c;
    }`,
};

/** Bloom + FXAA + vignette/tint, or a plain render when quality is low. */
export class Post {
  private composer: EffectComposer;
  private fxaa: ShaderPass;
  private vignette: ShaderPass;
  private bloom: UnrealBloomPass;
  enabled = true;

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.35, 0.5, 0.82);
    this.composer.addPass(this.bloom);
    this.vignette = new ShaderPass(VignetteShader);
    this.composer.addPass(this.vignette);
    this.composer.addPass(new OutputPass());
    this.fxaa = new ShaderPass(FXAAShader);
    this.composer.addPass(this.fxaa);
    this.resize();
  }

  setBloomResolution(scale: number) { this.bloom.resolution.set(innerWidth * scale, innerHeight * scale); }

  resize() {
    const pr = this.renderer.getPixelRatio();
    this.composer.setSize(innerWidth, innerHeight);
    (this.fxaa.material.uniforms.resolution.value as THREE.Vector2).set(1 / (innerWidth * pr), 1 / (innerHeight * pr));
  }

  /** tint: 0..1 amount of a colour wash (used for feeding frenzy). */
  setTint(color: THREE.Color, amount: number) {
    (this.vignette.material.uniforms.tint.value as THREE.Vector3).set(color.r, color.g, color.b);
    this.vignette.material.uniforms.tintAmount.value = amount;
  }

  render(scene: THREE.Scene, camera: THREE.Camera) {
    if (this.enabled) this.composer.render();
    else this.renderer.render(scene, camera);
  }
}
