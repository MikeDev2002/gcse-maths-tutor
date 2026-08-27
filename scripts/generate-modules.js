// One-time content generation script — NOT part of the deployed app.
// Run this locally (needs GEMINI_API_KEY in .env) to (re)generate
// content/modules.json. The live app only ever reads that static file —
// it never calls Gemini for module content, only for live Q&A.
//
// Usage:
//   node scripts/generate-modules.js            # generate every module
//   node scripts/generate-modules.js 6           # regenerate just week 6
//   node scripts/generate-modules.js 6 14        # regenerate weeks 6-14
//
// Safe to re-run: it merges into the existing content/modules.json rather
// than wiping it, so a partial run (or a single re-generated module) never
// loses already-good content.

const fs = require('fs');
const path = require('path');

// ---- Load .env the same way server.js does ----
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

// Same 6 subjects / 37 sub-topics as the app's existing topic list —
// this defines the week-by-week order (Number 1-5, Algebra 6-14,
// Ratio & Proportion 15-18, Geometry 19-28, Probability 29-32, Statistics 33-37).
const SUBJECTS = [
  { name: 'Number', icon: '🔢', subs: [
    'Fractions, decimals & percentages', 'Standard form', 'Surds',
    'Laws of indices', 'Upper & lower bounds'
  ]},
  { name: 'Algebra', icon: '🧮', subs: [
    'Expanding & factorising', 'Solving equations & inequalities', 'Simultaneous equations',
    'Quadratics: factorising & the formula', 'Completing the square', 'Algebraic fractions',
    'Sequences (linear, quadratic, geometric)', 'Functions & iteration', 'Algebraic proof'
  ]},
  { name: 'Ratio & Proportion', icon: '⚖️', subs: [
    'Ratio', 'Percentage change', 'Compound interest & depreciation', 'Direct & inverse proportion'
  ]},
  { name: 'Geometry', icon: '📐', subs: [
    'Angles & polygons', 'Circle theorems', 'Arc length & sector area', "Pythagoras' theorem",
    'Trigonometry (SOH CAH TOA)', 'Sine & cosine rules', '3D shapes & volume', 'Vectors',
    'Transformations', 'Similarity & congruence'
  ]},
  { name: 'Probability', icon: '🎲', subs: [
    'Basic probability', 'Tree diagrams', 'Venn diagrams & set notation', 'Conditional probability'
  ]},
  { name: 'Statistics', icon: '📊', subs: [
    'Averages & range', 'Frequency tables', 'Cumulative frequency & box plots',
    'Histograms', 'Scatter graphs & correlation'
  ]}
];

function buildModuleList() {
  const modules = [];
  let week = 1;
  for (const subject of SUBJECTS) {
    for (const title of subject.subs) {
      const id = `${subject.name}-${title}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      modules.push({ id, week: week++, subject: subject.name, icon: subject.icon, title });
    }
  }
  return modules;
}

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    overview: {
      type: 'string',
      description: 'Plain-English explanation of the concept, 150-250 words, written so both a Year 10 student AND a parent without a strong maths background can follow it.'
    },
    examples: {
      type: 'array',
      description: 'Exactly 2 fully worked examples, increasing in difficulty.',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          solution: { type: 'string', description: 'Full step-by-step worked solution, numbered steps, using $...$ for inline maths.' }
        },
        required: ['question', 'solution']
      }
    },
    testQuestions: {
      type: 'array',
      description: 'Exactly 5 practice questions, mixed difficulty, Edexcel Higher exam style, with full correct worked answers.',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          answer: { type: 'string', description: 'The correct final answer plus brief working, so a parent can mark it.' }
        },
        required: ['question', 'answer']
      }
    }
  },
  required: ['overview', 'examples', 'testQuestions']
};

function buildPrompt(mod) {
  return `Create a self-contained home-tutoring lesson for a Year 10 student studying Edexcel GCSE Maths (Pearson, specification 1MA1) Higher tier, on the topic: "${mod.title}" (part of ${mod.subject}).

This lesson will be used by a PARENT sitting down with their daughter for one focused hour, once a week. The parent may not be confident in maths themselves, so the overview must be genuinely clear to a non-expert adult as well as the student.

Use British spellings (factorise, recognise, colour, centre). Use $...$ for inline maths and keep notation simple (x^2, sqrt(), fractions written clearly). Where relevant, mention Edexcel mark-scheme language (M1 for method, A1 for accuracy) and note which formulae are given on the Higher tier formula sheet versus which must be memorised.

Provide:
1. An overview of the concept (150-250 words, clear to both student and parent).
2. Exactly 2 fully worked examples of increasing difficulty, each with the full step-by-step solution a student would need to show for exam marks.
3. Exactly 5 practice test questions of mixed difficulty in authentic Edexcel exam style, each with the correct final answer and brief working so the parent can mark it accurately.`;
}

async function callGemini(prompt, attempt = 1) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-goog-api-key': API_KEY },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA }
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
  try {
    return JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
  } catch (_) {
    return [];
  }
}

async function main() {
  const args = process.argv.slice(2).map(Number).filter(n => !isNaN(n));
  const [fromWeek, toWeek] = args.length === 2 ? args : args.length === 1 ? [args[0], args[0]] : [1, 999];

  const allModules = buildModuleList();
  const targets = allModules.filter(m => m.week >= fromWeek && m.week <= toWeek);
  const existing = loadExisting();
  const byId = new Map(existing.map(m => [m.id, m]));

  console.log(`Generating ${targets.length} module(s) (weeks ${fromWeek}-${toWeek})...`);

  for (const mod of targets) {
    process.stdout.write(`  Week ${mod.week}/37 — ${mod.subject}: ${mod.title} ... `);
    try {
      const content = await callGemini(buildPrompt(mod));
      byId.set(mod.id, { ...mod, ...content });
      console.log('OK');
      // Save after every success, not just at the end — a long batch like
      // this can run into rate limits or quota partway through, and we
      // don't want an interruption to lose everything generated so far.
      const merged = Array.from(byId.values()).sort((a, b) => a.week - b.week);
      fs.writeFileSync(OUTPUT_PATH, JSON.stringify(merged, null, 2));
    } catch (err) {
      console.log('FAILED:', err.message);
    }
    // Gentle pacing to stay well within free-tier rate limits
    await new Promise(r => setTimeout(r, 4000));
  }

  const merged = Array.from(byId.values()).sort((a, b) => a.week - b.week);
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(merged, null, 2));
  console.log(`\nWrote ${merged.length} module(s) to ${OUTPUT_PATH}`);

  const missing = allModules.filter(m => !byId.has(m.id));
  if (missing.length) {
    console.log(`\n${missing.length} module(s) still missing content:`);
    missing.forEach(m => console.log(`  week ${m.week}: ${m.title}`));
    console.log('Re-run with specific week numbers to fill these in once Gemini is responsive.');
  }
}

main();
