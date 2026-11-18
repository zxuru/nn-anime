# La marca

La marca de RoNa se llama **la R-raposa**: una «R» cuyo cuenco es la cabeza de una
raposa, con el triángulo de reproducción en el contador y una órbita coral que la
rodea.

> «Raposa» es la palabra para zorra en gallego y portugués, y en español es la
> variante culta: no arrastra el segundo sentido del diminutivo.

**El maestro es `packaging/icons/icon.svg`**, el dibujo vectorial. `scripts/icon.ts`
lo rasteriza a los ocho PNG, al `.ico` de Windows y al `.icns` de macOS. Guardar
sólo los binarios dejaría tres formatos que nadie puede revisar ni rehacer;
guardar sólo el SVG dejaría al empaquetado sin icono, porque ni Windows ni macOS
leen SVG para el ejecutable.

## Construcción

Todo el dibujo vive en el SVG, en un lienzo de 1254 × 1254 con la lámina
retranqueada 90 unidades. Las piezas, en el orden en que se apilan:

1. **La lámina.** Un cuadrado de esquinas redondeadas —radio 250— sobre tinta
   `#0a070d`, con un filete apenas visible en `#2a1f36`. El margen queda
   transparente: quien recorte el icono no encuentra un borde duro.
2. **El halo interior.** Un círculo `#170f1e` que separa la marca del fondo sin
   una sombra.
3. **La silueta.** Una sola pieza —palo, orejas, cabeza y mechón— que es a la vez
   la raposa y la «R». Se dibuja dos veces: una en tinta con trazo grueso, que
   hace de contorno, y otra en crema encima.
4. **Las orejas.** El hueco coral de cada una, con un segundo tono más oscuro en
   la base que le da el pliegue.
5. **El contador.** El triángulo de tinta y, dentro, el play coral. Es el mismo
   gesto que el botón de reproducir de la interfaz.
6. **La órbita.** Un trazo coral que sale por la izquierda, cruza por delante de
   la pierna y se pierde por la derecha.
7. **El destello.** Una estrella de cuatro puntas en la esquina superior derecha:
   la nota de que hay algo que mirar.

El SVG conserva los degradados y los resplandores del dibujo original. El
rasterizador **no los reproduce**: aplica el subconjunto que el archivo necesita
—`rect`, `circle`, `polygon`, `path` con `M L H V C Q S T Z`, `use` y
`linearGradient`— y convierte los trazos en contorno sólo en los polígonos
convexos (el play). Un desenfoque de 12 unidades sobre 1254 es un manchón a
cualquier tamaño de icono, no una luz; el maestro lo guarda para quien lo use a
gran formato.

## Un solo dibujo en todas las tallas

| Tamaños | Qué se dibuja |
|---|---|
| 16, 32, 48, 64, 128, 256, 512, 1024 | El maestro tal cual, con su margen, sus orejas, el play y la órbita |

Hubo un segundo nivel de detalle para 16 y 32 px —la «R» desnuda— y se retiró:
el icono del lanzador y el de la cabecera no se parecían, que es un problema
mayor que una silueta apretada. La bandeja del sistema usa `icon-32.png` y a ese
tamaño la raposa entera se sigue leyendo: la crema de la cabeza, el play coral y
la órbita. Si alguna talla dejara de leerse, se simplifica la raposa —orejas,
ojos y play— en el maestro, no se sustituye por otra marca.

La misma regla vale para la web: el favicon de 32 px y el icono táctil de 180 px
los escribe `bun run icon` desde el maestro, y el `logo.svg` de la web es su
copia byte a byte. No hay PNG mantenidos a mano que puedan separarse.

## Paleta

Los valores salen del SVG. Son la familia del coral y la crema de
`packages/web/src/styles/tokens.css`, un punto más cálidos porque el icono se ve
sobre fondo oscuro.

| Uso | Valor |
|---|---|
| Fondo de la lámina | `#0a070d` |
| Halo interior | `#170f1e` |
| Filete de la lámina | `#2a1f36` |
| Silueta | degradado `#fdeee0` → `#f6d9c6` |
| Órbita | degradado `#f4552a` → `#ff8a4a` |
| Play | degradado `#ff6a3d` → `#ee4b25` |
| Pliegue de la oreja | `#a8321c` |
| Destello | `#fdeee0` |

Un solo acento, como en la interfaz: el coral no rellena nada que no sea la
órbita, el play o el hueco de las orejas.

## Dónde se usa

| Archivo | Quién lo consume |
|---|---|
| `icon.svg` | El maestro editable y los usos que admiten vector |
| `icon.ico` | El `.exe` de Windows y la ventana de Tauri |
| `icon.icns` | El `.app` de macOS |
| `icon-32.png` | La bandeja del sistema (`desktop/src-tauri/src/tray.rs`) |
| `icon-256.png` | La ventana de Tauri |
| `icon.png`, `icon-512.png` | El README, Linux y la ficha de Discord |
| `icon-16/48/64/128.png` | Los sistemas que piden un tamaño concreto |
| `packaging/icons/logo-aprobado.png` | El logo aprobado por el usuario |
| `packages/web/public/brand/logo.svg` | La cabecera; copia byte a byte del maestro |
| `packages/web/public/brand/favicon-32.png`, `touch-180.png` | El navegador y la pantalla de inicio, rasterizados del maestro |

En Discord, la clave de la imagen es `rona` y se sube `icon-1024.png`. En Linux,
`packaging/linux/rona.desktop` apunta a `Icon=rona`.

## El nombre escrito

El símbolo no lleva letras: a 16 px un logotipo con texto es una mancha y a 1024
sobra. El nombre va aparte, en **Nunito 800, mayúsculas y `−0.03em` de
interletrado** —`RONA`—, que es la marca de la cabecera
(`packages/web/src/styles/base.css`, `.shell__brand`). Las parejas permitidas:

- **Símbolo + `RONA`**, en horizontal, para cabeceras y material de presentación.
- **Símbolo solo**, para la ventana, la bandeja y el icono de la aplicación.

Una versión `RoNa` en capitales mixtas puede usarse en prosa editorial, nunca en
la cabecera de la aplicación ni en el icono.

## Reglas

- **El maestro vectorial se edita en el SVG.**
  `bun run icon` vuelve a escribir sus ocho PNG, el `.ico` y el `.icns`, y desde
  el mismo dibujo genera el favicon, el icono táctil y la copia `logo.svg` de la
  web. Es idempotente: dos ejecuciones seguidas dejan el árbol igual.
- **El rasterizador falla con lo que no entiende.** Si el SVG estrena una
  etiqueta, un comando de `path` o un gradiente que no esté definido, el generador
  se para con su nombre en vez de dibujar otra cosa. Es la prueba que lo defiende:
  `scripts/icon.test.ts`.
- **No se añade un tercer nivel de detalle** sin medirlo a 16, 32 y 64 px.
- **El nombre no entra en el símbolo.** Si hace falta el nombre, se usa la pareja
  símbolo + `RONA`.
- **El icono no lleva transparencia interior.** Sólo el margen de la lámina es
  transparente; un agujero interior se convierte en un borde blanco en los modos
  de alto contraste.

## Cómo se regenera

```bash
bun run icon
```

No hay dependencias de imagen: el SVG se lee y se rasteriza en el propio
`scripts/icon.ts`, el PNG se codifica con `deflate` de Bun y el `.ico`, el `.icns`,
el CRC-32 y el zlib también. La razón está en la cabecera del archivo: un
repositorio sin dependencias de imagen no añade una para dibujar una raposa.
