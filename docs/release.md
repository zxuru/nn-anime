# Publicar una release

Cómo sale una versión de nn-anime: qué hace cada workflow, qué secretos hay que configurar, cómo
probarlo todo sin publicar, y **qué no está probado** todavía.

El resumen para el día a día está en el [README](../README.md#cómo-publicar-una-release-para-mantenedores).
Aquí está el detalle.

## El camino, de un commit a un instalador

```
main ──► release-please ──► PR de release ──► merge ──► tag vX.Y.Z + release EN BORRADOR
                                                              │
                                                              ▼
                                  release.yml (el tag lo dispara)
                                  ├── comprobar: listón + tag == package.json
                                  ├── instaladores: servidor → anfitrión → .exe único
                                  │                (windows), los paquetes de macos×2 y linux,
                                  │                y el NSIS + .sig + latest.json con tauri-action
                                  └── publicar: SHA256SUMS + subir al borrador + publicar
```

`tauri-action` sube el instalador de Windows, su `.sig` y `latest.json` **directamente al borrador**
con `tagName`, y `publicar` añade los demás artefactos sin borrarlos. El paso final comprueba que
`latest.json` anuncia `windows-x86_64` con url y firma antes de publicar: una release sin eso se ve
bien y deja a todos los clientes sin actualizar.

| Workflow | Cuándo | Qué hace |
|---|---|---|
| `ci.yml` | Cada push y cada PR | Tipos, estilo, pruebas, e2e, y el empaquetado en matriz con el ejecutable arrancado y el `.exe` único de Windows |
| `release-please.yml` | Push a `main` | Mantiene el PR de release: `CHANGELOG.md` y la versión de los diez `package.json` |
| `release.yml` | Push de un tag `v*.*.*`, o a mano | Compila el archivo único y los instaladores, y publica la release. **Es el único publicador** |

`desktop.yml` ya no existe. Nació para construir y publicar el `.exe` único por su cuenta y competía
con `release.yml` por el mismo tag; ahora `ci.yml` lo construye en cada push y `release.yml` es el
único que crea o modifica una release.

### Un ajuste que hay que hacer una vez

**Settings → Actions → General → Workflow permissions**: marca
**«Allow GitHub Actions to create and approve pull requests»**.

Sin eso, el `GITHUB_TOKEN` no puede abrir el PR de release y `release-please` falla. Es el único
ajuste del repositorio que hace falta; el resto es cosa de los secretos, que son opcionales.

### Por qué la release nace en borrador

`release-please-config.json` tiene `draft: true` y `force-tag-creation: true`, y las dos hacen falta:

- **`draft`**: la release se crea en borrador, así nadie ve una release a la que todavía le faltan
  los instaladores. El workflow la publica cuando ya están los de las tres plataformas.
- **`force-tag-creation`**: GitHub no crea el tag de una release en borrador hasta que se publica. Sin
  esto, el tag no existiría, `release.yml` no se dispararía nunca y la release se quedaría en borrador
  para siempre.

### El cuerpo del PR de release

El PR que mantiene `release-please` es el `CHANGELOG.md` y nada más. La cabecera y el pie de ese
cuerpo se deciden con `pull-request-header` y `pull-request-footer` en `release-please-config.json`,
y los dos van con **un espacio**, no con la cadena vacía: release-please hace
`header || DEFAULT_HEADER`, así que un valor vacío devuelve su cabecera («🤖 I have created a
release *beep boop*») y su pie («This PR was generated with [Release Please]…»). Un espacio es lo
único que deja el cuerpo en blanco; el `---` que release-please pone entre la cabecera y las notas
sigue ahí, como separador.

Esto sólo cambia el PR. Las notas de la release en GitHub son la sección de notas del cuerpo, sin
cabecera ni pie, así que la release publicada no cambia al quitar el pie.

### La versión, en un solo sitio

La raíz manda. `bun run version:check` falla si alguno de los nueve paquetes se desvió, y
`release-please` los actualiza a la vez con la lista `extra-files` de `release-please-config.json`.
Esa lista incluye también `desktop/src-tauri/Cargo.toml` (tipo `toml`, `$.package.version`): sin eso,
el anfitrión se quedaría en la versión anterior y `scripts/desktop.test.ts` —que compara las dos—
pondría el PR de release en rojo. Si algún día se añade un paquete a `packages/`, hay que añadirlo
también ahí: hay una prueba (`scripts/package.test.ts`) que compara las dos listas y falla si no
coinciden.

`desktop/src-tauri/Cargo.lock` viaja en la misma lista, pero con el actualizador `generic`: la línea
de la versión del paquete `nn-anime-desktop` lleva el comentario `x-release-please-version`, que es
lo que le dice a release-please qué número reemplazar. Hace falta porque `desktop:build` compila con
`--locked`: si el lock se queda en la versión anterior, `cargo` se niega a actualizarlo y **los
cuatro instaladores fallan antes de compilar**. Pasó al publicar `0.3.0`; la anotación y la entrada
de la lista son la corrección.

`bun.lock` guarda la versión de cada workspace y **release-please no lo toca**. Comprobado: mover esas
versiones no rompe `bun install --frozen-lockfile`, así que no hace falta regenerarlo en la release.

## Secretos

Los de **firma de código** son opcionales: sin ellos, las builds salen sin firmar y se instalan
igual, con las advertencias del sistema que explica la sección de instalación del README. El del
**updater** no lo es: sin él `tauri build` no puede firmar los artefactos y la release sale sin
`latest.json`; los clientes se quedarían sin actualizaciones. Los pasos se activan solos si el
secreto existe.

### Windows

| Secreto | Qué es |
|---|---|
| `WINDOWS_CERT_PFX_BASE64` | El certificado de firma de código (`.pfx`) en base64 |
| `WINDOWS_CERT_PASSWORD` | La contraseña del `.pfx` |

El `.pfx` se escribe en un archivo temporal del runner, se usa y **se borra** al terminar. Ni el
certificado ni la contraseña se imprimen nunca; solo se confirma que existen.

Para obtener el base64:

```bash
# Linux y macOS
base64 -w0 certificado.pfx > certificado.pfx.base64
```

```powershell
# Windows
[Convert]::ToBase64String([IO.File]::ReadAllBytes('certificado.pfx')) | Set-Content certificado.pfx.base64
```

El certificado se compra a una autoridad (Sectigo, DigiCert, SSL.com…) y hay que exportarlo **con la
clave privada** en `.pfx`. Un certificado EV o uno de Azure Trusted Signing también valen, pero
implican cambiar el paso de firma: `signtool` con un `.pfx` es lo que está escrito.

### macOS

| Secreto | Qué es |
|---|---|
| `APPLE_CERT_P12_BASE64` | El certificado «Developer ID Application» (`.p12`) en base64 |
| `APPLE_CERT_PASSWORD` | La contraseña del `.p12` |
| `APPLE_ID` | El correo de la cuenta de desarrollador de Apple |
| `APPLE_APP_SPECIFIC_PASSWORD` | Una contraseña específica de aplicación, generada en appleid.apple.com |
| `APPLE_TEAM_ID` | El identificador del equipo, en developer.apple.com → Membership |

La **identidad de firma no es un secreto aparte**: se deduce del certificado que se importa en un
llavero temporal del runner. En un runner limpio es la única que hay, y un secreto menos es un sitio
menos donde desincronizarse.

El base64 del `.p12` se saca igual que el del `.pfx`. El certificado se genera en el portal de
desarrollador de Apple (Certificates → Developer ID Application) y se exporta desde el Llavero con su
clave privada.

Sin los cinco, el `.app` y el `.dmg` salen **sin firmar y sin notarizar**, y quien los descargue verá
el aviso de «desarrollador no identificado».

### Actualizaciones (obligatorio)

| Secreto | Qué es |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | El **contenido** de la clave privada que generó `bun tauri signer generate` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | La contraseña con la que se generó esa clave |

La clave privada **nunca** se versiona: `.gitignore` ya tapa `*.key` y los pasos del workflow sólo la
leen del secreto. La **pública** va en `plugins.updater.pubkey` de `desktop/src-tauri/tauri.conf.json`
y es lo que verifica cada cliente que la descarga viene de aquí. Si se pierde la privada no se pueden
publicar actualizaciones para quien ya tiene la aplicación instalada: hay que guardarla.

El comando, con la clave fuera del repositorio:

```bash
bun tauri signer generate -w ~/.tauri/nn-anime.key
```

`tauri-action` firma el instalador NSIS y escribe `latest.json` en la release con ese secreto. Sin él,
el paso de Windows falla en vez de publicar un instalador que nadie podrá actualizar.

### Lo que no hay

- **Firma GPG de los paquetes de Linux.** El `.deb` y el `.rpm` no van firmados. `apt` lo admitirá con
  un aviso; quien quiera comprobarlos tiene el `SHA256SUMS.txt`.

## Compila GitHub, no tú

**No hace falta tener NSIS, `nfpm` ni un Mac a mano.** Cada push compila el ejecutable **y su
instalador** en las tres plataformas, y los deja descargables en la página del workflow, en
«Artifacts» (7 días):

| Artefacto | Qué lleva |
|---|---|
| `nn-anime-ubuntu-latest` | El ejecutable de Linux, el `.AppImage`, el `.deb` y el `.rpm` |
| `nn-anime-windows-latest` | El **archivo único** `nn-anime-<v>-windows-x64.exe` y el instalador NSIS de Tauri `nn-anime_<v>_x64-setup.exe` |
| `nn-anime-macos-latest` | El ejecutable de macOS y el `.dmg` de esa arquitectura |

Las herramientas que no vienen en la imagen de GitHub las prepara
`.github/actions/herramientas`: `nfpm` y `appimagetool` en Linux, **fijados por versión y por SHA256**.
Windows ya no necesita nada: el NSIS lo descarga `tauri-bundler` con la versión que fija Tauri, porque
el `.nsi` escrito a mano desapareció con T189. macOS no necesita nada: `hdiutil` y `codesign` vienen
con el sistema.

Por eso el instalador se arma también en cada push y no sólo en la release: un error en el empaquetado
de NSIS o en el `.dmg` aparece en el push que lo introdujo, que es cuando se arregla en un minuto, y no
el día de la release.

Si quieres construir en tu máquina de todos modos:

```bash
bun run build                        # la interfaz, que viaja dentro del servidor
bun run package --skip-installer     # el servidor, y lo arranca para probarlo
bun run desktop:build                # el anfitrión, con el servidor embebido (Windows)
bun run desktop:installer            # el instalador NSIS de Windows, con tauri-bundler
bun run desktop:installer --updater  # el mismo, con .sig y latest.json (necesita la clave)
bun run package:unico                # el archivo único (Windows)
```

En macOS y Linux el instalador sigue siendo `bun run package --only-installer`; en Windows ese
comando ya no existe y dice que use `desktop:installer`.

El orden **no es opcional en Windows**: `desktop/build.rs` embebe el servidor al compilar el anfitrión,
así que el servidor va primero. Si se compila al revés, `package:unico` falla con «el anfitrión es más
viejo que el servidor», y `bun run package` a secas también se niega a armar el instalador. Además,
`desktop:build` pasa `NN_ANIME_EXIGIR_SERVIDOR=1` en Windows: `build.rs` **se para** si no encuentra
el servidor, en vez de compilar un anfitrión vacío que arrancaría y enseñaría el aviso de fallo. Es
preferible un error ahí que un `.exe` que arranca sin interfaz. El único sitio que compila sin
servidor es el trabajo `desktop` del CI, con `desktop:build --sin-servidor`: mide el árbol de Rust y
no entrega nada.

`bun run package` **se niega a compilar** si falta el build de la interfaz: un ejecutable sin interfaz
arranca, contesta 404 en `/` y parece que la aplicación está rota.

**En Windows hace falta `makensis`, y no hace falta instalarlo.** NSIS tiene distribución portátil:
se baja el `.zip` de `nsis.sourceforge.io`, se descomprime donde sea y se pone su carpeta en el
`PATH` para ese comando. Medido: con NSIS 3.11 portable, `bun run package` compila el instalador sin
tocar el sistema (`choco install nsis -y` también vale, pero pide permisos y deja el programa
instalado). Sin `makensis` en el `PATH`, `bun run package` falla y lo dice con el nombre del que
falta.

**Y `makensis` necesita un temporal escribible.** Medido el 2026-10-16, compilando sólo el
instalador con `--only-installer`: con la excepción de acceso del agente concedida murió con
`Internal compiler error #12345: error creating mmap the size of 115163022`, y sin ella compiló (dos
veces, con el temporal por defecto y con `TMP`/`TEMP` dentro del workspace). Si aparece ese error,
apunta `TMP` y `TEMP` a una carpeta que exista y se pueda escribir.

## Probar sin publicar

**Actions → Release → Run workflow**, con «publish» sin marcar. Compila el archivo único y los
instaladores de las cuatro plataformas y los deja como artefactos del workflow (7 días), sin crear ni
tocar ninguna release. Es la forma de recorrer el camino entero sin gastar un número de versión — y de
tener los cuatro instaladores, incluidos los dos `.dmg`, sin un Mac.

## La primera release

El mecanismo de `release-please` necesita un tag del que partir, y hoy no hay ninguno. La primera
versión se corta a mano, **después** de que `main` tenga el trabajo y el CI esté verde:

```bash
git tag -a v0.1.0 -m "nn-anime 0.1.0"
git push origin v0.1.0
```

El tag dispara `release.yml` y publica la release con el cuerpo de `CHANGELOG.md`. A partir de ahí
`release-please` mantiene el PR de versión con cada push a `main`; fusionarlo crea el tag y el borrador,
y `release.yml` lo publica. Si `release-please` abre un PR antes de que se empuje `v0.1.0`, se cierra:
el siguiente run recalcula desde el tag.

## Qué hay dentro del ejecutable

Un solo archivo por plataforma, compilado con `bun build --compile`, que lleva dentro:

- el runtime de Bun, el servidor y `bun:sqlite`;
- la interfaz construida, incrustada con `--asset` (`packages/web/dist`);
- los archivos `.sql` de las migraciones, incrustados igual.

En **Windows** hay un paso más y es el que entrega el archivo único: el anfitrión de ventana
(`nn-anime-desktop.exe`, Rust) se compila con `build.rs`, que **incrusta el servidor** con
`include_bytes!` y guarda su SHA-256. El `.exe` que se descarga es ese anfitrión: al arrancar extrae el
servidor a `<raíz>\bin\<versión>\nn-anime.exe`, comprueba el hash y lo lanza. No hay un `nn-anime.exe`
al lado que se pueda perder ni una carpeta que haya que mantener intacta.

En **macOS y Linux**, mientras el archivo único siga siendo sólo de Windows, el anfitrión viaja **al
lado** del servidor dentro del `.dmg`, del `.deb`, del `.rpm` y del AppImage. `main.rs` lo detecta
porque `build.rs` compiló un servidor embebido vacío y usa `sidecar::sibling_path`; la ventana no
intenta extraer cero bytes. Los datos de esos paquetes van a `~/.local/share/nn-anime` —o
`XDG_DATA_HOME`—, no al directorio del ejecutable, que en un `.deb` es de root y en un AppImage está
montado en sólo lectura.

`packages/cli/src/resources.ts` los resuelve en este orden: variable de entorno
(`NN_ANIME_WEB_DIR`, `NN_ANIME_MIGRATIONS_DIR`), recurso incrustado y árbol de fuentes. Los dos
nombres con los que se incrustan —`dist` y `migrations`— son un contrato entre
`scripts/package/binary.ts` y ese archivo, y hay una prueba que los compara: `--asset` no sabe
renombrar, así que mover `packages/web/dist` rompería el ejecutable sin que nada más avisara.

## El anfitrión de ventana, y su toolchain

El anfitrión (`nn-anime-desktop`, en `desktop/src-tauri`) se compila con `cargo`; `tauri-build` lee
`tauri.conf.json` en el guion de compilación, así que `cargo build --release` produce el binario
entero. En **Windows**, además, `bun run desktop:installer` invoca el CLI de Tauri para que
`tauri-bundler` arme el instalador NSIS: es lo único que genera el `.sig` y el `latest.json` que el
updater necesita. macOS y Linux siguen con `scripts/package.ts`.

En Windows el instalador instala **sólo el anfitrión**, que lleva el servidor dentro; en macOS y Linux
viajan los dos ejecutables, como hasta ahora. El orden de compilación es un contrato:

```bash
bun run build                                   # la interfaz, que va dentro del servidor
bun run package --skip-installer                # el servidor, primero
bun run desktop:build                           # el anfitrión, con el servidor dentro
bun run desktop:installer                       # el instalador NSIS de Windows (tauri-bundler)
bun run package --only-installer                # el instalador de macOS o Linux
bun run package:unico                           # el archivo único (Windows)
```

`bun run desktop:installer` compila antes `desktop/ui/actualizacion.ts`: la ventana de
actualizaciones viaja en `frontendDist` y `tauri build` la embebe al compilar. `--updater` añade los
artefactos firmados del updater y exige `TAURI_SIGNING_PRIVATE_KEY`; el CI compila sin él.

`bun run package` a secas ya no arma el instalador de Windows —lo dice y señala `desktop:installer`—
y en macOS y Linux sigue comprobando que el anfitrión no sea más viejo que el servidor. `--skip-desktop`
sigue existiendo para compilar sin el árbol de Rust, pero sin anfitrión no hay instalador publicable.

Para la compilación cruzada —la matriz arma el `.dmg` de Intel desde un Mac arm64— se le dice el
objetivo, y el triple de Rust lo resuelve el propio comando:

```bash
bun run desktop:build --target=darwin-x64       # añade el target y compila cruzado
```

En Linux, `cargo` necesita las dependencias del webview, que no vienen en todas las imágenes:

```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev patchelf
```

El listón del árbol de Rust es **suyo** y no lo mira `bun test` —vive fuera de `packages/` a
propósito—: `bun run desktop:check` (formato, `clippy` con `-D warnings` y sus pruebas), y lo ejecuta
el trabajo `desktop` del CI en las tres plataformas.

`desktop/src-tauri/Cargo.lock` **está versionado**. Si alguna vez falta, se genera en una máquina con
red y se commitea; sin él la resolución de dependencias no es reproducible. La versión del paquete
`nn-anime-desktop` en ese archivo lleva `# x-release-please-version` en la misma línea para que el
PR de release la actualice junto con el resto; no quites ese comentario:

```bash
cargo generate-lockfile --manifest-path desktop/src-tauri/Cargo.toml
```

La firma de Windows va **por partes**: primero el servidor, después el anfitrión. `include_bytes!` copia
los bytes tal cual, así que un servidor firmado después de compilar el anfitrión no llegaría firmado al
`.exe` único. El anfitrión es el que se descarga, así que su firma es la que ve SmartScreen.

## Las herramientas de Linux

`nfpm` (los `.deb` y `.rpm`) y `appimagetool` (el AppImage) no vienen en la imagen de GitHub. Los
prepara `.github/actions/herramientas` —la misma acción compuesta para el CI y para la release— y los
descarga fijados **por versión y por SHA256**, porque la versión sola no basta: un archivo publicado
se puede reemplazar.

Para subir de versión:

```bash
gh release download vX.Y.Z --repo goreleaser/nfpm --pattern "nfpm_X.Y.Z_Linux_x86_64.tar.gz"
sha256sum nfpm_X.Y.Z_Linux_x86_64.tar.gz
```

y se actualizan la URL y el hash en `.github/actions/herramientas/action.yml`, los dos a la vez.

## Lo que falta, y por qué

- **Auto-actualización: sí, en Windows.** La aplicación consulta
  `releases/latest/download/latest.json` al arrancar y cada tres horas, y el menú de la bandeja tiene
  «Buscar actualizaciones». El instalador NSIS lo firma `tauri-bundler` con la clave del updater y
  `tauri-action` escribe el `latest.json`; sin `WINDOWS_CERT_THUMBPRINT` el instalador sale sin firmar
  de código, pero el `.sig` del updater y la verificación de la descarga no dependen de eso. El
  **archivo único portable** no se actualiza solo: avisa y enlaza a la release. En **macOS y Linux**
  todavía no hay: sus instaladores no publican bundles del updater (`darwin-*`/`linux-*`), así que el
  menú no aparece allí. Migrarlos es pasar esos instaladores a `tauri-bundler` y publicar sus `.sig`.
- **MSI en Windows: no hay.** El requisito era «`.exe` (NSIS) y/o `.msi`», y el NSIS cubre los dos
  papeles: instala, deja accesos, se desinstala y aparece en «Agregar o quitar programas». Un MSI
  pediría WiX y una instalación por máquina que necesitaría administrador para un programa que vive
  en `%LOCALAPPDATA%`.
- **Linux arm64 y Windows arm64: no se publican.** Bun los compila y añadirlos es una línea por
  plataforma, pero cada objetivo es una release que hay que poder probar.
- **El desinstalador no borra los datos.** `%LOCALAPPDATA%\nn-anime` —la base, los ajustes, los
  plugins, el servidor extraído y el perfil del webview— se queda. Desinstalar el programa no es pedir
  que se pierda eso.

### Una que no era de Bun

El icono de Windows estuvo a punto de quedarse fuera del ejecutable por un fallo que se le achacó a
Bun 1.4.3 durante dos ejecuciones del CI: `--windows-icon` escribía un ejecutable de **2,66 GB** que
Windows rechazaba, y `makensis` abortaba con «invalid icon file size».

El fallo era del generador del `.ico` de este repositorio: el tamaño y la posición de cada entrada se
escribían en **big-endian**, y el formato `.ico` los quiere en **little-endian**. Con los números del
revés, los dos programas leían un tamaño absurdo y reaccionaban como se espera de un archivo
corrupto. Al arreglarlo, el ejecutable pesa 93,6 MB, arranca, y el icono va dentro.

Queda una prueba (`scripts/package.test.ts`) que recorre el directorio del `.ico` y comprueba que las
entradas se encadenan y llenan el archivo justo, para que no vuelva. Y la lección, que es la de
siempre en este repositorio: el validador que escribí para comprobarlo repetía el mismo error —leía
en big-endian— y por eso daba por bueno un archivo que no lo estaba.

## Lo que está verificado y lo que no

Medido en la máquina donde se preparó esto:

- El ejecutable compilado arranca, sirve la interfaz y sus recursos con hash, canjea el token de
  arranque y **aplica las siete migraciones** (`schema_version = 7`).
- Las seis comprobaciones de `smoke.ts` en verde sobre el ejecutable empaquetado.
- `actionlint` con `shellcheck` sobre los tres workflows, sin avisos.
- Las dependencias del `.deb` y el `.rpm` no se suponen: se leyeron los `DT_NEEDED` del ejecutable de
  Linux —`libc.so.6`, `libm`, `libdl`, `libpthread`, todas de libc6— y su versión mínima de símbolos
  versionados, `GLIBC_2.17`, que es lo que declara el paquete. **El anfitrión añadió dos más**,
  `libwebkit2gtk-4.1-0` y `libgtk-3-0`, que son las que documenta Tauri y que **no** se han medido
  aquí: no hay un Linux donde leer sus `DT_NEEDED`.
- **El subsistema PE de los binarios de Windows**, leído de su cabecera con
  `bun run scripts/package/pe.ts <ruta> <windows|console>`: el servidor empaquetado declara `console`
  (3); el anfitrión y **el archivo único** declaran `windows` (2). Es la medición de «sin consola» que
  un CI puede hacer, y mover el desplazamiento del campo de `0x44` a `0x40` hace que el binario real
  declare `desconocido (20383)`, así que el lector está validado contra un ejecutable de verdad.

Verificado **por el CI**, que es donde se comprueba lo que no se puede comprobar aquí:

- El listón entero en Linux, macOS y Windows, y **las pruebas en los tres sistemas**.
- **Windows**: el archivo único y el instalador, y `probar-instalador.ps1` ejecutándolo de verdad:
  un solo ejecutable, el servidor extraído en `%LOCALAPPDATA%\nn-anime\bin\<versión>`, la ventana
  abierta, el loopback, la X ocultando en la bandeja y la desinstalación. La salida ordenada por
  «Salir» **no** se automatiza: el script lo dice y no finge medirla.
- **Linux**: el AppImage, el `.deb` y el `.rpm`, construidos con `nfpm` y `appimagetool`.
- **macOS**: el `.app` y el `.dmg`, con `hdiutil`.

Y verificado **en local, el 2026-10-16**, con NSIS 3.11 portable:

- **El instalador de Windows (NSIS) compila.** `bun run package` producía
  `release/nn-anime-0.1.0-windows-x64-setup.exe`: **33,24 MB**, un ejecutable de Windows válido, con
  `ProductName=nn-anime`, `FileVersion=0.1.0` y la descripción «Instalador de nn-anime» dentro —o
  sea, con los defines del `.nsi` bien cableados—, y sin un solo aviso de `makensis`.

Lo que sigue sin estar comprobado, y lo dirá el siguiente push o una release con secretos:

- **La firma de código y la notarización**: sin certificados, los pasos se saltan. Que `signtool` y
  `codesign` reciban lo que esperan no se ha podido ejecutar.
- **El cierre ordenado por «Salir»**: la bandeja es una interfaz nativa y la prueba del instalador no
  la automatiza. Se mide a mano al aceptar una release.
- **La ventana en macOS y Linux**: T161 sigue pendiente; el archivo único es sólo de Windows y estas
  plataformas conservan sus instaladores.

### El e2e falla, y no es de este cambio

La suite de extremo a extremo falla en `favorites.e2e.ts` y en `home.e2e.ts` —una prueba marca un
favorito y otra espera la lista vacía—: los dos archivos corren contra el mismo servidor y comparten
la base, así que el resultado depende del orden. Es anterior a este trabajo y no tiene que ver con el
empaquetado: el mismo commit en `main` pasa, y la rama de rediseño de la interfaz también falló igual.

Se arregla dando a cada archivo su propio servidor o su propio estado, y eso es un cambio de las
pruebas, no del empaquetado. Queda aquí anotado para que un `e2e` en rojo no parezca un fallo de la
release.

## La imagen de contenedor

`release.yml` publica también `ghcr.io/zxuru/nn-anime` con la versión de la release y `latest`, para
`linux/amd64` y `linux/arm64`. Es el mismo workflow y el mismo tag: no hay un segundo publicador que
compita por la release. El trabajo `docker` no crea ni edita una release de GitHub; sólo empuja a
GHCR, y el trabajo `publicar` depende de él para que una release no anuncie una imagen que no existe.

- **Permisos:** el trabajo pide `packages: write`. El `GITHUB_TOKEN` del repositorio basta; no hay un
  secreto nuevo que configurar.
- **Primera publicación:** el paquete aparece en la página del repositorio y su visibilidad se ajusta
  una vez en GitHub Packages. Si quieres que sea público, se cambia ahí; no depende del workflow.
- **Sin publicar:** `Actions → Release → Run workflow` con «publish» sin marcar construye la imagen
  multi-arquitectura y no la sube. Es la forma de probar el Dockerfile sin gastar un tag.
- **En cada PR:** `ci.yml` construye la imagen sólo para `linux/amd64` y la arranca contra `/healthz`,
  el 401 y el login. No publica nada.

La guía para quien despliega está en [docker.md](docker.md).
