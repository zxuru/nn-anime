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
- [ ] Tokens de la vitrina.
- [ ] Bloque de composición en `shell.css` (marquesina, sección, mosaico, pieza, géneros, cinta).
- [ ] Home recompuesta (marquesina + secciones en mosaico + banda de géneros).
- [ ] Buscar, ficha, ver y ajustes sobre la misma composición.
- [ ] `e2e` al día (home, buscar, ficha, ver) y capturas nuevas en `docs/`.
