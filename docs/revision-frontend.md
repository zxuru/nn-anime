# Revisión del frontend y pase de movimiento

Fecha: 2026-10-28. Alcance: `packages/web` completo (vitrina, búsqueda, ficha,
reproductor, perfil, historial, descargas y ajustes), con la app renderizada a
1440×900 y 390×844. No es un rediseño: es una revisión con las utilidades
actuales intactas y un pase de transiciones sobre lo que ya existía.

## Cómo se miró

- Código: `app.tsx`, `router.tsx`, `features/*`, `components/*`, las dos hojas de
  estilo y el catálogo de i18n.
- Navegador: Edge 156 (Chromium) contra el arnés del e2e, con el plugin de
  fixture. Se midieron cajas, foco, `overflow` del `body` y atributos de estado,
  no sólo se miraron capturas.
- Límites declarados: el motor de `impeccable` no está instalado, así que no hay
  detector automático ni overlay; no se ejecutó axe. Las capturas de `docs/`
  eran del 2026-10-15 y no enseñaban Perfil ni Descargas: las conclusiones
  visuales de este documento salen de capturas nuevas del árbol actual.

## Lo que ya funciona

1. **La vitrina tiene una lengua propia.** La marquesina a sangre con el cartel
   girado, los seis campos de degradado repartidos por posición y el recurso de
   arte por pieza (`Pieza.tsx:40`, `shell.css:3927`) no se confunden con una
   plantilla. La cinta mide su vuelta en píxeles por segundo (`Ticker.tsx:66`) en
   vez de fingir una velocidad fija.
2. **Los estados son producto.** Ocho clases de fallo con título, cuerpo y
   detalle; esqueletos con la métrica exacta del mosaico (`SeccionCargando.tsx`);
   vacíos que dicen dónde se arregla. La recuperación de errores es lo mejor de
   la interfaz.
3. **La casa está tokenizada y medida.** `shell.css` no admite un color ni una
   medida suelta, y `a11y.test.ts` mide los pares de contraste. Eso hace que cada
   arreglo pequeño no se deshaga solo.

## Agenda de mejora

Severidad: **P1** dificulta una tarea o excluye a alguien; **P2** molestia con
solución; **P3** pulido. «Hecho» significa que se corrigió en este pase.

| # | Sev. | Hallazgo | Evidencia | Estado |
|---|---|---|---|---|
| 1 | P1 | La cabecera no decía dónde estabas: cinco destinos con el mismo tono y sin `aria-current`. | `app.tsx:96-117`, `shell.css:71-136` | **Hecho**: `aria-current` por ruta y filete de acento en `.shell__nav a[aria-current="page"]`. |
| 2 | P1 | El botón secundario de la marquesina desaparecía en tema claro: borde y letra salían del tema (casi negro) sobre el campo granate. | `shell.css:3626` (sólo `[data-tinta="oscura"]`), captura clara actual | **Hecho**: el contorno toma `--marquesina-tinta` en los dos temas. |
| 3 | P1 | La hoja de la pieza era un `div` con `role="dialog" aria-modal="true"`: sin fondo inerte ni trampa de foco, con un botón de fondo focusable fuera del diálogo, el velo por debajo de la cabecera (`z-index: 8` frente a `10`) y el `body` sin bloquear. | `PanelPieza.tsx:95-107`, `shell.css:4391` | **Hecho**: `<dialog>` nativo con `showModal`, foco al cierre, `overflow: hidden` y retorno del foco al disparador. |
| 4 | P1 | El asomo oculto seguía en el orden de tabulación: dos mandos invisibles por pieza. | `shell.css:4172-4197` | **Hecho**: `visibility: hidden` en reposo, `visible` con puntero o foco. |
| 5 | P1 | Buscar, los relacionados y el panel siguen con la tarjeta vieja —borde 2 px, radio 0, sombra coral desplazada— mientras la home usa la pieza de 1 px y radio 10. | `shell.css:343` frente a `3927`; captura de Buscar | Abierto. Es la deuda declarada en `docs/rediseno-vitrina.md:99`. |
| 6 | P2 | `--font-mono: "Space Mono"` no se sirve: no hay `@font-face` ni archivo, y la CSP es `default-src 'self'`. Todo el registro de datos cae a la mono del sistema y cambia de voz por máquina. | `tokens.css:158`; `styles/fonts/` sólo tiene Nunito | Abierto. Traer la familia al repo o retirarla del token. |
| 7 | P2 | Tres reglas de Descargas usaban tokens inexistentes (`--color-muted`, `--font-size-sm`): el navegador descartaba la declaración y el texto quedaba con el color y el cuerpo heredados. | `shell.css:4797-4825` | **Hecho**: `--color-text-dim` y `--text-sm`; una prueba nueva falla si vuelve un `var()` sin definir. |
| 8 | P2 | El tema se aplica en un efecto después de `GET /api/settings`; `index.html` no trae `data-theme` ni `color-scheme`. Quien guardó claro sobre un sistema oscuro ve un destello negro, y los controles nativos no siguen al tema. | `useSettings.ts:66`, `index.html:1-14` | Parcial: `color-scheme` en los dos temas. El destello necesita el tema en el HTML de arranque. |
| 9 | P2 | `useAppTheme` y `SettingsPage` montan `useSettings` por separado: dos lecturas de `/api/settings` que el dedupe no comparte porque no están en vuelo a la vez. | `useSettings.ts:66,77`; `SettingsPage.tsx` | Abierto. Un proveedor de ajustes en la raíz lo cierra. |
| 10 | P2 | La cabecera móvil mete marca, cinco destinos y conmutador: a 390 px los destinos comparten una fila de 11-13 px y el mando baja a otra; a 320 px el renglón de destinos ya no cabe. | `shell.css:3115-3135`, captura 390 | Parcial: los enlaces tienen 44 px de alto; falta decidir si el menú se pliega. |
| 11 | P2 | El mosaico fijo de seis columnas deja huecos cuando la fila trae cuatro títulos: en la home se ve el tercio derecho vacío en «Recomendado para ti» y en el top. | `shell.css:3885-3893`, captura 1440 | Abierto. Es una decisión de composición, no un bug. |
| 12 | P2 | La banda de la ficha, sin banner de AniList, mide 16 rem y queda vacía: el título flota sobre un hueco negro. | `shell.css:713-724` | Abierto. Un campo de reserva o un alto condicional. |
| 13 | P2 | Cada fila de episodio lleva la sombra dura coral (`--shadow-hard-sm`), así que la lista entera parece seleccionada. | `shell.css:1200-1213` | Abierto. La fila necesita un realce de tono, no una sombra de tarjeta. |
| 14 | P2 | La cinta arranca con el primer título cortado por la izquierda («…tal»), porque el carro ya está en marcha y la pista no tiene fundido de borde. | `shell.css:3712-3718`, captura 1440 | Abierto. `mask-image` en los dos bordes de la pista. |
| 15 | P2 | Las capturas de `docs/` no representan el árbol actual (tres destinos, nota cortada, vacíos con forma de cartel). | `docs/rediseno-vitrina.md:219-221` | **Hecho** en este pase: se regeneran con `bun run captura` contra el arnés. |
| 16 | P3 | CSS muerto y comentarios de la lengua vieja: `.buscador*`, `.home__refresco`, `.section__meta`, `.poster__cover`, `.row__list > li` (su escalón nunca se aplica), y la cabecera de `shell.css` habla de radios cero. | `shell.css:10-12,556,4333`; el resto por grep | Parcial: la cabecera de la hoja y los tokens de descargas. El bloque muerto sigue. |
| 17 | P3 | El esqueleto latía a 200 ms (parecía un parpadeo) y el de la home (`.esq`) no latía. | `shell.css:467,3796` | **Hecho**: `--skeleton-pulse: 900ms` para los dos, apagado con movimiento reducido. |
| 18 | P3 | El campo de una pieza saltaba de saturación al pasar el puntero: el `filter` cambiaba sin transición. | `shell.css:4698` | **Hecho**: `filter` transiciona con `--transition-normal`. |
| 19 | P3 | No hay transición de ruta, ni foco que se mueva al cambiar de pantalla; el título de la pestaña sí cambia. | `app.tsx:187` | Abierto y deliberado: la navegación es instantánea y el foco no debe saltar sin que se pida. |
| 20 | P3 | Sin `description` ni `theme-color` en el HTML; sin pie de aplicación. | `index.html` | Abierto. |

## El pase de movimiento

La casa ya tenía tokens (`--transition-fast`, `--transition-normal`,
`--ease-piece`) y los usaba en hover, esqueleto, cinta y conmutador. Lo que
faltaba era movimiento **de estado**: abrir y cerrar superficies, revelar lo que
llega y decir dónde estás. Se añadieron seis tokens y se tradujeron las recetas
de `transitions-dev` a la escala de la casa:

| Token | Valor | Uso |
|---|---|---|
| `--transition-slow` | `320ms` | entrada de la hoja y de las superficies grandes |
| `--ease-exit` | `cubic-bezier(0.4, 0, 1, 1)` | salida: acelera y se va, sin rebote |
| `--motion-rise` | `6px` | subida corta de un diálogo |
| `--motion-blur` | `2px` | desenfoque cruzado del asomo |
| `--motion-scale` | `0.97` | escala inicial de un diálogo |
| `--skeleton-pulse` | `900ms` | latido lento del esqueleto |

Todos se apagan solos: el bloque `prefers-reduced-motion` de `tokens.css` pone
`--transition-*` y `--skeleton-pulse` a `0ms`, y los `@keyframes` propios tienen
su `animation: none` al final de `shell.css`.

### La hoja: de `div` a `<dialog>`

El cambio de fondo. La hoja se monta dentro de `.pz`, que es un contenedor de
consulta; el diálogo nativo se pinta en la capa superior, así que deja de
depender del recorte y del apilado de la pieza. Además:

- **Entra** con `translate: 0 100%` → `0` durante 320 ms y **sale** en 120 ms con
  `--ease-exit`; el fondo se enciende y se apaga con ella
  (`@starting-style` + `transition-behavior: allow-discrete`).
- **Atrapa el foco** y deja inerte lo de detrás (nativo), enfoca el cierre al
  abrir y devuelve el foco al botón «i» al cerrar.
- **Bloquea el desplazamiento** del documento mientras está abierta y lo restaura
  al cerrar.

Medido en Edge 156, abriendo la hoja desde la primera pieza de la home:

| | Antes | Después |
|---|---|---|
| Caja de la hoja | 1440×900 (viewport) | 1440×900 (capa superior) |
| Cabecera | por encima del velo (`z-index: 10` frente a `8`) | debajo del `::backdrop` |
| `body.style.overflow` | `visible` | `hidden` → `""` al cerrar |
| Foco al cerrar | `<body>` | `button.pz__abrir` |

El informe técnico previo marcó como P0 que la hoja se recortaba por
`container-type` de `.pz`. La medición lo desmiente: la hoja ya medía el
viewport. El defecto real era de capas, foco y desplazamiento; se corrigió igual,
pero el diagnóstico importa: un P0 inventado tapa los P1 que sí existen.

### El menú del reproductor

Antes se desmontaba al cerrar, así que no había salida posible. Ahora se queda
montado con `data-abierto`, `inert` y `aria-hidden` cuando está cerrado; entra
en 200 ms desde la esquina inferior derecha (`transform-origin: bottom right`) y
sale en 120 ms. Medido: abierto `data-abierto="true"`, `inert=false`,
`visibility: visible`; cerrado `data-abierto="false"`, `inert=true`,
`visibility: hidden`, y el foco vuelve a «Ajustes».

### Los diálogos nativos

`.notice` (aviso de seguridad) y `.player__dialog` (ayuda del teclado) entran
con opacidad, 6 px de subida y escala 0.97; el `::backdrop` se enciende con
ellos. `allow-discrete` deja que `display` y `overlay` esperen al final de la
transición, así que el cierre no es un corte.

### Lo pequeño

- El globo de tiempo del reproductor entra con opacidad y escala 0.98 en 120 ms.
- El asomo de la pieza cruza opacidad y desenfoque de 2 px, y `visibility`
  retrasada en la salida para que el contenido siga pintado mientras se va.
- El campo de la pieza transiciona su `filter` en vez de saltar.
- El esqueleto de la home late con el mismo pulso que el de pantalla.
- El enlace de salto es la primera parada del tabulador y apunta a
  `<main id="contenido" tabindex="-1">`.
- El destino actual de la cabecera se marca con `aria-current="page"` y filete
  de acento.
- `color-scheme` sigue al tema en los dos temas.

## Lo que no se tocó

- Rutas, URL (`?tipo`, `?q`, `?provider`), contratos de datos, i18n y el
  reproductor.
- Los estados obligatorios y sus textos.
- El contraste medido y el apagado del movimiento reducido.
- La regla de la vitrina: **el puntero no mueve nada**; ninguna regla `:hover`
  de la composición toca geometría. Las transiciones nuevas son de estado, no de
  puntero.
- La tarjeta vieja de Buscar y la ficha: se dejan como están, declaradas como
  deuda, para no mezclar un rediseño con un pase de movimiento.

## Verificación

- `bun run typecheck` en verde.
- `bun test` de los paquetes tocados: pasan las suites de `app.test.tsx`,
  `styles.test.ts`, `PanelPieza.test.tsx` y `Player.test.tsx`. Las diez pruebas
  de `scripts/agente.test.ts` y `scripts/git-hooks.test.ts` fallan en este
  entorno con `EPERM` al lanzar `git` dentro del sandbox; no tocan el frontend.
- Navegador: capturas nuevas de home (oscuro y claro), ficha, reproductor con el
  menú abierto, búsqueda, ajustes, hoja abierta, home a 390, enlace de salto y
  primer `Tab`. Medidas de la hoja y del menú en la tabla de arriba.
- La prueba de `var()` sin definir se comprobó mutando `shell.css` (se volvió a
  poner `--color-muted` y falló); la de `aria-current`, quitando el atributo en
  `app.tsx` y viendo el fallo de `app.test.tsx`.

## Lo que sigue, en orden

1. **Una sola lengua de tarjeta.** Portar Buscar, la ficha y el panel a la
   composición de la vitrina, o declarar la tarjeta vieja como excepción
   consciente. Es lo que más separa la home del resto.
2. **La tipografía de datos.** Traer Space Mono al repo o quitarla del token;
   hoy la interfaz cambia de voz según la máquina.
3. **El primer fotograma del tema.** Aplicar el tema antes del primer pintado
   (HTML de arranque o script mínimo) y compartir una sola lectura de ajustes.
4. **La cabecera estrecha.** Decidir entre plegar los destinos o dejar el
   conmutador en su renglón con un ancho mínimo medido.
5. **Los huecos del mosaico.** Que una fila de cuatro no parezca una de seis a
   medias; o se llena, o se compone para el número que hay.
6. **La banda sin banner y la sombra de los episodios.** Los dos son deuda de la
   lengua vieja que la captura de la ficha deja a la vista.
