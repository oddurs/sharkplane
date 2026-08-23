"use client";

import { useEffect, useRef, type PointerEvent as RPointerEvent } from "react";
import { touchState } from "@/lib/input";
import { useGame } from "@/lib/store";

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const buzz = (ms: number) => { try { navigator.vibrate?.(ms); } catch { /* no haptics */ } };

/**
 * Touch HUD. Left half: steering (touch-anywhere relative stick, or a fixed stick). Right side: sticky throttle
 * with detents, BITE (tap = lunge, hold = boost), BRAKE while rolling, PAUSE. Two fingers on the left = free look.
 * Every control owns its pointerId so three fingers at once never collide.
 */
export default function TouchControls() {
  const scheme = useGame((s) => s.options.scheme);
  const autoThrottle = useGame((s) => s.options.autoThrottle);
  const rolling = useGame((s) => s.hud.rolling);
  const zoneRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const throttleRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const steer = useRef<{ id: number; ox: number; oy: number } | null>(null);
  const look = useRef<{ id: number; x: number; y: number } | null>(null);
  const boostAt = useRef(0);
  const fullDeflect = useRef(false);
  const R = 52; // stick radius in px

  const setVector = (dx: number, dy: number) => {
    const len = Math.hypot(dx, dy), k = len > R ? R / len : 1;
    const x = (dx * k) / R, y = (dy * k) / R;
    const dead = 0.08, m = Math.hypot(x, y);
    const g = m < dead ? 0 : (m - dead) / (1 - dead) / m;
    touchState.x = x * g; touchState.y = y * g;
    if (knobRef.current) knobRef.current.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    const full = m >= 0.98;
    if (full && !fullDeflect.current) buzz(8);
    fullDeflect.current = full;
  };

  const onZoneDown = (e: RPointerEvent<HTMLDivElement>) => {
    const zone = zoneRef.current!;
    zone.setPointerCapture(e.pointerId);
    if (steer.current && !look.current) { look.current = { id: e.pointerId, x: e.clientX, y: e.clientY }; return; }
    if (steer.current) return;
    const r = zone.getBoundingClientRect();
    let ox = e.clientX, oy = e.clientY;
    if (scheme === "stick") { ox = r.left + 110; oy = r.bottom - 110; } // fixed stick anchor
    steer.current = { id: e.pointerId, ox, oy };
    if (ringRef.current) { ringRef.current.style.left = `${ox - r.left}px`; ringRef.current.style.top = `${oy - r.top}px`; ringRef.current.classList.add("active"); }
    setVector(e.clientX - ox, e.clientY - oy);
  };
  const onZoneMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (steer.current?.id === e.pointerId) setVector(e.clientX - steer.current.ox, e.clientY - steer.current.oy);
    else if (look.current?.id === e.pointerId) { touchState.lookX = clamp((e.clientX - look.current.x) / 200, -1, 1); touchState.lookY = clamp((e.clientY - look.current.y) / 200, -1, 1); }
  };
  const onZoneUp = (e: RPointerEvent<HTMLDivElement>) => {
    if (steer.current?.id === e.pointerId) { steer.current = null; touchState.x = 0; touchState.y = 0; fullDeflect.current = false; ringRef.current?.classList.remove("active"); if (knobRef.current) knobRef.current.style.transform = ""; }
    if (look.current?.id === e.pointerId) { look.current = null; touchState.lookX = 0; touchState.lookY = 0; }
  };

  const setThrottle = (v: number, detent = true) => {
    let t = clamp(v, 0, 1);
    if (detent) for (const d of [0, 0.5, 1]) if (Math.abs(t - d) < 0.06) { if (t !== d) buzz(6); t = d; }
    touchState.throttle = t;
    if (fillRef.current) fillRef.current.style.height = `${t * 100}%`;
  };
  const throttleFromEvent = (e: RPointerEvent<HTMLDivElement>) => {
    const r = throttleRef.current!.getBoundingClientRect();
    setThrottle(1 - (e.clientY - r.top) / r.height);
  };
  useEffect(() => { if (autoThrottle && touchState.throttle === null) setThrottle(1, false); }, [autoThrottle]);
  const lastTap = useRef(0);

  return (
    <div id="touch" className={scheme}>
      <div id="steer-zone" ref={zoneRef} onPointerDown={onZoneDown} onPointerMove={onZoneMove} onPointerUp={onZoneUp} onPointerCancel={onZoneUp}>
        <div id="stick-ring" ref={ringRef} className={scheme === "stick" ? "active fixed" : ""}><div className="knob" ref={knobRef} /></div>
        {scheme === "tilt" && <div className="hint">TILT TO STEER · touch here to look</div>}
      </div>
      <div id="throttle-slider" ref={throttleRef}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); const now = performance.now(); if (now - lastTap.current < 300) setThrottle(1, false); else throttleFromEvent(e); lastTap.current = now; }}
        onPointerMove={(e) => e.buttons && throttleFromEvent(e)}>
        <div className="fill" ref={fillRef} style={{ height: `${(touchState.throttle ?? (autoThrottle ? 1 : 0)) * 100}%` }} />
        <span className="d d100">100</span><span className="d d50">50</span><span className="d d0">0</span>
        <span className="label">THR</span>
      </div>
      <button id="bite-btn" aria-label="Bite (tap) or boost (hold)"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); boostAt.current = performance.now(); touchState.boost = true; buzz(10); }}
        onPointerUp={() => { touchState.boost = false; if (performance.now() - boostAt.current < 220) touchState.bite = true; }}
        onPointerCancel={() => { touchState.boost = false; }}>BITE</button>
      {rolling && (
        <button id="brake-btn" aria-label="Brake"
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); touchState.brake = true; }}
          onPointerUp={() => { touchState.brake = false; }} onPointerCancel={() => { touchState.brake = false; }}>BRAKE</button>
      )}
      <button id="pause-btn" aria-label="Pause" onPointerDown={() => { touchState.pause = true; }}>II</button>
    </div>
  );
}
