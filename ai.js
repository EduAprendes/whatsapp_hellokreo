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

// Flujo "DEMO" — docs/plan-agentes-ia-ventas.md, Fase 2, tarea "Preparar demo
// funcional propia": en WhatsApp corre siempre (quien escribe a este número
// ya está interesado en el servicio, no hace falta la palabra clave "DEMO" —
// esa se reserva para Instagram, un canal más general). El guion es:
// presentación corta -> calificar (2-3 preguntas) -> si califica, pedir
// nombre/negocio/horario para agendar -> avisar al equipo.
const DEMO_SYSTEM_PROMPT = `Eres el vendedor digital 24/7 de Kreo, respondiendo por el WhatsApp de la propia agencia. Quien te escribe es un prospecto probando el producto en vivo, no un cliente que ya lo tiene instalado.

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

module.exports = { generateDemoReply };
