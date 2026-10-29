#!/usr/bin/env bun
/**
 * Las guardas del módulo `desktop`.
 *
 * El anfitrión de ventana vive en `desktop/`, **fuera de `packages/`**, y eso es
 * una decisión con tres consecuencias que se deshacen solas si nadie las vigila:
 *
 * 1. `bun run lint` recorre el repositorio entero. El árbol de Rust trae JSON
 *    generado que biome no debe reformatear, así que tiene que estar fuera de su
 *    alcance; si alguien quita esa exclusión, el listón se pone rojo en el sitio
 *    equivocado.
 * 2. Lo que compila `cargo` no se versiona, pero `Cargo.lock` sí: sin él la
 *    release no es reproducible.
 * 3. El contrato vive en `docs/specs/SPEC-desktop.md`, y la propuesta de la que
 *    salió (`proposals/SPEC-desktop.T135.md`) se borra al integrarla. Dos copias
 *    del mismo contrato acaban diciendo cosas distintas, que es justo lo que el
 *    Checkpoint H decidió no volver a permitir.
 *
 * Nada de esto lo mira `tsc` ni lo ve una prueba de producto: son archivos de
 * configuración y de documentación. Por eso se comprueban aquí.
 */

import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  HOST_NAME,
  hostBinary,
  MANIFEST,
  manifestVersion,
  rustTriple,
  SERVER_NAME,
  targetKey,
} from './package/desktop'
import {
  assertSubsystem,
  readSubsystem,
  SUBSYSTEM_CONSOLE,
  SUBSYSTEM_WINDOWS,
  subsystemName,
} from './package/pe'
import { comprobarOrden, unicoNombre } from './package/unico'
import { ROOT } from './workspaces'

const SPEC = join(ROOT, 'docs', 'specs', 'SPEC-desktop.md')
const PROPUESTA = join(ROOT, 'docs', 'specs', 'proposals', 'SPEC-desktop.T135.md')
const MAPA = join(ROOT, 'docs', 'specs', 'CAPABILITY-MAP.md')
const BIOME = join(ROOT, 'biome.json')
const GITIGNORE = join(ROOT, '.gitignore')
const STUB = join(ROOT, 'desktop', 'ui', 'index.html')

async function leer(ruta: string): Promise<string> {
  return await Bun.file(ruta).text()
}

describe('el contrato del módulo desktop', () => {
  test('el spec existe y la propuesta que lo originó ya no', async () => {
    const spec = await leer(SPEC)

    expect(spec).toContain('Module id: `desktop`')
    // El *Never* que corrige la propuesta: la salida del hijo no se escribe a
    // disco porque lleva el token de arranque.
    expect(spec).toContain('no la escribe en disco')
    expect(await Bun.file(PROPUESTA).exists()).toBe(false)
  })

  test('el mapa de capacidades lista el módulo y su árbol', async () => {
    const mapa = await leer(MAPA)

    expect(mapa).toContain('| `desktop` |')
    // Fuera de `packages/`, que es lo que mantiene verdes a `workspaces.test.ts`
    // (nueve paquetes) y a `tsconfig.json` (sólo mira `packages/*/src`).
    expect(mapa).toContain('fuera de `packages/`')
  })

  test('el árbol de Rust queda fuera del alcance de biome', async () => {
    const biome = JSON.parse(await leer(BIOME)) as {
      files?: { includes?: readonly string[] }
    }

    // Biome nombra la carpeta sin comodín: `!desktop/**` lo rechaza con «use
    // `!desktop`», así que la guarda fija la forma que la herramienta acepta.
    // Ya no se excluye `desktop/` entero: `desktop/ui` es TypeScript de la ventana
    // de actualizaciones y tiene que pasar el mismo listón que el resto.
    expect(biome.files?.includes ?? []).toContain('!desktop/src-tauri')
    expect(biome.files?.includes ?? []).not.toContain('!desktop')
  })

  test('lo que compila cargo no se versiona, y el lock sí', async () => {
    const ignore = await leer(GITIGNORE)

    expect(ignore).toContain('desktop/src-tauri/target/')
    expect(ignore).toContain('desktop/src-tauri/gen/')

    // Se miran los **patrones**, no el texto: el comentario de arriba nombra
    // `Cargo.lock` para decir que sí se versiona, y una comprobación por
    // subcadena se leería a sí misma y fallaría por su propia nota.
    const patrones = ignore
      .split(/\r?\n/)
      .map((linea) => linea.trim())
      .filter((linea) => linea !== '' && !linea.startsWith('#'))

    expect(patrones.some((patron) => patron.endsWith('Cargo.lock'))).toBe(false)
  })

  test('el `frontendDist` existe y no se llama `dist`', async () => {
    // `dist/` está ignorado en cualquier nivel del repositorio: un `frontendDist` con
    // ese nombre no llegaría al control de versiones y el `tauri build` del CI
    // fallaría por un archivo que existe en la máquina de quien lo escribió. Y no es
    // sólo relleno: es la página que la ventana enseña si el servidor no arranca.
    expect(await Bun.file(STUB).exists()).toBe(true)
    expect(await Bun.file(join(ROOT, 'desktop', 'dist')).exists()).toBe(false)
  })
})

describe('el anfitrión de ventana', () => {
  const CRATE = join(ROOT, 'desktop', 'src-tauri')

  test('el prefijo de la línea de arranque es el mismo en Rust y en TypeScript', async () => {
    // El formato vive en dos sitios por necesidad: uno lo escribe (`core`) y otro
    // lo lee (Rust). Si el prefijo se separa, el anfitrión no encuentra nunca la
    // línea y el síntoma es «no anunció su dirección», lejos de la causa.
    const enTs = /BOOT_LINE_PREFIX\s*=\s*'([^']+)'/.exec(
      await leer(join(ROOT, 'packages', 'core', 'src', 'boot-line.ts')),
    )?.[1]
    const enRust = /BOOT_LINE_PREFIX:\s*&str\s*=\s*"([^"]+)"/.exec(
      await leer(join(CRATE, 'src', 'boot_line.rs')),
    )?.[1]

    expect(enTs).toBeDefined()
    expect(enRust).toBe(enTs)
  })

  test('la versión del anfitrión es la de los package.json', async () => {
    const raiz = JSON.parse(await leer(join(ROOT, 'package.json'))) as { version: string }

    // `release-please` sube esta versión con el `extra-files` de tipo `toml`; esta
    // prueba es la que avisa el día que las dos versiones se separen.
    expect(await manifestVersion()).toBe(raiz.version)
  })

  test('el anfitrión no se llama como el servidor, y Rust busca el nombre del servidor', async () => {
    const manifiesto = await leer(MANIFEST)
    const sidecar = await leer(join(CRATE, 'src', 'sidecar.rs'))

    // Los dos tienen que convivir en el mismo directorio: si se llamaran igual,
    // el instalador no podría llevar los dos.
    expect(HOST_NAME).not.toBe(SERVER_NAME)
    expect(manifiesto).toContain(`name = "${HOST_NAME}"`)
    expect(sidecar).toContain(`const SIDECAR_NAME: &str = "${SERVER_NAME}"`)
  })

  test('la ventana se crea en tiempo de ejecución y el webview no tiene permisos', async () => {
    const config = JSON.parse(await leer(join(CRATE, 'tauri.conf.json'))) as {
      build: { frontendDist: string }
      app: { windows: readonly unknown[] }
      bundle: { active: boolean; targets: readonly string[] }
    }

    // Sin ventanas declaradas: la URL y el tamaño los pone `main.rs`, que es quien
    // sabe en qué puerto escucha el servidor. El puerto no se puede fijar antes.
    expect(config.app.windows).toHaveLength(0)

    // El empaquetado de Tauri está encendido desde T189, pero **sólo** para el
    // NSIS de Windows: es el que genera el `.sig` y el `latest.json` del updater.
    // macOS y Linux siguen armándose con `scripts/package.ts`.
    expect(config.bundle.active).toBe(true)
    expect(config.bundle.targets).toEqual(['nsis'])

    const relleno = join(CRATE, config.build.frontendDist, 'index.html')
    expect(await Bun.file(relleno).exists()).toBe(true)

    const capacidades = JSON.parse(await leer(join(CRATE, 'capabilities', 'default.json'))) as {
      permissions: readonly unknown[]
    }

    // El webview carga un origen remoto: sin permisos no puede invocar ni un
    // comando, y por eso no hay superficie de IPC que auditar.
    expect(capacidades.permissions).toHaveLength(0)
  })

  test('el anfitrión de Windows no abre consola', async () => {
    // Guarda **estática**, y se dice lo que es: la medición de verdad es la
    // cabecera PE del binario, que comprueba el CI. Esto avisa antes, al editar.
    const main = await leer(join(CRATE, 'src', 'main.rs'))

    expect(main).toContain('windows_subsystem = "windows"')
  })

  test('los iconos existen donde dice el `tauri.conf.json`', async () => {
    // Las rutas de `bundle.icon` son **relativas al directorio del
    // `tauri.conf.json`**, no a la raíz del repositorio. Con un `../` de menos
    // apuntan a `desktop/packaging/icons/…`, que no existe, y el resultado es que
    // **no compila en ninguna plataforma**: en Windows `tauri-build` aborta al
    // generar el recurso del icono («not found; required for generating a Windows
    // Resource file») y en Linux y macOS `generate_context!()` paniquea con
    // «failed to open icon». Es el fallo más caro de esta carpeta, porque cuesta
    // una vuelta entera de CI en las tres a la vez.
    const config = (await Bun.file(join(CRATE, 'tauri.conf.json')).json()) as {
      bundle?: { icon?: readonly string[] }
    }

    const iconos = config.bundle?.icon ?? []

    expect(iconos.length).toBeGreaterThan(0)

    for (const icono of iconos) {
      expect(await Bun.file(join(CRATE, icono)).exists(), icono).toBe(true)
    }
  })

  test('si el servidor no arranca, la ventana lo dice', async () => {
    // El fallo más probable de todos —que el servidor no esté al lado del anfitrión—
    // no puede quedarse en «no pasa nada»: en Windows el anfitrión es un binario de
    // subsistema `windows`, así que no hay consola donde leerlo y quien abre el acceso
    // no vería ni ventana ni mensaje.
    const main = await leer(join(CRATE, 'src', 'main.rs'))
    const aviso = await leer(join(ROOT, 'desktop', 'ui', 'index.html'))

    // Se cuentan las **llamadas**, no la definición: `toContain('avisar_fallo')` lo
    // satisface la propia `fn avisar_fallo`, así que borrar las dos llamadas —o sea,
    // el comportamiento— dejaba esta prueba en verde. Lo encontró la revisión, y es
    // la misma clase de prueba vacua que este archivo persigue en los demás.
    //
    // `\s*` y no un espacio literal porque `rustfmt` parte la llamada larga en varias
    // líneas; con el espacio fijo, la prueba fallaba por su propia expresión regular.
    const llamadas = main.match(/avisar_fallo\(\s*&handle/g) ?? []

    expect(llamadas.length).toBeGreaterThanOrEqual(2)
    // Y la página de dentro, no una URL: cuando el servidor no arranca no hay a quién
    // pedirle nada. Esto vive en la definición, que es donde se construye la ventana.
    expect(main).toContain('WebviewUrl::App')
    // Y la página tiene que decir **dónde mirar**: es lo único que ve quien se topa
    // con ella.
    expect(aviso).toContain('desktop.log')
  })

  test('la ventana no se lleva los enlaces externos', async () => {
    const main = await leer(join(CRATE, 'src', 'main.rs'))

    // Sin política de navegación, pulsar el enlace a AniList de la ficha se
    // llevaría la ventana fuera de la aplicación y no habría forma de volver.
    expect(main).toContain('on_navigation')
    expect(main).toContain('browser::open')
  })

  test('la aplicación es de instancia única', async () => {
    const manifiesto = await leer(MANIFEST)
    const main = await leer(join(CRATE, 'src', 'main.rs'))

    // Dos anfitriones son dos servidores sobre la misma base, y cerrar uno deja
    // al otro sirviendo sin que nadie lo sepa. La segunda pulsación del acceso
    // tiene que enfocar la ventana que ya está.
    expect(manifiesto).toContain('tauri-plugin-single-instance')
    expect(main).toContain('tauri_plugin_single_instance::init')
  })

  test('el icono de la bandeja se crea y su menú tiene tres opciones', async () => {
    const manifiesto = await leer(MANIFEST)
    const main = await leer(join(CRATE, 'src', 'main.rs'))
    const tray = await leer(join(CRATE, 'src', 'tray.rs'))

    // Sin `tray-icon` el módulo ni siquiera compila; sin `image-png` no se puede
    // meter el icono dentro del binario y habría que leerlo del disco, donde no
    // está en la máquina de quien instaló el programa.
    expect(manifiesto).toContain('"tray-icon"')
    expect(manifiesto).toContain('"image-png"')
    expect(main).toContain('mod tray;')

    // El icono viaja dentro del ejecutable, y el archivo del que sale existe.
    expect(tray).toContain('include_bytes!')
    expect(await Bun.file(join(ROOT, 'packaging', 'icons', 'icon-32.png')).exists()).toBe(true)

    // Tres opciones y ni una más: el menú de la bandeja se lee de un vistazo o
    // deja de usarse. Se comparan los ids en orden, que es el orden del menú.
    const opciones = [...tray.matchAll(/MenuItem::with_id\(app, ID_([A-Z]+)/g)].map(
      (coincidencia) => coincidencia[1],
    )

    expect(opciones).toEqual(['ABRIR', 'ALTERNAR', 'SALIR'])
  })

  test('cerrar la ventana la oculta, y sólo «Salir» termina la aplicación', async () => {
    const main = await leer(join(CRATE, 'src', 'main.rs'))
    const tray = await leer(join(CRATE, 'src', 'tray.rs'))

    // La X no puede llevarse el proceso: con la ventana oculta, el icono es la
    // única forma de volver a ella. `prevent_close` es lo que la convierte en
    // «ocultar» en vez de «cerrar».
    expect(main).toContain('api.prevent_close()')
    expect(main).toContain('ventana.hide()')

    // Y la única salida se lleva el icono antes de terminar: si se quedara, el
    // menú seguiría vivo un instante sobre una aplicación que ya no está.
    expect(tray).toContain('remove_tray_by_id')
    expect(tray).toContain('app.exit(0)')
  })

  test('el registro dice qué ruta falló y por qué', async () => {
    const main = await leer(join(CRATE, 'src', 'main.rs'))
    const sidecar = await leer(join(CRATE, 'src', 'sidecar.rs'))

    // Un registro que se elige en silencio deja el fallo sin evidencia: si cae al
    // lado del ejecutable en vez de en la caché, el archivo tiene que decir cuál
    // se intentó primero y qué error lo impidió. Antes se tiraba el error y sólo
    // quedaba «está aquí», que es justo el dato que no sirve.
    expect(sidecar).toContain('intentos_de_registro')
    expect(sidecar).toContain('no se pudo crear el directorio')
    expect(sidecar).toContain('no se pudo abrir')
    expect(main).toContain('sidecar::intentos_de_registro()')

    // Y el perfil del navegador interno vive con los datos: se le pasa a la
    // ventana con `data_directory`, así que borrar la carpeta de la aplicación se
    // lleva también el webview.
    expect(main).toContain('data_directory')
    expect(main).toContain('webview()')
  })

  test('en macOS y Linux el servidor viaja al lado del anfitrión', async () => {
    const sidecar = await leer(join(CRATE, 'src', 'sidecar.rs'))
    const main = await leer(join(CRATE, 'src', 'main.rs'))

    // Allí el anfitrión no lleva el servidor dentro: el `.app`, el `.deb`, el
    // `.rpm` y el AppImage instalan los dos juntos. Sin esta rama, `embebido`
    // escribiría cero bytes, los ejecutaría y la ventana enseñaría el aviso.
    expect(sidecar).toContain('pub fn sibling_path')
    expect(main).toContain('embebido::hay_servidor()')
    expect(main).toContain('sidecar::sibling_path()')
  })

  test('el servidor nombra la base y los directorios que no pudo preparar', async () => {
    const config = await leer(join(ROOT, 'packages', 'core', 'src', 'config.ts'))
    const boot = await leer(join(ROOT, 'packages', 'cli', 'src', 'boot.ts'))
    const index = await leer(join(ROOT, 'packages', 'cli', 'src', 'index.ts'))

    // La ruta absoluta y el error, juntos: `unable to open database file` sin
    // ruta no distingue un directorio que falta de uno sin permisos. Se comprueba
    // que el mensaje acumula los fallos en vez de parar en el primero.
    expect(config).toContain('no se pudieron preparar directorios')
    expect(config).toContain('fallos.push')
    expect(index).toContain('path: config.dbPath')
    expect(boot).toContain('cli.migration.failedPath')
    expect(boot).toContain('cli.dirs.failed')
  })

  test('el anfitrión detecta la etiqueta Low y lo dice con un diálogo nativo', async () => {
    const entorno = await leer(join(CRATE, 'src', 'entorno.rs'))
    const main = await leer(join(CRATE, 'src', 'main.rs'))

    // Un ejecutable con etiqueta `Low` no puede escribir en el perfil ni crear el
    // perfil de WebView2, y el anfitrión no tiene consola: sin esto el fallo se
    // queda en silencio. Se registra el nivel y el usuario, y se avisa con
    // `MessageBoxW`, que no depende de archivos ni del webview.
    expect(entorno).toContain('TokenIntegrityLevel')
    expect(entorno).toContain('LookupAccountSidW')
    expect(entorno).toContain('MessageBoxW')
    expect(entorno).toContain('integridad baja')
    expect(main).toContain('entorno::comprobar()')

    // Y el aviso de fallo también cae al diálogo nativo: la ventana puede no
    // existir justo cuando hace falta avisar.
    expect(main).toContain('entorno::aviso_nativo')
  })

  test('los datos van al perfil del usuario, con respaldo y modo portable explícito', async () => {
    const entorno = await leer(join(CRATE, 'src', 'entorno.rs'))

    // `%LOCALAPPDATA%\nn-anime` primero: los datos sobreviven a borrar el `.exe` y
    // no ensucian la carpeta donde se copió.
    expect(entorno).toContain('LOCALAPPDATA')
    expect(entorno).toContain('join("nn-anime")')
    // Y en macOS y Linux, la raíz XDG del usuario: sin ella caería al directorio
    // del ejecutable, que en un `.deb` es de root y en un AppImage no se escribe.
    expect(entorno).toContain('XDG_DATA_HOME')
    expect(entorno).toContain('HOME')
    expect(entorno).toContain('NN_ANIME_DATA_DIR')
    expect(entorno).toContain('NN_ANIME_CONFIG_DIR')
    expect(entorno).toContain('NN_ANIME_CACHE_DIR')

    // El portable es **explícito**: un archivo, no la presencia de una carpeta que
    // podría crear cualquiera sin saber qué hace.
    expect(entorno).toContain('portable.txt')

    // Y la prueba de escritura es de verdad, no una mirada a los permisos.
    expect(entorno).toContain('probar_escritura')
  })

  test('el entregable es un solo archivo, con el servidor dentro', async () => {
    const build = await leer(join(CRATE, 'build.rs'))
    const embebido = await leer(join(CRATE, 'src', 'embebido.rs'))
    const unico = await leer(join(ROOT, 'scripts', 'package', 'unico.ts'))
    const desktop = await leer(join(ROOT, 'scripts', 'package', 'desktop.ts'))

    // El servidor viaja dentro del anfitrión: un `.exe` que se copia a cualquier
    // carpeta sin llevar nada al lado. Es lo que quita el fallo más repetido de
    // esta aplicación —dos archivos que se separan—.
    expect(build).toContain('include_bytes!')
    expect(build).toContain('Sha256')
    expect(embebido).toContain('HASH_SERVIDOR')

    // Y el empaquetado **exige** el servidor en Windows: sin esta variable,
    // `build.rs` compila un anfitrión vacío que arranca y enseña el aviso de fallo,
    // y el fallo aparece en el instalador en vez de en la compilación.
    expect(build).toContain('NN_ANIME_EXIGIR_SERVIDOR')
    expect(desktop).toContain('NN_ANIME_EXIGIR_SERVIDOR')
    expect(desktop).toContain("platform === 'windows'")

    // Se escribe en un temporal y se renombra: `rename` es atómico y nadie puede
    // ver un `.exe` a medio escribir.
    expect(embebido).toContain('exe.tmp')
    expect(embebido).toContain('rename')

    // Y el nombre que descarga un usuario.
    expect(unico).toContain('windows-x64.exe')
  })

  test('el icono se crea antes de lanzar el servidor', async () => {
    const main = await leer(join(CRATE, 'src', 'main.rs'))

    // El orden es el arreglo, no un detalle: la ventana no existe hasta que el
    // servidor anuncia su dirección, así que si el icono se creara después de
    // lanzarlo, el hueco inicial volvería a parecer «no pasa nada».
    const icono = main.indexOf('tray::crear')
    const hilo = main.indexOf('std::thread::spawn')

    expect(icono).toBeGreaterThan(-1)
    expect(hilo).toBeGreaterThan(-1)
    expect(icono).toBeLessThan(hilo)
  })

  test('el instalador de Windows lo arma tauri-bundler, no un .nsi a mano', async () => {
    // Desde T189 el instalador de Windows no se escribe en este repositorio: lo
    // genera Tauri, que es lo único que produce el `.sig` y el `latest.json` que el
    // updater necesita. Si alguien devolviera el `.nsi`, volveríamos a un instalador
    // que el updater no sabe actualizar.
    expect(await Bun.file(join(ROOT, 'packaging', 'windows', 'nn-anime.nsi')).exists()).toBe(false)

    const conf = await leer(join(CRATE, 'tauri.conf.json'))

    // El binario que se instala no se llama como el producto: el nombre lo fija
    // `[[bin]]` en `Cargo.toml` y `mainBinaryName` es el contrato con el bundler.
    expect(conf).toContain('"mainBinaryName": "nn-anime-desktop"')
    expect(conf).toContain('"targets": ["nsis"]')
    expect(conf).toContain('"createUpdaterArtifacts": true')
    expect(conf).toContain('"installMode": "currentUser"')
    // El updater descarga e instala sin preguntar: `passive` es la ventana con
    // barra de progreso, no el asistente.
    expect(conf).toContain('"installMode": "passive"')
    expect(conf).toContain('https://github.com/zxuru/nn-anime/releases/latest/download/latest.json')
    expect(conf).toContain('"pubkey"')
  })

  test('el CI compila y mide el árbol de Rust', async () => {
    // Esta es la guarda que más importa del archivo. El anfitrión vive fuera de
    // `packages/`, así que `tsc`, `bun test` y biome no ven una línea suya: si
    // desaparece este trabajo, el módulo se queda sin nadie que lo mida y nada
    // más lo delata. Quitarlo pone esta prueba en rojo.
    const ci = await leer(join(ROOT, '.github', 'workflows', 'ci.yml'))

    expect(ci).toContain('\n  desktop:')
    expect(ci).toContain('bun run desktop:check')
    expect(ci).toContain('bun run desktop:build')
    // El trabajo `desktop` mide el árbol de Rust, no empaqueta: compila sin
    // servidor. El `empaquetado` sí lo exige.
    expect(ci).toContain('bun run desktop:build --sin-servidor')
  })
})

describe('la compilación cruzada del anfitrión', () => {
  test('cada objetivo publicado tiene su triple de Rust', async () => {
    // Si se añade una plataforma a `TARGETS` —Linux arm64, por ejemplo— y se
    // olvida su triple, el empaquetado falla al preparar el anfitrión. Esto lo
    // dice antes y nombra el objetivo que falta.
    const { TARGETS } = await import('./package/binary')

    for (const [clave, spec] of Object.entries(TARGETS)) {
      expect(rustTriple(spec.platform, spec.arch), clave).toBeDefined()
      expect(targetKey(spec.platform, spec.arch), clave).toBe(clave)
    }
  })

  test('el binario sale del directorio del triple, no de `target/release`', () => {
    // `cargo build --target` escribe en `target/<triple>/release`. Buscar en
    // `target/release` encontraría el binario de la máquina, y en el `.dmg` de
    // Intel eso es un anfitrión arm64: un ejecutable que no arranca.
    expect(hostBinary('macos', 'x64')).toContain(join('target', 'x86_64-apple-darwin', 'release'))
    expect(hostBinary('macos', 'arm64')).toContain(
      join('target', 'aarch64-apple-darwin', 'release'),
    )
    expect(hostBinary('windows', 'x64').endsWith('nn-anime-desktop.exe')).toBe(true)
    expect(hostBinary('macos', 'x64').endsWith('nn-anime-desktop')).toBe(true)
  })

  test('un objetivo sin triple se rechaza en vez de inventar una ruta', () => {
    expect(rustTriple('macos', 'riscv64')).toBeUndefined()
    expect(() => hostBinary('macos', 'riscv64')).toThrow()
  })

  test('la release pide el anfitrión del objetivo de su vuelta', async () => {
    // Sin `--target`, las dos vueltas de macOS compilarían el anfitrión de la
    // máquina y el `.dmg` de Intel llevaría el de Apple Silicon.
    const release = await leer(join(ROOT, '.github', 'workflows', 'release.yml'))

    // Expresión regular y no cadena: el texto lleva una expresión de Actions
    // (`${{ ... }}`), y escribirla dentro de una cadena dispara
    // `noTemplateCurlyInString`.
    expect(release).toMatch(/bun run desktop:build --target=\$\{\{ matrix\.target \}\}/)
    // Y los dos ejecutables de Windows se firman: el acceso abre el anfitrión.
    expect(release).toContain('nn-anime-desktop.exe')
  })
})

describe('el paquete de macOS', () => {
  test('abre el anfitrión, no el servidor de consola', async () => {
    const plist = await leer(join(ROOT, 'packaging', 'macos', 'Info.plist'))

    const ejecutable = /<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)?.[1]

    // Se compara contra la constante y no contra el literal: si alguien renombra
    // el anfitrión, esto falla en lugar de dejar el `Info.plist` nombrando un
    // archivo que ya no existe —y macOS sin abrir nada—.
    expect(ejecutable).toBe(HOST_NAME)
  })

  test('los dos ejecutables viajan dentro del `.app`', async () => {
    const macos = await leer(join(ROOT, 'scripts', 'package', 'macos.ts'))

    // El servidor y el anfitrión, en el mismo `Contents/MacOS`: el anfitrión
    // busca al servidor por su nombre en su propio directorio.
    expect(macos).toContain("join(macos, 'nn-anime')")
    expect(macos).toContain('join(macos, HOST_NAME)')
    // Y si el anfitrión no está, se para aquí y no en el Mac de quien instala.
    expect(macos).toContain('no hay anfitrión junto al servidor')
  })
})

describe('el paquete de Linux', () => {
  test('el acceso del menú abre la ventana y no pide terminal', async () => {
    const desktop = await leer(join(ROOT, 'packaging', 'linux', 'nn-anime.desktop'))

    expect(desktop).toContain('Exec=nn-anime-desktop')
    // Se ancla a la **línea de la directiva** y no se busca la subcadena en
    // cualquier parte: el comentario del archivo nombra `Terminal=false` para
    // explicar por qué, así que un `toContain` daría por bueno un archivo con
    // `Terminal=true` de verdad. Es la clase de prueba que pasa con el código roto.
    expect(desktop).toMatch(/^Terminal=false$/m)
    expect(desktop).not.toMatch(/^Terminal=true$/m)
  })

  test('el `.deb` y el `.rpm` llevan los dos ejecutables, sus enlaces y el webview', async () => {
    const nfpm = await leer(join(ROOT, 'packaging', 'linux', 'nfpm.yaml'))

    expect(nfpm).toContain('__HOST__')
    expect(nfpm).toContain('/usr/lib/nn-anime/nn-anime-desktop')
    // Los dos en el PATH: el `.desktop` invoca `nn-anime-desktop` a secas y la
    // consola sigue siendo invocable a mano.
    expect(nfpm).toContain('dst: /usr/bin/nn-anime-desktop')
    expect(nfpm).toContain('dst: /usr/bin/nn-anime')
    // El anfitrión necesita el webview; el servidor sólo necesitaba libc6.
    expect(nfpm).toContain('libwebkit2gtk-4.1-0')
    expect(nfpm).toContain('webkit2gtk4.1')
  })

  test('el AppImage abre la ventana sin argumentos y la consola con ellos', async () => {
    const apprun = await leer(join(ROOT, 'packaging', 'linux', 'AppRun'))

    // Sin la primera rama, el doble clic en el AppImage seguiría abriendo una
    // consola; sin la segunda, `./nn-anime.AppImage "naruto"` dejaría de
    // funcionar. Las dos cosas a la vez son el trato.
    expect(apprun).toContain('[ "$#" -eq 0 ]')
    expect(apprun).toContain('exec "$aqui/usr/bin/nn-anime-desktop"')
    expect(apprun).toContain('exec "$aqui/usr/bin/nn-anime" "$@"')
  })
})

describe('el subsistema PE', () => {
  /** Una cabecera PE mínima con el `Subsystem` que se le pida. */
  function peFalso(subsystem: number): Uint8Array {
    const bytes = new Uint8Array(0x200)
    const view = new DataView(bytes.buffer)

    view.setUint32(0x3c, 0x80, true) // `e_lfanew`
    view.setUint32(0x80, 0x0000_4550, true) // la firma `PE\0\0`
    view.setUint16(0x80 + 4 + 20 + 0x44, subsystem, true)

    return bytes
  }

  test('lee el subsistema de una cabecera bien formada', () => {
    expect(readSubsystem(peFalso(SUBSYSTEM_WINDOWS))).toBe(SUBSYSTEM_WINDOWS)
    expect(readSubsystem(peFalso(SUBSYSTEM_CONSOLE))).toBe(SUBSYSTEM_CONSOLE)
  })

  test('nombra los dos que importan, y no inventa con el resto', () => {
    expect(subsystemName(SUBSYSTEM_WINDOWS)).toBe('windows')
    expect(subsystemName(SUBSYSTEM_CONSOLE)).toBe('console')
    expect(subsystemName(9)).toBe('desconocido (9)')
  })

  test('rechaza lo que no es un ejecutable en vez de devolver un cero', () => {
    // Un `0` haría que el fallo apareciera como «no es ninguno de los dos» en
    // lugar de «esto no es un ejecutable de Windows».
    expect(() => readSubsystem(new Uint8Array(0x200))).toThrow(/firma/)
    expect(() => readSubsystem(new Uint8Array(8))).toThrow(/corto/)
  })

  test('rechaza una cabecera que apunta fuera del archivo', () => {
    const bytes = peFalso(SUBSYSTEM_WINDOWS)

    new DataView(bytes.buffer).setUint32(0x3c, 0xffff_fff0, true)

    expect(() => readSubsystem(bytes)).toThrow(/fuera del archivo/)
  })

  test('dice qué se esperaba y qué hay cuando no coincide', () => {
    expect(assertSubsystem(peFalso(SUBSYSTEM_WINDOWS), 'windows')).toBe('windows (2)')
    expect(() => assertSubsystem(peFalso(SUBSYSTEM_CONSOLE), 'windows')).toThrow(
      /se esperaba windows \(2\) y el ejecutable declara console/,
    )
  })

  test('el CI mide el subsistema de los dos ejecutables de Windows', async () => {
    // La medición de «sin consola» que un CI puede hacer. El anfitrión tiene que
    // declarar WINDOWS y el servidor CONSOLE —y el servidor está bien así: quien
    // no puede abrir consola es el anfitrión, y al lanzarlo usa CREATE_NO_WINDOW—.
    const ci = await leer(join(ROOT, '.github', 'workflows', 'ci.yml'))

    expect(ci).toContain('scripts/package/pe.ts')
    expect(ci).toContain('nn-anime.exe console')
    expect(ci).toContain('nn-anime-desktop.exe windows')
  })
})

/** Un directorio temporal dentro del repositorio, con su padre asegurado. */
async function tempDir(prefijo: string): Promise<string> {
  const base = join(ROOT, '.tmp')
  await mkdir(base, { recursive: true })

  return await mkdtemp(join(base, prefijo))
}

/** El bloque de un paso de un workflow, desde su `- name:` hasta el siguiente. */
function paso(texto: string, nombre: string): string {
  const inicio = texto.indexOf(`- name: ${nombre}`)
  expect(inicio, nombre).toBeGreaterThan(-1)

  const siguiente = texto.indexOf('\n      - name:', inicio + 1)

  return texto.slice(inicio, siguiente === -1 ? undefined : siguiente)
}

describe('el archivo único y la release', () => {
  test('el nombre es el que se descarga', () => {
    expect(unicoNombre('1.2.3')).toBe('nn-anime-1.2.3-windows-x64.exe')
  })

  test('un anfitrión más viejo que el servidor se rechaza', async () => {
    // Es el fallo silencioso que el orden de la release evita: copiar un anfitrión
    // compilado antes que el servidor deja dentro el de ayer, o ninguno.
    const dir = await tempDir('unico-')

    try {
      const servidor = join(dir, 'nn-anime.exe')
      const anfitrion = join(dir, 'nn-anime-desktop.exe')

      await writeFile(servidor, 'servidor')
      await writeFile(anfitrion, 'anfitrion')

      const viejo = new Date(Date.now() - 60_000)
      const nuevo = new Date(Date.now() + 60_000)

      await utimes(anfitrion, viejo, viejo)
      await utimes(servidor, nuevo, nuevo)

      await expect(comprobarOrden(anfitrion, servidor)).rejects.toThrow(/más viejo/)

      await utimes(anfitrion, nuevo, nuevo)
      await expect(comprobarOrden(anfitrion, servidor)).resolves.toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('la release compila servidor, anfitrión, único e instalador en ese orden', async () => {
    // Si el anfitrión se compila antes que el servidor, `build.rs` no lo mete
    // dentro y el `.exe` arranca sin interfaz. El orden es el contrato. En Windows,
    // además, el `package:unico` va **después** de `tauri-action`: es el bundler el
    // que recompila y firma el anfitrión, y el portable tiene que ser esa copia.
    const release = await leer(join(ROOT, '.github', 'workflows', 'release.yml'))
    const nombres = [
      'Compilar y probar el ejecutable',
      'Firmar el servidor de Windows',
      'Compilar el anfitrión',
      'Firmar el anfitrión de Windows',
      'Armar el instalador',
      'Armar el instalador (Windows) y subirlo',
      'Ejecutable único (Windows)',
    ]
    const indices = nombres.map((nombre) => {
      const indice = release.indexOf(`- name: ${nombre}`)
      expect(indice, nombre).toBeGreaterThan(-1)
      return indice
    })

    expect(indices).toEqual([...indices].sort((a, b) => a - b))
  })

  test('el único se construye sólo en Windows y se mide su PE', async () => {
    const release = await leer(join(ROOT, '.github', 'workflows', 'release.yml'))

    expect(paso(release, 'Ejecutable único (Windows)')).toContain("if: runner.os == 'Windows'")
    expect(release).toContain('bun run package:unico')
    // El archivo que se descarga, no sólo el anfitrión que se compila.
    expect(release).toMatch(/nn-anime-\*-windows-x64\.exe/)
    expect(paso(release, 'Comprobar el subsistema de los ejecutables (Windows)')).toContain(
      'scripts/package/pe.ts',
    )
  })

  test('el CI recorre la misma cadena y deja el único descargable', async () => {
    const ci = await leer(join(ROOT, '.github', 'workflows', 'ci.yml'))
    const nombres = [
      'Compilar y probar el ejecutable',
      'Compilar el anfitrión',
      'Ejecutable único (Windows)',
      'Armar el instalador',
      'Armar el instalador (Windows)',
    ]
    const indices = nombres.map((nombre) => {
      const indice = ci.indexOf(`- name: ${nombre}`)
      expect(indice, nombre).toBeGreaterThan(-1)
      return indice
    })

    expect(indices).toEqual([...indices].sort((a, b) => a - b))
    expect(paso(ci, 'Ejecutable único (Windows)')).toContain("if: runner.os == 'Windows'")
  })

  test('un solo workflow publica: el publicador repetido ya no existe', async () => {
    // Dos workflows subiendo al mismo tag fue la carrera que dejó esta release a
    // medias. `release.yml` es el único que puede tocar una release.
    const workflows = join(ROOT, '.github', 'workflows')

    expect(await Bun.file(join(workflows, 'desktop.yml')).exists()).toBe(false)

    for (const nombre of await Array.fromAsync(new Bun.Glob('*.yml').scan({ cwd: workflows }))) {
      const texto = await leer(join(workflows, nombre))
      const publica = /gh release (create|upload|edit)/.test(texto)

      expect(publica, nombre).toBe(nombre === 'release.yml')
    }
  })

  test('la prueba del instalador espera el archivo único y la bandeja', async () => {
    const script = await leer(join(ROOT, 'packaging', 'windows', 'probar-instalador.ps1'))

    // Un solo ejecutable: si vuelve el servidor suelto, el instalador deja de ser
    // el archivo único que se publica y esto lo dice. El instalador de Tauri no
    // instala un `.ico` aparte; el icono va dentro del `.exe`.
    expect(script).toContain("'nn-anime-desktop.exe'")
    expect(script).toContain("'uninstall.exe'")
    expect(script).not.toContain("'nn-anime.exe', 'nn-anime-desktop.exe'")

    // Los datos del anfitrión viven todos bajo `%LOCALAPPDATA%\nn-anime`, que con
    // el instalador de Tauri es también el directorio de instalación. El
    // desinstalador borra lo suyo y deja el resto; por eso el centinela va en la
    // raíz y se comprueba después.
    expect(script).toContain("Join-Path $env:LOCALAPPDATA 'nn-anime'")
    expect(script).not.toContain("Join-Path $env:APPDATA 'nn-anime'")

    // El servidor se extrae del binario; y la X oculta en la bandeja, no apaga.
    expect(script).toContain('nn-anime\\bin')
    expect(script).toContain('IsWindowVisible')
    expect(script).toContain('la ventana quedó oculta')

    // El `.exe` extrae 98 MB antes de lanzar el servidor: la prueba espera al
    // servidor **y** a la ventana, no al primer handle de la bandeja. Y la
    // visibilidad se mide sobre el handle de la aplicación, que se guarda antes
    // de cerrarla: después, `MainWindowHandle` puede ser el de la bandeja.
    expect(script).toContain('$servidores.Count -eq 1 -and $ventana')
    expect(script).toContain('$handleVentana')
  })
})
