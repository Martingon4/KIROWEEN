# Requisitos: MCP Guard

Formato EARS. "El sistema" es MCP Guard salvo indicacion contraria.

## FR-01 Conectar upstream

Historia: como operador quiero que Guard descubra las herramientas del upstream configurado.

1. CUANDO Guard inicia, ENTONCES el sistema SHALL conectarse al upstream configurado y listar sus herramientas.
2. SI el upstream no esta disponible, ENTONCES el sistema SHALL registrar el error y no simular exito.
3. El sistema SHALL NOT aceptar URLs de upstream arbitrarias desde la UI ni desde argumentos MCP.

## FR-02 Nombres unicos

1. El sistema SHALL exponer `demo_store.get_order`, `demo_store.issue_refund` y `demo_store.send_customer_email`.
2. El sistema SHALL mantener una tabla nombre publico a (upstream, herramienta original).
3. CUANDO llega un nombre desconocido, ENTONCES el sistema SHALL denegar sin llamar al upstream.

## FR-03 Reglas declarativas

1. El sistema SHALL cargar reglas desde un archivo YAML y validarlas al iniciar.
2. SI una regla es invalida, ENTONCES el sistema SHALL detener el arranque o quedar en modo bloqueado con mensaje claro.
3. CUANDO ninguna regla coincide, ENTONCES el sistema SHALL denegar.
4. La prioridad SHALL ser `deny > require_approval > allow`.
5. `get_order` SHALL permitirse.
6. `issue_refund` con moneda USD y monto de 1 a 2500 centavos SHALL permitirse (orden existente).
7. `issue_refund` USD de 2501 a 50000 centavos SHALL requerir aprobacion.
8. `issue_refund` de 50001 centavos o mas SHALL bloquearse.
9. `send_customer_email` SHALL requerir aprobacion.
10. Cualquier otra herramienta SHALL bloquearse. `approval.ttlSeconds` SHALL ser 180.

Politica de referencia: `config/policy.example.yaml`.

## FR-04 Bandeja de pendientes

1. El sistema SHALL listar pendientes con ID corto, hora, herramienta, sistema destino, resumen permitido por la regla, monto y moneda, motivo y tiempo restante.
2. El detalle SHALL advertir que la accion simulada se ejecutara al aprobar y que aun no se ha llamado al destino.
3. El detalle SHALL ofrecer Aprobar y Rechazar.

## FR-05 Aprobacion segura

1. CUANDO una persona autenticada aprueba, ENTONCES el sistema SHALL comprobar que la solicitud esta pendiente, no expirada y con hash coincidente, y SHALL ejecutar la llamada guardada una sola vez.
2. Una aprobacion caducada, duplicada o con hash distinto SHALL rechazarse.
3. SI el upstream falla, ENTONCES el estado SHALL indicar error, no exito.
4. CUANDO se rechaza, ENTONCES el sistema SHALL NOT llamar al upstream.
5. Tras un reinicio, las pendientes SHALL expirar y no ejecutarse.

## FR-06 Estado de accion por MCP

1. El sistema SHALL ofrecer la herramienta de solo lectura `guard.get_action_status` con `requestId` (string, requerido) y `additionalProperties: false`. Descripcion: "Consulta el estado de una llamada MCP protegida por Guard."
2. El resultado SHALL incluir estado, decision, motivo y resumen de resultado, sin argumentos secretos.
3. El sistema SHALL NOT exponer ninguna herramienta MCP de aprobacion.

## FR-07 Auditoria minima

1. El sistema SHALL registrar ID, hora de creacion y de cada transicion, herramienta, upstream, decision, regla, motivo, SHA-256 de args, vista previa saneada, estado final, duracion, revisor y error resumido.
2. El sistema SHALL NOT registrar tokens, contrasenas, `Authorization` ni contenido sensible completo.
3. Estados distinguibles: solicitado, aprobado, rechazado, bloqueado, expirado, ejecutado, fallido.

## FR-08 Historial

1. El sistema SHALL filtrar el historial por estado, herramienta y fecha.
2. El detalle SHALL mostrar la secuencia de eventos.

## FR-09 Tiempo real

1. El sistema SHALL emitir eventos por SSE al panel.
2. El panel SHALL mostrar el estado de reconexion.

## FR-10 Restaurar datos semilla

1. En modo demo, el sistema SHALL permitir restaurar los datos semilla.
2. El sistema SHALL NOT borrar la auditoria salvo eleccion explicita de limpiar datos demo.
3. Fuera del modo demo, el endpoint SHALL rechazar la peticion.

## Escenarios de aceptacion A-F

Ver seccion 18 del brief y `docs/demo-script.md`: A consulta, B reembolso pequeno, C aprobado,
D rechazado, E bloqueado por limite, F entradas invalidas denegadas.
