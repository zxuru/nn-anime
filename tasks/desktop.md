# Plan de tareas: la ventana propia (Tauri) y la primera release

Spec: `docs/specs/SPEC-desktop.md` · Estado: **aprobado** por el humano el 2026-10-16
Origen: la petición de que la aplicación sea instalable o portable, se descargue fácilmente y
funcione sin que nadie sepa usar una terminal ni tenga Bun instalado. El reparto ya existe
(`scripts/package.ts`, `packaging/`, `release.yml`); lo que falta es **la ventana** y **publicar**.

Estudio previo: `docs/estudio-tauri.md` · Propuesta de contrato: promovida a `docs/specs/SPEC-desktop.md`.

Rige el mismo **Definition of Done** de `tasks/plan.md`: `typecheck`, `lint` y `bun test` en verde,
criterios marcados y medidos, sin `any` ni `@ts-ignore` ni `as` para silenciar, sin tests saltados,
tope de cinco archivos de implementación por task y commit atómico que cita el task.

## La base de estas ramas, y por qué no es `main`

**T134 —la línea `NN_ANIME_BOOT` y el cierre por `stdin`— es dependencia dura del anfitrión y está en
`dev`, no en `main`.** `dev` es además la línea de integración activa (T143–T152 se fusionaron ahí).
Por eso las ramas de este plan se cortan de `dev`, y no de `main` como hace `scripts/agente.ts`.
Integrar en `main` es un paso propio, con el trabajo de `dev` delante, y lo hace el integrador.

## Architecture Decisions

1. **El anfitrión vive en `desktop/`, fuera de `packages/`.** `scripts/workspaces.test.ts` afirma
   «nueve paquetes» y `tsconfig.json` sólo mira `packages/*/src`, `scripts/**` y `tests/**`: el árbol
   de Rust queda invisible a `tsc`, a `bun test` y a Vite sin tocar ninguno de los tres.
2. **Se conserva el empaquetado que ya está probado.** El anfitrión viaja **al lado** del ejecutable
   de consola, no con `externalBin`: incrustarlo duplicaría 93,8 MB por plataforma y dejaría una sola
   pieza donde hoy hay una probada.
3. **La ventana carga el origen local, nunca `tauri://`.** Es lo que conserva la cookie
   `HttpOnly; SameSite=Strict`, los guards de `Host` y `Origin`, la CSP y los tickets de `/stream`
   sin abrir una excepción en ningún guard.
4. **El `stdout` del sidecar se drena y se descarta; el `stderr` va a un archivo.** La URL humana y
   la línea de arranque llevan **las dos** el token, y escribirlas a disco contradiría el *Never* de
   `SPEC-cli-launcher.md`. La propuesta de T135 decía «la salida del hijo va a un archivo»: se
   corrige en `SPEC-desktop.md`.
5. **El anfitrión no arregla nada del producto.** No fija puerto, ni rutas de datos, ni idioma: si lo
   hiciera, la ventana y `bun run start` usarían bases distintas.
6. **El árbol de Rust tiene su propio listón** (`bun run desktop:check`), ejecutado por el CI. Un
   módulo que `bun test` no mira no puede quedarse sin nadie que lo mida.

## T153 — El contrato del módulo `desktop` y las guardas del tooling

**Descripción:** Promover la propuesta a spec aprobado, declarar el módulo en el mapa de capacidades
y dejar el árbol de Rust fuera del alcance de biome y de git.

**Aceptación:**
- [x] `docs/specs/SPEC-desktop.md` existe, con el módulo, el contrato corregido, los criterios y los
      riesgos.
- [x] `docs/specs/CAPABILITY-MAP.md` lista `desktop` como módulo, con su dependencia y su árbol.
- [x] `docs/specs/proposals/SPEC-desktop.T135.md` se borra **en el mismo commit** que lo integra.
- [x] `.gitignore` ignora `desktop/src-tauri/target/` y `desktop/src-tauri/gen/`.
- [x] `biome.json` no mira `desktop/`, para que `bun run lint` no reformatee JSON generado.
- [x] `desktop/stub/index.html` existe: es el `frontendDist` de relleno que `tauri build` exige
      aunque la ventana cargue una URL externa. **No se llama `dist/`**: `.gitignore` ignora ese
      nombre en cualquier nivel.
- [x] `tasks/desktop.md` es el plan de T153–T162.

**Verificación:** `bun run typecheck` 0 · `bun run lint` 0 · `bun test` con la misma línea base.
No hay código que mutar: es un contrato y sus guardas.

**Depende de:** ninguno.
**Archivos:** `docs/specs/SPEC-desktop.md`, `docs/specs/CAPABILITY-MAP.md`, `docs/specs/proposals/SPEC-desktop.T135.md`
(borrado), `.gitignore`, `biome.json`, `desktop/stub/index.html`, `tasks/desktop.md`.
**Tamaño:** S.

---

## T154 — `desktop`: el árbol Tauri, el sidecar y la línea de arranque

**Descripción:** El anfitrión arranca el servidor que ya existe, lee su dirección y falla con un
diálogo si no la anuncia.

**Aceptación:**
- [ ] `desktop/src-tauri/` con `Cargo.toml`, `Cargo.lock` **versionado**, `tauri.conf.json`,
      `capabilities/default.json` **vacío** y `src/{main,sidecar,boot_line}.rs`.
- [ ] El sidecar se lanza como **hermano** con sólo `--no-open`, y en Windows con
      `CREATE_NO_WINDOW`.
- [ ] `stdout` se drena en un hilo y **no se escribe en disco**; `stderr` va a
      `<caché>/nn-anime/desktop.log`.
- [ ] `boot_line.rs` analiza `NN_ANIME_BOOT` con el prefijo literal y JSON, y **rechaza** una línea
      mal formada en vez de arrancar con una dirección a medias.
- [ ] Sin línea en **30 s**: diálogo con la cola de `stderr` y salida 1.
- [ ] `scripts/package/desktop.ts` compila el anfitrión y lo deja en el directorio de trabajo del
      paquete; `scripts/desktop.test.ts` lo comprueba.
- [ ] `bun run desktop:check` (`cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test`) y un
      job de CI que lo ejecuta en las tres plataformas.

**Verificación:** `bun run desktop:check` 0 en Windows · `cargo test` de `boot_line` con la línea
buena, con el prefijo sin espacio y con JSON roto · mutación: aceptar cualquier línea con el prefijo
hace fallar 2.

**Depende de:** T153.
**Archivos:** `desktop/src-tauri/{Cargo.toml,Cargo.lock,tauri.conf.json,capabilities/default.json}`,
`desktop/src-tauri/src/{main,sidecar,boot_line}.rs`, `scripts/package/desktop.ts`,
`scripts/desktop.test.ts`, `package.json`, `.github/workflows/ci.yml`.
**Tamaño:** M.

**Desvío declarado al implementarlo:**
1. **La ventana y el cierre por `stdin` entraron aquí, no en T155.** Sin crear la ventana, la
   aplicación se queda sin ninguna y **sale sola**; sin el cierre, cerrar la ventana deja el servidor
   huérfano sobre la base. Las dos cosas son lo mínimo para que el binario sea un programa y no un
   ejercicio, así que T155 se queda con lo que de verdad es suyo: `on_navigation` y los seguros del
   sistema.
2. **`Cargo.lock` no se pudo generar**, y no es un olvido: `cargo` no alcanza crates.io desde el
   entorno donde se escribió esto (sin HTTPS: `schannel: SEC_E_NO_CREDENTIALS`). Queda pendiente de
   la primera compilación con red, y hasta entonces la resolución de dependencias **no es
   reproducible**.
3. **El árbol de Rust no se ha compilado ni probado aquí.** El trabajo del CI que lo compila y lo mide
   entra en este mismo task; lo que no se puede afirmar es que esté verde. Se declara en
   `tasks/done/T154.md`.

---

## T155 — La ventana, la navegación externa y el cierre ordenado

**Descripción:** Abrir la URL anunciada en la ventana y no dejar nada vivo al cerrarla.

**Aceptación:**
- [ ] `on_navigation`: lo que no sea el origen local se abre en el navegador del sistema y la
      navegación se cancela.
- [ ] El seguro del sistema: **Job Object** en Windows y **`PR_SET_PDEATHSIG`** en Linux.

**Desvío declarado:** la ventana con `WebviewUrl::External` y el cierre con `shutdown\n` + plazo
bajaron a **T154** (ver su desvío). Aquí queda la política de navegación y los seguros del sistema.

**Lo que queda pendiente, y es a propósito: el Job Object de Windows.** Se escribió
`PR_SET_PDEATHSIG` para Linux —`pre_exec` más un `prctl`, `unsafe` de tres líneas y con forma
conocida—, y **no** el Job Object, que es FFI `unsafe` contra `windows-sys` (el tipo de `HANDLE`, el
empaquetado de `JOBOBJECT_EXTENDED_LIMIT_INFORMATION`, las características de `Cargo.toml`) y no se
puede compilar en el entorno donde se escribió esto. Un bloque `unsafe` a ciegas compila o no, y si
compila puede fallar en tiempo de ejecución sin que nadie lo mida: es peor que no tenerlo. Va como
tarea pendiente, con su medición, en cuanto haya una máquina con red.

**Verificación:** en Windows, abrir y cerrar deja **cero** procesos `nn-anime.exe` (`Get-Process`) ·
mutación: no escribir `shutdown` deja el servidor vivo y la prueba falla.

**Depende de:** T154.
**Archivos:** `desktop/src-tauri/src/{main,sidecar}.rs`, `desktop/src-tauri/tauri.conf.json`.
**Tamaño:** M.

---

## T156 — Instancia única

**Descripción:** Un segundo lanzamiento enfoca la ventana que ya está, en vez de abrir un segundo
servidor sobre la misma base.

**Aceptación:**
- [ ] `tauri-plugin-single-instance` registrado; el segundo lanzamiento enfoca la ventana existente.
- [ ] No se arranca un segundo sidecar: se cuenta **un** proceso y **un** puerto de escucha.

**Verificación:** dos lanzamientos seguidos dejan un solo `nn-anime-desktop.exe` y un solo
`nn-anime.exe` · mutación: quitar el plugin deja dos servidores y la prueba falla.

**Depende de:** T155.
**Archivos:** `desktop/src-tauri/src/main.rs`, `desktop/src-tauri/Cargo.toml`, `desktop/src-tauri/Cargo.lock`.
**Tamaño:** S.

---

## T157 — Windows: el instalador lleva el anfitrión

**Descripción:** NSIS instala los dos ejecutables y el acceso del escritorio abre la ventana.

**Aceptación:**
- [ ] `packaging/windows/nn-anime.nsi` instala `nn-anime-desktop.exe` **además** de `nn-anime.exe`.
- [ ] Los accesos del menú Inicio y del escritorio apuntan al **anfitrión**.
- [ ] El desinstalador borra los dos ejecutables.
- [ ] El comentario que dice «la ventana que aparece **es** la aplicación» se corrige.

**Verificación:** `bun run package` en el CI de Windows produce un instalador que lleva los dos
ejecutables · la prueba de `T160` comprueba el destino de los accesos.

**Depende de:** T156.
**Archivos:** `packaging/windows/nn-anime.nsi`, `scripts/package/windows.ts`, `scripts/package.ts`.
**Tamaño:** S.

---

## T157a — La compilación cruzada del anfitrión (**tarea insertada**)

**Descripción:** Tarea que **no estaba en el plan**. Al implementar T157 apareció el hueco: `cargo`
compila para la máquina en la que corre, y la matriz de la release arma el `.dmg` de Apple Silicon y
el de Intel **en la misma máquina** (`macos-latest`, que es arm64). Sin compilación cruzada, el `.dmg`
de Intel habría llevado dentro un anfitrión arm64 —un ejecutable que no arranca— y se habría
descubierto al instalarlo. Peor: la comprobación que puse en T157 para no publicarlo hacía **fallar la
matriz entera** y, con ella, la publicación de la release.

**Aceptación:**
- [x] `rustTriple(platform, arch)` da el triple de Rust de cada objetivo, y `hostBinary` busca bajo
      `target/<triple>/release` —que es donde `cargo build --target` escribe— y no en `target/release`.
- [x] `buildDesktop({ target })` acepta una clave de `TARGETS`, pasa `--target` **siempre** —también
      en la compilación nativa— y añade el objetivo con `rustup target add` cuando es cruzada.
- [x] `stageDesktop` busca el binario del **objetivo**, no el de la máquina, y si falta nombra el
      comando exacto que lo compila.
- [x] El workflow de release pide `desktop:build --target=${{ matrix.target }}`.
- [x] **Los dos ejecutables de Windows se firman.** El acceso abre el anfitrión: firmar sólo el
      servidor dejaba el aviso de SmartScreen justo en el que se lanza al pulsar el acceso. Es un
      defecto que introdujo T157 al añadir el segundo ejecutable.
- [x] Guardas: cada objetivo de `TARGETS` tiene su triple, la ruta sale del directorio del triple, un
      objetivo sin triple se rechaza, y la release pide el objetivo de su vuelta.

**Verificación:** `bun test scripts/desktop.test.ts` **18 pasan** · `bun run lint` exit 0 con las
**mismas 3 advertencias** · `bun run typecheck` 0 · **mutación**: devolver `hostBinary` a
`target/release` hace fallar **exactamente 1** guarda.

**Depende de:** T157. **T159 depende de esta.**
**Archivos:** `scripts/package/desktop.ts`, `scripts/desktop.test.ts`, `.github/workflows/release.yml`.
**Tamaño:** M.

**Lo que sigue sin poder medirse aquí:** el árbol de Rust no se compila en esta máquina (sin HTTPS,
`cargo` no alcanza crates.io), así que la compilación cruzada **no se ha ejecutado**. Lo que sí está
medido es la aritmética de rutas y triples, que es lo que decide entre publicar un binario que arranca
y uno que no.

---

## T158 — Linux: el AppImage, el `.deb` y el `.rpm` abren ventana

**Descripción:** Quitar la terminal de la entrada del menú y llevar el anfitrión en el paquete.

**Aceptación:**
- [ ] `packaging/linux/nfpm.yaml` instala `/usr/lib/nn-anime/nn-anime-desktop`.
- [ ] `packaging/linux/nn-anime.desktop` pasa a `Terminal=false` y su `Exec` apunta al anfitrión.
- [ ] El symlink `nn-anime` se conserva para la CLI.
- [ ] `packaging/linux/AppRun` execs el anfitrión **sin argumentos** y el servidor de consola **con**
      argumentos, para no perder `nn-anime "naruto"`.

**Verificación:** el AppImage y el `.deb` del CI arrancan en Ubuntu 22.04 y 24.04 · el `.desktop`
instalado declara `Terminal=false` y un `Exec` que existe.

**Depende de:** T156.
**Archivos:** `packaging/linux/{nfpm.yaml,AppRun,nn-anime.desktop}`, `scripts/package/linux.ts`.
**Tamaño:** M.

---

## T159 — macOS: el `.app` con dos ejecutables

**Descripción:** El paquete de macOS lleva el anfitrión y el servidor, y abre el primero.

**Aceptación:**
- [ ] `scripts/package/macos.ts` copia los dos ejecutables a `Contents/MacOS/`.
- [ ] `packaging/macos/Info.plist` declara `CFBundleExecutable = nn-anime-desktop`.
- [ ] El comentario de `LSUIElement` se revisa: con ventana propia el icono del Dock ya no es la
      única forma de cerrarla.

**Verificación:** el `.dmg` del CI abre en un Mac y la ventana aparece · `CFBundleExecutable` nombra
un archivo que está dentro del `.app`.

**Depende de:** T156.
**Archivos:** `scripts/package/macos.ts`, `packaging/macos/Info.plist`.
**Tamaño:** S.

---

## T160 — El instalador sin consola, verificado en CI

**Descripción:** Cerrar el hueco que `docs/release.md` declara abierto: nadie ha ejecutado nunca el
instalador de Windows.

**Aceptación:**
- [ ] Paso de CI en Windows: instalación silenciosa con `/S /D=<temporal>`.
- [ ] Comprueba los archivos instalados, las claves de `HKCU` y que los **accesos apuntan al
      anfitrión**.
- [ ] Arranca el ejecutable instalado y comprueba que sirve la interfaz en el puerto anunciado.
- [ ] Desinstala y comprueba que no quedan ni los ejecutables ni las claves, y que **los datos
      siguen**.
- [ ] Una prueba lee la cabecera **PE** y exige subsistema **WINDOWS (2)** en el anfitrión y
      **CONSOLE (3)** en el servidor: es la medición de «sin consola» que el CI sí puede hacer.

**Verificación:** el job en verde sobre el instalador de verdad · mutación: apuntar el acceso al
servidor de consola hace fallar la comprobación del `.lnk`; compilar el anfitrión sin
`windows_subsystem` hace fallar la del PE.

**Depende de:** T157.
**Archivos:** `scripts/package.test.ts`, `.github/workflows/release.yml`, `docs/release.md`.
**Tamaño:** M.

---

## T161 — HLS dentro de la ventana, en Linux

**Descripción:** Medir antes de prometer Linux: WebKitGTK no es Chromium.

**Aceptación:**
- [ ] La reproducción dentro de la ventana se mide en Ubuntu 22.04 y 24.04, con y sin `mpv`.
- [ ] Si no va, la ficha lo **dice** y manda a `mpv`, en vez de quedarse en negro.

**Verificación:** la medición queda escrita con su resultado y su sistema, sea el que sea.

**Depende de:** T158.
**Archivos:** `docs/PLAN-B-HLS.md`, `README.md`, `docs/specs/SPEC-desktop.md`.
**Tamaño:** S.

---

## T162 — Documentación y release

**Descripción:** Que quien descargue sepa qué hace y que la release salga con contenido.

**Aceptación:**
- [ ] `README.md`: los accesos abren **ventana**; la consola queda para la CLI. Las tablas de
      instalación por sistema y la nota de «Después de instalar» se revisan.
- [ ] `docs/release.md`: el toolchain de Rust y las dependencias de Linux del anfitrión
      (`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `librsvg2-dev`, `patchelf`).
- [ ] `CHANGELOG.md` con la sección `0.1.0`: es el cuerpo que `release.yml` busca para la release.
- [ ] Los pasos del tag, con el ensayo sin publicar delante.

**Verificación:** `bun test packages/web/src/docs.test.ts` (los comandos citados existen y los
documentos enlazados están) · `bun run version:check` 0.

**Depende de:** T160, T161.
**Archivos:** `README.md`, `docs/release.md`, `CHANGELOG.md`, `docs/specs/CAPABILITY-MAP.md`.
**Tamaño:** M.

---

## Publicar (lo empuja el humano)

Comprobado: **no hay ningún tag ni `CHANGELOG.md`**, y la versión sigue en `0.1.0`. No existe nada
que descargar todavía, y `release-please` no ha cortado ninguna release, así que el camino fiable es
el tag manual, que `release.yml` ya soporta.

```bash
# 1) Ensayo sin publicar: Actions → Release → Run workflow, «publish» SIN marcar.
# 2) Con el ensayo verde y el trabajo ya integrado:
git checkout main && git pull
git tag -a v0.1.0 -m "nn-anime 0.1.0"
git push origin v0.1.0
```

El tag dispara `release.yml`: valida la versión, compila los instaladores, calcula `SHA256SUMS.txt`,
crea el borrador, sube todo y **lo publica**.

## Dependencias

```
T153 ── T154 ── T155 ── T156 ─┬─ T157 ── T160 ─┐
                              ├─ T158 ── T161 ─┼─ T162 ── (tag, el humano)
                              └─ T159 ─────────┘
```

| Task | Depende de |
|---|---|
| T153 | — |
| T154 | T153 |
| T155 | T154 |
| T156 | T155 |
| T157 | T156 |
| T158 | T156 |
| T159 | T156 |
| T160 | T157 |
| T161 | T158 |
| T162 | T160, T161 |

## Riesgos

| # | Riesgo | Mitigación |
|---|---|---|
| 1 | WebKitGTK no reproduce HLS como Chromium | T161 lo mide antes de prometer Linux; Windows hereda la evidencia del e2e con Chromium |
| 2 | macOS sin `PR_SET_PDEATHSIG`: el servidor sobrevive a un kill seco | Riesgo residual declarado en el spec; cierre explícito |
| 3 | El CI necesita red para el toolchain de Rust y los crates | Se fijan versiones y se versiona `Cargo.lock` |
| 4 | Sin certificados, SmartScreen y Gatekeeper avisan | Decisión de dinero; `SHA256SUMS.txt` está y el README lo explica |
| 5 | Las ramas salen de `dev`, no de `main` | Declarado arriba: T134 sólo está en `dev`. Integrar en `main` es un paso propio |

## Fuera de este plan

- Auto-actualización: sigue sin haber, y `docs/release.md` ya lo declara como decisión.
- MSI en Windows: NSIS cubre los dos papeles.
- Linux arm64 y Windows arm64: cada objetivo es una release que hay que poder probar.
- Icono de bandeja y memoria de tamaño y posición de la ventana: otra superficie y otro plugin.
