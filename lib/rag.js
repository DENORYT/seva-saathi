// Retrieval over the curated scheme corpus + language stats + intent detection.
// Deliberately dependency-free (keyword scoring over a tiny corpus is enough
// for 6 well-separated schemes and keeps the demo's latency budget intact).
'use strict';
const fs = require('fs');
const path = require('path');

const CORPUS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'corpus', 'schemes.json'), 'utf8'));
const SCHEMES = CORPUS.schemes;

const STOPWORDS = new Set([
  // English
  'the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for', 'do', 'does',
  'what', 'how', 'when', 'who', 'can', 'i', 'my', 'me', 'you', 'we', 'it', 'about', 'get', 'much',
  'many', 'want', 'know', 'tell', 'please', 'should', 'will', 'am', 'are', 'this', 'that', 'kya',
  // Hindi (Devanagari) + romanized Hindi
  'है', 'हैं', 'का', 'की', 'के', 'में', 'को', 'से', 'पर', 'और', 'क्या', 'कैसे', 'कितने', 'कितना',
  'मुझे', 'मेरा', 'मेरी', 'मेरे', 'आप', 'हम', 'यह', 'वह', 'करना', 'करे', 'करूं', 'चाहिए', 'नहीं',
  'बताओ', 'बताइए', 'जानना', 'बारे', 'लिए', 'क्यों', 'कब', 'कहां', 'कौन', 'होगा', 'होता', 'होती',
  'mujhe', 'mera', 'meri', 'mere', 'nahi', 'nahin', 'hai', 'hain', 'kya', 'kaise', 'kitna', 'kitne',
  'chahiye', 'batao', 'bataiye', 'ka', 'ki', 'ke', 'me', 'mein', 'se', 'par', 'aur', 'ek', 'do',
]);

// Unicode-aware tokenization: keeps Devanagari + Latin letters/digits
function tokenize(text) {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Score every scheme against a query. Multi-word keyword hits weigh most. */
function retrieve(query, topK = 2) {
  const q = ' ' + query.toLowerCase() + ' ';
  const qTokens = new Set(tokenize(query));
  const scored = SCHEMES.map((s) => {
    let score = 0;
    for (const kw of s.keywords) {
      if (q.includes(kw.toLowerCase())) score += kw.includes(' ') ? 5 : 3;
    }
    for (const t of tokenize(s.name_hi + ' ' + s.name_en + ' ' + s.summary_hi)) {
      if (qTokens.has(t)) score += 1;
    }
    for (const f of s.facts) {
      for (const t of tokenize(f.q_hi)) {
        if (qTokens.has(t)) score += 1;
      }
    }
    return { scheme: s, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, topK).filter((x) => x.score > 0);
  return { top, bestScore: scored[0].score };
}

/** Build the retrieval context block for the LLM. */
function buildContext(query) {
  const { top, bestScore } = retrieve(query, 2);
  if (!top.length) return { context: '', citations: [], matched: false, bestScore };
  const citations = top.map((t) => ({ key: t.scheme.key, name_hi: t.scheme.name_hi, name_en: t.scheme.name_en, official_url: t.scheme.official_url }));
  const context = top
    .map((t) => {
      const s = t.scheme;
      const facts = s.facts.map((f) => `  प्रश्न: ${f.q_hi}\n  उत्तर: ${f.a_hi}`).join('\n');
      return `## ${s.name_hi} (${s.name_en})\nसारांश: ${s.summary_hi}\nतथ्य:\n${facts}\nआधिकारिक लिंक: ${s.official_url}`;
    })
    .join('\n\n');
  return { context, citations, matched: true, bestScore };
}

/** Grievance / application intent (Hindi, Hinglish, English). */
const GRIEVANCE_RE = /(शिकायत|आवेदन|अर्ज़|अर्ज|पत्र|complaint|letter|apply|application|नहीं आई|नहीं मिल|गलत)/i;
function isGrievanceIntent(text) {
  return GRIEVANCE_RE.test(text || '');
}

/** Devanagari ratio → crude language-mix stat for the stats strip. */
function langMix(text) {
  const deva = (text.match(/[\u0900-\u097F]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  const total = deva + latin;
  return {
    devanagari_pct: total ? Math.round((deva / total) * 100) : 0,
    latin_pct: total ? Math.round((latin / total) * 100) : 0,
  };
}

/** Map a free-text query to a corpus key (used by the letter generator fallback). */
function guessSchemeKey(text) {
  const { top } = retrieve(text, 1);
  return top.length ? top[0].scheme.key : null;
}

module.exports = { SCHEMES, CORPUS, retrieve, buildContext, isGrievanceIntent, langMix, guessSchemeKey, tokenize };
