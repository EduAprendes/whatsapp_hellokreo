# Configuración de WhatsApp Cloud API — Hellokreo

Sigue el paso a paso genérico de
`D:\Euro\200-🌍AREAS\Kreo\WhatsApp 1\Guía desde cero — Configurar WhatsApp Cloud API.md`.
Este documento anota lo específico de este proyecto (sin credenciales — esas viven solo en `.env`, gitignoreado).

## Cuenta y números

- **Número de producción:** "Hellokreo", +58 422-6773234
- **Número de prueba (solo para la plantilla `hello_world`):** +1 555 605 4102 — Meta la reserva exclusivamente para este número, no funciona en producción (error `#131058` si se intenta).
- **WABA de producción:** `2946719125671648`
- **Phone Number ID de producción:** `1279012775299913`

## Credenciales que hay en `.env` (no versionado)

| Variable | Qué es | Dónde se generó |
|---|---|---|
| `WHATSAPP_PHONE_NUMBER_ID` | ID del número Hellokreo | developers.facebook.com → App → WhatsApp → API Setup |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | ID del WABA | igual que arriba |
| `WHATSAPP_ACCESS_TOKEN` | Token **permanente** del Usuario del sistema (no expira) | business.facebook.com → Configuración del negocio → Usuarios del sistema → Generar nuevo token. **Requiere 2FA activado en la cuenta de Facebook**, si no, Meta no deja generarlo. |
| `WHATSAPP_APP_SECRET` | Clave secreta de la app, usada para validar la firma `X-Hub-Signature-256` de cada webhook | developers.facebook.com → App → Configuración → Básica → "Mostrar" |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Inventado (`openssl rand -hex 20`), solo para el handshake GET de verificación | generado localmente, no lo da Meta |

## Webhook

- URL configurada en Meta: `https://whatsapp-hellokreo.vercel.app/webhook`
- Suscrito al objeto `whatsapp_business_account`, campo `messages` (además se suscribió automático a `phone_number_name_update`, `phone_number_quality_update`, `security`).
- **Ojo:** verificar la URL (handshake GET) y suscribirse al campo `messages` son dos pasos separados en el panel — la URL puede quedar verificada sin que `messages` esté realmente suscrito, y ahí los mensajes entrantes nunca llegan aunque el webhook "parezca" configurado.

## Pruebas hechas (todas verificadas por curl y por WhatsApp real)

1. `GET /{phone-number-id}` con el token → confirma que el token funciona y a qué número apunta.
2. Envío de plantilla `hello_world` desde el número de prueba → llegó al celular del usuario.
3. Intento de `hello_world` desde el número de producción → rechazado (`#131058`), confirmando que esa plantilla es exclusiva del número de prueba.
4. Mensaje de texto libre desde producción, dentro de la ventana de 24h abierta al escribir primero al número real → llegó correctamente.
5. Webhook: handshake GET verificado, y `POST /webhook` recibiendo mensajes entrantes reales una vez se activó la suscripción al campo `messages`.

## Lecciones aprendidas (agregadas a la guía genérica también)

- El token permanente del Usuario del sistema requiere 2FA en la cuenta de Facebook.
- La plantilla `hello_world` solo se puede enviar desde el número de prueba, nunca desde un número de producción real.
- Verificar la URL del webhook ≠ suscribirse al campo `messages`. Son dos clics distintos en el mismo panel.
