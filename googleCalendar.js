const { JWT } = require("google-auth-library");
const { BUSINESS_HOURS, businessDateTimeToISO } = require("./businessTime");

const { GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY, GOOGLE_CALENDAR_ID } = process.env;

let _client = null;
function getClient() {
  if (!_client) {
    _client = new JWT({
      email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/calendar"],
    });
  }
  return _client;
}

async function calendarFetch(path, options = {}) {
  const client = getClient();
  const { token } = await client.getAccessToken();
  const response = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`Google Calendar respondio ${response.status}: ${await response.text()}`);
  }
  if (response.status === 204) return null; // DELETE no devuelve body
  return response.json();
}

// Devuelve los periodos ocupados (busy) entre dos fechas ISO (con offset de huso horario).
async function getBusyPeriods(timeMinISO, timeMaxISO) {
  const data = await calendarFetch("/freeBusy", {
    method: "POST",
    body: JSON.stringify({
      timeMin: timeMinISO,
      timeMax: timeMaxISO,
      items: [{ id: GOOGLE_CALENDAR_ID }],
    }),
  });
  return data.calendars?.[GOOGLE_CALENDAR_ID]?.busy || [];
}

// Crea el evento solo si el horario sigue libre (recheck real contra el calendario,
// no confia en lo que la IA haya calculado antes).
async function createEventIfFree({ startISO, endISO, summary, description }) {
  const busy = await getBusyPeriods(startISO, endISO);
  if (busy.length > 0) {
    return { created: false, reason: "horario_ocupado" };
  }

  const event = await calendarFetch(`/calendars/${encodeURIComponent(GOOGLE_CALENDAR_ID)}/events`, {
    method: "POST",
    body: JSON.stringify({
      summary,
      description,
      start: { dateTime: startISO },
      end: { dateTime: endISO },
    }),
  });

  return { created: true, eventId: event.id, htmlLink: event.htmlLink };
}

async function getEvent(eventId) {
  return calendarFetch(`/calendars/${encodeURIComponent(GOOGLE_CALENDAR_ID)}/events/${eventId}`);
}

// Mueve un evento existente a un horario nuevo, solo si de verdad esta
// libre. El propio horario actual del evento no cuenta como "ocupado" (si
// no, nunca se podria reagendar nada).
async function updateEventIfFree({ eventId, startISO, endISO }) {
  const current = await getEvent(eventId);
  const busy = await getBusyPeriods(startISO, endISO);
  const realConflicts = busy.filter(
    (b) => !(b.start === current.start?.dateTime && b.end === current.end?.dateTime)
  );
  if (realConflicts.length > 0) {
    return { updated: false, reason: "horario_ocupado" };
  }

  const updated = await calendarFetch(`/calendars/${encodeURIComponent(GOOGLE_CALENDAR_ID)}/events/${eventId}`, {
    method: "PATCH",
    body: JSON.stringify({ start: { dateTime: startISO }, end: { dateTime: endISO } }),
  });
  return { updated: true, eventId: updated.id, htmlLink: updated.htmlLink };
}

async function cancelEvent(eventId) {
  await calendarFetch(`/calendars/${encodeURIComponent(GOOGLE_CALENDAR_ID)}/events/${eventId}`, {
    method: "DELETE",
  });
  return { cancelled: true };
}

// Franjas libres de 30 min dentro del horario de atencion (9-18) para una
// fecha dada, chequeadas contra el free/busy real del calendario. La IA
// nunca debe inventar horarios — siempre pasa por acá.
async function listAvailableSlots(dateStr) {
  const dayOfWeek = new Date(`${dateStr}T12:00:00Z`).getUTCDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) return []; // fin de semana, sin atencion

  const dayStartISO = businessDateTimeToISO(dateStr, `${String(BUSINESS_HOURS.startHour).padStart(2, "0")}:00`);
  const dayEndISO = businessDateTimeToISO(dateStr, `${String(BUSINESS_HOURS.endHour).padStart(2, "0")}:00`);
  const busy = await getBusyPeriods(dayStartISO, dayEndISO);

  const slots = [];
  for (let hour = BUSINESS_HOURS.startHour; hour < BUSINESS_HOURS.endHour; hour += 0.5) {
    const h = Math.floor(hour);
    const m = hour % 1 === 0 ? "00" : "30";
    const slotStart = businessDateTimeToISO(dateStr, `${String(h).padStart(2, "0")}:${m}`);
    const slotEnd = new Date(new Date(slotStart).getTime() + 30 * 60 * 1000).toISOString();
    const overlaps = busy.some((b) => new Date(slotStart) < new Date(b.end) && new Date(slotEnd) > new Date(b.start));
    if (!overlaps) slots.push(`${String(h).padStart(2, "0")}:${m}`);
  }
  return slots;
}

module.exports = { getBusyPeriods, createEventIfFree, updateEventIfFree, cancelEvent, listAvailableSlots };
