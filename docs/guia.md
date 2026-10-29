# La guía de la aplicación

Dos tutoriales pequeños, con [driver.js](https://github.com/nilbuild/driver.js):

- **La bienvenida.** Un recorrido de seis paradas que sale solo la primera vez,
  se cierra con Escape o con la ✕ y se repite desde Ajustes o con el «?» de la
  cabecera.
- **Los avisos de novedad.** Un faro que late sobre una función nueva, con un
  diálogo de dos frases y un botón para descartarlo. Sale una vez por
  instalación.

No hay cuentas ni servidor: lo visto se guarda en `localStorage`, bajo
`nn-anime.guia`. Un almacén prohibido —modo privado— no rompe nada; la guía
vuelve a salir en la sesión siguiente.

## Las piezas

| Qué | Dónde |
|---|---|
| Los pasos, los avisos y el estado (datos puros) | `packages/web/src/features/guia/guia.ts` |
| El estado vivo, suscrito desde React | `packages/web/src/features/guia/estado.ts` |
| driver.js: el recorrido y los faros | `packages/web/src/features/guia/useGuia.ts` |
| El «?» de la cabecera | `packages/web/src/features/guia/BotonGuia.tsx` |
| La sección de Ajustes | `packages/web/src/features/guia/SeccionGuia.tsx` |
| El tema del popover | `packages/web/src/styles/shell.css`, al final |
| Los textos | `packages/web/src/i18n/es.ts`, bloque `guia.*` |

`useGuia()` se llama una sola vez, en `App`. Monta los faros de la pantalla
actual y arranca la bienvenida si no se vio. El botón y Ajustes llaman a
`abrirBienvenida(ruta)`, que filtra los pasos que esa pantalla no puede enseñar:
en Ajustes no hay conmutador de tipo ni vitrina, y el contador lo dice.

## Añadir un aviso a una función nueva

1. **El ancla.** El elemento que se va a señalar lleva
   `data-tour={ANCLAS.miAncla}`. Las anclas viven en `ANCLAS` (`guia.ts`); un
   `data-tour` con un nombre que no esté ahí no lo encuentra ninguna prueba.
2. **La entrada.** En `AVISOS`, con un id que no exista ya —la fecha sirve— y las
   claves de texto:

   ```ts
   {
     id: 'watch-party-2026-11',
     ancla: ANCLAS.miAncla,
     titulo: 'guia.aviso.watchParty.titulo',
     cuerpo: 'guia.aviso.watchParty.cuerpo',
     rutas: ['home'],
   }
   ```

3. **Los textos.** En `es.ts`, dentro del bloque `guia.*`. La prueba de claves
   huérfanas falla si se añaden y no se usan, y la de la guía falla si se usan y
   no existen.
4. **La prueba.** `bun test packages/web/src/features/guia` comprueba que el
   ancla está en el marcado y que las claves existen. El e2e
   (`packages/web/e2e/guia.e2e.ts`) comprueba que el faro sale y se descarta.

No hay que tocar nada más: el faro aparece en la siguiente visita a esa pantalla
y no vuelve.

### Por qué un aviso no sale en una instalación nueva

La primera lectura siembra `vistos` con los ids de `AVISOS` que existen en ese
momento y lo guarda. Lo que ya estaba al instalar no es una novedad: quien
acaba de llegar tiene la bienvenida, no una docena de faros. Un aviso publicado
después tiene un id que no está en `vistos` y por eso sí sale, una vez, para
quien ya tenía la aplicación.

## Los faros y el recorrido no se pisan

El recorrido marca `driver-active` en el `body`; los faros se esconden con esa
clase y el faro abierto se cierra. La bienvenida espera a que no haya un
`<dialog>` abierto —el aviso de seguridad manda— y arranca con la pantalla ya
pintada, para que la vitrina tenga su ancla.

## El e2e

El `setup` de Playwright deja la guía como vista en el estado del navegador:
sin eso, cada prueba de la suite empezaría con el popover encima y ningún clic
llegaría. `guia.e2e.ts` borra esa marca para ver la bienvenida y siembra un
estado viejo para ver el faro.

## Lo que no hace

- No hay guía por pantalla ni por rol: una sola persona, una sola bienvenida.
- No hay pasos que naveguen solos. Si un paso necesita otra pantalla, es otro
  aviso o no es un paso.
- No hay telemetría de si se terminó. Se guarda «visto», no «completado».
