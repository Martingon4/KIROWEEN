# MCP Guard

> MCP Guard convierte las llamadas de herramientas de agentes de IA en acciones controladas, revisables y auditables.

MCP Guard es una capa de control entre un agente de IA (aquí Kiro) y servidores MCP. Cada `tools/call` se compara con reglas explícitas y se decide de forma determinista, sin LLM:

- **Permitir**: la llamada cumple una regla de bajo riesgo exacta y pasa al servidor MCP.
- **Pedir aprobación**: la llamada queda pausada en una bandeja humana. Al aprobarla se ejecuta una sola vez.
- **Bloquear**: la llamada viola una regla o no tiene regla (denegar por defecto). El sistema de destino nunca la recibe.

Todo se audita con su motivo. La tienda, las órdenes y los reembolsos de la demo son datos simulados. No hay pagos reales ni comercio real.

- [Resumen en inglés](#english-summary)
- [Guion de demo (escenarios A a F)](docs/demo-script.md)
- [Modelo de amenazas](docs/threat-model.md)

## Estado y qué no se verificó

El código se escribió en un sandbox sin acceso al registro de npm, sin Docker y sin PostgreSQL. Por eso:

- **Verificado** (sin dependencias de terceros, `npm run test:core`): motor de políticas, hash canónico SHA-256, redacción, máquina de estados de aprobación, servicio central con los flujos A a F, validación de argumentos, saneado de auditoría, seguridad HTTP (bearer, Host, Origin, sesión, CSRF) y la tienda simulada. También pasa `npm run typecheck:core`.
- **No compilado ni ejecutado**: `apps/guard/src/{index.ts,config.ts,policy/loader.ts,mcp/server.ts,mcp/upstream.ts,db/prisma-repository.ts,api/routes.ts}`, `apps/demo-store-mcp/src/index.ts` y todo `apps/dashboard`. Usan Fastify, zod, yaml, el SDK MCP, Prisma y React. Las versiones están fijadas de memoria en los `package.json` y no se contrastaron con el registro.
- **Sin verificar**: la migración SQL `prisma/migrations/20250101000000_init/migration.sql` se escribió a mano para coincidir con `prisma/schema.prisma`. No se aplicó a ningún PostgreSQL. Los hooks de `.kiro/hooks` están escritos según el formato de Kiro recordado y no se probaron en el IDE.
- **Sin `package-lock.json`**: la primera persona con red debe generarlo con `npm install` y commitearlo.
- ESLint no se ejecutó porque `typescript-eslint` no se pudo instalar. Prettier sí.

Espere corregir errores de compilación o de versiones en la primera ejecución real.

## Arquitectura

```
Kiro --(tools/list, tools/call, Bearer MCP_GUARD_TOKEN)--> MCP Guard (127.0.0.1:3000/mcp)
                                                              |
                                                       motor de políticas
                                              (allow | require_approval | deny)
                                     allow |           | require_approval        | deny
                                           v           v                         v
                    tienda demo MCP (127.0.0.1:3001)  bandeja pendiente       auditoría
                                           ^           |
Persona --> panel web (127.0.0.1:3000) --> API del panel --> aprobar (misma llamada, una sola vez)

PostgreSQL (127.0.0.1:5432): reglas, auditoría y estado de solicitudes (sin argumentos en claro).
```

| Servicio                   | Dirección                            |
| -------------------------- | ------------------------------------ |
| Panel                      | `http://127.0.0.1:3000/`             |
| MCP de Guard               | `http://127.0.0.1:3000/mcp`          |
| Health                     | `http://127.0.0.1:3000/api/health`   |
| Tienda demo (solo Guard)   | `http://127.0.0.1:3001/mcp`          |
| PostgreSQL                 | `127.0.0.1:5432`                     |
| Vite (solo desarrollo)     | `http://127.0.0.1:5173/`             |

Garantías principales: decisión determinista, denegar por defecto, el agente nunca se aprueba a sí mismo (no existe herramienta MCP de aprobar), la aprobación queda ligada al hash de la llamada exacta y es de un solo uso, los argumentos originales de pendientes viven solo en memoria y al reiniciar todo pendiente expira sin ejecutarse.

## Requisitos

- Node.js 22 o superior (se usa `--experimental-strip-types`).
- npm 10 o superior.
- Docker con Compose (solo para PostgreSQL).
- `openssl` para generar secretos.

## Arranque

Desde la raíz del repositorio:

```bash
npm install
cp .env.example .env
```

Genere `MCP_GUARD_TOKEN` y `UPSTREAM_TOKEN` y péguelos en `.env` (Guard se niega a arrancar con `change-me` o con menos de 16 caracteres):

```bash
openssl rand -hex 32   # MCP_GUARD_TOKEN
openssl rand -hex 32   # UPSTREAM_TOKEN
```

El secreto del panel (`DASHBOARD_ADMIN_SECRET`) **no** debe estar en el `.env` que lee el entorno del agente. Guárdelo en un archivo propio con permisos 600, fuera del repositorio, y apunte a él con `DASHBOARD_ADMIN_SECRET_FILE` (Guard se niega a leerlo si es legible por grupo u otros):

```bash
mkdir -p ~/.config/mcp-guard && umask 077
openssl rand -hex 32 > ~/.config/mcp-guard/admin-secret
chmod 600 ~/.config/mcp-guard/admin-secret
# en .env: DASHBOARD_ADMIN_SECRET_FILE=/home/usuario/.config/mcp-guard/admin-secret
```

Riesgo residual: un agente con shell que corra con su mismo usuario de sistema puede leer ese archivo. Para separar de verdad al agente del revisor, ejecútelo con otro usuario o en un contenedor sin acceso a ese directorio. No use `grep` sobre el `.env` completo en el entorno del agente; el comando de abajo extrae solo `MCP_GUARD_TOKEN`.

Sin `openssl`: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

Base de datos, cliente Prisma y panel:

```bash
docker compose up -d db
npm run db:generate
npm run db:migrate
npm run build -w @mcp-guard/dashboard
```

Después arranque los tres procesos a la vez (tienda demo en `127.0.0.1:3001`, Guard y panel en `127.0.0.1:3000`, panel con recarga en caliente en `127.0.0.1:5173`):

```bash
npm run dev
```

`npm run dev` ejecuta `scripts/dev.mjs` (sin dependencias de terceros). Si un proceso termina, detiene los demás. También puede lanzarlos por separado con `npm run dev -w @mcp-guard/demo-store-mcp`, `-w @mcp-guard/guard` y `-w @mcp-guard/dashboard`.

Compruebe que responde: `curl http://127.0.0.1:3000/api/health`.

Para el desarrollo del panel abra `http://127.0.0.1:5173/` (su origen ya está en `PANEL_ALLOWED_ORIGINS`; el proxy de Vite reescribe `Host` a `127.0.0.1:3000` para pasar la validación de Guard).

### Scripts de `package.json` (raíz)

| Script                | Qué hace                                                    |
| --------------------- | ----------------------------------------------------------- |
| `npm run test:core`   | Pruebas `node --test` de los módulos sin dependencias       |
| `npm run typecheck:core` | `tsc -p tsconfig.core.json` sobre esos módulos           |
| `npm run build`       | Compila los workspaces que lo definen (el panel)            |
| `npm run typecheck`   | Typecheck por workspace                                     |
| `npm run lint`        | ESLint                                                      |
| `npm run format` / `npm run format:check` | Prettier                                |
| `npm run db:generate` / `npm run db:migrate` | Prisma generate / migrate deploy     |
| `npm run start`       | Arranca Guard sin `--watch`                                 |

## Variables de entorno (`.env.example`)

| Variable                  | Valor por defecto                                      | Uso                                                                  |
| ------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------- |
| `DATABASE_URL`            | `postgresql://guard:guard@127.0.0.1:5432/mcp_guard`    | Conexión a PostgreSQL del `docker-compose.yml`                        |
| `GUARD_HOST`              | `127.0.0.1`                                            | Interfaz de escucha (Guard fuerza loopback)                           |
| `GUARD_PORT`              | `3000`                                                 | Puerto del panel, `/mcp` y `/api`                                     |
| `UPSTREAM_URL`            | `http://127.0.0.1:3001/mcp`                            | Tienda demo. Solo se configura aquí, nunca desde la UI                |
| `UPSTREAM_PORT`           | `3001`                                                 | Puerto de la tienda demo                                              |
| `POLICY_FILE`             | `config/policy.example.yaml`                           | Reglas YAML, validadas al iniciar                                     |
| `MCP_GUARD_TOKEN`         | `change-me` (debe cambiarse)                           | Bearer que Kiro envía a `/mcp`                                        |
| `UPSTREAM_TOKEN`          | `change-me` (debe cambiarse)                           | Secreto compartido entre Guard y la tienda demo                       |
| `DASHBOARD_ADMIN_SECRET_FILE` | sin definir (recomendado)                          | Ruta a un archivo 600 con la contraseña del panel, fuera del `.env`   |
| `DASHBOARD_ADMIN_SECRET`  | sin definir                                            | Alternativa en línea a lo anterior. El agente no debe conocerla       |
| `PANEL_ALLOWED_ORIGINS`   | `http://127.0.0.1:3000,http://127.0.0.1:5173`          | Orígenes exactos permitidos para el panel                             |
| `DEMO_MODE`               | `true`                                                 | Habilita `POST /api/demo/reset`                                       |

`.env` está en `.gitignore`. No guarde secretos en el repositorio.

## Conectar Kiro

El archivo `.kiro/settings/mcp.json` ya está en el repositorio y no contiene el token:

```json
{
  "mcpServers": {
    "mcp-guard": {
      "url": "http://127.0.0.1:3000/mcp",
      "headers": { "Authorization": "Bearer ${MCP_GUARD_TOKEN}" }
    }
  }
}
```

Exporte el mismo valor que puso en `.env` en el entorno desde el que arranca Kiro, y reinicie Kiro después:

```bash
export MCP_GUARD_TOKEN="$(grep '^MCP_GUARD_TOKEN=' .env | cut -d= -f2-)"
```

Kiro debe listar cuatro herramientas: `demo_store.get_order`, `demo_store.issue_refund`, `demo_store.send_customer_email` y `guard.get_action_status`.

> **Advertencia:** no conecte la tienda demo (`http://127.0.0.1:3001/mcp`) directamente a Kiro. Una llamada directa evade Guard y no se controla ni se audita. El agente solo debe conocer `mcp-guard`. Guard controla únicamente lo que pasa por él.

## Panel

1. Abra `http://127.0.0.1:3000/`.
2. Inicie sesión con el valor de `DASHBOARD_ADMIN_SECRET`. Las llamadas que cambian estado exigen además la cabecera `X-CSRF-Token` y un `Origin` permitido (el panel lo gestiona solo).
3. Pantallas: inicio, bandeja, detalle de solicitud (con "No se ha llamado al sistema de destino" y los botones **Aprobar y ejecutar simulación** y **Rechazar**), auditoría con filtros y políticas en solo lectura.

### API del panel

`GET /api/health`, `POST /api/session` (cuerpo `{"secret": "..."}`), `GET /api/session`, `DELETE /api/session`, `GET /api/pending`, `GET /api/summary`, `GET /api/actions/:id`, `POST /api/actions/:id/approve`, `POST /api/actions/:id/deny`, `GET /api/audit?status=&tool=&from=&to=&limit=`, `GET /api/policy`, `GET /api/events` (SSE) y `POST /api/demo/reset` (solo con `DEMO_MODE=true`; `{"clearAudit": true}` borra además la auditoría). `GET /api/session` y `GET /api/summary` van más allá de la lista original del diseño.

## Escenarios de aceptación

Pasos exactos, prompts de ejemplo y resultados de auditoría esperados: [docs/demo-script.md](docs/demo-script.md). Resumen:

| Escenario | Llamada                                          | Resultado esperado                                            |
| --------- | ------------------------------------------------ | ------------------------------------------------------------- |
| A         | `demo_store.get_order` ORD-1042                  | Permitida por `read-order`, estado ejecutado                  |
| B         | Reembolso USD 10.00 (1000 centavos)              | Permitido por `small-refund`, un reembolso simulado           |
| C         | Reembolso USD 149.99, se aprueba                 | Pendiente, luego ejecutado una sola vez                       |
| D         | Reembolso USD 149.99, se rechaza                 | Denegado por la persona, sin reembolso                        |
| E         | Reembolso USD 700.00                             | Bloqueado por `block-large-refund`, upstream no llamado       |
| F         | Herramienta desconocida, monto negativo, EUR, tipo incorrecto | Bloqueado, upstream no llamado                   |

## Cómo se usó Kiro

- **Specs** (`.kiro/specs/mcp-guard/`): `requirements.md` produjo los criterios de aceptación y los escenarios A a F. `design.md` fijó la arquitectura, el modelo de datos y las transiciones de estado. `tasks.md` ordenó las fases 0 a 5 con criterios de salida. Los módulos puros (motor, aprobaciones, servicio central) salieron de las fases 3 y 4 del spec.
- **Steering** (`.kiro/steering/{product,architecture,security}.md`): fijó fail-closed, aprobación solo humana, sin LLM en decisiones, secretos fuera del repo, datos solo simulados, dinero en centavos enteros y sin logs con secretos. Evitó, por ejemplo, un `approve` como herramienta MCP, guardar argumentos en claro en la base y usar flotantes para montos.
- **Hooks** (`.kiro/hooks/`): formato y typecheck tras cada tarea, confirmación antes de usar herramientas MCP fuera de la demo, y un recordatorio de actualizar migración, docs y escenarios cuando cambian `prisma/schema.prisma` o `config/policy*.yaml`. Ahorraron revisiones manuales repetidas. Su formato no se probó en el IDE.
- **Agente Policy Reviewer** (`.kiro/agents/policy-reviewer.{json,md}`): asesora sobre reglas solapadas o inalcanzables, rutas que permiten sin regla explícita, replay o doble ejecución, secretos en logs y aprobaciones no ligadas al hash. No decide aprobaciones. Su revisión formal sobre el código final no se ha ejecutado.
- **Iteraciones importantes**: el motor de políticas no puede comprobar que la orden existe (necesita la tienda), así que el servicio central lo verifica antes de ejecutar `small-refund`. La migración se escribió a mano porque no había PostgreSQL. Se separó la lógica pura de la que depende de terceros para poder probar lo esencial sin `npm install`.
- **Limitaciones pendientes**: ver [Estado y qué no se verificó](#estado-y-qué-no-se-verificó). Además, las tablas `DemoOrder`, `DemoRefund` y `DemoEmail` existen en el esquema, pero la tienda demo guarda su estado en memoria. No hay prueba de integración extremo a extremo con Kiro real. Los umbrales de la política solo valen para la tienda simulada.

Modelo de amenazas: [docs/threat-model.md](docs/threat-model.md).

## English summary

MCP Guard sits between an AI agent (Kiro) and MCP servers. Every `tools/call` is matched deterministically (no LLM) against explicit YAML rules: **allow**, **require human approval** (paused in an inbox, executed exactly once after an authenticated click, bound to a SHA-256 hash of the exact call), or **deny** (default). Everything is audited with a reason and without secrets or plaintext arguments. The demo store, orders and refunds are simulated; there is no real money.

Quick start: `npm install`, `cp .env.example .env`, generate three secrets with `openssl rand -hex 32` (`MCP_GUARD_TOKEN`, `UPSTREAM_TOKEN`) and keep the panel secret in a chmod 600 file referenced by `DASHBOARD_ADMIN_SECRET_FILE`, outside the `.env` the agent can read, `docker compose up -d db`, `npm run db:generate`, `npm run db:migrate`, `npm run build -w @mcp-guard/dashboard`, then run `npm run dev` (starts demo store, Guard and dashboard in parallel). Dashboard and MCP endpoint: `http://127.0.0.1:3000/` and `/mcp`. Connect Kiro with the committed `.kiro/settings/mcp.json` after `export MCP_GUARD_TOKEN=...`. Never connect the demo store directly to Kiro.

Honesty note: the sandbox had no npm registry, Docker or PostgreSQL. The dependency-free core (policy engine, hashing, redaction, approval state machine, core service, HTTP security helpers, demo store) is tested with `npm run test:core`. The Fastify, MCP SDK, Prisma, zod, yaml and React code, the hand-written SQL migration and the Kiro hooks were never compiled or run, and `package-lock.json` still has to be generated by the first `npm install`.

Kiro was used for specs (requirements, design, phased tasks), steering (fail-closed, human-only approval, secrets and data rules), hooks (format and typecheck, MCP call confirmation, docs reminder on schema or policy change) and an advisory Policy Reviewer agent.

## Licencia

Ver [LICENSE](LICENSE).
