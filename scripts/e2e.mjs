// Headless gameplay smoke test against the static export in out/ (or DEV_URL). Needs Chrome.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 5996, DBG = 9334;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function serveOut() {
  const root = path.resolve("out");
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".txt": "text/plain", ".xml": "application/xml" };
  const srv = createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const file = path.join(root, p);
    try {
      const s = await stat(file);
      const f = s.isDirectory() ? path.join(file, "index.html") : file;
      res.writeHead(200, { "content-type": types[path.extname(f)] ?? "application/octet-stream" });
      res.end(await readFile(f));
    } catch { res.writeHead(404); res.end("nope"); }
  });
  await new Promise((r) => srv.listen(PORT, r));
  return srv;
}

const url = process.env.DEV_URL ?? `http://localhost:${PORT}/?debug`;
const srv = process.env.DEV_URL ? null : await serveOut();
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1280,800", `--remote-debugging-port=${DBG}`, "--user-data-dir=/tmp/sharkplane-e2e-profile", "--autoplay-policy=no-user-gesture-required", "--mute-audio", url], { stdio: ["ignore", "ignore", "inherit"] });
let targets = [];
for (let i = 0; i < 60 && !targets.some((t) => t.type === "page" && t.url.includes(new URL(url).host)); i++) {
  await sleep(1000);
  try { targets = await (await fetch(`http://127.0.0.1:${DBG}/json`)).json(); } catch { /* not up yet */ }
}
const page = targets.find((t) => t.type === "page" && t.url.includes(new URL(url).host));
if (!page) { console.error("Chrome never exposed the page"); chrome.kill(); process.exit(1); }
await sleep(3000);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = {}; const errors = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending[m.id]) { if (m.error) errors.push(`CDP: ${m.error.message} (id ${m.id})`); pending[m.id](m.result ?? {}); delete pending[m.id]; }
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
const js = (expr) => send("Runtime.evaluate", { expression: expr, returnByValue: true }).then((r) => { if (r.exceptionDetails) errors.push(`JS(${expr.slice(0, 60)}): ${r.exceptionDetails.text}`); return r.result?.value; });
// Dispatch DOM keyboard events directly (CDP key synthesis is unreliable on headless Linux); Input listens on window by e.code.
const keyEvent = (type, code) => js(`window.dispatchEvent(new KeyboardEvent(${JSON.stringify(type.toLowerCase())}, { code: ${JSON.stringify(code)}, key: ${JSON.stringify(code === "ShiftLeft" ? "Shift" : code === "Space" ? " " : code)}, bubbles: true, cancelable: true })); 0`);
const key = async (code) => { await keyEvent("keyDown", code); await keyEvent("keyUp", code); };
await send("Runtime.enable");
await send("Page.enable");
const MOBILE = !!process.env.MOBILE;
if (MOBILE) {
  await send("Emulation.setDeviceMetricsOverride", { width: 844, height: 390, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: "landscapePrimary", angle: 90 } });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Mobile Safari/537.36" });
}
const touch = (type, points) => send("Input.dispatchTouchEvent", { type, touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: p.id ?? i })) });
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); if (r.data) (await import("node:fs")).writeFileSync(`${process.env.SHOT_DIR ?? "."}/${name}.png`, Buffer.from(r.data, "base64")); }; await send("Page.bringToFront"); await send("Emulation.setFocusEmulationEnabled", { enabled: true });

const checks = [];
const check = (name, ok) => { checks.push([name, !!ok]); console.log(`${ok ? "✓" : "✗"} ${name}`); };

await js(`localStorage.setItem('sharkplane.options', JSON.stringify({ quality: 'low', qualitySet: true, tutorialDone: true, touch: ${MOBILE}, scheme: 'anywhere', autoThrottle: true }))`);
await js(`location.reload()`); await sleep(5000);
check("title renders in 3-D", await js(`window.__game.engine.hud3d['menuGroup'].visible`));
check("engine exposed with ?debug", await js(`typeof window.__game === 'object'`));
await js(`window.__game.engine.menuAction('sortie')`); await sleep(300);
await key("KeyX"); await sleep(200);
const adv = async (s) => { await js(`window.__game.engine.advance(${s})`); await sleep(150); };
await adv(4);
check("countdown → playing", (await js(`window.__game.phase`)) === "playing");
if (MOBILE) {
  check("touch controls rendered", await js(`!!document.getElementById('steer-zone') && !!document.getElementById('bite-btn') && !!document.getElementById('brake-btn')`));
  check("3-D HUD has radar contacts", (await js(`window.__game.hud.radar.length`)) > 0);
  await shot("mobile_runway");
  // auto-throttle rolls us; pull back on the left half (drag down = climb with inverted pitch) once fast enough
  await adv(5);
  const ms = await js(`window.__game.player.speed`);
  check(`auto-throttle rolls (speed ${ms?.toFixed?.(1)})`, ms > 25);
  await touch("touchStart", [{ x: 200, y: 250 }]); await touch("touchMove", [{ x: 200, y: 330 }]); await adv(0.6);
  await touch("touchEnd", []); await adv(2);
  check("takes off by dragging", (await js(`window.__game.player.state`)) === "airborne");
  // bite button: tap = lunge
  const b = await js(`(()=>{const r=document.getElementById('bite-btn').getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]})()`);
  const boost0 = await js(`window.__game.engine.boostMeter`);
  await touch("touchStart", [{ x: b[0], y: b[1] }]); await sleep(60); await touch("touchEnd", []); await adv(0.3);
  check("BITE tap lunges", (await js(`window.__game.engine.lunge`)) > 0.3 || (await js(`window.__game.engine.boostMeter`)) < boost0);
  await js(`(()=>{const g=window.__game,p=g.player,e=g.enemies[0];e.biteCooldown=0;e.pos.copy(p.mesh.localToWorld(new p.pos.constructor(0,0,-6)));})()`); await adv(0.5);
  check("eats a plane (mobile)", (await js(`window.__game.score`)) >= 100);
  await shot("mobile_flight");
  // pause via the on-screen button
  const pz = await js(`(()=>{const r=document.getElementById('pause-btn').getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]})()`);
  await touch("touchStart", [{ x: pz[0], y: pz[1] }]); await touch("touchEnd", []); await adv(0.1);
  check("pause button pauses", (await js(`window.__game.phase`)) === "paused");
  await shot("mobile_pause");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: "portraitPrimary", angle: 0 } }); await sleep(300);
  check("portrait shows the rotate card", await js(`getComputedStyle(document.getElementById('rotate')).display === 'grid'`));
  await shot("mobile_portrait");
  check("no console errors", errors.length === 0);
  if (errors.length) console.log(errors.join("\n"));
  ws.close(); chrome.kill(); srv?.close();
  const failedM = checks.filter(([, ok]) => !ok).length;
  console.log(`\n${checks.length - failedM}/${checks.length} mobile checks passed`);
  process.exit(failedM ? 1 : 0);
}
await keyEvent("keyDown", "ShiftLeft"); await adv(5);
const speed = await js(`window.__game.player.speed`);
check(`rolls down the runway (speed ${speed?.toFixed?.(1)})`, speed > 25);
if (!(speed > 25)) console.log("diag:", await js(`(()=>{const e=window.__game.engine;const st=JSON.parse(localStorage.getItem('sharkplane.options')||'{}');return JSON.stringify({phase:e.constructor&&window.__game&&(document.querySelector('.panel h2')?.textContent||'none'),hidden:document.hidden,vis:document.visibilityState,throttle:e.player.throttle,state:e.player.state,time:e.time.toFixed(1),resumeIn:e.resumeIn,hitStop:e.hitStop,keys:Object.keys(e.input.keys||{}).filter(k=>e.input.keys[k]),touch:st.touch,gp:navigator.getGamepads?navigator.getGamepads().filter(Boolean).length:-1,ua:navigator.userAgent.slice(0,60)})})()`));
await keyEvent("keyDown", "KeyS"); await adv(0.5); await keyEvent("keyUp", "KeyS"); await adv(2);
check("takes off", (await js(`window.__game.player.state`)) === "airborne");
await js(`(()=>{const g=window.__game,p=g.player,e=g.enemies[0];e.biteCooldown=0;e.pos.copy(p.mesh.localToWorld(new p.pos.constructor(0,0,-6)));})()`); await adv(0.5);
check("eats a plane", (await js(`window.__game.score`)) >= 100);
await key("Escape"); await adv(0.1);
check("pauses", (await js(`window.__game.phase`)) === "paused");
await key("Escape"); await adv(0.1);
check("resumes", (await js(`window.__game.phase`)) === "playing" || (await js(`window.__game.hud.resumeIn`)) > 0);
await js(`(()=>{window.__game.engine.timeLeft = 0.5;})()`); await adv(4.5); // resume has a 3 s countdown
check("round ends with a score card", await js(`!!document.querySelector('.card')`));
check("3-D HUD scene rendered", (await js(`window.__game.engine.hud3d.root.children.length`)) > 10);
check("no console errors", errors.length === 0);
if (errors.length) console.log(errors.join("\n"));

ws.close(); chrome.kill(); srv?.close();
const failed = checks.filter(([, ok]) => !ok).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
