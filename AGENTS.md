# AGENTS.md

Reglas de trabajo de este repositorio. Se aplican a cualquier agente que escriba código aquí.

## Cerrar cada cambio con un commit

**Todo cambio se commitea antes de pasar al siguiente.** Ningún paso se da por terminado con
archivos modificados fuera del índice: un árbol sucio al empezar el paso siguiente es trabajo que se
pierde o que se mezcla.

- Un commit por tarea, atómico, con el asunto en imperativo y el id del task: `feat(server): la
  ruta del feed (T50)`.
- El commit incluye **sólo** los archivos de esa tarea. Si el árbol ya venía sucio, se commitea
  primero lo pendiente como su propio commit, y lo dice el mensaje.
- Antes de commitear: `bun run typecheck`, `bun run lint` y `bun test` en verde en los paquetes
  tocados. Si algo está en rojo, se arregla o se declara en el mensaje del commit; no se calla.
- El autor es `nn-anime <nn-anime@localhost>` (configuración local del repositorio).

El detalle del listón, con sus ocho puntos, está en el **Definition of Done** de
`tasks/plan.md`; esta sección es la parte que se olvida cuando nadie la repite.

## Fuentes de verdad

| Qué | Dónde | Cuándo se toca |
|---|---|---|
| Decisiones y DoD | `tasks/plan.md` | Al abrir una fase o cambiar el listón |
| Tareas en curso | `tasks/todo.md`, `tasks/discovery.md` | Al cerrar un task (marcar y anotar la verificación) |
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
