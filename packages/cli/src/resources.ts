/**
 * Dónde viven los recursos que la aplicación necesita en marcha: el build de la
 * interfaz y los archivos `.sql` de las migraciones.
 *
 * En el repositorio los dos están en el árbol de fuentes y bastaba con contarlos
 * desde `import.meta.url`. Un ejecutable de `bun build --compile` rompe esa
 * cuenta, y de las dos formas posibles:
 *
 * 1. `import.meta.url` deja de apuntar al archivo y apunta al sistema de archivos
 *    virtual del binario, así que `../../web/dist/` resolvía a `B:\web\dist` —una
 *    ruta que no existe— y el servidor arrancaba **sin interfaz**.
 * 2. `import.meta.dir` de **cualquier** módulo es la raíz de ese sistema, así que
 *    el runner de migraciones hacía `readdirSync(…)` sobre un directorio sin
 *    `.sql`, no aplicaba ninguna y el arranque seguía como si hubiera migrado. El
 *    síntoma era un `no such table: anime` mucho después, lejos de la causa.
 *
 * El segundo es el peligroso: no falla, miente. Por eso la resolución es
 * explícita y está probada.
 *
 * El orden es el mismo para los dos recursos:
 *
 * 1. La variable de entorno, para pruebas y para un despliegue que mueva los
 *    recursos a mano. Se ignora si la ruta no existe: la comprobación es la
 *    misma que hacía `webBuildRoot`, y devolver una ruta inventada dejaría al
 *    servidor contestando 404 sin decir por qué.
 * 2. El recurso incrustado, que `--asset` deja junto al ejecutable dentro del
 *    binario.
 * 3. El árbol de fuentes, que es el camino de `bun run start` y el de las
 *    pruebas.
 */

import { join } from 'node:path'

/** Mueve el build de la interfaz que sirve el servidor. */
export const WEB_ROOT_ENV = 'NN_ANIME_WEB_DIR'

/** Mueve el directorio de archivos `.sql` de las migraciones. */
export const MIGRATIONS_DIR_ENV = 'NN_ANIME_MIGRATIONS_DIR'

/**
 * Nombres con los que `--asset` incrusta los recursos.
 *
 * `--asset` no sabe renombrar: el recurso queda dentro del ejecutable con el
 * nombre del directorio de origen, y `packages/web/dist` se incrusta como
 * `dist`. Estos dos nombres son la mitad de un contrato con `scripts/package.ts`
 * —la otra mitad está allí— y por eso están aquí y no escritos a mano en cada
 * sitio.
 */
export const EMBEDDED_WEB_DIR = 'dist'
export const EMBEDDED_MIGRATIONS_DIR = 'migrations'

export interface ResourceInputs {
  readonly env: Readonly<Record<string, string | undefined>>
  /**
   * Raíz del sistema de archivos del ejecutable, o `undefined` si esto no corre
   * dentro de uno.
   *
   * Dentro de un binario compilado **todos** los módulos resuelven
   * `import.meta.dir` a esa raíz: el árbol de origen no sobrevive a la
   * compilación. Es también donde `--asset` deja lo que incrusta, así que una
   * sola ruta contesta las dos preguntas.
   */
  readonly embeddedRoot: string | undefined
  /** Directorio de este paquete en el árbol de fuentes (`packages/cli/src`). */
  readonly sourceDir: string
  readonly exists: (path: string) => boolean
}

export interface Resources {
  /** Build de la interfaz, si hay uno. Sin él el server sólo expone la API. */
  readonly webRoot: string | undefined
  /** Archivos de migración, si se encontraron. Sin él manda el valor por defecto. */
  readonly migrationsDir: string | undefined
}

/**
 * El primer candidato que existe, en orden de precedencia.
 *
 * Los tres candidatos se calculan antes de comprobar nada a propósito: así el
 * orden se lee de una vez y no queda repartido entre ramas.
 */
function firstExisting(
  candidates: readonly (string | undefined)[],
  exists: (path: string) => boolean,
): string | undefined {
  for (const candidate of candidates) {
    if (candidate !== undefined && exists(candidate)) return candidate
  }

  return undefined
}

function fromEnv(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string | undefined {
  const value = env[name]

  return value === undefined || value === '' ? undefined : value
}

export function resolveResources(inputs: ResourceInputs): Resources {
  const { embeddedRoot, sourceDir, exists } = inputs

  return {
    webRoot: firstExisting(
      [
        fromEnv(inputs.env, WEB_ROOT_ENV),
        embeddedRoot === undefined ? undefined : join(embeddedRoot, EMBEDDED_WEB_DIR),
        join(sourceDir, '..', '..', 'web', 'dist'),
      ],
      exists,
    ),
    migrationsDir: firstExisting(
      [
        fromEnv(inputs.env, MIGRATIONS_DIR_ENV),
        embeddedRoot === undefined ? undefined : join(embeddedRoot, EMBEDDED_MIGRATIONS_DIR),
        join(sourceDir, '..', '..', 'catalog-store', 'src', 'migrations'),
      ],
      exists,
    ),
  }
}
