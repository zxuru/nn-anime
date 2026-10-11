# SPEC-web-ui.T67 — el título de la pestaña

**Estado:** propuesta, sin integrar. La integra el dueño del spec, que anota la aprobación y borra
este archivo.

## Cambio exacto

En `docs/specs/SPEC-web-ui.md`, sección «Accesibilidad, mínimos verificables», un punto más:

```markdown
- El título del documento nombra la pantalla, y en el detalle y el reproductor nombra el título
  del anime y el episodio. Es la única etiqueta que distingue varias pestañas abiertas a la vez.
```

## Motivo

Con cuatro fichas abiertas, las cuatro pestañas se llamaban «nn-anime»: no había forma de saber
cuál era cuál sin abrirlas, ni de saber por qué episodio iba la que estaba reproduciendo. El
título del documento es texto de interfaz, así que su contenido es parte del contrato de la
interfaz y no un detalle de implementación.

La pantalla de reproducción, además, no enseñaba en ninguna parte qué estaba reproduciendo: el
encabezado con el nombre del título y el episodio entra en este mismo cambio y es lo que el punto
del spec pide sostener.

## Alternativa descargada

Poner el nombre del título sólo en el reproductor y dejar el resto de pantallas con el nombre de
la aplicación. Se descarta porque el problema no es del reproductor: es de tener varias pantallas
de la misma aplicación abiertas, y eso pasa igual con cuatro fichas que con cuatro episodios.

## Verificación

- `bun test packages/web` · 436 verdes, 23 de ellos nuevos en `lib/document-title.test.ts`.
- `bun run e2e` · 29 verdes; dos fallos preexistentes de `favorites` y `home` que se reproducen
  igual en `main` sin este cambio.
- Mutación medida: quitar la llamada de `DetailPage` y no pedir el nombre del título en
  `WatchPage` hace fallar los dos casos nuevos del e2e.
