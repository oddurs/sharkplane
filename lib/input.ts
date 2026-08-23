import type { Options } from "./store";

/** Written by the on-screen touch controls, read by Input.update. */
export const touchState = { x: 0, y: 0, throttle: null as number | null, boost: false, bite: false, pause: false };

/** Smoothed, expo-curved flight inputs from keyboard + gamepad. */
export class Input {
  private keys: Record<string, boolean> = {};
  private pauseEdge = false;
  private skipEdge = false;
  private boostDownAt = -1;

  // smoothed axes (-1..1)
  pitch = 0;
  roll = 0;
  yaw = 0;
  lookX = 0; // free-look offsets (-1..1)
  lookY = 0;
  throttleDelta = 0; // keyboard: -1 / 0 / +1
  throttleAxis: number | null = null; // gamepad trigger: absolute 0..1 (null = not driving)
  brake = false;
  boostHeld = false;
  boostTap = false; // true for one frame on a quick tap
  gamepadActive = false;
  private mouseLook = { down: false, x: 0, y: 0 };

  constructor(private target: HTMLElement) {
    addEventListener("keydown", this.onKeyDown);
    addEventListener("keyup", this.onKeyUp);
    target.addEventListener("pointerdown", this.onPointerDown);
    addEventListener("pointermove", this.onPointerMove);
    addEventListener("pointerup", this.onPointerUp);
    target.addEventListener("contextmenu", this.prevent);
    addEventListener("blur", this.clear);
  }

  dispose() {
    removeEventListener("keydown", this.onKeyDown);
    removeEventListener("keyup", this.onKeyUp);
    this.target.removeEventListener("pointerdown", this.onPointerDown);
    removeEventListener("pointermove", this.onPointerMove);
    removeEventListener("pointerup", this.onPointerUp);
    this.target.removeEventListener("contextmenu", this.prevent);
    removeEventListener("blur", this.clear);
  }

  /** Any key or click since last call (used to skip the intro). */
  consumeSkip() { const k = this.skipEdge; this.skipEdge = false; return k; }

  /** Returns true once per Esc / Start press. */
  consumePause() {
    const p = this.pauseEdge;
    this.pauseEdge = false;
    return p;
  }

  private prevent = (e: Event) => e.preventDefault();
  private clear = () => { this.keys = {}; this.mouseLook.down = false; };
  private onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    this.keys[e.code] = true;
    if (e.code !== "Escape") this.skipEdge = true;
    if (e.code === "Escape") this.pauseEdge = true;
    if (e.code === "Space") this.boostDownAt = performance.now();
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) e.preventDefault();
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.keys[e.code] = false;
    if (e.code === "Space" && performance.now() - this.boostDownAt < 200) this.boostTap = true;
  };
  private onPointerDown = (e: PointerEvent) => {
    this.skipEdge = true;
    if (e.button === 2) this.mouseLook = { down: true, x: e.clientX, y: e.clientY };
  };
  private onPointerMove = (e: PointerEvent) => {
    if (!this.mouseLook.down) return;
    this.lookX = clamp((e.clientX - this.mouseLook.x) / 300, -1, 1);
    this.lookY = clamp((e.clientY - this.mouseLook.y) / 300, -1, 1);
  };
  private onPointerUp = () => { this.mouseLook.down = false; };

  private key = (...ks: string[]) => ks.some((k) => this.keys[k]);

  update(dt: number, opts: Options) {
    let pitchRaw = (this.key("KeyW", "ArrowUp") ? 1 : 0) - (this.key("KeyS", "ArrowDown") ? 1 : 0);
    let rollRaw = (this.key("KeyA", "ArrowLeft") ? 1 : 0) - (this.key("KeyD", "ArrowRight") ? 1 : 0);
    let yawRaw = (this.key("KeyQ") ? 1 : 0) - (this.key("KeyE") ? 1 : 0);
    this.throttleDelta = (this.key("ShiftLeft", "ShiftRight") ? 1 : 0) - (this.key("ControlLeft", "ControlRight") ? 1 : 0);
    this.brake = this.key("ControlLeft", "ControlRight");
    this.boostHeld = this.key("Space");
    this.throttleAxis = null;
    let lookX = 0, lookY = 0;
    this.gamepadActive = false;

    const gp = opts.gamepad ? pickGamepad() : null;
    if (gp) {
      const ax = (i: number) => dead(gp.axes[i] ?? 0);
      const btn = (i: number) => (gp.buttons[i]?.value ?? 0);
      const lx = ax(0), ly = ax(1), rx = ax(2), ry = ax(3);
      if (lx || ly || rx || ry || btn(7) || btn(6) || btn(0) || btn(4) || btn(5) || btn(9)) this.gamepadActive = true;
      if (ly) pitchRaw = -ly;
      if (lx) rollRaw = -lx;
      yawRaw += btn(5) - btn(4);
      if (btn(7) > 0.02) this.throttleAxis = btn(7);
      if (btn(6) > 0.5) this.brake = true;
      const a = btn(0) > 0.5;
      if (a && !this.prevA) this.boostDownAt = performance.now();
      if (!a && this.prevA && performance.now() - this.boostDownAt < 200) this.boostTap = true;
      this.prevA = a;
      if (a) this.boostHeld = true;
      lookX = rx; lookY = ry;
      if (btn(9) > 0.5) { if (!this.startHeld) this.pauseEdge = true; this.startHeld = true; } else this.startHeld = false;
    }

    if (opts.touch) {
      if (touchState.x || touchState.y) { rollRaw = -touchState.x; pitchRaw = -touchState.y; }
      if (touchState.throttle !== null) this.throttleAxis = touchState.throttle;
      if (touchState.boost) this.boostHeld = true;
      if (touchState.bite) { this.boostTap = true; touchState.bite = false; }
      if (touchState.pause) { this.pauseEdge = true; touchState.pause = false; }
    }

    if (opts.invertY) pitchRaw = -pitchRaw;
    const sens = opts.sensitivity;
    // ~80 ms ramp (just enough to de-click keys), expo curve for fine control near center
    const k = 1 - Math.exp(-dt / 0.08);
    this.pitch += (expo(pitchRaw) * sens - this.pitch) * k;
    this.roll += (expo(rollRaw) * sens - this.roll) * k;
    this.yaw += (yawRaw * sens - this.yaw) * k;
    if (!this.mouseLook.down) {
      this.lookX += (lookX - this.lookX) * Math.min(1, dt * 8);
      this.lookY += (lookY - this.lookY) * Math.min(1, dt * 8);
    }
  }
  private startHeld = false;
  private prevA = false;

  /** Gamepad rumble (no-op without a pad or actuator). */
  rumble(strong: number, weak: number, ms: number) {
    const gp = pickGamepad();
    const act = (gp as (Gamepad & { vibrationActuator?: { playEffect?: (type: string, p: Record<string, number>) => Promise<unknown> } }) | null)?.vibrationActuator;
    act?.playEffect?.("dual-rumble", { duration: ms, strongMagnitude: strong, weakMagnitude: weak })?.catch(() => {});
  }

  /** Consume the one-frame tap flag. */
  consumeBoostTap() {
    const t = this.boostTap;
    this.boostTap = false;
    return t;
  }
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const dead = (v: number) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
const expo = (v: number) => Math.sign(v) * (0.6 * Math.abs(v) + 0.4 * v * v);

function pickGamepad(): Gamepad | null {
  if (typeof navigator === "undefined" || !navigator.getGamepads) return null;
  for (const g of navigator.getGamepads()) if (g && g.connected) return g;
  return null;
}
