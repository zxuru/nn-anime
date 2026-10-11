# Plan de tareas: los mandos del reproductor

Spec: `docs/specs/SPEC-web-ui.md` (reproductor) · Estado: hecho · 2026-10-11.

Rige el **Definition of Done** de `tasks/plan.md`: `typecheck`, `lint` y `bun test` en verde,
criterios medidos mutando la implementación, sin `any` ni `@ts-ignore` ni `as` para silenciar, tope
de cinco archivos de implementación por task y commit atómico que cita el task.

## La petición de origen

Con el reproductor en pantalla: el volumen sólo se movía con las flechas —un mando que existe y no
se ve—, y la imagen no respondía al ratón. Se pide poder cambiar el volumen, pausar y reanudar con
un clic, y poner la pantalla completa con un doble clic.

## T80 — `web`: el volumen, el clic y el doble clic del reproductor

**Qué:** una barra de volumen junto al botón de silencio, un clic sobre la imagen que pausa y
reanuda, y un doble clic que pone y quita la pantalla completa.

**Por qué:** el volumen era el único mando sin control a la vista, y el clic sobre la imagen es el
gesto que todo el mundo prueba antes de bajar a los botones.

**Archivos:** `packages/web/src/features/player/Player.tsx`,
`packages/web/src/features/player/usePlayer.ts`,
`packages/web/src/features/player/controls.ts`, `packages/web/src/i18n/es.ts`,
`packages/web/src/styles/shell.css`, `packages/web/src/styles/tokens.css` y las pruebas del
reproductor y su e2e.

**Aceptación:**

- [x] El volumen se cambia con una barra, no sólo con las flechas. Va de 0 a 100 —el número que se
      anuncia— y el elemento recibe el 0 a 1 que entiende. Medido mutando: quitar el `/100` del ida
      y vuelta deja **1 prueba** en rojo; quitar el nombre accesible, el `max=100` o el `value`
      deja **1**.
- [x] Subir el volumen con el silencio puesto devuelve el sonido; bajarlo a cero no lo vuelve a
      poner. Medido mutando: no quitar el silencio deja **1 e2e** en rojo.
- [x] Un clic sobre la imagen pausa y otro reanuda. Medido mutando: sin `onClick` dejan en rojo
      **1 prueba de componente** y **1 e2e**.
- [x] El doble clic pone la pantalla completa y el mismo doble clic la quita, sin tocar la
      reproducción. Medido mutando: sin `onDoubleClick`, **1 prueba de componente** y **1 e2e**;
      sin la rama que pide salir, **1 e2e**.
- [x] El clic sencillo no se ejecuta al instante: espera a ver si el segundo clic lo convierte en un
      doble. Medido mutando: `CLICK_DELAY_MS = 0` deja **1 e2e** en rojo.
- [x] `bun run typecheck` 0 · `bun run lint` 0 errores (los 2 avisos `noDescendingSpecificity`
      preexistentes, medidos también en `main`) · `bun test packages/web` 496 pasan, 0 fallan ·
      `player.e2e.ts` 16 pasan, 3 nuevas.

| Mutación | Pruebas en rojo |
|---|---|
| `volumeFromPercent` sin dividir por cien | 1 (`controls.test.ts`) |
| La barra sin nombre accesible, sin `max=100` ni `value` | 1 (`Player.test.tsx`) |
| El `<video>` sin `onClick` ni `onDoubleClick` | 1 (`Player.test.tsx`) + 1 (e2e) |
| Subir el volumen sin quitar el silencio | 1 (e2e) |
| Sin la rama que sale de la pantalla completa | 1 (e2e) |
| `CLICK_DELAY_MS = 0` | 1 (e2e) |

**Depende de:** T31 (reproductor web). **Tamaño:** S.

**Lo que no se puede medir aquí, y hay que decirlo:** al recibir un segundo `requestFullscreen`, el
Chromium sin pantalla sale de la pantalla completa por su cuenta, así que el resultado se ve igual
con la rama de salida y sin ella. Esa rama se mide con un contador sobre `document.exitFullscreen`,
no con el resultado: lo que distingue una implementación de la otra es que se **pida** salir.

**Ajeno a este task, y por eso se declara:** de las 40 pruebas del e2e, 2 fallan
—`favorites.e2e.ts:48` y `home.e2e.ts:62`—. La pareja `favorites`+`home` falla igual en `main`, con
los mismos mensajes: el favorito que guarda la primera deja a la segunda sin su estado «sin
historial». Y el presupuesto de tiempo de `recsys` falla en la suite entera (69,10 ms medidos en
`main` contra el presupuesto de 50), no en su paquete.
