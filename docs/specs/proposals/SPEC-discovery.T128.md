# Propuesta: el contenido para adultos en el descubrimiento

Task: T128 · Spec afectado: `SPEC-discovery.md` · Estado: pendiente de que lo integre el dueño del
spec.

Se apoya en `SPEC-discovery.T121.md`, que sigue **sin integrar**: esta propuesta enmienda lo que
aquella dice de las listas de AniList y del enriquecido, y no lo repite.

## El cambio exacto

1. **`anilistEntrySchema` gana `adult: boolean`, obligatorio**, y `MEDIA_FIELDS` pide `isAdult`.
   Obligatorio y no opcional: la caché guarda la entrada entera y una fila vieja sin el campo
   **no se puede leer** —`catalog-store` lanza y `leerSinRomper` la trata como ausente, así que se
   vuelve a pedir—. Un `false` por defecto sería peor que no leerla: daría por apta una obra que
   nadie ha mirado, que es justo lo que el filtro existe para no hacer.
2. **`discoverItemSchema`, `airingItemSchema` y `enrichmentSchema` ganan `adult: boolean`,
   obligatorio.** Es lo que la tarjeta necesita para pintar la marca `+18`, y sin marca el
   desbloqueo sería peor que no tenerlo: el usuario que enciende el interruptor no sabría **cuál**
   de las piezas encendió por él.
3. **El filtro pasa de literal a función, y la clave de caché lleva el eje.** Hoy `isAdult: false`
   está escrito en `TOP_QUERY`, en las dos de películas y en `matchQuery`. Un ajuste no puede ser
   una variable de GraphQL: `false` excluye y `true` significa «sólo adultos» —no hay valor para
   «sin filtro»—, así que las consultas pasan a construirse con una bandera y la variante sin
   filtrar **omite el argumento**. La clave de `anilist_list_cache` gana el mismo eje
   (`top:anime:safe` / `top:anime:all`): sin eso, encender el interruptor sirve la lista anterior
   hasta que venza el TTL —media hora, y el top—, y no se arregla reintentando.
4. **El emparejamiento lleva el mismo eje, y por eso también duplica su clave.** `matchKey` pasa de
   `título|año` a `título|año|<eje>`. Con el interruptor apagado, una obra para adultos no empareja
   —se pide con `isAdult: false`— y esa ausencia se cachea **bajo la clave cerrada**; con el
   interruptor encendido se vuelve a preguntar y la ficha se enriquece. Es deliberado: la promesa
   del estado cerrado es «no se pide», y cumplirla obliga a que las dos respuestas no compartan
   fila. El precio es que desbloquear rempuja los títulos que se vayan mostrando, dentro del
   presupuesto de peticiones que ya existe.
5. **La frontera descarta lo marcado cuando el ajuste está apagado, aunque venga de la caché.** Un
   `anilistEntry` con `adult: true` que llegue a `/api/discover/top`, `/api/discover/airing`,
   `/api/discover/recent`, `/api/anime/:providerId/:ref/enrichment` o `POST /api/enrichment` no se
   sirve: se omite la pieza —o el enriquecimiento va como `null`, que ya significa «no hay con
   qué»—. No es un cinturón sobre la correa, y la razón está en el punto siguiente.

## Lo que se encontró al mirar, y no es menor

**La parrilla y lo recién emitido no están filtrados hoy, y no se pueden filtrar por consulta.**
`AIRING_QUERY` y `AIRED_QUERY` cuelgan de `Page.airingSchedules`, que **no expone el argumento
`isAdult`**: los cuatro `isAdult: false` del archivo cubren el top, las dos de películas y el
emparejamiento, y ninguna de las dos del calendario. Ahí el descarte de la frontera no es defensa en
profundidad: es **el único** filtro que existe. Por eso el criterio de aceptación de la parte del
servidor se mide sobre esas dos rutas y no sobre el top, que ya venía limpio.

Queda por medir en el task, contra la API de verdad, si `airingSchedules` devuelve obras para
adultos; lo que no admite discusión es que la consulta no las pide de otra forma.

## El motivo

El repo ya decidió que un ajuste vive en la base y no en el navegador (`SPEC-web-ui`, tema), y que
el filtro de una mitad se aplica **antes** de gastar trabajo —`selectedProviders` filtra antes de
preguntar, y `/api/recommendations` filtra antes de recomendar—. Esto es lo mismo un paso antes:
filtrar donde se pide el dato, y no donde se pinta, para que el estado cerrado no dependa de que
todas las pantallas se acuerden de esconder.

## La alternativa descartada

**Pedir siempre sin filtro y descartar al servir.** Cerraría más: la aplicación **sabría** qué obras
son para adultos aunque el interruptor esté apagado, y con eso se podrían filtrar también las filas
de proveedor que hoy no tienen señal —historial, favoritos, recomendaciones—, porque el
conocimiento se guardaría por referencia. Se descarta porque contradice la promesa del estado
cerrado: el interruptor apagado significa «no se pide, no se guarda, no se pinta», y esta variante
pide y guarda. Una caché llena de metadatos para adultos es superficie de fuga a cambio de nada
mientras el usuario no lo haya encendido.

**Filtrar en la interfaz.** El estado cerrado dejaría de ser una propiedad del servidor y pasaría a
depender de que cada componente se acuerde; el título y la portada del proveedor ya habrían viajado
al navegador, que es exactamente lo que hay que evitar.

## Lo que la propuesta no afirma

- **Que el filtro cubra todo el catálogo.** Sólo cubre lo que AniList publica. Una fuente que
  publique una obra para adultos que AniList no tiene, o que AniList no marca, se enseña igual.
  Filas de proveedor como búsqueda, tendencias, novedades, favoritos e historial **no** tienen
  señal y no se filtran al cerrar; se filtran sólo si la aplicación aprendió antes que esa
  referencia lo era (con el interruptor encendido), que es lo que persiste el almacén.
- **Que `Ecchi` sea para adultos.** No lo es —es un género, y marcarlo dejaría fuera obras de
  catálogo corriente—. El único criterio es `isAdult`.
- **Que esto sea una verificación de edad.** Es un servidor local de un solo usuario: quien abre el
  puerto tiene la sesión. El ajuste decide qué se pide y qué se pinta, no quién mira. Va a
  `SECURITY.md` como riesgo declarado y no mitigado.
