const http = require('http');
const fs = require('fs');
const path = require('path');

// Load .env manually — no packages needed
function loadEnv() {
  try {
    const lines = fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  } catch (_) {}
}
loadEnv();

const API_KEY = process.env.GEMINI_API_KEY;
const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY;
const PORT = process.env.PORT || 3000;

const SYSTEM_PROMPT = `You are a friendly and encouraging maths tutor for a Year 10 student studying Edexcel GCSE Maths (Pearson, specification 1MA1) at Higher tier. Their exam will be in May/June 2027.

Your role:
- Guide the student to understand concepts — don't just give answers
- Break problems into clear, numbered steps
- Use Edexcel-specific terminology and match Edexcel mark scheme language (e.g. "M1 for method", "A1 for accuracy", "B1 for a correct independent statement", "show your working")
- Encourage the student when they get things right
- Gently correct mistakes and explain why the method was wrong
- Use British spellings (factorise, recognise, colour, centre)

Edexcel Higher tier topics you cover:
- Number: integers, fractions, decimals, percentages, surds, standard form, indices, upper/lower bounds
- Algebra: expanding, factorising, solving equations and inequalities, simultaneous equations, quadratics (factorising, quadratic formula, completing the square), algebraic fractions, sequences (nth term, quadratic, geometric), functions (composite and inverse), iteration (finding approximate solutions), proof
- Ratio & Proportion: ratio, percentage change, compound interest/depreciation, direct and inverse proportion
- Geometry: angles, polygons, circle theorems, arc length, sector area, Pythagoras, trigonometry (SOH CAH TOA, sine rule, cosine rule), 3D shapes, vectors, transformations, similarity and congruence, area and volume
- Probability: basic probability, tree diagrams, Venn diagrams, conditional probability
- Statistics: mean/median/mode/range, frequency tables, cumulative frequency, box plots, histograms, scatter graphs and correlation

Teaching approach:
- Keep explanations concise — short and focused works better than long paragraphs
- When writing maths use clear notation: x^2 for squared, sqrt() for square root, use / for fractions
- If the student is stuck, ask a guiding question rather than revealing the answer
- Remind them of relevant Edexcel exam technique where appropriate (e.g. "always write the formula first — that gets you the method mark even if your arithmetic slips")
- The Edexcel Higher tier formula sheet GIVES you: circle area/circumference, Pythagoras, SOH CAH TOA, the quadratic formula, sine rule, cosine rule, area of a triangle (½ab sin C), compound interest, trapezium area, and prism volume — remind the student they don't need to memorise these, just look them up on the sheet. It does NOT give the equation of a straight line (y = mx + c) or the nth term formulae for arithmetic/quadratic sequences — flag clearly that these must be memorised.
- Be encouraging but realistic — focus on building genuine understanding, not shortcuts`;

async function callGemini(messages) {
  if (!API_KEY) throw new Error('GEMINI_API_KEY not set in .env');

  // Gemini uses "model" instead of "assistant" for the AI role
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  const body = JSON.stringify({
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  const response = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:streamGenerateContent?alt=sse',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-goog-api-key': API_KEY
      },
      body,
      signal: controller.signal
    }
  ).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${err}`);
  }

  return response;
}

// ---- Optional: natural cloud voice via ElevenLabs (only active if a key is set) ----

async function listElevenLabsVoices() {
  const response = await fetch('https://api.elevenlabs.io/v2/voices', {
    headers: { 'xi-api-key': ELEVENLABS_KEY }
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`ElevenLabs voices error ${response.status}: ${err}`);
  }
  const data = await response.json();
  return (data.voices || []).map(v => ({
    id: v.voice_id,
    name: v.name,
    gender: v.labels?.gender || '',
    accent: v.labels?.accent || ''
  }));
}

async function synthesizeSpeech(text, voiceId) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': ELEVENLABS_KEY
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0, speed: 1.0, use_speaker_boost: true }
      }),
      signal: controller.signal
    }
  ).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`ElevenLabs speech error ${response.status}: ${err}`);
  }
  return response;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');

  // CORS for local dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (pathname === '/' && req.method === 'GET') {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
    return;
  }

  // Static files (avatar models, extra pages) — locked to this folder, no dotfiles
  if (req.method === 'GET') {
    const types = {
      '.html': 'text/html', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg',
      '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
      '.json': pathname === '/manifest.json' ? 'application/manifest+json' : 'application/json'
    };
    const ext = path.extname(pathname).toLowerCase();
    const safe = path.normalize(pathname).replace(/^([/\\])+/, '');
    const full = path.join(__dirname, safe);
    if (types[ext] && full.startsWith(__dirname) && !safe.split(/[/\\]/).some(p => p.startsWith('.'))) {
      try {
        const data = fs.readFileSync(full);
        res.writeHead(200, { 'Content-Type': types[ext] });
        res.end(data);
        return;
      } catch (_) { /* fall through to 404 */ }
    }
  }

  if (pathname === '/voices' && req.method === 'GET') {
    if (!ELEVENLABS_KEY) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ configured: false, voices: [] }));
      return;
    }
    try {
      const voices = await listElevenLabsVoices();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ configured: true, voices }));
    } catch (err) {
      console.error('Error (voices):', err);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ configured: true, voices: [], error: 'Could not reach the natural voice service.' }));
    }
    return;
  }

  if (pathname === '/speak' && req.method === 'POST') {
    if (!ELEVENLABS_KEY) {
      res.writeHead(501, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Natural voice is not set up (no ELEVENLABS_API_KEY in .env).' }));
      return;
    }
    try {
      const raw = await readBody(req);
      const { text, voiceId } = JSON.parse(raw);
      if (!text || !voiceId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing text or voiceId.' }));
        return;
      }

      const speechRes = await synthesizeSpeech(text, voiceId);
      res.writeHead(200, { 'Content-Type': 'audio/mpeg' });

      const reader = speechRes.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    } catch (err) {
      console.error('Error (speak):', err);
      if (!res.headersSent) {
        let friendly = 'Could not generate the natural voice right now.';
        const msg = String(err.message || '');
        if (err.name === 'AbortError' || /aborted/i.test(msg)) {
          friendly = 'The natural voice took too long to respond.';
        } else if (/429|quota/i.test(msg)) {
          friendly = "We've used up this month's free natural-voice quota.";
        }
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: friendly }));
      }
    }
    return;
  }

  if (pathname === '/chat' && req.method === 'POST') {
    try {
      const raw = await readBody(req);
      const { messages } = JSON.parse(raw);
      const geminiRes = await callGemini(messages);

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });

      const reader = geminiRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const json = line.slice(6).trim();
          if (!json) continue;
          try {
            const chunk = JSON.parse(json);
            const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) res.write(`data: ${JSON.stringify({ token: text })}\n\n`);
          } catch (_) {}
        }
      }

      res.write('data: [DONE]\n\n');
      res.end();
    } catch (err) {
      console.error('Error:', err);
      if (!res.headersSent) {
        // Translate technical failures into something a student can act on
        let friendly = 'Something went wrong. Please try again.';
        const msg = String(err.message || '');
        if (err.name === 'AbortError' || /aborted/i.test(msg)) {
          friendly = "The tutor is taking too long to answer — it's probably very busy. Please try again in a minute.";
        } else if (/503|UNAVAILABLE|high demand|overloaded/i.test(msg)) {
          friendly = 'The tutor service is very busy right now. Please wait a minute and try again.';
        } else if (/429|quota|RESOURCE_EXHAUSTED/i.test(msg)) {
          friendly = "We've used up our free questions for now. Please try again a bit later.";
        } else if (/GEMINI_API_KEY/.test(msg)) {
          friendly = 'The tutor is not set up yet — the API key is missing from the .env file.';
        }
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: friendly }));
      }
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Maths Tutor running at http://localhost:${PORT}`);
  if (!API_KEY) console.warn('WARNING: GEMINI_API_KEY not set — add it to .env');
  if (!ELEVENLABS_KEY) console.log('Natural cloud voice is off (no ELEVENLABS_API_KEY in .env) — using the free browser voice.');
});
