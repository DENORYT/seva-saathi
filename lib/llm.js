// LLM brain — OpenAI-compatible chat completions with SSE streaming.
// Works with Evon v3.3 via Hugging Face router (LLM_BASE_URL=https://router.huggingface.co/v1)
// or any OpenAI-compatible endpoint (Groq/OpenRouter/z.ai/...). Graceful degraded mode
// (retrieval-only answers) when no key is configured, so the demo never hard-fails.
'use strict';

function cfg() {
  return {
    baseUrl: (process.env.LLM_BASE_URL || 'https://router.huggingface.co/v1').replace(/\/+$/, ''),
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || '',
  };
}

function llmConfigured() {
  const c = cfg();
  return Boolean(c.apiKey && c.model);
}

const SYSTEM_PROMPT = `तुम "सेवा साथी" हो — सरकारी योजनाओं की हेल्पलाइन वॉइस एजेंट। नियम:
1. सिर्फ़ नीचे दिए गए CONTEXT से ही उत्तर दो। अपनी ओर से कोई तथ्य न जोड़ो।
2. उत्तर आसान हिंदी (देवनागरी) में दो — गाँव के आम आदमी की भाषा। आम अंग्रेज़ी शब्द (जैसे कार्ड, बैंक) हिंदी-लिपि में या ज्यों के त्यों ठीक हैं।
3. अधिकतम 3 छोटे वाक्य। यह बोलकर सुनाया जाएगा, इसलिए सीधा और सरल उत्तर दो।
4. अगर सवाल CONTEXT की योजनाओं से बाहर है, तो विनम्रता से बताओ: "मैं अभी सिर्फ़ इन छह योजनाओं की जानकारी देती हूँ — पीएम किसान, आयुष्मान भारत, पीएम आवास, अटल पेंशन, ई-श्रम और मनरेगा।" फिर उनमें से किसी से जुड़ा सवाल पूछने को कहो।
5. कभी भी बनावटी आंकड़े, तारीख़ या वादा न करो। अगर जानकारी CONTEXT में नहीं है तो ऑफिशियल लिंक या सीएससी/पंचायत जाने को कहो।`;

/** Stream chat completions. Yields text deltas. Throws if not configured. */
async function* chatStream(messages) {
  const { baseUrl, apiKey, model } = cfg();
  if (!apiKey || !model) throw new Error('LLM not configured');
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, stream: true, max_tokens: 400, temperature: 0.2 }),
  });
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => '');
    throw new Error(`LLM HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
  const dec = new TextDecoder();
  let buf = '';
  for await (const u8 of res.body) {
    buf += dec.decode(u8, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return;
      try {
        const j = JSON.parse(payload);
        const delta = j.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch (_) { /* partial JSON — wait for more */ }
    }
  }
}

/** Non-streaming one-shot JSON call (used by the letter generator). */
async function chatJson(messages) {
  const { baseUrl, apiKey, model } = cfg();
  if (!apiKey || !model) throw new Error('LLM not configured');
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, stream: false, max_tokens: 500, temperature: 0.1 }),
  });
  if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
  const j = await res.json();
  const text = j.choices?.[0]?.message?.content || '';
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('LLM returned no JSON object');
  return JSON.parse(m[0]);
}

module.exports = { chatStream, chatJson, llmConfigured, SYSTEM_PROMPT };
