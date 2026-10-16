# Propuesta: el contenido para adultos en el descubrimiento

Task: T128 · Spec afectado: `SPEC-discovery.md` · Estado: pendiente de que lo integre el dueño del
spec.

Se apoya en `SPEC-discovery.T121.md`, que sigue **sin integrar**: esta propuesta enmienda lo que
aquella dice de las listas de AniList, del feed y del enriquecido, y no lo repite.

## El cambio exacto

1. **`anilistEntrySchema` gana `adult: boolean`, obligatorio**, y `MEDIA_FIELDS` pide `isAdult`.
   Obligatorio y no opcional: la caché guarda la entrada entera y una fila vieja sin el campo **no
   se puede leer** —`catalog-store` lanza y `leerSinRomper` la trata como ausente, así que se vuelve
   a pedir—. Un `false` por defecto sería peor que no leerla: daría por apta una obra que nadie ha
   mirado, que es justo lo que el filtro existe para no hacer.
2. **`discoverItemSchema`, `airingItemSchema` y `enrichmentSchema` ganan `adult: boolean`,
   obligatorio.** AniList contesta siempre, así que ahí el dato es autoritativo y su ausencia no
   existe. **`feedItemSchema` gana `adult` opcional y sólo verdadero**: una entrada del feed viene
   de un plugin que no publica edad, así que lo único que se puede afirmar de ella es que **se
   sabe** que es para adultos; la ausencia significa «no consta», y convertirla en `false` sería
   decir que se comprobó.
3. **Las listas que pueden filtrar por consulta lo siguen haciendo.** `TOP_QUERY` y las dos de
   películas mantienen `isAdult: false` con el interruptor apagado y lo **omiten** con el
   encendido; la clave de `anilist_list_cache` lleva el eje (`top:anime:safe` / `top:anime:all`),
   porque si no, encender el interruptor sirve la lista anterior hasta que venza el TTL —media
   hora— y no se arregla reintentando.
4. **El emparejamiento deja de filtrar, en los dos estados.** `matchQuery` pierde su
   `isAdult: false`. El motivo es la fila de Novedades y está en el punto 6: el feed de una fuente
   no trae ninguna señal de edad, y la única forma de saber si una entrada es para adultos es
   preguntar por ella. Al preguntar sin filtro la respuesta puede traer una obra marcada, y ahí
   manda la regla de guarda: **de una obra marcada se guarda el booleano de su referencia y nada
   más** —ni fila en `anilist_media`, ni portada, ni sinopsis—, y ninguna ruta la sirve mientras el
   interruptor esté apagado.
   El sentido del error es el seguro: sin filtro hay más candidatas y un emparejamiento forzado
   marcaría como adulta una obra que no lo es, que esconde de más y no de menos.
5. **La frontera descarta `adult: true` con el interruptor apagado**, en las cinco rutas de AniList
   y en las que salen de la base. No es un cinturón sobre la correa: en `/api/discover/airing` y
   `/api/discover/recent` es **el único** filtro que existe, por lo que se explica abajo.
6. **«Novedades» entra entera, por sus dos procedencias.** La fila tiene dos orígenes y los dos se
   cubren:
   - **Su mitad de AniList** es `/api/discover/recent` —los capítulos recién emitidos, con su
     episodio—. Es la ruta donde la consulta no puede filtrar, y la cubre el punto 5.
   - **Su reserva es `/api/feed`**: cuando AniList no responde, la fila la llena lo que publica la
     fuente. Esa ruta **verifica** sus entradas contra AniList —una consulta por lote, con el mismo
     `matchMany` del enriquecido y la misma caché de un mes por título y año— y descarta las
     marcadas antes de escribir la respuesta. Un título ya marcado **no se vuelve a preguntar**: la
     marca es local y no caduca.
   - El destacado de reserva sale del mismo sitio —`featuredOf` cae al feed cuando el motor no
     tiene nada—, así que la verificación cubre además el titular, que es la pieza más grande de la
     pantalla.
   - **`/api/trending` entra en la misma pasada**: es la misma consulta de marcas y el mismo
     descarte, y dejarla fuera daría un producto que filtra una fila y no la de al lado.

## El motivo, y la frase que cambia

La decisión anterior era «con el interruptor apagado no se pide». **No se sostiene para Novedades**
y conviene decirlo en vez de dejar el agujero: el feed de una fuente no lleva edad, y la única forma
de esconder lo que no se puede reconocer es preguntar por ello. La promesa pasa a ser **«no se
guarda ni se sirve»**:

- Se pregunta lo justo para saber qué esconder, y sólo donde no hay otra señal: las listas del top y
  de películas siguen filtrando en la consulta, así que su caché nunca ve una obra marcada.
- De una obra marcada se guarda **un booleano por referencia**, nunca la entrada: ni portada, ni
  sinopsis, ni id de AniList. No hay nada que pueda reaparecer por otra ruta.
- Nada marcado se sirve mientras el interruptor esté apagado, venga de la caché o de la respuesta
  recién pedida.

## Lo que se encontró al mirar, y no es menor

**La parrilla y lo recién emitido no están filtrados hoy, y no se pueden filtrar por consulta.**
`AIRING_QUERY` y `AIRED_QUERY` cuelgan de `Page.airingSchedules`, que **no expone el argumento
`isAdult`**: los cuatro `isAdult: false` del archivo cubren el top, las dos de películas y el
emparejamiento, y ninguna de las dos del calendario. Y una de esas dos **es la fila de Novedades**
en su procedencia normal. Queda por medir en el task, contra la API de verdad, si `airingSchedules`
devuelve obras marcadas; lo que no admite discusión es que la consulta no las pide de otra forma, y
que hoy nada las descarta.

## Las alternativas descartadas

**Pedir sin filtro y además guardarlo.** Es lo que haría un enriquecido normal, y se descarta: una
caché con portadas y sinopsis para adultos mientras el usuario ha pedido no verlas es superficie de
fuga a cambio de nada. La marca por referencia da la misma cobertura sin quedarse con el contenido.

**Filtrar el feed sólo por la marca local.** No cubriría nada mientras el interruptor no se haya
encendido nunca, que es exactamente el caso del usuario que quiere no verlo desde el primer día. La
marca cubre lo ya visto; la verificación cubre lo nuevo, y hacen falta las dos.

**Filtrar en la interfaz.** El estado apagado dejaría de ser una propiedad del servidor y pasaría a
depender de que cada componente se acuerde; el título y la portada del proveedor ya habrían viajado
al navegador, que es lo que hay que evitar.

## Lo que la propuesta no afirma

- **Que el filtro cubra todo el catálogo.** Cubre Novedades por sus dos procedencias, el top, la
  parrilla, las fichas enriquecidas, las tendencias y las filas que salen de la base. **La búsqueda
  no se verifica**: sus resultados llegan por SSE mientras el usuario teclea, y meter una ida y
  vuelta a AniList en medio de una búsqueda incremental se paga en cada pulsación. Ahí sólo actúa la
  marca, así que un resultado para adultos que nunca se haya visto antes se enseña; se declara.
- **Que el filtro funcione con AniList caído.** La verificación del feed es una pregunta, y sin
  respuesta no hay marca: la entrada se enseña. Es la misma regla que ya rige todas las filas —un
  tercero caído no vacía una fila— y el sentido contrario, esconder lo que no se ha podido
  comprobar, dejaría Novedades vacía cada vez que AniList falla. Se declara en `SECURITY.md`.
- **Que `Ecchi` sea para adultos.** No lo es —es un género, y marcarlo dejaría fuera obras de
  catálogo corriente—. El único criterio es `isAdult`.
- **Que esto sea una verificación de edad.** Es un servidor local de un solo usuario: quien abre el
  puerto tiene la sesión. El ajuste decide qué se pide, qué se guarda y qué se pinta, no quién mira.
  Va a `SECURITY.md` como riesgo declarado y no mitigado.
