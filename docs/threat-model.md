# Modelo de amenazas

Alcance: MVP local de demostración con sistemas simulados. Guard solo controla lo que pasa por él.

## Activos

- Integridad de las acciones: que solo se ejecute lo que la política permite o una persona aprobó.
- Confidencialidad de secretos: `MCP_GUARD_TOKEN`, `UPSTREAM_TOKEN`, `DASHBOARD_ADMIN_SECRET`, cookie de sesión.
- Integridad de la auditoría.

## Límites de confianza

| Límite                    | Lado no confiable                 | Control                                                                                   |
| ------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------- |
| Kiro a Guard (`/mcp`)     | El agente y sus prompts           | Bearer `MCP_GUARD_TOKEN`, validación de Host y Origin, validación de argumentos, política |
| Navegador a API del panel | Cualquier página web abierta      | Sesión con cookie HttpOnly y SameSite=Strict, token CSRF, Origin exacto                   |
| Guard a tienda demo       | Metadatos y descripciones del MCP | URL fija por entorno, `UPSTREAM_TOKEN`, tabla propia de nombres públicos                  |
| Guard a PostgreSQL        | Nada, pero se minimizan los datos | Sin columna de argumentos en claro, solo hash y vista previa saneada                      |

## Amenazas y mitigaciones

| Amenaza                                                      | Mitigación                                                                                                                                                                                                                                                   | Estado                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| El agente se aprueba a sí mismo                              | No existe herramienta MCP de aprobar. Aprobar y rechazar solo están en la API del panel con sesión. El secreto se lee de un archivo 600 fuera del `.env` del agente (`DASHBOARD_ADMIN_SECRET_FILE`). Una prueba afirma que no hay herramienta de aprobación. | Parcial: ver riesgos                                        |
| Evasión llamando directo a la tienda demo                    | La tienda solo se conecta a Guard y exige `UPSTREAM_TOKEN`. Kiro solo se configura con `mcp-guard`. No se puede forzar desde Guard lo que Kiro conecte por su cuenta; el README lo advierte.                                                                 | Documentado, riesgo residual                                |
| Repetición (replay) o doble aprobación                       | La aprobación se consume en una transición atómica `pending_approval` a `approved`. Una segunda aprobación recibe conflicto.                                                                                                                                 | Probado                                                     |
| Cambiar herramienta o argumentos tras la solicitud           | El hash SHA-256 de JSON canónico `{upstream, tool, args}` se recalcula al aprobar. Si difiere, se rechaza. Se ejecuta la llamada guardada en memoria. El panel envía el hash que mostró y Guard lo exige al aprobar.                                         | Probado                                                     |
| Aprobación tardía                                            | Las pendientes caducan (180 s por defecto). Una caducada no se puede aprobar.                                                                                                                                                                                | Probado                                                     |
| Reinicio de Guard                                            | Los argumentos originales solo existen en memoria. Al arrancar toda pendiente se marca expirada y nunca se ejecuta sola.                                                                                                                                     | Probado en la lógica; arranque real sin ejecutar            |
| DNS rebinding contra el panel o `/mcp`                       | Escucha solo en 127.0.0.1, validación del encabezado Host contra nombres loopback exactos, validación de Origin cuando está presente.                                                                                                                        | Probado en el módulo de seguridad; integración sin ejecutar |
| CSRF desde otra web hacia el panel                           | SameSite=Strict, `X-CSRF-Token` por sesión y Origin permitido en rutas que cambian estado. Sin cabeceras CORS.                                                                                                                                               | Probado en el módulo; integración sin ejecutar              |
| Fuerza bruta del inicio de sesión                            | Limitador de intentos y comparación en tiempo constante del secreto.                                                                                                                                                                                         | Probado                                                     |
| Inyección en descripciones o nombres de herramientas del MCP | Los metadatos del upstream son datos no confiables. Guard publica su propia tabla de nombres y esquemas, rechaza nombres desconocidos y devuelve al agente solo texto.                                                                                       | Probado                                                     |
| Salida del upstream con contenido hostil                     | Solo se reenvían bloques de texto con límite de longitud. No se interpretan como instrucciones del sistema.                                                                                                                                                  | Probado                                                     |
| Fuga de secretos o datos en auditoría o logs                 | Redacción de claves `token`, `secret`, `password`, `authorization`, `card`, `credential`. Solo se muestran los campos de la lista segura de la regla.                                                                                                        | Probado                                                     |
| Valores de monto engañosos (negativos, flotantes, texto)     | Montos en centavos enteros. Tipos incorrectos, negativos y monedas no soportadas se deniegan antes de la política.                                                                                                                                           | Probado                                                     |
| Regla inválida o archivo de políticas ausente                | El arranque falla o el servicio queda en modo bloqueado que deniega todo. Nunca hay permiso por defecto.                                                                                                                                                     | Probado en el validador; cargador YAML sin ejecutar         |
| Tienda caída                                                 | Guard devuelve un error explícito y el estado queda `failed`. Nunca simula éxito.                                                                                                                                                                            | Probado                                                     |
| URL de upstream arbitraria                                   | `UPSTREAM_URL` solo por variable de entorno. La UI no permite configurarla.                                                                                                                                                                                  | Por diseño                                                  |

## Fuera de alcance y riesgos conocidos

- Autoaprobación por un agente con shell: el Origin solo frena a los navegadores, no a clientes no-navegador. Si el agente corre con el mismo usuario del sistema que Guard, puede leer el archivo del secreto y aprobar. Mitigación operativa: otro usuario o contenedor para el agente. No está resuelto por código en el MVP.
- Resultado del upstream: el resumen guardado se construye solo con campos identificadores (`id`, `orderId`, `status`, `amountCents`, `currency`, `code`). El texto libre (asunto, cuerpo, motivo) no se almacena ni se audita. El agente sí recibe el contenido devuelto cuando la acción se ejecuta.
- Aprobaciones interrumpidas: si falla el registro tras aprobar, la solicitud pasa a `failed` sin ejecutar. Si Guard cae durante la ejecución, al reiniciar las filas `approved` pasan a `failed` (`interrupted`); el resultado en el upstream es desconocido y no se reintenta.
- Limitador de inicio de sesión global: un proceso local con un Origin falsificado puede bloquear el inicio de sesión del revisor durante la ventana (60 s). Se acepta en el MVP de un solo usuario local.
- Pruebas de integración HTTP (`app.inject` para Host, Origin, cookies, CSRF y `/mcp`) pendientes hasta poder instalar dependencias.

- Pagos reales, multi-tenant, roles complejos, OAuth multiproveedor, IA que apruebe.
- HTTPS: el MVP es solo loopback. En producción haría falta HTTPS y cookies `Secure`.
- Un solo revisor de sesión demo (`demo-reviewer`): la auditoría identifica la sesión, no a una persona real.
- El código de integración (Fastify, SDK MCP, Prisma, React) no se compiló ni se ejecutó en el sandbox de desarrollo. Los controles marcados "sin ejecutar" deben verificarse en una primera ejecución real.
- Una revisión formal con el agente Policy Reviewer sobre el código final queda pendiente.
