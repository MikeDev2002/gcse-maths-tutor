// Vercel Function (Web-standard Request/Response) — mirrors the /chat
// handler in server.js exactly, kept in sync by hand. server.js is used for
// local dev and Render (a persistent Node process); this file is the same
// logic adapted to Vercel's per-request serverless function model.

const API_KEY = process.env.GEMINI_API_KEY;

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
  if (!API_KEY) throw new Error('GEMINI_API_KEY not set');

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
      headers: { 'Content-Type': 'application/json', 'X-goog-api-key': API_KEY },
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

function friendlyError(err) {
  const msg = String(err.message || '');
  if (err.name === 'AbortError' || /aborted/i.test(msg)) {
    return "The tutor is taking too long to answer — it's probably very busy. Please try again in a minute.";
  }
  if (/503|UNAVAILABLE|high demand|overloaded/i.test(msg)) {
    return 'The tutor service is very busy right now. Please wait a minute and try again.';
  }
  if (/429|quota|RESOURCE_EXHAUSTED/i.test(msg)) {
    return "We've used up our free questions for now. Please try again a bit later.";
  }
  if (/GEMINI_API_KEY/.test(msg)) {
    return 'The tutor is not set up yet — the API key is missing from the environment variables.';
  }
  return 'Something went wrong. Please try again.';
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

    let messages;
    try {
      ({ messages } = await request.json());
    } catch (_) {
      return new Response(JSON.stringify({ error: 'Invalid request body.' }), {
        status: 400,
        headers: { ...CORS, 'Content-Type': 'application/json' }
      });
    }

    let geminiRes;
    try {
      geminiRes = await callGemini(messages);
    } catch (err) {
      console.error('Error:', err);
      return new Response(JSON.stringify({ error: friendlyError(err) }), {
        status: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' }
      });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const reader = geminiRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        try {
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
                if (text) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token: text })}\n\n`));
              } catch (_) {}
            }
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        } catch (err) {
          console.error('Stream error:', err);
        } finally {
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: { ...CORS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }
    });
  }
};
