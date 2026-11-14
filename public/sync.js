(function () {
  const video = document.getElementById('video');
  const statusEl = document.getElementById('status');
  const btnVlc = document.getElementById('btn-vlc');
  const btnInline = document.getElementById('btn-inline');
  const vlcConfig = document.getElementById('vlc-config');
  const vlcMsg = document.getElementById('vlc-msg');

  const params = new URLSearchParams(location.search);
  const sim = params.get('sim') === '1';
  const useVlc = params.get('player') === 'vlc' || (localStorage.getItem('lw.player') || 'inline') === 'vlc';
  const vlcHost = localStorage.getItem('lw.vlc.host') || 'http://localhost:8080';
  const vlcPath = localStorage.getItem('lw.vlc.path') || '/requests/status.xml';
  const seekUnit = localStorage.getItem('lw.vlc.seek') || 's';

  let lastPlaying = null;
  let lastSeek = null;
  let ws = null;

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function setPlayer(mode) {
    localStorage.setItem('lw.player', mode);
    location.reload();
  }

  if (btnVlc) btnVlc.onclick = () => setPlayer('vlc');
  if (btnInline) btnInline.onclick = () => setPlayer('inline');

  async function vlcCmd(command, val) {
    let url = `${vlcHost}${vlcPath}?command=${encodeURIComponent(command)}`;
    if (val !== undefined) url += `&val=${encodeURIComponent(val)}`;
    try {
      await fetch(url, { mode: 'no-cors', cache: 'no-store' });
    } catch {
      setStatus('VLC unreachable — is VLC running with Web interface ON?');
    }
  }

  function seekVal(t) {
    return seekUnit === 's' ? Math.round(t) : Math.round(t * 1000);
  }

  const drift = (s) => Math.max(0, (Date.now() - (s.tsServer || Date.now())) / 1000);

  function applyMaster(s) {
    const target = s.t + (s.playing ? drift(s) : 0);

    if (!useVlc) {
      if (!s.playing) {
        if (!video.paused) video.pause();
        if (Math.abs(video.currentTime - s.t) > 1.5) video.currentTime = s.t;
      } else if (video.paused) {
        video.currentTime = target;
        video.play().catch(() => {});
      } else if (Math.abs(video.currentTime - target) > 4) {
        video.currentTime = target;
      }
      setStatus(`@${s.t.toFixed(1)}s ${s.playing ? 'playing' : 'paused'}`);
      return;
    }

    if (s.playing !== lastPlaying) {
      lastPlaying = s.playing;
      lastSeek = s.playing ? target : s.t;
      vlcCmd(s.playing ? 'pl_play' : 'pl_pause');
      vlcCmd('seek', seekVal(lastSeek));
    } else if (s.playing && Math.abs(target - lastSeek) > 4) {
      vlcCmd('seek', seekVal(target));
      lastSeek = target;
    } else if (!s.playing && Math.abs(s.t - lastSeek) > 1) {
      vlcCmd('seek', seekVal(s.t));
      lastSeek = s.t;
    }
    setStatus(`VLC @${s.t.toFixed(1)}s ${s.playing ? 'playing' : 'paused'}`);
  }

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    ws = new WebSocket(`${proto}${location.host}/ws`);
    ws.onopen = () => ws.send(JSON.stringify({ role: 'viewer' }));
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.kind === 'status') {
        setStatus(`${m.viewers} viewer${m.viewers === 1 ? '' : 's'} connected`);
      } else if (m.role === 'master') {
        applyMaster(m);
      }
    };
    ws.onclose = () => setTimeout(connect, 2000);
  }

  if (useVlc) {
    document.body.classList.add('mode-vlc');
    if (vlcMsg) vlcMsg.classList.remove('hidden');
    if (vlcConfig) vlcConfig.classList.remove('hidden');
  }
  if (vlcConfig) vlcConfig.textContent = `${vlcHost}${vlcPath}`;

  if (sim) {
    const start = Date.now();
    const simKey = localStorage.getItem('lw.adminKey') || '';
    setInterval(() => ws && ws.send(JSON.stringify({
      role: 'master', key: simKey, playing: true,
      t: ((Date.now() - start) / 1000) % 600, ts: Date.now(),
    })), 500);
  }

  connect();
})();