// Vercel Function — mirrors the /speak handler in server.js (ElevenLabs
// natural-voice proxy). Kept in sync by hand with server.js; see the note
// at the top of api/chat.js for why.

const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };

async function synthesizeSpeech(text, voiceId) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': ELEVENLABS_KEY },
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

function friendlyError(err) {
  const msg = String(err.message || '');
  if (err.name === 'AbortError' || /aborted/i.test(msg)) return 'The natural voice took too long to respond.';
  if (/429|quota/i.test(msg)) return "We've used up this month's free natural-voice quota.";
  return 'Could not generate the natural voice right now.';
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: CORS });

    if (!ELEVENLABS_KEY) {
      return new Response(JSON.stringify({ error: 'Natural voice is not set up (no ELEVENLABS_API_KEY environment variable).' }), {
        status: 501,
        headers: { ...CORS, 'Content-Type': 'application/json' }
      });
    }

    let text, voiceId;
    try {
      ({ text, voiceId } = await request.json());
    } catch (_) {
      return new Response(JSON.stringify({ error: 'Invalid request body.' }), {
        status: 400,
        headers: { ...CORS, 'Content-Type': 'application/json' }
      });
    }
    if (!text || !voiceId) {
      return new Response(JSON.stringify({ error: 'Missing text or voiceId.' }), {
        status: 400,
        headers: { ...CORS, 'Content-Type': 'application/json' }
      });
    }

    try {
      const speechRes = await synthesizeSpeech(text, voiceId);
      // ElevenLabs' response body is already a Web ReadableStream — pass it
      // straight through, no manual chunk copying needed.
      return new Response(speechRes.body, { headers: { ...CORS, 'Content-Type': 'audio/mpeg' } });
    } catch (err) {
      console.error('Error (speak):', err);
      return new Response(JSON.stringify({ error: friendlyError(err) }), {
        status: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' }
      });
    }
  }
};
