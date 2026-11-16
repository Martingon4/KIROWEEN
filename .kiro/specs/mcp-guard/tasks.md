# Tareas: MCP Guard

Leyenda: `[x]` hecho y verificado, `[~]` escrito pero no compilado ni ejecutado en el sandbox, `[ ]` pendiente.

## Fase 0: spec, steering y estructura

- [x] Spec (`requirements.md`, `design.md`, `tasks.md`), steering, hooks, agente Policy Reviewer, `.kiro/settings/mcp.json`, archivos raiz.
- Salida: archivos presentes, `.kiro` no ignorado por git, `config/policy.example.yaml` valido, JSON parseable, Prettier limpio.

## Fase 1: esqueleto ejecutable

- [~] Fastify con `/api/health`, React + Vite, upstream demo minimo, PostgreSQL con Compose, README con comandos de arranque. Escrito; Fastify, Vite y Compose no se ejecutaron en el sandbox.
- Salida: los comandos `npm run dev -w ...` por workspace levantan upstream y Guard (`npm run dev` en la raiz se bloquea en Vite); health responde; dashboard servido por el backend o proxy dev indicado.

## Fase 2: transporte MCP

- [~] Streamable HTTP en Guard y upstream, descubrimiento de herramientas, namespace `demo_store.*`, mapeo publico a original, configuracion de Kiro, token MCP y validacion de Origin. Tabla de nombres y validacion probadas; transporte con el SDK sin compilar.
- Salida: Kiro lista las tres herramientas mas `guard.get_action_status`; nombre desconocido se rechaza.

## Fase 3: motor de politicas

- [x] YAML validado, condiciones exactas, prioridad deny > require_approval > allow, defecto deny, motivo, respuestas MCP, registro de decisiones, tests con `node --test`. El cargador YAML con zod no se ejecuto.
- Salida: escenarios A, B, E y F pasan; regla invalida impide arrancar; tests del motor en verde.

## Fase 4: aprobacion humana

- [~] Maquina de estados atomica, pendientes en memoria y expiracion, vista previa saneada y hash, bandeja y detalle, approve/deny con sesion y Origin, ejecucion exacta una sola vez, `guard.get_action_status`. Logica probada; rutas y panel sin compilar.
- Salida: escenarios C y D pasan; doble aprobacion, expirada y hash distinto se rechazan; reinicio expira pendientes.

## Fase 5: auditoria y acabado

- [~] Historial con filtros, SSE y reconexion visible, redaccion, estados de carga, vacio y error, reset demo, estilo y accesibilidad, `docs/demo-script.md`, `docs/threat-model.md`. Documentos escritos; panel y SSE sin ejecutar; revision del Policy Reviewer pendiente.
- Salida: escenarios A-F reproducibles con los pasos documentados; sin secretos en auditoria ni logs; revision del Policy Reviewer sin hallazgos criticos.
