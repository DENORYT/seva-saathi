# सेवा साथी · Seva Saathi 📞

> **The missing last-mile interface for India's scheme stack.**
> A voice-first helpline where a rural citizen *talks* in Hindi/Hinglish, gets cited answers about
> government schemes, and walks away with a ready-to-file grievance/application letter.

Built for the **Great Indian AI Internship Challenge** (Gnani AI) — [www.gnani.ai/internship](https://www.gnani.ai/internship)

📄 **Judges: start with the one-page solution pitch → [`PITCH.md`](PITCH.md)** (technical documentation continues below)

---

## What it does

```
 🎙️ user speaks Hindi/Hinglish (even with market noise playing)
   ↓
 🔊 [मंडी मोड] market ambience is digitally MIXED into the mic stream (noise-robustness demo)
   ↓
 🎧 Prisma v2.5 STT  →  "नमस्ते, PM Kisan की किस्त कब आएगी?"  (code-mixed transcription, ~350ms)
   ↓
 🧠 LLM brain (Evon v3.3 / any OpenAI-compatible) + RAG over 6 hand-verified schemes
   ↓    every answer shows a citation chip → official .gov.in link
 🔊 Timbre v2.5 TTS  →  streams natural Hindi voice, gapless WebAudio playback
   ↓
 ✍️ call ends → grievance/application LETTER generated (voice → structured action)
                + SMS-style summary + noise-robustness proof on the summary screen
```

**Why it matters:** hundreds of crores in entitlements go unclaimed because the last mile is
a language problem, not a policy problem. Every competitor builds a chatbot; Seva Saathi ends
the call with a *document the citizen can physically submit at the panchayat*.

## Gnani AI models used (eligibility)

| Model | Role | Where |
|---|---|---|
| **Prisma v2.5 / v3.0** | Streaming-accuracy STT in Hindi + code-mixed Hinglish (`indic-auto`, `multi_lang_codes=en-IN,hi-IN`), ITN formatting | `lib/gnani.js` → `POST api.vachana.ai/stt/v3` |
| **Timbre v2.5** | Hindi TTS, SSE-streamed audio chunks re-wrapped for gapless playback | `lib/gnani.js` → `POST api.vachana.ai/api/v1/tts/sse` |
| **Evon v3.3** | LLM brain over the RAG corpus (via Hugging Face router; any OpenAI-compatible endpoint supported) | `lib/llm.js` |

## Award categories targeted
Solo Ninja (or Two-Person Army) · Real Deal (rural impact) · Main Character (Hindi) ·
Mixed Vibes (Hinglish code-mixing) · Noise Canceller (mandi mode) · Demo Day Drop (60-sec video)

## Quick start

```bash
npm install
cp .env.example .env        # fill GNANI_API_KEY (+ LLM_* if you have Evon/hosted access)
npm run smoke               # Hour-1 gate: live STT↔TTS round-trip test
npm start                   # → http://localhost:8787
```

Then: **click a scheme chip → call → hold the mic button → speak Hinglish.**
Flip **मंडी मोड** before the call to run the noise-robustness demo.

## Architecture

```
public/            phone-call frontend (dialer → ring → live call → call-end artifacts)
  app.js           WebAudio graph: mic (EC/NS/AGC disabled) + procedural mandi ambience,
                   both mixed into the recorded WAV; sentence-streaming TTS player
server.js          Express: /api/stt · /api/ask (SSE) · /api/tts (SSE) · /api/letter · /api/health
lib/gnani.js       live-verified Prisma STT + Timbre TTS clients (chunk-repair for streamed WAV)
lib/llm.js         OpenAI-compatible streaming client (Evon via HF router) + degraded mode
lib/rag.js         keyword retrieval over corpus + grievance-intent + language-mix stats
lib/letter.js      hero artifact: formal Hindi grievance letter (template + LLM JSON), print-to-PDF
corpus/schemes.json  6 schemes × verified facts × official URLs (as_of 2026-11)
test/hinglish-test-set.json  15 code-mixed utterances for the Day-1 robustness gate
```

Keys never reach the browser — all Gnani calls are server-proxied, rate-limited.

## Guarantees baked in (from the LLM Council review — verdict 9/10)

- ✅ `getUserMedia` runs with `echoCancellation/noiseSuppression/autoGainControl: false` — the mandi noise *genuinely* reaches Prisma (the silent demo-killer the council caught)
- ✅ Noise is **digitally mixed** into the recorded stream — provable on camera, no speaker trickery
- ✅ Out-of-scope questions get the scripted honest answer ("I cover 6 verified schemes…") — hallucination defense made visible
- ✅ Every answer cites the corpus entry **and** links the official .gov.in page
- ✅ Letters use **synthetic identity only** (Ram Kumar, Rampur) — hackathon synthetic-data rule respected
- ✅ Stats strip counts **test calls**, not fake "calls handled"
- ✅ Degraded mode: no LLM key → retrieval-only answers, demo never hard-fails on stage

## Team & contributions (editable until submission)

| Member | Contribution |
|---|---|
| **<YOUR NAME>** | Voice pipeline (Prisma STT + Timbre TTS integration), WebAudio noise-mixing, RAG corpus, letter generator, deployment |
| **<TEAMMATE NAME>** | *(add your teammate's real contribution before submitting)* |

## Demo video (60-sec) — see `docs/VIDEO_SCRIPT.md`
Submission form answers — see `docs/SUBMISSION.md`

---
*Synthetic demo · no real personal data · verify scheme details at official links before acting.*
