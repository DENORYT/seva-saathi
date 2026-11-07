// Gnani AI client — Prisma v2.5 (STT) + Timbre v2.5 (TTS)
// Live-verified contracts (2026-11-08):
//   STT: POST https://api.vachana.ai/stt/v3  (multipart, X-API-Key-ID)
//        language_code=indic-auto + multi_lang_codes=en-IN,hi-IN  → prisma-v3.0 multilingual
//        language_code=hi-IN                                       → prisma-v2.5 single-language
//   TTS: POST https://api.vachana.ai/api/v1/tts/sse  (JSON, X-API-Key-ID, SSE)
//        model=timbre-v2.5; each `chunk` event carries a self-contained base64 WAV.
'use strict';
const fs = require('fs');
const path = require('path');

// Load .env (tiny parser — no dependency)
(function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
})();

const BASE = 'https://api.vachana.ai';
const API_KEY = process.env.GNANI_API_KEY || '';

function headers(extra = {}) {
  return { 'X-API-Key-ID': API_KEY, ...extra };
}

/* ───────────────────────── STT (Prisma) ───────────────────────── */

/**
 * Transcribe a WAV buffer.
 * @param {Buffer} wavBuf  16kHz-mono WAV (recommended) — any format the API accepts works
 * @param {object} [opts]  { lang, multiLang, format }
 * @returns {Promise<{transcript:string, model:string, latency_ms:number, request_id:string}>}
 */
async function stt(wavBuf, opts = {}) {
  const lang = opts.lang || process.env.GNANI_STT_LANG || 'indic-auto';
  const multiLang = opts.multiLang || process.env.GNANI_MULTI_LANG || 'en-IN,hi-IN';
  const format = opts.format || process.env.GNANI_STT_FORMAT || 'transcribe';

  const form = new FormData();
  form.append('audio_file', new Blob([wavBuf], { type: 'audio/wav' }), 'audio.wav');
  form.append('language_code', lang);
  if (lang === 'indic-auto' && multiLang) form.append('multi_lang_codes', multiLang);
  if (format) form.append('format', format);

  const t0 = Date.now();
  const res = await fetch(`${BASE}/stt/v3`, {
    method: 'POST',
    headers: headers(), // let fetch set multipart boundary
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    const msg = data?.error?.message || data?.message || `HTTP ${res.status}`;
    const err = new Error(`Gnani STT error: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return {
    transcript: (data.transcript || '').trim(),
    model: data.model || '',
    latency_ms: Date.now() - t0,
    request_id: data.request_id || '',
  };
}

/** STT with robustness: indic-auto → if empty, retry with single fallback language. */
async function sttRobust(wavBuf, opts = {}) {
  let out = await stt(wavBuf, opts);
  const fallback = process.env.GNANI_STT_FALLBACK_LANG || 'hi-IN';
  if (!out.transcript && (opts.lang || process.env.GNANI_STT_LANG) === 'indic-auto') {
    try {
      const retry = await stt(wavBuf, { ...opts, lang: fallback, multiLang: null });
      if (retry.transcript) out = { ...retry, fallback_used: fallback };
    } catch (_) { /* keep first result */ }
  }
  return out;
}

/* ───────────────────────── TTS (Timbre) ───────────────────────── */

// Parse SSE frames from a byte stream → {event, data} objects
async function* sseFrames(body) {
  const dec = new TextDecoder();
  let buf = '';
  for await (const u8 of body) {
    buf += dec.decode(u8, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = 'message', data = '';
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (data) yield { event, data };
    }
  }
}

// Parse a WAV buffer into { fmt, pcm } by walking RIFF chunks (no 44-byte assumption)
function parseWav(buf) {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  let off = 12, fmt = null, pcm = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ' && off + 8 + 16 <= buf.length) {
      fmt = {
        audioFormat: buf.readUInt16LE(off + 8),
        channels: buf.readUInt16LE(off + 10),
        sampleRate: buf.readUInt32LE(off + 12),
        bitsPerSample: buf.readUInt16LE(off + 22),
      };
    } else if (id === 'data') {
      pcm = buf.subarray(off + 8, Math.min(off + 8 + size, buf.length));
    }
    off += 8 + size + (size % 2);
    if (size === 0 || size > buf.length) break; // bogus/placeholder size guard
  }
  return fmt && pcm ? { fmt, pcm } : null;
}

// Wrap raw PCM in a correct canonical 44-byte WAV header
function makeWav(pcm, sampleRate, channels, bitsPerSample) {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22); h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(byteRate, 28);
  h.writeUInt16LE(blockAlign, 32); h.writeUInt16LE(bitsPerSample, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/**
 * Synthesize speech → async generator of clean, self-contained WAV buffers.
 * Handles the API's placeholder-size RIFF headers by re-wrapping parsed PCM.
 */
async function* ttsStream(text, opts = {}) {
  if (!API_KEY) throw new Error('GNANI_API_KEY not configured');
  const payload = {
    text,
    model: opts.model || process.env.TTS_MODEL || 'timbre-v2.5',
    voice: opts.voice || process.env.TTS_VOICE || 'Kaveri',
    audio_config: {
      sample_rate: 16000,
      encoding: 'linear_pcm',
      container: 'wav',
      num_channels: 1,
      sample_width: 2,
    },
  };
  const res = await fetch(`${BASE}/api/v1/tts/sse`, {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json', Accept: 'text/event-stream' }),
    body: JSON.stringify(payload),
  });
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => '');
    throw new Error(`Gnani TTS error: HTTP ${res.status} ${t.slice(0, 200)}`);
  }
  let fmtRef = null;
  for await (const { event, data } of sseFrames(res.body)) {
    if (event === 'start') continue;
    if (event === 'error') {
      const d = JSON.parse(data);
      throw new Error(`Gnani TTS synthesis error: ${d.message || 'unknown'}`);
    }
    if (event === 'complete') return;
    if (event === 'chunk') {
      const d = JSON.parse(data);
      if (!d.audio) continue;
      const raw = Buffer.from(d.audio, 'base64');
      const isWav = raw.length >= 12 && raw.toString('ascii', 0, 4) === 'RIFF';
      if (isWav) {
        // First chunk (or any headered chunk): parse fmt + PCM, re-wrap with real sizes
        const parsed = parseWav(raw);
        if (parsed) {
          fmtRef = parsed.fmt;
          yield makeWav(parsed.pcm, parsed.fmt.sampleRate, parsed.fmt.channels, parsed.fmt.bitsPerSample);
          continue;
        }
      }
      // Raw PCM continuation → wrap in a valid WAV using the stream's fmt
      const fmt = fmtRef || { sampleRate: 16000, channels: 1, bitsPerSample: 2 * 8 };
      yield makeWav(raw, fmt.sampleRate, fmt.channels, fmt.bitsPerSample);
    }
  }
  void fmtRef;
}

module.exports = { stt, sttRobust, ttsStream, makeWav, parseWav, API_KEY, BASE };
