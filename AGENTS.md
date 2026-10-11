# AGENTS.md

Reglas de trabajo de este repositorio. Se aplican a cualquier agente que escriba código aquí.

## Cerrar cada cambio con un commit

**Todo cambio se commitea antes de pasar al siguiente.** Ningún paso se da por terminado con
archivos modificados fuera del índice: un árbol sucio al empezar el paso siguiente es trabajo que se
pierde o que se mezcla.

- Un commit por tarea, atómico, con el asunto en imperativo y el id del task: `feat(server): la
  ruta del feed (T50)`.
- Se commitea **con la lista de rutas**: `git commit -m "…" -- <rutas>`. El índice lo comparte todo
  el que trabaje en el repositorio a la vez, y un `git commit` sin rutas se lleva lo que otra sesión
  tuviera preparado. Pasó una vez y el mensaje lo tuvo que declarar.
- El commit incluye **sólo** los archivos de esa tarea. Si el árbol ya venía sucio, se commitea
  primero lo pendiente como su propio commit, y lo dice el mensaje.
- Antes de commitear: `bun run typecheck`, `bun run lint` y `bun test` en verde en los paquetes
  tocados. Si algo está en rojo, se arregla o se declara en el mensaje del commit; no se calla.
- El autor es `nn-anime <nn-anime@localhost>` (configuración local del repositorio).

El detalle del listón, con sus ocho puntos, está en el **Definition of Done** de
`tasks/plan.md`; esta sección es la parte que se olvida cuando nadie la repite.

## Varios agentes a la vez

Un solo directorio es un solo índice y un solo `tasks/todo.md`. Dos agentes trabajando ahí se
llevan el *stage* del otro y se borran las líneas mutuamente. Cada agente trabaja en su worktree:

```
bun run scripts/agente.ts abrir T60            # worktree, rama tarea/T60 y reclamo
bun run scripts/agente.ts estado               # quién tiene qué
bun run scripts/agente.ts cerrar T60           # rebasa sobre main, integra y limpia
bun run scripts/agente.ts abandonar T60 --si   # destructivo: tira la rama sin integrarla
```

- El worktree vive fuera del repo, en `../nn-anime-T60`, con su `node_modules`, su base de datos
  (`NN_ANIME_DATA_DIR=<worktree>/.data/`) y su puerto (`--port`, 9000 más el número del task). Sin
  eso, dos agentes comparten el SQLite y aparece un `SQLITE_BUSY` que no es un fallo del código.
- El reclamo es un ref: `update-ref` lo crea sólo si no existe, así que el segundo agente recibe
  error en vez de empezar un task ajeno. Lo libera `cerrar`, no el agente por su cuenta.
- **Un solo escritor por archivo compartido.** `tasks/todo.md` y `tasks/plan.md` los toca el
  integrador. El agente deja `tasks/done/T60.md` —el formato está en `tasks/done/README.md`— y el
  integrador lo pega.
- **Un solo editor por spec.** Mientras un task toca un `docs/specs/SPEC-*.md`, ese spec queda
  congelado. Las demás propuestas van a `docs/specs/proposals/` y las integra su dueño.
- Partición por paquete, no por task: dos agentes sobre `packages/server/src/routes/` chocan
  aunque estén aislados, y el merge lo revela tarde.
- En un worktree el índice es propio, así que commitear con `-- <rutas>` deja de ser una defensa y
  sigue siendo la regla: el árbol de integración sí es compartido.

## Fuentes de verdad

| Qué | Dónde | Cuándo se toca |
|---|---|---|
| Decisiones y DoD | `tasks/plan.md` | Al abrir una fase o cambiar el listón |
| Tareas en curso | `tasks/todo.md`, `tasks/discovery.md` | Al cerrar un task (marcar y anotar la verificación) |
| Cierre desde un worktree | `tasks/done/T<id>.md` | Al terminar el task; lo integra el integrador |
| Propuesta de contrato | `docs/specs/proposals/SPEC-<módulo>.<task>.md` | Al proponer un cambio de spec sin ser su dueño |
| Contrato de cada módulo | `docs/specs/SPEC-*.md` | Al cambiar una interfaz pública: es evento de versión mayor y requiere aprobación |
| Comandos y arranque | `README.md` | Al añadir o renombrar un script de `package.json` |
| Riesgo residual | `SECURITY.md` | Al añadir una superficie que no se mitiga |

`README.md` y los scripts de `package.json` son un **caché** de la configuración: si divergen, el
comando manda. Las pruebas de `packages/web/src/docs.test.ts` fallan cuando citan algo que no
existe.

## Verificación

Cada criterio de aceptación se marca **con la medición que lo sostiene**, no con un «hecho».

- Una prueba nueva se mide **mutando la implementación**: se rompe el comportamiento a propósito y
  la prueba tiene que fallar. Un test que pasa con el código roto no mide nada, y en este
  repositorio ya ha pasado cinco veces (el registro está en `docs/v1-report.md`).
- Sin `any` implícito, sin `@ts-ignore`, sin `as` para silenciar, sin tests saltados.
- Los textos de interfaz van en `packages/web/src/i18n/es.ts`; los de `recsys`, en su propio i18n.
  Nada de cadenas sueltas en los componentes.
- Los comentarios explican **por qué**, no qué. En español, como el resto del repositorio.
