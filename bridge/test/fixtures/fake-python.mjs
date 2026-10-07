// Stand-in for the Kev venv's python in tests. Emulates just enough of:
//   python -c <selftest>            -> prints a FOUNDRY_RESULT line
//   python -m kev.train ... --out D -> writes a run directory (data file name containing "slow" runs
//                                      until killed, "fail" exits 3)
//   python -m kev.benchmark --out D -> writes report.json
//   python -m kev.serve --port P    -> serves /v1/models and /v1/systemone, echoing request headers
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const argv = process.argv.slice(2);
const opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };

if (argv[0] === '-c') {
  console.log('fake selftest starting');
  console.log('FOUNDRY_RESULT ' + JSON.stringify({ python: '3.12.0-fake', torch: '2.8.0+fake', cuda_available: true, device: 'Fake RTX 4060 Laptop GPU', vram_mib: 8188, bf16_tflops: 1.23, kev_import: 'ok', env_has_hf_token: 'HF_TOKEN' in process.env, pythonpath: process.env.PYTHONPATH ?? null }));
  process.exit(0);
}

const mod = argv[0] === '-m' ? argv[1] : null;

if (mod === 'kev.train') {
  const out = opt('--out'); const data = opt('--data') ?? '';
  if (!out) { console.error('no --out'); process.exit(2); }
  if (fs.existsSync(out)) { console.error('refusing to overwrite an existing run'); process.exit(2); }
  console.log(`fake kev.train argv: ${JSON.stringify(argv.slice(2))}`);
  if (path.basename(data).includes('fail')) { console.error('Traceback: fake failure'); process.exit(3); }
  if (path.basename(data).includes('slow')) {
    let n = 0;
    const t = setInterval(() => console.log(`step ${++n} loss ${(1 / n).toFixed(4)}`), 50);
    process.on('SIGTERM', () => { clearInterval(t); console.log('got SIGTERM'); process.exit(143); });
    setTimeout(() => {}, 1 << 30);
  } else {
    fs.mkdirSync(out, { recursive: true });
    for (let i = 1; i <= 3; i++) console.log(`epoch 1 step ${i} loss ${(1 / i).toFixed(3)} — ok ✓`);
    fs.writeFileSync(path.join(out, 'training_config.json'), JSON.stringify({ args: argv.slice(2) }, null, 2));
    fs.writeFileSync(path.join(out, 'head.pt'), Buffer.alloc(4096, 7));
    fs.writeFileSync(path.join(out, 'adapter_model.safetensors'), Buffer.alloc(100_000, 3));
    fs.mkdirSync(path.join(out, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(out, 'sub', 'metrics.json'), JSON.stringify({ loss: 0.33 }));
    console.log('saved checkpoint');
    process.exit(0);
  }
} else if (mod === 'kev.benchmark') {
  const out = opt('--out');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ run: opt('--run'), accuracy: 0.75 }));
  console.log('benchmark done');
  process.exit(0);
} else if (mod === 'kev.serve') {
  const port = Number(opt('--port'));
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json', 'set-cookie': 'x=1', 'x-upstream': 'fake-kev' }); res.end(JSON.stringify(obj)); };
      if (req.method === 'GET' && req.url === '/v1/models') return send(200, { models: [{ name: 'kev-latest', run: opt('--run') }] });
      if (req.method === 'POST' && req.url.startsWith('/v1/systemone')) {
        let j = {}; try { j = JSON.parse(body); } catch {}
        const answers = {};
        for (const [qid, q] of Object.entries(j.questions ?? {})) {
          const keys = q.type === 'choice' ? Object.keys(q.criteria ?? {}) : ['false', 'true'];
          answers[qid] = { type: q.type, probabilities: Object.fromEntries(keys.map((k, i) => [k, i === 0 ? 0.7 : 0.3 / Math.max(1, keys.length - 1)])) };
        }
        return send(200, { answers, ...answers, echo: { url: req.url, method: req.method, headers: req.headers, body: j } });
      }
      return send(404, { error: 'not found', url: req.url });
    });
  });
  server.listen(port, '127.0.0.1', () => console.log(`fake kev.serve on 127.0.0.1:${port} run ${opt('--run')}`));
  process.on('SIGTERM', () => { console.log('fake kev.serve stopping'); server.close(); process.exit(0); });
} else {
  console.error(`fake python: unsupported ${JSON.stringify(argv)}`);
  process.exit(2);
}
