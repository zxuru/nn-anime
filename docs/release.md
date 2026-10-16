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
                                  ├── instaladores: windows, macos×2, linux
                                  └── publicar: SHA256SUMS + subir al borrador + publicar
```

| Workflow | Cuándo | Qué hace |
|---|---|---|
| `ci.yml` | Cada push y cada PR | Tipos, estilo, pruebas, e2e, y el empaquetado en matriz con el ejecutable arrancado |
| `release-please.yml` | Push a `main` | Mantiene el PR de release: `CHANGELOG.md` y la versión de los diez `package.json` |
| `release.yml` | Push de un tag `v*.*.*`, o a mano | Compila los instaladores y publica la release |

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

### La versión, en un solo sitio

La raíz manda. `bun run version:check` falla si alguno de los nueve paquetes se desvió, y
`release-please` los actualiza a la vez con la lista `extra-files` de `release-please-config.json`.
Si algún día se añade un paquete a `packages/`, hay que añadirlo también ahí: hay una prueba
(`scripts/package.test.ts`) que compara las dos listas y falla si no coinciden.

`bun.lock` guarda la versión de cada workspace y **release-please no lo toca**. Comprobado: mover esas
versiones no rompe `bun install --frozen-lockfile`, así que no hace falta regenerarlo en la release.

## Secretos

Todos son **opcionales**. Sin ninguno, las builds salen sin firmar y se instalan igual, con las
advertencias del sistema que explica la sección de instalación del README. Los pasos de firma se
activan solos si el secreto existe; si no, se saltan sin fallar.

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

### Lo que no hay

- **Clave del updater.** No hay auto-actualización, así que no hay clave que configurar. Ver «lo que
  falta» más abajo.
- **Firma GPG de los paquetes de Linux.** El `.deb` y el `.rpm` no van firmados. `apt` lo admitirá con
  un aviso; quien quiera comprobarlos tiene el `SHA256SUMS.txt`.

## Compila GitHub, no tú

**No hace falta tener NSIS, `nfpm` ni un Mac a mano.** Cada push compila el ejecutable **y su
instalador** en las tres plataformas, y los deja descargables en la página del workflow, en
«Artifacts» (7 días):

| Artefacto | Qué lleva |
|---|---|
| `nn-anime-ubuntu-latest` | El ejecutable de Linux, el `.AppImage`, el `.deb` y el `.rpm` |
| `nn-anime-windows-latest` | El `nn-anime.exe` y su instalador `.exe` |
| `nn-anime-macos-latest` | El ejecutable de macOS y el `.dmg` de esa arquitectura |

Las herramientas que no vienen en la imagen de GitHub las prepara
`.github/actions/herramientas`: NSIS en Windows —y si no estuviera, lo instala—, y `nfpm` y
`appimagetool` en Linux, **fijados por versión y por SHA256**. macOS no necesita nada: `hdiutil` y
`codesign` vienen con el sistema.

Por eso el instalador se arma también en cada push y no sólo en la release: un error en el script de
NSIS o en el `.dmg` aparece en el push que lo introdujo, que es cuando se arregla en un minuto, y no
el día de la release.

Si quieres construir en tu máquina de todos modos:

```bash
bun run build            # la interfaz, que es lo que viaja dentro del ejecutable
bun run package          # ejecutable + instalador de esta plataforma, y lo arranca para probarlo
```

`bun run package` **se niega a compilar** si falta el build de la interfaz: un ejecutable sin interfaz
arranca, contesta 404 en `/` y parece que la aplicación está rota.

**En Windows hace falta `makensis`, y no hace falta instalarlo.** NSIS tiene distribución portátil:
se baja el `.zip` de `nsis.sourceforge.io`, se descomprime donde sea y se pone su carpeta en el
`PATH` para ese comando. Medido: con NSIS 3.11 portable, `bun run package` compila el instalador sin
tocar el sistema (`choco install nsis -y` también vale, pero pide permisos y deja el programa
instalado). Sin `makensis` en el `PATH`, `bun run package` falla y lo dice con el nombre del que
falta.

## Probar sin publicar

**Actions → Release → Run workflow**, con «publish» sin marcar. Compila los instaladores de las cuatro
plataformas y los deja como artefactos del workflow (7 días), sin crear ni tocar ninguna release. Es
la forma de recorrer el camino entero sin gastar un número de versión — y de tener los cuatro
instaladores, incluidos los dos `.dmg`, sin un Mac.

## Qué hay dentro del ejecutable

Un solo archivo por plataforma, compilado con `bun build --compile`, que lleva dentro:

- el runtime de Bun, el servidor y `bun:sqlite`;
- la interfaz construida, incrustada con `--asset` (`packages/web/dist`);
- los archivos `.sql` de las migraciones, incrustados igual.

`packages/cli/src/resources.ts` los resuelve en este orden: variable de entorno
(`NN_ANIME_WEB_DIR`, `NN_ANIME_MIGRATIONS_DIR`), recurso incrustado y árbol de fuentes. Los dos
nombres con los que se incrustan —`dist` y `migrations`— son un contrato entre
`scripts/package/binary.ts` y ese archivo, y hay una prueba que los compara: `--asset` no sabe
renombrar, así que mover `packages/web/dist` rompería el ejecutable sin que nada más avisara.

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

- **Auto-actualización: no hay.** Y no es un olvido. El updater de Tauri y `electron-updater` no
  existen aquí, y NSIS no trae uno propio; con este método de empaquetado, la aplicación no tiene
  forma de reemplazarse a sí misma sin código nuevo. Lo que haría falta: una ruta que consulte la API
  de Releases al arrancar, compare con `--version`, avise en Ajustes y, al aceptar, descargue el
  instalador y lo ejecute. Es una función de la aplicación, no del empaquetado, y por eso no está:
  el reparto se hizo sin tocar la lógica.
- **MSI en Windows: no hay.** El requisito era «`.exe` (NSIS) y/o `.msi`», y el NSIS cubre los dos
  papeles: instala, deja accesos, se desinstala y aparece en «Agregar o quitar programas». Un MSI
  pediría WiX y una instalación por máquina que necesitaría administrador para un programa que vive
  en `%LOCALAPPDATA%`.
- **Linux arm64 y Windows arm64: no se publican.** Bun los compila y añadirlos es una línea por
  plataforma, pero cada objetivo es una release que hay que poder probar.
- **El desinstalador no borra los datos.** `%APPDATA%\nn-anime` y `%LOCALAPPDATA%\nn-anime` —la base,
  los ajustes y los plugins— se quedan. Desinstalar el programa no es pedir que se pierda eso.

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
  versionados, `GLIBC_2.17`, que es lo que declara el paquete.

Verificado **por el CI**, que es donde se comprueba lo que no se puede comprobar aquí:

- El listón entero en Linux, macOS y Windows, y **las pruebas en los tres sistemas** (2.387 en verde).
- **Linux**: el AppImage, el `.deb` y el `.rpm`, construidos con `nfpm` y `appimagetool`.
- **macOS**: el `.app` y el `.dmg`, con `hdiutil`.

Y verificado **en local, el 2026-10-16**, con NSIS 3.11 portable:

- **El instalador de Windows (NSIS) compila.** `bun run package` sin `--skip-installer` produce
  `release/nn-anime-0.1.0-windows-x64-setup.exe`: **33,24 MB**, un ejecutable de Windows válido, con
  `ProductName=nn-anime`, `FileVersion=0.1.0` y la descripción «Instalador de nn-anime» dentro —o
  sea, con los defines del `.nsi` bien cableados—, y sin un solo aviso de `makensis`. La primera vez
  que se compila este archivo. Antes de esto, la frase que había aquí —«no se ha compilado nunca»—
  era cierta y ya no lo es.

Lo que sigue sin estar comprobado, y lo dirá el siguiente push o una release con secretos:

- **Ejecutar el instalador**: instalarlo en silencio, mirar que deja los accesos del escritorio y del
  menú y su entrada en «Agregar o quitar programas», y desinstalarlo. **No se ha podido hacer en la
  máquina donde se compiló**: el instalador, lanzado en silencio, se queda colgado sin escribir nada
  ni dejar rastro —ni directorio, ni accesos, ni registro—, así que parece necesitar una sesión
  interactiva. Es lo que le toca al CI, donde el runner de Windows sí la tiene: el paso que falta es
  instalarlo con `/S /D=<carpeta temporal>`, comprobar los accesos y el registro, arrancar el
  ejecutable instalado y desinstalarlo. Las líneas que eso comprueba están en
  `packaging/windows/nn-anime.nsi` (`CreateShortCut "$DESKTOP…"`, los `WriteRegStr` y la sección
  `Uninstall`).
- **La firma de código y la notarización**: sin certificados, los pasos se saltan. Que `signtool` y
  `codesign` reciban lo que esperan no se ha podido ejecutar.

### El e2e falla, y no es de este cambio

La suite de extremo a extremo falla en `favorites.e2e.ts` y en `home.e2e.ts` —una prueba marca un
favorito y otra espera la lista vacía—: los dos archivos corren contra el mismo servidor y comparten
la base, así que el resultado depende del orden. Es anterior a este trabajo y no tiene que ver con el
empaquetado: el mismo commit en `main` pasa, y la rama de rediseño de la interfaz también falló igual.

Se arregla dando a cada archivo su propio servidor o su propio estado, y eso es un cambio de las
pruebas, no del empaquetado. Queda aquí anotado para que un `e2e` en rojo no parezca un fallo de la
release.
