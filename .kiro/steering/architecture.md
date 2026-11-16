# Arquitectura

Monorepo npm workspaces, TypeScript en todo, Node LTS.

- `apps/guard`: Fastify, endpoint MCP Streamable HTTP, API del panel, SSE.
  Subcarpetas: `mcp`, `policy`, `approvals`, `audit`, `api`, `db`.
- `apps/dashboard`: React + Vite.
- `apps/demo-store-mcp`: upstream simulado (`get_order`, `issue_refund`, `send_customer_email`).
- `packages/shared`: tipos, esquemas Zod, canonical JSON y hash.
- `prisma/`: esquema y migraciones. PostgreSQL via Docker Compose.

## Reglas de modularidad

1. `policy`, `approvals`, `audit` y `packages/shared` son modulos puros: sin imports de
   terceros, sin I/O, testeables con `node --test`.
2. El motor de politicas recibe (upstream, tool, args validados) y devuelve
   `allow | require_approval | deny` con regla, motivo y campos seguros. No conoce Fastify, MCP ni Prisma.
3. Prioridad `deny > require_approval > allow`. Sin coincidencia: `deny`.
4. Hash = SHA-256 del JSON canonico de `{upstream, tool, args}` (claves ordenadas).
5. Pendientes: payload completo solo en memoria. La base guarda resumen saneado y hash.
6. Transiciones de estado atomicas (consumo unico de la aprobacion).
7. Escuchar en `127.0.0.1`. Endpoints: panel `:3000/`, MCP `:3000/mcp`, health `:3000/api/health`,
   upstream `:3001/mcp`.

## Reglas TypeScript

- `strict: true`, sin `any` (ESLint lo prohibe). Usar `unknown` y validar con Zod en los bordes.
- Tipos de union discriminada para decisiones y estados; `switch` exhaustivo.
- Montos como `number` entero en centavos, validados con `Number.isSafeInteger`.
- Sin dependencias nuevas sin justificarlas; versiones fijadas.
- Prettier y ESLint obligatorios antes de cerrar una tarea.
