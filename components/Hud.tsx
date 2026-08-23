"use client";

import { useGame } from "@/lib/store";
import TouchControls from "./TouchControls";

/** The in-game HUD is rendered in 3-D by the engine (lib/ui/hud3d.ts). This layer keeps only what must be DOM: the intro letterbox and touch controls. */
export default function Hud() {
  const hud = useGame((s) => s.hud);
  const phase = useGame((s) => s.phase);
  const o = useGame((s) => s.options);
  if (phase === "title" || phase === "roundOver") return null;
  if (phase === "intro") return null; // the jaws letterbox is rendered by the engine (lib/ui/hud3d.ts)
  void hud;
  return <div id="hud" data-phase={phase}>{o.touch && <TouchControls />}</div>;
}
