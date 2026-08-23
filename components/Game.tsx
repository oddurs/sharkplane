"use client";

import { useEffect, useRef, useState } from "react";
import { Engine } from "@/lib/engine";
import { store } from "@/lib/store";
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
      navigator.serviceWorker.register(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/sw.js`).catch(() => {});
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
      <div id="version">v{process.env.NEXT_PUBLIC_VERSION} · {process.env.NEXT_PUBLIC_BUILD_SHA}</div>
    </div>
  );
}
