# SPEC-anime-detail.T127 — la ficha deja de dejar huecos

**Estado:** propuesta, sin integrar. La integra el dueño de `docs/specs/SPEC-anime-detail.md`, que
anota la aprobación y borra este archivo.

## Qué cambia

### 1. Los datos se mudan de la barra lateral a la columna de lectura

En el «Objective», el criterio 2 dice hoy:

> La ficha usa el ancho: barra lateral con portada, acciones, modos, **géneros, estudios** y
> relacionados; columna principal con título, sinopsis y episodios.

Pasa a:

> La ficha usa el ancho: barra lateral con portada, acciones, modos, fuentes y relacionados; y la
> columna principal con la sinopsis a su medida de lectura y, a su lado, los datos de la obra —la
> nota de AniList, los géneros y los estudios—. Los episodios van debajo, a lo ancho de las dos.

En el bloque `web-ui` del «Contrato», la estructura pasa de

```
.detail                      grid: barra lateral (minmax(13rem, 17rem)) + principal (1fr)
├─ .detail__aside            portada, acciones, modos, géneros, estudios, relacionados
└─ .detail__body             título, meta, sinopsis, episodios (sin `--measure` en el bloque)
```

a

```
.detail                      grid: barra lateral (minmax(13rem, 17rem)) + principal (1fr)
├─ .detail__banner           título, otro nombre y año, sobre el banner
├─ .detail__aside            portada, acciones, modos, fuentes y relacionados
└─ .detail__body             sinopsis y datos en dos pistas; episodios a lo ancho
   ├─ .detail__lectura       minmax(0, --measure) + minmax(0, 1fr)
   │  ├─ .detail__prosa      la sinopsis, con su medida de lectura
   │  └─ .detail__datos      de AniList, géneros y estudios
   └─ section                episodios, a lo ancho de las dos pistas
```

La marca `detail__lectura--dos` **sólo** se pone cuando hay sinopsis y datos. Con una sola de las
dos cosas la pista única se lee entera: media fila en negro es lo que se está quitando. Por debajo
de `--bp-desk` las dos pistas se apilan, que es como se leían antes.

### 2. Una sección sin datos no se pinta

«Géneros» y «Estudios» sólo existen si hay algo que enseñar. Hoy, una obra sin estudios —lo normal
en el catálogo emparejado con AniList— pinta el titular «Estudios» con un párrafo vacío debajo. Es
la misma regla que el criterio 5 pide para los relacionados: un hueco que se explica o que no
existe, nunca un titular con nada.

### 3. Las marcas de la fila de episodio van al borde derecho

La duración, el progreso, el «visto» y el modo se agrupan en `.episode__marcas`, que va al borde
derecho de la fila. Con el título delante el `flex: 1` ya las empujaba; **sin él** —y hay fuentes
que no titulan sus episodios— quedaban pegadas al número, con la fila entera vacía al lado.

## Por qué

Se reportó con una captura de la ficha delante: «optimiza el uso de espacio, hay zonas muertas». Las
tres que se ven son éstas.

Medido con el arnés del e2e, en Chromium, ventana de 1713×1242, sobre la misma ficha y el mismo
documento (el «antes» apaga las dos decisiones desde la hoja servida):

| | antes | después |
|---|---|---|
| Ancho a la derecha de la sinopsis | 292 px, vacío | 32 px, que es el `gap` entre pistas |
| Pista de datos | debajo, ancho 832 | al lado, ancho 260 |
| Alto del bloque de lectura | 418 px | 198 px |
| Hueco a la derecha de la última marca de la fila | 501 px | 30 px, que es el relleno |
| Titular «Estudios» sin datos | se pinta | no se pinta |

Y a 900 px de ancho las dos pistas se apilan (532 px cada una, sin hueco horizontal a la derecha de
la sinopsis) y las marcas siguen al borde: lo que no se pierde al recomponer.

En área, el rectángulo muerto de la lectura pasa de 292 × 418 ≈ 122 000 px² a 32 × 198 ≈ 6 300 px²
—el hueco entre pistas, que es una canaleta y no un vacío—; y cada fila de episodio devuelve 471 px
de ancho.

## Alternativas descartadas

- **Una tercera columna en `.detail`**, con el rail de datos fuera de `.detail__body` y la lista de
  episodios en la columna del medio. Deja la lista más estrecha (592 px en vez de 832) para ganar un
  hueco que el rail de datos ya llena con 260 px, y mete la barra lateral, la prosa y los datos en
  tres columnas de anchos parecidos que se leen como tres cosas del mismo peso.
- **Ensanchar la ficha** por encima de `--content-max`. No arregla nada: la sinopsis sigue topada en
  su medida de lectura, así que el ancho extra se convierte en más hueco a su derecha, no en menos.
- **Quitar el tope de la sinopsis** para que llene la columna. Una línea de 100 caracteres no se lee,
  y es lo que el propio spec defiende desde el principio.
- **Dejar los géneros y los estudios en la barra lateral** y llevar sólo la nota a la pista de
  datos. La pista se queda en cuatro renglones contra siete de sinopsis y el hueco vuelve por abajo;
  además la barra lateral mide 17rem y ya lleva portada, favorito, modos, fuentes y saga.
- **Meter el cartel dentro de la banda del banner** para compactar la ficha en vertical. Cambia la
  lengua visual —la banda es la cabecera, y el cartel lleva su sombra dura y su proporción— y no es
  lo que se reportó: el hueco que se señala está a la derecha de la sinopsis y detrás del número de
  cada episodio.
