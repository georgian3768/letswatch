import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import WebSocket from 'ws';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = 18987;
const adminKey = 'test-admin-key';

async function startServer() {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      ADMIN_KEY: adminKey,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  const deadline = Date.now() + 5000;
  while (!stdout.includes('LetsWatch listening') && Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early: ${stderr || stdout}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (!stdout.includes('LetsWatch listening')) {
    throw new Error(`server did not start: ${stderr || stdout}`);
  }
  return child;
}

test('LetsWatch smoke test', async () => {
  const child = await startServer();
  const base = `http://127.0.0.1:${port}`;

  try {
    let res = await fetch(`${base}/healthz`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });

    res = await fetch(`${base}/admin`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /LetsWatch host controls/);

    res = await fetch(`${base}/view`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /LetsWatch viewer/);

    res = await fetch(`${base}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ streamUrl: 'http://127.0.0.1:11470/example' }),
    });
    assert.equal(res.status, 401);

    res = await fetch(`${base}/api/session`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${adminKey}`,
      },
      body: JSON.stringify({ streamUrl: 'http://example.com/not-allowed' }),
    });
    assert.equal(res.status, 400);

    res = await fetch(`${base}/stream`);
    assert.equal(res.status, 503);

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await once(ws, 'open');
    const message = once(ws, 'message');
    ws.send(JSON.stringify({ role: 'master', key: 'wrong-key', playing: false, t: 0 }));
    const [data] = await message;
    assert.equal(JSON.parse(data.toString()).kind, 'error');
    ws.close();

    const viewer = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await once(viewer, 'open');
    const status = once(viewer, 'message');
    viewer.send(JSON.stringify({ role: 'viewer' }));
    assert.equal(JSON.parse((await status)[0].toString()).kind, 'status');

    const update = once(viewer, 'message');
    const master = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await once(master, 'open');
    master.send(JSON.stringify({
      role: 'master',
      key: adminKey,
      playing: true,
      t: 42,
      u: 'http://127.0.0.1:11470/media?token=abc',
      ts: Date.now(),
    }));
    const state = JSON.parse((await update)[0].toString());
    assert.equal(state.role, 'master');
    assert.equal(state.t, 42);
    assert.equal(state.u, 'http://127.0.0.1:11470/media?token=abc');
    assert.equal(state.key, undefined);
    viewer.close();
    master.close();
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await once(child, 'exit');
    }
  }
});