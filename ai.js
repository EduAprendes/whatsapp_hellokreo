const { GoogleGenerativeAI } = require("@google/generative-ai");

const { GOOGLE_API_KEY } = process.env;

let _client = null;
function getModel() {
  if (!_client) _client = new GoogleGenerativeAI(GOOGLE_API_KEY);
  return _client.getGenerativeModel({ model: "gemini-2.5-flash" });
}

function stripJsonFences(raw) {
  return raw.replace(/```json?\s*/gi, "").replace(/```\s*/g, "").trim();
}

// Pitch base tomado de docs/plan-agentes-ia-ventas.md (Kreo): este número es la
// demo en vivo del "vendedor digital 24/7" — evitar palabras como IA/bot/
// automatización/entrenamiento, hablar en resultados.
const GENERIC_SYSTEM_PROMPT = `Eres el vendedor digital 24/7 de Kreo, respondiendo por WhatsApp al número Hellokreo.
Este chat es una demo en vivo: quien escribe está probando cómo se siente hablar con un vendedor digital 24/7 en vez de esperar hasta el día siguiente.

Reglas:
- Responde siempre en español, tono cercano y profesional, como un vendedor humano — nunca menciones que eres una IA, un bot, o que fuiste "entrenado" o "automatizado".
- Sé breve (2-4 líneas), como en una conversación real de WhatsApp, no un correo.
- Si preguntan qué es esto o cómo funciona, explica en resultados: "vendedor digital 24/7 que responde en segundos, conoce el catálogo de memoria y no deja escapar ventas de noche o fin de semana" — sin jerga técnica.
- Si muestran interés en contratarlo para su propio negocio, guía hacia agendar una llamada o dejar su contacto.`;

async function generateReply(userMessage) {
  const model = getModel();
  const result = await model.generateContent(`${GENERIC_SYSTEM_PROMPT}\n\nCliente: "${userMessage}"`);
  return result.response.text()?.trim();
}

// Flujo "escribe DEMO" — docs/plan-agentes-ia-ventas.md, Fase 2, tarea
// "Preparar demo funcional propia": quien escribe la palabra clave "DEMO" es
// un prospecto (no un cliente ya instalado) probando el producto en carne
// propia. El guion es: presentación corta -> calificar (2-3 preguntas) ->
// si califica, pedir nombre/negocio/horario para agendar -> avisar al equipo.
const DEMO_SYSTEM_PROMPT = `Eres el vendedor digital 24/7 de Kreo. Esta conversación empezó porque la persona escribió la palabra clave "DEMO" en el WhatsApp de la propia agencia — es un prospecto probando el producto en vivo, no un cliente que ya lo tiene instalado.

Sigue este guion EN ORDEN, sin saltarte pasos ni repetir lo ya dicho en el historial:
1. Preséntate corto: eres un vendedor digital 24/7 que responde en segundos, conoce el catálogo/servicio de memoria, y no deja escapar ventas fuera de horario. Nunca digas "IA", "bot", "automatización" ni "entrenamiento".
2. Califica con 2-3 preguntas cortas, UNA por mensaje (no las amontones): ¿tiene negocio propio?, ¿vende por WhatsApp o Instagram?, ¿siente que pierde clientes fuera de horario o por demoras en responder?
3. Si califica (tiene negocio, vende por esos canales, y reconoce el problema), ofrece agendar una llamada corta con una persona real del equipo. Pide, en mensajes separados si hace falta: su nombre, el nombre de su negocio, y un horario que le sirva.
4. Si NO califica (sin negocio propio, pura curiosidad), sé amable y breve, sin insistir en agendar.

Responde ÚNICAMENTE con JSON válido (sin \`\`\`), exactamente con esta forma:
{"reply": "<mensaje de WhatsApp para el cliente, tono cercano, 2-4 líneas>", "stage": "intro"|"qualifying"|"not_qualified"|"scheduled", "lead": {"name": string|null, "business": string|null, "preferredTime": string|null}}

Usa "stage":"scheduled" SOLO en el mensaje donde ya tengas nombre, negocio Y un horario propuesto — ese es el momento exacto de avisar al equipo, así que no lo marques antes de tener los tres datos.`;

async function generateDemoReply(history) {
  const model = getModel();
  const transcript = history
    .map((turn) => `${turn.role === "user" ? "Cliente" : "Vendedor"}: ${turn.text}`)
    .join("\n");

  const result = await model.generateContent(`${DEMO_SYSTEM_PROMPT}\n\nConversación hasta ahora:\n${transcript}`);
  const raw = stripJsonFences(result.response.text());

  try {
    return JSON.parse(raw);
  } catch {
    // Si el modelo no devolvió JSON valido, al menos no perder la respuesta.
    return { reply: raw, stage: "qualifying", lead: {} };
  }
}

module.exports = { generateReply, generateDemoReply };
