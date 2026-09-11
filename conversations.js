const { Redis } = require("@upstash/redis");

// La integracion de Upstash desde el Marketplace de Vercel expone
// KV_REST_API_URL / KV_REST_API_TOKEN (convencion vieja de @vercel/kv), no
// UPSTASH_REDIS_REST_URL / _TOKEN que espera Redis.fromEnv() por defecto.

// Estado por conversación (número de WhatsApp o id de conversación de
// Chatwoot), persistido en Redis (Upstash). Antes vivía en un Map en
// memoria: se perdia en cada cold start de Vercel, y ademas -- el problema
// real que forzo este cambio (2026-09-11) -- Vercel puede correr varias
// instancias en paralelo bajo una rafaga de mensajes (Instagram reenvia
// duplicados/ecos seguidos), cada una con su propia memoria: un mensaje que
// activaba el trigger en una instancia no se veia reflejado en otra que
// llegaba segundos despues, y esa respuesta se perdia en silencio.
const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const TTL_SECONDS = 60 * 60 * 48; // 48h -- alcanza para una conversacion de prueba/demo

function defaultConversation() {
  return { history: [], notified: false, triggered: false };
}

async function getConversation(key) {
  const stored = await redis.get(`conversation:${key}`);
  return stored || defaultConversation();
}

async function saveConversation(key, conversation) {
  await redis.set(`conversation:${key}`, conversation, { ex: TTL_SECONDS });
}

module.exports = { getConversation, saveConversation };
