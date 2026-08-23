"use client";

import { useRef, type PointerEvent } from "react";
import { touchState } from "@/lib/input";

/** Virtual stick (left), throttle slider + bite/boost button (right). Writes into touchState. */
export default function TouchControls() {
  const stickRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const throttleRef = useRef<HTMLDivElement>(null);
  const boostAt = useRef(0);

  const stick = (e: PointerEvent<HTMLDivElement>) => {
    const el = stickRef.current!, r = el.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2), dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const len = Math.hypot(dx, dy), k = len > 1 ? 1 / len : 1;
    touchState.x = dx * k; touchState.y = dy * k;
    if (knobRef.current) knobRef.current.style.transform = `translate(${dx * k * 40}px, ${dy * k * 40}px)`;
  };
  const stickEnd = () => { touchState.x = 0; touchState.y = 0; if (knobRef.current) knobRef.current.style.transform = ""; };
  const throttle = (e: PointerEvent<HTMLDivElement>) => {
    const r = throttleRef.current!.getBoundingClientRect();
    touchState.throttle = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height));
  };

  return (
    <div id="touch">
      <div id="stick" ref={stickRef} onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); stick(e); }} onPointerMove={(e) => e.buttons && stick(e)} onPointerUp={stickEnd} onPointerCancel={stickEnd}>
        <div className="knob" ref={knobRef} />
      </div>
      <div id="throttle-slider" ref={throttleRef} onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); throttle(e); }} onPointerMove={(e) => e.buttons && throttle(e)}>
        <span>THR</span>
      </div>
      <button id="bite-btn"
        onPointerDown={() => { boostAt.current = performance.now(); touchState.boost = true; }}
        onPointerUp={() => { touchState.boost = false; if (performance.now() - boostAt.current < 200) touchState.bite = true; }}
        onPointerCancel={() => { touchState.boost = false; }}>BITE</button>
      <button id="pause-btn" onPointerDown={() => { touchState.pause = true; }}>II</button>
    </div>
  );
}
