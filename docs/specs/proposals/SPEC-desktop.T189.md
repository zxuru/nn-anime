# Propuesta: auto-actualización en el anfitrión (T189)

**Estado:** propuesta. No toca `docs/specs/SPEC-desktop.md`; lo integra su dueño.

**Motivo:** el spec dice «Sin IPC» y lista el updater entre lo que se pierde. T189 añade
auto-actualización, así que el contrato del módulo cambia en dos puntos y hay que decidir si se
acepta tal cual.

## Lo que cambia

1. **La ventana principal sigue sin IPC.** `capabilities/default.json` sigue con `permissions: []` y
   la ventana principal sigue cargando `http://127.0.0.1:<puerto>`. El *Never* «añadir cualquier
   capacidad de Tauri al webview» se mantiene para esa ventana.

2. **Hay una segunda ventana, empaquetada, que sí tiene IPC.** `actualizacion.rs` crea una ventana
   oculta (`actualizacion`) con `WebviewUrl::App("actualizacion.html")` y su propia capability
   (`capabilities/actualizacion.json`) con `core:default`, `updater:default` y
   `process:allow-restart`. No tiene shell, ni fs, ni http, ni opener: los enlaces externos se abren
   con `browser::open` desde `on_navigation`, como ya hacía la ventana principal. El único comando
   propio es `registrar_actualizacion`, que escribe una línea en el registro.

3. **El instalador de Windows deja de ser un `.nsi` escrito a mano.** Lo arma `tauri-bundler` con
   `tauri-action` (`tagName`, `releaseDraft: true`), que es lo único que produce el `.sig` y el
   `latest.json` con la clave del updater. macOS y Linux siguen con `scripts/package.ts`.

4. **El updater está activo sólo en Windows.** `latest.json` anuncia `windows-x86_64`,
   `windows-x86_64-nsis` y `windows-x86_64-portable`; no hay bundles `darwin-*`/`linux-*`, así que
   allí el menú y la ventana no existen (`#[cfg(windows)]`). Cuando esos instaladores se migren, se
   cae el `cfg`.

5. **La copia portable se reemplaza en sitio.** El `.exe` único (con o sin `portable.txt`) descarga
   `windows-x86_64-portable` de `latest.json`, verifica su firma minisign y su versión, aparta el
   `.exe` que está corriendo con un `rename`, pone el nuevo, lo arranca con `--reemplazo-pid` y sale;
   el nuevo espera a que el viejo muera y borra el `.viejo`. Si el medio es de sólo lectura o el
   reemplazo falla, se restaura el original y la ventana enseña el enlace. **No** se pregunta por
   `portable.txt` para esto: eso decide dónde van los datos, y un `.exe` suelto sin ese archivo guarda
   la base en el perfil igual que el instalado. La marca es `entorno::instalada()`, que mira la
   entrada de desinstalación (`InstallLocation` o el `InstallDir` del `.nsi` viejo).

## Lo que no cambia

- El servidor, su modelo de amenaza y el `Origin` de la ventana principal.
- El archivo único de Windows y su orden de compilación (servidor → anfitrión → único).
- La firma de código de Windows: sigue siendo condicional y por `signtool`.
