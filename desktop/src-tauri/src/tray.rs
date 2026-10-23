//! El icono de la bandeja del sistema y su menú.
//!
//! Existe porque, mientras el servidor arranca, el anfitrión **no tiene ventana**:
//! la crea cuando el hermano anuncia su dirección. En ese hueco —y para siempre, si
//! el servidor falla y el aviso se cierra— un binario de subsistema `windows` no
//! deja rastro visible: no hay consola, no hay ventana y, sin esto, tampoco icono.
//! El icono es la señal de que el proceso sigue vivo aunque la ventana se oculte.
//!
//! Clic izquierdo: enseña la ventana. Clic derecho: el menú, con tres opciones y
//! ninguna más. Cerrar la ventana la **oculta** en vez de terminar la aplicación
//! (ver `main.rs`); sólo «Salir» la termina, y se lleva el icono por delante.
//!
//! Todo se construye desde Rust, así que no hace falta ninguna capacidad: el
//! webview sigue sin poder invocar ni un solo comando, que es el contrato de
//! `capabilities/default.json`.

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

/// El id del icono. Hace falta para quitarlo al salir.
pub const ID_TRAY: &str = "bandeja";

const ID_ABRIR: &str = "abrir";
const ID_ALTERNAR: &str = "alternar";
const ID_SALIR: &str = "salir";

/// El nombre que enseñan el tooltip y la primera opción del menú.
const NOMBRE: &str = "nn-anime";

/// El icono viaja **dentro** del binario.
///
/// Con `include_bytes!` y no con una ruta: instalado, el programa vive en
/// `%LOCALAPPDATA%\Programs\nn-anime` y la carpeta `packaging/icons` no existe.
/// Un icono que se lee del disco al arrancar sería un icono que falta en la
/// máquina de quien lo instaló, y sólo ahí.
const ICONO: &[u8] = include_bytes!("../../../packaging/icons/icon-32.png");

/// Lo que el menú necesita recordar entre pulsaciones.
///
/// Sólo la opción de alternar, porque es la única cuyo **texto** depende del
/// estado de la ventana. Los otros dos no cambian nunca.
pub struct Bandeja {
    alternar: MenuItem<tauri::Wry>,
}

/// Crea el icono y su menú. Se llama una vez, al arrancar.
pub fn crear(app: &AppHandle) -> tauri::Result<()> {
    // El texto inicial es «Mostrar» porque en este momento la ventana todavía no
    // existe: la crea el hilo del servidor cuando anuncia su dirección. Cuando
    // aparezca, `actualizar` lo pone en «Ocultar».
    let abrir = MenuItem::with_id(app, ID_ABRIR, format!("Abrir {NOMBRE}"), true, None::<&str>)?;
    let alternar = MenuItem::with_id(app, ID_ALTERNAR, "Mostrar ventana", true, None::<&str>)?;
    let salir = MenuItem::with_id(app, ID_SALIR, "Salir", true, None::<&str>)?;

    // Sin separadores: son tres opciones y el menú tiene que quedar corto.
    let menu = Menu::with_items(app, &[&abrir, &alternar, &salir])?;

    TrayIconBuilder::with_id(ID_TRAY)
        .icon(Image::from_bytes(ICONO)?)
        .tooltip(NOMBRE)
        .menu(&menu)
        // El menú, sólo con el botón derecho: con el izquierdo se abre la ventana,
        // que es lo que espera quien pulsa el icono de una aplicación.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, evento| match evento.id().as_ref() {
            ID_ABRIR => mostrar(app),
            ID_ALTERNAR => alternar_ventana(app),
            ID_SALIR => terminar(app),
            _ => {}
        })
        .on_tray_icon_event(|icono, evento| {
            // `Up` y no `Down`: en Windows el clic se completa al soltar, y
            // reaccionar al pulsar hace que un arrastre del icono abra la ventana.
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = evento
            {
                mostrar(icono.app_handle());
            }
        })
        .build(app)?;

    app.manage(Bandeja { alternar });

    Ok(())
}

/// Pone el texto de «Ocultar/Mostrar» de acuerdo con lo que se ve ahora.
///
/// Se llama después de cada cambio de visibilidad que hace este módulo, y también
/// desde `main.rs` al crear la ventana: si el texto se quedara fijo, el menú
/// mentiría sobre lo que hace.
pub fn actualizar(app: &AppHandle) {
    let Some(bandeja) = app.try_state::<Bandeja>() else {
        return;
    };

    let visible = app
        .get_webview_window(crate::LABEL)
        .and_then(|ventana| ventana.is_visible().ok())
        .unwrap_or(false);

    let texto = if visible {
        "Ocultar ventana"
    } else {
        "Mostrar ventana"
    };

    let _ = bandeja.alternar.set_text(texto);
}

/// Enseña la ventana: la restaura si está minimizada y le da el foco.
fn mostrar(app: &AppHandle) {
    if let Some(ventana) = app.get_webview_window(crate::LABEL) {
        // En este orden: `show` sobre una ventana minimizada la deja minimizada
        // en algunos gestores, así que se restaura primero.
        let _ = ventana.unminimize();
        let _ = ventana.show();
        let _ = ventana.set_focus();
    }

    actualizar(app);
}

/// Alterna entre ocultar y mostrar, según lo que haya en pantalla ahora mismo.
fn alternar_ventana(app: &AppHandle) {
    if let Some(ventana) = app.get_webview_window(crate::LABEL) {
        // Se pregunta por el estado real y no por el último texto del menú: el
        // texto puede haberse quedado viejo si la ventana se restauró desde la
        // barra de tareas.
        if ventana.is_visible().unwrap_or(false) {
            let _ = ventana.hide();
        } else {
            let _ = ventana.unminimize();
            let _ = ventana.show();
            let _ = ventana.set_focus();
        }
    }

    actualizar(app);
}

/// Termina la aplicación: quita el icono y sale.
///
/// Se llama `terminar` y no `salir` porque dentro de `crear` hay un `MenuItem`
/// que se llama `salir`, y una función tapada por una variable local no se puede
/// llamar: el compilador la lee como «esto no es una función».
fn terminar(app: &AppHandle) {
    // El icono se quita **antes** de salir. Si se dejara al proceso, Windows lo
    // retiraría igual, pero quedaría un instante en el que el menú sigue vivo y
    // la aplicación ya no.
    let _ = app.remove_tray_by_id(ID_TRAY);

    app.exit(0);
}
