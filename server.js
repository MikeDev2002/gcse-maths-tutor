const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

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

const API_KEY = process.env.ANTHROPIC_API_KEY;
const PORT = process.env.PORT || 3000;

const SYSTEM_PROMPT = `You are a friendly and encouraging maths tutor helping a UK GCSE student (ages 14-16).

Your role:
- Guide students to understand concepts, not just give answers
- Break problems into clear steps
- Use UK GCSE terminology and curriculum (Edexcel/AQA style)
- Encourage students when they get things right
- Gently correct mistakes and explain why
- Use British spellings (e.g. "colour", "recognise", "factorise")
- Reference mark schemes when relevant ("this would get 2 marks for method")

Topics you cover: Number, Algebra, Ratio & Proportion, Geometry & Measures, Probability, Statistics.

Keep responses concise and clear — students learn better from shorter, focused explanations. Use line breaks between steps. When writing maths, be clear and readable (e.g. write "x^2" for x squared, "sqrt()" for square root).

If a student seems stuck, ask a guiding question rather than giving the answer directly.`;

async function callClaude(messages) {
  if (!API_KEY) throw new Error('ANTHROPIC_API_KEY not set in .env');

  const body = JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages
  });

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.content[0].text;
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
  const { pathname } = url.parse(req.url);

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
      const reply = await callClaude(messages);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ reply }));
    } catch (err) {
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
  if (!API_KEY) console.warn('WARNING: ANTHROPIC_API_KEY not set — add it to .env');
});
