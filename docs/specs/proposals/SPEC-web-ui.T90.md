# Propuesta: la prioridad de proveedor cuando la misma obra está en varios

Módulo: `web-ui` · Task: T90 · Estado: pendiente de que lo integre el dueño del spec.

## Qué cambia

Tres puntos del contrato, y ninguno toca la forma en que se agrupan las obras.

1. **`GET /api/settings` gana `providerPriority`**: una lista de ids de proveedor, del más
   prioritario al menos, vacía por defecto. **`PATCH /api/settings` la acepta**, y sus dos campos
   —`theme` y `providerPriority`— pasan a ser opcionales, con la condición de que venga al menos
   uno. Un `PATCH` con `{}` es 400: no describe ningún cambio.
2. **La página de ajustes ordena los proveedores activos.** Cada uno lleva «Subir» y «Bajar»
   —botones, no arrastrar: el orden tiene que poder cambiarse con teclado—, y el primero de la
   lista es el preferido. Los rechazados no se reordenan: no ofrecen nada.
3. **La tarjeta de la búsqueda elige la fuente por esa lista.** Dentro de un grupo de la misma
   obra, el orden pasa a ser: índice en `providerPriority` y, para lo que no está en la lista o
   empatado, la regla de siempre —el nombre más largo, estable por orden de llegada—. El resto de
   proveedores sigue en «También en», como enlaces a su ficha.

## Por qué

El spec ya dice que la obra sale **una vez** y que las fuentes siguen siendo elegibles (§«Una
tarjeta por obra»), pero no dice **cuál** de ellas da el nombre y el enlace de la tarjeta. Hoy lo
decide `porNombre`: gana el título más largo, y a igualdad de largo el que llegó primero. Eso es
una regla de presentación, no una elección del usuario, y con dos fuentes que sirven la misma obra
el usuario acaba en la que ganó por casualidad.

Medido en el código actual: con `['Danmachi' de jkanime, 'Dungeon ni Deai wo Motomeru no wa
Machigatteiru Darou ka' de animeav1]` la tarjeta enlaza a `animeav1` (`useSearchStream.ts`, prueba
«la tarjeta se queda con el nombre más largo de la obra»). Si esa fuente tiene el título con un
audio que no se quiere, hay que entrar y volver.

La prioridad es un **orden** y no una marca por proveedor porque «preferido» sólo significa algo
frente a los demás: con tres fuentes, un booleano por proveedor no dice qué hacer cuando el
primero no tiene el título ni cuál es el segundo.

## Alternativas descartadas

- **Fijar por obra** («este anime, de esta fuente»). Es más fino y más caro: la identidad de una
  obra es título normalizado más año, así que un proveedor que renombre el título pierde la
  fijación en silencio, y el ajuste crecería una fila por obra vista. Si la prioridad global no
  alcanza, es el paso siguiente.
- **Guardar la prioridad en `localStorage`.** El spec ya decidió que los ajustes son del store: un
  ajuste del navegador no se puede leer desde el servidor y se pierde al cambiar de navegador. El
  tema se movió a la base por lo mismo.
- **Un campo por proveedor en `providers`** (`preferred: true`). Obliga a decidir qué pasa con dos
  marcados, y `GET /api/providers` describe lo que cargó, no lo que el usuario prefiere.
- **Que ordene el servidor.** La agrupación por obra vive en el cliente, sobre eventos SSE que
  llegan por proveedor (`groupByWork` en `core`). Ordenar en el servidor exigiría esperar a todos
  los proveedores, que es justo lo que el spec prohíbe.

## Lo que la propuesta no afirma

Que el orden se mantenga cuando un proveedor deja de cargar. Se guarda tal cual, **sin filtrar por
los activos**: un plugin roto un rato recupera su sitio al arreglarse, y filtrarlo obligaría a
reordenar cada vez que un proveedor falla al arrancar. El precio es que un id que ya no existe se
queda en la lista sin hacer nada; la interfaz no lo enseña porque no está entre los proveedores.

Tampoco cambia `recsys`, que tiene su propio ranking de recomendaciones, ni el orden en que la
búsqueda consulta a los proveedores: la prioridad decide entre resultados, no a quién se pregunta
primero.
