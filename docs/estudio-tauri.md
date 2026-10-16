# Estudio: la ventana propia de nn-anime

**Estado:** propuesta. Nada de esto está implementado **en `main`**. Fecha: 2026-10-16. Task: **T132**.

> **Corrección de la primera versión de este estudio.** La primera versión proponía hacer el
> empaquetado desde cero: una bandera `--web-root`, un ejecutable autocontenido y unos instaladores.
> **Ya está hecho**, en la rama `ci/instalables-y-releases` (también en `origin`), **fusionada en
> `main` el 2026-10-16** (`1d752bb`) y verificada (sección 4.4). Lo
> que sigue faltando es lo que este estudio sí puede aportar: **una ventana propia**, porque hoy lo
> instalado es una aplicación de consola. La sección 2 lo detalla y las tareas cambiaron en
> consecuencia.

## 1. Resumen para decidir

| Lo que se quiere | Estado real |
|---|---|
| Instalable en Windows, Linux y macOS | **Hecho**, en `ci/instalables-y-releases`: NSIS, AppImage + `.deb` + `.rpm`, `.app` + `.dmg` |
| Icono propio en el escritorio | **Hecho**: juego de iconos en `packaging/icons/` y acceso directo en el instalador NSIS |
| Una versión publicable sin compilar en tu máquina | **Hecho**: matriz de CI por sistema y release desde un tag |
| **Su propia ventana, sin consola** | **Falta.** Es lo único que queda de la petición original |

Es decir: el trabajo que falta **no es empaquetar**, es **la ventana**. Y para eso sí hace falta algo
que el empaquetado actual no tiene: un anfitrión que arranque el servidor, espere a su dirección y
abra una ventana en ella. Ese anfitrión es Tauri, y este estudio dice cómo encajarlo **encima** de lo
que ya existe, no en su lugar.

## 2. Lo que ya existe: `ci/instalables-y-releases`

Rama local y remota, 10 commits, 44 archivos, 4.383 líneas. Último commit de la rama `3fff71c`
(2026-10-14); **fusionada en `main` el 2026-10-16** (`1d752bb`) con el listón verde y el ejecutable
empaquetado probado (sección 4.4).

| Pieza | Qué hace |
|---|---|
| `scripts/package.ts` + `scripts/package/*.ts` | Ejecutable autocontenido por plataforma y su instalador |
| `scripts/package/binary.ts` | `bun build --compile` con `--asset` (interfaz y migraciones) y `--windows-icon` |
| `packaging/windows/nn-anime.nsi` | Instalador NSIS **por usuario** (sin UAC), accesos en menú de inicio **y escritorio**, desinstalador y entrada en «Agregar o quitar programas» |
| `packaging/linux/{AppRun,nfpm.yaml,nn-anime.desktop}` | AppImage y paquetes `.deb` / `.rpm` |
| `packaging/macos/Info.plist` | `.app` y `.dmg` (x64 y arm64) |
| `packaging/icons/*` | **El logo existe**: `icon-1024.png`, `.ico`, `.icns`, `icon-setup.ico` para el asistente |
| `scripts/icon.ts` | El generador del `.ico` (con el fallo de endianness arreglado y una prueba que lo vigila) |
| `scripts/version.ts` | Una sola fuente de verdad para la versión de los diez `package.json` |
| `.github/workflows/{ci,release,release-please}.yml` | El listón y **el empaquetado en cada push**, en las tres plataformas; release desde un tag, en borrador hasta tener los instaladores |
| `docs/release.md` | Cómo se publica, qué secretos hay (todos opcionales) y **qué no está probado** |
| `packages/cli/src/resources.ts` | Dónde viven la interfaz y las migraciones dentro del ejecutable |

**`resources.ts` es la pieza que más importa para este estudio**, y su comentario de cabecera
describe exactamente los dos fallos que hoy he medido con el CLI compilado (sección 4):

1. `import.meta.url` dentro del binario apunta a su sistema de archivos virtual, así que
   `../../web/dist/` resolvía a `B:\web\dist` y el servidor arrancaba **sin interfaz**.
2. `import.meta.dir` de **cualquier** módulo es la raíz de ese sistema, así que el runner de
   migraciones leía un directorio sin `.sql`, no aplicaba ninguna y **no fallaba**: el síntoma era un
   `no such table` mucho después.

El orden que resuelve es: **variable de entorno (`NN_ANIME_WEB_DIR`, `NN_ANIME_MIGRATIONS_DIR`) →
recurso incrustado con `--asset` → árbol de fuentes**. Con eso, un ejecutable autocontenido sirve la
interfaz y aplica las siete migraciones.

**Lo que la rama no tiene, y lo dice su propio `.nsi`:**

> El acceso abre el ejecutable, que es una aplicación de consola: la ventana que aparece **es** la
> aplicación mientras vive, y cerrarla la apaga. Ocultarla dejaría un servidor sin forma de pararlo.

Ahí está el hueco exacto. Un instalador con icono y acceso directo, que abre **una consola con una
URL**, y de ahí al navegador. La petición original —«su propia ventana e icono»— está a medias: el
icono está, la ventana no.

**Ya está fusionada**, así que quien clone `main` hoy puede instalar. Lo único que estrena el primer
push es el **instalador NSIS**, que en la máquina de desarrollo no se ha podido compilar: no hay
`makensis`.

## 3. La ventana: qué tiene que hacer el anfitrión

**La decisión que gobierna el diseño sigue siendo la misma que en la primera versión, y sigue siendo
la correcta: la ventana carga `http://127.0.0.1:<puerto>`, no `tauri://`.** Así el webview es un
navegador sin cromo y todo lo que `SECURITY.md` declara sigue cumpliéndose sin tocar una línea: la
cookie `HttpOnly; SameSite=Strict`, el guard de `Origin` (que sólo admite ese origen,
`packages/server/src/middleware/origin-guard.ts:27`), el guard de `Host`, el CSP y los tickets opacos
de `/stream/:ticket` que presenta el `<video>`.

Empaquetar la interfaz como recursos de Tauri (`frontendDist`) haría que el `Origin` fuera
`tauri://localhost`, y **toda** petición mutante —alta de proveedores, favoritos, ajustes, play—
daría 403. Habría que abrir excepciones en dos guards y reescribir el modelo de amenaza. No se hace.

**El precio, dicho claro:** sin IPC, Tauri aporta ventana e icono y nada más. No hay updater, ni
bandeja, ni diálogos nativos al alcance de la interfaz. Para esta aplicación no se pierde nada —todo
lo que necesita es HTTP contra su propio servidor—, pero conviene saber que Tauri aquí es un marco de
ventana, no una plataforma.

**Las cinco cosas que hace el anfitrión, y ninguna más:**

1. Lanzar el ejecutable ya empaquetado con `--no-open` y **capturar su salida**.
2. Esperar la línea de arranque legible por máquina y abrir la ventana en esa URL.
3. Cerrar el servidor cuando se cierre la ventana.
4. Impedir una segunda instancia (dos servidores = dos escritores sobre el mismo SQLite).
5. Que un enlace externo abra el navegador del sistema y no se lleve el webview.

**Nada más.** Todo el producto sigue en `packages/`, y el sidecar es **el mismo ejecutable que ya
construye `scripts/package.ts`**: de hecho, Tauri puede tomarlo como `externalBin` sin recompilarlo.

## 4. Lo medido hoy

Todo lo de esta sección se ejecutó el 2026-10-16 en este equipo (Windows x64, Bun 1.4.3). Las sondas
vivían en `.tmp/` y ya se borraron.

### 4.1 El binario compilado, contra el CLI real

| Medición | Resultado |
|---|---|
| `bun build --compile packages/cli/src/index.ts` | 92,5 MB, 257 módulos |
| `import.meta.url` dentro del binario | `file:///B:/~BUN/root/s.exe` |
| Qué resuelve `new URL('../../web/dist/', import.meta.url)` desde ahí | `B:/web/dist/` → **no existe** |
| Base de datos que crea un binario compilado en una instalación nueva | **sólo `schema_version`, vacía: cero migraciones** |
| Qué hace después, con la base vacía | **muere antes de escuchar**: `no such table: adult_ref`, código 1 |
| Un `.ts` externo que no existía al compilar, ¿se importa? | **sí** |
| Tamaños por plataforma | Windows x64 91,9–92,5 MB · Linux x64 86,6 · macOS arm64 67,6 |
| Cross-compilar desde Windows a Linux y macOS con Bun | **funciona** |
| WebView2 en este Windows | instalado, 155.0.4283.45 |
| `cargo` / `rustc` | **no están** · `mpv` tampoco |

La cadena del fallo, leída en el código y consistente con lo medido:
`enabledProviderFiles` → `store.getSetting` → `of()` (los repositorios se crean perezosos,
`catalog-store/src/store.ts:281`) → **`createAdultRepository(db)` es el primero del literal** y
prepara su `SELECT … FROM adult_ref` → la tabla no existe porque **ninguna migración corrió**, porque
`catalog-store/src/migrations/runner.ts:40` resuelve el directorio con `import.meta.dir`. El error
sale por el `catch` de arriba de `packages/cli/src/index.ts:167`, que imprime el mensaje pelado y
sale con 1. **Es exactamente el fallo número 2 que `resources.ts` describe y arregla.**

### 4.2 A/B: el mismo CLI, compilado y sin compilar

Misma base (pre-migrada con el CLI normal), mismo directorio de plugins, mismo puerto distinto.

| | sin compilar | compilado |
|---|---|---|
| `GET /` | **200** (391 B, el `index.html`) | **404** |
| `GET /SECURITY.md` | **200** (10.170 B) | **404** |
| Migraciones en una base nueva | las siete | **ninguna, y el proceso muere** |
| Canje del token + `GET /api/health` | **200** con el JSON de proveedores | 404 (el canje redirige a `/`, que es 404) |
| Plugin autocontenido / con `import type` | carga | carga |
| Plugin que **importa un paquete en tiempo de ejecución** | **carga** (resuelve `@nn-anime/providers-fixture`) | **rechazado: `Cannot find package`** |
| Plugin que importa algo inexistente | rechazado con su motivo | rechazado con su motivo |
| Plugin que no cumple el contrato | rechazado con el detalle campo a campo | igual |

De la última fila de plugins sale una conclusión que **ya era cierta sin compilar** y que conviene
tener escrita: un plugin del directorio del usuario **no resuelve especificadores «bare»**, porque
desde `~/.config/nn-anime/providers/` no hay `node_modules` que los contenga. Por eso los seis
proveedores reales de `nn-anime-plugins` usan **sólo `import type`**, y lo dicen en su cabecera:

> Sólo hay `import type`, y el único módulo que se nombra es `@nn-anime/provider-sdk`: los tipos se
> borran al ejecutar, **que es lo que permite cargar este archivo desde el directorio del usuario,
> donde el paquete no se resuelve**.

Es decir: la convención no es estilo, es **lo que hace viable cargar plugins desde fuera del
repositorio**, y el binario compilado la respeta. Lo que añade el compilado es un matiz: **ni
siquiera con `node_modules` delante** resuelve un `import` de valor. Si algún día se quiere que un
plugin pueda importar `ProviderError` de `@nn-anime/core`, el binario compilado no es el vehículo: el
cargador tendría que inyectarlo. Hoy no hace falta, y está medido que no hace falta.

### 4.3 Lo que no está medido

- **Nada de Tauri.** En esta máquina no hay `cargo` ni `rustc`. Todo lo del anfitrión (sección 3) es
  diseño: `WebviewUrl::External`, `on_navigation`, el plugin `single-instance` y el Job Object de
  Windows se confirman contra la versión que se fije al implementarlo.
- **El HLS del webview en Linux** (MSE sobre WebKitGTK) sigue sin medir: no hay Linux aquí. Es el
  riesgo 1 de la sección 6 y va antes de prometer Linux.
- **El instalador NSIS no se ha compilado nunca** —lo dice `docs/release.md` de la rama—: no hay
  `makensis` en esta máquina. Es lo único de la rama que queda por ver en verde.

### 4.4 El listón sobre la rama ya fusionada

Medido el 2026-10-16 en un worktree de integración con el mismo contenido que `main` tras `1d752bb`:

| Comprobación | Resultado |
|---|---|
| `bun run typecheck` | **0** |
| `bun run lint` | 0 errores, 3 avisos de CSS que ya estaban |
| `bun test` | **2739 pasan, 10 fallan** |
| `bun run build` | ok |
| `bun run package --skip-installer` | **ok: el ejecutable empaquetado pasa las 6 comprobaciones de `smoke.ts`** |

El ejecutable empaquetado pesa **93,8 MB**, lleva la versión `0.1.0.0` y la descripción dentro, y las
seis comprobaciones dicen: la interfaz se sirve (391 B), sus recursos con hash, el aviso de seguridad
viaja con ella (10.017 B), el token de arranque se canjea por sesión, la versión que dice es la
publicada y **la base tiene esquema**. Es exactamente lo contrario de lo medido en 4.2 sin
`resources.ts` —404 y cero migraciones—, así que el arreglo de la rama queda verificado aquí y no sólo
en su documentación.

Los 10 fallos son **los mismos 10, con el mismo `EPERM: operation not permitted, uv_spawn 'git'`, que
fallan en `main` antes de la fusión**: son las pruebas de `scripts/agente.test.ts` y
`scripts/git-hooks.test.ts`, que lanzan `git` como subproceso, y el sandbox del agente que las ejecutó
corta las tuberías. Línea base medida: esos dos archivos en `main` limpio dan 14 pasan y esos 10
fallan.

**Lo que no se pudo comprobar aquí, y por qué:** el **instalador NSIS** (no hay `makensis` en esta
máquina: lo estrena el CI) y el **e2e** (Playwright escribe su caché de transformación en `%TEMP%` y
lanza Chromium con tubería; las dos cosas chocan con el sandbox, incluso con la excepción de acceso
concedida). El e2e lo corre el CI en Linux en cada push, y `docs/release.md` ya declara que tiene dos
fallos anteriores a este trabajo y ajenos a él.

## 5. Lo que hay que cambiar en el producto

Mucho menos que en la primera versión de este estudio: **`--web-root` ya no hace falta**, porque
`resources.ts` resuelve la interfaz por variable de entorno, recurso incrustado o árbol de fuentes.
Lo que queda son tres cosas, y las tres están en el contrato del CLI o en el anfitrión.

1. **Una línea de arranque legible por máquina.** El anfitrión necesita la URL con el token, y hoy lo
   único que hay es una línea **traducida por i18n** (`packages/cli/src/boot.ts:381`): analizar texto
   traducido es un contrato que se rompe al traducir. Se añade una línea fija, sin traducir:
   `NN_ANIME_BOOT {"port":41235,"url":"http://127.0.0.1:41235/?boot=…"}`. **Por tubería y no por
   archivo**: un archivo dejaría el token en disco, y «Persistir el token de sesión o el de arranque»
   está en la lista de *Never* del spec del CLI. Detalle en
   `docs/specs/proposals/SPEC-cli-launcher.T132.md`.
2. **Cierre ordenado por `stdin`, y Job Object en Windows.** `packages/cli/src/lifecycle.ts:78`
   espera `SIGINT`/`SIGTERM`; en Windows no hay `SIGTERM` de verdad y matar el sidecar desde el
   anfitrión es `TerminateProcess`, sin `finally`: **`mpv` huérfano y SQLite sin cerrar**. Una línea
   (`shutdown`) por `stdin` funciona en las tres plataformas; el Job Object cubre la muerte brusca.
   Hoy ese hueco no se nota porque «la consola **es** la aplicación» y cerrarla manda `SIGINT`; con
   una ventana, el cierre lo pide el anfitrión.
3. **El anfitrión**: las cinco responsabilidades de la sección 3, con `CREATE_NO_WINDOW` al lanzar el
   sidecar (es un binario de consola: sin eso asoma una consola negra, que es justo lo que se quiere
   quitar) e instancia única.

**Lo que no cambia:** el riesgo residual 1 de `SECURITY.md` sigue igual —los plugins se ejecutan sin
sandbox con los permisos del usuario— y la aplicación sigue escuchando en `127.0.0.1` con token, así
que sigue siendo alcanzable por cualquier navegador local como hoy. La ventana no cierra esa puerta.

## 6. Riesgos

1. **WebKitGTK no es Chromium.** Windows usa WebView2 (Chromium): se comportará como el navegador con
   el que ya se prueba con Playwright. Linux usa WebKitGTK y macOS WKWebView, y la reproducción HLS
   depende de `MediaSource` y de los códecs del sistema. Y en esta máquina **no hay `mpv`**: sin él,
   el reproductor del webview no es el plan B, es el plan A. **Medirlo antes de prometer Linux.**
2. **Dos ciclos de vida donde hoy hay uno.** Hoy el cierre ordenado lo dispara un Ctrl+C o el cierre
   de la consola. Con una ventana, el que cierra es el anfitrión, y el punto 2 de la sección 5 pasa a
   ser el camino principal, no una excepción.
3. **Firma.** La rama ya deja preparados los pasos y los secretos (todos opcionales). Sin
   certificados, Windows avisa con SmartScreen y macOS con Gatekeeper; no es un fallo del código y no
   se arregla con código.
4. **Auto-actualización: sigue sin haber**, y `docs/release.md` ya lo declara como decisión. Tauri
   traería un updater, pero sólo para *su* parte: el ejecutable y los instaladores seguirían siendo
   los de `scripts/package.ts`, así que el updater de Tauri no resolvería el problema real. No lo
   cuentes como ventaja de este plan.
5. **Rust entra en un repositorio sin una línea de Rust.** El anfitrión se queda en cinco
   responsabilidades y vive **fuera de `packages/`**, así que `bun run build`, `bun test`, `biome` y
   `tsc` no lo miran y no hay que tocar `scripts/workspaces.test.ts` (que afirma que hay nueve
   paquetes).
6. **La rama de empaquetado es grande y lleva tiempo sin rebasar.** Fusionarla no es de este estudio;
   es trabajo propio y con su propia verificación.

## 7. Fases, cada una con su medición

Las tareas arrancan en **T134**: T132 es este estudio y **T133 está reclamado** por otro trabajo (la
búsqueda). El orden no es negociable en un punto: primero se fusiona lo que existe.

| Id | Qué entra | Cómo se mide |
|---|---|---|
| — | **Fusionar `ci/instalables-y-releases`**: **hecho** el 2026-10-16 (`1d752bb`), con el listón verde y el `smoke` del ejecutable en 6/6 (sección 4.4) | Queda que el primer push compile el instalador NSIS, que es lo único que nunca se ha compilado |
| **T134** | La línea `NN_ANIME_BOOT` y el cierre por `stdin` | La línea aparece **una** vez, sin traducir y nunca en el log, y su JSON valida contra un esquema. Con `shutdown\n` el proceso sale 0, cierra SQLite y mata el hijo registrado. **Mutación**: dejar de escuchar el `stdin` deja el proceso vivo y la prueba falla |
| **T135** | El anfitrión: ventana, `--no-open`, instancia única, `CREATE_NO_WINDOW`, `on_navigation` | Se abre la ventana con la home; al cerrarla **no queda ningún proceso** (`Get-Process`); un segundo lanzamiento enfoca la ventana existente. **Mutación**: quitar la instancia única abre un segundo servidor sobre la misma base |
| **T136** | El instalador de Windows con el anfitrión (no el ejecutable a secas) | Instalar en una cuenta limpia: icono, acceso en el escritorio, **ventana sin consola**, búsqueda con el plugin de ejemplo, y al cerrar no queda nada vivo. Sin UAC |
| **T137** | Linux: AppImage y `.deb` con ventana, **y la medición del HLS de WebKitGTK** | Abre en Ubuntu 22.04 y 24.04; se mide el HLS con y sin `mpv`. Si no va, la ficha lo dice y manda a `mpv` en vez de quedarse en negro |
| **T138** | macOS: `.app` y `.dmg` con ventana | Abre en un Mac; con firma y notarización, sin el aviso de Gatekeeper |

**El atajo que hay que resistir** es empezar por la ventana: sin la línea de arranque legible, el
anfitrión tiene que adivinar la URL de un texto traducido, y sin el cierre por `stdin` cada cierre en
Windows deja un `mpv` huérfano. Las dos cosas son pequeñas y van antes.

## 8. Decisiones que no son mías

1. **¿El instalador deja de ofrecer la consola?** Un anfitrión con ventana sustituye al ejecutable en
   el acceso directo. La consola seguiría existiendo para quien la quiera (es el mismo binario con
   `--no-open` desde una terminal), pero el acceso del escritorio ya no la abre.
2. **¿Firma o se acepta el aviso del sistema?** La rama ya tiene los pasos escritos y los secretos
   como opcionales: es una decisión de dinero, no de código.
3. **¿Se publica la rama antes de añadir la ventana?** Publicar ya da un instalable con icono; la
   ventana llega después. Encadenar las dos cosas retrasa lo primero.

## 9. Lo que este estudio **no** propone

- Rehacer el empaquetado, los iconos, la versión o el CI: existen y están probados.
- Reescribir el backend en Rust: los plugins del usuario son módulos TypeScript que se importan en
  tiempo de ejecución, y eso no existe fuera de Bun. Un backend en Rust dejaría de cargar plugins.
- Meter la interfaz dentro de Tauri como recursos (`tauri://`), por lo dicho en la sección 3.
- Bundles de Electron: mismo problema de motor que Rust, con más peso.
