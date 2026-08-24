"use client";

import { useEffect, useState, type RefObject } from "react";
import type { Engine } from "@/lib/engine";
import { LIVERIES } from "@/lib/models";
import { LEVELS } from "@/lib/levels";
import { store, useGame, type Options } from "@/lib/store";
import { t, LANGS } from "@/lib/i18n";
import { Tilt } from "@/lib/input";
import LiveryPreview from "./LiveryPreview";

export default function Menus({ engine }: { engine: RefObject<Engine | null> }) {
  const phase = useGame((s) => s.phase);
  const page = useGame((s) => s.menuPage);
  const e = () => engine.current!;
  const lang = useGame((s) => s.options.lang); void lang; // re-render on language change
  if (phase === "playing" || phase === "countdown" || phase === "intro") return null;

  const back = () => { engine.current?.ui("back"); store.set({ menuPage: "main" }); };
  const body =
    page === "levels" ? <Mirror ids={[...LEVELS.map((l) => `level:${l.id}`), "daily", "back"]} labels={[...LEVELS.map((l) => l.name), "Daily sortie", t("back")]} /> :
    page === "controls" ? <Controls onBack={back} /> :
    page === "options" ? <OptionsPage onBack={back} engine={engine} /> :
    phase === "title" ? <Title /> :
    phase === "roundOver" ? <ScoreCard /> :
    <Pause />;

  // Title and pause main menus render in 3-D (lib/ui/hud3d.ts); this invisible mirror keeps them
  // keyboard-navigable and visible to screen readers. Focusing a mirror button lights its 3-D twin.
  function Mirror({ ids, labels }: { ids: string[]; labels?: string[] }) {
    return (
      <div className="menu-mirror" role="menu" aria-label="Game menu">
        {ids.map((id, i) => (
          <button key={id} autoFocus={i === 0} onFocus={() => e().setMenuHover(id)} onBlur={() => e().setMenuHover("")} onClick={() => e().menuAction(id)}>
            {labels?.[i] ?? t(id as Parameters<typeof t>[0])}
          </button>
        ))}
      </div>
    );
  }
  function Title() { return <Mirror ids={["sortie", "controls", "options"]} />; }
  function Pause() { return <Mirror ids={["resume", "restart", "controls", "options", "quit"]} />; }
  function ScoreCard() {
    const r = store.get().round;
    const [copied, setCopied] = useState(false);
    const [shown, setShown] = useState(0);
    const [medalIn, setMedalIn] = useState(false);
    useEffect(() => {
      let raf = 0; const t0 = performance.now(); const dur = 900;
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / dur);
        setShown(Math.round(r.score * (1 - Math.pow(1 - k, 3))));
        if (k < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
      const medalT = setTimeout(() => setMedalIn(true), 1100);
      return () => { cancelAnimationFrame(raf); clearTimeout(medalT); };
    }, [r.score]);
    const share = `SHARKPLANE ${r.dateKey} · ${r.score} pts · ${r.eaten} eaten · best combo x${r.bestCombo}${r.medal !== "none" ? ` · ${r.medal.toUpperCase()} medal` : ""}`;
    const copy = () => { navigator.clipboard?.writeText(share).then(() => setCopied(true)); };
    return (
      <>
        <h2>{t("complete")}</h2>
        <div className="badges">
          {r.medal !== "none" && medalIn && <div className={`medal ${r.medal}`}>{r.medal.toUpperCase()} {t("medal")}</div>}
          {r.isHighScore && <div className="badge">{t("newHigh")}</div>}
          {r.unlocked && <div className="badge unlock">{t("unlocked")}: {r.unlocked}</div>}
        </div>
        <div className="card">
          <Row k={t("score")} v={shown} />
          <Row k={t("planesEaten")} v={`${r.eaten}  (${r.eatenByKind.fighter}F · ${r.eatenByKind.bomber}B · ${r.eatenByKind.escort}E${r.eatenByKind.boss ? ` · ${r.eatenByKind.boss} zeppelin` : ""})`} />
          <Row k={t("bestCombo")} v={r.bestCombo > 0 ? `x${r.bestCombo}` : "—"} />
          <Row k={t("firstBite")} v={r.firstBite === null ? t("never") : `${r.firstBite.toFixed(1)}s`} />
          {r.objectives.map((o) => <Row key={o.id} k={`${o.done ? "✓" : "○"} ${o.text}`} v={o.done ? "+500" : `${o.progress}/${o.target}`} />)}
          <Row k={t("highScore")} v={r.highScore} />
        </div>
        <button className="primary" autoFocus onClick={() => { e().ui("confirm"); e().restart(); }}>{t("flyAgain")}</button>
        <button onClick={() => { e().ui("confirm"); copy(); }}>{copied ? t("copied") : t("copy")}</button>
        <button onClick={() => { e().ui("back"); e().quitToTitle(); }}>{t("title")}</button>
      </>
    );
  }

  return (
    <div id="menu" className={`${phase === "paused" ? "dim" : ""} ${(page === "main" || page === "levels") && (phase === "title" || phase === "paused") ? "passthrough" : ""}`} onMouseOver={(ev) => { if ((ev.target as HTMLElement).tagName === "BUTTON" && page !== "main") engine.current?.ui("hover"); }}>
      <div className="panel">{body}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string | number }) {
  return <div className="row"><span>{k}</span><span>{v}</span></div>;
}

function Controls({ onBack }: { onBack: () => void }) {
  const invertY = useGame((s) => s.options.invertY);
  const touch = useGame((s) => s.options.touch);
  const scheme = useGame((s) => s.options.scheme);
  if (touch) return (
    <>
      <h2>{t("controls")}</h2>
      <div className="card controls">
        <Row k="Steer" v={scheme === "tilt" ? "tilt the phone (calibrates on SORTIE)" : scheme === "stick" ? "stick, bottom-left" : "drag anywhere on the left half"} />
        <Row k="Climb / dive" v={invertY ? "drag down = climb, up = dive" : "drag up = climb, down = dive"} />
        <Row k="Throttle" v="slider (sticks) · double-tap = full" />
        <Row k="Bite lunge / boost" v="tap BITE / hold BITE" />
        <Row k="Brake" v="BRAKE (shows while rolling)" />
        <Row k="Free look" v="second finger on the left half" />
        <Row k="Pause" v="II top-right" />
      </div>
      <p className="muted">Tip: Auto-throttle is on — one thumb steers, the other bites.</p>
      <button className="primary" autoFocus onClick={onBack}>{t("back")}</button>
    </>
  );
  return (
    <>
      <h2>CONTROLS</h2>
      <div className="card controls">
        <Row k="Pitch" v={`${invertY ? "S = climb, W = dive" : "W = climb, S = dive"}  ·  left stick`} />
        <Row k="Roll / steer" v="A / D  ·  ← / →  ·  left stick" />
        <Row k="Yaw" v="Q / E  ·  bumpers" />
        <Row k="Throttle" v="Shift up · Ctrl down  ·  RT" />
        <Row k="Brake (on ground)" v="Ctrl  ·  LT" />
        <Row k="Boost (hold)" v="Space  ·  A" />
        <Row k="Bite lunge (tap)" v="Space  ·  A" />
        <Row k="Free look" v="right-drag  ·  right stick" />
        <Row k="Pause" v="Esc  ·  Start" />
      </div>
      <p className="muted">Throttle up, roll down the runway, pull up past 150. Eat everything. Keep the FOOD meter up or you lose boost.</p>
      <button className="primary" autoFocus onClick={onBack}>{t("back")}</button>
    </>
  );
}

function OptionsPage({ onBack, engine }: { onBack: () => void; engine: RefObject<Engine | null> }) {
  const o = useGame((s) => s.options);
  const totalEaten = useGame((s) => s.progress.totalEaten);
  const set = (patch: Partial<Options>) => { store.setOptions(patch); engine.current?.applyOptions(store.get().options); };
  return (
    <>
      <h2>OPTIONS</h2>
      <LiveryPreview livery={o.livery} />
      <div className="card options">
        <div className="section">GAME</div>
        <label><span>Livery</span>
          <select value={o.livery} onChange={(ev) => set({ livery: +ev.target.value })}>
            {LIVERIES.map((l, i) => <option key={l.name} value={i} disabled={totalEaten < l.unlockAt}>{l.name}{totalEaten < l.unlockAt ? ` (eat ${l.unlockAt})` : ""}</option>)}
          </select></label>
        <label><span>Quality</span>
          <select value={o.quality} onChange={(ev) => set({ quality: ev.target.value as Options["quality"] })}>
            <option value="high">High (shadows + glow)</option><option value="medium">Medium (glow, lighter world)</option><option value="low">Low</option>
          </select></label>
        <label><span>Field of view {o.fov}°</span>
          <input type="range" min={60} max={100} step={1} value={o.fov} onChange={(ev) => set({ fov: +ev.target.value })} /></label>
        <label><span>Screen shake {Math.round(o.shake * 100)}%</span>
          <input type="range" min={0} max={1} step={0.1} value={o.shake} onChange={(ev) => set({ shake: +ev.target.value })} /></label>
        <label><span>Invert Y (pull back to climb)</span>
          <input type="checkbox" checked={o.invertY} onChange={(ev) => set({ invertY: ev.target.checked })} /></label>
        <label><span>Sensitivity {o.sensitivity.toFixed(1)}</span>
          <input type="range" min={0.5} max={2} step={0.1} value={o.sensitivity} onChange={(ev) => set({ sensitivity: +ev.target.value })} /></label>
        <div className="section">SOUND</div>
        <label><span>Master volume {Math.round(o.volume * 100)}%</span>
          <input type="range" min={0} max={1} step={0.05} value={o.volume} onChange={(ev) => set({ volume: +ev.target.value })} /></label>
        <label><span>Music {Math.round(o.music * 100)}%</span>
          <input type="range" min={0} max={1} step={0.05} value={o.music} onChange={(ev) => set({ music: +ev.target.value })} /></label>
        <label><span>Effects {Math.round(o.sfx * 100)}%</span>
          <input type="range" min={0} max={1} step={0.05} value={o.sfx} onChange={(ev) => set({ sfx: +ev.target.value })} /></label>
        <label><span>Interface {Math.round(o.ui * 100)}%</span>
          <input type="range" min={0} max={1} step={0.05} value={o.ui} onChange={(ev) => set({ ui: +ev.target.value })} /></label>
        <label><span>Captions for sounds</span>
          <input type="checkbox" checked={o.captions} onChange={(ev) => set({ captions: ev.target.checked })} /></label>
        <div className="section">ACCESSIBILITY</div>
        <label><span>Reduced motion</span>
          <input type="checkbox" checked={o.reducedMotion} onChange={(ev) => set({ reducedMotion: ev.target.checked })} /></label>
        <label><span>High-contrast HUD</span>
          <input type="checkbox" checked={o.highContrast} onChange={(ev) => set({ highContrast: ev.target.checked })} /></label>
        <label><span>Language</span>
          <select value={o.lang} onChange={(ev) => set({ lang: ev.target.value as Options["lang"] })}>
            {LANGS.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
          </select></label>
        <label><span>Replay tutorial</span>
          <input type="checkbox" checked={!o.tutorialDone} onChange={(ev) => set({ tutorialDone: !ev.target.checked })} /></label>
        <label><span>Gamepad</span>
          <input type="checkbox" checked={o.gamepad} onChange={(ev) => set({ gamepad: ev.target.checked })} /></label>
        <label><span>Touch controls</span>
          <input type="checkbox" checked={o.touch} onChange={(ev) => set({ touch: ev.target.checked })} /></label>
        {o.touch && (
          <>
            <label><span>Touch steering</span>
              <select value={o.scheme} onChange={async (ev) => { const scheme = ev.target.value as Options["scheme"]; if (scheme === "tilt" && !(await Tilt.requestPermission())) return; set({ scheme }); }}>
                <option value="anywhere">Touch anywhere (left half)</option><option value="stick">Fixed stick</option><option value="tilt">Tilt the phone</option>
              </select></label>
            <label><span>Auto-throttle (one-thumb play)</span>
              <input type="checkbox" checked={o.autoThrottle} onChange={(ev) => set({ autoThrottle: ev.target.checked })} /></label>
            {o.scheme === "tilt" && <label><span>Invert tilt pitch</span>
              <input type="checkbox" checked={o.tiltInvert} onChange={(ev) => set({ tiltInvert: ev.target.checked })} /></label>}
          </>
        )}
        <label><span>Colour-blind marker tags</span>
          <input type="checkbox" checked={o.colorblind} onChange={(ev) => set({ colorblind: ev.target.checked })} /></label>
      </div>
      <button className="primary" autoFocus onClick={onBack}>{t("back")}</button>
    </>
  );
}
