# El rediseño de escritorio

> Este documento no es un contrato: no cambia ninguna interfaz pública y no toca ningún
> `docs/specs/SPEC-*.md`. Es la nota de por qué la interfaz se ve como se ve después del rediseño,
> para que el próximo cambio no deshaga sin saber lo que deshace. Lo que sí es contrato —la
> superficie HTTP y las reglas de la interfaz— sigue en `docs/specs/SPEC-web-ui.md`.

## Qué se pidió

Una vista agradable para escritorio. La interfaz ya tenía una lengua visual decidida —fondo casi
negro, acento naranja, titulares en la fuente de display, etiquetas en monoespaciada— y el encargo
no era tirarla, sino arreglar lo que en una pantalla grande no funcionaba.

Lo que no funcionaba era casi todo **composición**, no color:

1. La home eran cinco rejillas `auto-fill` que **envolvías**. Con siete portadas por línea, veinte
   títulos hacían tres líneas y una sección dejaba de leerse como una sección: la sexta fila
   empezaba pasados dos mil píxeles de scroll.
2. Cada caja llevaba **dos píxeles de crema** de borde y una sombra dura desplazada. En una rejilla
   de seis columnas son cientos de marcos compitiendo, y la página se lee como un muro de cajas.
3. **Siete elementos gritaban a la vez**: el titular de la página a 56 px, los de las filas a 36,
   los géneros a 36, el nombre del título en el reproductor a 48, la marca, la cinta, las tarjetas.
   Cuando siete cosas son titulares, ninguna lo es.
4. El encabezado era una barra del ancho de la ventana y el contenido una columna de 1200 px
   centrada: en un monitor de 1920 la marca quedaba **descolgada** a la izquierda de todo, y a la
   derecha del contenido sobraba una franja muerta.

## La superficie, antes de tocar un color

La home **no** es una página de decisión, es una página de **explorar** un catálogo, con **un**
momento de decidir. De ahí las dos decisiones que ordenan todo lo demás:

- el **destacado** es el único momento de decidir, y por eso es la única pieza con superficie
  elevada, radio grande y sombra: lo que hay que mirar primero;
- todo lo demás son **bandas de explorar**, una por fila y con un solo carril cada una.

El patrón «un titular centrado y tres tarjetas iguales» no aparece en ninguna pantalla, y no es una
casualidad: es lo que sale cuando no se ha decidido qué superficie es.

## Lo que cambió

### 1. Las filas son rieles

`.row__list` dejó de ser `repeat(auto-fill, minmax(…, 1fr))` y es un carril: `grid-auto-flow:
column`, `grid-auto-columns: var(--cover-width)` y desplazamiento horizontal. Una banda por fila, el
orden de la página se sigue de un vistazo, y lo que no cabe se desplaza.

Dos cosas que el carril necesita y no son adorno:

- **una máscara en el borde derecho** (`--rail-fade`). Una portada cortada a media altura se lee
  como un fallo de composición, no como «aquí hay más». Las tres revisiones del rediseño leyeron el
  corte como accidental, y con razón: **la barra de desplazamiento no reserva ni un píxel** en el
  navegador sin cabecera con el que se hacen las capturas —medido: `offsetHeight - clientHeight` es
  cero en los tres rieles—, así que la única señal era un corte recto.
- **el carril visible donde el navegador lo pinte** (`scrollbar-width: thin` y su equivalente
  `::-webkit-scrollbar`), porque donde sí se pinta es además el único sitio donde se puede arrastrar.

### 2. Dos colores de línea y no uno

- `--color-border` es la **tinta**: el trazo de acento sobre el que se apoya la identidad —el marco
  de la portada del destacado, el tirador de la barra de progreso, las teclas de la ayuda—. Se ve
  poco y se ve a propósito.
- `--color-line` es la **estructura**: el filo de una tarjeta, la línea de una sección. Sostiene sin
  pedir atención.

Antes había un solo color y era el crema de la identidad, así que **todo** tenía el mismo peso.

### 3. La jerarquía se hace con escala y familia

La escala de titulares bajó de `1.5 / 2.25 / 3.5 rem` a `1.375 / 1.875 / 2.75 rem`, el número del
top de `7 rem` a `4.5 rem` —que es lo que mide una portada de 11.5 rem— y los géneros dejaron de ser
palabras de 36 px para ser pastillas del alto de un mando. Lo que se ganó no es «menos bonito» ni
«más bonito»: es que el ojo tiene cuatro escalones y sabe en cuál está.

### 4. El encabezado se alinea con el contenido

El relleno lateral del encabezado es `max(--space-6, lo que sobresale la columna)`, y el tope de la
columna incluye sus dos márgenes. Así la marca cae **exactamente** sobre el primer titular de la
página en cualquier ancho, y la barra sigue ocupando la ventana entera.

Medido: marca y titular en `x = 240` a 1920 px, en `x = 32` a 1440, 1280 y 1024; el filo derecho de
la navegación cae en el filo derecho del contenido. A 390 px, los dos en `x = 16`.

El menú se fue al extremo derecho y la pantalla actual la dice `aria-current="page"`: antes no había
forma de saber en qué pantalla se estaba.

### 5. Lo demás, con el mismo criterio

- **El destacado** es una pieza con superficie elevada, y su portada bajó de 24 a 20 rem: con 24 el
  cartel medía 576 px de alto y la primera fila de la home quedaba por debajo del pliegue. Ahora el
  destacado mide 546 px y la pantalla de 900 px enseña la primera sección.
- **La cinta** dejó de ser un rectángulo naranja del ancho de la página —lo primero que se veía al
  abrir era una barra más grande que el titular— y es una pastilla con la etiqueta en el acento y
  los títulos en el texto de la aplicación. Son títulos, no etiquetas.
- **Los géneros** son pastillas.
- **Los estados vacíos** («cargando», «no hay nada», «no se encontró») son paneles con el filo de la
  estructura. Eran una frase al 11 px en mitad de una pantalla vacía.
- **El radio, la sombra y el movimiento** son un sistema de tres pasos —apoyado, levantado, flotando—
  en lugar del desplazamiento duro. La tarjeta se levanta dos píxeles al pasar el puntero: un cambio
  de color solo se lee como un cambio de color.

## Contraste: lo que se midió y lo que se decidió

La paleta **no se toca**: los pares de `src/a11y.test.ts` siguen midiendo lo mismo y en los dos temas,
porque los valores del tema claro y del oscuro son los de antes. Lo único nuevo es la estructura:

| Par | Oscuro | Claro | Mínimo |
|---|---|---|---|
| `--color-line` sobre el fondo | 1.52:1 | 1.59:1 | — |
| `--color-line-strong` sobre el fondo | 3.16:1 | 3.16:1 | 3:1 (WCAG 1.4.11, partes de un componente) |

La distinción importa y es la que ordena el tema entero:

- **`--color-line-strong` sí llega al 3:1.** Es el filo de lo que se pulsa —botón, campo, pastilla de
  género, carril del volumen, tecla dibujada— y por eso es un gris claro: un borde que se ve igual
  que la estructura deja un mando con el mismo aspecto que un párrafo. Las tres revisiones del
  rediseño coincidieron en que las pastillas de género parecían botones deshabilitados, y tenían
  razón: su borde estaba en 2.2:1.
- **`--color-line` se queda en 1.5:1 y es una decisión, no un descuido.** Esto no es el borde de un
  mando, es la línea de una sección y el filo de una tarjeta. Llevarlo a 3:1 obliga a un gris medio
  —un filo de tinta— que devuelve la página al muro de cajas del que venimos. Los paneles, los
  diálogos y los menús flotantes usan éste: traen sombra ancha y su filo no tiene que sostener nada.

Lo que sí se comprobó es que los dos temas queden **al mismo nivel**: el primer intento en claro fue
`#e2ddd2` (1.1:1) y las líneas de sección desaparecían mientras en oscuro se veían.

Y los pares que mide `src/a11y.test.ts` no se movieron, porque **ningún valor de la paleta cambió**:
`text` sobre `bg` 16.20:1 en oscuro y 18.53:1 en claro, `text-dim` 7.69 y 7.00, `accent` 5.83 y 5.22.

## Qué se midió, y con qué

En el navegador, sobre el arnés del e2e, no a ojo:

- **Alineación**: marca = titular y filo de la navegación = filo del contenido, de 390 a 1920 px.
- **Tamaño de tarjeta**: las tres filas dan un único ancho, `184 px` (`--cover-width`), en las cinco
  anchuras probadas. Una revisión del rediseño dijo que el top tenía tarjetas más grandes; la medida
  dice que no, que lo que cambia es el número del top por dentro.
- **Línea de base**: el titular y su etiqueta comparten línea de base; la diferencia entre sus pies
  es de 4 px, que es el descendente de la display menos el de la mono, y es lo que pasa cuando la
  línea de base está bien puesta. A 390 px se partía la etiqueta dentro del renglón: se arregló
  dejando que la cabecera dé la vuelta (`flex-wrap: wrap` en el bloque de ventana estrecha).
- **Sin desborde horizontal** de la página en ninguna anchura, de 390 a 1920.
- **Los rieles se desplazan** donde tienen que desplazarse y no donde no: 5 elementos no desplazan a
  1440 px, 8 elementos sobran 208 px.
- **El carril reserva 0 px**: por eso la máscara es la que avisa.

Las capturas del README (`docs/captura.png` y `docs/captura-claro.png`) se rehicieron con
`bun run captura`, que es el comando que el propio README documenta.

## Lo que no se tocó

- **Ni una línea de lógica de componente.** El rediseño es esqueleto y tokens; el único cambio de
  marcado es el `aria-current` del menú.
- **Ningún texto de la interfaz**, ni del catálogo de i18n ni de los temas de `recsys`.
- **Ningún valor de la paleta**: los colores de antes, con los mismos pares de contraste medidos.
- **Las fuentes**: la CSP es `default-src 'self'` y las pilas siguen empezando por las tres familias
  del diseño con caída a las del sistema.

## Lo que queda abierto

- **El destacado tiene un hueco ancho entre el texto y la portada** cuando el título es corto. Es
  consecuencia de dos columnas con una portada de proporción fija; se puede cerrar con una portada
  de proporción más ancha —arte de llave y no cartel—, y eso es un cambio de imagen, no de esqueleto.
- **El carril de una fila no reserva alto** en el navegador sin cabecera con el que se hacen las
  capturas, así que la única señal de que hay más a la derecha es la máscara. En un navegador de
  escritorio el carril de 6 px sí ocupa su hueco y entonces hay dos señales; convendría comprobarlo
  en uno de verdad, que es algo que este rediseño no hizo.
- **Las teclas `Inicio`/`Fin` y las flechas no desplazan un riel** —el tabulador sí, porque las
  tarjetas son enlaces y enfocar una que está fuera trae el carril—. Añadirlo pide que el carril sea
  un elemento enfocable, y eso hoy no existe en el marcado.
