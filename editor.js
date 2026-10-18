// ============================================================
//  mytime — upload editor
//  Photos: crop (aspect presets), drag/pinch to frame, zoom, rotate,
//          filters and adjustments (pixel-based, works on iPhone Safari)
//  Videos: trim start/end, mute (re-recorded in the browser)
// ============================================================

const FILTERS = {
  Normal: {},
  Vivid: { sat: 1.35, con: 1.12 },
  Warm: { warm: 0.12, sat: 1.08 },
  Cool: { warm: -0.12, sat: 0.95 },
  Fade: { fade: 0.2, con: 0.9 },
  Mono: { sat: 0, con: 1.1 },
  Drama: { con: 1.35, bri: -0.04, sat: 0.9 },
  Retro: { warm: 0.14, fade: 0.14, sat: 0.78 }
};
const ADJ = [
  ['bri', 'Brightness', -0.4, 0.4, 0],
  ['con', 'Contrast', 0.5, 1.5, 1],
  ['sat', 'Saturation', 0, 2, 1],
  ['warm', 'Warmth', -0.3, 0.3, 0]
];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// combine preset + manual adjustments
function params(filterName, adj) {
  const f = FILTERS[filterName] || {};
  return {
    bri: (f.bri || 0) + adj.bri,
    con: (f.con ?? 1) * adj.con,
    sat: (f.sat ?? 1) * adj.sat,
    warm: (f.warm || 0) + adj.warm,
    fade: f.fade || 0
  };
}
function isIdentity(p) { return !p.bri && p.con === 1 && p.sat === 1 && !p.warm && !p.fade; }

// per-pixel colour processing
function applyPixels(ctx, w, h, p) {
  if (isIdentity(p)) return;
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  const bri = p.bri * 255, con = p.con, sat = p.sat, wr = p.warm * 70, fade = p.fade, fadeAdd = 255 * fade * 0.35;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i] + bri, g = d[i + 1] + bri, b = d[i + 2] + bri;
    r = (r - 128) * con + 128; g = (g - 128) * con + 128; b = (b - 128) * con + 128;
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    r = gray + (r - gray) * sat; g = gray + (g - gray) * sat; b = gray + (b - gray) * sat;
    r += wr; b -= wr;
    if (fade) { r = r * (1 - fade) + fadeAdd; g = g * (1 - fade) + fadeAdd; b = b * (1 - fade) + fadeAdd; }
    d[i] = r < 0 ? 0 : r > 255 ? 255 : r;
    d[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
    d[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
  }
  ctx.putImageData(img, 0, 0);
}

async function loadBitmap(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    const url = URL.createObjectURL(file);
    const im = new Image(); im.src = url; await im.decode(); return im;
  }
}

function sheet(html) {
  const el = document.createElement('div');
  el.className = 'sheet dark ed';
  el.innerHTML = `<div class="inner">${html}</div>`;
  document.body.appendChild(el);
  return el;
}

// ------------------------------------------------------------
//  PHOTO EDITOR → resolves to a JPEG Blob, or null if cancelled
//  opts: { aspects: ['orig','1:1','4:5','16:9','9:16'], aspect: '4:5', out: 1080, round: false }
// ------------------------------------------------------------
export async function openPhotoEditor(file, opts = {}) {
  const img = await loadBitmap(file);
  const W0 = img.width, H0 = img.height;
  const aspects = opts.aspects || ['orig', '1:1', '4:5', '16:9'];
  const label = { orig: 'Original', '1:1': 'Square', '4:5': '4:5', '16:9': '16:9', '9:16': '9:16' };
  const st = { aspect: opts.aspect || aspects[0], rot: 0, zoom: 1, ox: 0, oy: 0, filter: 'Normal', adj: { bri: 0, con: 1, sat: 1, warm: 0 }, tab: 'crop' };

  return new Promise(resolve => {
    const el = sheet(`
      <div class="ed-head"><button class="ed-txt" data-e="cancel">Cancel</button><b>Edit photo</b><button class="ed-txt ed-done" data-e="done">Done</button></div>
      <div class="ed-stage"><canvas class="ed-canvas"></canvas>${opts.round ? '<div class="ed-round"></div>' : ''}<div class="ed-grid"></div></div>
      <div class="ed-tabs"><button data-t="crop">Crop</button><button data-t="filter">Filters</button><button data-t="adjust">Adjust</button></div>
      <div class="ed-panel"></div>`);
    const stage = el.querySelector('.ed-stage'), cv = el.querySelector('.ed-canvas'), ctx = cv.getContext('2d', { willReadFrequently: true });
    const panel = el.querySelector('.ed-panel');
    let fw = 0, fh = 0, dpr = Math.min(window.devicePixelRatio || 1, 1.5), raf = 0;

    const rotDims = () => (st.rot % 180 ? [H0, W0] : [W0, H0]);
    const ratio = () => {
      if (st.aspect === 'orig') { const [w, h] = rotDims(); return w / h; }
      const [a, b] = st.aspect.split(':').map(Number); return a / b;
    };
    const coverScale = () => { const [w, h] = rotDims(); return Math.max(fw / w, fh / h); };
    function layout() {
      const maxW = Math.min(stage.clientWidth - 24, 520), maxH = Math.max(200, stage.clientHeight - 24);
      const r = ratio();
      fw = maxW; fh = fw / r;
      if (fh > maxH) { fh = maxH; fw = fh * r; }
      fw = Math.round(fw); fh = Math.round(fh);
      cv.style.width = fw + 'px'; cv.style.height = fh + 'px';
      cv.width = Math.round(fw * dpr); cv.height = Math.round(fh * dpr);
      el.querySelectorAll('.ed-grid,.ed-round').forEach(g => { g.style.width = fw + 'px'; g.style.height = fh + 'px'; });
      clamp(); draw();
    }
    function clamp() {
      const [w, h] = rotDims(), s = coverScale() * st.zoom;
      const mx = Math.max(0, (w * s - fw) / 2), my = Math.max(0, (h * s - fh) / 2);
      st.ox = Math.max(-mx, Math.min(mx, st.ox)); st.oy = Math.max(-my, Math.min(my, st.oy));
    }
    // draw the framed image into a context of size (cw x ch) where frame = (fw x fh) scaled by k
    function paint(c, cw, ch, k, withFilter = true) {
      const s = coverScale() * st.zoom * k;
      c.save(); c.fillStyle = '#000'; c.fillRect(0, 0, cw, ch);
      c.translate(cw / 2 + st.ox * k, ch / 2 + st.oy * k);
      c.rotate(st.rot * Math.PI / 180);
      c.scale(s, s);
      c.drawImage(img, -W0 / 2, -H0 / 2);
      c.restore();
      if (withFilter) applyPixels(c, cw, ch, params(st.filter, st.adj));
    }
    function draw() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => paint(ctx, cv.width, cv.height, dpr));
    }

    function renderPanel() {
      el.querySelectorAll('.ed-tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === st.tab));
      if (st.tab === 'crop') {
        panel.innerHTML = `
          <div class="ed-chips">${aspects.map(a => `<button data-a="${a}" class="${a === st.aspect ? 'on' : ''}">${label[a]}</button>`).join('')}
            <button data-e="rotate" title="Rotate">⟳ Rotate</button></div>
          <label class="ed-slider"><span>Zoom</span><input type="range" min="1" max="4" step="0.01" value="${st.zoom}" data-z></label>
          <p class="ed-hint">Drag the photo to move it · pinch or slide to zoom</p>`;
      } else if (st.tab === 'filter') {
        panel.innerHTML = `<div class="ed-filters">${Object.keys(FILTERS).map(n => `<button data-f="${n}" class="${n === st.filter ? 'on' : ''}"><canvas width="72" height="72"></canvas><span>${n}</span></button>`).join('')}</div>`;
        const t = document.createElement('canvas'); t.width = t.height = 72; const tc = t.getContext('2d', { willReadFrequently: true });
        const s = Math.max(72 / W0, 72 / H0);
        panel.querySelectorAll('[data-f]').forEach(b => {
          const c = b.querySelector('canvas').getContext('2d', { willReadFrequently: true });
          c.drawImage(img, (72 - W0 * s) / 2, (72 - H0 * s) / 2, W0 * s, H0 * s);
          applyPixels(c, 72, 72, params(b.dataset.f, { bri: 0, con: 1, sat: 1, warm: 0 }));
        });
      } else {
        panel.innerHTML = ADJ.map(([k, name, min, max, def]) =>
          `<label class="ed-slider"><span>${name}</span><input type="range" min="${min}" max="${max}" step="0.01" value="${st.adj[k]}" data-adj="${k}"><button data-reset="${k}" data-def="${def}">↺</button></label>`).join('');
      }
    }

    el.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.t) { st.tab = b.dataset.t; renderPanel(); }
      else if (b.dataset.a) { st.aspect = b.dataset.a; st.ox = st.oy = 0; layout(); renderPanel(); }
      else if (b.dataset.e === 'rotate') { st.rot = (st.rot + 90) % 360; st.ox = st.oy = 0; layout(); }
      else if (b.dataset.f) { st.filter = b.dataset.f; panel.querySelectorAll('[data-f]').forEach(x => x.classList.toggle('on', x === b)); draw(); }
      else if (b.dataset.reset) { st.adj[b.dataset.reset] = +b.dataset.def; renderPanel(); draw(); }
      else if (b.dataset.e === 'cancel') { finish(null); }
      else if (b.dataset.e === 'done') { exportPhoto(); }
    });
    el.addEventListener('input', e => {
      const t = e.target;
      if (t.dataset.z !== undefined) { st.zoom = +t.value; clamp(); draw(); }
      if (t.dataset.adj) { st.adj[t.dataset.adj] = +t.value; draw(); }
    });

    // drag & pinch
    const ptrs = new Map(); let pinch0 = 0, zoom0 = 1;
    cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); zoom0 = st.zoom; } });
    cv.addEventListener('pointermove', e => {
      const p = ptrs.get(e.pointerId); if (!p) return;
      if (ptrs.size === 1) { st.ox += e.clientX - p.x; st.oy += e.clientY - p.y; }
      p.x = e.clientX; p.y = e.clientY;
      if (ptrs.size === 2 && pinch0) {
        const [a, b] = [...ptrs.values()];
        st.zoom = Math.max(1, Math.min(4, zoom0 * Math.hypot(a.x - b.x, a.y - b.y) / pinch0));
        const z = panel.querySelector('[data-z]'); if (z) z.value = st.zoom;
      }
      clamp(); draw();
    });
    const up = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch0 = 0; };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', e => { e.preventDefault(); st.zoom = Math.max(1, Math.min(4, st.zoom * (e.deltaY < 0 ? 1.06 : 0.94))); clamp(); draw(); }, { passive: false });

    function exportPhoto() {
      const out = opts.out || 1080, r = ratio();
      let ow = out, oh = Math.round(out / r);
      if (oh > 1920) { oh = 1920; ow = Math.round(oh * r); }
      const c = document.createElement('canvas'); c.width = ow; c.height = oh;
      const cx = c.getContext('2d', { willReadFrequently: true });
      paint(cx, ow, oh, ow / fw);
      c.toBlob(b => finish(b), 'image/jpeg', 0.85);
    }
    function finish(v) { window.removeEventListener('resize', layout); el.remove(); resolve(v); }
    window.addEventListener('resize', layout);
    renderPanel();
    requestAnimationFrame(layout);
  });
}

// ------------------------------------------------------------
//  VIDEO EDITOR → resolves to a File (original or re-recorded), or null
//  opts: { maxBytes, maxSeconds }
// ------------------------------------------------------------
function pickMime() {
  const c = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  if (typeof MediaRecorder === 'undefined') return null;
  return c.find(m => MediaRecorder.isTypeSupported(m)) || null;
}
const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function openVideoEditor(file, opts = {}) {
  const maxBytes = opts.maxBytes || 15 * 1024 * 1024, maxSec = opts.maxSeconds || 60;
  const url = URL.createObjectURL(file);
  return new Promise(resolve => {
    const el = sheet(`
      <div class="ed-head"><button class="ed-txt" data-e="cancel">Cancel</button><b>Edit video</b><button class="ed-txt ed-done" data-e="done">Done</button></div>
      <div class="ed-stage"><video class="ed-video" src="${url}" playsinline loop></video></div>
      <div class="ed-panel">
        <div class="ed-trim">
          <label class="ed-slider"><span>Start</span><input type="range" min="0" step="0.1" value="0" data-s><b class="ed-val" data-sv>0:00</b></label>
          <label class="ed-slider"><span>End</span><input type="range" min="0" step="0.1" value="0" data-en><b class="ed-val" data-ev>0:00</b></label>
        </div>
        <div class="ed-chips"><button data-e="play">▶ Play</button><button data-e="mute">🔊 Sound on</button></div>
        <p class="ed-hint" data-info>Loading…</p>
        <div class="prog" hidden><i></i></div>
      </div>`);
    const v = el.querySelector('video'), sIn = el.querySelector('[data-s]'), eIn = el.querySelector('[data-en]'), info = el.querySelector('[data-info]');
    let dur = 0, start = 0, end = 0, muted = false, busy = false;

    const update = () => {
      el.querySelector('[data-sv]').textContent = fmt(start);
      el.querySelector('[data-ev]').textContent = fmt(end);
      const len = end - start, trimmed = start > 0.05 || end < dur - 0.05;
      const needsRecord = trimmed || muted || file.size > maxBytes;
      let msg = `Clip length ${fmt(len)}`;
      if (len > maxSec) msg += ` — too long, trim to ${maxSec} seconds or less`;
      else if (needsRecord && !pickMime()) msg += ' — this browser can’t edit video; choose a shorter clip';
      else if (needsRecord) msg += ' · will be processed when you tap Done (takes as long as the clip)';
      info.textContent = msg;
    };
    v.addEventListener('loadedmetadata', () => {
      dur = v.duration || 0; end = Math.min(dur, maxSec);
      [sIn, eIn].forEach(i => (i.max = dur.toFixed(1)));
      eIn.value = end.toFixed(1); update();
      v.currentTime = 0.05;
    });
    v.addEventListener('timeupdate', () => { if (!busy && v.currentTime >= end) v.currentTime = start; });
    el.addEventListener('input', e => {
      if (e.target === sIn) { start = Math.min(+sIn.value, end - 0.5); sIn.value = start; v.currentTime = start; }
      if (e.target === eIn) { end = Math.max(+eIn.value, start + 0.5); eIn.value = end; v.currentTime = Math.max(start, end - 0.3); }
      update();
    });
    el.addEventListener('click', async e => {
      const b = e.target.closest('button'); if (!b || busy) return;
      if (b.dataset.e === 'cancel') return finish(null);
      if (b.dataset.e === 'play') { if (v.paused) { if (v.currentTime < start || v.currentTime >= end) v.currentTime = start; v.play(); b.textContent = '❚❚ Pause'; } else { v.pause(); b.textContent = '▶ Play'; } }
      if (b.dataset.e === 'mute') { muted = !muted; v.muted = muted; b.textContent = muted ? '🔇 Muted' : '🔊 Sound on'; update(); }
      if (b.dataset.e === 'done') {
        const len = end - start, trimmed = start > 0.05 || end < dur - 0.05;
        if (len > maxSec) { info.textContent = `Please trim the clip to ${maxSec} seconds or less.`; return; }
        if (!trimmed && !muted && file.size <= maxBytes) return finish(file);
        const mime = pickMime();
        if (!mime) { info.textContent = 'This browser can’t edit video. Choose a clip under 15 MB without trimming.'; return; }
        busy = true; el.classList.add('busy');
        try {
          const out = record(v, mime, start, end, muted, p => { const pg = el.querySelector('.prog'); pg.hidden = false; pg.querySelector('i').style.width = (p * 100) + '%'; info.textContent = `Processing… ${Math.round(p * 100)}%`; });
          const f = await out;
          if (f.size > maxBytes) { busy = false; el.classList.remove('busy'); info.textContent = `Still too large (${(f.size / 1048576).toFixed(1)} MB). Trim it shorter.`; return; }
          finish(f);
        } catch (err) { busy = false; el.classList.remove('busy'); info.textContent = 'Could not process this video: ' + (err.message || err); }
      }
    });
    function finish(val) { v.pause(); el.remove(); if (val !== file) URL.revokeObjectURL(url); resolve(val); }
  });
}

// re-record the selected part through a canvas (+ audio) with MediaRecorder.
// Called synchronously from the Done tap so playback is allowed to start.
function record(v, mime, start, end, muted, onProgress) {
  const vw = v.videoWidth || 720, vh = v.videoHeight || 1280, k = Math.min(1, 720 / Math.max(vw, vh));
  const c = document.createElement('canvas'); c.width = Math.round(vw * k / 2) * 2; c.height = Math.round(vh * k / 2) * 2;
  const cx = c.getContext('2d');
  const stream = c.captureStream(30);
  let ac = null;
  if (!muted) {
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      const src = ac.createMediaElementSource(v), dest = ac.createMediaStreamDestination();
      src.connect(dest);
      dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
    } catch { ac = null; }
  }
  v.muted = muted && !ac; v.loop = false; v.pause();
  v.currentTime = start;
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 1800000, audioBitsPerSecond: 96000 });
  const parts = [];
  rec.ondataavailable = e => e.data.size && parts.push(e.data);
  return new Promise((resolve, reject) => {
    let stopped = false;
    const stop = () => { if (stopped) return; stopped = true; v.pause(); try { rec.stop(); } catch {} };
    rec.onstop = () => {
      ac?.close();
      const type = mime.split(';')[0], ext = type.includes('mp4') ? 'mp4' : 'webm';
      resolve(new File(parts, 'video.' + ext, { type }));
    };
    rec.onerror = e => { stop(); reject(e.error || new Error('recording failed')); };
    const tick = () => {
      if (stopped) return;
      cx.drawImage(v, 0, 0, c.width, c.height);
      onProgress(Math.min(1, Math.max(0, (v.currentTime - start) / (end - start))));
      if (v.currentTime >= end || v.ended) return stop();
      requestAnimationFrame(tick);
    };
    const go = () => {
      v.removeEventListener('seeked', go);
      cx.drawImage(v, 0, 0, c.width, c.height);
      rec.start(500);
      ac?.resume();
      v.play().then(() => requestAnimationFrame(tick)).catch(err => { stop(); reject(err); });
    };
    v.addEventListener('seeked', go);
  });
}
