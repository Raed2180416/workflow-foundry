// Stand-in for llama.cpp llama-server: /health and an OpenAI-compatible /v1/chat/completions.
import http from 'node:http';

const argv = process.argv.slice(2);
const opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const port = Number(opt('--port'));
const alias = opt('--alias');
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', d => { body += d; });
  req.on('end', () => {
    const send = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.url === '/health') return send(200, { status: 'ok' });
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      const j = JSON.parse(body || '{}');
      return send(200, { id: 'x', object: 'chat.completion', model: alias, choices: [{ index: 0, message: { role: 'assistant', content: `echo: ${j.messages?.at(-1)?.content}` }, finish_reason: 'stop' }], authorizationSeen: req.headers.authorization ?? null, argv });
    }
    return send(404, { error: 'not found' });
  });
});
server.listen(port, '127.0.0.1', () => console.log(`fake llama-server ${alias} on ${port} argv ${JSON.stringify(argv)}`));
process.on('SIGTERM', () => { server.close(); process.exit(0); });
