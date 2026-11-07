# Submission form answers (copy-paste ready — edit names/links before submitting)

## Title
**सेवा साथी · Seva Saathi — the voice helpline that ends with a government letter, not just an answer**

## The problem
India's rural citizens lose entitlements not because schemes don't exist but because the last
mile is a language and literacy problem: scheme rules live in English/Hindi documents, portals
assume typing, and helplines are IVR menus. A farmer with a phone can *talk* — nothing lets that
talk become answered questions AND a filed application.

## Our solution
A web-based phone-call experience: the user speaks Hindi/Hinglish (even with market noise around
them), Seva Saathi transcribes it with Prisma v2.5, answers from a hand-verified corpus of 6 major
schemes with on-screen citations to official .gov.in sources, speaks the answer in natural Hindi
via Timbre v2.5, and generates a formal grievance/application letter the citizen can print and
submit. A "मंडी मोड" (market-noise mode) demo proves Prisma's noise robustness live: noise is
digitally mixed into the mic stream and transcription still holds.

## Users
Rural citizens navigating PM-KISAN, Ayushman Bharat PM-JAY, PM Awas (Gramin), Atal Pension,
e-Shram, and MGNREGA — plus the CSC/panchayat volunteers who help them.

## Gnani AI models used
- **Prisma v2.5/v3.0 (STT)** — `indic-auto` multilingual Hindi+English model for code-mixed
  Hinglish queries, ITN (`format=transcribe`) for ₹/dates, live-tested at ~350–900ms latency.
- **Timbre v2.5 (TTS)** — Hindi speech via SSE streaming (`timbre-v2.5`), chunks re-wrapped
  server-side for gapless WebAudio playback.
- **Evon v3.3 (LLM)** — brain over the RAG corpus via Hugging Face router
  *(confirm the exact model id you used before submitting)*.

## Member contributions  (EDIT BEFORE SUBMITTING)
- **<YOUR NAME>:** end-to-end voice pipeline (Prisma STT + Timbre TTS integration with streamed
  chunk repair), WebAudio architecture with browser echo-cancellation disabled and digital
  noise-mixing, RAG corpus + retrieval, grievance-letter generator, server-side key proxying,
  rate limiting, degraded-mode fallbacks.
- **<TEAMMATE NAME>:** *(their real contribution — be specific, teammates are interviewed
  separately)*

## Honest-use / rules compliance
- Synthetic data only: letters use a synthetic identity (Ram Kumar, Rampur; Aadhaar masked as
  sample). No real phone numbers, Aadhaar, PAN, or recorded calls.
- Stats strip counts real "test calls" from this device only.
- No purchased engagement; the demo post uses a value-exchange ask (comment a scheme name →
  get the letter your question generates).

## Links to attach
- Deployed app: *(add after deploy)*
- Demo video: *(LinkedIn + X URLs after posting)*
- GitHub: *(add if you publish — remember to remove .env!)*

## Interview prep — the 5 probes we rehearsed
1. **"Your LLM is a swap-in layer — where's YOUR contribution?"** → The RAG corpus verification,
   citation UI, latency engineering (streaming STT→sentence→TTS pipeline), the noise-mixing
   WebAudio graph, and the voice→letter artifact are the contribution; the LLM is deliberately
   replaceable, which is the platform story.
2. **"What if it hallucinates a scheme amount?"** → It can't invent amounts: retrieval-only
   context + 6 hand-verified entries + on-screen citations + scripted out-of-scope refusal.
3. **"Is the noise demo real?"** → Browser EC/NS/AGC disabled in getUserMedia; ambience is
   digitally mixed into the recorded WAV (show the code path); noise-compare box shows exactly
   what Prisma heard.
4. **"Why only 6 schemes?"** → Verified depth beats shallow breadth; the corpus is the only
   fixed cost — swapping it scales the same pipeline to any vertical.
5. **"How does this reach a real farmer?"** → Post-demo path: SMS summary + CSC volunteer mode;
   the same pipeline is a NALSA legal-aid or health line with a corpus swap.
