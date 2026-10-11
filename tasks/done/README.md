# Fragmentos de cierre

`tasks/todo.md` y `tasks/plan.md` los escribe **una sola mano**: la del integrador. Un agente
que trabaja en un worktree no los toca. Dos ediciones del mismo archivo de 2777 líneas se pisan
y una desaparece sin que nadie lo note.

Al cerrar una tarea, el agente deja aquí `T60.md` con este formato:

```markdown
## T60 — la carátula que no resuelve

**Estado:** hecho.

**Commit:** `feat(catalog-store): la carátula que no resuelve (T60)`.

**Verificación:** `bun test packages/catalog-store` 34 pasan · mutación: quitar el guardián de
`cover-ref.ts` hace fallar 2.

**Nota:** lo que quede pendiente o no se haya podido medir.
```

El integrador pega el bloque en `tasks/todo.md`, lo anota en `tasks/plan.md` si toca y borra el
fragmento en el mismo commit.

El fragmento no sustituye al commit: si no está commiteado, la tarea no ha pasado.
