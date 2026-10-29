---
name: nn-anime
description: La vitrina a oscuras — un catálogo que vive en tu equipo, con el arte dibujado y los mandos medidos.
colors:
  ink: "#08080a"
  surface: "#0e0e13"
  surface-raised: "#14141b"
  cream: "#f5f0e6"
  ash: "#a8a094"
  coral: "#ff5c35"
  coral-deep: "#e8451f"
  paper: "#f2ede3"
  paper-raised: "#fbf8f2"
  carbon: "#14120f"
  coral-ember: "#c02f10"
  coral-ember-deep: "#a32512"
  mint: "#63d9a0"
  moss: "#1d6b3f"
  salmon: "#ff8a80"
  brick: "#a32222"
typography:
  display:
    fontFamily: "Nunito, \"Segoe UI Variable\", \"Segoe UI\", system-ui, sans-serif"
    fontSize: "clamp(3rem, 9vw, 7.5rem)"
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Nunito, \"Segoe UI Variable\", \"Segoe UI\", system-ui, sans-serif"
    fontSize: "clamp(1.25rem, 1.9vw, 1.75rem)"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Nunito, \"Segoe UI Variable\", \"Segoe UI\", system-ui, sans-serif"
    fontSize: "clamp(1.05rem, 2.4cqi + 0.5rem, 1.6rem)"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Nunito, system-ui, -apple-system, \"Segoe UI\", Roboto, \"Helvetica Neue\", sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "0.6875rem"
    fontWeight: 700
    lineHeight: 1.45
    letterSpacing: "0.12em"
  buscador:
    fontFamily: "Nunito, \"Segoe UI Variable\", \"Segoe UI\", system-ui, sans-serif"
    fontSize: "clamp(1.35rem, 4vw, 2.25rem)"
    fontWeight: 300
    lineHeight: 1.45
    letterSpacing: "-0.03em"
rounded:
  sm: "3px"
  md: "10px"
  full: "999px"
spacing:
  1: "0.25rem"
  2: "0.5rem"
  3: "0.75rem"
  4: "1rem"
  5: "1.5rem"
  6: "2rem"
  7: "3rem"
  8: "4rem"
components:
  button-primary:
    backgroundColor: "{colors.coral}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    padding: "0 {spacing.4}"
    height: "3.5rem"
  button-primary-hover:
    backgroundColor: "{colors.coral-deep}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    padding: "0 {spacing.4}"
    height: "3.5rem"
  button-outline:
    backgroundColor: transparent
    textColor: "{colors.cream}"
    typography: "{typography.label}"
    padding: "0 {spacing.4}"
    height: "3.5rem"
  pieza:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.cream}"
    rounded: "{rounded.md}"
    size: "2 / 3"
  nav-link:
    backgroundColor: transparent
    textColor: "{colors.ash}"
    typography: "{typography.label}"
    height: "2.75rem"
  conmutador:
    backgroundColor: transparent
    textColor: "{colors.ash}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    height: "3rem"
  buscador:
    backgroundColor: transparent
    textColor: "{colors.cream}"
    typography: "{typography.buscador}"
    height: "clamp(3.25rem, 8vw, 4.5rem)"
  hoja:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.cream}"
    rounded: "{rounded.md}"
---

# Sistema de diseño: nn-anime

> Los encabezados van en inglés porque el formato DESIGN.md los empareja por nombre exacto y las
> herramientas que lo leen dependen de esa cadena. La prosa va en español, como el resto del
> repositorio. El frontmatter es normativo: si un valor de aquí y uno de `tokens.css` discrepan,
> manda `tokens.css` y este archivo se corrige.

## Overview

**Estrella polar: «La vitrina a oscuras».**

El sistema nace de una escena de uso, no de una preferencia: alguien sentado, de noche, con la luz
apagada y una portada delante. El fondo es casi negro —`#08080a`, no gris— para que el arte sea lo
único que brilla, y el arte está **dibujado**: seis campos de degradado más un recurso propio por
pieza (trama, mitad, círculo, caja, inicial, cifra) para que doce piezas no parezcan la misma. Cuando
el catálogo no trae portada, no hay un hueco gris: hay una lámina. Esa es la decisión que sostiene
todo lo demás —una aplicación que vive en tu equipo no puede permitirse enseñar huecos muertos—.

La densidad es editorial, no de panel: la vitrina reparte **seis columnas de cartel** y una
**canaleta de nota al margen** que acompaña al tramo mientras se recorre, como el sumario de una
revista. La jerarquía la da la superficie de la pieza dentro de esa retícula, no el adorno. Y el
sistema es **quieto**: el puntero enciende el borde, aviva el campo y destapa el asomo, pero nada
cambia de tamaño ni de sitio, porque una vitrina que se mueve bajo el ratón no se puede leer.

Los dos registros tipográficos son deliberados. La **Nunito** —redonda, de trazo humano, 200 a 1000
en un solo archivo servido por la propia aplicación— lleva todo lo que se lee. La **monoespaciada**
lleva los rótulos y las cifras: es el registro del dato, no el de la casa. Sin la familia instalada
cae a la del sistema, y así se ve en la práctica.

**Características clave:**
- Fondo `#08080a`; la tinta clara es crema `#f5f0e6`, nunca blanco puro.
- Un solo acento: coral `#ff5c35`, en menos del 10 % de cualquier pantalla.
- El arte se dibuja con degradados y pseudo-elementos; un hueco vacío es una lámina, no un gris.
- Elevación por tono y por marco duro; sin desenfoques decorativos.
- Esquinas: vivas en los mandos, 10 px en la pieza, píldora en los carriles.
- Movimiento de 120 / 200 / 320 ms con una sola curva de entrada y una de salida, apagado por
  `prefers-reduced-motion`.

## Colors

Dos temas con el mismo nombre de token y el mismo papel: **sala a oscuras** por defecto y **papel**
en claro. El tema claro no aclara el arte: redefine lo que define el oscuro y deja la pieza igual,
porque debajo de una pieza hay un degradado oscuro y no el fondo de la aplicación.

### Primary
- **Coral** (`#ff5c35`): el único acento del tema oscuro. Rellena la mitad activa del conmutador, el
  borde del foco, la barra de progreso del reproductor y el mando primario. Su escasez es el punto:
  si hay dos corales compitiendo en la misma pantalla, uno sobra.
- **Coral profundo** (`#e8451f`): el coral cuando el puntero está encima de un mando primario. Nunca
  en reposo.
- **Coral ascua** (`#c02f10`) y **ascua profunda** (`#a32512`): el mismo papel en tema claro. El coral
  saturado sobre crema no llega al contraste que el spec pide; el ascua sí.

### Neutral
- **Tinta** (`#08080a`): el fondo de la sala, el texto sobre coral y el negativo del arte.
- **Superficie** (`#0e0e13`) y **superficie elevada** (`#14141b`): el asomo, la hoja y los avisos. Un
  escalón de tono, no una sombra.
- **Crema** (`#f5f0e6`): el texto, los bordes de verdad y las reglas fuertes del tema oscuro. En la
  cabecera, el filete inferior es crema a 2 px: no hay gris intermedio en esa función.
- **Ceniza** (`#a8a094`): texto secundario, rótulos y metadatos. Sobre el fondo de la sala pasa el
  4.5:1; sobre el arte de una pieza **no se usa**, para eso está el crema mezclado.
- **Papel** (`#f2ede3`) y **papel elevado** (`#fbf8f2`): el tema claro.
- **Carbón** (`#14120f`): texto y bordes del tema claro; es también el negativo sobre coral ascua.
- **Menta** (`#63d9a0`) y **musgo** (`#1d6b3f`): el éxito, oscuro y claro. **Salmón** (`#ff8a80`) y
  **ladrillo** (`#a32222`): el error. No son acentos: no rellenan nada que no sea un estado.

### Named Rules
**The Two Inks Rule.** Sobre una pieza, el texto es crema en **los dos** temas. Lo que hay debajo es
arte oscuro, no el fondo de la aplicación; el texto oscuro del tema claro caía a 3:1 sobre el
degradado. La tinta de encima se declara una vez y todo lo demás se mezcla consigo mismo.

**The Measured Contrast Rule.** Ningún par de color se afirma de memoria. `a11y.test.ts` calcula cada
combinación que el sistema usa y falla por debajo de 4.5:1 en texto y 3:1 en partes de componente. Un
par nuevo entra con su medición, no con su opinión.

**The One Voice Rule.** El coral no es decoración: es el sitio donde se puede pulsar o donde el
sistema dice «aquí». Bordes de arte, divisiones y metadatos no llevan acento nunca.

## Typography

**Fuente de titulares:** Nunito (con `Segoe UI Variable`, `Segoe UI`, `system-ui`)
**Fuente de texto:** Nunito (misma familia, otro peso)
**Fuente de rótulos:** monoespaciada del sistema (`ui-monospace`, `Consolas`)

**Carácter:** una sola familia humanista para todo lo que se lee, con la jerarquía puesta en el
**peso** —800 en el titular de la marquesina, 700 en la pieza, 300 en el campo de búsqueda— y no en el
contraste entre familias. El archivo vive en el repositorio y lo sirve la aplicación: la CSP es
`default-src 'self'` y un e2e no puede depender de la red, así que una hoja de Google dejaría la
aplicación sin letra en el peor momento. Cualquier familia nueva que no viaje en el repositorio rompe
ese contrato.

### Hierarchy
- **Display** (800, `clamp(3rem, 9vw, 7.5rem)`, 1.05, −0.03em): el titular de la marquesina, y sólo
  ahí. Se acota a tres renglones; a cuerpo de cartel, un nombre con subtítulo empujaba los mandos
  fuera de la pantalla. El nombre completo sigue en la ficha.
- **Headline** (600, `clamp(1.25rem, 1.9vw, 1.75rem)`, 1.05, −0.03em): el titular de un tramo, en la
  nota al margen o en su cabecera.
- **Title** (700, `clamp(1.05rem, 2.4cqi + 0.5rem, 1.6rem)`, 1.05, −0.01em): el título de una pieza.
  Se mide contra **el ancho de la pieza** (`cqi`), no contra la ventana: el mismo titular mide lo
  mismo en la rejilla de seis columnas que en la de dos.
- **Body** (400, `0.9375rem`, 1.45): sinopsis, ajustes, textos de estado. La medida de lectura va
  topada a 60ch (`--measure`) o 60rem en las pantallas de una columna.
- **Label** (700, `0.6875rem`, 0.12em, mayúsculas, monoespaciada): mandos, navegación, metadatos y
  cuentas de tramo. Es el registro del dato.

### Named Rules
**The Weight-Not-Family Rule.** No entra una segunda familia para diferenciar un titular. La
diferencia se hace con peso, cuerpo e interletrado, que es lo que ya sostiene la jerarquía.

**The Datum In Mono Rule.** Lo que es un número o una etiqueta de sistema va en monoespaciada y
mayúsculas con 0.12em de interletrado. Lo que se lee como una frase, no.

## Layout

La vitrina es una rejilla de **12 columnas** por tramo: la nota ocupa las dos primeras —pegajosa, a
la altura de la cabecera más 1.25rem— y el cuerpo las diez restantes. El cuerpo es un **mosaico de
seis columnas** de carteles 2:3, con el hueco `clamp(0.5rem, 1.1vw, 1rem)` entre piezas y el canal de
página `clamp(1rem, 4vw, 3.5rem)` a los lados. El aire entre tramos es `clamp(2.5rem, 6vw, 5rem)` y no
crece: el sistema gasta el alto en piezas, no en separación.

La **marquesina** va a sangre, mide `min(62dvh, 44rem)`, se reparte en `1fr / 0.58fr` (columna de
texto y cartel) y su titular es el cuerpo de cartel del sistema. La **cinta** de lo más visto corre
pegada a su borde inferior, a velocidad constante —60 px/s—, con la vuelta calculada sobre el ancho
real del carro.

Fuera de la vitrina manda la columna de lectura: `max-width: 1200px` centrado y `3rem` de relleno,
que es lo que usan la ficha, la búsqueda, los ajustes y el perfil. La home y la reproducción van
**sin tope**; la ficha va sin tope y sin relleno, porque su banda cruza la pantalla.

Recompone en cuatro anchos y no encoge:
- **> 1400**: seis columnas, nota al margen pegajosa.
- **≤ 1400**: cuatro columnas y la nota **vuelve a cabecera** del tramo. La canaleta mide ~84 px a
  1280 y el titular no cabe: se cortaba bajo el primer cartel. El mismo corte que aprieta la rejilla
  es el que devuelve la nota arriba.
- **≤ 1100**: tres columnas; la marquesina pasa a un bloque con el cartel detrás al 34 % de opacidad.
- **560–820**: dos columnas; marquesina de `46dvh`.
- **< 560**: una columna, y la pieza deja de ser cartel: es una **banda** de `clamp(6rem, 30vw, 9rem)`,
  porque un 2:3 a ancho de teléfono ocupa la pantalla entera. El asomo no cabe y se lee en la hoja.

## Elevation & Depth

El sistema es **plano con marco**: la profundidad se cuenta con tono y con borde, no con desenfoque.
Un escalón de superficie —`#0e0e13` → `#14141b`— separa el asomo y la hoja del fondo, y el borde de
2 px es lo que dice «esto se pulsa». Un borde decorativo puede quedarse al 14 % de tinta
(`--color-rule`); el de algo que se pulsa llega al 45 % (`--color-control-border`) porque tiene que
pasar el 3:1.

Donde hay sombra, es **dura y desplazada**, sin radio de difusión: es una decisión de la lengua, no un
descuido. La sombra del botón activo **no repite su relleno** —si lo repitiera, se leería como dos
botones, uno detrás de otro— sino que va en el borde del sistema.

### Shadow Vocabulary
- **Pulsado** (`4px 4px 0 var(--color-border)`): el mando activo o primario. Es la sombra por defecto
  del sistema.
- **Flotante** (`0 8px 24px rgb(0 0 0 / 45%)`): sólo la hoja y los diálogos, que están en la capa
  superior y no tienen marco.
- **Contacto** (`0 1px 2px rgb(0 0 0 / 40%)`): la sombra mínima de un control sobre otro.
- **Sobre el arte** (`0 2px 18px rgb(8 8 10 / 55%)`): el texto de una pieza, para que se lea sobre
  cualquier portada.

### Named Rules
**The Flat-By-Default Rule.** En reposo no hay sombra difusa. Si una superficie necesita separarse y
no se puede separar por tono ni por borde, el problema es la composición, no la falta de sombra.

**The Blur Is Motion Rule.** El único desenfoque del sistema es el del asomo al entrar (`2px` → `0`);
es movimiento, no profundidad, y se apaga con `prefers-reduced-motion`.

## Shapes

Dos radios y una píldora: `10px` (`--radius-md`), que es el radio de **todo** lo que tiene marco
redondeado —la pieza, los avisos, el recuadro de estado y las esquinas de arriba de la hoja—; `3px`
(`--radius-sm`), que hoy sólo usa el enlace de salto; y `999px` (`--radius-full`), para el carril del
conmutador y el mando redondo de la pieza. `--radius-lg` (`14px`) está declarado y no lo usa nada: o
entra cuando una superficie lo pida, o se retira.

El arte se recorta contra el marco: la inicial a `132cqi`, la cifra del
año a `48cqi` y el círculo se salen de la pieza y el `overflow: clip` los corta. El corte es parte del
dibujo.

Los **mandos son de esquina viva**: `.button` no declara radio y el sistema real de un mando es de
borde duro a 2 px. Ponerle radio a un botón es un cambio de sistema, no un ajuste.

Una forma propia: el **cartel** de la marquesina va girado `-3.5deg` con un marco de `0.5rem` de tinta
al 35 %. Es el único elemento del sistema que no está alineado a la retícula, y por eso se lee como un
objeto puesto encima y no como una caja más.

## Components

### Buttons
- **Shape:** esquina viva, borde de 2 px, alto mínimo `3.5rem` (`--header-height`), relleno `0 1rem`.
- **Voz:** monoespaciada `0.6875rem`, 700, mayúsculas, 0.12em. Un botón se lee como una etiqueta.
- **Primary:** relleno coral, texto tinta, sombra dura de 4 px en el borde del sistema. Hover a coral
  profundo.
- **Outline (por defecto):** fondo transparente, borde crema a 2 px, texto crema. Es el mando de la
  casa; el primario se gana el sitio.
- **Hover / Focus:** el hover cambia relleno y color en 120 ms; el foco es un anillo de 2 px con 2 px
  de separación, y nunca se dibuja con `:focus` a secas.
- **Activo:** `aria-pressed="true"` se pinta igual que el primario, sin que el componente lo sepa.
- **Disabled:** texto y borde en ceniza, sin relleno.

### Chips
- **Sello de origen** (búsqueda): fondo tenue, texto de rótulo, relleno `0.2rem 0.4rem`, sin radio.
  Dice de qué proveedor viene un resultado; no es un filtro y no se pulsa.

### Cards / Containers
- **Pieza:** cartel 2:3, radio 10 px, borde 1 px de regla, fondo superficie, arte a sangre recortado
  por el marco. El pie lleva título (700, medido en `cqi`), una línea de datos en rótulo con crema al
  84 % y, en la fila que se retoma, la barra de progreso de `0.3rem`.
- **Velo:** un degradado a negro del 88 % al 0 % desde abajo sostiene el pie sobre cualquier arte.
- **Hover:** el borde sube al 45 % y el campo se aviva (`saturate(1.12) contrast(1.05)`). **No cambia
  de tamaño, no se eleva, no se desplaza.**
- **Favoritos:** el mismo arte, apagado (`saturate(0.32) brightness(0.9)`). Lo ya visto no compite.

### Inputs / Fields
- **Buscador:** no es una caja. Fondo transparente, sin borde salvo el inferior de 2 px en tinta, alto
  `clamp(3.25rem, 8vw, 4.5rem)` y el cuerpo del titular en 300. En la vitrina el campo *es* un
  titular: buscar es la primera acción del producto y se le da el sitio de un titular.
- **Focus:** el anillo del sistema, no un cambio de borde.
- **Vacío / error:** el aviso va debajo, como estado del tramo, nunca dentro del campo.

### Navigation
- **Cabecera:** pegajosa, alto `3.5rem`, fondo de la sala y filete inferior de 2 px en crema. La marca
  a la izquierda en 800 mayúsculas; los destinos en monoespaciada de rótulo; el conmutador de tipo
  empujado al borde con `margin-inline-start: auto`.
- **Estado:** los destinos van en ceniza; el actual, en crema con filete coral de 2 px, marcado por
  `aria-current`. El color no es la única señal.
- **Conmutador de tipo:** carril de píldora con borde al 45 %, dos columnas iguales y una píldora coral
  que **se desliza** con `transform` en 200 ms. Las mitades miden lo mismo para que el deslizamiento
  tenga dónde llegar.
- **Móvil:** la cabecera envuelve y el conmutador baja a su propio renglón antes que apretar la marca.

### Pieza con asomo (componente de firma)
La pieza es la unidad del sistema y su interacción es la firma: en reposo, arte y pie; con puntero o
foco, un **asomo** opaco de superficie elevada —tono, no velo— que entra con cruce de opacidad y
desenfoque de 200 ms y presenta sinopsis a tres renglones, el motivo y las acciones. El asomo se saca
del orden de tabulación cuando está oculto (`visibility` con retardo) para no dejar dos paradas de
teclado muertas por pieza. En una pantalla ancha, el botón redondo «i» de `2.75rem` sólo aparece al
pasar por encima; en táctil se ve siempre.

### Hoja
`<dialog>` nativo con `showModal`, anclado abajo, radio 10 px en las esquinas de arriba y asa de
`2.5rem`. Es el asomo
cuando no cabe —teléfono— y para el teclado. Se llama hoja y no panel porque el panel del motor ya usa
ese nombre.

### Estados vacíos
Vacío, cargando y fallo son parte del producto. El vacío de un tramo va en **un renglón** —título en
600 y cuerpo en ceniza—, no con la forma de un cartel: con forma de cartel pesaba lo mismo que un
título. Los esqueletos laten a 900 ms con la métrica de la pieza, y el aviso de una mitad del catálogo
sin fuente va en un recuadro de acento con su explicación y su arreglo.

## Do's and Don'ts

### Do:
- **Do** declarar el movimiento con `--transition-fast` (120 ms), `--transition-normal` (200 ms) y
  `--ease-piece`; heredar el apagado de `prefers-reduced-motion` sin escribir un `0ms` propio.
- **Do** medir un par de colores nuevo en `a11y.test.ts` antes de usarlo.
- **Do** dibujar el arte con los seis campos (`--cover-a` a `--cover-f`) y un recurso por pieza, con
  `cqi` para que escale con la pieza y no con la ventana.
- **Do** poner toda clase nueva en `tokens.css` o `shell.css`, y toda medida nueva en `tokens.css`: la
  hoja de estructura no admite números sueltos y hay una prueba que lo impide.
- **Do** dar a cada tramo una nota que diga **por qué existe** además de qué contiene.
- **Do** mantener los mandos en 44 px o más y el rótulo en monoespaciada de 0.12em.

### Don't:
- **Don't** cambiar la geometría de una pieza al pasar el puntero: nada de escala, elevación ni
  desplazamiento. La vitrina no se mueve.
- **Don't** usar el coral como decoración ni como segunda voz: es el sitio donde se pulsa o donde el
  sistema señala.
- **Don't** poner blanco puro ni negro puro: la tinta es crema y el fondo es `#08080a`.
- **Don't** introducir una familia tipográfica que no viaje en el repositorio; la CSP es
  `default-src 'self'` y el e2e no tiene red.
- **Don't** usar gris intermedio para un borde de control: o regla al 14 %, o control al 45 %.
- **Don't** añadir sombras difusas para separar superficies: separa el tono, o el borde, o la
  composición.
- **Don't** aclarar el arte en el tema claro: la pieza se ve igual en los dos temas.
- **Don't** inventar cifras ni señales sociales en los textos de la interfaz: no hay clientes, ni
  usuarios contados, ni telemetría que los sostenga.
