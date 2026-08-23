"use client";

import { useGame } from "@/lib/store";
import TouchControls from "./TouchControls";

/** The in-game HUD is rendered in 3-D by the engine (lib/ui/hud3d.ts). This layer keeps only what must be DOM: the intro letterbox and touch controls. */
export default function Hud() {
  const hud = useGame((s) => s.hud);
  const phase = useGame((s) => s.phase);
  const o = useGame((s) => s.options);
  if (phase === "title" || phase === "roundOver") return null;
  if (phase === "intro") {
    return (
      <div id="hud">
        <div className="letterbox top" /><div className="letterbox bottom" />
        {hud.intro && <div id="intro-caption" style={{ opacity: hud.intro.t > 0.15 ? 1 : 0 }}><span className="tag">YOUR RIDE</span><span className="name">{hud.intro.caption}</span></div>}
        <div id="intro-skip">PRESS ANY KEY TO SKIP</div>
      </div>
    );
  }
  return <div id="hud" data-phase={phase}>{o.touch && <TouchControls />}</div>;
}
