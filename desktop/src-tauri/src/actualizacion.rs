//! La ventana de actualizaciones.
//!
//! La interfaz principal **no** puede hablar con Tauri: se sirve por HTTP desde
//! el servidor y la capability `default` no le concede ni un permiso. Esta
//! ventana es distinta a propósito: es una página empaquetada (`WebviewUrl::App`)
//! y es la única con IPC, con los permisos mínimos para lo que hace —
//! `updater:default` y `process:allow-restart` —, de modo que la superficie que
//! hay que auditar sigue siendo una y pequeña.
//!
//! Vive **oculta** desde el arranque. La comprobación de novedades la hace la
//! propia página al cargar y cada tres horas; esta ventana sólo se enseña cuando
//! hay algo que contar. El menú de la bandeja la vuelve a enseñar y le pide otra
//! comprobación con el evento `buscar-actualizaciones`.
//!
//! **Modo portable:** el updater reemplaza el ejecutable que está corriendo y en
//! un `.exe` portable eso significaría escribir al lado del usuario, donde puede
//! no haber permiso y desde donde el instalador de Windows no sabe actualizar. En
//! ese caso la ventana sólo anuncia la versión nueva y enlaza a la release; no
//! descarga ni instala. Lo decide `entorno::Raiz::portable`, que ya distingue las
//! dos instalaciones al arrancar.

use std::path::PathBuf;

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// La etiqueta de la ventana. Es también la que usa su capability.
pub const ETIQUETA: &str = "actualizacion";

/// El evento con el que la bandeja pide una comprobación manual.
pub const EVENTO_BUSCAR: &str = "buscar-actualizaciones";

/// El repositorio del que salen las releases. El endpoint del updater está en
/// `tauri.conf.json` y apunta al mismo sitio; aquí sólo se construye el enlace
/// que se enseña cuando la aplicación corre en modo portable.
const REPOSITORIO: &str = "zxuru/nn-anime";

/// Lo que la página necesita saber y no puede deducir sola.
struct Contexto {
    portable: bool,
    version: String,
    /// La base de las releases, sin versión: la página le añade `/tag/vX.Y.Z` de
    /// la versión que anuncia el updater, no la que está corriendo.
    releases: String,
    /// El perfil de WebView2 de esta ventana, dentro de la carpeta de datos.
    perfil: PathBuf,
}

/// Crea la ventana oculta. Se llama una vez, al arrancar.
///
/// Un fallo aquí **no** puede impedir que arranque la aplicación: la ventana de
/// actualizaciones es una comodidad, no el producto. `main.rs` registra el error
/// y sigue.
pub fn crear(app: &AppHandle, portable: bool, perfil: PathBuf) -> tauri::Result<()> {
    let version = env!("CARGO_PKG_VERSION").to_string();

    app.manage(Contexto {
        portable,
        releases: format!("https://github.com/{REPOSITORIO}/releases"),
        version,
        perfil,
    });

    construir(app, false)
}

/// Enseña la ventana, la trae al frente y le pide una comprobación.
///
/// Si la ventana ya no existe —la destruyó el sistema o un cierre que no pasó por
/// el manejador de `main.rs`— se vuelve a crear ya visible: su carga hace la
/// comprobación, así que no hace falta emitir nada.
pub fn mostrar(app: &AppHandle) {
    if let Some(ventana) = app.get_webview_window(ETIQUETA) {
        // En este orden: `show` sobre una ventana minimizada la deja minimizada
        // en algunos gestores.
        let _ = ventana.unminimize();
        let _ = ventana.show();
        let _ = ventana.set_focus();
        let _ = ventana.emit(EVENTO_BUSCAR, ());

        return;
    }

    if let Err(error) = construir(app, true) {
        crate::registrar(&format!(
            "no se pudo volver a abrir la ventana de actualizaciones: {error}"
        ));
    }
}

/// El comando con el que la página escribe en el mismo registro que el anfitrión.
///
/// El webview no puede tocar archivos, y el registro es donde se diagnostica un
/// fallo de actualización —sin red, sin release, con una firma que no cuadra—.
/// Se recorta a una línea: el registro se lee con `Get-Content -Tail` y una
/// traza multilínea esconde justo la primera línea, que es la que dice qué pasó.
#[tauri::command]
pub fn registrar_actualizacion(mensaje: String) {
    let limpio = mensaje.replace(['\r', '\n'], " ");
    crate::registrar(&format!("actualización: {limpio}"));
}

/// Construye la ventana, oculta o visible según el caso.
fn construir(app: &AppHandle, visible: bool) -> tauri::Result<()> {
    let Some(contexto) = app.try_state::<Contexto>() else {
        return Ok(());
    };

    // La página no puede leer `portable`, la versión ni la URL de la release sin
    // IPC, y un comando más sería un permiso más. Se inyecta como un objeto
    // congelado en el arranque del webview; `{:?}` produce un literal de cadena
    // válido en JavaScript para los textos que se le pasan.
    let guion = format!(
        "globalThis.__NN_ACTUALIZACION = Object.freeze({{ portable: {}, version: {:?}, releases: {:?} }});",
        contexto.portable, contexto.version, contexto.releases
    );

    let ventana =
        WebviewWindowBuilder::new(app, ETIQUETA, WebviewUrl::App("actualizacion.html".into()))
            .title("nn-anime — actualización")
            .inner_size(560.0, 430.0)
            .resizable(false)
            .minimizable(false)
            .maximizable(false)
            .visible(visible)
            .focused(visible)
            // Oculta también en la barra de tareas mientras no hay nada que enseñar: si
            // apareciera como una ventana fantasma, sería una señal de vida que nadie
            // pidió.
            .skip_taskbar(!visible)
            .initialization_script(&guion)
            // Un perfil propio dentro de la carpeta de datos: compartir el de la ventana
            // principal haría que las dos se pisaran el almacenamiento del webview.
            .data_directory(contexto.perfil.clone())
            .on_navigation(|destino| {
                // La propia página y sus anclas. Cualquier otra cosa es un enlace externo:
                // se abre en el navegador del sistema, que es lo que ya hace `main.rs`
                // con la ventana principal, y la ventana de actualizaciones se queda
                // donde está.
                if destino.scheme() == "tauri" || destino.host_str() == Some("tauri.localhost") {
                    return true;
                }

                if let Err(error) = crate::browser::open(destino.as_str()) {
                    crate::registrar(&format!(
                        "no se pudo abrir el enlace de la actualización en el navegador: {error}"
                    ));
                }

                false
            })
            .build()?;

    // `visible(false)` ya la deja oculta, pero `show` en un segundo lanzamiento
    // —el plugin de instancia única— no la toca: se asegura aquí.
    if !visible {
        let _ = ventana.hide();
    }

    Ok(())
}
