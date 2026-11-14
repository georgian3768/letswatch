import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createStreamProxy } from './lib/proxy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const ENGINE = process.env.ENGINE || 'http://127.0.0.1:11470';
const ENGINE_ORIGIN = new URL(ENGINE).origin;
const ADMIN_KEY = process.env.ADMIN_KEY || crypto.randomBytes(16).toString('hex');

const app = express();
app.disable('x-powered-by');
app.use(express.json());

const session = { streamPath: null, createdAt: null };
const streamProxy = createStreamProxy({ targetBase: ENGINE });

function requireAdmin(req, res, next) {
  if (req.get('authorization') !== `Bearer ${ADMIN_KEY}`) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  next();
}

app.get('/', (_req, res) => res.redirect('/admin'));
app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.post('/api/session', requireAdmin, (req, res) => {
  const raw = String(req.body?.streamUrl || '').trim();
  if (!raw) return res.status(400).json({ ok: false, error: 'streamUrl required' });
  let target;
  try {
    target = new URL(raw);
  } catch {
    return res.status(400).json({ ok: false, error: 'invalid url' });
  }
  if (target.origin !== ENGINE_ORIGIN) {
    return res.status(400).json({ ok: false, error: `only ${ENGINE_ORIGIN} allowlisted` });
  }
  if (!target.pathname || target.pathname === '/') {
    return res.status(400).json({ ok: false, error: 'url has no path' });
  }
  session.streamPath = target.pathname + target.search;
  session.createdAt = Date.now();
  res.json({ ok: true, streamPath: session.streamPath });
});

app.get('/stream', (req, res) => {
  if (!session.streamPath) {
    return res.status(503).json({ ok: false, error: 'no stream configured yet' });
  }
  streamProxy(req, res, session.streamPath);
});

app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/view', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'view.html')));
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

let lastState = null;

function viewersCount() {
  let n = 0;
  for (const ws of wss.clients) {
    if (ws.readyState === ws.OPEN && ws.role === 'viewer') n += 1;
  }
  return n;
}

function pushStatus() {
  const msg = JSON.stringify({ kind: 'status', viewers: viewersCount() });
  for (const ws of wss.clients) {
    if (ws.readyState === ws.OPEN && ws.role === 'admin') ws.send(msg);
  }
}

wss.on('connection', (ws) => {
  ws.role = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (buf) => {
    let m;
    try {
      m = JSON.parse(buf.toString());
    } catch {
      return;
    }
    if (m.role === 'master') {
      if (m.key !== ADMIN_KEY) {
        ws.send(JSON.stringify({ kind: 'error', error: 'unauthorized master' }));
        return;
      }
      ws.role = 'master';
      lastState = { ...m, tsServer: Date.now() };
      delete lastState.key;
      const msg = JSON.stringify(lastState);
      for (const client of wss.clients) {
        if (client !== ws && client.readyState === client.OPEN) client.send(msg);
      }
    } else if (m.role === 'viewer') {
      ws.role = 'viewer';
      ws.send(JSON.stringify({ kind: 'status', viewers: viewersCount() }));
      if (lastState) ws.send(JSON.stringify(lastState));
    } else if (m.kind === 'admin') {
      ws.role = 'admin';
      ws.send(JSON.stringify({ kind: 'status', viewers: viewersCount() }));
    } else if (m.kind === 'status') {
      ws.send(JSON.stringify({ kind: 'status', viewers: viewersCount() }));
    }
    pushStatus();
  });
  ws.on('close', pushStatus);
});

setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

const displayHost = HOST === '0.0.0.0' ? '127.0.0.1' : HOST;

server.listen(PORT, HOST, () => {
  console.log(`LetsWatch listening on http://${displayHost}:${PORT}`);
  console.log(`Engine target: ${ENGINE}`);
  console.log(`Admin key (enter on /admin): ${ADMIN_KEY}`);
  console.log(`Open http://${displayHost}:${PORT}/admin to configure.`);
});