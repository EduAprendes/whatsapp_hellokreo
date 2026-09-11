# whatsapp_hellokreo

Proyecto para conectar la IA (vendedor 24/7) al número real de WhatsApp
"Hellokreo" vía WhatsApp Cloud API (Meta), siguiendo
[[200-🌍AREAS/Kreo/WhatsApp 1/Guía desde cero — Configurar WhatsApp Cloud API]].

## Setup

```bash
npm install
cp .env.example .env
# completar .env con las credenciales de producción
npm run dev
```

## Estado

- [x] Número de producción registrado y verificado (envío/recepción probados por curl)
- [x] Token permanente del Usuario del sistema cargado en `.env`
- [x] App Secret cargado en `.env`
- [ ] Validación de `X-Hub-Signature-256` implementada en el webhook
- [ ] Webhook desplegado y suscrito en Meta
- [ ] Plantilla propia aprobada (necesaria para iniciar conversación sin que el cliente escriba primero)
- [ ] Lógica de IA conectada a los mensajes entrantes
