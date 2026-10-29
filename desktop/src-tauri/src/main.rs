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
//!
//! **La única ventana con IPC es la de actualizaciones** (`actualizacion.rs`). La
//! principal sigue sin poder invocar ni un comando, que es el contrato de
//! `capabilities/default.json`; la de actualizaciones tiene su propia capability
//! con `updater:default` y `process:allow-restart`, nada más.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// La ventana de actualizaciones sólo tiene sentido en Windows mientras la release
// no publique bundles firmados para macOS y Linux: el updater busca
// `darwin-*`/`linux-*` en `latest.json` y no los hay, así que allí la ventana sólo
// podría enseñar un error. Cuando esos instaladores se migren, el `cfg` se cae.
#[cfg(windows)]
mod actualizacion;
mod boot_line;
mod browser;
mod embebido;
mod entorno;
mod guards;
mod sidecar;
mod tray;

use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{AppHandle, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

/// La etiqueta de la única ventana.
const LABEL: &str = "main";

/// Abre el diálogo nativo y devuelve la carpeta elegida.
///
/// Es el único comando de la aplicación. No lee ni escribe nada: la ruta vuelve
/// al webview y es el servidor quien la valida y la guarda. Un diálogo cancelado
/// es `None`, no un error.
#[tauri::command]
fn elegir_carpeta_descargas() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("Carpeta de descargas de nn-anime")
        .pick_folder()
        .map(|ruta| ruta.to_string_lossy().into_owned())
}

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

/// Lo que se puede pedir por línea de comandos.
///
/// Son dos banderas y ninguna más: todo lo demás vive en la ventana y en el menú
/// de la bandeja, que es donde se busca.
struct Opciones {
    /// `--diagnostico`: escribe rutas, versión, integridad y estado del servidor
    /// incrustado, y sale sin abrir ventana. Sustituye al viejo `DIAGNOSTICO.cmd`.
    diagnostico: bool,
    /// `--navegador`: abre la interfaz en el navegador del sistema en vez de en la
    /// ventana. Sustituye al viejo `ARRANCAR-EN-NAVEGADOR.cmd`.
    navegador: bool,
}

impl Opciones {
    fn leer() -> Self {
        let args: Vec<String> = std::env::args().skip(1).collect();

        Self {
            diagnostico: args.iter().any(|arg| arg == "--diagnostico"),
            navegador: args.iter().any(|arg| arg == "--navegador"),
        }
    }
}

fn main() {
    // Si este proceso es el que arranca la versión nueva de un reemplazo portable,
    // lo primero es esperar a que el viejo muera: si no, el plugin de instancia
    // única vería al viejo, enfocaría su ventana y terminaría éste.
    #[cfg(windows)]
    actualizacion::esperar_reemplazo();

    // Lo primero: dónde viven los datos. La comprobación es una escritura real y
    // se hace una sola vez; de ahí sale también el perfil de WebView2, para que
    // nada quede fuera de la carpeta de la aplicación.
    let raiz = entorno::preparar_raiz();

    // Primera línea, antes de tocar Tauri: si el proceso llega a ejecutarse, esto
    // queda escrito. Si el archivo no aparece, entonces el que no arrancó es el
    // proceso —bloqueado, o no era éste el que se abrió— y no la aplicación.
    //
    // Y antes, el motivo de cada ruta de registro que se descartó: si el archivo
    // acabó al lado del ejecutable en vez de en el perfil, aquí está por qué.
    for intento in sidecar::intentos_de_registro() {
        registrar(intento);
    }

    registrar(&format!(
        "arrancando nn-anime {}; registro en {}",
        embebido::VERSION,
        sidecar::log_path().display()
    ));

    registrar(&format!(
        "datos en {} ({})",
        raiz.ruta.display(),
        if raiz.portable {
            "portable"
        } else {
            "perfil del usuario"
        }
    ));

    // El nivel de integridad y el usuario, siempre en el registro. Con etiqueta
    // `Low` el perfil no se deja escribir y el respaldo es lo que mantiene la
    // aplicación en pie; saber en qué nivel corre ahorra horas de diagnóstico.
    entorno::comprobar();

    let opciones = Opciones::leer();

    if opciones.diagnostico {
        diagnostico(&raiz);
    }

    // `instalada` no es `raiz.portable`: la primera dice cómo se entregó el
    // binario (lo instaló el NSIS o es un `.exe` suelto) y la segunda dónde van los
    // datos. El updater necesita la primera para elegir el destino.
    #[cfg(windows)]
    let instalada = entorno::instalada();

    let actualizador = tauri_plugin_updater::Builder::new();
    #[cfg(windows)]
    let actualizador = if instalada {
        actualizador
    } else {
        actualizador.target("windows-x86_64-portable")
    };

    let app = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            elegir_carpeta_descargas,
            #[cfg(windows)]
            actualizacion::registrar_actualizacion,
            #[cfg(windows)]
            actualizacion::instalar_portable
        ])
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

            // Un segundo lanzamiento también deja la ventana visible, así que el
            // menú tiene que volver a decir «Ocultar».
            tray::actualizar(app);
        }))
        // El updater y el proceso, para la ventana de actualizaciones. Se
        // registran antes de crear ninguna ventana: sus comandos tienen que estar
        // ahí cuando la página cargue, que es cuando comprueba si hay novedades.
        .plugin(tauri_plugin_process::init())
        .plugin(actualizador.build())
        // La X **oculta**, no cierra. Sin esto, cerrar la única ventana termina el
        // proceso y se lleva el servidor por delante: quien cierra espera seguir
        // teniéndolo en la bandeja, no apagar la aplicación sin querer.
        //
        // La excepción es el aviso de fallo: si el servidor no llegó a arrancar no
        // hay nada que conservar, así que ahí la X sí termina. Se distingue por el
        // estado, que sólo existe cuando el hermano está vivo.
        .on_window_event(|ventana, evento| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = evento {
                // La ventana de actualizaciones se **oculta**, no se destruye: el
                // menú de la bandeja tiene que poder volver a enseñarla sin
                // recrear el webview ni perder lo que estaba diciendo.
                #[cfg(windows)]
                if ventana.label() == actualizacion::ETIQUETA {
                    api.prevent_close();
                    let _ = ventana.hide();
                    return;
                }

                if ventana.label() == LABEL && ventana.app_handle().try_state::<Estado>().is_some()
                {
                    api.prevent_close();
                    let _ = ventana.hide();
                    tray::actualizar(ventana.app_handle());
                }
            }
        })
        .setup(move |app| {
            // El icono **antes** que nada, y no después de la ventana: mientras el
            // servidor arranca no hay ventana, y hasta que exista el icono no hay
            // ninguna señal de que la aplicación esté viva. Si se creara junto a la
            // ventana, el hueco seguiría pareciendo «no pasa nada».
            tray::crear(app.handle())?;

            // La ventana de actualizaciones, oculta desde ya: comprueba al cargar
            // y cada tres horas, y sólo se enseña cuando hay una versión nueva o
            // cuando se pide desde la bandeja. Un fallo al crearla no puede
            // impedir que arranque la aplicación; se registra y se sigue.
            #[cfg(windows)]
            {
                let perfil_actualizaciones = raiz.webview().join("actualizacion");
                if let Err(error) =
                    actualizacion::crear(app.handle(), instalada, perfil_actualizaciones)
                {
                    registrar(&format!(
                        "no se pudo crear la ventana de actualizaciones: {error}"
                    ));
                }
            }

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
                arrancar(handle, raiz, opciones.navegador);
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

/// Extrae el servidor, lo lanza, lee su dirección y abre la ventana —o el
/// navegador, con `--navegador`.
fn arrancar(handle: AppHandle, raiz: entorno::Raiz, navegador: bool) {
    // Windows: el servidor viaja dentro y se extrae a la raíz de datos. macOS y
    // Linux: viaja al lado del anfitrión, dentro del paquete. La rama se elige por
    // lo que **se compiló dentro**, no por el sistema: un anfitrión sin servidor
    // embebido no debe intentar extraer cero bytes y ejecutarlos.
    let ruta = if embebido::hay_servidor() {
        match embebido::preparar(&raiz.ruta) {
            Ok(ruta) => ruta,
            Err(error) => {
                avisar_fallo(
                    &handle,
                    &raiz,
                    &format!(
                        "no se pudo extraer el servidor en {}: {error}",
                        raiz.ruta.display()
                    ),
                );
                return;
            }
        }
    } else {
        match sidecar::sibling_path() {
            Some(ruta) if ruta.exists() => ruta,
            _ => {
                avisar_fallo(
                    &handle,
                    &raiz,
                    "el anfitrión no lleva el servidor dentro y no lo encontró a su lado",
                );
                return;
            }
        }
    };

    registrar(&format!("servidor listo en {}", ruta.display()));

    let servidor = match sidecar::start(&ruta) {
        Ok(servidor) => servidor,
        // Con `avisar_fallo` y no sólo con `registrar`: este es el fallo **habitual**
        // y sin la ventana el anfitrión se queda vivo, sin interfaz y sin mensaje.
        Err(error) => {
            avisar_fallo(&handle, &raiz, &format!("{error}"));
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
                &raiz,
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
    let perfil = raiz.webview();
    let resultado = handle.run_on_main_thread(move || {
        // `--navegador`: la misma aplicación, en el navegador de siempre. Sirve
        // para sesiones donde no hay escritorio interactivo; el icono de la
        // bandeja sigue y «Salir» termina.
        if navegador {
            match browser::open(url.as_str()) {
                Ok(()) => registrar("interfaz abierta en el navegador"),
                Err(error) => registrar(&format!("no se pudo abrir el navegador: {error}")),
            }

            tray::actualizar(&para_la_ventana);

            return;
        }

        if let Err(error) = abrir_ventana(&para_la_ventana, url, perfil.clone()) {
            registrar(&format!(
                "no se pudo abrir la ventana: {error} (perfil de WebView2: {})",
                perfil.display()
            ));

            entorno::aviso_nativo(
                "nn-anime",
                &format!(
                    "El servidor arrancó, pero no se pudo abrir la ventana.\n\n{error}\n\n\
                     Prueba con --navegador para usarla en el navegador.\n\n\
                     El registro está en:\n{}",
                    sidecar::log_path().display()
                ),
            );

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
fn avisar_fallo(handle: &AppHandle, raiz: &entorno::Raiz, motivo: &str) {
    registrar(motivo);

    let para_la_ventana = handle.clone();
    let perfil = raiz.webview();
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
        .data_directory(perfil.clone())
        .build();

        if let Err(error) = aviso {
            registrar(&format!(
                "ni siquiera se pudo abrir el aviso del fallo: {error} (perfil de WebView2: {})",
                perfil.display()
            ));

            // El aviso de verdad no puede depender del webview ni de escribir
            // archivos: si la ventana falla —etiqueta `Low`, sesión sin
            // escritorio— un diálogo nativo sigue siendo posible, y es lo único
            // que impide que el fallo se quede en silencio.
            entorno::aviso_nativo(
                "nn-anime",
                &format!(
                    "No se pudo abrir la ventana ni su aviso.\n\n{error}\n\nEl registro está en:\n{}",
                    sidecar::log_path().display()
                ),
            );

            para_la_ventana.exit(1);
            return;
        }

        // Aquí también: el aviso es una ventana visible, así que el menú tiene que
        // ofrecer «Ocultar» y no «Mostrar».
        tray::actualizar(&para_la_ventana);
    });

    if let Err(error) = resultado {
        registrar(&format!(
            "no se pudo llegar al hilo de la interfaz: {error}"
        ));
        handle.exit(1);
    }
}

fn abrir_ventana(handle: &AppHandle, url: tauri::Url, perfil: PathBuf) -> tauri::Result<()> {
    // El origen local es lo único que se queda dentro de la ventana. Se calcula
    // **antes** de mover la URL al constructor, que se la queda.
    let local = url.origin().ascii_serialization();

    // Se registra **antes** de intentarlo: si el intento mata el proceso o se
    // queda colgado, esto ya está escrito. El origen no lleva el token.
    registrar(&format!(
        "abriendo la ventana en {local}; perfil de WebView2: {}",
        perfil.display()
    ));

    WebviewWindowBuilder::new(handle, LABEL, WebviewUrl::External(url))
        .title(TITULO)
        .inner_size(ANCHO, ALTO)
        .min_inner_size(ANCHO_MINIMO, ALTO_MINIMO)
        // El perfil del navegador interno vive con los datos, no en
        // `%LOCALAPPDATA%\<identificador>`: así borrar la carpeta de la aplicación
        // lo borra todo, y el respaldo portable se lleva también el webview.
        .data_directory(perfil)
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

    // Ya hay ventana visible: el menú pasa de «Mostrar» a «Ocultar».
    tray::actualizar(handle);

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

/// `--diagnostico`: escribe rutas, versión, integridad y estado del servidor, y
/// sale sin abrir nada.
///
/// Sustituye al viejo `DIAGNOSTICO.cmd`. En un binario de subsistema `windows` no
/// hay consola, así que el informe va a tres sitios: la salida estándar (por si
/// alguien redirige), un archivo junto a los datos y un diálogo nativo, que es lo
/// único que se ve al ejecutarlo desde el Explorador.
fn diagnostico(raiz: &entorno::Raiz) -> ! {
    let ejecutable = std::env::current_exe()
        .map(|ruta| ruta.display().to_string())
        .unwrap_or_else(|_| "(no se pudo leer)".to_string());

    let mut lineas = vec![
        format!("nn-anime {}", embebido::VERSION),
        format!("ejecutable: {}", ejecutable),
        format!(
            "datos:      {} ({})",
            raiz.ruta.display(),
            if raiz.portable {
                "portable"
            } else {
                "perfil del usuario"
            }
        ),
        format!("base:       {}", raiz.ruta.join("nn-anime.db").display()),
        format!("registro:   {}", sidecar::log_path().display()),
        format!("webview:    {}", raiz.webview().display()),
        format!("integridad: {}", entorno::descripcion()),
    ];

    lineas.extend(embebido::estado(&raiz.ruta));

    let texto = lineas.join("\n");

    println!("{texto}");

    let informe = raiz.ruta.join("diagnostico.txt");

    if let Err(error) = std::fs::write(&informe, &texto) {
        registrar(&format!("no se pudo escribir el informe: {error}"));
    }

    entorno::aviso_nativo(
        "nn-anime — diagnóstico",
        &format!("{texto}\n\nGuardado en:\n{}", informe.display()),
    );

    std::process::exit(0);
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
