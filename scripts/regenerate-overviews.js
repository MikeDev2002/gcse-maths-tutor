// One-time content script — NOT part of the deployed app.
// Replaces the "overview" field of every module in content/modules.json
// with a structured, scannable object instead of one dense paragraph.
// Only touches "overview" — examples and testQuestions (already
// hand-verified for accuracy) are left completely untouched.
//
// Usage:
//   node scripts/regenerate-overviews.js            # every module
//   node scripts/regenerate-overviews.js 1           # just week 1
//   node scripts/regenerate-overviews.js 6 14        # weeks 6-14
//
// Safe to re-run: merges into the existing file, saves after every
// success, so an interrupted run never loses progress already made.

const fs = require('fs');
const path = require('path');

function loadEnv() {
  try {
    const lines = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n');
    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      const key = t.slice(0, eq).trim();
      const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  } catch (_) {}
}
loadEnv();

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('GEMINI_API_KEY not set in .env — cannot generate content.');
  process.exit(1);
}

const OUTPUT_PATH = path.join(__dirname, '..', 'content', 'modules.json');

const OVERVIEW_SCHEMA = {
  type: 'object',
  properties: {
    hook: {
      type: 'string',
      description: 'One short, punchy, relatable sentence that makes someone want to read on — a real-world comparison or a "why this matters" line. No jargon. Under 20 words.'
    },
    keyIdea: {
      type: 'string',
      description: 'The core concept in plain English, 2 short sentences maximum, clear to both a Year 10 student and a parent without a strong maths background. Use $...$ for any inline maths.'
    },
    keyPoints: {
      type: 'array',
      description: 'Exactly 3 or 4 short, scannable bullet points covering the need-to-know facts, rules, or steps for this topic. Each one under 16 words. Use $...$ for any inline maths.',
      items: { type: 'string' }
    },
    examNote: {
      type: 'string',
      description: 'One sentence of Edexcel exam technique: either what mark-scheme language to expect (M1/A1), or whether the relevant formula is given on the Higher tier formula sheet or must be memorised.'
    }
  },
  required: ['hook', 'keyIdea', 'keyPoints', 'examNote']
};

function buildPrompt(mod) {
  return `You are writing the short intro section for a home-tutoring maths lesson on "${mod.title}" (part of ${mod.subject}), for a Year 10 student studying Edexcel GCSE Maths (Pearson, specification 1MA1) Higher tier.

This will be read by a parent and their daughter together at the very start of a weekly session, before any worked examples. It needs to be quick to read and get them oriented in seconds — not a dense paragraph. Use British spellings (factorise, recognise, colour, centre).

Produce, in this order: a one-line hook, the core idea in 2 sentences max, 3-4 short key-point bullets, and one exam-technique note.`;
}

async function callGemini(prompt, attempt = 1) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-goog-api-key': API_KEY },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', responseSchema: OVERVIEW_SCHEMA }
        }),
        signal: controller.signal
      }
    );
    clearTimeout(timeout);
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`HTTP ${res.status}: ${errText.slice(0, 300)}`);
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('No text in response: ' + JSON.stringify(data).slice(0, 300));
    return JSON.parse(text);
  } catch (err) {
    clearTimeout(timeout);
    if (attempt >= 4) throw err;
    const wait = attempt * 8000;
    console.log(`    retry ${attempt} failed (${err.message}) — waiting ${wait / 1000}s...`);
    await new Promise(r => setTimeout(r, wait));
    return callGemini(prompt, attempt + 1);
  }
}

function loadExisting() {
  return JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
}

async function main() {
  const args = process.argv.slice(2).map(Number).filter(n => !isNaN(n));
  const [fromWeek, toWeek] = args.length === 2 ? args : args.length === 1 ? [args[0], args[0]] : [1, 999];

  const modules = loadExisting();
  const targets = modules.filter(m => m.week >= fromWeek && m.week <= toWeek);

  console.log(`Regenerating overview for ${targets.length} module(s) (weeks ${fromWeek}-${toWeek})...`);

  for (const mod of targets) {
    process.stdout.write(`  Week ${mod.week}/37 — ${mod.subject}: ${mod.title} ... `);
    try {
      const overview = await callGemini(buildPrompt(mod));
      mod.overview = overview;
      console.log('OK');
      fs.writeFileSync(OUTPUT_PATH, JSON.stringify(modules, null, 2));
    } catch (err) {
      console.log('FAILED:', err.message);
    }
    await new Promise(r => setTimeout(r, 4000));
  }

  console.log('\nDone.');
}

main();
