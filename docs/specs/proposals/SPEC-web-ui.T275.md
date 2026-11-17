# Propuesta: `/api/discover/airing` y `/recent` dicen si AniList no respondió

**Task:** T275 · **Módulo:** `web-ui` · **Estado:** pendiente de que lo integre el dueño del spec.

## Qué cambia

`AiringResponse` gana un campo opcional:

```ts
{ items: AiringItem[], unavailable?: boolean }
```

Las rutas `/api/discover/airing` y `/api/discover/recent` contestan `unavailable: true` cuando la
consulta a AniList no llegó a buen término (apagado por `RONA_ANILIST_OFFLINE`, timeout o error).
Siguen contestando `200` con `items: []`: no se convierten en un error de la home.

## Por qué

La crítica de la home midió el caso con `RONA_ANILIST_OFFLINE=1`: la parrilla decía «No hay
capítulos anunciados en los próximos días» cuando lo que pasaba era que AniList no había
contestado. La ruta ya sabía la diferencia (`resultado.ok`), pero la tiraba al devolver una lista
vacía. El cliente no podía distinguir «no hay estrenos» de «no hubo respuesta» y culpaba a la
fuente.

Ahora la fila elige su texto con `unavailable`: «AniList no ha contestado; la parrilla volverá
sola.» en vez del vacío normal.

## Efecto en los criterios

- `SPEC-web-ui.md` describe la respuesta de `/api/discover/airing` como `{ items }`; hay que añadir
  el campo opcional y su significado.
- Es aditivo: los clientes que no lo lean siguen funcionando.
- El campo no se usa para el top ni para el buscador; sólo para las dos filas que muestran la
  parrilla y las novedades.

## Verificación

`bun test packages/server/src/routes/anilist.test.ts` con `anilistOffline: true`: las dos rutas
devuelven `items: []` y `unavailable: true`. En la web,
`bun test packages/web/src/features/home` mide que una respuesta con `unavailable` pinta el aviso
de AniList y que una respuesta normal con la lista vacía sigue diciendo «no anuncia capítulos».
