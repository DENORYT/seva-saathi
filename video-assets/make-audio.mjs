// Generates narration + agent voice WAVs for the demo video via the app's own TTS pipeline.
// Usage: node video-assets/make-audio.mjs
'use strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join as pjoin, dirname } from 'node:path';
const require = createRequire(import.meta.url);
const __dirname2 = dirname(fileURLToPath(import.meta.url));
const fs = require('fs');
const path = { join: pjoin };
const { ttsStream, parseWav, makeWav } = require(pjoin(__dirname2, '..', 'lib', 'gnani.js'));

const OUT = path.join(__dirname2, 'audio');
fs.mkdirSync(OUT, { recursive: true });

const CLIPS = [
  // narration (Deepak)
  { file: 'n1_title.wav', voice: 'Deepak', text: 'सेवा साथी — एक ऐसी हेल्पलाइन, जहाँ आप सिर्फ़ बोलते हैं, और सरकारी योजना के सवाल का जवाब भी मिलता है, और जमा करने के लिए तैयार पत्र भी।' },
  { file: 'n1b_problem.wav', voice: 'Deepak', text: 'इंडिया की सबसे बड़ी योजनाएँ पोर्टल और कागज़ तक सीमित हैं — लिखना, टाइप करना, अंग्रेज़ी। गाँव का आदमी बोल सकता है, पर बोलकर आज तक सरकारी काम अधूरा रहता है।' },
  { file: 'n1c_how.wav', voice: 'Deepak', text: 'चार स्टेप। बोलिए — प्रिज्मा सुनेगा। पूछिए — ईवॉन, छह वेरिफाइड योजनाओं से जवाब देगा, सरकारी लिंक के साथ। सुनिए — टिम्बर हिंदी में बोलेगा। और पाइए — तैयार शिकायत पत्र।' },
  { file: 'n2_dialer.wav', voice: 'Deepak', text: 'यह ऐप ग्रामीण भारत के लिए बना है। छह बड़ी योजनाएँ — पीएम किसान, आयुष्मान भारत, आवास, पेंशन, ई-श्रम और मनरेगा। मंडी मोड ऑन कीजिए — मंडी के शोर के बीच भी ऐप आपकी बात सुन लेगा।' },
  { file: 'n3_letter.wav', voice: 'Deepak', text: 'कॉल खत्म, लेकिन काम बाकी है। बटन दबाइए — और देखिए, फॉर्मल शिकायत पत्र तैयार। प्रिंट कीजिए, और पंचायत में जमा कर दीजिए। एसएमएस सारांश भी मिल गया।' },
  { file: 'n4_noise.wav', voice: 'Deepak', text: 'और देखिए — मंडी के शोर के बीच भी एजेंट ने आपकी हिंग्लिश बिल्कुल सही पकड़ी। यही तो असली टेस्ट है।' },
  { file: 'n5_outro.wav', voice: 'Deepak', text: 'यह सिर्फ़ छह योजनाएँ नहीं — हर वॉइस वर्टिकल का टेम्पलेट है। कॉर्पस बदलिए, वही पाइपलाइन कृषि, कानूनी सहायता या स्वास्थ्य हेल्पलाइन बन जाती है। सेवा साथी — आवाज़ से जानकारी, जानकारी से काम।' },
];

// agent lines (Kaveri) — greeting is the app's fixed greeting; answer is fetched live
const GREETING = 'नमस्ते! सेवा साथी में आपका स्वागत है। मैं पीएम किसान, आयुष्मान भारत, आवास योजना, अटल पेंशन, ई-श्रम और मनरेगा के बारे में बता सकती हूँ। आप क्या जानना चाहते हैं?';
const Q1 = 'पीएम किसान की किस्त नहीं आई है, क्या करूँ?'; // exact chip-1 preset the recording clicks

async function synth(text, voice, outFile) {
  const chunks = [];
  for await (const w of ttsStream(text, { voice })) chunks.push(w);
  const pcms = []; let sr = 16000, ch = 1, bits = 16;
  for (const c of chunks) {
    const p = parseWav(c);
    if (p) { pcms.push(p.pcm); sr = p.fmt.sampleRate; ch = p.fmt.channels; bits = p.fmt.bitsPerSample; }
  }
  const wav = makeWav(Buffer.concat(pcms), sr, ch, bits);
  fs.writeFileSync(path.join(OUT, outFile), wav);
  return { file: outFile, kb: (wav.length / 1024).toFixed(0), secs: (pcmLen(pcms) / (sr * ch * 2)).toFixed(1) };
}
function pcmLen(pcms) { return pcms.reduce((n, p) => n + p.length, 0); }

async function fetchAnswer() {
  const res = await fetch('http://localhost:8787/api/ask', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transcript: Q1 }),
  });
  const raw = await res.text();
  // parse SSE done event
  let answer = null;
  for (const frame of raw.split('\n\n')) {
    const m = frame.match(/^event: done\ndata: (.+)$/m);
    if (m) answer = JSON.parse(m[1]).answer;
  }
  if (!answer) throw new Error('no answer from /api/ask: ' + raw.slice(0, 200));
  return answer;
}

(async () => {
  const results = [];
  for (const c of CLIPS) results.push(await synth(c.text, c.voice, c.file));
  results.push(await synth(GREETING, 'Kaveri', 'agent_greeting.wav'));
  const answer = await fetchAnswer();
  console.log('live degraded answer =', JSON.stringify(answer));
  fs.writeFileSync(path.join(OUT, 'answer1.txt'), answer, 'utf8');
  results.push(await synth(answer, 'Kaveri', 'agent_answer1.wav'));
  for (const r of results) console.log(`  ✓ ${r.file}  ${r.kb} KB  ~${r.secs}s`);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
