# Plan de tareas: la imagen que la GPU no pinta

Spec: `docs/specs/SPEC-web-ui.md` (reproductor) · Estado: en curso · 2026-10-11.

Rige el **Definition of Done** de `tasks/plan.md`: `typecheck`, `lint` y `bun test` en verde,
criterios medidos mutando la implementación, sin `any` ni `@ts-ignore` ni `as` para silenciar, tope
de cinco archivos de implementación por task y commit atómico que cita el task.

## La medición de origen

Equipo del usuario: KDE Wayland, NVIDIA GeForce RTX 5070 (driver 615.78.08), Brave
`Chrome/155.0.8059.40`. Su volcado de `brave://gpu` dice las tres cosas que importan:

1. `Video Acceleration Information → Decoding:` **vacío**. Ni un perfil de decodificación.
2. `... WARNING:media/gpu/vaapi/vaapi_wrapper.cc:130] : Should skip nVidia device named: nvidia-drm`.
   Chromium descarta el VA-API de NVIDIA.
3. `Vulkan: Disabled`. Tampoco hay camino por Vulkan.

Con la aceleración activada el navegador **decodifica en software y compone en GPU**: el audio suena
y `currentTime` avanza —los dos salen del mismo MSE, así que el proxy y hls.js están bien— y el
cuadro de video se pinta negro. Al desactivar la aceleración del navegador compone en CPU y se ve.

## Qué no se puede hacer

Con `<video>` + MSE el decodificador y el camino de composición los elige el navegador: **no hay API
para pedir el de software**. WebCodecs sí lo permite
(`VideoDecoder.configure({ hardwareAcceleration: 'prefer-software' })`), pero hls.js no lo alimenta
—le entrega bytes a MSE— y habría que demultiplexar a mano. Eso es otro proyecto, no este task.

## Qué se hace aquí

El reproductor deja de depender del pintado del cuadro de video del navegador. Cuando el camino de
GPU no entrega imagen y el de CPU sí, **pinta los fotogramas él mismo** en un `<canvas>` 2D con
`willReadFrequently` (rasterizado por CPU) superpuesto al `<video>`: el canvas llega al compositor
como una textura RGBA corriente, sin la conversión YUV en la GPU que es la que falla. El `<video>`
se queda donde está: es quien reproduce, quien lleva los subtítulos y quien habla con hls.js.

La decisión sale de una **sonda de una vez por fuente**, sobre el primer fotograma: el mismo
fotograma se dibuja en un canvas por GPU y en otro por CPU, se leen los píxeles de los dos y se
pinta por CPU sólo si el de GPU no tiene imagen y el de CPU sí. Además hay un botón para forzarlo a
mano, porque una sonda que sólo mira un fotograma puede no verlo todo.

## T77 — `web`: el reproductor pinta los fotogramas cuando la GPU no los pinta

**Qué:** `compat-paint.ts` con las decisiones en funciones puras, `useCompatPaint.ts` con la sonda y
el bucle, el `<canvas>` y el botón en `Player.tsx`, los textos en `i18n/es.ts` y el estilo en
`styles/shell.css`.

**Por qué:** «el video se reproduce en el reproductor web sin tocar el navegador a mano» es el
criterio 1 del objetivo de `SPEC-media-proxy.md`, y hoy depende de que la GPU del usuario pinte el
cuadro de video.

**Archivos:** `packages/web/src/features/player/compat-paint.ts`,
`packages/web/src/features/player/useCompatPaint.ts`,
`packages/web/src/features/player/Player.tsx`, `packages/web/src/i18n/es.ts`,
`packages/web/src/styles/shell.css`. Pruebas: `compat-paint.test.ts`, `Player.test.tsx` y
`packages/web/e2e/player.e2e.ts`.

**Aceptación:**
- [x] `frameHasImage` mira los canales de color y no el alfa: un píxel `[0, 0, 0, 255]` no es imagen
      y uno con un canal por encima del umbral sí. Medido mutando: contar el alfa deja **2 pruebas**
      en rojo.
- [x] `probeDecision` enciende el modo sólo con `gpu: false` y `cpu: true`. Medido mutando: `&&` por
      `||` deja **2 pruebas** en rojo.
- [x] `startCompatPainter` no pinta sin tamaño de fotograma, redimensiona sólo cuando el tamaño
      cambia, vuelve a programarse y se detiene al pararlo. Medido mutando: aflojar el guardián del
      tamaño deja **1 prueba** en rojo; no cancelar al parar, **1**.
- [x] `canvasSize` respeta el tope de ancho y conserva la relación. Medido mutando: devolver el
      tamaño natural sin tope deja **2 pruebas** en rojo.
- [x] Con el modo apagado el reproductor **no** pinta ningún `<canvas>` y el botón dice
      `aria-pressed="false"`; con él encendido, el canvas está y el `<video>` sigue en el documento.
      Medido mutando: pintar el canvas siempre deja **1 prueba** de componente en rojo, y hacer que
      el botón no haga nada deja el **e2e** en rojo.
- [x] El lienzo se pide por CPU, que es el arreglo entero. Medido mutando: quitar
      `willReadFrequently` deja **1 prueba** en rojo.
- [x] El botón del modo compatible tiene nombre accesible y su texto sale del catálogo (`i18n.test`
      no deja claves huérfanas; el catálogo pasa entero).
- [x] `bun run typecheck` 0 · `bun run lint` 0 errores (2 avisos `noDescendingSpecificity`
      preexistentes, medidos también en `HEAD`) · `bun test packages/web` 482 pasan, 0 fallan ·
      `bunx playwright test` 35 pasan, 0 fallan.
- [x] Control de las mutaciones: `bun test compat-paint.test.ts Player.test.tsx` **30 pasan, 0
      fallan** con el código sin tocar.

**Depende de:** T31 (reproductor web con hls.js). **Tamaño:** M.

**Lo que no se puede medir aquí, y hay que decirlo:** este sandbox no tiene `/dev/dri` ni Wayland,
así que **no se puede comprobar que el canvas arregle el caso del usuario**. Lo que se mide es la
lógica (mutando) y que el modo no rompe la reproducción en el e2e; la confirmación visual es del
equipo del usuario. Si su GPU tampoco pinta el canvas, el modo no arregla nada y habrá que ir a
WebCodecs o a mpv.
