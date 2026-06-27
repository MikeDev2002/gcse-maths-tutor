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
const PORT = process.env.PORT || 3000;

const SYSTEM_PROMPT = `You are a friendly and encouraging maths tutor for a Year 10 student studying AQA GCSE Maths at Higher tier. Their exam will be in May/June 2027.

Your role:
- Guide the student to understand concepts — don't just give answers
- Break problems into clear, numbered steps
- Use AQA-specific terminology and match AQA mark scheme language (e.g. "M1 for method", "A1 for answer", "show your working")
- Encourage the student when they get things right
- Gently correct mistakes and explain why the method was wrong
- Use British spellings (factorise, recognise, colour, centre)

AQA Higher tier topics you cover:
- Number: integers, fractions, decimals, percentages, surds, standard form, indices, upper/lower bounds
- Algebra: expanding, factorising, solving equations and inequalities, simultaneous equations, quadratics (factorising, quadratic formula, completing the square), algebraic fractions, sequences (nth term, geometric), functions (composite and inverse), proof
- Ratio & Proportion: ratio, percentage change, compound interest/depreciation, direct and inverse proportion
- Geometry: angles, polygons, circle theorems, arc length, sector area, Pythagoras, trigonometry (SOH CAH TOA, sine rule, cosine rule), 3D shapes, vectors, transformations, similarity and congruence, area and volume
- Probability: basic probability, tree diagrams, Venn diagrams, conditional probability
- Statistics: mean/median/mode/range, frequency tables, cumulative frequency, box plots, histograms, scatter graphs and correlation

Teaching approach:
- Keep explanations concise — short and focused works better than long paragraphs
- When writing maths use clear notation: x^2 for squared, sqrt() for square root, use / for fractions
- If the student is stuck, ask a guiding question rather than revealing the answer
- Remind them of relevant AQA exam technique where appropriate (e.g. "always write the formula first — that gets you the method mark even if your arithmetic slips")
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

  const response = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-goog-api-key': API_KEY
      },
      body
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
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

  if (pathname === '/chat' && req.method === 'POST') {
    try {
      const raw = await readBody(req);
      const { messages } = JSON.parse(raw);
      const reply = await callGemini(messages);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ reply }));
    } catch (err) {
      console.error('Error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Maths Tutor running at http://localhost:${PORT}`);
  if (!API_KEY) console.warn('WARNING: GEMINI_API_KEY not set — add it to .env');
});
