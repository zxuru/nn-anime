# SPEC-web-ui.T95 — el total de la página también con `?n=`

**Estado:** propuesta, sin integrar. La integra el dueño de `docs/specs/SPEC-web-ui.md`, que anota la
aprobación y borra este archivo.

## Qué cambia

En «El selector de episodios y los vecinos del reproductor», la viñeta **«Nunca la lista completa»**
(lineas 112-115 del spec) dice hoy que el reproductor pide los vecinos de a uno con `number/(n-1)` y
`number/(n+1)`. Pasa a:

- **Nunca la lista completa.** El selector pide la página que va a pintar (`?page=`) y el reproductor
  no pide nunca la lista entera: con `?n=` en la dirección lee la **página 1** —el servidor la cachea
  cinco minutos— para conocer el total y, si el episodio está en ella, sacar de ahí los dos vecinos;
  si no está, los pide de a uno (`number/(n-1)`, `number/(n+1)`). Pedir el catálogo entero para pintar
  una ventana es lo que disparaba los 429 del sitio: una serie de 1216 episodios eran 76 peticiones.

## Por qué

El rótulo del reproductor perdió el total: decía «Episodio 2» donde T92 decía «Episodio 2 de 12», y
`total` sólo viene en una página, no en la lectura de un episodio suelto. Se midió en el e2e
(`player.e2e.ts:376`). La página se pide igualmente para los vecinos cuando el episodio no está en
ella, y cuando sí está sustituye a las dos lecturas puntuales: el caso corriente pasa de dos peticiones
a una, y la que se pide está en la caché de cinco minutos.

## Alternativa descartada

**Añadir `total` a `GET /episodes/number/:n`.** Sería un cambio de contrato del servidor y de sus
plugins (`getEpisode` no tiene forma de saber el total, y el plugin real no pagina), y obligaría a
pedir la lista completa dentro del servidor para contestar un episodio suelto: exactamente lo que T92
quitó. La página ya existe y ya está cacheada.
