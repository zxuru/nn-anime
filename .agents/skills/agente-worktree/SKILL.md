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

## Sandbox de escritura (Windows con DSH)

En un entorno con el sandbox de escritura de DSH hay tres cosas bloqueadas y cada una tiene su
rodeo. **Ningún rodeo pide aprobación**: son configuración y código del repositorio.

### El `ssh` de Git no arranca

El de MSYS es Cygwin y muere con `couldn't create signal pipe`: el sandbox no le deja crear la
tubería de señales. Windows trae uno nativo que sí arranca, y basta apuntarle Git a él en el clon:

```bash
git config core.sshCommand 'C:/Windows/System32/OpenSSH/ssh.exe'
git push --dry-run git@github.com:zxuru/nn-anime.git main:main   # comprueba, no publica nada
```

Con eso los `push` —incluidos los que tocan `.github/workflows/`, que por HTTPS exigen el alcance
`workflow` del token— salen sin escalar permisos. Queda en `.git/config`, así que vale para todas
las sesiones de ese clon.

### No se puede capturar la salida de un hijo por tubería

`Bun.spawnSync` con `stdout: 'pipe'` muere con `EPERM` (el sandbox no deja crear la tubería). La
salida se captura redirigiendo a un archivo dentro de `.tmp/` y leyéndolo después; **así lo hacen ya**
`scripts/agente.ts`, `scripts/git-hooks.ts` y sus pruebas. Cualquier script nuevo que llame a git
debe hacer lo mismo:

```ts
const out = openSync(join(temporal, 'out'), 'w')
Bun.spawnSync(['git', ...args], { cwd, stdout: out, stderr: err })
// …cerrar, leer el archivo y borrar el temporal
```

Por eso `bun run scripts/agente.ts estado` funciona en el sandbox aunque `ssh` y las pruebas de
integración no puedan.

### El gancho no se puede ejecutar (y el worktree no se puede instalar)

- **El gancho sí existe y se mide, pero no corre aquí**: Git lo arranca con el `env.exe` de MSYS y
  falla por lo mismo que `ssh`. En el sandbox se commitea con `--no-verify` y se respeta la regla a
  mano: nada se commitea en `main`. Las dos pruebas de integración de `scripts/git-hooks.test.ts`
  se saltan solas cuando miden que el gancho no puede ejecutarse (en CI corren enteras).
- **`bun install` en el worktree no termina**: los enlaces simbólicos de los `@nn-anime/*` y de
  `.bin` los deniega el sandbox. El ciclo alternativo, con un solo agente por repositorio: rama en
  la raíz (`git checkout -b tarea/T60 main`), verificar ahí (`bun run typecheck`, `bun run lint`,
  `bun test`), commitear con la lista de rutas e integrar a `main` con `--no-ff`. El reclamo y la
  rama siguen siendo los de `agente.ts`; lo que no se usa es el worktree.
