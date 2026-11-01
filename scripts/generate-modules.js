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

// This defines the week-by-week order (Number 1-6, Algebra 7-15,
// Ratio & Proportion 16-19, Geometry 20-29, Probability 30-33, Statistics 34-38).
const SUBJECTS = [
  { name: 'Number', icon: '🔢', subs: [
    'Factors, multiples, primes, HCF & LCM', 'Fractions, decimals & percentages', 'Standard form', 'Surds',
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

// Other words people use for each topic, so the app's search finds the right
// lesson even when the term isn't in the title (e.g. "IQR", "nth term").
// Only list what the lesson actually teaches: if a topic has no lesson, search
// should say so rather than send someone to the wrong one.
const KEYWORDS = {
  'Factors, multiples, primes, HCF & LCM': ['LCM', 'lowest common multiple', 'least common multiple', 'HCF', 'highest common factor', 'greatest common divisor', 'prime factorisation', 'prime factor decomposition', 'product of primes', 'factor tree', 'prime numbers'],
  'Fractions, decimals & percentages': ['recurring decimals', 'terminating decimals', 'reverse percentages', 'equivalent fractions', 'converting fractions'],
  'Standard form': ['scientific notation', 'powers of ten', 'very large numbers', 'very small numbers'],
  'Surds': ['rationalising the denominator', 'rationalise', 'square roots', 'simplifying roots', 'irrational numbers'],
  'Laws of indices': ['powers', 'exponents', 'negative indices', 'fractional indices', 'index laws', 'zero power'],
  'Upper & lower bounds': ['error intervals', 'rounding', 'truncation', 'limits of accuracy', 'degree of accuracy'],
  'Expanding & factorising': ['brackets', 'multiplying out', 'FOIL', 'double brackets', 'common factor', 'difference of two squares'],
  'Solving equations & inequalities': ['linear equations', 'unknowns on both sides', 'inequality', 'number line', 'rearranging'],
  'Simultaneous equations': ['elimination', 'substitution', 'two unknowns'],
  'Quadratics: factorising & the formula': ['quadratic formula', 'quadratic equations', 'solving quadratics', 'roots of a quadratic'],
  'Completing the square': ['turning point', 'vertex', 'minimum point', 'perfect square'],
  'Algebraic fractions': ['rational expressions', 'common denominator', 'cross multiply'],
  'Sequences (linear, quadratic, geometric)': ['nth term', 'arithmetic sequence', 'term to term', 'position to term', 'Fibonacci', 'common difference', 'common ratio'],
  'Functions & iteration': ['inverse function', 'composite function', 'f(x)', 'function notation', 'function machine', 'iterative formula'],
  'Algebraic proof': ['proof', 'proving', 'show that', 'consecutive integers', 'odd and even numbers'],
  'Ratio': ['sharing in a ratio', 'dividing in a ratio', 'simplifying ratios', 'unitary method'],
  'Percentage change': ['percentage increase', 'percentage decrease', 'profit and loss', 'multiplier', 'reverse percentage'],
  'Compound interest & depreciation': ['growth and decay', 'exponential growth', 'multiplier', 'savings', 'interest rate'],
  'Direct & inverse proportion': ['directly proportional', 'inversely proportional', 'proportional to', 'constant of proportionality', 'varies as'],
  'Angles & polygons': ['interior angles', 'exterior angles', 'parallel lines', 'alternate angles', 'corresponding angles', 'angles in a triangle', 'regular polygons'],
  'Circle theorems': ['tangent', 'chord', 'cyclic quadrilateral', 'alternate segment', 'semicircle', 'angle at the centre', 'angle at the circumference'],
  'Arc length & sector area': ['sector', 'arc', 'area of a circle', 'circumference', 'pi'],
  "Pythagoras' theorem": ['right-angled triangle', 'hypotenuse', 'a squared plus b squared', 'pythagorean'],
  'Trigonometry (SOH CAH TOA)': ['SOHCAHTOA', 'trig', 'sine', 'cosine', 'tangent', 'sin', 'cos', 'tan', 'right-angled triangle', 'angle of elevation', 'exact trig values'],
  'Sine & cosine rules': ['sine rule', 'cosine rule', 'trig', 'area of a triangle', 'non-right-angled triangles'],
  '3D shapes & volume': ['surface area', 'cylinder', 'cone', 'sphere', 'pyramid', 'prism', 'frustum', 'cuboid'],
  'Vectors': ['column vectors', 'magnitude', 'scalar', 'parallel vectors', 'vector proof', 'resultant'],
  'Transformations': ['rotation', 'reflection', 'translation', 'enlargement', 'scale factor', 'centre of enlargement'],
  'Similarity & congruence': ['similar shapes', 'similar triangles', 'congruent triangles', 'SSS', 'SAS', 'ASA', 'RHS', 'scale factor'],
  'Basic probability': ['chance', 'likelihood', 'probability scale', 'relative frequency', 'expected frequency', 'mutually exclusive', 'sample space', 'outcomes'],
  'Tree diagrams': ['with replacement', 'without replacement', 'independent events', 'branches'],
  'Venn diagrams & set notation': ['set notation', 'sets', 'union', 'intersection', 'complement', 'universal set'],
  'Conditional probability': ['given that', 'dependent events', 'two-way tables'],
  'Averages & range': ['mean', 'median', 'mode', 'average'],
  'Frequency tables': ['grouped data', 'grouped frequency', 'estimate of the mean', 'modal class', 'class interval', 'midpoints'],
  'Cumulative frequency & box plots': ['box and whisker', 'interquartile range', 'IQR', 'quartiles', 'lower quartile', 'upper quartile'],
  'Histograms': ['frequency density', 'class width', 'unequal class widths'],
  'Scatter graphs & correlation': ['line of best fit', 'positive correlation', 'negative correlation', 'outliers', 'interpolation', 'extrapolation']
};

// Extra direction for topics whose title alone doesn't pin down the scope.
const SCOPE_NOTES = {
  'Factors, multiples, primes, HCF & LCM': 'Cover: writing a number as a product of prime factors in index form (e.g. $360 = 2^3 \\times 3^2 \\times 5$), then using prime factors or a Venn diagram to find the HCF and LCM, including at least one worded problem where the student must recognise that LCM or HCF is needed (e.g. two buses leaving a station together, or cutting ribbons into equal lengths).'
};

function buildModuleList() {
  const modules = [];
  let week = 1;
  for (const subject of SUBJECTS) {
    for (const title of subject.subs) {
      const id = `${subject.name}-${title}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      modules.push({ id, week: week++, subject: subject.name, icon: subject.icon, title, keywords: KEYWORDS[title] || [] });
    }
  }
  return modules;
}

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    overview: {
      type: 'object',
      properties: {
        hook: { type: 'string', description: 'One short, punchy, relatable sentence that makes someone want to read on. No jargon. Under 20 words.' },
        keyIdea: { type: 'string', description: 'The core concept in plain English, 2 short sentences maximum, clear to both a Year 10 student and a parent without a strong maths background. Use $...$ for any inline maths.' },
        keyPoints: { type: 'array', description: 'Exactly 3 or 4 short, scannable bullet points covering the need-to-know facts, rules, or steps. Each under 16 words. Use $...$ for any inline maths.', items: { type: 'string' } },
        examNote: { type: 'string', description: 'One sentence of Edexcel exam technique: what mark-scheme language to expect (M1/A1), or whether the relevant formula is given on the Higher tier formula sheet or must be memorised.' }
      },
      required: ['hook', 'keyIdea', 'keyPoints', 'examNote']
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

${SCOPE_NOTES[mod.title] || ''}

Provide:
1. A quick overview, clear to both student and parent: a one-line hook, the core idea in 2 sentences, 3-4 short key points, and one exam-technique note.
2. Exactly 2 fully worked examples of increasing difficulty, each with the full step-by-step solution a student would need to show for exam marks.
3. Exactly 5 practice test questions of mixed difficulty in authentic Edexcel exam style, each with the correct final answer and brief working so the parent can mark it accurately.`;
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

  // Keep every existing module's week number and keywords in line with the
  // list above, so adding a topic renumbers the rest without regenerating them.
  for (const mod of allModules) {
    if (byId.has(mod.id)) byId.set(mod.id, { ...byId.get(mod.id), ...mod });
  }

  console.log(`Generating ${targets.length} module(s) (weeks ${fromWeek}-${toWeek})...`);

  for (const mod of targets) {
    process.stdout.write(`  Week ${mod.week}/${allModules.length} — ${mod.subject}: ${mod.title} ... `);
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
