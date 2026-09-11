const { BUSINESS_UTC_OFFSET = "-04:00" } = process.env;

const BUSINESS_HOURS = { startHour: 9, endHour: 18 }; // 9am-6pm, lunes a viernes

function offsetMinutes() {
  const sign = BUSINESS_UTC_OFFSET.startsWith("-") ? -1 : 1;
  const [h, m] = BUSINESS_UTC_OFFSET.slice(1).split(":").map(Number);
  return sign * (h * 60 + m);
}

// Fecha/hora actual en el huso horario del negocio, como Date "corrido" para
// que sus getters UTC devuelvan la hora local del negocio directamente.
function businessNow() {
  const utcNow = Date.now();
  return new Date(utcNow + offsetMinutes() * 60 * 1000);
}

// Texto para inyectar en el system prompt — el modelo no tiene forma de saber
// qué día es "hoy" si no se lo decimos explícitamente en cada llamada.
function businessNowText() {
  const now = businessNow();
  const dias = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const dia = dias[now.getUTCDay()];
  const fecha = now.toISOString().slice(0, 10);
  const hora = now.toISOString().slice(11, 16);
  return `Hoy es ${dia} ${fecha} (formato AAAA-MM-DD) y son las ${hora} hs en el huso horario del negocio (UTC${BUSINESS_UTC_OFFSET}).`;
}

// Convierte "YYYY-MM-DD" + "HH:mm" en el huso horario del negocio a ISO UTC real.
function businessDateTimeToISO(dateStr, timeStr) {
  return `${dateStr}T${timeStr}:00${BUSINESS_UTC_OFFSET}`;
}

module.exports = { BUSINESS_HOURS, businessNow, businessNowText, businessDateTimeToISO };
