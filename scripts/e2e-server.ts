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

/**
 * El paquete de la interfaz que se sirve aquí lleva el `hls.js` falso.
 *
 * El Chromium de Playwright no decodifica H.264 ni AAC: un HLS real no se puede
 * ver ahí. El e2e sustituye el transporte por un módulo que imita la API de
 * hls.js y reproduce el WAV del arnés —ver `packages/web/e2e/hls-falso.ts`—, y
 * para eso el alias de Vite tiene que estar puesto **cuando se construye**. Por
 * eso la variable se fija aquí, en el proceso que lanza la construcción, y no en
 * el archivo de la prueba.
 */
const HLS_FALSO = process.env.NN_ANIME_E2E_HLS ?? 'falso'
process.env.NN_ANIME_E2E_HLS = HLS_FALSO

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

// El episodio marcador. Sólo éste se declara HLS: es el que monta el transporte
// falso para probar la recuperación de un fragmento. El resto sigue siendo un
// archivo progresivo para no cambiar el camino que ya prueban los demás e2e.
const EPISODIO_HLS = 'aurora-nocturna#7'

const proveedor =
  medios === undefined || medios === ''
    ? base
    : {
        ...base,
        async resolveStream(request) {
          return [
            {
              url: medios,
              kind: request.episodeRef.value === EPISODIO_HLS ? 'hls' : 'file',
            },
          ]
        },
      }

export default proveedor
`
await writeFile(join(providers, 'fixture.ts'), plugin)

/**
 * El paquete de la interfaz del e2e, en su **propio** directorio.
 *
 * No se usa `packages/web/dist` a propósito: ese paquete es el que sirve la
 * aplicación de verdad (`bun run start`), y el del e2e lleva el alias de hls.js
 * al módulo falso. Mezclarlos dejaría la aplicación real con el transporte de
 * mentira, sin HLS. El servidor sirve este directorio con `NN_ANIME_WEB_DIR`, que
 * tiene prioridad sobre la ruta de siempre —ver `packages/cli/src/resources.ts`—.
 */
const raiz = join(import.meta.dir, '..')
const web = join(raiz, 'packages', 'web')
const dist = join(raiz, '.tmp', 'e2e-dist')
const indice = join(dist, 'index.html')

/**
 * El paquete del e2e, al día.
 *
 * Si está viejo el e2e prueba una versión anterior de la aplicación: me pasó
 * —las filas de la home no aparecían porque el paquete era de antes de
 * escribirlas— y el fallo parecía de la aplicación. Se comprueba la fecha y se
 * construye si hace falta.
 */
async function paqueteAlDia(): Promise<boolean> {
  const construido = Bun.file(indice)
  if (!(await construido.exists())) return false

  const fecha = construido.lastModified
  const glob = new Bun.Glob('**/*.{ts,tsx,css}')

  for await (const relativo of glob.scan({ cwd: join(web, 'src') })) {
    if (Bun.file(join(web, 'src', relativo)).lastModified > fecha) return false
  }

  // El módulo falso entra en el paquete aunque no viva en `src`, así que un
  // cambio suyo también deja el paquete viejo. Y la configuración de Vite decide
  // qué lleva —el alias— además de emitir el aviso de seguridad que `/settings`
  // enlaza.
  for (const ruta of [join(web, 'e2e', 'hls-falso.ts'), join(web, 'vite.config.ts')]) {
    if (Bun.file(ruta).lastModified > fecha) return false
  }

  return true
}

/**
 * Construye la interfaz del e2e en `.tmp/e2e-dist`.
 *
 * Se construye el paquete de la web directamente y no con `scripts/build.ts`:
 * aquél deja el resultado en `packages/web/dist`, que es lo que sirve la
 * aplicación de verdad, y este lleva el transporte de mentira. El entorno del
 * hijo se pasa explícito porque con `env` no se hereda solo: es así como Vite se
 * entera de que este build es el del e2e y monta el alias.
 *
 * Se intenta primero el empaquetado normal de la configuración. En el sandbox de
 * algunos agentes ese empaquetado llama a `exec('net use')` —la solución de Vite
 * para las rutas de red de Windows— y el proceso no puede crear tuberías, así
 * que falla con EPERM; ahí se reintenta con el cargador nativo de la
 * configuración, que no empaqueta nada. En una máquina normal el primer intento
 * basta y el reintento no llega a usarse.
 */
async function construir(): Promise<boolean> {
  const argumentos = ['build', '--outDir', dist, '--emptyOutDir']
  const entorno = { ...process.env, NN_ANIME_E2E_HLS: HLS_FALSO }

  for (const extra of [[], ['--configLoader', 'native']]) {
    const construccion = Bun.spawn(['bun', 'x', 'vite', ...argumentos, ...extra], {
      cwd: web,
      env: entorno,
      stdout: 'inherit',
      stderr: 'inherit',
    })

    if ((await construccion.exited) === 0) return true
  }

  return false
}

if (!(await paqueteAlDia())) {
  console.log('el paquete del e2e está viejo: se construye en .tmp/e2e-dist antes de probar')

  if (!(await construir())) {
    console.error('no se pudo construir la interfaz del e2e')
    process.exit(1)
  }
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
      // La interfaz que se sirve es la del e2e —con el hls falso—, no la que
      // `packages/web/dist` guarda para la aplicación de verdad. El CLI le da
      // prioridad a esta variable sobre su ruta por defecto.
      NN_ANIME_WEB_DIR: dist,
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
