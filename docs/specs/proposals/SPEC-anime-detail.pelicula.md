# SPEC-anime-detail.pelicula — una película no numera capítulos

**Estado:** propuesta, sin integrar. La integra el dueño de `docs/specs/SPEC-anime-detail.md`, que
anota la aprobación y borra este archivo.

## Qué cambia

En el «Objective», el criterio 2 y el bloque `web-ui` describen la columna principal como «título,
sinopsis y episodios». Pasa a:

- **Una película no tiene capítulos.** Cuando el detalle declara `kind: 'movie'`, el bloque que en
  una serie es la lista de episodios se titula **«Película»** y ofrece **una acción** —«Ver
  película»— que abre su única parte. Ni el titular «Episodios», ni la numeración, ni el «de 1»:
  numerar un «Episodio 1 de 1» inventa una lista donde no hay nada que elegir.
- La acción es la única parte **cuando el proveedor sirve una y no anuncia más**. Si la parte en
  varias o publica más páginas, vuelve la lista numerada: esconder partes detrás de un botón
  dejaría contenido sin puerta.
- El resto del bloque no cambia: la lista de una serie se numera y se pagina igual, y los textos de
  carga y error de una película hablan de la película, no de episodios.

En el bloque `web-ui` del «Contrato», la línea de `.detail__body` pasa de

```
└─ .detail__body             título, meta, sinopsis, episodios (sin `--measure` en el bloque)
```

a

```
└─ .detail__body             título, meta, sinopsis y, según el tipo, episodios o «Ver película»
```

## Por qué

Se reportó con una ficha delante: la de una película enseñaba «Episodios» con un «Episodio 1 de 1»,
que se lee como una serie de un capítulo. El dato lo trae el proveedor —el plugin real mapea
`pelicula` a `kind: 'movie'`— y la ficha ya lo recibía para el rail de entregas; lo que faltaba era
usarlo en el bloque principal.

## Alternativas descartadas

- **Deducir «película» de tener un solo episodio.** Llamaría película a un OVA de uno y a un
  especial, que no lo son, y el texto de la acción mentiría. El tipo lo declara el proveedor; el que
  no lo declare sigue con la lista de siempre.
- **Quitar el bloque entero.** Deja la ficha de una película sin puerta al reproductor: se llegaría
  al vídeo sólo desde la home o la búsqueda.
- **Dejar la lista y sólo cambiar el titular.** El «Episodio 1» seguiría ahí, que es lo que se
  reportó.
