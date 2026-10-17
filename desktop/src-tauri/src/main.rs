//! El anfitrión de ventana de nn-anime.
//!
//! Cinco responsabilidades y ninguna más: lanzar el servidor que ya existe, leer
//! su dirección, abrir la ventana en ella, cerrarlo cuando la ventana se cierre y
//! no dejar nada vivo. El producto sigue entero en `packages/`.
//!
//! **La ventana carga `http://127.0.0.1:<puerto>`, nunca `tauri://`.** Empaquetar
//! la interfaz como recursos de Tauri cambiaría el `Origin` del webview, y con él
//! dejarían de valer la cookie `HttpOnly; SameSite=Strict`, el guard de `Origin`
//! del servidor y la CSP: toda petición mutante daría 403. Aquí el webview es un
//! navegador sin cromo, y el modelo de amenaza de `SECURITY.md` no cambia.
//!
//! En Windows, `windows_subsystem = "windows"` es lo que hace que el **anfitrión**
//! no abra consola: sin él, el acceso del escritorio volvería a enseñar la ventana
//! negra que este módulo viene a quitar. El servidor **sí** es un binario de
//! consola, y por eso se lanza con `CREATE_NO_WINDOW` (ver `sidecar.rs`).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod boot_line;
mod browser;
mod guards;
mod sidecar;

use std::io::Write;
use std::sync::Mutex;

use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

/// La etiqueta de la única ventana.
const LABEL: &str = "main";

const TITULO: &str = "nn-anime";
const ANCHO: f64 = 1280.0;
const ALTO: f64 = 800.0;
const ANCHO_MINIMO: f64 = 900.0;
const ALTO_MINIMO: f64 = 600.0;

/// Lo que vive mientras vive la ventana.
///
/// El servidor está en el estado de la aplicación para poder cerrarlo cuando la
/// ventana se cierre: si viviera sólo en el hilo que lo lanzó, no habría forma de
/// pedirle el cierre desde el manejador de eventos.
struct Estado {
    sidecar: Mutex<Option<sidecar::Sidecar>>,
}

fn main() {
    let app = tauri::Builder::default()
        // El primero que se registra, y tiene que ser así: el plugin decide si
        // este proceso es el dueño de la aplicación **antes** de que se cree
        // ninguna ventana. Un segundo lanzamiento no arranca otro servidor;
        // enfoca el que ya está, que es lo que espera quien vuelve a pulsar el
        // acceso del escritorio.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(ventana) = app.get_webview_window(LABEL) {
                let _ = ventana.unminimize();
                let _ = ventana.show();
                let _ = ventana.set_focus();
            }
        }))
        .setup(|app| {
            let handle = app.handle().clone();

            // En un hilo propio: esperar hasta 30 s a que el servidor anuncie su
            // dirección no puede bloquear el bucle de eventos, que es quien tiene
            // que crear la ventana cuando la dirección llegue.
            //
            // Y el hilo **se queda vivo** a propósito. En Linux, el
            // `PR_SET_PDEATHSIG` de `guards.rs` se dispara cuando muere **el hilo
            // que creó el proceso, no el proceso** —está en las CAVEATS de
            // `man 2 PR_SET_PDEATHSIG`—, así que un hilo que terminara al arrancar
            // le mandaría un SIGTERM al servidor nada más abrirse la ventana. El
            // aparcamiento lo mantiene vivo hasta que termina el proceso, que es
            // justo lo que el seguro quiere decir.
            std::thread::spawn(move || {
                arrancar(handle);
                std::thread::park();
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .unwrap_or_else(|error| {
            registrar(&format!("no se pudo construir la aplicación: {error}"));
            std::process::exit(1);
        });

    // `ExitRequested` llega cuando se cierra la última ventana, que es el momento
    // de apagar el servidor **con orden**: se le pide el cierre y se le espera.
    app.run(|handle, evento| {
        if let RunEvent::ExitRequested { .. } = evento {
            cerrar_servidor(handle);
        }
    });
}

/// Lanza el hermano, lee su dirección y abre la ventana en ella.
fn arrancar(handle: AppHandle) {
    let servidor = match sidecar::start() {
        Ok(servidor) => servidor,
        Err(error) => {
            avisar_fallo(&handle, &format!("{error}"));
            return;
        }
    };

    // El puerto es lo único de la línea de arranque que se puede registrar: la
    // URL lleva el token de un solo uso, y un registro se copia y se comparte.
    let puerto = servidor.port();

    let url = match tauri::Url::parse(servidor.url()) {
        Ok(url) => url,
        Err(error) => {
            servidor.shutdown();
            avisar_fallo(
                &handle,
                &format!("la dirección del servidor no es válida: {error}"),
            );
            return;
        }
    };

    handle.manage(Estado {
        sidecar: Mutex::new(Some(servidor)),
    });

    registrar(&format!("el servidor escucha en el puerto {puerto}"));

    let para_la_ventana = handle.clone();
    let resultado = handle.run_on_main_thread(move || {
        if let Err(error) = abrir_ventana(&para_la_ventana, url) {
            registrar(&format!("no se pudo abrir la ventana: {error}"));
            cerrar_servidor(&para_la_ventana);
            para_la_ventana.exit(1);
        }
    });

    if let Err(error) = resultado {
        registrar(&format!(
            "no se pudo llegar al hilo de la interfaz: {error}"
        ));
        cerrar_servidor(&handle);
        handle.exit(1);
    }
}

/// Enseña el motivo cuando el servidor no llega a arrancar.
///
/// Sin esto, un fallo de arranque deja **ninguna ventana y ningún mensaje**: en
/// Windows el anfitrión es un binario de subsistema `windows`, así que tampoco hay
/// consola donde leerlo, y quien lo abre desde el acceso ve que no pasa nada. Se
/// enseña la página que **viaja dentro del binario** —el `frontendDist`, o sea el
/// aviso de relleno— y no una URL: aquí ya se sabe que no hay servidor al que pedirle
/// nada, así que no hay sesión, ni guards, ni token de por medio.
///
/// El motivo completo queda además en el registro, que es donde se diagnostica.
fn avisar_fallo(handle: &AppHandle, motivo: &str) {
    registrar(motivo);

    let para_la_ventana = handle.clone();
    let resultado = handle.run_on_main_thread(move || {
        // La misma ventana que abre el camino bueno, con la página de dentro en vez
        // de la dirección del servidor.
        let aviso = WebviewWindowBuilder::new(
            &para_la_ventana,
            LABEL,
            WebviewUrl::App("index.html".into()),
        )
        .title(TITULO)
        .inner_size(ANCHO, ALTO)
        .build();

        if let Err(error) = aviso {
            registrar(&format!(
                "ni siquiera se pudo abrir el aviso del fallo: {error}"
            ));
            para_la_ventana.exit(1);
        }
    });

    if let Err(error) = resultado {
        registrar(&format!(
            "no se pudo llegar al hilo de la interfaz: {error}"
        ));
        handle.exit(1);
    }
}

fn abrir_ventana(handle: &AppHandle, url: tauri::Url) -> tauri::Result<()> {
    // El origen local es lo único que se queda dentro de la ventana. Se calcula
    // **antes** de mover la URL al constructor, que se la queda.
    let local = url.origin().ascii_serialization();

    WebviewWindowBuilder::new(handle, LABEL, WebviewUrl::External(url))
        .title(TITULO)
        .inner_size(ANCHO, ALTO)
        .min_inner_size(ANCHO_MINIMO, ALTO_MINIMO)
        .on_navigation(move |destino| {
            if destino.origin().ascii_serialization() == local {
                return true;
            }

            // Fuera de la aplicación: al navegador del sistema, y la ventana se
            // queda donde estaba. Si el abridor falla, se registra y la
            // navegación se cancela igual: llevarse la ventana a un sitio que no
            // es la aplicación es peor que no abrir nada.
            if let Err(error) = browser::open(destino.as_str()) {
                registrar(&format!(
                    "no se pudo abrir el enlace en el navegador: {error}"
                ));
            }

            false
        })
        .build()?;

    Ok(())
}

/// Le pide el cierre al servidor y espera a que salga.
///
/// Es idempotente por construcción: `take()` deja el hueco vacío, así que una
/// segunda llamada —el cierre de la ventana y después la salida del proceso— no
/// vuelve a tocar un servidor que ya no está.
fn cerrar_servidor(handle: &AppHandle) {
    let Some(estado) = handle.try_state::<Estado>() else {
        return;
    };

    let Ok(mut guardia) = estado.sidecar.lock() else {
        return;
    };

    if let Some(servidor) = guardia.take() {
        servidor.shutdown();
    }
}

/// Escribe una línea en el registro del anfitrión, y también en `stderr`.
///
/// No hay ventana todavía cuando esto se usa —los fallos de arranque ocurren
/// antes de que exista—, así que el registro es el único sitio donde se puede
/// leer qué pasó. **Nunca se le pasa la URL**: lleva el token.
fn registrar(mensaje: &str) {
    let linea = format!("nn-anime-desktop: {mensaje}\n");

    eprint!("{linea}");

    if let Ok(mut archivo) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(sidecar::log_path())
    {
        let _ = archivo.write_all(linea.as_bytes());
    }
}
