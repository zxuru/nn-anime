/**
 * Persistencia entre versiones, con dos servidores de verdad.
 *
 * Este e2e no simula la actualización dentro del mismo proceso: arranca la
 * aplicación con un directorio de migraciones que llega hasta la versión actual,
 * reproduce un episodio hasta un segundo concreto, **mata el servidor**, añade
 * una migración nueva al directorio de migraciones, vuelve a arrancar con el
 * mismo `dataDir` y comprueba que el contenido y el segundo siguen ahí.
 *
 * Que el mecanismo sea real es el punto: el directorio de migraciones se inyecta
 * con `NN_ANIME_MIGRATIONS_DIR` —la variable que ya usa el binario compilado—,
 * el segundo servidor aplica la migración 16 de prueba y el `dataDir` es el
 * mismo. No hay ninguna tabla ni fila creada a mano: lo que se mira lo escribió
 * el reproductor por la API.
 *
 * Los dos servidores propios —y no el `webServer` de Playwright— porque simular
 * una actualización exige reiniciar el proceso con otro esquema, y el arnés
 * compartido lo levanta una sola vez para todo el e2e.
 */

import { type ChildProcessWithoutNullStreams, spawn, spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, type Page, test } from '@playwright/test'

const RAIZ = fileURLToPath(new URL('../../../', import.meta.url))
const MIGRACIONES = join(RAIZ, 'packages', 'catalog-store', 'src', 'migrations')
const PUERTO_V1 = 7811
const PUERTO_V2 = 7812

/** El servicio de medios del arnés: un WAV de un minuto que ya levanta el e2e. */
const PUERTO_MEDIOS = Number(process.env.NN_ANIME_E2E_MEDIA_PORT ?? '7902')
const MEDIA = `http://127.0.0.1:${PUERTO_MEDIOS}/tono.wav`

interface Servidor {
  readonly base: string
  readonly bootUrl: string
  readonly proceso: ChildProcessWithoutNullStreams
  detener(): Promise<void>
}

/** Espera la línea `NN_ANIME_BOOT` y la convierte en una URL con token. */
function esperarArranque(
  proceso: ChildProcessWithoutNullStreams,
  base: string,
): Promise<{ bootUrl: string; salida: string }> {
  return new Promise((resolver, rechazar) => {
    let salida = ''
    const plazo = setTimeout(() => {
      rechazar(new Error(`el servidor ${base} no anunció su arranque:\n${salida}`))
    }, 60_000)

    const alLeer = (trozo: Buffer): void => {
      salida += trozo.toString('utf8')
      const token = /boot=([A-Za-z0-9_-]+)/.exec(salida)?.[1]

      if (token === undefined) return

      clearTimeout(plazo)
      proceso.stdout.off('data', alLeer)
      resolver({ bootUrl: `${base}/?boot=${token}`, salida })
    }

    proceso.stdout.on('data', alLeer)
    proceso.stderr.on('data', (trozo: Buffer) => {
      salida += trozo.toString('utf8')
    })
    proceso.once('exit', (codigo) => {
      clearTimeout(plazo)
      rechazar(new Error(`el servidor ${base} terminó con ${String(codigo)}:\n${salida}`))
    })
  })
}

async function arrancarServidor(options: {
  readonly puerto: number
  readonly dataDir: string
  readonly configDir: string
  readonly cacheDir: string
  readonly migracionesDir: string
}): Promise<Servidor> {
  const base = `http://127.0.0.1:${String(options.puerto)}`
  const proceso = spawn(
    'bun',
    [
      'run',
      join(RAIZ, 'packages', 'cli', 'src', 'index.ts'),
      '--no-open',
      '--port',
      String(options.puerto),
    ],
    {
      cwd: RAIZ,
      env: {
        ...process.env,
        NN_ANIME_DATA_DIR: options.dataDir,
        NN_ANIME_CONFIG_DIR: options.configDir,
        NN_ANIME_CACHE_DIR: options.cacheDir,
        NN_ANIME_MIGRATIONS_DIR: options.migracionesDir,
        // El proxy sólo sirve el archivo local del arnés con esta excepción.
        NN_ANIME_ALLOW_LOOPBACK: '1',
        // Sin salida a AniList: la home la pide y una prueba que depende de
        // internet se rompe sola.
        NN_ANIME_ANILIST_OFFLINE: '1',
        // La fuente que devuelve el plugin del arnés.
        NN_ANIME_E2E_MEDIA: MEDIA,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )

  const { bootUrl } = await esperarArranque(proceso, base)

  return {
    base,
    bootUrl,
    proceso,
    async detener() {
      if (proceso.exitCode !== null) return

      // Cierre ordenado: la misma línea que usa el anfitrión de escritorio. Cierra
      // SQLite y deja el WAL en su sitio, que es lo que luego se restaura.
      proceso.stdin.write('shutdown\n')

      await new Promise<void>((resolver) => {
        const plazo = setTimeout(() => {
          proceso.kill()
          resolver()
        }, 10_000)

        proceso.once('exit', () => {
          clearTimeout(plazo)
          resolver()
        })
      })
    },
  }
}

/** Entra por el token de arranque y espera a que la aplicación esté montada. */
async function entrarEn(page: Page, bootUrl: string): Promise<void> {
  await page.goto(bootUrl)
  await expect(page.locator('.shell__brand')).toBeVisible({ timeout: 20_000 })
}

/**
 * Prepara el plugin del proveedor de fixture.
 *
 * El archivo **tiene que vivir dentro del repositorio**: carga con un `import`
 * normal de `@nn-anime/providers-fixture`, y desde un temporal no resolvería el
 * paquete. Por eso el directorio de configuración va en `.tmp/` y no en `%TEMP%`.
 */
async function prepararPlugin(configDir: string): Promise<void> {
  const destino = join(configDir, 'nn-anime', 'providers')
  await mkdir(destino, { recursive: true })
  await writeFile(
    join(destino, 'fixture.ts'),
    `import { createFixtureProvider } from '@nn-anime/providers-fixture'

const base = createFixtureProvider()
const medios = process.env.NN_ANIME_E2E_MEDIA

export default {
  ...base,
  async resolveStream() {
    return [{ url: medios, kind: 'file' }]
  },
}
`,
  )
}

/** Copia las migraciones reales a un directorio que se puede ampliar sin tocar el repositorio. */
async function copiarMigraciones(destino: string): Promise<void> {
  await mkdir(destino, { recursive: true })
  await cp(MIGRACIONES, destino, { recursive: true })
}

test.describe('persistencia entre versiones', () => {
  test('el contenido y el segundo sobreviven a una actualización de esquema', async ({ page }) => {
    test.setTimeout(180_000)

    const temporal = await mkdtemp(join(tmpdir(), 'nn-anime-e2e-persistencia-'))
    const dataDir = join(temporal, 'data')
    const configDir = join(RAIZ, '.tmp', 'persistencia-e2e')
    const cacheDir = join(temporal, 'cache')
    const migracionesV1 = join(temporal, 'migraciones-v1')
    const migracionesV2 = join(temporal, 'migraciones-v2')

    await rm(configDir, { recursive: true, force: true })
    await prepararPlugin(configDir)
    await copiarMigraciones(migracionesV1)
    await copiarMigraciones(migracionesV2)

    let v1: Servidor | undefined
    let v2: Servidor | undefined

    try {
      // 1. Primera versión, la instalada.
      v1 = await arrancarServidor({
        puerto: PUERTO_V1,
        dataDir,
        configDir,
        cacheDir,
        migracionesDir: migracionesV1,
      })

      await entrarEn(page, v1.bootUrl)
      await page.goto(
        `${v1.base}/watch/fixture/aurora-nocturna%233?anime=aurora-nocturna&n=3&mode=sub`,
      )

      const video = page.locator('video')
      await expect(video).toBeVisible({ timeout: 20_000 })
      await expect(page.locator('.player__seek .player__range')).toBeEnabled({ timeout: 20_000 })

      // 2. «Ve contenido hasta cierto segundo»: salta al 20 y reproduce un poco.
      //    El salto emite `seeked` y el gancho del visionado guarda la posición;
      //    el segundo de en medio lo mueve el propio reloj.
      await page.getByRole('button', { name: 'Silenciar' }).click()
      await page.getByRole('button', { name: 'Reproducir' }).click()
      await page.getByRole('slider', { name: 'Posición del video' }).fill('20')
      await page.waitForTimeout(1500)
      await page.getByRole('button', { name: 'Pausar' }).click()

      interface Item {
        title: string
        positionS: number
        durationS: number
        episodeRef: { providerId: string; value: string }
        animeRef: { providerId: string; value: string }
      }

      const recientes = async (servidor: Servidor): Promise<readonly Item[]> => {
        const respuesta = await page.request.get(`${servidor.base}/api/watch/recent`)

        expect(respuesta.status()).toBe(200)

        return ((await respuesta.json()) as { items: readonly Item[] }).items
      }

      // Que el PATCH llegue es una petición de red: se pregunta hasta que esté,
      // como haría una lectura de verdad.
      await expect
        .poll(async () => (await recientes(v1 as Servidor))[0]?.positionS ?? 0, {
          timeout: 15_000,
        })
        .toBeGreaterThanOrEqual(20)

      const antes = (await recientes(v1))[0]
      expect(antes).toBeDefined()
      if (antes === undefined) return
      expect(antes.title).toBe('Aurora Nocturna')
      expect(antes.durationS).toBeGreaterThan(0)

      // 3. «Actualización»: se apaga la aplicación, se le añade una migración de
      //    prueba (una columna nueva, aditiva) y se vuelve a arrancar con el
      //    mismo `dataDir`.
      await v1.detener()
      v1 = undefined

      await writeFile(
        join(migracionesV2, '0016-prueba-actualizacion.sql'),
        'ALTER TABLE setting ADD COLUMN origen_actualizacion TEXT;\n',
      )

      v2 = await arrancarServidor({
        puerto: PUERTO_V2,
        dataDir,
        configDir,
        cacheDir,
        migracionesDir: migracionesV2,
      })

      // 4. La copia previa existe y la base está en la versión nueva: la
      //    migración se aplicó de verdad y no se perdió nada.
      const copias = await readdirDe(join(dataDir, 'backups'))
      expect(copias.length).toBeGreaterThan(0)

      // La versión del esquema se lee con un proceso de Bun aparte y no con un
      // `import` aquí: Playwright carga los archivos de prueba con el cargador
      // de Node, y el módulo de SQLite de Bun no existe fuera de Bun. El script
      // vive en `scripts/`, fuera de los paquetes, para que la prueba de
      // propiedad del almacén siga viendo un solo dueño de SQLite.
      const version = spawnSync(
        'bun',
        ['run', join(RAIZ, 'scripts', 'leer-version-esquema.ts'), join(dataDir, 'nn-anime.db')],
        { cwd: RAIZ, encoding: 'utf8' },
      )
      expect(version.status).toBe(0)
      expect(version.stdout.trim()).toBe('16')

      await entrarEn(page, v2.bootUrl)

      // 5. Lo mismo que antes, con el mismo segundo: el contenido no cambió.
      const despues = (await recientes(v2))[0]
      expect(despues).toBeDefined()
      if (despues === undefined) return
      expect(despues.title).toBe(antes.title)
      expect(despues.episodeRef).toEqual(antes.episodeRef)
      expect(despues.animeRef).toEqual(antes.animeRef)
      expect(despues.positionS).toBe(antes.positionS)

      // 6. Y la interfaz retoma por donde se dejó. La tarjeta lleva el segundo en
      //    el enlace y el video arranca ahí; el progreso local del navegador no
      //    ayuda aquí porque el segundo servidor vive en otro origen (otro
      //    puerto), así que lo que se mide es el dato del servidor.
      await page.goto(`${v2.base}/`)
      const fila = page.locator('.seccion').filter({ hasText: 'Continuar viendo' })
      await expect(fila.locator('.pz__titulo').first()).toHaveText('Aurora Nocturna', {
        timeout: 20_000,
      })

      await fila.locator('.pz__enlace').first().click()
      await expect(page).toHaveURL(new RegExp(`at=${String(antes.positionS)}`))

      const reanudado = page.locator('video')
      await expect(reanudado).toHaveAttribute('src', /\/stream\//, { timeout: 20_000 })

      await expect
        .poll(
          async () =>
            await reanudado.evaluate((elemento: HTMLVideoElement) => elemento.currentTime),
          { timeout: 20_000 },
        )
        .toBeGreaterThanOrEqual(antes.positionS - 1)
    } finally {
      await v2?.detener()
      await v1?.detener()
      await rm(configDir, { recursive: true, force: true }).catch(() => {})
      await rm(temporal, { recursive: true, force: true }).catch(() => {})
    }
  })
})

/** Lee un directorio que puede no existir, sin romper el test por eso. */
async function readdirDe(dir: string): Promise<readonly string[]> {
  try {
    return await readdir(dir)
  } catch {
    return []
  }
}
