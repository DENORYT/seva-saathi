/* Seva Saathi — frontend engine
 * Phone-call theater · Gnani Prisma STT + Timbre TTS · mandi-mode digital noise mixing
 * Council-mandated details baked in:
 *  - getUserMedia: echoCancellation/noiseSuppression/autoGainControl = false (so mandi noise really reaches Prisma)
 *  - noise is DIGITALLY MIXED into the recorded stream (not just speaker playback)
 *  - gapless TTS playback via WebAudio scheduling; streaming sentence pipeline
 */
'use strict';

/* ═══════════ helpers ═══════════ */
const $ = (id) => document.getElementById(id);
const show = (id) => document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
function toast(msg, ms = 2600) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add('hidden'), ms);
}
async function sseFetch(url, body, onEvent, signal) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch (_) {}
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      let ev = 'message', data = '';
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) ev = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (data) { try { onEvent(ev, JSON.parse(data)); } catch (_) {} }
    }
  }
}

/* ═══════════ state ═══════════ */
const S = {
  callActive: false,
  recording: false,
  mandi: false,
  ctx: null,
  micStream: null,
  nodes: {},
  pcm: [],
  proc: null,
  playhead: 0,
  playing: [],
  abort: new AbortController(),
  timer: null,
  t0: 0,
  turn: { user: '', agent: '' },
  turns: [],
  lastNoiseTranscript: '',
  stats: JSON.parse(localStorage.getItem('ss_stats') || '{"calls":0,"noise":0,"mix":null}'),
};

const SCHEMES_UI = [
  { n: 'PM किसान', q: 'पीएम किसान की किस्त नहीं आई है, क्या करूँ?' },
  { n: 'आयुष्मान', q: 'आयुष्मान कार्ड कैसे बनवाएं?' },
  { n: 'आवास', q: 'आवास योजना में कितने पैसे मिलते हैं?' },
  { n: 'पेंशन', q: 'अटल पेंशन के लिए कौन आवेदन कर सकता है?' },
  { n: 'ई-श्रम', q: 'e-shram card kaise banaye?' },
  { n: 'मनरेगा', q: 'मनरेगा की मजदूरी नहीं मिली, शिकायत करनी है।' },
];

/* ═══════════ dial screen ═══════════ */
(function initDial() {
  const holder = $('schemeChips');
  SCHEMES_UI.forEach((s, i) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.innerHTML = `<b><span class="n">${i + 1}</span>${s.n}</b><small>${s.q.length > 34 ? s.q.slice(0, 34) + '…' : s.q}</small>`;
    b.onclick = () => { $("typeInput").value = s.q; startCall(s.q); };
    holder.appendChild(b);
  });
  renderStats();
})();

function renderStats() {
  $('statCalls').textContent = S.stats.calls;
  $('statNoise').textContent = S.stats.noise;
  $('statMix').textContent = S.stats.mix === null ? '—' : `हिंदी ${S.stats.mix}%`;
}
function bumpStat(k, v) {
  S.stats[k] = v === undefined ? S.stats[k] + 1 : v;
  localStorage.setItem('ss_stats', JSON.stringify(S.stats));
  renderStats();
}

/* ═══════════ audio engine ═══════════ */
async function audioInit() {
  if (S.ctx) return;
  S.ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
  await S.ctx.resume();
}

// Procedural mandi ambience (royalty-free by construction) — brown noise + chatter + bell
function buildMandi() {
  const ctx = S.ctx;
  const out = ctx.createGain(); out.gain.value = 0.9;

  // brown-noise crowd rumble
  const len = ctx.sampleRate * 3;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    last = (last + 0.02 * w) / 1.02;
    d[i] = last * 3.2;
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buf; noise.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = 0.6;
  const murmur = ctx.createGain(); murmur.gain.value = 0.55;
  noise.connect(bp).connect(murmur).connect(out);
  noise.start();

  // random chatter bursts (AM on filtered noise)
  const chatter = setInterval(() => {
    if (!S.callActive || !S.nodes.mandiOut) { clearInterval(chatter); return; }
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.35, t + 0.15);
    g.gain.linearRampToValueAtTime(0, t + 0.8 + Math.random() * 0.6);
    const src = ctx.createBufferSource(); src.buffer = buf;
    src.playbackRate.value = 1 + Math.random() * 1.5;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900 + Math.random() * 1400; f.Q.value = 2;
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 2, 1.4);
  }, 900);

  // occasional bell (thela/cart)
  const bell = setInterval(() => {
    if (!S.callActive || !S.nodes.mandiOut) { clearInterval(bell); return; }
    const t = ctx.currentTime;
    [1568, 2093].forEach((freq, k) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(k ? 0.05 : 0.12, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
      o.connect(g).connect(out); o.start(t); o.stop(t + 1.3);
    });
  }, 4200);

  return out;
}

async function startRecording() {
  await audioInit();
  stopPlayback(); // barge-in
  if (S.recording) return;

  // Council-critical: disable ALL browser processing so mandi noise genuinely reaches Prisma
  S.micStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
  });

  const ctx = S.ctx;
  const mic = ctx.createMediaStreamSource(S.micStream);
  const recBus = ctx.createGain(); recBus.gain.value = 1;
  mic.connect(recBus);

  if (S.mandi) {
    const mandiOut = buildMandi();
    const toSpeaker = ctx.createGain(); toSpeaker.gain.value = 0.5;
    const toRecord = ctx.createGain(); toRecord.gain.value = 1.6; // noise must be clearly present
    mandiOut.connect(toSpeaker).connect(ctx.destination);
    mandiOut.connect(toRecord).connect(recBus);
    S.nodes.mandiOut = mandiOut;
  }

  const proc = ctx.createScriptProcessor(4096, 1, 1);
  S.pcm = [];
  proc.onaudioprocess = (e) => {
    if (!S.recording) return;
    S.pcm.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  };
  const mute = ctx.createGain(); mute.gain.value = 0;
  recBus.connect(proc); proc.connect(mute).connect(ctx.destination);

  const analyser = ctx.createAnalyser(); analyser.fftSize = 256;
  recBus.connect(analyser);

  Object.assign(S.nodes, { mic, recBus, proc, mute, analyser });
  S.proc = proc;
  S.recording = true;
  $('wavebars').classList.add('live');
  $('talkBtn').classList.add('recording');
  meterLoop();
}

function meterLoop() {
  if (!S.recording) return;
  const data = new Uint8Array(S.nodes.analyser.frequencyBinCount);
  S.nodes.analyser.getByteFrequencyData(data);
  const bars = $('wavebars').children;
  for (let i = 0; i < bars.length; i++) {
    const v = data[Math.floor((i + 2) * 6)] / 255;
    bars[i].style.height = `${6 + v * 20}px`;
  }
  requestAnimationFrame(meterLoop);
}

async function stopRecording() {
  if (!S.recording) return null;
  S.recording = false;
  $('wavebars').classList.remove('live');
  $('talkBtn').classList.remove('recording');
  try { S.proc && (S.proc.onaudioprocess = null, S.proc.disconnect()); } catch (_) {}
  try { S.nodes.mic && S.nodes.mic.disconnect(); } catch (_) {}
  try { S.micStream && S.micStream.getTracks().forEach((t) => t.stop()); } catch (_) {}
  if (S.nodes.mandiOut) { try { S.nodes.mandiOut.disconnect(); } catch (_) {} S.nodes.mandiOut = null; }

  const floats = S.pcm;
  if (!floats.length) return null;
  let rate = S.ctx.sampleRate;
  // merge → mono float
  let merged;
  if (rate !== 16000) {
    // linear resample to 16k
    const all = concatFloat32(floats);
    const ratio = rate / 16000;
    const n = Math.floor(all.length / ratio);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const pos = i * ratio, j = Math.floor(pos);
      const frac = pos - j;
      out[i] = all[j] * (1 - frac) + (all[j + 1] ?? all[j]) * frac;
    }
    merged = out; rate = 16000;
  } else {
    merged = concatFloat32(floats);
  }
  if (merged.length < rate * 0.4) { toast('बहुत छोटा — फिर बोलें'); return null; }
  return encodeWav(merged, rate);
}

function concatFloat32(arrs) {
  let n = 0; for (const a of arrs) n += a.length;
  const out = new Float32Array(n);
  let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
function encodeWav(samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); ws(8, 'WAVE');
  ws(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ws(36, 'data'); v.setUint32(40, samples.length * 2, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/* ── TTS playback: gapless scheduling across streamed chunks ── */
async function speak(text) {
  if (!text || !S.callActive) return;
  const ctx = S.ctx;
  let firstAt = null;
  try {
    await sseFetch('/api/tts', { text }, async (ev, d) => {
      if (ev !== 'chunk' || !d.audio) return;
      const bytes = Uint8Array.from(atob(d.audio), (c) => c.charCodeAt(0));
      const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const audio = await ctx.decodeAudioData(ab);
      if (firstAt === null) firstAt = performance.now();
      const src = ctx.createBufferSource();
      src.buffer = audio;
      S.playhead = Math.max(ctx.currentTime + 0.06, S.playhead);
      src.connect(ctx.destination);
      src.start(S.playhead);
      S.playhead += audio.duration + 0.012;
      S.playing.push(src);
    }, S.abort.signal);
  } catch (e) {
    if (e.name !== 'AbortError') console.warn('tts:', e.message);
  }
}
function stopPlayback() {
  S.playing.forEach((s) => { try { s.stop(); } catch (_) {} });
  S.playing = [];
  S.playhead = 0;
}

/* ═══════════ ringtone ═══════════ */
async function ringtone() {
  await audioInit();
  const ctx = S.ctx, t = ctx.currentTime;
  const g = ctx.createGain(); g.gain.value = 0.16; g.connect(ctx.destination);
  [0, 0.6, 1.2, 1.8].forEach((start) => {
    [425, 450].forEach((f) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const eg = ctx.createGain();
      eg.gain.setValueAtTime(1, t + start);
      eg.gain.setValueAtTime(0, t + start + 0.35);
      o.connect(eg).connect(g); o.start(t + start); o.stop(t + start + 0.4);
    });
  });
  await new Promise((r) => setTimeout(r, 2400));
}

/* ═══════════ call flow ═══════════ */
async function startCall(preset) {
  S.mandi = $('mandiToggle').checked;
  S.callActive = true;
  S.abort = new AbortController();
  S.turns = []; S.turn = { user: '', agent: '' };
  S.lastNoiseTranscript = '';
  show('screen-ring');
  ringtone().then(async () => {
    if (!S.callActive) return;
    await audioInit();
    show('screen-call');
    $('transcript').innerHTML = '<div class="agent-greet" id="greetBubble">नमस्ते! सेवा साथी में आपका स्वागत है।</div>';
    S.t0 = Date.now();
    S.timer = setInterval(() => {
      const s = Math.floor((Date.now() - S.t0) / 1000);
      $('callTimer').textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
    }, 1000);
    S.playhead = S.ctx.currentTime + 0.1;
    const greet = 'नमस्ते! सेवा साथी में आपका स्वागत है। मैं पीएम किसान, आयुष्मान भारत, आवास योजना, अटल पेंशन, ई-श्रम और मनरेगा के बारे में बता सकती हूँ। आप क्या जानना चाहते हैं?';
    speak(greet);
    if (preset) setTimeout(() => processUserText(preset, true), 1200);
  });
}

function endCall() {
  S.callActive = false;
  S.recording = false;
  clearInterval(S.timer);
  S.abort.abort();
  stopPlayback();
  try { S.micStream && S.micStream.getTracks().forEach((t) => t.stop()); } catch (_) {}
  const dur = Math.floor((Date.now() - S.t0) / 1000);
  $('endDuration').textContent = String(Math.floor(dur / 60)).padStart(2, '0') + ':' + String(dur % 60).padStart(2, '0');
  // transcript summary
  const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const et = $('endTranscript');
  et.innerHTML = '';
  S.turns.forEach((t) => {
    const u = document.createElement('div'); u.className = 'u';
    u.innerHTML = '<span class="who">आप</span>' + esc(t.user);
    const a = document.createElement('div'); a.className = 'a';
    a.innerHTML = '<span class="who" style="color:var(--secondary)">साथी</span>' + esc(t.agent.slice(0, 220) + (t.agent.length > 220 ? '…' : ''));
    et.appendChild(u); et.appendChild(a);
  });
  // noise compare
  if (S.mandi && S.lastNoiseTranscript) {
    $('noiseCompare').classList.remove('hidden');
    $('noiseTranscript').textContent = S.lastNoiseTranscript;
    $('mandiBadge').classList.add('hidden');
  } else {
    $('noiseCompare').classList.add('hidden');
  }
  $('smsSummary').textContent = '—';
  $('letterHolder').classList.add('hidden');
  $('letterBtn').classList.remove('hidden');
  show('screen-end');
}

/* ═══════════ turn pipeline: STT → ask(SSE) → speak per sentence ═════ */
async function processUserText(text, fromPreset = false) {
  if (!S.callActive || !text || S.busy) return;
  S.busy = true;
  $('talkBtn').disabled = true;
  addBubble('user', text);
  S.turn.user = text;
  if (S.mandi) S.lastNoiseTranscript = text;

  const agentB = addBubble('agent', '');
  agentB.classList.add('typing');
  let agentText = '';
  const citations = [];

  try {
    await sseFetch('/api/ask', { transcript: text }, (ev, d) => {
      if (ev === 'token') { agentText += d.t; agentB.textContent = agentText; scrollT(); }
      else if (ev === 'sentence') {
        agentB.classList.remove('typing');
        speak(d.text);
      } else if (ev === 'done') {
        (d.citations || []).forEach((c) => citations.push(c));
        if (d.lang_mix && d.lang_mix.devanagari_pct != null) bumpStat('mix', d.lang_mix.devanagari_pct);
        if (d.degraded) agentB.insertAdjacentHTML('beforeend', '<br><small class="muted">[retrieval mode — LLM key जोड़ें]</small>');
      }
    }, S.abort.signal);
  } catch (e) {
    agentB.classList.remove('typing');
    if (e.name !== 'AbortError') {
      agentText = 'माफ़ कीजिए, कुछ तकनीकी दिक्कत है। फिर से बोलिए।';
      agentB.textContent = agentText;
      speak(agentText);
      toast(e.message);
    }
  }

  // citation chips
  if (citations.length) {
    agentB.insertAdjacentHTML('beforeend', '<br>' + citations.map((c) =>
      `<a class="cite" href="${c.official_url}" target="_blank" rel="noopener"><i class="ph ph-link"></i>${c.name_en}</a>`).join(''));
  }
  agentB.classList.remove('typing');
  S.turn.agent = agentText;
  S.turns.push({ ...S.turn });
  S.turn = { user: '', agent: '' };
  S.busy = false;
  $('talkBtn').disabled = false;
  scrollT();
}

function addBubble(role, text) {
  const b = document.createElement('div');
  b.className = 'bubble ' + role;
  b.textContent = text;
  $('transcript').appendChild(b);
  scrollT();
  return b;
}
function scrollT() { const t = $('transcript'); t.scrollTop = t.scrollHeight; }

/* ═══════════ wire UI ═══════════ */
$('callBtn').onclick = () => startCall();
$('cancelBtn').onclick = () => { S.callActive = false; show('screen-dial'); };
$('endCallBtn').onclick = endCall;
$('againBtn').onclick = () => show('screen-dial');

const talk = $('talkBtn');
talk.addEventListener('pointerdown', async (e) => { e.preventDefault(); if (S.callActive && !S.busy) await startRecording(); });
['pointerup', 'pointerleave', 'pointercancel'].forEach((evt) =>
  talk.addEventListener(evt, async () => {
    if (!S.recording) return;
    const wav = await stopRecording();
    if (!wav) return;
    try {
      const res = await fetch('/api/stt', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: wav });
      const j = await res.json();
      bumpStat('calls');
      if (S.mandi) bumpStat('noise');
      if (!j.success || !j.transcript) { toast(j.error || 'समझ नहीं आया — फिर बोलें'); return; }
      if (j.fallback_used) toast(`मल्टीलिंगुअल मॉडल ने पकड़ा · ${j.model}`, 1500);
      processUserText(j.transcript);
    } catch (e) { toast('STT त्रुटि: ' + e.message); }
  }));
talk.addEventListener('contextmenu', (e) => e.preventDefault());

$('askBtn').onclick = () => { $('typeInput').classList.toggle('hidden'); $('typeInput').focus(); };
$('typeInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.value.trim()) {
    const t = e.target.value.trim();
    e.target.value = '';
    processUserText(t);
  }
});

$('mandiToggle').addEventListener('change', (e) => {
  if (e.target.checked) toast('मंडी मोड: शोर सीधे कॉल ऑडियो में मिक्स होगा', 3000);
});

/* letter (hero artifact) */
$('letterBtn').onclick = async () => {
  const btn = $('letterBtn');
  btn.disabled = true; btn.textContent = 'पत्र बन रहा है…';
  try {
    const last = S.turns[S.turns.length - 1] || { user: '', agent: '' };
    const res = await fetch('/api/letter', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript: last.user, answer: last.agent }),
    });
    const j = await res.json();
    if (!j.success) throw new Error(j.error || 'letter failed');
    $('letterFrame').srcdoc = j.html;
    $('smsSummary').textContent = j.sms;
    $('letterHolder').classList.remove('hidden');
    btn.classList.add('hidden');
    toast('पत्र तैयार — प्रिंट करके पंचायत/सीएससी में जमा करें');
  } catch (e) { toast('पत्र त्रुटि: ' + e.message); btn.disabled = false; btn.textContent = 'पत्र बनाएं · Generate Letter'; }
};
$('letterPrint').onclick = () => {
  const f = $('letterFrame');
  f.contentWindow && f.contentWindow.print();
};
