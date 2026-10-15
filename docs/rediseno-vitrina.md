# Port de «Vitrina» a la interfaz

La vitrina es la v2 de la interfaz. El artefacto de referencia está en la rama `tarea/redisenos-ui`
(`docs/redisenos/02-vitrina.html`): cinco pantallas, autónomo, sin build. Este documento dice cómo se
lleva a `packages/web` y en qué orden, sin cambiar lo que el artefacto promete.

## Qué cambia respecto a la interfaz de hoy

| | Hoy | Vitrina |
|---|---|---|
| Superficie | Pila de filas iguales: seis `section`, todas con la misma tarjeta | Mosaico modular: la pieza pesa por su superficie (1x1, 2x1, 2x2, 3x2) |
| Jerarquía | La da el orden de las filas | La da el tamaño de la pieza |
| Marca de sección | `SectionHeader` encima de la fila | Nota al margen pegajosa, a la izquierda del mosaico |
| Destacado | Cartel con pila de portadas giradas detrás | Marquesina a sangre (62 dvh) con el cartel y dos bloques enfrentados |
| Descubrir | Cada fila se desplaza en horizontal | Cinco piezas del top a la vista a la vez |
| Elevación | Sombras duras desplazadas, radios cero | Tono y marco: radio 10 px en la pieza, 3 px en el mando, sin desenfoques |
| Arte | Portada del proveedor, con relleno de degradado | El arte se dibuja: seis campos de degradado, más saturados, más un recurso por pieza |
| Puntero encima | — | La pieza se enciende. **No cambia de tamaño ni de sitio** (ver «Movimiento») |
| Nota de un tramo | Titular y etiqueta | Tres renglones: titular, etiqueta y **cuenta** («3 títulos», «12 títulos · y 7 más») |
| Motor | Panel plegado al final de la home | Tramo propio, con la puntuación en cada pieza y la franja de motivos con el detalle plegado dentro |
| Piezas sin nada que contar | Caja de texto vacía | Pieza fantasma: ocupa el hueco de una pieza, rayada y explicada |

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

El asomo (sinopsis, motivo y mandos) sólo se enseña **donde cabe**: en la pieza de una sola fila no
entra, así que la pieza lo deja en un panel inferior en vez de recortarlo. La regla vale igual en el
código: ninguna regla `:hover` de la hoja puede tocar geometría.

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
- [x] La nota de cada tramo con su cuenta, la franja de motivos del motor y su tramo
      («Recomendado para ti») con la puntuación en la pieza y el detalle del score plegado dentro.
- [x] Los pesos del artefacto: el top entero en 2x2, continuar viendo en 2x2, novedades con una
      3x2 de entrada y luego 2x1 y celdas, último añadido y favoritos en 2x1 y 1x1 apagadas, y la
      banda de géneros con el recuento en voladizo.
- [x] La pieza: el botón «i» que abre su hoja —el mismo asomo en panel inferior, con asa que se
      arrastra y cierre con `Escape`—, el sello de origen, la puntuación y el pie de lo que se
      retoma. Los mandos del asomo viven **fuera** del enlace de la pieza.
- [x] El esqueleto de la primera carga con la métrica del mosaico (mismas columnas, mismas filas,
      mismo hueco) y en gris plano, sin latido.
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
      `<img>` no pinta pseudo-elementos). La primera pieza de cada tramo pesa más que las que
      la acompañan, y donde no cabe en tres columnas baja a dos de ancho y sube a tres de alto.
- [x] Capturas al día en `docs/` (`captura.png` y `captura-claro.png`, hechas con `bun run
      captura` contra el servidor del fixture).
- [x] El `e2e` de la home al día.
- [ ] Buscar, ficha, ver y estados con la composición del artefacto: hoy sólo la home está
      portada. El artefacto trae las cinco pantallas.

## Lo que el port encontró en el camino

- **El destacado puede cambiar entre dos cargas.** El motor ordena por puntuación y, cuando varios
  candidatos empatan —en el catálogo de prueba hay tres a 0,3—, un favorito nuevo mueve el orden, así
  que el cartel puede enseñar otro título al recargar. La prueba del favorito daba por hecho que no
  cambiaba; ahora mide el estado contra la lista guardada, que vale con los dos desenlaces. Si el
  cartel no debe bailar entre cargas, la decisión es del motor, no de la vitrina.
- **El alta de un favorito se pinta antes de llegar al servidor.** Recargar justo después de pulsar
  puede leer una lista sin el título: la prueba espera la respuesta del `POST` antes de recargar.
