# सेवा साथी · Seva Saathi

> **The voice helpline that ends with a government letter, not just an answer.**
> Great Indian AI Internship Challenge · built on Gnani AI Prisma v2.5 + Timbre v2.5 + Evon v3.3

---

## The problem

India's welfare programs reach citizens through portals and PDFs that assume literacy, typing, and English. A farmer can *talk* — but nothing turns a spoken question in Hindi/Hinglish into an answered query **and** a filed application. Entitlements go unclaimed at the last mile, where the problem is language, not policy.

## The solution

**Seva Saathi** is a phone-call-style web experience. The user speaks Hindi or Hinglish — even with market noise around them:

1. **Listen** — Gnani **Prisma v2.5** transcribes code-mixed speech (`indic-auto` multilingual Hindi+English model, ITN for ₹ amounts and dates; live-tested at 350–900 ms).
2. **Answer with receipts** — an LLM brain (**Evon v3.3** via Hugging Face router) answers *strictly* from a hand-verified corpus of 6 schemes (PM-KISAN, Ayushman Bharat PM-JAY, PM Awas Gramin, Atal Pension, e-Shram, MGNREGA). Every answer shows a citation chip linking the official `.gov.in` source. Out-of-scope questions get a scripted honest refusal — hallucination defense made visible.
3. **Speak** — Gnani **Timbre v2.5** replies in natural Hindi voice, SSE-streamed and played gaplessly.
4. **Act** — the call ends with the hero artifact: an auto-drafted **formal grievance/application letter** (print → submit at the panchayat/CSC) plus an SMS-style summary with a reference ID.

**मंडी मोड (market-noise mode):** market ambience is *digitally mixed into the mic stream* with browser echo-cancellation disabled — so Prisma transcribing Hinglish through the noise is live, on-camera proof, not a claim.

## Why it fits the challenge

- **Real Deal** — closes the loop from voice → structured action → a document a citizen can physically file.
- **Noise Canceller** — provable noise demo built into the product.
- **Mixed Vibes / Main Character** — end-to-end Hinglish code-mixed pipeline, Hindi-first voice UI.
- **Demo Day Drop** — the 60-second video opens on the noise moment (see `docs/VIDEO_SCRIPT.md`).

## Safety & honesty

Synthetic identity only (Ram Kumar, Rampur; masked sample ID). No real phone numbers, Aadhaar, PAN, or recorded calls. The stats strip counts real test calls from the demo device. API keys stay server-side; the public app is rate-limited.

## Links

- Demo video: `<paste LinkedIn/X post URL after recording>`
- Live app: `<paste deployed URL after deploy>`
- One-minute flow: open the app → tap a scheme chip → call → hold-to-talk → end call → पत्र बनाएं.

## Team & contributions

| Member | Contribution |
|---|---|
| `<YOUR NAME>` | Voice pipeline (Prisma STT + Timbre TTS integration, streamed chunk repair), WebAudio noise-mixing graph, RAG corpus, letter generator, deployment |
| `<TEAMMATE NAME>` | `<add real contribution before submitting>` |

---
*Seva Saathi — आवाज़ से जानकारी, जानकारी से काम।*
