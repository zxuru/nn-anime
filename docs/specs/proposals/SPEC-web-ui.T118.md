# SPEC-web-ui.T118 — la home sin «último añadido» y con las piezas del mismo tamaño

**Estado:** propuesta, sin integrar. La integra el dueño de `docs/specs/SPEC-web-ui.md`, que anota la
aprobación y borra este archivo.

## Qué cambia

En «Contrato» -> «Rutas de la SPA», la descripción de `/` (líneas 77-78 del spec) dice hoy:

```
/                      home: recomendaciones, el top de la fuente, novedades,
                       último añadido, continuar, favoritos y géneros
```

Pasa a:

```
/                      home: recomendaciones, el top de la fuente, novedades,
                       continuar, favoritos y géneros. Las piezas del mosaico
                       son carteles del mismo tamaño: una columna del mosaico y
                       la proporción de una portada
```

`GET /api/catalog/recent` **no se toca**: la lectura sigue siendo la tercera reserva del destacado y
una señal del motor en el arranque en frío.

Al integrarla, en `docs/specs/SPEC-discovery.md` el tercer «Success Criteria» (línea 152) nombra la
fila que desaparece. Su sustancia no cambia —la lectura devuelve títulos sin abrir ningún detalle, y
el destacado sale de ahí—, así que bastaría con decir:

- [ ] Después de buscar —sin abrir ningún detalle— la lectura de lo último que la aplicación conoce
      devuelve títulos y el destacado sale de ahí.

## Por qué

Decisión de producto con la home delante: la fila «Último añadido» se leía como una repetición de
«Novedades» y del top —en el arnés de pruebas y en una instalación con `feed` enseñan los mismos
títulos—, y su función real (que la primera pantalla no dependa de nadie) la sigue cubriendo el
destacado con la misma lectura.

El segundo cambio es de métrica, no de contrato: una pieza de dos columnas medía 491x152 px —más
ancha que alta—, dejaba tres títulos por fila con un hueco al lado y recortaba la portada. Con el
cartel de una columna y 2:3 la fila se llena: medido en el arnés, 6 títulos por fila a 1920 px y 4 a
1280, sin desbordamiento horizontal en ningún ancho. Los pesos por fila (`pz--s`, `pz--w`, `pz--b`,
`pz--m`) se retiran con él.

## Alternativa descartada

**Mantener la fila y bajarle el peso.** Ocuparía un tramo entero —nota, cuenta y su aire— para
repetir lo que ya está dos pantallas más arriba, y el mosaico uniforme no tiene un tamaño «menos
importante» donde ponerla.

**Estirar las piezas a lo ancho en vez de a lo alto.** Era el estado anterior: la portada queda
recortada por arriba y por abajo, y cada fila deja huecos porque 4 o 7 títulos no son múltiplo de
las columnas.
