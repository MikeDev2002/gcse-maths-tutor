// Vercel Function — mirrors the /voices handler in server.js (lists
// available ElevenLabs natural voices, or reports "not configured").
// Kept in sync by hand with server.js; see the note at the top of
// api/chat.js for why.

const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };

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

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: CORS });

    if (!ELEVENLABS_KEY) {
      return new Response(JSON.stringify({ configured: false, voices: [] }), {
        headers: { ...CORS, 'Content-Type': 'application/json' }
      });
    }

    try {
      const voices = await listElevenLabsVoices();
      return new Response(JSON.stringify({ configured: true, voices }), {
        headers: { ...CORS, 'Content-Type': 'application/json' }
      });
    } catch (err) {
      console.error('Error (voices):', err);
      return new Response(JSON.stringify({ configured: true, voices: [], error: 'Could not reach the natural voice service.' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' }
      });
    }
  }
};
