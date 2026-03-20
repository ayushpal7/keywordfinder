export async function onRequestPost(context) {
  const { request: req, env } = context;

  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  try {
    const body = await req.json();
    const { keyword, country, type, count, turnstileToken } = body;

    // ── 1. TURNSTILE VERIFICATION ──
    if (!turnstileToken) {
      return new Response(JSON.stringify({ error: 'Please complete the CAPTCHA before searching.' }), {
        status: 403, headers: cors
      });
    }

    const ip = req.headers.get('CF-Connecting-IP') || '';
    const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET_KEY,
        response: turnstileToken,
        remoteip: ip,
      }),
    });

    const verify = await verifyRes.json();
    if (!verify.success) {
      return new Response(JSON.stringify({ error: 'CAPTCHA failed. Please refresh and try again.' }), {
        status: 403, headers: cors
      });
    }

    // ── 2. VALIDATE INPUT ──
    if (!keyword || keyword.length > 200) {
      return new Response(JSON.stringify({ error: 'Invalid keyword. Max 200 characters.' }), {
        status: 400, headers: cors
      });
    }

    const countryNames = {
      US:'United States', IN:'India', UK:'United Kingdom',
      AU:'Australia', CA:'Canada', DE:'Germany',
      FR:'France', BR:'Brazil', SG:'Singapore', AE:'UAE'
    };

    const typeMap = {
      all: 'Mix of head terms, mid-tail, long-tail, questions, and buying intent keywords.',
      questions: 'Focus on question keywords: how, what, why, when, where, who, which, can, does, is, are.',
      longtail: 'Focus on long-tail keywords (4+ words) with lower competition.',
      buying: 'Focus on transactional keywords: best, buy, price, review, vs, alternative, cheap, discount, near me.'
    };

    const cName = countryNames[country] || 'India';

    const prompt = `You are an expert SEO keyword research analyst.
Generate exactly ${count || 50} keyword suggestions for: "${keyword}"
Target market: ${cName} (${country || 'IN'})
Focus: ${typeMap[type || 'all']}

Return ONLY valid JSON, no markdown, no explanation:
{
  "seed": "${keyword}",
  "country": "${country || 'IN'}",
  "total_volume": <integer>,
  "avg_kd": <integer 0-100>,
  "keywords": [
    {
      "keyword": "phrase",
      "volume": <realistic integer for ${cName}>,
      "kd": <0-100>,
      "cpc": <USD float>,
      "intent": <"Informational"|"Commercial"|"Transactional"|"Navigational">,
      "competition": <"Low"|"Medium"|"High">,
      "trend": [<8 integers 1-10>],
      "parent_topic": "2-3 word cluster"
    }
  ],
  "clusters": [{ "name": "name", "keywords": ["kw1","kw2","kw3","kw4"] }]
}

Rules:
- Volumes realistic for ${cName}: head terms 1000-100000, mid-tail 200-5000, long-tail 10-500
- KD correlates with volume
- CPC higher for commercial/transactional intent
- Include 3-6 topic clusters`;

    // ── 3. PRIMARY: GEMINI (free, 1500/day) ──
    let result = null;
    let lastErr = '';

    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 4000 }
          })
        }
      );
      const d = await r.json();
      if (d.candidates?.[0]?.content?.parts?.[0]?.text) {
        const clean = d.candidates[0].content.parts[0].text.replace(/```json|```/g, '').trim();
        result = JSON.parse(clean);
      } else {
        lastErr = d.error?.message || 'Gemini: no content';
      }
    } catch(e) { lastErr = 'Gemini: ' + e.message; }

    // ── 4. FALLBACK: GROQ (free, 14400/day) ──
    if (!result) {
      try {
        const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.GROQ_API_KEY}`
          },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
              { role: 'system', content: 'Expert SEO analyst. Respond ONLY with valid JSON. No markdown.' },
              { role: 'user', content: prompt }
            ],
            temperature: 0.7,
            max_tokens: 4000,
          })
        });
        const d = await r.json();
        if (d.choices?.[0]?.message?.content) {
          const clean = d.choices[0].message.content.replace(/```json|```/g, '').trim();
          result = JSON.parse(clean);
        } else {
          lastErr = d.error?.message || 'Groq: no content';
        }
      } catch(e) { lastErr = 'Groq: ' + e.message; }
    }

    if (!result) {
      return new Response(JSON.stringify({ error: 'AI unavailable. Try again. (' + lastErr + ')' }), {
        status: 500, headers: cors
      });
    }

    return new Response(JSON.stringify(result), { headers: cors });

  } catch(err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: cors
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  });
}
