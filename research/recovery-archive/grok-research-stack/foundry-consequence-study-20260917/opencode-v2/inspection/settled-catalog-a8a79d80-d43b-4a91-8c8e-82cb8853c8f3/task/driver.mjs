import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
const password = randomBytes(32).toString('hex');
const server = spawn('/usr/bin/opencode', ['serve', '--stdio', '--port', '0'], {
  env: { ...process.env, OPENCODE_PASSWORD: password }, stdio: ['pipe', 'pipe', 'pipe'],
});
let raw = '', stderr = '';
server.stderr.on('data', chunk => { if (stderr.length < 16000) stderr += chunk; });
const url = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('server readiness timeout')), 10000);
  server.once('exit', () => { clearTimeout(timer); reject(new Error('server early exit')); });
  server.stdout.on('data', chunk => {
    raw += chunk;
    const end = raw.indexOf('\n');
    if (end < 0) return;
    try { const value = JSON.parse(raw.slice(0, end)); clearTimeout(timer); resolve(value.url); }
    catch (error) { clearTimeout(timer); reject(error); }
  });
});
try {
  const observations = [];
  const headers = { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`, 'x-opencode-directory': '/task' };
  for (let count = 0; count < 30; count++) {
    const response = await fetch(`${url}/api/model?directory=%2Ftask`, { headers, signal: AbortSignal.timeout(10000) });
    const catalog = await response.json();
    observations.push({ attempt: count + 1, status: response.status, models: catalog.data?.length });
    if (catalog.data?.length) {
      writeFileSync('/state/catalog.json', JSON.stringify(catalog, null, 2));
      const chosen = catalog.data.find(item => item.providerID === 'opencode' && item.id === 'big-pickle');
      console.log(JSON.stringify({ observations, chosen, all: catalog.data.map(item => `${item.providerID}/${item.id}`) }));
      break;
    }
    await delay(250);
  }
  const plugins = await fetch(`${url}/api/plugin?directory=%2Ftask`, { headers, signal: AbortSignal.timeout(10000) }).then(r => r.json());
  writeFileSync('/state/plugins.json', JSON.stringify(plugins, null, 2));
  console.log(JSON.stringify({ plugins: plugins.data?.map(item => ({ id: item.id, state: item.state })), stderr }));
} finally {
  server.stdin.end();
  const timer = setTimeout(() => server.kill('SIGKILL'), 3000);
  await new Promise(resolve => { if (server.exitCode !== null) resolve(); else server.once('exit', resolve); });
  clearTimeout(timer);
}
