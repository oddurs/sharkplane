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
const chrome = spawn(CHROME, ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1280,800", `--remote-debugging-port=${DBG}`, "--user-data-dir=/tmp/sharkplane-e2e-profile", "--autoplay-policy=no-user-gesture-required", url], { stdio: ["ignore", "ignore", "inherit"] });
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
await send("Page.enable"); await send("Page.bringToFront"); await send("Emulation.setFocusEmulationEnabled", { enabled: true });

const checks = [];
const check = (name, ok) => { checks.push([name, !!ok]); console.log(`${ok ? "✓" : "✗"} ${name}`); };

await js(`localStorage.setItem('sharkplane.options', JSON.stringify({ quality: 'low', tutorialDone: true }))`);
await js(`location.reload()`); await sleep(5000);
check("title renders", await js(`!!document.querySelector('.panel h1')`));
check("engine exposed with ?debug", await js(`typeof window.__game === 'object'`));
await js(`document.querySelector('.panel button.primary').click()`); await sleep(500);
await key("KeyX"); await sleep(4500);
check("countdown → playing", await js(`!!document.getElementById('stats')`));
await keyEvent("keyDown", "ShiftLeft"); await sleep(5000);
const speed = await js(`window.__game.player.speed`);
check(`rolls down the runway (speed ${speed?.toFixed?.(1)})`, speed > 25);
if (!(speed > 25)) console.log("diag:", await js(`(()=>{const e=window.__game.engine;const st=JSON.parse(localStorage.getItem('sharkplane.options')||'{}');return JSON.stringify({phase:e.constructor&&window.__game&&(document.querySelector('.panel h2')?.textContent||'none'),hidden:document.hidden,vis:document.visibilityState,throttle:e.player.throttle,state:e.player.state,time:e.time.toFixed(1),resumeIn:e.resumeIn,hitStop:e.hitStop,keys:Object.keys(e.input.keys||{}).filter(k=>e.input.keys[k]),touch:st.touch,gp:navigator.getGamepads?navigator.getGamepads().filter(Boolean).length:-1,ua:navigator.userAgent.slice(0,60)})})()`));
await key("KeyS"); await sleep(2500);
check("takes off", (await js(`window.__game.player.state`)) === "airborne");
await js(`(()=>{const g=window.__game,p=g.player,e=g.enemies[0];e.biteCooldown=0;e.pos.copy(p.mesh.localToWorld(new p.pos.constructor(0,0,-6)));})()`); await sleep(600);
check("eats a plane", (await js(`window.__game.score`)) >= 100);
await key("Escape"); await sleep(300);
check("pauses", (await js(`document.querySelector('.panel h2')?.textContent`)) === "PAUSED");
await key("Escape"); await sleep(600);
check("resumes", !(await js(`document.querySelector('.panel')`)));
await js(`(()=>{window.__game.engine.timeLeft = 0.5;})()`); await sleep(5000); // resume has a 3 s countdown
check("round ends with a score card", await js(`!!document.querySelector('.card')`));
check("no console errors", errors.length === 0);
if (errors.length) console.log(errors.join("\n"));

ws.close(); chrome.kill(); srv?.close();
const failed = checks.filter(([, ok]) => !ok).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
