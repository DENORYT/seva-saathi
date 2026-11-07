// Grievance / application letter generator — the demo's hero artifact.
// Voice → structured action. Template + LLM-filled fields (synthetic identity only,
// per hackathon rules: no real phone numbers / Aadhaar / PAN / recorded calls).
'use strict';
const { chatJson } = require('./llm');
const { SCHEMES, guessSchemeKey, isGrievanceIntent } = require('./rag');

const SYNTHETIC = {
  name_hi: 'राम कुमार',
  name_en: 'Ram Kumar',
  village_hi: 'रामपुर',
  district_hi: 'सीतापुर',
  aadhaar_note: 'XXXX-XXXX (सैंपल / sample)',
};

async function extractFields(transcript, answer) {
  // LLM path — best quality
  if (chatJsonEnabled()) {
    try {
      const j = await chatJson([
        { role: 'system', content: 'You extract structured fields for a formal Indian government grievance letter. Reply ONLY with JSON.' },
        {
          role: 'user',
          content: `कॉल में ग्राहक ने कहा: "${transcript}"\nएजेंट का उत्तर: "${answer}"\n\nयोजनाएँ: ${SCHEMES.map((s) => s.key + '=' + s.name_en).join(', ')}\n\nJSON fields: scheme_key (one of the keys or "general"), subject_hi (10 words max), issue_hi (2 sentences), request_hi (1 sentence). All Hindi values in Devanagari.`,
        },
      ]);
      if (j && j.subject_hi) return { source: 'llm', ...j };
    } catch (_) { /* fall through to heuristic */ }
  }
  // Heuristic fallback
  const key = guessSchemeKey(transcript + ' ' + answer);
  const scheme = SCHEMES.find((s) => s.key === key);
  return {
    source: 'heuristic',
    scheme_key: key || 'general',
    subject_hi: scheme ? `${scheme.name_hi} से संबंधित शिकायत` : 'योजना से संबंधित शिकायत',
    issue_hi: transcript ? `शिकायतकर्ता ने हेल्पलाइन पर बताया: "${transcript.slice(0, 180)}"` : 'विवरण हेल्पलाइन कॉल में दर्ज है।',
    request_hi: 'कृपया संबंधित विभाग से जांच करवाकर लाभ/भुगतान शीघ्र दिलवाने की कृपा करें।',
  };
}

function chatJsonEnabled() {
  try { return Boolean(process.env.LLM_API_KEY && process.env.LLM_MODEL); } catch (_) { return false; }
}

function buildLetterHtml(fields) {
  const scheme = SCHEMES.find((s) => s.key === fields.scheme_key);
  const dept = scheme ? scheme.name_en : 'संबंधित विभाग / Concerned Department';
  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
  const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<!doctype html><html lang="hi"><head><meta charset="utf-8">
<title>Seva Saathi — शिकायत/आवेदन पत्र</title>
<style>
  body{font-family:'Noto Sans Devanagari',serif;max-width:720px;margin:40px auto;padding:0 24px;color:#111;line-height:1.7}
  .head{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #1a5c2a;padding-bottom:12px;margin-bottom:24px}
  .brand{font-size:22px;font-weight:700;color:#1a5c2a}
  .tag{font-size:12px;color:#666}
  .meta{font-size:13px;color:#555;margin-bottom:20px}
  .meta b{color:#111}
  h2{font-size:18px;margin:0 0 12px}
  .sign{margin-top:40px}
  .foot{margin-top:36px;border-top:1px dashed #bbb;padding-top:10px;font-size:11px;color:#888}
  @media print{.noprint{display:none}}
</style></head><body>
<div class="head"><div><div class="brand">सेवा साथी / Seva Saathi</div><div class="tag">AI सहायता हेल्पलाइन द्वारा निर्मित पत्र · Generated on a synthetic demo call</div></div>
<div class="tag">दिनांक/Date: ${today}</div></div>

<div class="meta">
  सेवा में / To,<br><b>${esc(dept)}</b><br>
  जिला कार्यालय / District Office<br>
  जिला: ${esc(SYNTHETIC.district_hi)}
</div>

<h2>विषय: ${esc(fields.subject_hi)}</h2>

<p>महोदय/महोदया,</p>
<p>मैं, <b>${esc(SYNTHETIC.name_hi)} (${esc(SYNTHETIC.name_en)})</b>, निवासी ग्राम ${esc(SYNTHETIC.village_hi)}, जिला ${esc(SYNTHETIC.district_hi)}, निम्नलिखित विषय के संबंध में आवेदन/शिकायत दर्ज करवाना चाहता/चाहती हूँ:</p>
<p>${esc(fields.issue_hi)}</p>
<p>${esc(fields.request_hi)}</p>
<p>संलग्न: आधार प्रमाण (${esc(SYNTHETIC.aadhaar_note)}), पात्रता दस्तावेज़ (सैंपल)।</p>

<div class="sign">
  <p>भवदीय,<br><b>${esc(SYNTHETIC.name_hi)}</b><br>
  ग्राम ${esc(SYNTHETIC.village_hi)}, जिला ${esc(SYNTHETIC.district_hi)}<br>
  (सिंथेटिक पहचान — डेमो उद्देश्य / synthetic identity for demo)</p>
</div>

<div class="foot">यह पत्र "सेवा साथी" (Gnani AI Prisma STT + LLM + Timbre TTS) द्वारा एक सिंथेटिक कॉल से स्वतः तैयार किया गया। प्रस्तुत करने से पहले विवरण जांच लें। हैकथॉन डेमो — कोई वास्तविक व्यक्तिगत डेटा उपयोग नहीं हुआ।</div>
<div class="noprint" style="margin-top:24px;text-align:center"><button onclick="window.print()" style="padding:10px 24px;font-size:14px;cursor:pointer">🖨️ प्रिंट / PDF सेव करें</button></div>
</body></html>`;
}

function smsSummary(fields) {
  const scheme = SCHEMES.find((s) => s.key === fields.scheme_key);
  const name = scheme ? scheme.name_en : 'Scheme';
  return `सेवा साथी: आपकी शिकायत (${name}) दर्ज हो गई है। पत्र तैयार है — पंचायत/सीएससी में जमा करें। संदर्भ: SS-${Date.now().toString().slice(-6)}। [सैंपल डेमो संदेश]`;
}

/** Generate { html, sms, fields } — never throws; always returns a letter. */
async function generateLetter(transcript, answer) {
  const intent = isGrievanceIntent(transcript || answer);
  const fields = await extractFields(transcript, answer);
  return { html: buildLetterHtml(fields), sms: smsSummary(fields), fields, intent_detected: intent };
}

module.exports = { generateLetter };
