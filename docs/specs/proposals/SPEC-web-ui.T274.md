# Propuesta: `/api/search` sin término no consulta a las fuentes

**Task:** T274 · **Módulo:** `web-ui` · **Estado:** pendiente de que lo integre el dueño del spec.

## Qué cambia

`GET /api/search` con `q` vacío (o sólo espacios) deja de llamar a `searchAll` y cierra con
`{"type":"done","providers":0}`. La ruta sigue aceptando `q` como cadena vacía: el cambio es de
comportamiento, no de forma.

En la interfaz, `useSearchStream` tampoco abre el stream con una consulta vacía: `/search` muestra
solo la invitación a escribir.

## Por qué

Abrir `/search` sin término preguntaba el catálogo entero a todas las fuentes. Es tráfico contra
terceros que el usuario no pidió, y convertía la pantalla de invitación en un listado arbitrario
(«12 resultados de 1 proveedores»). Lo reportó la crítica de Buscar
(`.impeccable/critique/2026-11-17T18-05-03Z__packages-web-src-features-search-searchpage-tsx.md`,
P1 «Abrir `/search` sin término consulta a todas las fuentes y enseña resultados»).

## Efecto en los criterios

- `SPEC-web-ui.md` sigue diciendo `GET /api/search?q=&provider=`. Hay que añadir que `q` vacío no
  dispara proveedores y que el cierre es `providers: 0`.
- La prueba `sin q busca igual: el catálogo entero del proveedor` se sustituye por
  `sin q no consulta a las fuentes y cierra en cero`.
- El CLI y cualquier otro cliente que quiera el catálogo entero tendrán que pedirlo por una ruta
  propia o con un término; no se conserva el atajo implícito.

## Verificación

`bun test packages/server/src/routes/search.test.ts` con un proveedor espía: `search` no se llama y
el SSE es un único `done` con cero. `bun test packages/web/src/features/search` cubre la guarda del
gancho (`consultaVacia`) y la pantalla de invitación.
