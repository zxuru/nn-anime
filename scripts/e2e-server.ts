/**
 * El servidor del e2e.
 *
 * Levanta la aplicación con el plugin de fixture, una base temporal y sin abrir
 * navegador. Tres reglas que el spec pide para el e2e y que se ven aquí:
 *
 * 1. **Ninguna red externa.** El plugin es el del repositorio, con datos
 *    inventados y direcciones `fixture.invalid` que no resuelven.
 * 2. **Nada de `$XDG_*` real.** Todo vive en un directorio temporal que se borra
 *    al salir; si esto escribiera en el directorio del usuario, ejecutar el e2e
 *    cambiaría la aplicación de verdad.
 * 3. **El plugin se copia como archivo**, no se importa desde el paquete: el
 *    cargador lee archivos de un directorio, y saltarse ese paso sería probar un
 *    camino que no existe.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Los datos van a un temporal, pero **el plugin vive dentro del repositorio**:
// desde `/tmp` no se resuelve `@nn-anime/providers-fixture`, y un plugin que no
// se puede importar no prueba nada. Sigue sin tocarse el `$XDG_*` del usuario.
const dir = await mkdtemp(join(tmpdir(), 'nn-anime-e2e-'))
const config = join(import.meta.dir, '..', '.tmp', 'e2e-config')
const providers = join(config, 'nn-anime', 'providers')
await mkdir(providers, { recursive: true })

/** El plugin: el fixture del repositorio, con su modo de fallo por variable. */
const plugin = `import { createFixtureProvider } from '@nn-anime/providers-fixture'

const fallo = process.env.NN_ANIME_E2E_FALLO
const proveedor = createFixtureProvider(
  fallo === undefined || fallo === '' ? {} : { failures: { [fallo]: 'http500' } },
)

export default proveedor
`
await writeFile(join(providers, 'fixture.ts'), plugin)

/**
 * El paquete de la interfaz, al día.
 *
 * El servidor sirve `packages/web/dist`, y si está viejo el e2e prueba una
 * versión anterior de la aplicación: me pasó —las filas de la home no aparecían
 * porque el paquete era de antes de escribirlas— y el fallo parecía de la
 * aplicación. Se comprueba la fecha y se construye si hace falta.
 */
const raiz = join(import.meta.dir, '..')
const dist = join(raiz, 'packages', 'web', 'dist', 'index.html')

async function paqueteAlDia(): Promise<boolean> {
  const indice = Bun.file(dist)
  if (!(await indice.exists())) return false

  const construido = indice.lastModified
  const glob = new Bun.Glob('**/*.{ts,tsx,css}')

  for await (const relativo of glob.scan({ cwd: join(raiz, 'packages', 'web', 'src') })) {
    const archivo = Bun.file(join(raiz, 'packages', 'web', 'src', relativo))
    if (archivo.lastModified > construido) return false
  }

  return true
}

if (!(await paqueteAlDia())) {
  console.log('el paquete de la interfaz está viejo: se construye antes de probar')
  const construccion = Bun.spawn(['bun', 'run', join(raiz, 'scripts', 'build.ts')], {
    stdout: 'inherit',
    stderr: 'inherit',
  })
  await construccion.exited
}

const puerto = process.env.NN_ANIME_E2E_PORT ?? '7801'

const servidor = Bun.spawn(
  [
    'bun',
    'run',
    join(import.meta.dir, '..', 'packages', 'cli', 'src', 'index.ts'),
    '--no-open',
    '--port',
    puerto,
  ],
  {
    env: {
      ...process.env,
      XDG_CONFIG_HOME: config,
      XDG_DATA_HOME: join(dir, 'data'),
      XDG_CACHE_HOME: join(dir, 'cache'),
    },
    stdout: 'pipe',
    stderr: 'inherit',
  },
)

/**
 * El token de arranque, publicado para las pruebas.
 *
 * Playwright no le da a las pruebas la salida del servidor, así que el token
 * viaja por un archivo dentro de `.tmp/`. Sin él, todas las peticiones del e2e
 * serían 401 y las pruebas fallarían por el motivo equivocado.
 */
const rutaToken = join(import.meta.dir, '..', '.tmp', 'e2e-boot-token')
await writeFile(rutaToken, '')

void (async () => {
  const lector = servidor.stdout.getReader()
  const decodificador = new TextDecoder()
  let texto = ''
  let publicado = false

  while (true) {
    const { done, value } = await lector.read()
    if (done) break

    const trozo = decodificador.decode(value)
    texto += trozo
    process.stdout.write(trozo)

    if (!publicado) {
      const coincidencia = /boot=([A-Za-z0-9_-]+)/.exec(texto)
      if (coincidencia?.[1] !== undefined) {
        await writeFile(rutaToken, coincidencia[1])
        publicado = true
      }
    }
  }
})()

const cerrar = async (): Promise<void> => {
  servidor.kill()
  await rm(rutaToken, { force: true }).catch(() => {})
  await rm(dir, { recursive: true, force: true }).catch(() => {})
  process.exit(0)
}

process.on('SIGTERM', () => void cerrar())
process.on('SIGINT', () => void cerrar())

await servidor.exited
await rm(dir, { recursive: true, force: true }).catch(() => {})
