#!/usr/bin/env bun

/**
 * El ejecutable, probado de verdad.
 *
 * Un `bun build --compile` puede salir verde y producir un programa que arranca
 * sin interfaz y sin migraciones: es exactamente lo que pasaba antes de
 * `resources.ts`, y ni el typecheck ni las pruebas unitarias lo veían, porque
 * las dos corren sobre el árbol de fuentes. Lo único que lo ve es arrancar el
 * ejecutable y preguntarle.
 *
 * Por eso esto no importa nada de la aplicación: lanza el binario, lee la
 * dirección que anuncia, y comprueba con peticiones HTTP lo que un usuario
 * notaría —que la interfaz está, que sus recursos están, que la sesión se puede
 * canjear y que la base tiene esquema—. Vale para las tres plataformas sin
 * ramas, y por eso es lo que la matriz de CI ejecuta en cada una.
 *
 * La salida del hijo va a un archivo y no por una tubería: una tubería se
 * bloquea cuando el buffer se llena si nadie la vacía mientras el hijo vive, y
 * además el sandbox de este repositorio no la permite. Un archivo no tiene
 * ninguno de los dos problemas.
 *
 * Uso: `bun run scripts/package/smoke.ts <ruta-al-ejecutable> [--version X.Y.Z]`
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { parseBootLine } from '@nn-anime/core'
import { BOOT_PARAM } from '@nn-anime/server'
import { isRecord, ROOT } from '../workspaces'

/** Los recursos del build, tal como los nombra el HTML. */
const ASSET_REF = /(?:src|href)="(\/assets\/[^"]+)"/g

export interface SmokeCheck {
  readonly name: string
  readonly ok: boolean
  readonly detail: string
}

export interface SmokeOptions {
  readonly binary: string
  /** Versión que el binario debe decir. Sin ella, no se comprueba. */
  readonly expectedVersion?: string
  /** Cuánto se espera a que anuncie su dirección. */
  readonly timeoutMs?: number
}

function motivo(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Un fallo de comprobación.
 *
 * Se declara como `asserts condition` y no como una función que devuelve `void`
 * porque así TypeScript sabe que lo de después sólo se ejecuta si se cumplió: sin
 * eso, cada comprobación necesitaría su propio `if` para estrechar el tipo y la
 * comprobación dejaría de leerse como una frase.
 */
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function check(name: string, run: () => Promise<string>): Promise<SmokeCheck> {
  try {
    return { name, ok: true, detail: await run() }
  } catch (error) {
    return { name, ok: false, detail: motivo(error) }
  }
}

interface Booted {
  readonly port: number
  readonly token: string
}

/** Espera a que el ejecutable anuncie su dirección, leyendo su salida. */
async function waitForBoot(log: string, timeoutMs: number): Promise<Booted> {
  const limite = Date.now() + timeoutMs

  while (Date.now() < limite) {
    const texto = await Bun.file(log)
      .text()
      .catch(() => '')
    const boot = parseBootLine(texto)

    // La línea legible por máquina y no la humana: la humana se traduce, y este
    // smoke se rompería el día que exista el catálogo del idioma que falta. El
    // formato vive en `@nn-anime/core`, con su análisis y sus pruebas.
    if (boot !== undefined) {
      const token = new URL(boot.url).searchParams.get(BOOT_PARAM)

      if (token !== null && token !== '') return { port: boot.port, token }
    }

    await Bun.sleep(150)
  }

  const salida = await Bun.file(log)
    .text()
    .catch(() => '')

  throw new Error(`no anunció su dirección en ${timeoutMs} ms. Salida:\n${salida.trim()}`)
}

/**
 * Canjea el token y devuelve la cookie de sesión.
 *
 * Se canjea **una sola vez**: el token es de un solo uso y el segundo intento
 * contesta 401. Devolver la cookie para reutilizarla no es una comodidad, es la
 * única forma de que las demás comprobaciones tengan sesión.
 */
async function redeem(origin: string, token: string): Promise<string> {
  const respuesta = await fetch(`${origin}/?boot=${token}`, { redirect: 'manual' })
  assert(respuesta.status === 302, `el canje del token contestó ${respuesta.status}, no 302`)

  const cookies = respuesta.headers.getSetCookie()
  assert(cookies.length > 0, 'el canje no puso ninguna cookie')

  return cookies.map((cookie) => cookie.split(';')[0] ?? '').join('; ')
}

async function get(url: string, cookie?: string): Promise<Response> {
  return await fetch(url, {
    headers: cookie === undefined ? {} : { cookie },
    redirect: 'manual',
  })
}

export async function smoke(options: SmokeOptions): Promise<readonly SmokeCheck[]> {
  const timeout = options.timeoutMs ?? 30_000
  const dir = await mkdtemp(join(ROOT, '.tmp', 'package-smoke-'))
  const log = join(dir, 'salida.log')
  const errores = join(dir, 'error.log')

  // Un puerto al azar y no uno fijo: si estuviera ocupado el CLI cae a uno libre
  // y la dirección que anuncia es la de verdad, que es la que se lee. Un puerto
  // fijo sólo añadiría una forma de fallar que no es del ejecutable.
  const puertoPedido = 20_000 + Math.floor(Math.random() * 40_000)

  const proceso = Bun.spawn(
    [
      options.binary,
      '--no-open',
      '--port',
      String(puertoPedido),
      '--data-dir',
      join(dir, 'data'),
      '--config-dir',
      join(dir, 'config'),
    ],
    {
      env: { ...process.env, NN_ANIME_CACHE_DIR: join(dir, 'cache') },
      stdin: 'ignore',
      stdout: Bun.file(log),
      stderr: Bun.file(errores),
    },
  )

  const checks: SmokeCheck[] = []

  try {
    const { port, token } = await waitForBoot(log, timeout)
    const origin = `http://127.0.0.1:${port}`

    checks.push(
      await check('la interfaz se sirve en la raíz', async () => {
        const respuesta = await get(`${origin}/`)
        assert(respuesta.status === 200, `contestó ${respuesta.status}`)

        const tipo = respuesta.headers.get('content-type') ?? ''
        assert(tipo.startsWith('text/html'), `contestó con tipo ${tipo}`)

        const cuerpo = await respuesta.text()
        assert(
          cuerpo.includes('id="root"'),
          'el HTML no es el de la interfaz: falta el punto de montaje',
        )

        return `${cuerpo.length} bytes de HTML`
      }),
    )

    // Los recursos con hash son los que demuestran que el **árbol** viaja dentro
    // del ejecutable. Comprobar sólo el `index.html` dejaría pasar un binario con
    // la portada y sin la aplicación.
    checks.push(
      await check('los recursos del build se sirven', async () => {
        const html = await (await get(`${origin}/`)).text()
        const referencias = [...new Set([...html.matchAll(ASSET_REF)].map((m) => m[1] ?? ''))]
        assert(referencias.length > 0, 'el HTML no referencia ningún recurso')

        for (const referencia of referencias) {
          const respuesta = await get(`${origin}${referencia}`)
          assert(respuesta.status === 200, `${referencia} contestó ${respuesta.status}`)
        }

        return referencias.join(', ')
      }),
    )

    // El aviso de seguridad lo emite el build de Vite leyéndolo de la raíz del
    // repositorio: comprueba el otro extremo de la cadena de empaquetado.
    checks.push(
      await check('el aviso de seguridad viaja con la interfaz', async () => {
        const respuesta = await get(`${origin}/SECURITY.md`)
        assert(respuesta.status === 200, `contestó ${respuesta.status}`)

        const texto = await respuesta.text()
        assert(texto.includes('sin sandbox'), 'el documento no es el aviso de seguridad')

        return `${texto.length} bytes`
      }),
    )

    let cookie: string | undefined

    try {
      cookie = await redeem(origin, token)
      checks.push({
        name: 'el token de arranque se canjea por sesión',
        ok: true,
        detail: cookie.split('=')[0] ?? 'cookie',
      })
    } catch (error) {
      checks.push({
        name: 'el token de arranque se canjea por sesión',
        ok: false,
        detail: motivo(error),
      })
    }

    if (cookie === undefined) return checks

    checks.push(
      await check('la versión que dice es la que se publicó', async () => {
        const respuesta = await get(`${origin}/api/health`, cookie)
        assert(respuesta.status === 200, `contestó ${respuesta.status}`)

        const cuerpo: unknown = await respuesta.json()
        assert(isRecord(cuerpo), 'la respuesta de salud no es un objeto')

        const version = cuerpo.version
        assert(typeof version === 'string', 'la respuesta de salud no trae versión')

        if (options.expectedVersion !== undefined) {
          assert(
            version === options.expectedVersion,
            `dice ${version} y se esperaba ${options.expectedVersion}`,
          )
        }

        return `versión ${version}`
      }),
    )

    // La consulta más barata que toca una tabla. Si el ejecutable no encontró
    // los `.sql`, el esquema está vacío y esto contesta 500: es el fallo que
    // `resources.ts` arregla, medido desde fuera. La primera petición va **sin**
    // cookie a propósito, para que la guarda de sesión también quede medida.
    checks.push(
      await check('la base tiene esquema', async () => {
        const sinSesion = await get(`${origin}/api/favorites`)
        assert(sinSesion.status === 401, `sin sesión contestó ${sinSesion.status}, no 401`)

        const conSesion = await get(`${origin}/api/favorites`, cookie)
        assert(
          conSesion.status === 200,
          `con sesión contestó ${conSesion.status}: falta una tabla o la consulta falló`,
        )

        return 'favorites responde 200'
      }),
    )
  } finally {
    proceso.kill()
    await Promise.race([proceso.exited, Bun.sleep(5_000)])
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }

  return checks
}

function report(checks: readonly SmokeCheck[]): number {
  let fallos = 0

  for (const item of checks) {
    process.stdout.write(`${item.ok ? 'ok   ' : 'FALLO'} ${item.name}: ${item.detail}\n`)
    if (!item.ok) fallos++
  }

  process.stdout.write(
    fallos === 0
      ? `\n${checks.length} comprobaciones del ejecutable, todas en verde\n`
      : `\n${fallos} de ${checks.length} comprobaciones del ejecutable fallaron\n`,
  )

  return fallos === 0 ? 0 : 1
}

if (import.meta.main) {
  const [binary, ...resto] = Bun.argv.slice(2)
  const posicion = resto.indexOf('--version')

  if (binary === undefined) {
    process.stderr.write('uso: smoke.ts <ruta-al-ejecutable> [--version X.Y.Z]\n')
    process.exitCode = 2
  } else {
    process.exitCode = await smoke({
      binary,
      ...(posicion === -1 ? {} : { expectedVersion: resto[posicion + 1] }),
    })
      .then(report)
      .catch((error: unknown) => {
        process.stderr.write(`${motivo(error)}\n`)

        return 1
      })
  }
}
