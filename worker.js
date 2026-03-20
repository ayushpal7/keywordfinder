export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ── CORS headers ──
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    // ── /api/health ──
    if (url.pathname === '/api/health') {
      const checks = {
        function_working: true,
        gemini_key_set: !!(env.GEMINI_API_KEY && env.GEMINI_API_KEY.length > 10),
        groq_key_set: !!(env.GROQ_API_KEY && env.GROQ_API_KEY.length > 10),
        turnstile_key_set: !!(env.TURNSTILE_SECRET_KEY && env.TURNSTILE_SECRET_KEY.length > 5),
        gemini_preview: env.GEMINI_API_KEY ? env.GEMINI_API_KEY.slice(0,8)+'...' : 'NOT SET',
        groq_preview: env.GROQ_API_KEY ? env.GROQ_API_KEY.slice(0,8)+'...' : 'NOT SET',
        turnstile_preview: env.TURNSTILE_SECRET_KEY ? env.TURNSTILE_SECRET_KEY.slice(0,6)+'...' : 'NOT SET',
      };
      const allGood = checks.gemini_key_set && checks.groq_key_set && checks.turnstile_key_set;
      return new Response(JSON.stringify({ status: allGood ? 'OK ✅' : 'MISSING ENV VARS ❌', checks }, null, 2), { headers: cors });
    }

    // ── /api/keywords ──
    if (url.pathname === '/api/keywords' && request.method === 'POST') {
      try {

        // Check env vars
        if (!env.GEMINI_API_KEY && !env.GROQ_API_KEY) {
          return new Response(JSON.stringify({
            error: 'GEMINI_API_KEY and GROQ_API_KEY are not set. Go to Cloudflare Worker > Settings > Variables and add them.'
          }), { status: 500, headers: cors });
        }

        let body;
        try { body = await request.json(); }
        catch(e) { return new Response(JSON.stringify({ error: 'Invalid JSON body: ' + e.message }), { status: 400, headers: cors }); }

        const { keyword, country, type, count, platform, turnstileToken } = body;

        // Turnstile verification
        if (env.TURNSTILE_SECRET_KEY) {
          if (!turnstileToken) {
            return new Response(JSON.stringify({ error: 'Please complete the CAPTCHA before searching.' }), { status: 403, headers: cors });
          }
          try {
            const ip = request.headers.get('CF-Connecting-IP') || '';
            const vr = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: turnstileToken, remoteip: ip }),
            });
            const v = await vr.json();
            if (!v.success) {
              return new Response(JSON.stringify({ error: 'CAPTCHA failed. Please refresh and try again.' }), { status: 403, headers: cors });
            }
          } catch(e) {
            return new Response(JSON.stringify({ error: 'CAPTCHA error: ' + e.message }), { status: 500, headers: cors });
          }
        }

        // Validate keyword
        if (!keyword || typeof keyword !== 'string' || keyword.trim().length === 0) {
          return new Response(JSON.stringify({ error: 'Please enter a keyword.' }), { status: 400, headers: cors });
        }

        const kw = keyword.trim().slice(0, 200);
        const countryNames = { US:'United States',IN:'India',UK:'United Kingdom',AU:'Australia',CA:'Canada',DE:'Germany',FR:'France',BR:'Brazil',SG:'Singapore',AE:'UAE' };
        const typeMap = {
          all:'Mix of head terms, mid-tail, long-tail, questions, and buying intent keywords.',
          questions:'Focus on question keywords: how, what, why, when, where, who, which, can, does, is, are.',
          longtail:'Focus on long-tail keywords (4+ words) with lower competition.',
          buying:'Focus on transactional keywords: best, buy, price, review, vs, alternative, cheap, discount, near me.'
        };
        const platformMap = {
          google:'Google Search — standard web search keywords',
          youtube:'YouTube — video search keywords, include "how to", "tutorial", "review", "watch"',
          amazon:'Amazon — product search keywords, product names, brands, buying modifiers',
          bing:'Bing Search — web search, informational focus',
          instagram:'Instagram — hashtag and discovery keywords, short lifestyle phrases',
          tiktok:'TikTok — trending short-form video keywords, viral topics, Gen Z',
          pinterest:'Pinterest — visual discovery, DIY, recipes, home decor, fashion',
          playstore:'Google Play Store — app keywords, "app", "free", "best app for", feature-based'
        };

        const cName = countryNames[country] || 'India';
        const pName = platformMap[platform] || platformMap['google'];
        const kwCount = parseInt(count) || 50;

        const prompt = `You are an expert SEO keyword research analyst.
Generate exactly ${kwCount} keyword suggestions for: "${kw}"
Target market: ${cName} (${country || 'IN'})
Platform: ${pName}
Type: ${typeMap[type || 'all']}

Return ONLY valid JSON. Start with { end with }. No markdown. No backticks. No other text.

{
  "seed": "${kw}",
  "country": "${country || 'IN'}",
  "platform": "${platform || 'google'}",
  "total_volume": <integer>,
  "avg_kd": <integer 0-100>,
  "keywords": [
    {
      "keyword": "phrase",
      "volume": <integer for ${cName}>,
      "kd": <integer 0-100>,
      "cpc": <float USD, 0 for YouTube/TikTok/Instagram/Pinterest>,
      "intent": <"Informational"|"Commercial"|"Transactional"|"Navigational">,
      "competition": <"Low"|"Medium"|"High">,
      "trend": [<exactly 8 integers 1-10>],
      "parent_topic": "<2-3 word cluster>"
    }
  ],
  "clusters": [{ "name": "<n>", "keywords": ["kw1","kw2","kw3","kw4"] }]
}
Rules: exactly ${kwCount} keywords. Realistic volumes for ${cName}. trend = exactly 8 numbers. 3-6 clusters.`;

        let result = null;
        let errors = [];

        // Try Gemini
        if (env.GEMINI_API_KEY) {
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
            if (r.ok) {
              const d = await r.json();
              const raw = d?.candidates?.[0]?.content?.parts?.[0]?.text || '';
              if (raw) {
                const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
                if (s !== -1 && e > s) {
                  try { result = JSON.parse(raw.slice(s, e + 1)); }
                  catch(pe) { errors.push('Gemini parse: ' + pe.message); }
                } else { errors.push('Gemini: no JSON found'); }
              } else { errors.push('Gemini: empty. Reason: ' + (d?.candidates?.[0]?.finishReason || 'unknown')); }
            } else { errors.push('Gemini HTTP ' + r.status); }
          } catch(e) { errors.push('Gemini: ' + e.message); }
        }

        // Try Groq fallback
        if (!result && env.GROQ_API_KEY) {
          try {
            const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.GROQ_API_KEY}` },
              body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [
                  { role: 'system', content: 'Expert SEO analyst. Respond ONLY with valid JSON. No markdown, no backticks. Start with { end with }.' },
                  { role: 'user', content: prompt }
                ],
                temperature: 0.7,
                max_tokens: 8000,
              })
            });
            if (r.ok) {
              const d = await r.json();
              const raw = d?.choices?.[0]?.message?.content || '';
              if (raw) {
                const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
                if (s !== -1 && e > s) {
                  try { result = JSON.parse(raw.slice(s, e + 1)); result._provider = 'groq'; }
                  catch(pe) { errors.push('Groq parse: ' + pe.message); }
                } else { errors.push('Groq: no JSON found'); }
              } else { errors.push('Groq: empty response'); }
            } else { errors.push('Groq HTTP ' + r.status); }
          } catch(e) { errors.push('Groq: ' + e.message); }
        }

        if (!result) {
          return new Response(JSON.stringify({
            error: 'Could not generate keywords. Please try again.',
            debug: errors.join(' | ')
          }), { status: 500, headers: cors });
        }

        if (!Array.isArray(result.keywords) || result.keywords.length === 0) {
          return new Response(JSON.stringify({
            error: 'AI returned invalid data. Please try again.',
            debug: 'keywords array empty'
          }), { status: 500, headers: cors });
        }

        return new Response(JSON.stringify(result), { headers: cors });

      } catch(fatal) {
        return new Response(JSON.stringify({
          error: 'Server error: ' + fatal.message
        }), { status: 500, headers: cors });
      }
    }

    // ── Serve static assets for everything else ──
    return env.ASSETS.fetch(request);
  }
};
