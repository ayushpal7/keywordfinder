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
    const { keyword, country, type, count, platform, turnstileToken } = body;

    // 1. TURNSTILE
    if (!turnstileToken) {
      return new Response(JSON.stringify({ error: 'Please complete the CAPTCHA before searching.' }), { status: 403, headers: cors });
    }

    const ip = req.headers.get('CF-Connecting-IP') || '';
    const vr = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: turnstileToken, remoteip: ip }),
    });
    const v = await vr.json();
    if (!v.success) {
      return new Response(JSON.stringify({ error: 'CAPTCHA failed. Please refresh and try again.' }), { status: 403, headers: cors });
    }

    // 2. VALIDATE
    if (!keyword || keyword.length > 200) {
      return new Response(JSON.stringify({ error: 'Invalid keyword. Max 200 characters.' }), { status: 400, headers: cors });
    }

    const countryNames = { US:'United States',IN:'India',UK:'United Kingdom',AU:'Australia',CA:'Canada',DE:'Germany',FR:'France',BR:'Brazil',SG:'Singapore',AE:'UAE' };
    const typeMap = {
      all:'Mix of head terms, mid-tail, long-tail, questions, and buying intent keywords.',
      questions:'Focus on question keywords: how, what, why, when, where, who, which, can, does, is, are.',
      longtail:'Focus on long-tail keywords (4+ words) with lower competition.',
      buying:'Focus on transactional keywords: best, buy, price, review, vs, alternative, cheap, discount, near me.'
    };
    const platformMap = {
      google:'Google Search — standard web search keywords',
      youtube:'YouTube — video search keywords, include phrases like "how to", "tutorial", "review", "watch"',
      amazon:'Amazon — product search keywords, focus on product names, brands, specs, buying modifiers',
      bing:'Bing Search — web search keywords, slightly older demographic, more informational',
      instagram:'Instagram — hashtag and discovery keywords, short punchy phrases, lifestyle and visual topics',
      tiktok:'TikTok — trending short-form video keywords, viral topics, challenges, Gen Z content',
      pinterest:'Pinterest — visual discovery keywords, DIY, recipes, home decor, fashion, inspiration',
      playstore:'Google Play Store — app search keywords, include "app", "free", "best app for", feature-based searches'
    };

    const cName = countryNames[country] || 'India';
    const pName = platformMap[platform] || platformMap['google'];

    const prompt = `You are an expert SEO and keyword research analyst.
Generate exactly ${count || 50} keyword suggestions for: "${keyword}"
Target market: ${cName} (${country || 'IN'})
Target platform: ${pName}
Keyword type: ${typeMap[type || 'all']}

CRITICAL: Return ONLY a valid JSON object. No markdown. No backticks. No extra text. Start with { and end with }.

{
  "seed": "${keyword}",
  "country": "${country || 'IN'}",
  "platform": "${platform || 'google'}",
  "total_volume": <integer>,
  "avg_kd": <integer 0-100>,
  "keywords": [
    {
      "keyword": "phrase",
      "volume": <integer>,
      "kd": <integer 0-100>,
      "cpc": <float USD>,
      "intent": <"Informational"|"Commercial"|"Transactional"|"Navigational">,
      "competition": <"Low"|"Medium"|"High">,
      "trend": [<8 integers 1-10>],
      "parent_topic": "<2-3 word cluster>"
    }
  ],
  "clusters": [{ "name": "<name>", "keywords": ["kw1","kw2","kw3","kw4"] }]
}

Rules: ${count || 50} keywords total. Volumes realistic for ${cName}. CPC=0 for YouTube/TikTok/Instagram/Pinterest. Trend must have exactly 8 numbers. Include 3-6 clusters.`;

    let result = null;
    let lastErr = '';

    // 3. GEMINI PRIMARY
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 8192, responseMimeType: 'application/json' }
          })
        }
      );
      if (!r.ok) {
        lastErr = `Gemini HTTP ${r.status}`;
      } else {
        const d = await r.json();
        const raw = d.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (!raw) {
          lastErr = `Gemini empty. Reason: ${d.candidates?.[0]?.finishReason || 'unknown'}`;
        } else {
          const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
          if (s !== -1 && e !== -1) result = JSON.parse(raw.slice(s, e + 1));
          else lastErr = 'Gemini: no JSON in response';
        }
      }
    } catch(e) { lastErr = 'Gemini: ' + e.message; }

    // 4. GROQ FALLBACK
    if (!result) {
      try {
        const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.GROQ_API_KEY}` },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
              { role: 'system', content: 'Expert SEO analyst. Respond ONLY with valid JSON. No markdown. No backticks. Start with { end with }.' },
              { role: 'user', content: prompt }
            ],
            temperature: 0.7,
            max_tokens: 8000,
          })
        });
        if (!r.ok) {
          lastErr += ` | Groq HTTP ${r.status}`;
        } else {
          const d = await r.json();
          const raw = d.choices?.[0]?.message?.content || '';
          if (!raw) {
            lastErr += ' | Groq: empty response';
          } else {
            const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
            if (s !== -1 && e !== -1) {
              result = JSON.parse(raw.slice(s, e + 1));
              result._provider = 'groq';
            } else {
              lastErr += ' | Groq: no JSON in response';
            }
          }
        }
      } catch(e) { lastErr += ' | Groq: ' + e.message; }
    }

    if (!result) {
      return new Response(JSON.stringify({ error: 'AI unavailable. Please try again in a moment.', debug: lastErr }), { status: 500, headers: cors });
    }

    if (!result.keywords || !Array.isArray(result.keywords) || result.keywords.length === 0) {
      return new Response(JSON.stringify({ error: 'Invalid AI response. Please try again.', debug: 'Empty keywords array' }), { status: 500, headers: cors });
    }

    return new Response(JSON.stringify(result), { headers: cors });

  } catch(err) {
    return new Response(JSON.stringify({ error: 'Server error: ' + err.message }), { status: 500, headers: cors });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }
  });
}
