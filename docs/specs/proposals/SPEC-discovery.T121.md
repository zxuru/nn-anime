# Propuesta: el descubrimiento desde AniList

Task: T121 · Spec afectado: `SPEC-discovery.md` (y, por la superficie que añade, `SPEC-web-ui.md`)

## El cambio exacto

Cinco rutas nuevas, todas bajo los guards que ya cubren `/api/`:

| Método y ruta | Devuelve | Schema |
|---|---|---|
| `GET /api/discover/top?media=` | El ranking de AniList, en su orden | `discoverResponseSchema` |
| `GET /api/discover/airing?media=&days=` | Los capítulos que se emiten en la ventana (1–31 días) | `airingResponseSchema` |
| `GET /api/discover/recent?media=` | Lo que se acaba de emitir (anime, 3 días) o lo recién estrenado (películas) | `airingResponseSchema` |
| `GET /api/anime/:providerId/:ref/enrichment` | Sinopsis, géneros, nota, estudio, portada y banner de la obra emparejada | `enrichmentResponseSchema` |
| `POST /api/enrichment` | El mismo enriquecimiento, por lote (1–24 referencias) | `enrichmentBatchResponseSchema` |
| `GET /api/anilist/image/:kind/:id` | Los bytes de una imagen de su CDN | imagen con ETag |

Cada pieza de las listas lleva `ref` **cuando la base ya conoce esa obra en alguna fuente**: es lo que
decide si la tarjeta abre una ficha o la búsqueda de su título. Sin `ref`, la pieza enlaza a
`/search?q=<título>`.

`media=both` es 400: el descubrimiento está partido en dos mitades y no tiene una mitad «todo».
Sin `media`, la mitad por defecto es `anime`, como en el resto de la aplicación.

**La parrilla es de series, y se midió por qué.** AniList publica el estreno de muchas
películas con precisión de año —`startDate: {year: 2026}`— y una fila que agrupa por días no puede
colocarlas sin inventarles la fecha: `/api/discover/airing` con `media=movies` responde vacío **sin
salir a la red**, y la interfaz lo explica. Los estrenos de películas sí aparecen en
`/api/discover/recent`, con su día cuando la API lo publica y con su año cuando no: por eso
`airingItemSchema` lleva `airingAt` y `episode` opcionales y un `year`.

## El motivo y la frontera que se respeta

`SPEC-discovery.md` decía, con razón, que **la aplicación no descarga el feed**: lo descarga el
plugin, y por eso no aparecía una superficie SSRF nueva. Esta entrega sí aparece, y por eso se
declara: se sale a `graphql.anilist.co` con lista blanca de hosts comprobada en cada salto, con
presupuesto de peticiones (una cada dos segundos, en fila india, `Retry-After` obedecido) y con
caché de TTL en cada respuesta. El detalle y su fila en el modelo de amenaza están en `SECURITY.md`.

El motivo de que la descarga no la haga un plugin: **no es scraping de una página**. AniList publica
una API con términos escritos —gratuita para uso no comercial, sin `hoarding`, sin usarla como
almacenamiento—, y esto la consume respetándolos: sólo responde a lo que una pantalla está
enseñando, con TTL, y sin precargar nada.

## La alternativa descartada

**Enriquecer en el cliente**: el navegador no puede salir a `graphql.anilist.co` —`connect-src 'self'`
lo bloquea y la regla de «no incrustar recursos remotos» del spec de la interfaz lo prohíbe— y la
dirección de una imagen no puede venir del cliente. Todo pasa por el servidor, que es quien tiene la
lista blanca y la caché.

**Un módulo nuevo (`metadata-enrichment`)**: el mapa de capacidades lo tenía sin aprobar y sin fecha;
esta entrega no lo abre. Vive en `server` con la caché en `catalog-store`, como el cliente de GitHub,
y no cambia el build order.
