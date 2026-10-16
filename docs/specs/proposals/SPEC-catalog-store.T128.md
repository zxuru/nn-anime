# Propuesta: saber qué referencia es para adultos

Task: T128 · Spec afectado: `SPEC-catalog-store.md` · Estado: pendiente de que lo integre el dueño
del spec.

## El cambio exacto

1. **Migración `0010-adulto.sql`: una tabla `adult_ref (provider_id, provider_ref)`, con esa pareja
   como clave primaria.** Una tabla propia y **no** una columna de `anime`, aunque la marca sea de la
   obra: la marca la aprende el emparejamiento de AniList, y la obra puede **no tener fila** —una
   novedad del feed de un título que nadie ha abierto no la tiene—. Con una columna habría que
   inventar un `anime` con un detalle de mentira y una caducidad que miente para poder escribir un
   booleano, y ese detalle falso lo leería cualquiera que abriera la ficha.
   La clave primaria es también el índice de las dos consultas que hay: la de una referencia y la de
   un lote.
2. **La marca se escribe por referencia y sin el contenido.** La sabe el emparejamiento —que tiene el
   título y la obra que AniList devuelve— pero se guarda por `provider_id` y `provider_ref`, que es
   lo que el historial, los favoritos y el feed manejan. Cuando la obra viene marcada y el interruptor
   está apagado, **no se escribe la fila de `anilist_media`**: se escribe la marca y nada más, así que
   la caché no llega a tener la portada ni la sinopsis. Con el interruptor encendido se guarda entera,
   como hoy.
3. **Lectura por lote de las marcas.** Una consulta que recibe las referencias de una fila y devuelve
   cuáles están marcadas: es lo que usan `/api/feed` y `/api/trending` para descartar **antes de
   preguntar** —una referencia marcada no gasta una petición a AniList nunca más—. Va por lote y no
   por referencia por el motivo de siempre: una fila puede traer veinte piezas y veinte consultas para
   pintar una fila es lo que el spec prohíbe.
4. **Las lecturas que alimentan filas excluyen las marcadas cuando quien cablea se lo pide**: los
   candidatos del motor, el historial, los favoritos y lo último conocido. El almacén no decide
   política: expone el parámetro y el servidor lo pasa con el ajuste en la mano.

## El motivo

El punto 5 de la propuesta de `discovery` descarta lo marcado en la frontera, y eso basta para las
listas de AniList, que se reconstruyen de la respuesta. **No basta para las filas que salen de la
base**: una recomendación, un favorito, un «seguir viendo» o una entrada del feed son filas del
almacén, y ahí no hay entrada de AniList que consultar sin salir a la red. La única forma de que el
estado apagado las cubra es **tener el dato guardado**, y la única forma de tenerlo es haberlo
aprendido al emparejar.

El filtro va en la lectura y **antes** del motor, con el mismo motivo que ya está escrito en
`routes/recommendations.ts`: recortar después de recomendar deja la fila con menos piezas de las que
hay, porque el motor ya habría llenado su tope con títulos que no se van a enseñar.

## La marca es la fila

Estar en `adult_ref` significa «consta que es para adultos»; no estar es «no consta», y el
desconocido se comporta como el que no lo es: se enseña. No hay columna de estado ni de fecha, y es a
propósito: un tercer estado —«se preguntó y no lo es»— sólo serviría para medir la cobertura del
emparejamiento, y una columna de métricas se queda en el esquema para siempre. Si algún día hace
falta esa cuenta, se saca de `anilist_media`, que ya distingue la fila ausente de la fila sin valor.

## Las trampas que el task tiene que medir

- **Un refresco del proveedor no puede borrar la marca.** `anime.write` viene de `getAnime`, que no
  sabe nada de esto, y reescribe su fila entera: si la marca viviera en esa fila, o si el refresco
  limpiara la tabla, la obra volvería a enseñarse en la siguiente lectura. Se mide mutando: borrando
  las marcas dentro de la escritura del anime, la prueba del refresco queda en rojo.
- **La migración es aditiva.** Crea una tabla vacía y no toca `anime`: ninguna fila existente cambia
  de forma y ninguna lectura vieja se rompe.
- **La marca sobrevive al interruptor.** No es un ajuste: es lo que se aprendió. Apagar el
  interruptor no la borra, y volver a encenderlo no vuelve a preguntar por lo ya marcado.
- **`prune` no la toca, y es deliberado.** La limpieza se lleva la fila de `anime` de un título que
  nadie mira desde hace meses; la marca se queda, porque que una obra sea para adultos no se vence y
  si la obra vuelve a aparecer no hay que volver a preguntarlo.

## Las alternativas descartadas

**Una columna `adult` en `anime`.** Es lo que se propuso primero y no se sostiene: la marca la aprende
el emparejamiento sobre una entrada del feed, y esa obra puede no tener fila, así que habría que
crear un `anime` de relleno con un `raw_json` inventado —que la ficha leería— y una caducidad que
miente para que la ficha volviera a pedir el detalle. El ahorro era una subconsulta por lectura, y no
compensa.

**Que decida el almacén leyendo el ajuste.** Sería una línea menos en el servidor y una dependencia
más dentro del almacén: `getSetting` ya vive ahí, pero la misma lectura se usa para cosas que sí
deben ver la obra marcada —la ficha que el usuario ya abrió, por ejemplo—. Un almacén que decide
política es un almacén que no se puede probar sin montar la política.
