# Port de «Vitrina» a la interfaz

La vitrina es la v2 de la interfaz. El artefacto de referencia está en la rama `tarea/redisenos-ui`
(`docs/redisenos/02-vitrina.html`): cinco pantallas, autónomo, sin build. Este documento dice cómo se
lleva a `packages/web` y en qué orden, sin cambiar lo que el artefacto promete.

## Qué cambia respecto a la interfaz de hoy

| | Hoy | Vitrina |
|---|---|---|
| Superficie | Pila de filas iguales: seis `section`, todas con la misma tarjeta | Mosaico de carteles: todas las piezas pesan lo mismo —una columna, 2:3— y la fila se llena |
| Jerarquía | La da el orden de las filas | La da el orden de los tramos y lo que lleva dentro cada pieza (puesto, puntuación, progreso) |
| Marca de sección | `SectionHeader` encima de la fila | Nota al margen pegajosa, a la izquierda del mosaico |
| Destacado | Cartel con pila de portadas giradas detrás | Marquesina a sangre (62 dvh) con el cartel y dos bloques enfrentados |
| Descubrir | Cada fila se desplaza en horizontal | Seis títulos por fila en la rejilla ancha y el top entero del primer tirón |
| Elevación | Sombras duras desplazadas, radios cero | Tono y marco: radio 10 px en la pieza, 3 px en el mando, sin desenfoques |
| Arte | Portada del proveedor, con relleno de degradado | El arte se dibuja: seis campos de degradado, más saturados, más un recurso por pieza |
| Puntero encima | — | La pieza se enciende. **No cambia de tamaño ni de sitio** (ver «Movimiento») |
| Nota de un tramo | Titular y etiqueta | Tres renglones: titular, etiqueta y **cuenta** («3 títulos», «10 títulos · y 5 más») |
| Motor | Panel plegado al final de la home | Tramo propio, con el motivo en el asomo y en la hoja. La puntuación numérica se retiró después (ver «La crítica de la home») |
| Piezas sin nada que contar | Caja de texto vacía | Renglón explicado (`tramo-vacio`): dice lo mismo sin pedir el hueco de un cartel |

Lo que **no** cambia: los datos y su origen, las rutas, los textos del catálogo de i18n, los estados
obligatorios (vacío, carga, fallo), el foco visible y el movimiento reducido. Un rediseño de la
composición no puede llevarse por delante el contrato.

## Capas del port

1. **Tokens** (`styles/tokens.css`). Paleta de la vitrina, radios, tipografía, movimiento y los puntos
   de corte nuevos. Todo valor vive aquí: la hoja de estructura no admite ni un `#hex` ni un `1rem`
   sueltos, y hay una prueba que lo impide.
2. **Estructura** (`styles/shell.css`). El bloque de composición: marquesina, sección con nota al
   margen, mosaico, pieza, banda de géneros y cinta. El bloque de cada pantalla se conserva hasta que
   se toque esa pantalla.
3. **Componentes** (`features/home/*`). La home se recompone: marquesina, secciones en mosaico y banda
   de géneros. Las filas dejan de ser listas uniformes.
4. **Pruebas**. Las que miran la composición de hoy (`.home > *`, `.row__list > li`, la tarjeta) se
   reescriben para la composición nueva, con el mismo listón: contraste medido, sin medidas literales,
   movimiento reducido, nombres accesibles, regiones `aria-live`.

## Movimiento: la regla que trae el artefacto

**El puntero no mueve la vitrina.** Pasar el ratón por encima enciende el borde, aviva el campo y
destapa el asomo, pero nada cambia de tamaño ni de sitio. En la primera versión del artefacto la pieza
crecía al pasar el ratón —de una fila a dos, de dos a tres— y todo lo que venía debajo bajaba 145 px,
ida y vuelta: el contenido se movía bajo el puntero. Se midió y se quitó.

El asomo (sinopsis, motivo y mandos) sólo se enseña **donde cabe**: en el cartel de 2:3 —unos 350 px
de alto— cabe, así que la pieza lo enseña dentro; en la banda del régimen de una columna, que mide 6
rem como mucho, no, y ahí se lee en la hoja. La regla vale igual en el código: ninguna regla `:hover`
de la hoja puede tocar geometría.

## Puntos de corte

La vitrina pide cuatro anchos —1400, 1100, 820 y 560 px— y el mosaico pasa de 6 a 4, 3, 2 y 1 columna
de verdad: recompone, no encoge. Van como tokens `--bp-*`, que es lo que la prueba de la hoja comprueba
contra los `@media`.

## Qué se mide antes de dar cada paso por bueno

- `bun run typecheck`, `bun run lint` y `bun test` en verde (el listón del repositorio).
- Contraste: ≥4.5:1 en texto y ≥3:1 en partes de componente, medido por `a11y.test.ts` con los tokens
  nuevos.
- Cero desbordamiento horizontal y mandos ≥44 px entre 320 y 1920 px, medido en el navegador
  (`packages/web/e2e` y la sonda de medidas del artefacto).
- Ninguna regla `:hover` que cambie geometría.

## Estado

- [x] Decisión: la vitrina es la v2; los otros tres rediseños se retiraron del repositorio.
- [x] Tokens de la vitrina (paleta, radios, tipografía, movimiento, puntos de corte, arte).
- [x] Bloque de composición en `shell.css`: marquesina, cinta, sección con nota al margen,
      mosaico, pieza, asomo y banda de géneros, con los cuatro anchos donde recompone.
- [x] Home recompuesta: las cinco filas son mosaicos de piezas (`Pieza`, `Mosaico`), el
      destacado es la marquesina y los géneros son la banda. `PosterCard` se retiró.
- [x] La regla del puntero, medida: dos pruebas en `styles.test.ts` fallan si una regla
      `:hover` de la composición toca geometría o si algo se mueve con `transform`. Lo que
      quedaba del diseño viejo —la tarjeta que se «levantaba» 2 px al pasar el ratón— se
      cambió por tono: el puntero no mueve nada en ninguna pantalla.
- [x] La marquesina del artefacto: a sangre, dos bloques enfrentados —el titular en cuerpo de
      cartel y el cartel 2:3 girado con su pie—, la marca de refresco en la esquina y la
      **cinta dentro**, pegada al borde inferior, con su rótulo fuera del carro y sus puntos.
- [x] La nota de cada tramo con su cuenta —los títulos **a la vista** y los que quedan— y el tramo
      del motor («Recomendado para ti») con la puntuación en la pieza. La franja de motivos se
      retiró después: repetía lo que ya dice la nota y metía una caja dentro del mosaico.
- [x] Los pesos del artefacto: el top entero en 2x2, continuar viendo en 2x2, novedades con una
      3x2 de entrada y luego 2x1 y celdas, y favoritos en 1x1 apagadas. **Se retiró en T118** (ver
      «La rejilla apretada»): una pieza de dos columnas medía 491x152 px y dejaba tres títulos por
      fila con un hueco al lado. La banda de géneros con el recuento en voladizo se queda.
- [x] La pieza: el botón «i» que abre su hoja —el mismo asomo en panel inferior, con asa que se
      arrastra y cierre con `Escape`—, el sello de origen, la puntuación y el pie de lo que se
      retoma. Los mandos del asomo viven **fuera** del enlace de la pieza.
- [x] El esqueleto de la primera carga con la métrica del mosaico (mismas columnas, misma proporción
      de cartel, mismo hueco) y en gris plano, sin latido.
- [ ] El asomo con datos: la pieza no lleva sinopsis hoy porque ninguna fila la trae. El
      enlace ya acepta `onMouseEnter` para la precarga del detalle, que es lo que pide el
      spec, así que el asomo se llena al pasar el puntero —con lo que se pida— en un paso
      siguiente.
- [ ] Buscar, ficha, ver y ajustes sobre la misma composición.
- [x] Limpieza: los bloques `.row*`, `.hero*`, `.poster*`, `.ticker*`, `.genres*` y los
      `.section*` que se quedaron sin uso al portar la home se retiraron de `shell.css`
      (`.section__meta` se queda: el panel lo usa) junto con `PosterCard`.
- [x] El arte de la pieza: el campo de degradado por posición y un recurso propio —trama,
      inicial, mitad, cifra del año, círculo, caja— repartido por el puesto. El dibujo se pinta
      sólo si la portada no llega: manda la portada, y por eso viaja dentro del campo (un
      `<img>` no pinta pseudo-elementos). La primera pieza de cada tramo pesaba más que las que la
      acompañan; **se retiró en T118**, que dejó todas las piezas del mismo tamaño.
- [x] Capturas al día en `docs/` (`captura.png` y `captura-claro.png`, hechas con `bun run
      captura` contra el servidor del fixture).
- [x] El `e2e` de la home al día.
- [x] El conmutador de tipo —anime y películas— en la home y en la búsqueda, con la mitad en la
      dirección (`?tipo=movies`) y una franja propia encima de la marquesina: el mando mide 44 px y en
      la cabecera de 56 no cabía. Lo que sirve cada fuente se declara en su manifiesto
      (`capabilities.media`) y se enseña en Ajustes.
- [ ] Buscar, ficha, ver y estados con la composición del artefacto: hoy sólo la home está
      portada. El artefacto trae las cinco pantallas.

## La rejilla apretada (T118)

Dos cambios pedidos con la home delante: fuera la fila «Último añadido» y piezas más altas y más
títulos por fila.

- **La fila «Último añadido» se retiró.** Enseñaba lo que la aplicación ya conoce —lo que se buscó y
  lo que se abrió— y en la práctica repetía lo que ya estaban diciendo «Novedades» y el top. La
  **lectura no se toca**: `/api/catalog/recent` sigue, porque es la tercera reserva del destacado y
  una señal del motor en el arranque en frío, y es lo que llena la primera pantalla de una instalación
  sin `feed` ni tendencias.
- **Todas las piezas son el mismo cartel**: una columna del mosaico y la proporción de una portada
  (2:3), que es de donde sale el alto (`--pieza-proporcion`). El módulo de filas (`--vitrina-fila`) y
  los pesos por fila (`pz--s`, `pz--w`, `pz--b`, `pz--m`) se retiraron: la fila se llena sola y no
  queda hueco entre piezas.
- **La banda del móvil se queda**: por debajo de 560 px una columna mide la pantalla y un cartel de
  2:3 la ocuparía entera, así que ahí la pieza vuelve a ser una banda (`--pieza-banda`) y el asomo se
  lee en la hoja, como antes.

Medido en el arnés con el plugin de ejemplo (`bun run e2e` y una sonda que pide la caja de cada
pieza), sin desbordamiento horizontal en ningún ancho:

| Ancho | Columnas | Pieza | Antes |
|---|---|---|---|
| 1920 | 6 | 237x356 (2:3) | 491x152 (3,1:1) y 491x320 |
| 1440 | 6 | 171x256 (2:3) | 357x275 |
| 1280 | 4 | 259x389 (2:3) | 532x244 |
| 1000 | 3 | 299x449 (2:3) | 610x235 |
| 700 | 2 | 318x477 (2:3) | cuadrado (una celda) |
| 480 | 1 | 442x144 (banda) | igual: 1 columna, banda |

## Lo que el port encontró en el camino

- **El destacado puede cambiar entre dos cargas.** El motor ordena por puntuación y, cuando varios
  candidatos empatan —en el catálogo de prueba hay tres a 0,3—, un favorito nuevo mueve el orden, así
  que el cartel puede enseñar otro título al recargar. La prueba del favorito daba por hecho que no
  cambiaba; ahora mide el estado contra la lista guardada, que vale con los dos desenlaces. Si el
  cartel no debe bailar entre cargas, la decisión es del motor, no de la vitrina.
- **El alta de un favorito se pinta antes de llegar al servidor.** Recargar justo después de pulsar
  puede leer una lista sin el título: la prueba espera la respuesta del `POST` antes de recargar.
- **El arte de la pieza colgaba de su enlace, y no de la pieza.** El port envolvió el arte y el pie
  en un enlace para que el cuerpo de la pieza fuera pulsable, y el enlace quedó en el flujo: medía lo
  que su texto. El arte se coloca contra el ancestro posicionado más cercano, así que en una pieza
  2x2 —continuar viendo, el top— la portada salía como una tira pegada al borde de abajo y el resto
  del hueco quedaba en negro. `block-size: 100%` no lo arreglaba: contra una fila de altura
  automática, un porcentaje se resuelve como `auto`. El enlace cubre ahora la pieza (`inset: 0`), y
  con eso lo pulsable es la pieza entera, como decía el comentario del componente.

## El banner del destacado (T125)

El campo de la marquesina era siempre el degradado naranja. Cuando la obra está emparejada con
AniList, ahora **es su banner**: la imagen apaisada que publica la API, servida por el servidor y
medida en el navegador antes de pintarla.

- **La tinta se elige midiendo.** Una imagen puede ser una nieve, y sobre una nieve la tinta crema
  de siempre desaparece. `features/home/tinta.ts` lee la luminancia media del trozo de banner que
  queda debajo del texto —la columna izquierda, no la imagen entera— y elige el par: tinta crema con
  velo oscuro, o tinta oscura con velo claro. La imagen no se pinta hasta que la medida está, así que
  el campo no enseña nunca la letra del color equivocado.
- **El velo es lo que garantiza que se lea.** Va al tono del campo —lo contrario de la tinta— y
  aplana la imagen hasta el mínimo necesario: `--velo-campo-minimo`, medido contra el peor caso de
  cada dirección en `a11y.test.ts` y no elegido a ojo. El umbral y el mínimo están atados: mover uno
  sin el otro deja la prueba en rojo.
- **Sin banner no cambia nada.** Una obra que AniList no conoce —o un AniList caído— deja el campo
  como estaba: el degradado, la tinta de siempre y ningún atributo en el elemento.

## La cifra del top (T129)

El puesto se pintaba enorme y **recortado por el borde**. Colgaba por encima de la pieza y el
interlineado era más corto que la letra, así que el corte se llevaba media cifra: con un solo dígito
parecía un recorte a propósito, y con «10» y «11» ya no se sabía qué número era. Se vio con el top
delante, en la captura de la home.

- **La cifra va entera dentro de la pieza.** `--arte-posicion-alto` deja de ser un voladizo negativo
  y el alto de línea vuelve a ser el de la letra, que es lo que hace que el número quepa en su caja.
  Lo mide el e2e contra la caja de la pieza, y mide **la tinta** y no la caja de línea: la caja de un
  texto no dice dónde empieza el dibujo de la letra, y con un interlineado corto la letra se sale de
  la caja sin que la medida lo vea.
- **Y se lee sobre cualquier portada.** Desde que AniList manda en el top, debajo hay una portada de
  verdad —un cielo, una nieve, el amarillo de un héroe— y el crema desaparecía: en la captura del
  top, el «5» de Boku no Hero y el «8» de ONE PIECE no se leían. Las piezas numeradas llevan un velo
  corto en su esquina, `--velo-puesto`, del alto de la propia cifra para que tape lo mismo en la
  rejilla de seis columnas que en la banda del móvil. Su mínimo es el que hace pasar el 4.5:1 sobre
  el peor arte posible —el blanco—, medido en `a11y.test.ts`; el velo cuelga de la pieza numerada y
  de nadie más, así que el arte de las demás se sigue enseñando entero.

## La crítica de la home

Tres cambios de un pase de crítica de diseño, cada uno con la medición que lo sostiene:

- **La nota deja de ir al margen a ≤1400.** Una canaleta de una columna mide ~84 px a 1280 y el
  titular —hasta 1,75 rem— no cabe dentro: se cortaba bajo el primer cartel y «Recomendado para ti»
  se leía «Recomen». Ahora, en la misma consulta en la que el mosaico aprieta a cuatro columnas, la
  nota vuelve a ser cabecera del tramo. `styles.test.ts` sujeta ese emparejamiento: no se puede
  apretar la rejilla sin devolver la nota a su sitio.
- **La puntuación del motor sale de la pieza.** `Pieza.tsx` la pintaba con `toFixed(3)` y la home
  llegaba a recomendar títulos a «0.000». Es el orden con el que el motor elige, no algo con lo que
  el usuario decida qué ver; el detalle del motor sigue en `features/recommendations/Panel.tsx`.
- **El vacío es un renglón.** Ocupaba el hueco de un cartel —259×389 a 1280— y tres seguidos
  convertían la home en una pantalla de huecos. `PiezaVacia` se retiró; `TramoVacio` dice lo mismo
  en una línea.

Lo que **no** se pudo medir en ese pase: ni el navegador (el sandbox no deja lanzarlo) ni el detector
de la skill (su motor no está instalado). Las capturas de `docs/` siguen siendo del 2026-10-15 y no
enseñan Perfil ni Descargas: hay que volver a hacerlas con `bun run captura` contra el arnés.

