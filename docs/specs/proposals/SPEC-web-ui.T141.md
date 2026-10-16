# Propuesta: la búsqueda con género la contesta el catálogo

Task: T141 · Spec afectado: `SPEC-web-ui.md` (la página `/search` y su contrato)

Estado: propuesta, sin integrar. La integra el dueño del spec.

## El cambio exacto

**Un término con `#` no se le pregunta a los proveedores.** Un término de género no es un
título: las fuentes buscan el texto literal y devuelven lo que se les parezca —medido con
`#Aventura`, que trajo Dragon Ball, One Piece y Tokyo Revengers—, así que esa búsqueda la
contesta el catálogo y a las fuentes no se les pregunta. La ruta lo decide con una regla que
vive en `core` (`hasGenreToken`), porque la usan los dos lados: el servidor para no
preguntar y la pantalla para decidir qué pinta.

`GET /api/search?q=<con género>` emite entonces **un solo evento** —el de la lista de
AniList, el que ya existía— y cierra con `providers: 0`. No emite el evento del catálogo
local: sus títulos ya salen en la lista del catálogo, con su referencia local.

**La página `/search` pinta esa lista con el diseño de los resultados**: la misma tarjeta
`card` de la rejilla —portada, título, año y formato—, **sin sello**. El enlace decide lo de
siempre: con ficha local abre la ficha, sin ella la búsqueda de su título. No se usa el
mosaico de la vitrina y no se pinta un esqueleto por proveedor, porque no hay proveedores
pendientes. Sin género, la página no cambia: los proveedores primero y la lista del catálogo
debajo, aparte, con su sello.

El anuncio de la región `aria-live` dice el recuento del catálogo y no el de unos
proveedores a los que no se ha preguntado.

## Por qué

Es lo que se pidió con las dos capturas delante: la lista del catálogo —que es la que
responde de verdad a «qué hay de este género»— ocupa el sitio de unos resultados que en esa
búsqueda son ruido, y lo hace con el lenguaje visual de la página y no con el de la vitrina.

## La alternativa descartada

**Filtrar en la interfaz los resultados de los proveedores.** La petición ya se habría
hecho, y son sitios de terceros: el gasto no se deshace escondiendo la tarjeta. Y **dejar
las dos listas** mantiene el ruido en pantalla, que es justo lo que se venía a quitar.
