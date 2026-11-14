#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-8787}"
BIN="${CLOUDFLARED:-cloudflared}"

if ! command -v "$BIN" >/dev/null 2>&1 && [ ! -x "$HOME/.local/bin/$BIN" ]; then
  echo "cloudflared not found. Install it:"
  echo "  curl -L -o ~/.local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"
  echo "  chmod +x ~/.local/bin/cloudflared"
  exit 1
fi
if ! command -v "$BIN" >/dev/null 2>&1; then
  BIN="$HOME/.local/bin/cloudflared"
fi

if ! curl -s --max-time 3 -o /dev/null "http://127.0.0.1:$PORT/"; then
  echo "LetsWatch is not running on :$PORT — start it first:  node server.js"
  exit 1
fi

LOG="$(mktemp)"
"$BIN" tunnel --url "http://localhost:$PORT" --no-autoupdate >"$LOG" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null' EXIT

URL=""
for _ in $(seq 1 60); do
  URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)
  [ -n "$URL" ] && break
  kill -0 "$PID" 2>/dev/null || { echo "cloudflared exited:"; tail -20 "$LOG"; exit 1; }
  sleep 1
done

if [ -z "$URL" ]; then
  echo "no tunnel URL obtained:"; tail -20 "$LOG"; exit 1
fi

echo ""
echo "================ SHARE THESE ================"
echo "VLC stream link:  $URL/stream"
echo "Sync tab (B):     $URL/view"
echo "Host controls:    $URL/admin"
echo "============================================="
echo "Anyone with these URLs can watch the stream."
echo "Share them only with your viewer. Keep this terminal open; Ctrl+C to stop."

wait "$PID"