// Seva Saathi — backend
// Express server: serves the phone-call frontend + proxies Gnani AI (keys stay server-side)
// + streams the LLM brain + generates the grievance letter (the hero artifact).
'use strict';
require('./lib/gnani'); // loads .env on import
const express = require('express');
const path = require('path');
const gnani = require('./lib/gnani');
const rag = require('./lib/rag');
const llm = require('./lib/llm');
const { generateLetter } = require('./lib/letter');

const app = express();
const PORT = process.env.PORT || 8787;

app.use(express.json({ limit: '1mb' }));
app.use(express.raw({ type: 'application/octet-stream', limit: '30mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ── naive per-IP rate limit (hackathon-grade) ─────────────────────── */
const buckets = new Map();
function rateLimit(req, res, next) {
  const ip = req.socket.remoteAddress || 'x';
  const now = Date.now();
  const b = buckets.get(ip) || { n: 0, t0: now };
  if (now - b.t0 > 60_000) { b.n = 0; b.t0 = now; }
  b.n += 1;
  buckets.set(ip, b);
  if (b.n > 60) return res.status(429).json({ success: false, error: 'Rate limit — thoda ruk ke try karein.' });
  next();
}
app.use(rateLimit);

function sseInit(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
}
function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/* ── health ────────────────────────────────────────────────────────── */
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    gnani_configured: Boolean(gnani.API_KEY),
    llm_configured: llm.llmConfigured(),
    llm_model: process.env.LLM_MODEL || null,
    corpus_schemes: rag.SCHEMES.length,
  });
});

/* ── STT: browser sends raw WAV bytes ──────────────────────────────── */
app.post('/api/stt', async (req, res) => {
  try {
    const buf = req.body;
    if (!buf || !buf.length) return res.status(400).json({ success: false, error: 'No audio received' });
    const out = await gnani.sttRobust(buf);
    res.json({
      success: true,
      transcript: out.transcript,
      model: out.model,
      latency_ms: out.latency_ms,
      fallback_used: out.fallback_used || null,
    });
  } catch (e) {
    console.error('[stt]', e.message);
    res.status(e.status && e.status >= 400 && e.status < 500 ? e.status : 502).json({ success: false, error: e.message });
  }
});

/* ── Ask: transcript → RAG → LLM (streamed), sentence events for TTS ─ */
app.post('/api/ask', async (req, res) => {
  const { transcript } = req.body || {};
  if (!transcript || !String(transcript).trim()) return res.status(400).json({ success: false, error: 'Empty transcript' });

  const { context, citations, matched } = rag.buildContext(String(transcript));
  const mix = rag.langMix(String(transcript));
  sseInit(res);

  const userMsg = matched
    ? `CONTEXT:\n${context}\n\nग्राहक का सवाल: "${transcript}"`
    : `ग्राहक का सवाल: "${transcript}"`;

  if (llm.llmConfigured()) {
    sse(res, 'mode', { brain: 'llm', model: process.env.LLM_MODEL });
    let full = '';
    let sentenceBuf = '';
    try {
      for await (const delta of llm.chatStream([
        { role: 'system', content: llm.SYSTEM_PROMPT },
        { role: 'user', content: userMsg },
      ])) {
        full += delta;
        sse(res, 'token', { t: delta });
        sentenceBuf += delta;
        const m = sentenceBuf.match(/^[\s\S]*?[।!?\n]/);
        if (m && m[0].trim().length >= 8) {
          sse(res, 'sentence', { text: m[0].trim(), index: full.length });
          sentenceBuf = sentenceBuf.slice(m[0].length);
        } else if (sentenceBuf.length >= 180) {
          const cut = sentenceBuf.lastIndexOf(' ');
          const piece = cut > 40 ? sentenceBuf.slice(0, cut) : sentenceBuf;
          sse(res, 'sentence', { text: piece.trim(), index: full.length });
          sentenceBuf = cut > 40 ? sentenceBuf.slice(cut) : '';
        }
      }
      if (sentenceBuf.trim()) sse(res, 'sentence', { text: sentenceBuf.trim(), index: full.length });
      sse(res, 'done', { answer: full.trim(), citations, lang_mix: mix, matched });
    } catch (e) {
      console.error('[ask:llm]', e.message);
      // degraded fallback inside the same stream
      const fallback = matched
        ? `${citations[0]?.name_hi || ''} के बारे में: ${rag.SCHEMES.find((s) => s.key === citations[0]?.key)?.summary_hi || ''} विस्तार के लिए आधिकारिक साइट देखें।`
        : 'माफ़ कीजिए, मैं अभी सिर्फ़ छह योजनाओं की जानकारी देती हूँ — पीएम किसान, आयुष्मान भारत, पीएम आवास, अटल पेंशन, ई-श्रम और मनरेगा।';
      sse(res, 'sentence', { text: fallback, index: 0 });
      sse(res, 'done', { answer: fallback, citations, lang_mix: mix, matched, degraded: true });
    }
  } else {
    // Retrieval-only degraded mode (no LLM key) — demo never hard-fails
    sse(res, 'mode', { brain: 'retrieval' });
    let answer;
    if (matched) {
      const s = rag.SCHEMES.find((x) => x.key === citations[0].key);
      // answer with the single most query-relevant fact — no repetition
      const qT = new Set(rag.tokenize(String(transcript)));
      let best = null, bestN = 0;
      for (const f of s.facts) {
        let n = 0;
        for (const t of rag.tokenize(f.q_hi + ' ' + f.a_hi)) if (qT.has(t)) n++;
        if (n > bestN) { bestN = n; best = f; }
      }
      answer = bestN > 0 ? best.a_hi : `${s.summary_hi} विस्तार के लिए ${s.official_url} देख सकते हैं।`;
    } else {
      answer = 'मैं अभी सिर्फ़ छह योजनाओं की जानकारी देती हूँ — पीएम किसान, आयुष्मान भारत, पीएम आवास, अटल पेंशन, ई-श्रम और मनरेगा। इनमें से किसी योजना के बारे में बताइए।';
    }
    sse(res, 'token', { t: answer });
    sse(res, 'sentence', { text: answer, index: 0 });
    sse(res, 'done', { answer, citations, lang_mix: mix, matched, degraded: true });
  }
  res.end();
});

/* ── TTS: text → stream of clean WAV chunks (base64) ───────────────── */
app.post('/api/tts', async (req, res) => {
  const { text, voice } = req.body || {};
  if (!text || !String(text).trim()) return res.status(400).json({ success: false, error: 'Empty text' });
  try {
    sseInit(res);
    let i = 0;
    for await (const wavBuf of gnani.ttsStream(String(text).slice(0, 500), { voice })) {
      sse(res, 'chunk', { i: i++, audio: wavBuf.toString('base64') });
    }
    sse(res, 'complete', { chunks: i });
    res.end();
  } catch (e) {
    console.error('[tts]', e.message);
    if (!res.headersSent) res.status(502).json({ success: false, error: e.message });
    else { sse(res, 'error', { message: e.message }); res.end(); }
  }
});

/* ── Letter: the hero artifact ─────────────────────────────────────── */
app.post('/api/letter', async (req, res) => {
  try {
    const { transcript, answer } = req.body || {};
    const out = await generateLetter(String(transcript || ''), String(answer || ''));
    res.json({ success: true, ...out });
  } catch (e) {
    console.error('[letter]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n  सेवा साथी / Seva Saathi  →  http://localhost:${PORT}\n`);
  console.log(`  Gnani key: ${gnani.API_KEY ? 'configured ✓' : 'MISSING ✗'}   LLM: ${llm.llmConfigured() ? `configured ✓ (${process.env.LLM_MODEL})` : 'degraded retrieval-only mode'}`);
  console.log(`  Corpus: ${rag.SCHEMES.length} schemes\n`);
});
