const { GoogleGenerativeAI } = require("@google/generative-ai");
const { businessNowText, businessDateTimeToISO } = require("./businessTime");
const { listAvailableSlots, createEventIfFree, updateEventIfFree, cancelEvent } = require("./googleCalendar");

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
      {
        name: "reagendar_llamada",
        description:
          "Mueve la llamada ya agendada de este cliente a un horario nuevo, si sigue libre. Solo se puede usar si este cliente ya tiene una llamada agendada en la conversación.",
        parameters: {
          type: "OBJECT",
          properties: {
            fecha: { type: "STRING", description: "Nueva fecha en formato AAAA-MM-DD" },
            hora: { type: "STRING", description: "Nueva hora en formato HH:mm, 24 horas" },
          },
          required: ["fecha", "hora"],
        },
      },
      {
        name: "cancelar_llamada",
        description:
          "Cancela la llamada ya agendada de este cliente. Solo se puede usar si este cliente ya tiene una llamada agendada en la conversación.",
        parameters: { type: "OBJECT", properties: {} },
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
// disponibilidad real y agendar la llamada -> avisar al equipo. Si el
// cliente ya tiene una llamada agendada (se ve en el historial), también
// puede reagendarla o cancelarla en la misma conversación.
function buildSystemPrompt() {
  return `Eres el vendedor digital 24/7 de Kreo, respondiendo por un canal directo de la propia agencia (WhatsApp o Instagram). Quien te escribe es un prospecto probando el producto en vivo, no un cliente que ya lo tiene instalado.

${businessNowText()}

Sigue este guion EN ORDEN, sin saltarte pasos ni repetir lo ya dicho en el historial:
1. Preséntate corto: eres un vendedor digital 24/7 que responde en segundos, conoce el catálogo/servicio de memoria, y no deja escapar ventas fuera de horario. Nunca digas "IA", "bot", "automatización" ni "entrenamiento".
2. Califica con 2-3 preguntas cortas, UNA por mensaje (no las amontones): ¿tiene negocio propio?, ¿vende por WhatsApp o Instagram?, ¿siente que pierde clientes fuera de horario o por demoras en responder?
3. Si califica (tiene negocio, vende por esos canales, y reconoce el problema), ofrece agendar una llamada corta con una persona real del equipo. Pide su nombre y el nombre de su negocio si todavía no los tienes.
4. Para el horario: usa la herramienta \`consultar_disponibilidad\` con una fecha concreta (resuelve "mañana"/"el viernes" a AAAA-MM-DD vos mismo usando la fecha de hoy de arriba) y ofrécele 2-3 horarios reales de esa lista — nunca inventes un horario.
5. Cuando el cliente confirme un horario de esa lista, usa \`crear_llamada\` con los 4 datos (fecha, hora, nombre, negocio) para agendarla de verdad. Si la herramienta devuelve que el horario ya no está libre, discúlpate y ofrece otro horario real (podés volver a llamar a \`consultar_disponibilidad\`). Si \`crear_llamada\` confirma éxito, tu mensaje solo confirma la reserva (día y hora) — NUNCA digas que mandaste un link o comprobante, el sistema lo agrega automáticamente después de tu mensaje.
6. Si NO califica (sin negocio propio, pura curiosidad), sé amable y breve, sin insistir en agendar.
7. Si el cliente YA tiene una llamada agendada (revisá el historial) y pide cambiar el horario: consultá disponibilidad de la fecha nueva y usá \`reagendar_llamada\` cuando confirme. Si pide cancelar: usá \`cancelar_llamada\` directo, sin pedir motivo. En ambos casos tu mensaje solo confirma el cambio — nunca prometas mandar un link o comprobante nuevo.

IMPORTANTE — formato de salida: tu respuesta completa, SIEMPRE (con o sin uso de herramientas antes), tiene que ser ÚNICAMENTE un objeto JSON válido, sin texto antes ni después, sin \`\`\`, exactamente con esta forma:
{"reply": "<mensaje para el cliente, tono cercano, 2-4 líneas>", "stage": "intro"|"qualifying"|"not_qualified"|"scheduled"|"rescheduled"|"cancelled", "lead": {"name": string|null, "business": string|null, "preferredTime": string|null}}

Nunca respondas con texto plano suelto, ni siquiera después de usar una herramienta — el JSON de arriba es tu ÚNICO formato de salida válido, en todos los turnos, sin excepción.

Usa "stage":"scheduled"/"rescheduled"/"cancelled" ÚNICAMENTE en el mensaje que sigue justo después de que la herramienta correspondiente haya confirmado éxito — nunca antes, y nunca si la herramienta falló.`;
}

// `conversation.bookedEvent` (si existe) es la llamada ya agendada de este
// cliente — reagendar_llamada/cancelar_llamada operan sobre ese evento, no
// sobre uno que la IA elija a mano. `calendarAction` se computa desde lo que
// las herramientas realmente hicieron (no desde el "stage" que reporta el
// modelo, que ya demostró no ser 100% confiable) — generateDemoReply lo usa
// para agregar el link real y conversationEngine.js para decidir si avisar
// al equipo.
async function callTool(name, args, conversation, setCalendarAction) {
  if (name === "consultar_disponibilidad") {
    const slots = await listAvailableSlots(args.fecha);
    return { fecha: args.fecha, horarios_libres: slots };
  }

  if (name === "crear_llamada") {
    const startISO = businessDateTimeToISO(args.fecha, args.hora);
    const endISO = new Date(new Date(startISO).getTime() + 30 * 60 * 1000).toISOString();
    const result = await createEventIfFree({
      startISO,
      endISO,
      summary: `Llamada demo Kreo — ${args.nombre} (${args.negocio})`,
      description: `Lead calificado por el flujo DEMO de Kreo. Negocio: ${args.negocio}.`,
    });
    if (result.created) {
      conversation.bookedEvent = { eventId: result.eventId, startISO, endISO, nombre: args.nombre, negocio: args.negocio };
      setCalendarAction({ type: "created", link: result.htmlLink, startISO, lead: { name: args.nombre, business: args.negocio } });
    }
    return result;
  }

  if (name === "reagendar_llamada") {
    if (!conversation.bookedEvent) return { error: "no_hay_llamada_agendada" };
    const startISO = businessDateTimeToISO(args.fecha, args.hora);
    const endISO = new Date(new Date(startISO).getTime() + 30 * 60 * 1000).toISOString();
    const result = await updateEventIfFree({ eventId: conversation.bookedEvent.eventId, startISO, endISO });
    if (result.updated) {
      conversation.bookedEvent.startISO = startISO;
      conversation.bookedEvent.endISO = endISO;
      setCalendarAction({
        type: "rescheduled",
        link: result.htmlLink,
        startISO,
        lead: { name: conversation.bookedEvent.nombre, business: conversation.bookedEvent.negocio },
      });
    }
    return result;
  }

  if (name === "cancelar_llamada") {
    if (!conversation.bookedEvent) return { error: "no_hay_llamada_agendada" };
    const lead = { name: conversation.bookedEvent.nombre, business: conversation.bookedEvent.negocio };
    const result = await cancelEvent(conversation.bookedEvent.eventId);
    if (result.cancelled) {
      conversation.bookedEvent = null;
      setCalendarAction({ type: "cancelled", lead });
    }
    return result;
  }

  return { error: "herramienta_desconocida" };
}

const MAX_TOOL_STEPS = 6;

// `conversation` se pasa completo (no solo el historial) porque
// reagendar_llamada/cancelar_llamada necesitan leer y actualizar
// `conversation.bookedEvent` -- conversationEngine.js persiste el objeto
// despues, con los cambios que haya hecho callTool durante este turno.
async function generateDemoReply(history, conversation) {
  const model = getModel();
  const contents = history.map((turn) => ({
    role: turn.role === "user" ? "user" : "model",
    parts: [{ text: turn.text }],
  }));

  let calendarAction = null;
  const setCalendarAction = (action) => {
    calendarAction = action;
  };

  let result = await model.generateContent({ contents });

  for (let step = 0; step < MAX_TOOL_STEPS; step++) {
    const calls = result.response.functionCalls();
    if (!calls || calls.length === 0) break;

    contents.push({ role: "model", parts: calls.map((call) => ({ functionCall: call })) });

    const responses = await Promise.all(
      calls.map(async (call) => ({
        functionResponse: { name: call.name, response: await callTool(call.name, call.args, conversation, setCalendarAction) },
      }))
    );
    contents.push({ role: "function", parts: responses });

    result = await model.generateContent({ contents });
  }

  const parsed = parseDemoResponse(stripJsonFences(result.response.text()));
  if (calendarAction?.link && parsed.reply) {
    parsed.reply = `${parsed.reply}\n\n${calendarAction.link}`;
  }
  return { ...parsed, calendarAction };
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

  // Extraer solo el campo "reply" a mano en vez de mandarle al cliente un
  // JSON roto sin sentido.
  const match = raw.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (match) {
    return { reply: match[1].replace(/\\"/g, '"').replace(/\\n/g, "\n"), stage: "qualifying", lead: {} };
  }

  // A veces el modelo directamente ignora la instruccion de responder en
  // JSON y devuelve una respuesta normal en texto plano -- pasa sobre todo
  // despues de usar herramientas. Si no parece JSON roto (no tiene "{"), es
  // casi seguro una respuesta valida en texto libre: mejor usarla tal cual
  // que descartarla y mandarle al cliente un mensaje generico de disculpa.
  if (raw && !raw.includes("{")) {
    return { reply: raw, stage: "qualifying", lead: {} };
  }

  console.error("No se pudo interpretar la respuesta del modelo:", raw);
  return { reply: "Disculpa, tuve un problema técnico. ¿Me repites lo último?", stage: "qualifying", lead: {} };
}

module.exports = { generateDemoReply };
