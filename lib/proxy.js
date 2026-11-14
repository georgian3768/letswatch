import http from 'node:http';

export function createStreamProxy({ targetBase }) {
  return function streamProxy(req, res, streamPath) {
    const target = new URL(streamPath, targetBase);
    const out = http.request(target, {
      method: req.method,
      headers: forwardHeaders(req.headers),
    }, (up) => {
      res.writeHead(up.statusCode ?? 200, up.headers);
      up.pipe(res);
    });
    out.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'engine unreachable' }));
      }
      res.end();
    });
    if (req.method === 'POST' || req.method === 'PUT') {
      req.pipe(out);
    } else {
      out.end();
    }
  };
}

function forwardHeaders(headers) {
  const skip = new Set([
    'connection', 'upgrade', 'keep-alive',
    'transfer-encoding', 'host', 'content-length',
  ]);
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!skip.has(key.toLowerCase())) out[key] = value;
  }
  return out;
}