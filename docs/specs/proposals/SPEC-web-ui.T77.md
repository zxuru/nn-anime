# Propuesta: el modo compatible del reproductor

Módulo: `web-ui` · Task: T77 · Estado: pendiente de que lo integre el dueño del spec.

## Qué cambia

El contrato del reproductor gana un control y un modo de pintado:

1. **Un botón más en los controles**, «Modo compatible», con `aria-pressed` y sin atajo de teclado.
   Enciende y apaga el modo; el estado vive en la sesión de la página, no se guarda.
2. **El modo compatible**: con él encendido, los fotogramas se pintan en un `<canvas>` 2D
   rasterizado por CPU (`willReadFrequently`) superpuesto al `<video>`, en su misma caja.
   **El `<video>` no se sustituye**: sigue siendo el elemento que reproduce, el que lleva los
   `<track>` de subtítulos y el que habla con `hls.js`.
3. **La sonda**: al primer fotograma de cada fuente —y otra vez al empezar a reproducir— el mismo
   fotograma se dibuja en un canvas por GPU y en otro por CPU y se leen los píxeles de los dos. El
   modo se enciende solo **si el de GPU no tiene imagen y el de CPU sí**. El botón gana sobre la
   sonda: quien está mirando la pantalla no espera a que la sonda se convenza.

Textos nuevos en el catálogo: `player.compat` y `player.compat.on`.

## Por qué

El criterio 1 del objetivo de `SPEC-media-proxy.md` es «un `StreamSource` de cualquier proveedor se
reproduce en el reproductor web **sin tocar el navegador a mano**». Hoy eso depende de que el
navegador pinte el cuadro de video, y hay equipos donde no lo pinta.

Medición de origen, en el equipo que lo reportó (KDE Wayland, NVIDIA RTX 5070, Brave
`Chrome/155.0.8059.40`): su volcado de `brave://gpu` trae `Video Acceleration Information →
Decoding:` **vacío**, `WARNING:media/gpu/vaapi/vaapi_wrapper.cc:130: Should skip nVidia device named:
nvidia-drm` y `Vulkan: Disabled`. Es decir: no hay ni un decodificador por hardware, así que con la
aceleración activada el navegador **decodifica en software y compone en GPU**; el audio suena,
`currentTime` avanza y el cuadro sale negro. Al desactivar la aceleración del navegador compone en
CPU y se ve.

Con `<video>` + MSE no hay API para elegir el camino de composición. WebCodecs sí
(`VideoDecoder.configure({ hardwareAcceleration: 'prefer-software' })`), pero `hls.js` no lo
alimenta y habría que demultiplexar a mano.

## Alternativas descartadas

- **Decodificar con WebCodecs y pintar por CPU.** Es el arreglo de raíz —no dependería del
  decodificador del navegador— pero exige demultiplexar fMP4 y TS en el cliente, y `hls.js` sólo
  entrega bytes a MSE. Es otro proyecto.
- **Lanzar `mpv` automáticamente cuando no haya imagen.** Ya existe el handoff y funciona, pero
  cambia el criterio: la página dejaría de reproducir y aparecería una ventana sola. Queda como
  camino manual («Ver en mpv») y como último recurso del aviso de «sin imagen».
- **Tocar los ajustes del navegador o sus banderas.** Es lo que el usuario pidió no hacer.

## Lo que la propuesta no afirma

Que el canvas arregle el caso. Un canvas por CPU **esquiva** la conversión YUV en la GPU —que es el
camino que falla—, pero la confirmación es visual y es del equipo que lo reportó. Si su GPU tampoco
pinta el canvas, el modo no arregla nada y habrá que ir a WebCodecs o a `mpv`.
