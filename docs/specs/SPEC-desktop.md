# Spec: desktop

Module id: `desktop` · Depende de: `cli-launcher` (consume su línea de arranque y su cierre por
entrada estándar) · Árbol: `desktop/`, **fuera de `packages/`**
Convenciones (Commands, Project Structure, Code Style, Testing Strategy, Boundaries): heredadas de
`SPEC-nn-anime.md`. Este documento define sólo lo propio del módulo.

> **Origen.** Nace de `docs/specs/proposals/SPEC-desktop.T135.md`, aprobado por el humano el
> 2026-10-16 junto al plan `tasks/desktop.md`. Se corrige aquí un punto de la propuesta —la salida
> del hijo, ver «Contrato 2»— porque contradecía el *Never* de `SPEC-cli-launcher.md`.

## Objective

Que nn-anime se abra en **su ventana**, con su icono, **sin terminal**, encima del empaquetado que ya
existe (`scripts/package.ts`: ejecutable autocontenido e instaladores de las tres plataformas). Hoy lo
instalado abre una consola, y lo dice su propio `.nsi`:

> El acceso abre el ejecutable, que es una aplicación de consola: la ventana que aparece **es** la
> aplicación mientras vive, y cerrarla la apaga.

Éxito significa, en las tres plataformas:

1. El acceso del escritorio abre una **ventana** con la aplicación dentro, y no una consola.
2. Cerrar la ventana **apaga el servidor**: no queda ningún proceso vivo.
3. Un segundo lanzamiento **enfoca la ventana que ya está**, en vez de abrir un segundo servidor.
4. Un enlace externo de la interfaz abre el navegador del sistema, no se lleva la ventana.
5. Si el anfitrión muere de golpe, el servidor **no queda huérfano** donde el sistema lo permita.

## Contrato

**Qué es.** Un anfitrión de ventana. **Cinco** responsabilidades y ninguna más; el producto sigue
entero en `packages/`. El anfitrión se llama **`nn-anime-desktop`** (`nn-anime-desktop.exe` en
Windows) porque tiene que convivir en el mismo directorio con **`nn-anime`**, que sigue siendo el
servidor de consola.

**1. Lanza el ejecutable que ya existe, como hermano.**

```
<directorio del anfitrión>/nn-anime(.exe) --no-open
```

- **No se le pasa `--port`**: el CLI ya sabe caer a un puerto libre y lo dice en su línea de arranque
  (paso 7 del spec del CLI). Fijarlo sería añadir una forma de fallar que no es del programa.
- **No se le pasa `--data-dir` ni `--config-dir`**: las resuelve el propio CLI. Es una decisión, no
  un descuido: si el anfitrión las fijara, la ventana y `bun run start` usarían **bases distintas** y
  el usuario vería dos aplicaciones.
- **No se le pasa `--lang`**: el idioma es del usuario, no del anfitrión.
- La ruta del hermano sale del **directorio del propio anfitrión**, no de una variable: los dos se
  instalan juntos ($INSTDIR, `Contents/MacOS`, `/usr/lib/nn-anime`).
- En Windows se lanza con **`CREATE_NO_WINDOW`**: el hermano es un binario de consola y sin eso asoma
  la consola negra que este módulo existe para quitar.

**2. Lee su dirección de la línea legible por máquina, y **no la escribe en disco**.**

`NN_ANIME_BOOT {"port":N,"url":"…"}`, definida en `packages/core/src/boot-line.ts` (formato, esquema
y análisis viven juntos). El anfitrión la analiza con un espejo del mismo esquema: prefijo literal +
JSON en una sola línea.

**La salida del hijo se parte en dos, y no es un detalle:**

- **`stdout` → tubería, drenada por un hilo lector y descartada.** El paso 8 del arranque del CLI
  escribe en `stdout` la URL **humana** y la línea `NN_ANIME_BOOT`, y **las dos llevan el token**
  (`packages/cli/src/boot.ts`). Escribirlas a un archivo dejaría el token en disco, contra el *Never*
  de `SPEC-cli-launcher.md` («Persistir el token de sesión o el de arranque»). De la tubería sólo se
  extrae la línea, en memoria; el resto se descarta. **La tubería se vacía siempre**: no vaciarla es
  lo que la bloquearía, y eso es un fallo del anfitrión, no del CLI.
- **`stderr` → archivo** de registro (avisos y errores, sin token):
  `<caché>/nn-anime/desktop.log`, respetando `NN_ANIME_CACHE_DIR` y las rutas XDG de cada sistema.

**Plazo de arranque: 30 s.** Sin línea —o con la línea rota— la ventana **enseña el motivo**: se abre
con la página que viaja dentro del binario, que dice que el servidor no arrancó y dónde está el
registro, y el motivo completo queda ahí. Un anfitrión que espera para siempre delante de una ventana
en blanco es peor que uno que lo dice; y uno que **muere en silencio** —sin ventana y sin consola, que
es el caso de Windows— es el peor de los tres. *(Decía «un diálogo de error con la cola de `stderr` y
salida 1». Un diálogo nativo pide el plugin de diálogos o una API por sistema, y la ventana es el
mecanismo que ya existe y no necesita ninguna capacidad nueva; el código de salida deja de ser 1 en
esos dos caminos, porque el proceso vive hasta que se cierra el aviso. Se corrige el criterio para que
diga la garantía real, como se hizo con `--lang` en `SPEC-cli-launcher.md`.)*

Y abre la ventana en esa URL con **`WebviewUrl::External(url)`** (API de `tauri 2.x`: «An external
URL. Must use either the `http` or `https` schemes.»). El origen es `http://127.0.0.1:<puerto>`,
**nunca `tauri://`**:

- así la cookie de sesión (`HttpOnly; SameSite=Strict`), el guard de `Origin`
  (`packages/server/src/middleware/origin-guard.ts`, que sólo admite ese origen), el guard de `Host`,
  el CSP y los tickets opacos de `/stream/:ticket` siguen valiendo **sin tocar una línea**;
- con `tauri://localhost` el origen de **toda** petición mutante dejaría de ser el admitido y habría
  que abrir excepciones en dos guards. No se hace.

**3. Lo cierra pidiéndoselo, y con un seguro por si no contesta.**

Al cerrarse la ventana: escribe `shutdown\n` en la entrada estándar del hijo, espera **2 s** y, si no
sale, lo mata. Medido por T134 sobre el ejecutable empaquetado: **sale con 0 en 17 ms**.

El seguro contra la muerte brusca del anfitrión es del sistema operativo, no del CLI: **Job Object**
con `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` en Windows y **`PR_SET_PDEATHSIG`** en Linux. macOS no tiene
equivalente: es un riesgo residual que se declara.

**4. Instancia única.** `tauri-plugin-single-instance` (exige **Rust ≥ 1.90**), que además enfoca la
ventana existente. Sin esto, dos lanzamientos conviven sobre la misma base sin decir nada y cerrar
uno deja al otro sirviendo.

**5. Un enlace externo no se lleva la ventana.** `on_navigation`: lo que no sea
`http://127.0.0.1:<puerto>` se abre en el navegador del sistema y se cancela la navegación. Hoy hay
**un** enlace así (`packages/web/src/features/detail/DetailPage.tsx`, a AniList) y el `SECURITY.md`
del proyecto no cambia por esto.

**Sin IPC.** Tauri concede capacidades a los orígenes de la aplicación; para uno remoto hace falta
declararlo (`remote`), y aquí **no se declara nada**: `capabilities/default.json` queda vacío y el
webview no puede invocar ningún comando, así que no hay superficie que auditar. El shell se lanza con
`std::process::Command` desde Rust, no con el plugin de shell. Lo que se pierde —updater, bandeja,
diálogos nativos al alcance de la interfaz— no se usa en esta aplicación.

## Estructura del módulo

```
desktop/
├─ src-tauri/
│  ├─ Cargo.toml              tauri, tauri-plugin-single-instance; versiones fijadas
│  ├─ Cargo.lock              versionado: sin él la release no es reproducible
│  ├─ tauri.conf.json         ventana, icono, `frontendDist` de relleno
│  ├─ capabilities/default.json   vacío a propósito (sin IPC)
│  └─ src/
│     ├─ main.rs              arranque, ventana, cierre, instancia única
│     ├─ sidecar.rs           spawn, drenaje de stdout, análisis de la línea, cierre
│     └─ boot_line.rs         el espejo del esquema de `core`
└─ stub/index.html            lo que la ventana enseña si el servidor no arranca, y
                              el `frontendDist` que `tauri build` exige. No se llama
                              `dist/` porque `.gitignore` ignora ese nombre
```

**Cómo se empaqueta: el binario vive al lado, no dentro.**

**No se usa `externalBin`.** El instalador que ya existe instala el ejecutable de consola; el
anfitrión se instala **junto a él** (mismo `$INSTDIR`, un `.app` con dos ejecutables, un AppImage con
los dos) y lo lanza como **hermano**. Tres motivos:

1. **No se duplica el motor.** `externalBin` incrustaría una segunda copia del ejecutable: 93,8 MB
   más por plataforma. Al lado, el anfitrión son unos pocos megabytes.
2. **La consola no desaparece para quien la quiere.** `nn-anime "naruto"` desde una terminal sigue
   funcionando; el acceso del escritorio es el que apunta a la ventana.
3. **El empaquetado probado se conserva.** `scripts/package.ts`, `packaging/` (NSIS por usuario con
   accesos, AppImage + `.deb` + `.rpm`, `.app` + `.dmg`), `release-please`, los `SHA256SUMS` y la
   matriz del CI siguen siendo el camino. Lo que se añade es **un paso más por plataforma**.

`tauri build` produce el binario del anfitrión, `scripts/package/desktop.ts` lo prepara y el
instalador de siempre lo mete en el mismo directorio que el servidor.

## Success Criteria

Cada uno con la medición que lo sostiene. Se cierran en `tasks/desktop.md`.

- [ ] Instalar en Windows y abrir desde el menú Inicio deja **ventana e icono, sin consola**. Se mide
      en el CI: instalación silenciosa, el `.lnk` apunta al anfitrión, y la cabecera PE del anfitrión
      declara subsistema **WINDOWS (2)** mientras la del servidor declara **CONSOLE (3)**.
- [ ] Cerrar la ventana termina el servidor **con 0** en menos de un segundo. Medido por T134 sobre
      el ejecutable: 17 ms.
- [ ] Un segundo lanzamiento enfoca la ventana existente y **no** arranca un segundo servidor. Se
      mide contando procesos y puertos de escucha.
- [ ] Matar el anfitrión desde el administrador de tareas **no** deja el servidor vivo en Windows
      (Job Object) ni en Linux (`PR_SET_PDEATHSIG`).
- [ ] El enlace de AniList abre el navegador del sistema y la ventana sigue donde estaba.
- [ ] Sin `mpv`, la reproducción dentro de la ventana funciona en Windows (WebView2). **En Linux se
      mide antes de prometerlo**: WebKitGTK no es Chromium.
- [ ] **Si el servidor no arranca, la ventana lo dice.** Se mide quitando el servidor de al lado del
      anfitrión y abriéndolo: tiene que aparecer la página del aviso, con el motivo en el registro. Es
      el fallo más probable de todos y el único que, sin esto, no enseñaría **nada**.
- [ ] El token de arranque **no aparece en ningún archivo** del disco del usuario.
- [ ] El listón entero sigue verde, y `bun run build`, `bun test` y `bun run lint` **no** miran el
      árbol de Rust: vive fuera de `packages/` y no toca `scripts/workspaces.test.ts`. El árbol de
      Rust tiene su propio listón: `bun run desktop:check` (`cargo fmt --check`, `cargo clippy
      -- -D warnings`, `cargo test`), ejecutado por el CI.

## Boundaries

**Always**

- La ventana carga el origen local; el sidecar se lanza sin puerto y sin rutas de datos.
- Todo proceso que se lanza se registra y se cierra: al cerrar la ventana **no queda nada vivo**.
- El token de arranque no se guarda en ningún sitio: vive en la URL que se le da a la ventana, en
  memoria.
- `stdout` del sidecar se drena siempre, aunque no haya nada que leer.

**Ask first**

- Cambiar el paquete de empaquetado (jubilar `scripts/package.ts` o `packaging/`).
- Añadir cualquier capacidad de Tauri al webview (IPC, opener, fs): es abrir una puerta que hoy no
  existe.
- Meter la interfaz dentro de Tauri como recursos (`frontendDist` / `tauri://`).

**Never**

- Escuchar en otra cosa que `127.0.0.1`.
- Escribir en disco la URL de arranque, el token, o el `stdout` del sidecar.
- Duplicar la base de datos fijando `--data-dir` desde el anfitrión.
- Tocar SQLite desde Rust: la base es de `catalog-store`.
- Leer `NN_ANIME_BOOT` analizando la línea **humana**: se traduce, y el análisis se rompería el día
  que exista el catálogo del idioma que falta.

## Riesgos

1. **WebKitGTK no es Chromium.** La reproducción HLS dentro de la ventana depende de `MediaSource` y
   de los códecs del sistema en Linux, y de WKWebView en macOS. En Windows la evidencia del e2e
   transfiere, porque WebView2 es Chromium y `packages/web/e2e/player.e2e.ts` ya lo prueba. **En
   Linux se mide antes de prometer Linux**; si no va, la ficha lo dice y manda a `mpv`.
2. **macOS sin `PR_SET_PDEATHSIG`**: si el anfitrión muere de golpe, el servidor puede quedar vivo.
   Se mitiga con el cierre explícito y se declara aquí.
3. **Rust entra en el repositorio.** El anfitrión se queda en estas cinco responsabilidades; si
   crece, deja de ser un envoltorio y habrá que decirlo.
4. **Firma.** Sin certificados, el instalador del anfitrión hereda los avisos de SmartScreen y
   Gatekeeper que ya tiene el de la consola. Es una decisión de dinero, no de código.

## Open Questions

1. **¿La ventana recuerda tamaño y posición?** `tauri-plugin-window-state` lo resuelve, y es un plugin
   más; hoy el CLI no recuerda nada de eso.
2. **¿Un icono de bandeja para parar el servidor?** Hoy el servidor se para cerrando la ventana. La
   bandeja es otra superficie y otro plugin: no entra sin pedirlo.
