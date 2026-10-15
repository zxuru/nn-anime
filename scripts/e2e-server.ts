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
function wavDeUnMinuto(): Uint8Array {
  // Un minuto y no diez segundos: el reproductor no reanuda antes del segundo
  // diez —quien abrió el episodio y lo cerró ahí no lo estaba viendo— y con un
  // archivo de diez segundos esa regla no se puede medir de verdad, sólo fingir.
  // El precio es un archivo de un megabyte que se sirve desde casa; el sonido es
  // un tono, así que el coste de tenerlo es el del disco.
  const muestras = 480_000
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

/**
 * El rango que pide el cliente, acotado al archivo.
 *
 * Sólo se admite un rango y en la forma del spec de HTTP; lo que no encaje se
 * sirve entero, que es lo que hace un servidor que no sabe de rangos. El arnés no
 * necesita más: el navegador pide `bytes=0-` y luego un tramo.
 */
function rangoPedido(
  cabecera: string | null,
  total: number,
): { readonly desde: number; readonly hasta: number } | undefined {
  const coincidencia = /^bytes=(\d*)-(\d*)$/.exec(cabecera?.trim() ?? '')
  if (coincidencia === null) return undefined

  const [, crudoDesde = '', crudoHasta = ''] = coincidencia
  if (crudoDesde === '' && crudoHasta === '') return undefined

  if (crudoDesde === '') {
    const sufijo = Number(crudoHasta)
    if (!Number.isInteger(sufijo) || sufijo <= 0) return undefined

    return { desde: Math.max(total - sufijo, 0), hasta: total - 1 }
  }

  const desde = Number(crudoDesde)
  if (!Number.isInteger(desde) || desde >= total) return undefined

  const hasta = crudoHasta === '' ? total - 1 : Math.min(Number(crudoHasta), total - 1)
  if (!Number.isInteger(hasta) || hasta < desde) return undefined

  return { desde, hasta }
}

const puertoMedios = Number(process.env.NN_ANIME_E2E_MEDIA_PORT ?? '7902')
const medios = Bun.serve({
  port: puertoMedios,
  fetch(request) {
    const url = new URL(request.url)

    if (url.pathname === '/tono.wav') {
      const tono = wavDeUnMinuto()
      const rango = rangoPedido(request.headers.get('range'), tono.byteLength)

      // El `Range` se atiende de verdad y no se ignora: el arnés declaraba
      // `accept-ranges: bytes` y devolvía siempre el archivo entero, así que el
      // navegador marcaba el medio como no buscable (`seekable` vacío) y el salto
      // de diez segundos no se podía probar. Un servidor que miente sobre lo que
      // admite hace que la prueba mida otra cosa.
      if (rango === undefined) {
        // `Uint8Array` como cuerpo necesita su buffer explícito: el tipo de
        // `BodyInit` no lo admite tal cual.
        return new Response(tono.buffer as ArrayBuffer, {
          status: 200,
          headers: { 'content-type': 'audio/wav', 'accept-ranges': 'bytes' },
        })
      }

      const trozo = tono.slice(rango.desde, rango.hasta + 1)

      return new Response(trozo.buffer as ArrayBuffer, {
        status: 206,
        headers: {
          'content-type': 'audio/wav',
          'accept-ranges': 'bytes',
          'content-range': `bytes ${rango.desde}-${rango.hasta}/${tono.byteLength}`,
          'content-length': String(trozo.byteLength),
        },
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

  // La configuración de Vite también decide qué lleva el paquete: emite el aviso
  // de seguridad, que `/settings` enlaza. Sin mirarla, un cambio suyo dejaría el
  // e2e probando un build viejo.
  const configuracion = Bun.file(join(raiz, 'packages', 'web', 'vite.config.ts'))
  if (configuracion.lastModified > construido) return false

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
      // Sin salida a AniList: la home siempre pide el descubrimiento y una prueba
      // que sale a internet se rompe sola. Con esto, sus rutas contestan lo mismo
      // que un AniList caído, que es el camino que hay que poder probar.
      NN_ANIME_ANILIST_OFFLINE: '1',
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
