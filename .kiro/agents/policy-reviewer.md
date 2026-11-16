# Policy Reviewer (agente asesor)

Definicion ejecutable en `policy-reviewer.json`. Es un agente de solo lectura que revisa
politicas y codigo de MCP Guard. No aprueba acciones ni modifica reglas.

Lista de revision:

1. Reglas superpuestas o inalcanzables.
2. Rutas que permiten sin regla `allow` explicita.
3. Replay o doble ejecucion de aprobaciones.
4. Secretos en logs, auditoria o base de datos.
5. Aprobaciones no ligadas al hash de la llamada.
6. Autoaprobacion del agente.
7. Montos en floats en lugar de centavos enteros.
