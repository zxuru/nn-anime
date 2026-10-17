# Propuesta de módulo: `desktop` — la ventana propia

**Módulo nuevo.** No existe `docs/specs/SPEC-desktop.md`: este archivo es la propuesta para
crearlo. **Estado:** propuesta, sin aprobar, y **sin implementar**: en esta máquina no hay `rustc` ni
`cargo`. Contexto y mediciones completas en `docs/estudio-tauri.md`.

## Objective

Que nn-anime se abra en **su ventana**, con su icono, sin terminal — encima del empaquetado que ya
existe (`scripts/package.ts`: ejecutable autocontenido e instaladores de las tres plataformas). Hoy lo
instalado abre una consola, y lo dice su propio `.nsi`:

> El acceso abre el ejecutable, que es una aplicación de consola: la ventana que aparece **es** la
> aplicación mientras vive, y cerrarla la apaga.

Éxito significa, en las tres plataformas:

1. El acceso del escritorio abre una **ventana** con la aplicación dentro, y no una consola.
2. Cerrar la ventana **apaga el servidor**: no queda ningún proceso vivo.
3. Un segundo lanzamiento **enfoca la ventana que ya está**, en vez de abrir un segundo servidor.
4. Un enlace externo de la interfaz abre el navegador del sistema, no se lleva la ventana.
5. Si el anfitrión muere de golpe, el servidor **no queda huérfano**.

## Contrato

**Qué es.** Un anfitrión de ventana. **Cinco** responsabilidades y ninguna más; el producto sigue
entero en `packages/`.

**1. Lanza el ejecutable que ya existe, como sidecar.**

```
<ruta del ejecutable de nn-anime> --no-open
```

- **No se le pasa `--port`**: el CLI ya sabe caer a un puerto libre y lo dice en su línea de arranque
  (paso 7 del spec del CLI). Fijarlo sería añadir una forma de fallar que no es del programa.
- **No se le pasa `--data-dir` ni `--config-dir`**: las resuelve el propio CLI. Es una decisión, no
  un descuido: si el anfitrión las fijara, la ventana y `bun run start` usarían **bases distintas** y
  el usuario vería dos aplicaciones.
- **No se le pasa `--lang`**: el idioma es del usuario, no del anfitrión.
- La salida del hijo va a un **archivo**, no por una tubería: una tubería se bloquea si nadie la
  vacía y el buffer se llena, y matar el sidecar por eso sería un fallo inventado.

**2. Lee su dirección de la línea legible por máquina.**

`NN_ANIME_BOOT {"port":N,"url":"…"}`, definida en `packages/core/src/boot-line.ts` (formato, esquema
y análisis viven juntos). La analiza el anfitrión con el mismo esquema: prefijo literal + JSON.

Y abre la ventana en esa URL con **`WebviewUrl::External(url)`** — API confirmada en `tauri 2.12.4`:
«An external URL. Must use either the `http` or `https` schemes.» El origen es
`http://127.0.0.1:<puerto>`, **nunca `tauri://`**:

- así la cookie de sesión (`HttpOnly; SameSite=Strict`), el guard de `Origin`
  (`packages/server/src/middleware/origin-guard.ts`, que sólo admite ese origen), el guard de `Host`,
  el CSP y los tickets opacos de `/stream/:ticket` siguen valiendo **sin tocar una línea**;
- con `tauri://localhost` el origen de **toda** petición mutante dejaría de ser el admitido y habría
  que abrir excepciones en dos guards. No se hace.

**3. Lo cierra pidiéndoselo, y con un seguro por si no contesta.**

Al cerrarse la ventana: escribe `shutdown\n` en la entrada estándar del hijo, espera un plazo corto y,
si no sale, lo mata. Medido sobre el ejecutable empaquetado: **sale con 0 en 17 ms**.

El seguro contra la muerte brusca del anfitrión es del sistema operativo, no del CLI: **Job Object**
con `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` en Windows y **`PR_SET_PDEATHSIG`** en Linux. macOS no tiene
equivalente: es un riesgo residual que se declara (§ Riesgos).

**4. Instancia única.** `tauri-plugin-single-instance` (exige **Rust ≥ 1.90**), que además enfoca la
ventana existente. Medido: hoy dos servidores conviven sobre la misma base sin decir nada, y cerrar
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

## Cómo se empaqueta: el binario vive **al lado**, no dentro

**No se usa `externalBin`.** El instalador que ya existe instala el ejecutable de consola; el
anfitrión se instala **junto a él** (mismo `$INSTDIR`, un `.app` con dos ejecutables, un AppImage con
los dos) y lo lanza como **hermano**. Tres motivos:

1. **No se duplica el motor.** `externalBin` incrustaría una segunda copia del ejecutable: 93,8 MB
   más por plataforma. Al lado, el anfitrión son unos pocos megabytes (≈ 5–15, estimado: no hay
   `rustc` en esta máquina para medirlo).
2. **La consola no desaparece.** Quien quiera `nn-anime "naruto"` desde una terminal lo sigue
   teniendo; el acceso del escritorio apunta a la ventana.
3. **El empaquetado probado se conserva.** `scripts/package.ts`, `packaging/` (NSIS por usuario con
   accesos, AppImage + `.deb` + `.rpm`, `.app` + `.dmg`), `release-please`, los `SHA256SUMS` y la
   matriz del CI siguen siendo el camino. Lo que se añade es **un paso más por plataforma**:
   `tauri build` produce el binario del anfitrión, y el instalador de siempre lo mete en el mismo
   directorio.

**Esta es la decisión abierta de la propuesta** (ver Open Questions 1). La alternativa —que Tauri
empaquete todo y `packaging/` se jubile— tira trabajo ya probado y deja una sola pieza que mantener;
tiene a favor que Tauri conoce las dependencias del webview de Linux mejor que el `nfpm.yaml`
artesanal.

## Boundaries

**Always**

- La ventana carga el origen local; el sidecar se lanza sin puerto y sin rutas de datos.
- Todo proceso que se lanza se registra y se cierra: al cerrar la ventana **no queda nada vivo**.
- El token de arranque no se guarda en ningún sitio: vive en la URL que se le da a la ventana.

**Ask first**

- Cambiar el paquete de empaquetado (jubilar `scripts/package.ts` o `packaging/`).
- Añadir cualquier capacidad de Tauri al webview (IPC, opener, fs): es abrir una puerta que hoy no
  existe.
- Meter la interfaz dentro de Tauri como recursos (`frontendDist` / `tauri://`).

**Never**

- Escuchar en otra cosa que `127.0.0.1`.
- Registrar el token de arranque ni la URL.
- Duplicar la base de datos fijando `--data-dir` desde el anfitrión.
- Tocar SQLite desde Rust: la base es de `catalog-store`.

## Success Criteria

Cada uno con la medición que lo sostiene.

- [ ] `bun run build && bun run package && tauri build` produce, en Windows, un instalador que deja
      ventana e icono, **sin consola**. Se mide instalando en una cuenta limpia y cerrando: no queda
      ningún proceso (`Get-Process`).
- [ ] Cerrar la ventana termina el servidor **con 0** en menos de un segundo. Medido hoy sobre el
      ejecutable: 17 ms.
- [ ] Un segundo lanzamiento enfoca la ventana existente y **no** arranca un segundo servidor. Se
      mide contando procesos y puertos de escucha.
- [ ] Matar el anfitrión desde el administrador de tareas **no** deja el servidor vivo (Windows, Job
      Object; Linux, `PR_SET_PDEATHSIG`).
- [ ] El enlace de AniList abre el navegador del sistema y la ventana sigue donde estaba.
- [ ] Sin `mpv`, la reproducción dentro de la ventana funciona en Windows (WebView2). **En Linux se
      mide antes de prometerlo** (riesgo 1).
- [ ] El listón entero sigue verde, y `bun run build`, `bun test` y `biome` **no** miran el árbol de
      Rust: vive fuera de `packages/` y no toca `scripts/workspaces.test.ts`.

## Lo que ya está medido, y por eso no se discute aquí

- La línea de arranque y el cierre por `stdin` (T134), verificados sobre el ejecutable empaquetado.
- El ejecutable empaquetado sirve la interfaz, sus recursos, el aviso de seguridad, canjea el token y
  aplica las migraciones (`smoke.ts`, 6/6, en el CI de las tres plataformas).
- El servidor **sobrevive** a quien lo lanza; dos instancias conviven sobre una base; un kill seco en
  Windows no ejecuta ni una tarea del cierre ordenado.
- `WebviewUrl::External` existe y exige `http`/`https` (tauri 2.12.4, 2026-10-14).
- WebView2 está instalado en la máquina de desarrollo (155.0.4283.45).

## Riesgos

1. **WebKitGTK no es Chromium.** La reproducción HLS dentro de la ventana depende de `MediaSource` y
   de los códecs del sistema en Linux, y de WKWebView en macOS. En la máquina de desarrollo **no hay
   `mpv`**: sin él, el reproductor del webview no es el plan B, es el plan A.
   **En Windows la evidencia del e2e transfiere**: el reproductor del navegador está verificado con
   Playwright sobre **Chromium** (`packages/web/e2e/player.e2e.ts`), y el webview de Windows es
   WebView2, que también es Chromium. En Linux y macOS no hay ninguna medición equivalente, y
   `docs/PLAN-B-HLS.md` ya avisa de que no hay pruebas con un upstream real de HLS: los fixtures son
   inventados. Se mide en Linux antes de prometer Linux.
2. **macOS sin `PR_SET_PDEATHSIG`**: si el anfitrión muere de golpe, el servidor puede quedar vivo.
   Se mitiga con el cierre explícito y se declara aquí.
3. **Rust entra en el repositorio.** El anfitrión se queda en estas cinco responsabilidades; si crece,
   deja de ser un envoltorio y habrá que decirlo.
4. **Firma.** Sin certificados, el instalador del anfitrión hereda los avisos de SmartScreen y
   Gatekeeper que ya tiene el de la consola.

## Open Questions

1. **¿Quién empaqueta: `scripts/package.ts` o Tauri?** La propuesta recomienda lo primero con un paso
   más, por lo dicho arriba. Es la decisión que hay que tomar antes de escribir Rust, porque cambia
   `tauri.conf.json` entero.
2. **¿Se ofrece el lanzamiento sin ventana?** Mantener el ejecutable de consola al lado dice que sí.
3. **¿La ventana recuerda tamaño y posición?** `tauri-plugin-window-state` lo resuelve, y es un plugin
   más; hoy el CLI no recuerda nada de eso.
4. **¿Un icono de bandeja para parar el servidor?** Hoy el servidor se para cerrando la ventana. La
   bandeja es otra superficie y otro plugin: no entra sin pedirlo.
