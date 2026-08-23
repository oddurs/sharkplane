"use client";

import { useEffect, useRef, useState } from "react";
import { Engine } from "@/lib/engine";
import { store, useGame } from "@/lib/store";
import { isIOS, isStandalone, isTouch } from "@/lib/device";
import Hud from "./Hud";
import Menus from "./Menus";

type Status = { kind: "loading"; step: string } | { kind: "ready" } | { kind: "nowebgl" } | { kind: "error"; message: string };

function hasWebGL() {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; }
}

export default function Game() {
  const rootRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "loading", step: "Warming up the engine…" });
  const [installEvt, setInstallEvt] = useState<(Event & { prompt: () => Promise<void> }) | null>(null);
  const [showIosTip, setShowIosTip] = useState(false);
  const phase = useGame((s) => s.phase);
  const toast = useGame((s) => s.hud.toast);

  // PWA install prompt (Android/desktop) or the iOS "Add to Home Screen" coach-mark
  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setInstallEvt(e as Event & { prompt: () => Promise<void> }); };
    addEventListener("beforeinstallprompt", onPrompt);
    const tip = setTimeout(() => { try { if (isIOS() && !isStandalone() && !localStorage.getItem("sharkplane.iosTip")) setShowIosTip(true); } catch { /* no storage */ } }, 1500);
    return () => { clearTimeout(tip); removeEventListener("beforeinstallprompt", onPrompt); };
  }, []);

  // Touch devices: go fullscreen + lock landscape on the first tap (must be a gesture), and keep the screen awake while playing
  useEffect(() => {
    if (!isTouch()) return;
    const go = async () => {
      try { if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.({ navigationUI: "hide" }); } catch { /* iOS Safari: no fullscreen API for pages */ }
      try { await (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.("landscape"); } catch { /* not allowed outside PWA */ }
      removeEventListener("pointerdown", go);
    };
    addEventListener("pointerdown", go);
    return () => removeEventListener("pointerdown", go);
  }, []);
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } };
    if (phase === "playing" && nav.wakeLock) nav.wakeLock.request("screen").then((l) => { lock = l; }).catch(() => {});
    return () => { lock?.release().catch(() => {}); };
  }, [phase]);

  useEffect(() => {
    if (!rootRef.current) return;
    store.hydrate();
    let engine: Engine | null = null;
    const onError = (ev: ErrorEvent | PromiseRejectionEvent) => {
      const msg = "reason" in ev ? String(ev.reason?.message ?? ev.reason) : ev.message;
      setStatus({ kind: "error", message: msg });
    };
    addEventListener("error", onError); addEventListener("unhandledrejection", onError);
    // build on the next frame so the loading screen paints first
    const id = requestAnimationFrame(() => {
      if (!hasWebGL()) { setStatus({ kind: "nowebgl" }); return; }
      try {
        setStatus({ kind: "loading", step: "Carving the islands…" });
        engine = new Engine(rootRef.current!);
        engineRef.current = engine;
        if (process.env.NODE_ENV !== "production" || location.search.includes("debug")) (window as unknown as { __game: unknown }).__game = engine.debugHandle();
        setStatus({ kind: "ready" });
      } catch (e) { setStatus({ kind: "error", message: e instanceof Error ? e.message : String(e) }); }
    });
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      // versioned URL → a new build installs a new worker, which drops the old cache; reload once it takes over
      const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
      navigator.serviceWorker.register(`${base}/sw.js?v=${process.env.NEXT_PUBLIC_BUILD_SHA}`, { updateViaCache: "none" }).then((reg) => reg.update().catch(() => {})).catch(() => {});
      let hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController) location.reload(); hadController = true; });
    }
    return () => { cancelAnimationFrame(id); removeEventListener("error", onError); removeEventListener("unhandledrejection", onError); engine?.dispose(); engineRef.current = null; };
  }, []);

  return (
    <div ref={rootRef} className="game-root">
      {status.kind === "ready" && <Hud />}
      {status.kind === "ready" && <Menus engine={engineRef} />}
      {status.kind === "loading" && (
        <div id="loading"><div className="panel"><h1>SHARKPLANE</h1><p>{status.step}</p><div className="bar"><div className="fill" /></div></div></div>
      )}
      {status.kind === "nowebgl" && (
        <div id="loading"><div className="panel"><h1>SHARKPLANE</h1><p>Your browser can&apos;t do WebGL, which the shark needs to fly. Try Chrome, Firefox, Safari or Edge on a machine with graphics acceleration.</p></div></div>
      )}
      {status.kind === "error" && (
        <div id="loading"><div className="panel"><h1>BELLY FLOP</h1><p>Something broke. Reload to try again, or copy this and open an issue:</p><pre>{status.message}</pre><button onClick={() => navigator.clipboard?.writeText(status.message)}>COPY</button> <button onClick={() => location.reload()}>RELOAD</button></div></div>
      )}
      <div id="rotate"><div><div className="phone">📱</div><h2>Turn your phone sideways</h2><p>SHARKPLANE flies in landscape.</p></div></div>
      {toast && <div id="toast" key={toast}>{toast}</div>}
      {installEvt && phase === "title" && (
        <div id="install">Install SHARKPLANE for fullscreen + offline play <button onClick={async () => { await installEvt.prompt(); setInstallEvt(null); }}>INSTALL</button><button onClick={() => setInstallEvt(null)}>✕</button></div>
      )}
      {showIosTip && phase === "title" && (
        <div id="install">On iPhone: tap <b>Share</b> → <b>Add to Home Screen</b> for fullscreen play <button onClick={() => { try { localStorage.setItem("sharkplane.iosTip", "1"); } catch { /* ignore */ } setShowIosTip(false); }}>GOT IT</button></div>
      )}
      <div id="version">v{process.env.NEXT_PUBLIC_VERSION} · {process.env.NEXT_PUBLIC_BUILD_SHA}</div>
    </div>
  );
}
