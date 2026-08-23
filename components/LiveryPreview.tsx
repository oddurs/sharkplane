"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { makePlane, LIVERIES } from "@/lib/models";

/** Small turntable of the selected livery for the Options page. */
export default function LiveryPreview({ livery }: { livery: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xbfe3ff, 0x4a7a32, 1.0));
    const sun = new THREE.DirectionalLight(0xfff2d0, 1.3); sun.position.set(3, 5, 4); scene.add(sun);
    const camera = new THREE.PerspectiveCamera(35, el.clientWidth / el.clientHeight, 0.1, 100);
    const model = makePlane(0, { livery: LIVERIES[Math.min(livery, LIVERIES.length - 1)] });
    model.gear!.visible = false;
    scene.add(model.group);
    let raf = 0, t = 0, last = performance.now();
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = (now - last) / 1000; last = now; t += dt;
      model.group.rotation.y = t * 0.6;
      model.prop.rotation.z += 30 * dt;
      if (model.jaw) model.jaw.rotation.x = -0.15 - 0.15 * Math.sin(t * 2);
      camera.position.set(Math.sin(0.7) * 9.5, 2.6, Math.cos(0.7) * 9.5);
      camera.lookAt(0, 0, -1);
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); renderer.dispose(); renderer.domElement.remove(); };
  }, [livery]);
  return <div id="livery-preview" ref={ref} />;
}
