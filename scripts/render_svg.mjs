// Renders data/system-map.svg (LTA's vector system map, kept out of git) to data/system-map-hi.png
// with headless Chrome, so align_map.py can measure and crop a sharp copy.
// usage: node scripts/render_svg.mjs [size=3324]
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const size = +(process.argv[2] ?? 3324);
const root = resolve(import.meta.dirname, '..');
const port = 9335;
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--hide-scrollbars',
  `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'svg-'))}`, 'about:blank']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 40 && !targets; i++) {
  await sleep(250);
  targets = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()).catch(() => null);
}
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });

await send('Emulation.setDeviceMetricsOverride', { width: size, height: size, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: pathToFileURL(join(root, 'data/system-map.svg')).href });
await sleep(4000);
const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: size, height: size, scale: 1 } });
writeFileSync(join(root, 'data/system-map-hi.png'), Buffer.from(shot.data, 'base64'));
console.log(`rendered ${size}px -> data/system-map-hi.png`);
ws.close();
chrome.kill();
process.exit(0);
