# La marca

La marca de RoNa se llama **la R-raposa**: una «R» cuyo cuenco es la cabeza de una
raposa, con el triángulo de reproducción en el contador y una órbita coral que la
rodea. Se dibuja **desde código**, en `scripts/icon.ts`, y de ahí salen todos los
formatos y tamaños que consumen la ventana, la bandeja, Linux, el README y
Discord.

> «Raposa» es la palabra para zorra en gallego y portugués, y en español es la
> variante culta: no arrastra el segundo sentido del diminutivo. La bestia mira a
> la derecha, que es hacia donde se pulsa.

## Construcción

Todo va en fracciones del lado —nada en píxeles— para que el mismo dibujo salga a
16 y a 1024. Las piezas, en el orden en que se apilan:

1. **La lámina.** Un cuadrado a sangre con las esquinas redondeadas a `0.185`
   del lado y transparentes por fuera: quien recorte el icono —macOS, Windows,
   un lanzador— no encuentra un borde duro que delate el dibujo.
2. **El fondo.** Tinta `#08080a` con un levante radial apenas perceptible hacia
   `#1d1521`. Es el escalón de superficie del sistema, no un degradado de
   escaparate.
3. **La órbita.** Una elipse inclinada `−0.30 rad`, más gruesa en la bajada
   izquierda y afilada al coronar por la derecha. Se pinta **antes** que el
   cuerpo, así que sólo se ve el arco que sale de la silueta, como el anillo de
   un planeta. Delante cruzaba la cara y el contador, y el icono parecía una
   raposa con un cinturón.
4. **El cuerpo.** La unión de la cabeza (el cuenco de la «R»), las dos orejas, el
   palo y la pierna. La cabeza está desplazada a la derecha a propósito: si la
   elipse cubriera el palo entero, no quedaría «R», sólo una mancha.
5. **Las orejas.** Triángulos con las esquinas redondeadas y su hueco coral,
   espejo exacto la una de la otra.
6. **El contador.** Un triángulo de tinta agrandado y, dentro, el play coral. A
   tamaño de bandeja el play pasa a tinta directa sobre crema: es el par de más
   contraste de la paleta.
7. **El destello.** Una superelipse de cuatro puntas en la esquina superior
   derecha: la nota de que hay algo que mirar, no un adorno que se repita.

## Los tres tamaños

El detalle se apaga según el tamaño. No es una decisión estética: a 16 px la
silueta completa se midió y era una mancha de crema con un punto.

| Nivel | Tamaños | Qué se dibuja |
|---|---|---|
| **Completa** | 128, 256, 512, 1024 | Fondo con levante, orejas coral, play coral con contorno de tinta, órbita y destello |
| **Media** | 48, 64 | Sin levante ni destello; conserva orejas, play con contorno y órbita |
| **Micro** | 16, 32 | La «R» desnuda, con el palo y la pierna a dos píxeles y el contador abierto |

El corte está en 48: por debajo, la órbita mide menos de un píxel de grosor y el
destello se convierte en una mota. La variante micro **no es una miniatura**: es
la misma marca contada con una sola pieza.

## Paleta

Los valores salen de `packages/web/src/styles/tokens.css`; si allí cambian, aquí
cambian también.

| Uso | Token | Valor |
|---|---|---|
| Lámina | tinta | `#08080a` |
| Fondo | superficie, un escalón | `#0b0b11` |
| Levante del fondo | — | `#1d1521` |
| Silueta, destello | crema | `#f5f0e6` |
| Órbita, orejas, play | coral | `#ff5c35` |

Un solo acento, como en la interfaz. El coral no rellena nada que no sea la
órbita, el hueco de las orejas o el play: si aparece un cuarto coral, sobra.

## Dónde se usa

| Archivo | Quién lo consume |
|---|---|
| `icon.ico` | El `.exe` de Windows y la ventana de Tauri |
| `icon.icns` | El `.app` de macOS |
| `icon-32.png` | La bandeja del sistema (`desktop/src-tauri/src/tray.rs`) |
| `icon-256.png` | La ventana de Tauri |
| `icon.png`, `icon-512.png` | El README, Linux y la ficha de Discord |
| `icon-16/48/64/128.png` | Los sistemas que piden un tamaño concreto |

En Discord, la clave de la imagen es `rona` y se sube `icon-1024.png`. En Linux,
`packaging/linux/rona.desktop` apunta a `Icon=rona`.

## El nombre escrito

El símbolo no lleva letras: a 16 px un logotipo con texto es una mancha y a 1024
sobra. El nombre va aparte, en **Nunito 800, mayúsculas y `−0.03em` de
interletrado** —`RONA`—, que es la marca de la cabecera
(`packages/web/src/styles/base.css`, `.shell__brand`). Las parejas permitidas:

- **Símbolo + `RONA`**, en horizontal, para cabeceras y material de presentación.
- **Símbolo solo**, para la ventana y la bandeja.
- **La «R» micro**, cuando el símbolo baja de 48 px.

Una versión `RoNa` en capitales mixtas puede usarse en prosa editorial, nunca en
la cabecera de la aplicación ni en el icono.

## Reglas

- **No se edita un PNG a mano.** `bun run icon` vuelve a escribir los ocho PNG,
  el `.ico` y el `.icns`; si el dibujo cambia, cambia el código.
- **No se añade un cuarto nivel de detalle** sin medirlo a 16, 32 y 64 px: el
  umbral de 48 existe porque la órbita deja de verse.
- **El nombre no entra en el símbolo.** Si hace falta el nombre, se usa la pareja
  símbolo + `RONA`.
- **No se cambia el coral por otro naranja.** El icono y la interfaz comparten
  acento; dos naranjas distintos se notan al ponerlos juntos.
- **El icono no lleva transparencia interior.** Sólo las esquinas de la lámina
  son transparentes; un agujero interior se convierte en un borde blanco en los
  modos de alto contraste.

## Cómo se regenera

```bash
bun run icon
```

No hay dependencias de imagen: el PNG se codifica en el propio script —Bun trae
`deflate`— y el `.ico`, el `.icns`, el CRC-32 y el zlib también. La razón está en
la cabecera de `scripts/icon.ts`: un repositorio sin dependencias de imagen no
añade una para dibujar una raposa.
