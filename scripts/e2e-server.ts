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
/**
 * Un archivo de audio local, para que el reproductor tenga qué reproducir.
 *
 * Es un WAV generado aquí y no un mp4 del repositorio: no hay codificador de
 * vídeo disponible sin red, y un mp4 inventado no se decodifica. Lo que se prueba
 * con esto es el **mecanismo** del reproductor —que la fuente llega, que el tiempo
 * avanza, que el salto funciona—, no el códec, que es del navegador. Se dice en el
 * informe para que nadie crea que se probó un mp4.
 */
function wavDeDiezSegundos(): Uint8Array {
  // Diez segundos y no uno: con un segundo, el archivo termina antes de que la
  // prueba pueda leer el tiempo y el salto no se puede medir. Lo encontró la
  // propia prueba del reproductor.
  const muestras = 80_000
  const datos = new Uint8Array(muestras * 2)

  for (let indice = 0; indice < muestras; indice++) {
    const valor = Math.round(Math.sin((indice / 8000) * 2 * Math.PI * 440) * 8000)
    datos[indice * 2] = valor & 0xff
    datos[indice * 2 + 1] = (valor >> 8) & 0xff
  }

  const cabecera = new Uint8Array(44)
  const vista = new DataView(cabecera.buffer)
  const escribir = (posicion: number, texto: string): void => {
    for (const [desplazamiento, caracter] of [...texto].entries()) {
      cabecera[posicion + desplazamiento] = caracter.charCodeAt(0)
    }
  }

  escribir(0, 'RIFF')
  vista.setUint32(4, 36 + datos.byteLength, true)
  escribir(8, 'WAVEfmt ')
  vista.setUint32(16, 16, true)
  vista.setUint16(20, 1, true)
  vista.setUint16(22, 1, true)
  vista.setUint32(24, 8000, true)
  vista.setUint32(28, 16000, true)
  vista.setUint16(32, 2, true)
  vista.setUint16(34, 16, true)
  escribir(36, 'data')
  vista.setUint32(40, datos.byteLength, true)

  const salida = new Uint8Array(cabecera.byteLength + datos.byteLength)
  salida.set(cabecera)
  salida.set(datos, cabecera.byteLength)

  return salida
}

const puertoMedios = Number(process.env.NN_ANIME_E2E_MEDIA_PORT ?? '7902')
const medios = Bun.serve({
  port: puertoMedios,
  fetch(request) {
    const url = new URL(request.url)

    if (url.pathname === '/tono.wav') {
      // `Uint8Array` como cuerpo necesita su buffer explícito: el tipo de
      // `BodyInit` no lo admite tal cual.
      return new Response(wavDeDiezSegundos().buffer as ArrayBuffer, {
        headers: { 'content-type': 'audio/wav', 'accept-ranges': 'bytes' },
      })
    }

    return new Response('no está', { status: 404 })
  },
})

const plugin = `import { createFixtureProvider } from '@nn-anime/providers-fixture'

const fallo = process.env.NN_ANIME_E2E_FALLO
const base = createFixtureProvider(
  fallo === undefined || fallo === '' ? {} : { failures: { [fallo]: 'http500' } },
)

// El stream apunta al archivo local del arnés: es lo que permite probar el
// reproductor sin red. El proxy lo acepta porque el e2e abre la excepción de
// loopback.
const medios = process.env.NN_ANIME_E2E_MEDIA

const proveedor =
  medios === undefined || medios === ''
    ? base
    : {
        ...base,
        async resolveStream() {
          return [{ url: medios, kind: 'file' }]
        },
      }

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
      // La excepción de loopback: sin ella el proxy rechaza el archivo local, que
      // es exactamente lo que hace en producción.
      NN_ANIME_ALLOW_LOOPBACK: '1',
      NN_ANIME_E2E_MEDIA: `http://127.0.0.1:${puertoMedios}/tono.wav`,
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
  medios.stop(true)
  await rm(rutaToken, { force: true }).catch(() => {})
  await rm(dir, { recursive: true, force: true }).catch(() => {})
  process.exit(0)
}

process.on('SIGTERM', () => void cerrar())
process.on('SIGINT', () => void cerrar())

await servidor.exited
await rm(dir, { recursive: true, force: true }).catch(() => {})
