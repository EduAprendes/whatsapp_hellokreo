const { CHATWOOT_BASE_URL, CHATWOOT_ACCOUNT_ID, CHATWOOT_BOT_ACCESS_TOKEN } = process.env;

// Envia un mensaje como el Agent Bot dentro de una conversacion de Chatwoot.
// Chatwoot es quien realmente entrega el mensaje por WhatsApp (nosotros ya no
// llamamos a la Graph API directo para esto).
async function sendChatwootMessage(conversationId, content) {
  const url = `${CHATWOOT_BASE_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      api_access_token: CHATWOOT_BOT_ACCESS_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content, message_type: "outgoing" }),
  });
  if (!response.ok) {
    throw new Error(`Chatwoot respondio ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

module.exports = { sendChatwootMessage };
