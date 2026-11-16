# Guion de demo: escenarios A a F

Todo es simulado: no hay dinero, clientes ni correos reales. Los montos van en centavos enteros (14999 = USD 149.99).

Estado de verificación: los flujos de decisión de estos escenarios están cubiertos por pruebas sin dependencias (`npm run test:core`). El recorrido completo con Kiro, Fastify, PostgreSQL y el panel no se pudo ejecutar en el sandbox donde se escribió el código. Si algo difiere de lo descrito aquí, es un defecto a corregir.

## Preparación

1. Siga la sección "Arranque" del [README](../README.md): `.env` con tres secretos, `docker compose up -d db`, `npm run db:generate`, `npm run db:migrate`, `npm run build -w @mcp-guard/dashboard`, y en dos terminales `npm run dev -w @mcp-guard/demo-store-mcp` y `npm run dev -w @mcp-guard/guard`.
2. Compruebe `curl http://127.0.0.1:3000/api/health`.
3. Exporte el token y abra Kiro en este repositorio: `export MCP_GUARD_TOKEN="$(grep '^MCP_GUARD_TOKEN=' .env | cut -d= -f2-)"`. Kiro debe listar `demo_store.get_order`, `demo_store.issue_refund`, `demo_store.send_customer_email` y `guard.get_action_status`.
4. Abra `http://127.0.0.1:3000/` e inicie sesión con `DASHBOARD_ADMIN_SECRET`.
5. Restaure los datos semilla (ver [Reinicio](#reinicio-entre-ensayos)).

Datos semilla de la tienda:

| Orden    | Cliente       | Estado  | Moneda | Total                   |
| -------- | ------------- | ------- | ------ | ----------------------- |
| ORD-1042 | Ada Ficticia  | paid    | USD    | 14999 centavos (149.99) |
| ORD-1043 | Berto Ejemplo | paid    | USD    | 4500 centavos (45.00)   |
| ORD-1044 | Carla Demo    | shipped | USD    | 82000 centavos (820.00) |

Reglas (`config/policy.example.yaml`): `read-order` permite; `small-refund` permite USD de 1 a 2500 centavos (y Guard exige que la orden exista); `refund-review` pide aprobación de 2501 a 50000; `block-large-refund` bloquea desde 50001; `email-review` pide aprobación; todo lo demás se deniega. La aprobación caduca a los 180 segundos.

## Escenario A: consultar una orden (permitida)

Prompt para Kiro: `Usa demo_store.get_order para consultar la orden ORD-1042 y dime su cliente, estado y total.`

Resultado esperado:

- Kiro muestra la orden ORD-1042: Ada Ficticia, `paid`, USD 149.99.
- Panel, Auditoría: una fila `demo_store.get_order`, regla `read-order`, estado **ejecutado**, secuencia solicitado, permitido, ejecutado.

## Escenario B: reembolso pequeño (permitido por regla)

Prompt: `Emite un reembolso de 1000 centavos USD para la orden ORD-1042 con el motivo "producto dañado" usando demo_store.issue_refund.`

Resultado esperado:

- Kiro recibe la confirmación del reembolso simulado.
- Auditoría: `demo_store.issue_refund`, regla `small-refund`, estado **ejecutado**, vista previa con orden ORD-1042, monto 1000 USD.
- La tienda registra exactamente un reembolso de 1000 centavos.

## Escenario C: reembolso de USD 149.99 aprobado

Prompt: `Emite un reembolso de 14999 centavos USD para la orden ORD-1042 con el motivo "cliente insatisfecho" usando demo_store.issue_refund. Después consulta el estado con guard.get_action_status.`

Pasos y resultado esperado:

1. Kiro recibe un resultado MCP con `status: "pending_approval"` y un `requestId`. El upstream no se llamó.
2. En el panel, Bandeja: aparece la solicitud con regla `refund-review`, tiempo restante y la nota "No se ha llamado al sistema de destino".
3. Abra el detalle: "Emitir reembolso simulado de USD 149.99 para orden ORD-1042", hash corto y herramienta. Pulse **Aprobar y ejecutar simulación** y confirme dentro de 180 segundos.
4. Pida a Kiro: `Consulta guard.get_action_status con el requestId anterior.` Debe responder estado `executed` con un resumen del resultado.
5. Auditoría: estado **ejecutado**, aprobador `demo-reviewer`, secuencia solicitado, pendiente de aprobación, aprobado, ejecutado.
6. La tienda registra exactamente un reembolso. Pulsar aprobar otra vez devuelve conflicto (HTTP 409) y no ejecuta de nuevo.

## Escenario D: reembolso de USD 149.99 rechazado

Mismo prompt que en C.

1. Kiro recibe `pending_approval` y un `requestId`.
2. En el panel pulse **Rechazar** y confirme.
3. `guard.get_action_status` devuelve estado `denied`.
4. Auditoría: estado **rechazado**, responsable `demo-reviewer`, motivo de la regla `refund-review` ("El monto requiere aprobación humana."). La tienda no registra ningún reembolso.

Si deja pasar 180 segundos sin decidir, el estado pasa a **expirado** y tampoco se ejecuta.

## Escenario E: reembolso sobre el límite (bloqueado)

Prompt: `Emite un reembolso de 70000 centavos USD para la orden ORD-1044 con el motivo "prueba" usando demo_store.issue_refund.`

Resultado esperado:

- Kiro recibe un error MCP de estado `blocked` que indica que no se ejecutó nada. No hay `requestId` pendiente ni botón de aprobar.
- Auditoría: estado **bloqueado**, regla `block-large-refund`, motivo "El monto supera el límite de demostración." El upstream no se llamó y no hay reembolso.

## Escenario F: llamadas inválidas (denegadas)

Pida a Kiro, una por una (si Kiro se niega a enviarlas por el esquema, indíquele que reintente con el valor tal cual):

1. Herramienta desconocida: `Llama a demo_store.delete_order con orderId ORD-1042.`
2. Monto negativo: `Emite un reembolso de -500 centavos USD para ORD-1042.`
3. Moneda no soportada: `Emite un reembolso de 1000 centavos EUR para ORD-1042.`
4. Tipo incorrecto: `Emite un reembolso con amountCents "mil" (texto) para ORD-1042.`

Resultado esperado en cada caso: Kiro recibe un resultado de error `blocked` y el upstream no se llama. Auditoría: estado **bloqueado** con un motivo seguro (por ejemplo "Herramienta desconocida" o "Argumentos invalidos"). La auditoría no guarda los argumentos en claro, solo el hash y una vista previa saneada.

## Reinicio entre ensayos

Con `DEMO_MODE=true`, desde el panel use el control de restaurar datos semilla, o por API (sesión y token CSRF obtenidos de `POST /api/session`):

```bash
curl -s -c jar.txt -H 'Origin: http://127.0.0.1:3000' -H 'Content-Type: application/json' \
  -d "{\"secret\":\"$DASHBOARD_ADMIN_SECRET\"}" http://127.0.0.1:3000/api/session
# copie csrfToken de la respuesta
curl -s -b jar.txt -X POST -H 'Origin: http://127.0.0.1:3000' -H 'X-CSRF-Token: <csrfToken>' \
  -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:3000/api/demo/reset
```

Con `{"clearAudit": true}` se borra además la auditoría. Sin esa opción la auditoría se conserva. Reiniciar Guard hace que toda solicitud pendiente expire sin ejecutarse.

## Guion de video de 2:30

| Tiempo      | Contenido                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------- |
| 0:00 a 0:15 | Frase del proyecto y el problema: un agente con herramientas puede actuar sin que nadie lo vea. |
| 0:15 a 0:40 | Arquitectura en un diagrama: Kiro, Guard, motor de políticas, tienda simulada, panel.           |
| 0:40 a 0:55 | Escenario A y B en Kiro: se permiten por regla. Mostrar la auditoría.                           |
| 0:55 a 1:35 | Escenario C: pendiente, panel en vivo, detalle explicativo, aprobar, `guard.get_action_status`. |
| 1:35 a 1:50 | Escenario D: rechazar y comprobar que no hubo reembolso.                                        |
| 1:50 a 2:05 | Escenarios E y F: bloqueo antes del upstream y motivo seguro.                                   |
| 2:05 a 2:30 | Cómo se usó Kiro (specs, steering, hooks, Policy Reviewer) y limitaciones honestas.             |
