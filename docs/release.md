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

## Probar sin publicar

**Actions → Release → Run workflow**, con «publish» sin marcar. Compila los instaladores de las cuatro
plataformas y los deja como artefactos del workflow (7 días), sin crear ni tocar ninguna release. Es
la forma de recorrer el camino entero sin gastar un número de versión.

Para probar sólo la plataforma en la que estás, en local:

```bash
bun run build            # la interfaz, que es lo que viaja dentro del ejecutable
bun run package          # ejecutable + instalador de esta plataforma, y lo arranca para probarlo
```

`bun run package` **se niega a compilar** si falta el build de la interfaz: un ejecutable sin interfaz
arranca, contesta 404 en `/` y parece que la aplicación está rota.

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

`nfpm` (los `.deb` y `.rpm`) y `appimagetool` (el AppImage) no vienen en la imagen de GitHub. El
workflow los descarga fijados **por versión y por SHA256**, porque la versión sola no basta: un
archivo publicado se puede reemplazar. Están en `.github/workflows/release.yml`.

Para subir de versión:

```bash
gh release download vX.Y.Z --repo goreleaser/nfpm --pattern "nfpm_X.Y.Z_Linux_x86_64.tar.gz"
sha256sum nfpm_X.Y.Z_Linux_x86_64.tar.gz
```

y se actualizan la URL y el hash en el workflow, los dos a la vez.

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
- **El icono no está dentro del `.exe` de Windows.** Lo lleva el instalador, y los accesos del menú
  Inicio y del escritorio lo usan; el ejecutable suelto tiene el icono por defecto. Es una decisión
  medida: `--windows-icon` de Bun 1.4.3 produce un ejecutable que Windows no arranca —con un `.ico`
  de entradas PNG escribe 2,66 GB; con uno de entradas DIB, que es el que se genera aquí, el archivo
  pesa lo que debe pero Windows contesta «la configuración en paralelo no es correcta»—. Cuando Bun
  lo arregle, devolverlo es una línea en `scripts/package/binary.ts`.
- **Linux arm64 y Windows arm64: no se publican.** Bun los compila y añadirlos es una línea por
  plataforma, pero cada objetivo es una release que hay que poder probar.
- **El desinstalador no borra los datos.** `%APPDATA%\nn-anime` y `%LOCALAPPDATA%\nn-anime` —la base,
  los ajustes y los plugins— se quedan. Desinstalar el programa no es pedir que se pierda eso.

## Lo que está verificado y lo que no

Medido en Windows, en la máquina de quien preparó esto:

- El ejecutable compilado arranca, sirve la interfaz y sus recursos con hash, canjea el token de
  arranque y **aplica las siete migraciones** (`schema_version = 7`).
- Las seis comprobaciones de `smoke.ts` en verde sobre el ejecutable empaquetado.
- `actionlint` con `shellcheck` sobre los tres workflows, sin avisos.
- Las estructuras del icono (PNG, ICO e ICNS) parseadas y comprobadas: CRC de cada chunk, directorio
  del `.ico` coherente con los PNG que lleva dentro, y longitudes del `.icns`.
- Las dependencias del `.deb` y el `.rpm` no se suponen: se leyeron los `DT_NEEDED` del ejecutable de
  Linux —`libc.so.6`, `libm`, `libdl`, `libpthread`, todas de libc6— y su versión mínima de símbolos
  versionados, `GLIBC_2.17`, que es lo que declara el paquete.

**No verificado, y hay que mirarlo en la primera release de verdad:**

- **macOS entero**: el `.app`, el `.dmg`, la firma y la notarización. No hay un Mac a mano.
- **Linux entero**: el AppImage, el `.deb` y el `.rpm`, y que `nfpm` acepte el YAML generado.
- **NSIS**: no hay `makensis` en la máquina donde se escribió el instalador de Windows, así que
  `packaging/windows/nn-anime.nsi` **no se ha compilado nunca**. Es lo primero que hay que mirar en
  CI.
- **La firma de código**: sin certificados, los pasos se saltan. Que `signtool` y `codesign` reciban
  lo que esperan no se ha podido ejecutar.
- **Las pruebas en macOS y Linux en CI**: en Windows pasan (menos diez que fallan sólo por el sandbox
  local, que impide lanzar `git` con tuberías). El primer run del CI dirá si en los otros dos
  sistemas hay algo que sólo se rompe ahí.
