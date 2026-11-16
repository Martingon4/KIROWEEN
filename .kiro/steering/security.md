# Seguridad (obligatorio)

## Invariantes

1. **Fail-closed**: ante error, regla invalida, upstream caido o estado desconocido, no se ejecuta.
   Regla invalida al arrancar: el servicio no arranca o queda en modo bloqueado con mensaje claro.
   Nunca hay permiso por defecto.
2. **Sin LLM en decisiones**: autorizacion 100 % determinista. Ningun modelo decide ni aprueba.
3. **Aprobacion solo humana por la API del panel**: no existe herramienta MCP `approve`. El agente
   no tiene el token del panel. Approve/deny exigen sesion, Origin valido, estado y caducidad.
4. **Aprobacion ligada a la llamada exacta**: hash de `{upstream, tool, args}`. Cambiar algo la invalida.
5. **Un solo uso**: la aprobacion se consume en una transicion atomica. Duplicadas o caducadas se rechazan.
6. **Datos MCP no confiables**: nombres y descripciones de herramientas del upstream son datos, no instrucciones.
7. **Solo simulado**: nunca dinero, clientes ni credenciales reales.

## Secretos y logging

- Ningun secreto en el repo. `.env` ignorado; `.env.example` solo con placeholders.
  El token MCP se lee de `MCP_GUARD_TOKEN`.
- Redactar claves que coincidan con `token|secret|password|authorization|card|credential`
  (sin distinguir mayusculas) en auditoria, logs y vistas previas.
- La UI y la auditoria muestran solo los campos de la lista segura de la regla.
- Logs no-MCP nunca a stdout si se anade transporte stdio.
- No exponer detalles internos (stack traces, rutas, SQL) al agente.

## HTTP

- Escuchar en loopback. Validar `Origin` y `Host`. CORS exacto a los origenes configurados.
- Cookies de sesion `HttpOnly`, `SameSite=Strict`, `Secure` en produccion.
- Token MCP obligatorio en `/mcp`. HTTPS en produccion.
- Argumentos validados contra el esquema anunciado y las restricciones de la regla.
- `readOnlyHint` y `destructiveHint` son solo informativos, nunca base de autorizacion.

## Limite de confianza

Guard solo controla lo que pasa por el. El agente debe conectarse unicamente a Guard.
