# La guía de la aplicación

Dos tutoriales pequeños, con [driver.js](https://github.com/nilbuild/driver.js):

- **El recorrido de cada pantalla.** Inicio, Buscar, Biblioteca, Perfil,
  Historial, Ajustes, la ficha y el reproductor tienen el suyo. Sale solo la
  primera vez que se entra en esa pantalla, se cierra con Escape o con la ✕, y
  se repite con el «?» de la cabecera o desde **Ajustes → Guía**.
- **Los avisos de novedad.** Un faro que late sobre una función nueva, con un
  diálogo de dos frases y un botón para descartarlo. Sale una vez por
  instalación.

No hay cuentas ni servidor: lo visto se guarda en `localStorage`, bajo
`nn-anime.guia`. Un almacén prohibido —modo privado— no rompe nada; los
recorridos vuelven a salir en la sesión siguiente.

## Las piezas

| Qué | Dónde |
|---|---|
| Los recorridos, los avisos y el estado (datos puros) | `packages/web/src/features/guia/guia.ts` |
| El estado vivo, suscrito desde React | `packages/web/src/features/guia/estado.ts` |
| driver.js: el recorrido y los faros | `packages/web/src/features/guia/useGuia.ts` |
| El «?» de la cabecera | `packages/web/src/features/guia/BotonGuia.tsx` |
| El índice de Ajustes | `packages/web/src/features/guia/SeccionGuia.tsx` |
| El tema del popover | `packages/web/src/styles/shell.css`, al final |
| Los textos | `packages/web/src/i18n/es.ts`, bloque `guia.*` |

`useGuia()` se llama una sola vez, en `App`. Monta los faros de la pantalla
actual y arranca el recorrido pendiente. El «?» y Ajustes llaman a
`abrirRecorrido(id)`.

## Añadir el recorrido de una pantalla nueva

1. **El recorrido.** En `RECORRIDOS`, con un id, el nombre de la sección y las
   rutas que cubre:

   ```ts
   { id: 'manga', titulo: 'guia.recorrido.manga', rutas: ['manga'], pasos: MANGA }
   ```

   Los pasos van en una constante al lado. El primero suele ser una parada
   centrada —sin ancla— que dice qué es la pantalla; los demás apuntan a
   `ANCLAS.*`.

2. **Las anclas.** Cada paso con `ancla` necesita un `data-tour={ANCLAS.miAncla}`
   en el marcado. Las anclas viven en `ANCLAS` (`guia.ts`); una que no esté ahí
   no la encuentra ninguna prueba.

3. **Los textos.** En `es.ts`, dentro del bloque `guia.*`, con la forma
   `guia.<seccion>.<paso>.titulo` y `.cuerpo`. La prueba de claves huérfanas
   falla si se añaden y no se usan, y la de la guía falla si se usan y no
   existen.

No hay que tocar nada más: el recorrido sale en la siguiente visita a esa
pantalla y el «?» lo repite.

## Añadir un aviso a una función nueva

En `AVISOS`, con un id que no exista ya —la fecha sirve—, el ancla, las dos
claves de texto y, si sólo sale en una pantalla, `rutas`:

```ts
{
  id: 'watch-party-2026-11',
  ancla: ANCLAS.reproductorMandos,
  titulo: 'guia.aviso.watchParty.titulo',
  cuerpo: 'guia.aviso.watchParty.cuerpo',
  rutas: ['watch'],
}
```

### Por qué un aviso no sale en una instalación nueva

La primera lectura siembra `vistos` con los ids de `AVISOS` que existen en ese
momento y lo guarda. Lo que ya estaba al instalar no es una novedad: quien
acaba de llegar tiene los recorridos, no una docena de faros. Un aviso publicado
después tiene un id que no está en `vistos` y por eso sí sale, una vez, para
quien ya tenía la aplicación.

## Los faros y el recorrido no se pisan

El recorrido marca `driver-active` en el `body`; los faros se esconden con esa
clase y el faro abierto se cierra. El recorrido espera a que no haya un
`<dialog>` abierto —el aviso de seguridad manda— y arranca con la pantalla ya
pintada, para que sus anclas existan.

## Ajustes y las pantallas que no están en el índice

Ajustes lista los recorridos de las secciones a las que se puede llevar sin más
datos que la ruta: Inicio, Buscar, Biblioteca, Perfil, Historial y Ajustes.
Pulsar uno navega a esa pantalla y abre su tutorial. La **ficha** y el
**reproductor** dependen de un título y un episodio concretos: su «?» vive en su
propia pantalla y no aparecen en el índice.

## El e2e

El `setup` de Playwright deja todos los recorridos vistos en el estado del
navegador: sin eso, cada prueba de la suite empezaría con un popover encima y
ningún clic llegaría. `guia.e2e.ts` borra esa marca para ver Inicio, siembra un
estado vacío para ver Buscar y Biblioteca, y comprueba el índice de Ajustes.

## Lo que no hace

- No hay guía por rol: una sola persona, una sola bienvenida por pantalla.
- No hay pasos que naveguen solos. Si un paso necesita otra pantalla, es otro
  recorrido o no es un paso.
- No hay telemetría de si se terminó. Se guarda «visto», no «completado».
