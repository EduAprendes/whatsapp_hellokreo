# Documentación — whatsapp_hellokreo

Contexto completo de este proyecto: vendedor digital 24/7 (Kreo) conectado al
número real de WhatsApp "Hellokreo" (+58 422-6773234) vía WhatsApp Cloud API.

Índice:

- [`whatsapp-setup.md`](./whatsapp-setup.md) — cómo se configuró la cuenta de Meta/WhatsApp para este proyecto (qué credenciales existen, dónde viven, lecciones aprendidas).
- [`arquitectura.md`](./arquitectura.md) — estructura del código, qué hace cada archivo, cómo se despliega en Vercel.
- [`flujo-demo.md`](./flujo-demo.md) — el guion de calificación de leads que se activa al escribir "DEMO".
- [`pendientes-e-ideas.md`](./pendientes-e-ideas.md) — qué falta.
- [`chatwoot-integracion.md`](./chatwoot-integracion.md) — integración con Chatwoot (Agent Bot) para responder manual desde el inbox: decisión tomada, código ya hecho, y pasos pendientes en el panel de Chatwoot.
- [`uso-chatwoot.md`](./uso-chatwoot.md) — guía práctica del día a día: cómo encontrar conversaciones, cuándo se apaga/reactiva la IA, cómo tomar el control manual.
- [`incidente-timeout-webhook.md`](./incidente-timeout-webhook.md) — incidente real (2026-09-11): Chatwoot apagaba el bot solo por timeout del webhook, causa raíz y fix aplicado.

Documento externo relacionado: `D:\Euro\200-🌍AREAS\Kreo\WhatsApp 1\Guía desde cero — Configurar WhatsApp Cloud API.md` (guía genérica, reutilizable para otros proyectos con WhatsApp Cloud API — este `docs/` es específico de Hellokreo).

Planificación de negocio del proyecto más amplio ("Vendedor IA 24/7 — Barquisimeto"): `D:\Programacion\organizacion_asana\docs\plan-agentes-ia-ventas.md`, Asana (gid `1218286414791651`) y Obsidian (`D:\Euro\200-🌍AREAS\Kreo\Vendedor IA 24-7\`).
