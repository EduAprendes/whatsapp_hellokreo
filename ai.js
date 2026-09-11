const { GoogleGenerativeAI } = require("@google/generative-ai");
const { businessNowText, businessDateTimeToISO } = require("./businessTime");
const { listAvailableSlots, createEventIfFree } = require("./googleCalendar");

const { GOOGLE_API_KEY } = process.env;

const TOOLS = [
  {
    functionDeclarations: [
      {
        name: "consultar_disponibilidad",
        description:
          "Devuelve los horarios libres (bloques de 30 min) para una fecha dada, dentro del horario de atención del equipo (9:00 a 18:00, lunes a viernes). Usar esto antes de proponer o confirmar cualquier horario — nunca inventar horarios.",
        parameters: {
          type: "OBJECT",
          properties: {
            fecha: { type: "STRING", description: "Fecha en formato AAAA-MM-DD" },
          },
          required: ["fecha"],
        },
      },
      {
        name: "crear_llamada",
        description:
          "Agenda la llamada con el equipo de Kreo en el horario indicado, si sigue libre. Usar solo después de que el cliente confirmó un horario concreto (idealmente uno devuelto por consultar_disponibilidad).",
        parameters: {
          type: "OBJECT",
          properties: {
            fecha: { type: "STRING", description: "Fecha en formato AAAA-MM-DD" },
            hora: { type: "STRING", description: "Hora en formato HH:mm, 24 horas" },
            nombre: { type: "STRING" },
            negocio: { type: "STRING" },
          },
          required: ["fecha", "hora", "nombre", "negocio"],
        },
      },
    ],
  },
];

let _client = null;
function getModel() {
  if (!_client) _client = new GoogleGenerativeAI(GOOGLE_API_KEY);
  return _client.getGenerativeModel({
    model: "gemini-2.5-flash",
    tools: TOOLS,
    systemInstruction: buildSystemPrompt(),
  });
}

function stripJsonFences(raw) {
  return raw.replace(/```json?\s*/gi, "").replace(/```\s*/g, "").trim();
}

// Flujo "DEMO" — docs/plan-agentes-ia-ventas.md, Fase 2, tarea "Preparar demo
// funcional propia". En WhatsApp corre siempre (quien escribe a ese número ya
// está interesado en el servicio); en Instagram requiere la palabra clave
// "DEMO" (canal más general, ver conversationEngine.js). El guion es:
// presentación corta -> calificar (2-3 preguntas) -> si califica, buscar
// disponibilidad real y agendar la llamada -> avisar al equipo.
function buildSystemPrompt() {
  return `Eres el vendedor digital 24/7 de Kreo, respondiendo por un canal directo de la propia agencia (WhatsApp o Instagram). Quien te escribe es un prospecto probando el producto en vivo, no un cliente que ya lo tiene instalado.

${businessNowText()}

Sigue este guion EN ORDEN, sin saltarte pasos ni repetir lo ya dicho en el historial:
1. Preséntate corto: eres un vendedor digital 24/7 que responde en segundos, conoce el catálogo/servicio de memoria, y no deja escapar ventas fuera de horario. Nunca digas "IA", "bot", "automatización" ni "entrenamiento".
2. Califica con 2-3 preguntas cortas, UNA por mensaje (no las amontones): ¿tiene negocio propio?, ¿vende por WhatsApp o Instagram?, ¿siente que pierde clientes fuera de horario o por demoras en responder?
3. Si califica (tiene negocio, vende por esos canales, y reconoce el problema), ofrece agendar una llamada corta con una persona real del equipo. Pide su nombre y el nombre de su negocio si todavía no los tienes.
4. Para el horario: usa la herramienta \`consultar_disponibilidad\` con una fecha concreta (resuelve "mañana"/"el viernes" a AAAA-MM-DD vos mismo usando la fecha de hoy de arriba) y ofrécele 2-3 horarios reales de esa lista — nunca inventes un horario.
5. Cuando el cliente confirme un horario de esa lista, usa \`crear_llamada\` con los 4 datos (fecha, hora, nombre, negocio) para agendarla de verdad. Si la herramienta devuelve que el horario ya no está libre, discúlpate y ofrece otro horario real (podés volver a llamar a \`consultar_disponibilidad\`).
6. Si NO califica (sin negocio propio, pura curiosidad), sé amable y breve, sin insistir en agendar.

Cuando termines de usar las herramientas que necesites (o si no hace falta ninguna todavía), respondé SIEMPRE con tu último mensaje en JSON válido (sin \`\`\`), exactamente con esta forma:
{"reply": "<mensaje para el cliente, tono cercano, 2-4 líneas>", "stage": "intro"|"qualifying"|"not_qualified"|"scheduled", "lead": {"name": string|null, "business": string|null, "preferredTime": string|null}}

Usa "stage":"scheduled" ÚNICAMENTE en el mensaje que sigue justo después de que \`crear_llamada\` haya confirmado éxito — nunca antes, y nunca si la herramienta falló o el horario estaba ocupado.`;
}

async function callTool(name, args) {
  if (name === "consultar_disponibilidad") {
    const slots = await listAvailableSlots(args.fecha);
    return { fecha: args.fecha, horarios_libres: slots };
  }

  if (name === "crear_llamada") {
    const startISO = businessDateTimeToISO(args.fecha, args.hora);
    const endISO = new Date(new Date(startISO).getTime() + 30 * 60 * 1000).toISOString();
    return createEventIfFree({
      startISO,
      endISO,
      summary: `Llamada demo Kreo — ${args.nombre} (${args.negocio})`,
      description: `Lead calificado por el flujo DEMO de Kreo. Negocio: ${args.negocio}.`,
    });
  }

  return { error: "herramienta_desconocida" };
}

const MAX_TOOL_STEPS = 6;

async function generateDemoReply(history) {
  const model = getModel();
  const contents = history.map((turn) => ({
    role: turn.role === "user" ? "user" : "model",
    parts: [{ text: turn.text }],
  }));

  let result = await model.generateContent({ contents });

  for (let step = 0; step < MAX_TOOL_STEPS; step++) {
    const calls = result.response.functionCalls();
    if (!calls || calls.length === 0) break;

    contents.push({ role: "model", parts: calls.map((call) => ({ functionCall: call })) });

    const responses = await Promise.all(
      calls.map(async (call) => ({
        functionResponse: { name: call.name, response: await callTool(call.name, call.args) },
      }))
    );
    contents.push({ role: "function", parts: responses });

    result = await model.generateContent({ contents });
  }

  return parseDemoResponse(stripJsonFences(result.response.text()));
}

// A veces el modelo devuelve casi-JSON con literales de Python (None/True/
// False en vez de null/true/false) en lugar de JSON estricto. Ya paso en
// produccion (2026-09-11): mandaba el JSON crudo, sin parsear, directo al
// cliente. Se intenta reparar antes de rendirse.
function parseDemoResponse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    // no-op, seguir con el intento de reparación
  }

  const repaired = raw.replace(/\bNone\b/g, "null").replace(/\bTrue\b/g, "true").replace(/\bFalse\b/g, "false");
  try {
    return JSON.parse(repaired);
  } catch {
    // no-op, seguir con el ultimo recurso
  }

  // Ultimo recurso: extraer solo el campo "reply" a mano en vez de mandarle
  // al cliente un JSON roto sin sentido.
  const match = raw.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (match) {
    return { reply: match[1].replace(/\\"/g, '"').replace(/\\n/g, "\n"), stage: "qualifying", lead: {} };
  }

  console.error("No se pudo interpretar la respuesta del modelo:", raw);
  return { reply: "Disculpa, tuve un problema técnico. ¿Me repites lo último?", stage: "qualifying", lead: {} };
}

module.exports = { generateDemoReply };
