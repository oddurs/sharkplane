"use client";

import { useGame } from "@/lib/store";
import { t } from "@/lib/i18n";
import TouchControls from "./TouchControls";

const KIND_COLOR = { fighter: "#ffd84a", bomber: "#ff5d2e", escort: "#8ad8ff" } as const;
const KIND_TAG = { fighter: "F", bomber: "B", escort: "E" } as const;

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
  const mm = Math.floor(hud.timeLeft / 60), ss = String(hud.timeLeft % 60).padStart(2, "0");
  const comboRing = 2 * Math.PI * 26;
  return (
    <div id="hud" className={`${hud.frenzy > 0 ? "frenzy" : ""} ${o.highContrast ? "hc" : ""}`}>
      <div id="score-block">
        <div id="score">{hud.score}</div>
        {hud.combo > 1 && (
          <div id="combo">
            <svg viewBox="0 0 60 60"><circle cx="30" cy="30" r="26" className="ring-bg" /><circle cx="30" cy="30" r="26" className="ring" style={{ strokeDasharray: comboRing, strokeDashoffset: comboRing * (1 - Math.min(1, hud.combo / 5)) }} /></svg>
            <span>x{hud.combo}</span>
          </div>
        )}
      </div>
      <div id="top-center">
        <div id="timer" className={hud.timeLeft <= 10 ? "urgent" : ""}>{mm}:{ss}</div>
        <div id="wave">{t("wave")} {hud.wave}{hud.frenzy > 0 && <span className="frenzy-tag"> · {t("frenzy")} {Math.ceil(hud.frenzy)}s</span>}{hud.weather === "rain" && <span className="weather"> · ☂</span>}</div>
        <div id="compass" style={{ transform: `rotate(${hud.compassAngle}rad)`, color: hud.compassNear ? "#ff5d2e" : "#fff" }}>▲</div>
        {hud.lockDist !== null && <div id="lock-dist">{hud.lockDist}m</div>}
      </div>
      <div id="right-col">
        <div id="eaten">{t("planesEaten")}: {hud.eaten}</div>
        <div id="objectives">
          {hud.objectives.map((ob) => (
            <div key={ob.id} className={`objective ${ob.done ? "done" : ""}`}>
              <span className="check">{ob.done ? "✓" : "○"}</span>
              <span className="text">{ob.text}</span>
              {ob.target > 1 && <span className="prog">{ob.progress}/{ob.target}</span>}
            </div>
          ))}
        </div>
        {hud.boss && (
          <div id="boss-bar"><span>ZEPPELIN</span><div className="bar"><div className="fill" style={{ width: `${(hud.boss.hp / hud.boss.max) * 100}%` }} /></div></div>
        )}
      </div>
      <div id="stats">
        SPD {hud.speed}<br />ALT {hud.alt}
        {hud.groundState === "rolling" && <><br />{hud.speed < 150 ? (o.touch ? "THROTTLE UP" : t("throttleUp")) : o.touch ? `${t("pullUp")} — DRAG ${o.invertY ? "DOWN" : "UP"}` : `${t("pullUp")} (${o.invertY ? "S" : "W"})`}</>}
        {hud.boosting && <><br />{t("boost")}</>}
        {hud.hunger < 0.25 && <><br /><span className="hungry">{hud.hunger <= 0 ? t("starving") : t("hungry")}</span></>}
      </div>
      <div id="msg" key={hud.msg} style={{ opacity: hud.msgVisible ? 1 : 0 }}>{hud.msg}</div>
      {hud.waveBanner && <div id="wave-banner">{hud.waveBanner}</div>}
      {hud.countdown && <div id="countdown" key={hud.countdown}>{hud.countdown}</div>}
      {hud.resumeIn > 0 && <div id="countdown" key={`r${hud.resumeIn}`}>{hud.resumeIn}</div>}
      {hud.subtitle && <div id="subtitle" key={hud.subtitle.text}><span className={`who ${hud.subtitle.who}`}>{hud.subtitle.who === "you" ? "◉" : hud.subtitle.who === "tower" ? "▣" : "✈"}</span>{hud.subtitle.text}</div>}
      {hud.caption && <div id="caption" key={hud.caption}>{hud.caption}</div>}
      {hud.muted && <div id="muted">🔇 click or press a key for sound</div>}
      {hud.targets.map((t, i) =>
        t.onScreen ? (
          <div key={i} className={`target ${t.locked ? "locked" : ""} ${t.kind}`} style={{ left: `${t.x}%`, top: `${t.y}%` }}>
            <div className="box">{o.colorblind && <i>{KIND_TAG[t.kind]}</i>}</div>
            <div className="label">{t.dist}m {t.dAlt > 15 ? `▲${t.dAlt}` : t.dAlt < -15 ? `▼${-t.dAlt}` : ""}</div>
          </div>
        ) : (
          <div key={i} className={`edge ${t.locked ? "locked" : ""} ${t.kind}`} style={{ left: `${t.x}%`, top: `${t.y}%` }}>
            <div className="arrow" style={{ transform: `rotate(${t.angle}rad)` }}>➤</div>
            <div className="label">{o.colorblind ? `${KIND_TAG[t.kind]} ` : ""}{t.dist}m</div>
          </div>
        ),
      )}
      {hud.alerts.map((a, i) => (
        <div key={i} className="alert" style={{ left: `${a.x}%`, top: `${a.y}%` }}>{a.text}</div>
      ))}
      <div id="meters">
        <div className="meter"><div className="meter-fill throttle" style={{ height: `${hud.throttle * 100}%`, ["--w" as string]: `${hud.throttle * 100}%` }} /><span>THR</span></div>
        <div className="meter"><div className="meter-fill boost" style={{ height: `${hud.boost * 100}%`, ["--w" as string]: `${hud.boost * 100}%` }} /><span>BST</span></div>
        <div className="meter"><div className={`meter-fill hunger ${hud.hunger < 0.25 ? "low" : ""}`} style={{ height: `${hud.hunger * 100}%`, ["--w" as string]: `${hud.hunger * 100}%` }} /><span>FOOD</span></div>
      </div>
      <svg id="radar" viewBox="-1 -1 2 2">
        <circle r="1" className="radar-ring" />
        <circle r="0.5" className="radar-ring" />
        <line x1="0" y1="0" x2="0" y2="-1" className="radar-ring" />
        <g className="sweep"><path d="M0,0 L0,-1 A1,1 0 0,1 0.5,-0.866 Z" /></g>
        <polygon points="0,-0.08 0.06,0.06 -0.06,0.06" fill="#fff" />
        {hud.radar.map((b, i) => (
          <g key={i}>
            <circle cx={b.x} cy={b.y} r={b.kind === "bomber" ? 0.08 : 0.055} fill={KIND_COLOR[b.kind]} />
            {Math.abs(b.dAlt) > 15 && <text x={b.x} y={b.y - 0.09} fontSize="0.12" textAnchor="middle" fill="#fff">{b.dAlt > 0 ? "▲" : "▼"}</text>}
          </g>
        ))}
      </svg>
      {o.touch && <TouchControls />}
    </div>
  );
}
