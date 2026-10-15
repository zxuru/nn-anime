# SPEC-anime-detail.T130 — el género y el estudio llevan a sus títulos

**Estado:** propuesta, sin integrar. La integra el dueño de `docs/specs/SPEC-anime-detail.md`, que
anota la aprobación y borra este archivo.

Se apoya en `docs/specs/proposals/SPEC-anime-detail.T127.md`, **también pendiente**: aquélla pone los
géneros y los estudios en la pista de datos de la lectura; ésta los convierte en enlaces. Se pueden
integrar en cualquier orden, pero la segunda describe la línea de `.detail__datos` tal y como queda
con la primera.

## Qué cambia

En el bloque `web-ui` del «Contrato», dentro de `.detail__datos`, se añade:

- **El nombre de un género y el de un estudio son enlaces** a la búsqueda por ese término
  —`/search?q=<nombre>`—, que es la misma salida que ya usa la banda de géneros de la vitrina. El
  enlace dice a dónde lleva en su `title`: «Ver los títulos del género {name}» y «Ver los títulos de
  {name}».
- Los dos nombres siguen **sin `kind`**: lo que devuelve la búsqueda es un `SearchResult` de su
  proveedor, y el reparto entre las dos mitades lo hace el `kind` de cada título, como en el resto
  de la aplicación. Pulsar «Estudio Cobre» y cambiar a la pestaña de películas enseña las películas
  de ese estudio sin volver a buscar.

En el «Objective», el criterio 2 pasa a decir, tras la frase de los datos:

> Los nombres de los géneros y de los estudios son enlaces a la búsqueda por ese término: la ficha
> deja de ser un callejón sin salida para lo que el catálogo ya conoce.

## Por qué

Se pidió así: «utilizando los géneros o el nombre de estudios pueda llegar a otros animes que
coincidan o a películas de los mismos». El nombre de un estudio era texto muerto —se leía y no
llevaba a ninguna parte—, y el de un género llevaba a la búsqueda sólo desde la vitrina.

Lo que responde a esa búsqueda es el **catálogo local**: los títulos cuya ficha alguien abrió. No es
una limitación nueva ni de esta propuesta —es la misma que la fila de géneros de la home, que ya
funciona así— y tiene dos motivos escritos: ningún proveedor sabe buscar por género ni por estudio
—buscan por título—, y el spec prohíbe la precarga especulativa contra terceros. Lo que la ficha
enseña y lo que la búsqueda encuentra son, por eso, el mismo dato leído del mismo sitio.

Medido en Chromium con el arnés del e2e (`packages/web/e2e/detail.e2e.ts`, dos casos nuevos):

- Pulsar «Estudio Cobre» en la ficha de «Aurora Nocturna» lleva a `/search?q=Estudio%20Cobre` y
  pinta su tarjeta.
- Con las fichas de la serie y de la película del mismo estudio abiertas, la pestaña de películas
  de esa búsqueda pinta **«El Jardín de Hierro»** y no la serie: el reparto por `kind` es el de
  siempre.

**El caso del género no se mide en el navegador** porque su destino está roto por un defecto previo
de la pantalla de búsqueda, ajeno a esta propuesta: pulsar un enlace que lleva a
`/search?q=<término>` desde otra pantalla deja la búsqueda en «Buscando…» para siempre. Se reproduce
igual **hoy**, sin este cambio, desde la banda de géneros de la vitrina y abriendo la dirección a
mano. Está contado, con la medición, en `tasks/done/T130.md`; el enlace del género se pinta igual
porque es lo que se pidió y porque la vitrina ya enlaza así.

## Alternativas descartadas

- **Una pantalla propia de género y estudio** (`/genero/:nombre`, `/estudio/:nombre`). Es una ruta
  nueva, un titular y un estado vacío que ya existen en Buscar, y una tercera forma de enseñar una
  rejilla de resultados. La banda de géneros de la vitrina ya eligió la búsqueda como destino, y dos
  destinos para la misma pregunta se separan en cuanto alguien toque uno.
- **Buscar en AniList por género y por estudio.** Daría catálogo ancho —y es el paso siguiente
  natural, porque su API lo admite y la caché de listas ya existe—, pero es otra tarea: una consulta
  nueva a un tercero, su TTL, su clave de caché y su schema. Esta propuesta no abre esa puerta; la
  deja escrita aquí para que se decida aparte.
- **Enseñar sólo los géneros como enlaces y dejar los estudios en texto.** Es la mitad de lo que se
  pidió, y el nombre del estudio es justo la mitad que no tenía ninguna salida.
