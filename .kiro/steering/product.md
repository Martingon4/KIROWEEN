# Producto: MCP Guard

MCP Guard es una capa de control entre un agente de IA y servidores MCP. Cada `tools/call` se
compara con reglas explicitas y se decide: permitir, pedir aprobacion humana o bloquear. Todo se
audita con su motivo.

Frase guia: "MCP Guard convierte las llamadas de herramientas de agentes de IA en acciones
controladas, revisables y auditables."

## Alcance

- Solo sistemas simulados: tienda demo (`demo-store`), ordenes y reembolsos ficticios.
- Fuera del MVP: pagos reales, politicas en lenguaje natural, IA que apruebe, multi-tenant, OAuth
  multiproveedor, URLs de upstream arbitrarias desde la UI.
- Dinero siempre en centavos enteros (14999 = USD 149.99). Nunca floats.

## Demo

Consulta de orden (directa), reembolso pequeno (regla), reembolso mayor (pendiente hasta aprobar),
reembolso sobre el limite (bloqueado). Escenarios A-F en `docs/demo-script.md`.

## Idioma

Documentacion y textos de UI en espanol. Codigo e identificadores en ingles. Sin em dashes.
