// Hour-1 smoke test (council gate): live-test the Gnani key on BOTH APIs.
// Usage: node scripts/smoke-test.mjs
// STT: synthesizes a Hindi question via TTS, then transcribes it back — a real round-trip.
'use strict';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { sttRobust, ttsStream, makeWav, API_KEY } = require(join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'gnani.js'));

if (!API_KEY) {
  console.error('✗ GNANI_API_KEY missing — put it in .env');
  process.exit(1);
}

const SAMPLE = 'नमस्ते, पीएम किसान की किस्त कब आएगी?';

async function main() {
  console.log('⏳ 1/3 TTS: synthesizing →', SAMPLE);
  const chunks = [];
  for await (const wav of ttsStream(SAMPLE)) chunks.push(wav);
  console.log(`   ✓ TTS OK — ${chunks.length} WAV chunks`);

  // Extract PCM from each repaired WAV and concatenate into one file
  const { parseWav } = require(join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'gnani.js'));
  const pcms = [];
  let sr = 16000, ch = 1, bits = 16;
  for (const c of chunks) {
    const p = parseWav(c);
    if (p) { pcms.push(p.pcm); sr = p.fmt.sampleRate; ch = p.fmt.channels; bits = p.fmt.bitsPerSample; }
  }
  const totalLen = pcms.reduce((n, p) => n + p.length, 0);
  const pcm = Buffer.concat(pcms, totalLen);
  const wav = makeWav(pcm, sr, ch, bits);
  const tmp = join(dirname(fileURLToPath(import.meta.url)), 'roundtrip.wav');
  writeFileSync(tmp, wav);
  console.log(`   ✓ merged → ${tmp} (${(wav.length / 1024).toFixed(0)} KB, ${sr}Hz)`);

  console.log('⏳ 2/3 STT: transcribing the synthesized question back…');
  const out = await sttRobust(wav);
  console.log(`   ✓ STT OK — model=${out.model || 'n/a'} latency=${out.latency_ms}ms fallback=${out.fallback_used || 'no'}`);
  console.log(`   transcript: "${out.transcript}"`);

  const norm = (s) => (s || '').replace(/[\s।,.?!]/g, '');
  const target = norm(SAMPLE);
  const got = norm(out.transcript);
  const hit = ['किसान', 'किस्त'].filter((k) => out.transcript.includes(k));
  console.log(`⏳ 3/3 Round-trip check: keywords matched → [${hit.join(', ')}] (${hit.length}/2)`);

  try { unlinkSync(tmp); } catch (_) {}
  if (hit.length >= 1) {
    console.log('\n🎉 SMOKE TEST PASSED — Gnani key is live on Prisma + Timbre. Hour-1 gate cleared.');
  } else {
    console.log('\n⚠️  APIs responded but round-trip keywords missing — check audio config/lang settings.');
    process.exit(2);
  }
}

main().catch((e) => {
  console.error('\n✗ SMOKE TEST FAILED:', e.message);
  process.exit(1);
});
