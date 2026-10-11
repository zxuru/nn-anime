---
name: agente-worktree
description: Un agente por worktree en nn-anime. Use al empezar cualquier task del repositorio, antes de escribir o editar código, y al terminarlo. Use también cuando el commit falle con «commit directo en main», cuando el índice parezca compartido con otra sesión, cuando haya que reclamar un task (T60, T26b), cerrar o integrar una rama, o cuando otro agente trabaje a la vez en el mismo repositorio.
---

# Un agente por worktree

Este repositorio lo trabajan varios agentes a la vez. Un solo directorio es un solo índice de
git y un solo `tasks/todo.md`: dos sesiones simultáneas se llevan el *stage* del otro y se borran
las líneas mutuamente.

## Antes de escribir una línea

```bash
bun run scripts/agente.ts abrir T60
```

Crea el worktree en `.worktrees/T60`, la rama `tarea/T60` y el reclamo `refs/claims/T60`. Si otra
sesión ya tiene el task, sale con error: elige otro, no insistas.

Trabaja **dentro de `.worktrees/T60`**, no en la raíz del repositorio. Ahí hay que repetir
`bun install`, y el servidor va con su propio puerto y sus propios datos:

```bash
cd .worktrees/T60 && bun install
NN_ANIME_DATA_DIR=.worktrees/T60/.data bun run start -- --port 9060
```

Sin eso, dos agentes comparten la base SQLite y aparece un `SQLITE_BUSY` que no es un fallo del
código.

## Al terminar

1. Commitea en el worktree, con la lista de rutas: `git commit -m "feat(server): … (T60)" -- <rutas>`.
2. Deja el fragmento de cierre en `tasks/done/T60.md` (formato en `tasks/done/README.md`).
3. Integra desde la raíz:

```bash
bun run scripts/agente.ts cerrar T60
```

Rebasa sobre `main`, hace el merge, borra el worktree y libera el reclamo.

## Reglas que el gancho también vigila

- **`main` no se toca a mano.** Un commit directo en `main` lo rechaza `.githooks/pre-commit`. El
  integrador lo permite con `NN_ANIME_INTEGRADOR=1`.
- **Un solo escritor por archivo compartido.** `tasks/todo.md` y `tasks/plan.md` los escribe el
  integrador; el agente deja su fragmento en `tasks/done/`.
- **Un solo editor por spec.** Mientras un task toca un `docs/specs/SPEC-*.md`, ese spec queda
  congelado. Las demás propuestas van a `docs/specs/proposals/`.
- **Partición por paquete.** Dos agentes sobre `packages/server/src/routes/` chocan aunque estén
  aislados; el merge lo revela tarde.

El detalle está en `AGENTS.md`, sección «Varios agentes a la vez». `bun run scripts/agente.ts estado`
dice quién tiene qué.
