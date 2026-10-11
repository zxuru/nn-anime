# SPEC-discovery.fuentes — una tarjeta por obra

**Estado:** propuesta, sin integrar. La integra el dueño de `docs/specs/SPEC-discovery.md`.

## Qué cambia

En `/api/feed`, el paso 3:

> 3. Deduplicación por `providerId#value`, con el primero que llegue.

pasa a:

> 3. Deduplicación por `providerId#value` y **por obra**: la misma obra en dos fuentes deja una
>    entrada. La clave de obra es el título normalizado (`titleKey`, en `core`) más el año, y se
>    queda la primera —lo más nueva, que es el orden que fija el paso 4—.

En `/api/catalog/recent`, los pasos 2 y 3:

> 2. Deduplica por referencia y **se queda con la marca más nueva**.
> 3. Orden descendente por esa marca, tope 20.

pasan a:

> 2. Deduplica por referencia —la marca más nueva— y después **por obra**: la misma obra en dos
>    fuentes deja una tarjeta, la de la marca más nueva.
> 3. Orden descendente por esa marca. La lectura pide `límite × fuentes` filas —cada fuente aporta
>    como mucho una por obra— y el recorte al tope pedido se aplica **después** de agrupar.

## Por qué

Con dos proveedores activos, «Último añadido» pintaba cinco tarjetas donde había tres obras.
Medido sobre la base de desarrollo: la lectura devolvía **216 entradas** y agrupar por título más año
las deja en **201**; los 15 pares repetidos son todos entre `jkanime` y `animeav1`.

La clave **no** es `baseTitle`: juntaría una entrega con su secuela, que las fuentes publican por
separado y como dos tarjetas. Y no es sólo el título: dos obras homónimas de años distintos no son la
misma, y sin el año la fila escondería una de las dos.

La alternativa descartada era **agrupar en el navegador**, que ya lo hace la búsqueda: las dos filas
tienen el mismo problema en el servidor y arreglarlo dos veces deja dos reglas que se desincronizan.
