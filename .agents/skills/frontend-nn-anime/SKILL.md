---
name: frontend-nn-anime
description: Revisar o mejorar la interfaz de nn-anime (packages/web) con las skills de diseño, tipografía y movimiento. Úsala cuando pidan revisar, pulir, auditar, rediseñar o animar el frontend, y antes de editar un componente, los estilos o el movimiento de la app.
---

# Frontend de nn-anime

React 19 + Vite 8, sin framework de estilos: dos hojas, `packages/web/src/styles/tokens.css` y
`shell.css`, y clases planas en el marcado. Todo trabajo de diseño pasa por las skills de abajo, y
el resultado se mide mirando la app renderizada, no sólo el CSS.

Los componentes llevan nombre en español (`Pieza`, `Mosaico`, `PanelPieza`, `SectionHeader`):
traduce el vocabulario de las skills al del repo antes de tocar nada.

## 1. Diagnosticar

| Piden | Skill y comando |
|---|---|
| Revisión de diseño, jerarquía, tipografía, textos, estados | `impeccable`: `critique` para el juicio, `audit` para a11y/perf/responsive, `polish` antes de entregar, `typeset`/`layout`/`distill` según el síntoma |
| «Se ve mal»: hover, sombras, bordes, iconos, alineación óptica, stagger | `make-interfaces-feel-better` |
| Qué transición va en cada caso: modal, dropdown, toast, tabs, skeleton, badge | `transitions-dev`; las recetas numeradas están en `.agents/skills/transitions-dev/01-…35-*.md` y su escala de tokens en `_root.css` |

`impeccable` abre pidiendo `scripts/impeccable context`. Aquí los scripts no están instalados: sigue
su ruta de respaldo —avisa antes de la siguiente herramienta, lee `PRODUCT.md`/`DESIGN.md` si
existen (hoy no hay) y lee siempre `reference/craft-floor.md` justo antes de editar.

## 2. Aplicar

- **Los tokens de la casa mandan.** Duración y curva salen de `--transition-fast` (120 ms),
  `--transition-normal` (200 ms) y `--ease-piece`. Las recetas de transitions.dev traen su propia
  escala: se traduce a ésta en el punto de uso, para que el repo siga teniendo una sola.
- **El movimiento usa los tokens, y así se apaga solo.** `tokens.css` ya pone `--transition-*` y
  `--entrada-*` a `0ms` bajo `prefers-reduced-motion: reduce`; una animación con esos tokens hereda
  el apagado. Un `@keyframes` propio lleva su propio `0ms` en esa media query.
- **Cada clase nueva se define en `tokens.css` o `shell.css`.** `styles.test.ts` recorre el marcado
  y falla cuando una clase usada no está definida en ninguna de las dos: es la red que caza el
  estilo muerto.
- **Texto de interfaz en `packages/web/src/i18n/es.ts`**, nunca en el componente.
- **GSAP no es dependencia todavía.** Las skills `gsap-core`, `gsap-timeline`, `gsap-scrolltrigger`,
  `gsap-react`, `gsap-plugins`, `gsap-utils`, `gsap-performance` y `gsap-frameworks` son la
  referencia para el día que entre; hoy el movimiento es CSS. Añadir la dependencia es un task con
  su línea en `tasks/todo.md`, no un cambio suelto dentro de una revisión.

## 3. Cerrar

- Mira la app: `bun run captura` (o el navegador) antes de dar una revisión por buena.
- `bun run typecheck`, `bun run lint` y `bun test` en verde, y el commit con la lista de rutas.
- Una revisión sin cambio de código se reporta con archivo y línea, severidad y el arreglo
  propuesto; el árbol queda como estaba.
