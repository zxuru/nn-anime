---
name: tablero-kanban
description: Mantener al día el tablero Kanban local de nn-anime (tareas/Tablero.md). Úsala al empezar cualquier tarea, al terminarla, al apuntar trabajo nuevo, y siempre que pidan «cómo va todo», el estado del proyecto o revisar tareas pendientes. También si el tablero no abre o el plugin Kanban de Obsidian da error.
---

# Tablero Kanban local

`tareas/` es un vault de Obsidian **local** y **no versionado** (`.gitignore`). Su tablero,
`tareas/Tablero.md`, es el espejo de cómo va el trabajo. La fuente de verdad de las tareas sigue
siendo `tasks/`; aquí no se migra historial ni se copian decisiones, sólo el estado.

Ruta: en el checkout principal, `tareas/Tablero.md`. Desde un worktree (`.worktrees/T60/`), la raíz
está dos niveles arriba: `.worktrees/T60/../../tareas/Tablero.md`. Si el tablero no existe en esta
máquina, dilo y sigue sin inventarlo.

## Protocolo

1. **Al empezar una tarea.** Busca su tarjeta por el asunto, no por el título exacto. Si está en
   *Pendiente*, muévela a *En desarrollo*; si no existe, créala en *En desarrollo*. Título = acción
   concreta, y prioridad `#alta` (bloquea o urge), `#media` (normal) o `#baja` (cuando haya hueco).
   *Criterio: la tarjeta existe una sola vez y está en *En desarrollo*.*
2. **Nota de detalle.** Crea o actualiza `tareas/detalle/<slug>.md` con el frontmatter de abajo y
   enlázala desde la tarjeta con `[[detalle/<slug>]]`. *Criterio: la tarjeta enlaza una nota que
   existe y declara los cuatro campos.*
3. **Al terminar.** Mueve la tarjeta a *Completado*, déjala con `- [x]` y rellena `terminada` en la
   nota. Si queda trabajo abierto, deja en *Pendiente* una tarjeta nueva o anota en la nota qué
   falta. *Criterio: la tarjeta está en *Completado* con `- [x]` y la nota tiene fecha de fin.*
4. **Trabajo nuevo que aparece.** Tarjeta en *Pendiente* en cuanto se sepa; no se acumula para el
   final. *Criterio: está en *Pendiente* con su prioridad.*
5. **Cierre de la sesión.** Relee el tablero. *Criterio: ninguna tarjeta de una tarea cerrada queda
   en *En desarrollo*; si la sesión se corta a medias, la nota de detalle dice en qué punto queda.*

Para informar del estado, lee el tablero y resume por columnas; no completes estados de memoria.

## Formato del tablero

`tareas/Tablero.md` ya está creado: **no cambies** el frontmatter `kanban-plugin` ni el bloque final
`%% kanban:settings %%` salvo que la tarea sea justo eso. Las columnas van siempre en este orden:

```markdown
## Pendiente

## En desarrollo

## Completado

- [x] Título de la tarea [[detalle/mi-tarea]] #media
```

- Tarjetas = items de checklist. Las completadas van en *Completado* con `- [x]`; el resto, `- [ ]`.
- Los wikilinks son **relativos al vault**: `[[detalle/mi-tarea]]`, no `[[tareas/detalle/…]]`.
- No añadas columnas: el fragmento CSS del vault asigna el color por posición (1.ª, 2.ª, 3.ª).

## Nota de detalle

`tareas/detalle/<slug>.md`, con la plantilla viva en `tareas/detalle/_plantilla.md`:

```yaml
---
estado: pendiente | en-desarrollo | completado
prioridad: alta | media | baja
creada: AAAA-MM-DD
terminada:
---
```

## Gotchas

- En `kanban:settings`, la clave de metadatos es **`metadataKey`**, no `key`: con `key` el plugin
  revienta al abrir (`Cannot read properties of undefined (reading 'split')`).
- No commitees nada de `tareas/`: está ignorado y es de cada máquina.
- El plugin abre solo el `.md` como tablero por el frontmatter; si no, menú del panel →
  *Open as kanban board*. El aspecto sale de `tareas/.obsidian/snippets/kanban.css`.
- El tablero se toca en dos momentos breves (inicio y fin). Dos sesiones editándolo a la vez se
  pisan la tarjeta de la otra.
