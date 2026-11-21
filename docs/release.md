# Publicar una release

Cómo sale una versión de rona: qué hace cada workflow, qué secretos hay que configurar, cómo
probarlo todo sin publicar, y **qué no está probado** todavía.

El resumen para el día a día está en el [README](../README.md#cómo-publicar-una-release-para-mantenedores).
Aquí está el detalle.

## El camino, de un commit a un artefacto portable

```
main ──► release-please ──► PR de release ──► merge ──► tag vX.Y.Z + release EN BORRADOR
                                                              │
                                                              ▼
                                  release.yml (lo lanza release-please con workflow_dispatch)
                                  ├── comprobar: listón + tag == package.json
                                  ├── portables: servidor → anfitrión → .exe único + .sig + latest.json
                                  │              (windows), .zip del .app (macos×2) o AppImage (linux)
                                  └── publicar: SHA256SUMS + subir y publicar
```

No hay `tauri-action`: cada plataforma compila su artefacto y lo sube como artefacto del workflow. El
trabajo de Windows firma el `.exe` con `bun tauri signer` y escribe el `.sig` y el `latest.json` del
updater; `publicar` junta todos los artefactos, calcula el `SHA256SUMS.txt`, los sube al borrador y lo
publica. Antes de publicar comprueba que `latest.json` anuncia `windows-x86_64` y
`windows-x86_64-portable` con url y firma: una release sin eso se ve bien y deja a todos los clientes
sin actualizar.

| Workflow | Cuándo | Qué hace |
|---|---|---|
| `ci.yml` | Cada PR y cada entrada de la merge queue; **no** en `push` | Tipos, estilo, pruebas, e2e, y el empaquetado en matriz con el ejecutable arrancado y el `.exe` único de Windows |
| `release-please.yml` | Push a `main` | Mantiene el PR de release: `CHANGELOG.md` y la versión de los diez `package.json` |
| `release.yml` | `workflow_dispatch` desde `release-please.yml` sobre el tag recién creado (y `push` de un tag `v*.*.*` empujado con credenciales de una persona); a mano para probar sin publicar | Compila el archivo único y los artefactos portables, y publica la release. **Es el único publicador** |

`desktop.yml` ya no existe. Nació para construir y publicar el `.exe` único por su cuenta y competía
con `release.yml` por el mismo tag; ahora `ci.yml` lo construye en cada PR y `release.yml` es el
único que crea o modifica una release.

### Un ajuste que hay que hacer una vez

**Settings → Actions → General → Workflow permissions**: marca
**«Allow GitHub Actions to create and approve pull requests»**.

Sin eso, el `GITHUB_TOKEN` no puede abrir el PR de release y `release-please` falla. Es el único
ajuste del repositorio que hace falta; el resto es cosa de los secretos, que son opcionales.

### Por qué la release nace en borrador

`release-please-config.json` tiene `draft: true` y `force-tag-creation: true`, y las dos hacen falta:

- **`draft`**: la release se crea en borrador, así nadie ve una release a la que todavía le faltan
  los artefactos. El workflow la publica cuando ya están los de Windows, macOS y Linux.
- **`force-tag-creation`**: GitHub no crea el tag de una release en borrador hasta que se publica. Sin
  esto, el tag no existiría, el `workflow_dispatch` de `release-please.yml` no tendría `--ref` al que
  apuntar y la release se quedaría en borrador para siempre.

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
de la versión del paquete `rona-desktop` lleva el comentario `x-release-please-version`, que es
lo que le dice a release-please qué número reemplazar. Hace falta porque `desktop:build` compila con
`--locked`: si el lock se queda en la versión anterior, `cargo` se niega a actualizarlo y **los
cuatro artefactos fallan antes de compilar**. Pasó al publicar `0.3.0`; la anotación y la entrada de
la lista son la corrección.

`bun.lock` guarda la versión de cada workspace y **release-please no lo toca**. Comprobado: mover esas
versiones no rompe `bun install --frozen-lockfile`, así que no hace falta regenerarlo en la release.

## Secretos

Los de **firma de código** son opcionales: sin ellos, las builds salen sin firmar y se ejecutan
igual, con las advertencias del sistema que explica la sección de instalación del README. El del
**updater** no lo es: sin él no se puede firmar el `.exe` ni escribir `latest.json`, y la release
falla en vez de publicar un cliente que no se puede actualizar. Los pasos de firma de código se
activan solos si el secreto existe. Cuando falta la clave, el job `publicar` deja un `::warning::`
con el nombre del secreto antes de comprobar los assets: el borrador que se queda sin publicar no
es un fallo de compilación.

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

Sin los cinco, el `.zip` del `.app` sale **sin firmar y sin notarizar**, y quien lo descargue verá el
aviso de «desarrollador no identificado» y la aplicación quedará en cuarentena: los pasos para abrirla
están en el README, y son los mismos que repite la ventana de actualizaciones.

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
bun tauri signer generate -w ~/.tauri/RoNa.key
```

`bun tauri signer sign` firma el `.exe` único con ese secreto, y `scripts/package/portable-manifest.ts`
escribe `latest.json` a partir de la firma. Sin él, el paso de Windows falla en vez de publicar un
`.exe` que nadie podrá actualizar.

### Qué ve quien descarga una release sin firmar

La firma de código es condicional y la del updater no: sin los certificados la release **se publica
igualmente, sin firmar**, y el sistema enseña su aviso. Esto es lo que se encuentra quien descarga:

| Plataforma | Qué publica | Qué aviso ve |
|---|---|---|
| Windows | El `.exe` único | SmartScreen: «desarrollador no verificado». Se abre en «Más información → Ejecutar de todas formas» |
| macOS | El `.zip` del `.app` | Gatekeeper, la primera vez: «desarrollador no identificado» y cuarentena. Botón derecho → Abrir, o Ajustes del Sistema → Privacidad y seguridad |
| Linux | El AppImage | No va firmado; se comprueba con el `SHA256SUMS.txt` |

El aviso es de que nadie ha pagado un certificado, no de que el archivo esté mal, y no cambia lo que
se descarga: la firma minisign del updater se verifica igual y es la que impide reemplazar el
ejecutable por uno que no venga de esta release. La ventana de actualizaciones repite esta nota, para
que no aparezca por primera vez al ejecutar el archivo descargado.

### Lo que no hay

- **Firma GPG de los artefactos de Linux.** El AppImage no va firmado. Quien quiera comprobarlo tiene
  el `SHA256SUMS.txt`.

## Compila GitHub, no tú

**No hace falta un Mac ni ninguna herramienta de empaquetado a mano.** Cada **PR que toca código**
compila el ejecutable y, cuando toca el empaquetado, el AppImage; `release.yml` añade macOS y el
`.exe` único. Los artefactos quedan descargables en la página del workflow, en «Artifacts» (7 días):

| Artefacto | Quién lo sube | Qué lleva |
|---|---|---|
| `rona-ubuntu-latest` | `ci.yml` | El ejecutable de Linux y, si cambió el empaquetado, el AppImage |
| `rona-windows-latest` | `ci.yml`, sólo cuando cambia el empaquetado o el árbol de Rust | El **archivo único** `rona-<v>-windows-x64.exe` |
| `portables-windows-x64` | `release.yml` | El `.exe` único y, con la clave del updater, su `.sig` y `latest.json` |
| `portables-darwin-arm64` y `portables-darwin-x64` | `release.yml` | Un `.zip` del `.app` por arquitectura |
| `portables-linux-x64` | `release.yml` | El AppImage |

No hay un artefacto `rona-macos-*`: macOS **no** se compila en el CI por defecto —sus minutos se
cuentan por diez y su `.zip` se mide donde se firma—. Para devolverlo a la matriz de `empaquetado` en
un PR está la variable `CI_MACOS_EN_PR=true`; los dos `.zip` de la release salen siempre de
`release.yml`.

Sólo `appimagetool` no viene en la imagen de GitHub: lo prepara `.github/actions/herramientas`,
fijado **por versión y por SHA256**. Windows y macOS no necesitan nada: la copia del `.exe` y la
firma las hace `bun tauri signer`, y `ditto`, `codesign` y `xcrun` vienen con macOS.

Por eso el artefacto se arma también en cada PR que toca el empaquetado y no sólo en la release: un
error en el `AppRun` o en la compilación del anfitrión aparece en el PR que lo introdujo, que es
cuando se arregla en un minuto, y no el día de la release.

Si quieres construir en tu máquina de todos modos:

```bash
bun run build                        # la interfaz, que viaja dentro del servidor
bun run package --solo-ejecutable    # el servidor, y lo arranca para probarlo
bun run desktop:build                # el anfitrión, con el servidor embebido (Windows)
bun run package:unico                # el archivo único (Windows)
bun run package --solo-artefacto     # el AppImage o el .zip, con el anfitrión ya compilado
```

El orden **no es opcional en Windows**: `desktop/build.rs` embebe el servidor al compilar el
anfitrión, así que el servidor va primero. Si se compila al revés, `package:unico` falla con «el
anfitrión es más viejo que el servidor». Además, `desktop:build` pasa `RONA_EXIGIR_SERVIDOR=1` en
Windows: `build.rs` **se para** si no encuentra el servidor, en vez de compilar un anfitrión vacío que
arrancaría y enseñaría el aviso de fallo. Es preferible un error ahí que un `.exe` que arranca sin
interfaz. El CI compila el anfitrión **con** servidor en el trabajo `empaquetado`, y el listón de
Rust (`desktop:check`) corre en ese mismo trabajo: un cambio en `desktop/` ya no compila Tauri dos
veces.

`bun run package` **se niega a compilar** si falta el build de la interfaz: un ejecutable sin interfaz
arranca, contesta 404 en `/` y parece que la aplicación está rota.

## Probar sin publicar

**Actions → Release → Run workflow**, con «publish» sin marcar. Compila el archivo único, los dos
`.zip` de macOS y el AppImage, y los deja como artefactos del workflow (7 días), sin crear ni tocar
ninguna release. Es la forma de recorrer el camino entero sin gastar un número de versión — y de
tener los dos `.zip` de macOS sin un Mac.

## El tag no se crea a mano

`release-please` necesita un tag del que partir, y el repositorio ya tiene historial: la 0.9.0 está
en `CHANGELOG.md` y `origin/main` va por la 0.10.0, sólo con la subida de versión. No hay que crear
ningún tag: `release-please` abre su PR, y al fusionarlo crea el tag y lanza `release.yml` con
`workflow_dispatch`. Crear el tag a mano se saltaría el PR de release; el camino manual existía
cuando no había ningún tag del que partir.

El tag que se empuja con credenciales de una persona **sí** dispara `release.yml` por el evento
`push`, pero es una salida de emergencia, no el camino normal: no hay PR de release ni changelog
generado por `release-please`. El workflow crea el borrador si no existe y usa la sección del
`CHANGELOG.md` que ya esté en el árbol.

## Cuando la release se queda en borrador

Un borrador con el tag creado y **cero assets** significa que `release.yml` arrancó y no pasó del
primer trabajo: `comprobar` corta la cadena y `portables`, `docker` y `publicar` quedan saltados.
Pasó con la `0.8.0`.

El diagnóstico empieza por el run del tag, no por la release:

```bash
gh run list --workflow=release.yml --limit 5
gh run view <id> --json jobs --jq '.jobs[] | {name, conclusion}'
```

Si el que falla es `comprobar`, el responsable es el listón —tipos, estilo, `bun audit` o
`bun test`—, no el empaquetado. Lo primero es **volver a lanzar lo que falló**, que no toca nada:

```bash
gh run rerun <id> --failed
```

Y el tag, mejor no moverlo: **mover el tag de un borrador lo desvincula** (ver abajo) y crea un
segundo problema encima del primero.

### El listón no puede depender de la red

La `0.8.0` se atascó porque un test salía a internet. `createApp` monta el catálogo de AniList en
línea salvo que se le diga lo contrario, y la búsqueda retiene el `done` del SSE hasta que la
búsqueda cruzada contesta o vence `ANILIST_CROSS_TIMEOUT_MS` (3 s). El test de la caché de búsqueda
tardaba entre 0,6 y 3 s por consulta en vez de milisegundos y, en el runner, rozó el plazo de 5 s de
`bun test`:

- Medido en local, la misma petición tarda **1-5 ms con `anilistOffline: true`** y **650-2000 ms
  sin él**. El arreglo fue pasar `anilistOffline: true` en los `createApp` de esos tests.
- La regla: **ninguna prueba de `comprobar` sale a la red**. Si una ruta puede hablar con un
  tercero, la prueba le pasa un `fetch` falso o apaga el tercero. Un test que depende de la latencia
  de AniList tumba una release de forma no reproducible.

### Mover el tag desvincula el borrador

La `0.8.0` se atascó, se arregló el test, y al re-apuntar el tag `v0.8.0` al commit corregido
apareció un segundo fallo, ya en Windows: `tauri-action` decía «Looking for a draft release with tag
v0.8.0…» y no la encontraba, intentaba crear otro release y moría en `"releaseName" not set but
required to create release` y `##[error]Release not found or created.`.

El mismo commit de la acción había publicado la `0.7.0` sin problema («Found draft release… on the
release list»): el bump de dependabot sólo cambió el pin de la etiqueta anotada `v1` a su commit, el
mismo código. Lo que cambió fue **el tag**: al moverlo, GitHub desvinculó el borrador y le puso
nombre de tag `untagged-<sha>`. El listado de releases **sí devuelve borradores**; lo que no
devolvía era una release con `tag_name == "v0.8.0"`. Una sonda con el token del workflow lo enseñó
tal cual:

```
441048948   untagged-a92afb0a6a8114e6d1cb   true     ← el borrador, con el tag perdido
429459086   v0.7.0                          false
```

Con `releaseDraft: true` la acción no acepta encontrarlo publicado: con el listado vacío intenta
crear otro release para el mismo tag y falla. Se arregla **re-enlazándolo**, que sí puede hacerse
por id aunque el tag no aparezca:

```bash
gh api -X PATCH repos/zxuru/nn-anime/releases/<id> \
  -f tag_name=vX.Y.Z -f target_commitish=<sha>
```

Ya no hay `tauri-action` que dependa de encontrar el borrador: los trabajos `portables` sólo suben
artefactos del workflow, y `publicar` resuelve el borrador **por id** con `gh api`. Si no existe, lo
crea; si ya hay uno publicado para el tag, falla en vez de tocar una release publicada.

### Recuperar el borrador

Con el arreglo en `main` y el listón verde:

```bash
# 1. Si el borrador se desvinculó al mover el tag, se vuelve a enlazar por id.
gh api "repos/zxuru/nn-anime/releases?per_page=100" \
  --jq '.[] | select(.draft) | [.id, .tag_name] | @tsv'
gh api -X PATCH repos/zxuru/nn-anime/releases/<id> \
  -f tag_name=vX.Y.Z -f target_commitish=<sha>

# 2. Y se relanza la release: lo que falló, o el run entero.
gh run rerun <id> --failed
```

Mover el tag **también dispara `release.yml`** si lo empuja una persona —un tag creado con
`GITHUB_TOKEN` no dispara nada—, pero cuesta el paso 1 otra vez y una release en vuelo; si hay un
run que sólo falló en un trabajo, `gh run rerun --failed` es lo barato. Con una release ya publicada
no se toca ni el tag ni el borrador: se lanza una versión nueva.

Lo que queda por comprobar es lo mismo de siempre: que la release no siga en borrador, que estén
todos los assets y que `latest.json` anuncie `windows-x86_64` y `windows-x86_64-portable` con url y
firma. El propio trabajo `publicar` lo verifica antes de dar la release por publicada; si algo falta,
el run sale en rojo y la release se queda en borrador, que es el estado honesto.

## Qué hay dentro del ejecutable

Un solo archivo por plataforma, compilado con `bun build --compile`, que lleva dentro:

- el runtime de Bun, el servidor y `bun:sqlite`;
- la interfaz construida, incrustada con `--asset` (`packages/web/dist`);
- los archivos `.sql` de las migraciones, incrustados igual.

En **Windows** hay un paso más y es el que entrega el archivo único: el anfitrión de ventana
(`rona-desktop.exe`, Rust) se compila con `build.rs`, que **incrusta el servidor** con
`include_bytes!` y guarda su SHA-256. El `.exe` que se descarga es ese anfitrión: al arrancar extrae el
servidor a `<raíz>\bin\<versión>\rona.exe`, comprueba el hash y lo lanza. No hay un `rona.exe`
al lado que se pueda perder ni una carpeta que haya que mantener intacta.

En **macOS y Linux**, mientras el archivo único siga siendo sólo de Windows, el anfitrión viaja **al
lado** del servidor dentro del `.app` (comprimido en un `.zip`) y del AppImage. `main.rs` lo detecta
porque `build.rs` compiló un servidor embebido vacío y usa `sidecar::sibling_path`; la ventana no
intenta extraer cero bytes. Los datos de esos artefactos van a `~/.local/share/RoNa` —o
`XDG_DATA_HOME`—, no al directorio del ejecutable, que dentro de un AppImage está montado en sólo
lectura.

`packages/cli/src/resources.ts` los resuelve en este orden: variable de entorno
(`RONA_WEB_DIR`, `RONA_MIGRATIONS_DIR`), recurso incrustado y árbol de fuentes. Los dos
nombres con los que se incrustan —`dist` y `migrations`— son un contrato entre
`scripts/package/binary.ts` y ese archivo, y hay una prueba que los compara: `--asset` no sabe
renombrar, así que mover `packages/web/dist` rompería el ejecutable sin que nada más avisara.

## El anfitrión de ventana, y su toolchain

El anfitrión (`rona-desktop`, en `desktop/src-tauri`) se compila con `cargo`; `tauri-build` lee
`tauri.conf.json` en el guion de compilación, así que `cargo build --release` produce el binario
entero. En **Windows**, `package:unico` copia ese anfitrión —que lleva el servidor dentro— con el
nombre que se descarga; la firma minisign y `latest.json` los arma el workflow con `bun tauri signer`
y `scripts/package/portable-manifest.ts`. macOS y Linux usan `scripts/package.ts` para el `.zip` del
`.app` y para el AppImage.

En Windows el `.exe` lleva el servidor dentro; en macOS y Linux viajan los dos ejecutables. El orden de
compilación es un contrato:

```bash
bun run build                        # la interfaz, que va dentro del servidor
bun run package --solo-ejecutable    # el servidor, primero
bun run desktop:build                # el anfitrión, con el servidor dentro
bun run package:unico                # el archivo único (Windows)
bun run package --solo-artefacto     # el AppImage o el .zip (macOS y Linux)
```

`desktop:build` compila antes `desktop/ui/actualizacion.ts`: la ventana de actualizaciones viaja en
`frontendDist` y `tauri-build` la embebe al compilar.

`bun run package` a secas en Windows sólo compila el servidor y dice que el archivo único lo arma
`package:unico`; en macOS y Linux comprueba que el anfitrión no sea más viejo que el servidor.

Para la compilación cruzada —la matriz arma el `.zip` de Intel desde un Mac arm64— se le dice el
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
el trabajo `empaquetado` del CI cuando cambia `desktop/`: Linux y Windows por defecto, macOS sólo con
`CI_MACOS_EN_PR=true`.

`desktop/src-tauri/Cargo.lock` **está versionado**. Si alguna vez falta, se genera en una máquina con
red y se commitea; sin él la resolución de dependencias no es reproducible. La versión del paquete
`rona-desktop` en ese archivo lleva `# x-release-please-version` en la misma línea para que el
PR de release la actualice junto con el resto; no quites ese comentario:

```bash
cargo generate-lockfile --manifest-path desktop/src-tauri/Cargo.toml
```

La firma de Windows va **por partes**: primero el servidor, después el anfitrión. `include_bytes!` copia
los bytes tal cual, así que un servidor firmado después de compilar el anfitrión no llegaría firmado al
`.exe` único. El anfitrión es el que se descarga, así que su firma es la que ve SmartScreen.

## La herramienta de Linux

`appimagetool`, que produce el AppImage, no viene en la imagen de GitHub. Lo prepara
`.github/actions/herramientas` —la misma acción compuesta para el CI y para la release— y lo descarga
fijado **por versión y por SHA256**, porque la versión sola no basta: un archivo publicado se puede
reemplazar.

Para subir de versión:

```bash
gh release download vX.Y.Z --repo AppImage/appimagetool --pattern "appimagetool-x86_64.AppImage"
sha256sum appimagetool-x86_64.AppImage
```

y se actualizan la URL y el hash en `.github/actions/herramientas/action.yml`, los dos a la vez.

## Lo que falta, y por qué

- **Auto-actualización: sí, en Windows.** La aplicación consulta
  `releases/latest/download/latest.json` **una vez, al arrancar**, y el menú de la bandeja tiene
  «Buscar actualizaciones». No descarga nada hasta que se acepta en la ventana. El workflow firma el
  `.exe` único con `bun tauri signer` y escribe el `latest.json` con
  `scripts/package/portable-manifest.ts`; sin `WINDOWS_CERT_PFX_BASE64` el `.exe` sale sin firmar de
  código, pero el `.sig` del updater y la verificación de la descarga no dependen de eso.
  - **El `.exe` único se auto-reemplaza.** La aplicación descarga ese `.exe`, verifica la firma
    minisign, aparta el que está corriendo, pone el nuevo y lo arranca; el nuevo espera a que el viejo
    muera y borra el `.viejo`. Si el medio es de sólo lectura o el reemplazo falla, se revierte y se
    enseña el enlace.
  - **Sin instaladores no hay reserva.** Si la release no trae `windows-x86_64-portable`, no hay nada
    que descargar: la ventana lo dice y deja el enlace a la release.
  - **Un manifiesto que no existe no se calla.** Si la comprobación falla por el manifiesto —el
    endpoint apunta a un repositorio que ya no existe, la release no lo publica, la firma no cuadra—
    la ventana se enseña también al arrancar, con el motivo y el enlace a la release: reintentar no
    lo arregla. Un fallo de red sólo va al registro, porque sin conexión la aplicación ya lo cuenta.
  - **macOS y Linux no tienen actualización automática, y la ventana lo dice.** `latest.json` sólo
    anuncia `windows-*`, así que allí no se consulta el updater (`check()` no se llama): la ventana
    de actualizaciones existe, se abre desde «Buscar actualizaciones» y cuenta el límite con el
    enlace a la release para descargar el `.zip` o el AppImage a mano. Publicar sus entradas
    (`darwin-*`/`linux-*`) con firma es el cambio que la activaría; sin ellas, un manifiesto las
    anunciaría y la descarga no existiría.
- **Linux arm64 y Windows arm64: no se publican.** Bun los compila y añadirlos es una línea por
  plataforma, pero cada objetivo es una release que hay que poder probar.
- **Los datos no viajan en el ejecutable.** `%LOCALAPPDATA%\rona-data` —la base, los ajustes, los
  plugins, el servidor extraído y el perfil del webview— se queda al mover, borrar o actualizar el
  `.exe`.

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
  arranque y **aplica todas las migraciones del árbol** (`packages/catalog-store/src/migrations/`,
  desde `0001-initial` hasta la última; `schema_version` queda en esa última).
- Las seis comprobaciones de `smoke.ts` en verde sobre el ejecutable empaquetado.
- `actionlint` con `shellcheck` sobre los tres workflows, sin avisos.
- **El subsistema PE de los binarios de Windows**, leído de su cabecera con
  `bun run scripts/package/pe.ts <ruta> <windows|console>`: el servidor empaquetado declara `console`
  (3); el anfitrión y **el archivo único** declaran `windows` (2). Es la medición de «sin consola» que
  un CI puede hacer, y mover el desplazamiento del campo de `0x44` a `0x40` hace que el binario real
  declare `desconocido (20383)`, así que el lector está validado contra un ejecutable de verdad.

Verificado **por el CI**, que es donde se comprueba lo que no se puede comprobar aquí:

- El listón entero (tipos, estilo, auditoría, pruebas y cobertura) en **Linux**, y las pruebas
  también en **Windows**. macOS **no** entra en el CI por defecto: sus rutas son las de Linux, su
  árbol de Rust sólo se puede devolver con `CI_MACOS_EN_PR=true` y sus dos `.zip` se miden en
  `release.yml`, que es donde se firman.
- **Windows**: el archivo único, su etiqueta de integridad y su ACL. El `.exe` es una copia del
  anfitrión, así que la firma de código y el subsistema PE se miden sobre el archivo que se descarga.
- **Linux**: el AppImage, construido con `appimagetool`.
- **macOS**: el `.app` comprimido en `.zip`, con `ditto`, en `release.yml`.

Lo que sigue sin estar comprobado, y lo dirá el siguiente PR o una release con secretos:

- **La firma de código y la notarización**: sin certificados, los pasos se saltan. Que `signtool`,
  `codesign` y `notarytool` reciban lo que esperan no se ha podido ejecutar.
- **El cierre ordenado por «Salir»**: la bandeja es una interfaz nativa y no se automatiza. Se mide a
  mano al aceptar una release.
- **La ventana en macOS y Linux**: T161 sigue pendiente; el archivo único es sólo de Windows y estas
  plataformas entregan el `.zip` y el AppImage. La ventana de actualizaciones se compila y se crea
  allí, pero lo que enseña —que no hay actualización automática y el enlace a la release— no se ha
  ejecutado en un Mac ni en un Linux desde este repositorio.

### El e2e falla, y no es de este cambio

La suite de extremo a extremo falla en `favorites.e2e.ts` y en `home.e2e.ts` —una prueba marca un
favorito y otra espera la lista vacía—: los dos archivos corren contra el mismo servidor y comparten
la base, así que el resultado depende del orden. Es anterior a este trabajo y no tiene que ver con el
empaquetado: el mismo commit en `main` pasa, y la rama de rediseño de la interfaz también falló igual.

Se arregla dando a cada archivo su propio servidor o su propio estado, y eso es un cambio de las
pruebas, no del empaquetado. Queda aquí anotado para que un `e2e` en rojo no parezca un fallo de la
release.

## La imagen de contenedor

`release.yml` publica también `ghcr.io/zxuru/rona` con la versión de la release y, si no es un
prerelease, `latest`, para `linux/amd64` y `linux/arm64`. Es el mismo workflow y el mismo tag: no hay
un segundo publicador que compita por la release. El trabajo `docker` no crea ni edita una release de
GitHub; sólo empuja a GHCR, y el trabajo `publicar` depende de él para que una release no anuncie una
imagen que no existe.

- **Permisos:** el trabajo pide `packages: write`. El `GITHUB_TOKEN` del repositorio basta; no hay un
  secreto nuevo que configurar.
- **Primera publicación:** el paquete aparece en la página del repositorio y su visibilidad se ajusta
  una vez en GitHub Packages. Si quieres que sea público, se cambia ahí; no depende del workflow.
- **Sin publicar:** `Actions → Release → Run workflow` con «publish» sin marcar construye la imagen
  multi-arquitectura y no la sube. Es la forma de probar el Dockerfile sin gastar un tag.
- **En cada PR:** `ci.yml` construye la imagen sólo para `linux/amd64` y la arranca contra `/healthz`,
  el 401 y el login. No publica nada.

La guía para quien despliega está en [docker.md](docker.md).
