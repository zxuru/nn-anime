# Propuesta · metadatos de películas y series (TMDB)

**Task T177 (roadmap 0.3).** Sobre `da4a526`. Origen: el diagnóstico
`docs/diagnostico-peliculas-series.md` (F7) y la decisión **D1** del humano: clave opcional de TMDB
en Ajustes, con el plugin como respaldo.

Toca **`SPEC-web-ui`** (un dato más en la ficha), **`SPEC-catalog-store`** (la clave en la tabla de
ajustes) y una **salida de red nueva** que hay que declarar en `SECURITY.md`. No toca el contrato de
plugin.

## El problema

AniList sólo cubre anime y manga. Para una película o una serie de acción real, la ficha se queda
con lo que devuelva el plugin: si no trae sinopsis, géneros o año, no hay respaldo. El
emparejamiento con AniList tampoco sirve: su catálogo no tiene esas obras.

## 1. La clave: opcional, local y nunca de vuelta

`PATCH /api/settings` acepta `tmdbApiKey`:

```ts
tmdbApiKey: z.string().regex(/^[a-f0-9]{32}$/i).nullable().optional()
```

- 32 hexadecimales, la forma de una clave v3. Una cadena con otra forma es **400** en la frontera,
  no un fallo en cada petición.
- `null` la borra. Ausente deja la que hubiera.
- `GET /api/settings` gana `tmdb: { configured: boolean }` y **no devuelve la clave**. Devolverla
  sería poner un secreto del usuario en una respuesta que el navegador guarda.
- Se guarda en la tabla `setting`, en claro. El riesgo residual —quien lea la base la lee— se
  declara en `SECURITY.md`; cifrarla con una llave en el mismo sitio sería seguridad de teatro.

La interfaz tiene un campo de tipo contraseña, con «Guardar» y «Quitar». No se rellena con la clave
guardada: el servidor no la manda.

## 2. La consulta: un host, una ruta y sin proxy de imágenes

```
GET https://api.themoviedb.org/3/search/movie?query=…&year=…&language=es-ES&api_key=…
GET https://api.themoviedb.org/3/search/tv?query=…&first_air_date_year=…&language=es-ES&api_key=…
```

- La base es **constante**: ninguna URL viene del cliente ni del plugin. Es la única salida nueva.
- Sin clave no se sale a la red. Con una fuente de anime tampoco: AniList ya cubre esa ficha.
- Se elige la coincidencia exacta por título normalizado; si no, el primer resultado, que es el
  orden de relevancia de TMDB.
- La respuesta se valida con Zod: un cuerpo con otra forma es «no hay metadatos», no medio dato.
- **Caché en memoria**, seis horas, por tipo y título normalizado. Guarda el resultado, no la
  petición: la clave no queda en ninguna entrada.
- **Degradación:** un 500, un timeout, un JSON roto o un fallo de red devuelven `null`. La ficha no
  falla; se queda con lo del plugin.
- **La portada no se pide a TMDB.** La imagen exigiría otro proxy y una lista blanca nueva; la
  ficha ya tiene la del plugin. Los géneros se traducen con una tabla de ids estables, sin una
  petición más.

## 3. La ruta y la ficha

```
GET /api/anime/:providerId/:ref/metadata → { metadata: { source: 'tmdb', synopsis?, genres, year? } | null }
```

- Sin clave, `{ metadata: null }`.
- Fuente de anime, `{ metadata: null }` sin preguntar.
- El detalle del título sale de la caché de siempre (`container.getAnime`); si esa lectura falla,
  502, porque es la ficha de la aplicación, no el tercero.

La ficha **compone**: manda el plugin. TMDB sólo rellena `synopsis` si falta, `genres` si viene
vacío y `year` si no lo hay. La portada y el `kind` no cambian. Cuando aportó algo, se atribuye con
una línea «Sinopsis, géneros y año: TMDB.».

## 4. Lo que no cambia

- El contrato de plugin, ni `PROVIDER_API_VERSION`.
- El proxy de streams y su lista blanca: TMDB no pasa por él.
- La caché de AniList y el presupuesto de una petición cada dos segundos.
- La ficha de anime: sigue usando AniList y no pregunta a TMDB.

## 5. Verificación

- `settings.test.ts`: la clave nace sin configurar, se guarda, **no aparece en el cuerpo** de la
  respuesta, `null` la borra y una forma inválida es 400.
- `tmdb.test.ts`: sin clave no hay fetch; una fuente de anime no lo hay; con clave, una película
  recibe sinopsis, géneros y año; un 500 y una forma rara degradan a ` null`; la segunda lectura no
  vuelve a TMDB; un proveedor inexistente es 404.
- `detail.test.tsx`: `conMetadatos` no pisa lo del plugin y rellena lo que falta; la lectura lo
  atribuye; sin metadatos no aparece «TMDB».
- `bun test` y `bun run e2e` en verde; el e2e corre sin clave, así que mide el camino de
  degradación, no una llamada real.

## 6. Riesgo residual

La clave vive en claro en `nn-anime.db`. La lee el propio usuario, un plugin sin sandbox o
cualquier programa con sus permisos. No se cifra; se declara en `SECURITY.md` y quien no quiera ese
riesgo no pone clave.
