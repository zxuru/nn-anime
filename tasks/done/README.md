# Fragmentos de cierre

`tasks/todo.md` y `tasks/plan.md` los escribe **una sola mano**: la del integrador. Un agente que
trabaja en un worktree no los toca. Dos ediciones del mismo archivo se pisan y una desaparece sin
que nadie lo note.

Al cerrar una tarea, el agente deja aquí `T60.md` con este formato:

```markdown
## T60 — la carátula que no resuelve

**Estado:** hecho.

**Commit:** `feat(catalog-store): la carátula que no resuelve (T60)`.

**Verificación:** `bun test packages/catalog-store` 34 pasan · mutación: quitar el guardián de
`cover-ref.ts` hace fallar 2.

**Nota:** lo que quede pendiente o no se haya podido medir.
```

## Qué hace el integrador

En el mismo commit, y en este orden:

1. **Pega el bloque en `tasks/todo.md`** si la tarea es del plan vigente. El todo es la fuente de
   verdad de lo que está abierto y de cómo se cerró.
2. **Añade su fila a `INDICE.md`** con el id, el título, el commit y la verificación. Es lo que
   permite encontrar el cierre de una tarea que ya no vive en el todo, sin abrir su archivo.
3. **Retira el fragmento.** Su contenido no se pierde: queda en la historia de git, y el índice dice
   con qué commit. Un directorio que crece sin poda deja de ser una bandeja y se convierte en un
   archivo muerto; pasó con los 207 fragmentos de la v1.
4. **Conserva aquí sólo lo que es fuente, no cierre:** este README, `INDICE.md` y los informes de
   medición que otras tareas citan (`T60-cobertura.md`).

La poda no es un borrado a secas: el índice identifica cada fragmento y la historia lo conserva.

```bash
# dónde se retiró un fragmento
git log --diff-filter=D --format=%H -- tasks/done/T56.md
# y su contenido, en el commit anterior a la retirada
git show <commit>^:tasks/done/T56.md
```

## Lo que no cambia

El fragmento no sustituye al commit: si no está commiteado, la tarea no ha pasado. Y la verificación
se escribe con su medición, no con un «hecho»: un cierre sin cifras no sirve para volver.
