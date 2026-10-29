//! La ventana de actualizaciones.
//!
//! La interfaz principal **no** puede hablar con Tauri: se sirve por HTTP desde
//! el servidor y la capability `default` no le concede ni un permiso. Esta
//! ventana es distinta a propósito: es una página empaquetada (`WebviewUrl::App`)
//! y es la única con IPC, con los permisos mínimos para lo que hace —
//! `updater:default`, `process:allow-restart` y las operaciones de ventana que
//! usa—, de modo que la superficie que hay que auditar sigue siendo una y pequeña.
//!
//! Vive **oculta** desde el arranque. La comprobación de novedades la hace la
//! propia página al cargar y cada tres horas; esta ventana sólo se enseña cuando
//! hay algo que contar. El menú de la bandeja la vuelve a enseñar y le pide otra
//! comprobación con el evento `buscar-actualizaciones`.
//!
//! **Dos formas de entregar la aplicación, dos formas de actualizarla:**
//!
//! - **Instalada** (el NSIS de Tauri): el plugin descarga el instalador, verifica
//!   la firma y lo ejecuta; el instalador reemplaza el binario.
//! - **Portable** (el `.exe` único, con o sin `portable.txt`): no hay instalador
//!   que ejecutar, así que se descarga el `.exe` nuevo, se verifica su firma
//!   minisign y se reemplaza el ejecutable **en marcha**: Windows deja renombrar
//!   un `.exe` en ejecución aunque no deja borrarlo. Se aparta el actual como
//!   `.viejo`, se pone el nuevo en su sitio, se arranca el nuevo con
//!   `--reemplazo-pid` y el viejo sale. El nuevo espera a que el viejo muera
//!   —para no chocar con la instancia única— y borra el `.viejo`.
//!
//! Lo que decide no es `portable.txt` (eso habla de dónde van los datos) sino
//! `entorno::instalada()`, que mira la entrada de desinstalación.

use std::io::Write;
use std::path::{Path, PathBuf};

use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// La etiqueta de la ventana. Es también la que usa su capability.
pub const ETIQUETA: &str = "actualizacion";

/// El evento con el que la bandeja pide una comprobación manual.
pub const EVENTO_BUSCAR: &str = "buscar-actualizaciones";

/// El repositorio del que salen las releases. El endpoint del updater está en
/// `tauri.conf.json` y apunta al mismo sitio; aquí sólo se construye el enlace
/// que se enseña cuando una actualización falla.
const REPOSITORIO: &str = "zxuru/nn-anime";

/// Lo que la página necesita saber y no puede deducir sola.
struct Contexto {
    instalada: bool,
    version: String,
    /// La base de las releases, sin versión: la página le añade `/tag/vX.Y.Z` de
    /// la versión que anuncia el updater, no la que está corriendo.
    releases: String,
    /// Lo que verifica el `.exe` portable. Se lee del `tauri.conf.json`, que es
    /// la única copia de la clave pública.
    pubkey: String,
    /// El perfil de WebView2 de esta ventana, dentro de la carpeta de datos.
    perfil: PathBuf,
}

/// Lo que la página manda cuando acepta una actualización portable.
#[derive(Debug, serde::Deserialize)]
pub struct DatosPortable {
    pub url: String,
    pub signature: String,
    pub version: String,
}

/// El progreso de la descarga, para la barra de la ventana.
#[derive(Clone, serde::Serialize)]
pub struct Progreso {
    pub descargado: u64,
    pub total: Option<u64>,
}

/// Crea la ventana oculta. Se llama una vez, al arrancar.
///
/// Un fallo aquí **no** puede impedir que arranque la aplicación: la ventana de
/// actualizaciones es una comodidad, no el producto. `main.rs` registra el error
/// y sigue.
pub fn crear(app: &AppHandle, instalada: bool, perfil: PathBuf) -> tauri::Result<()> {
    let version = env!("CARGO_PKG_VERSION").to_string();
    let pubkey = app
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|config| config.get("pubkey"))
        .and_then(|valor| valor.as_str())
        .unwrap_or_default()
        .to_string();

    app.manage(Contexto {
        instalada,
        releases: format!("https://github.com/{REPOSITORIO}/releases"),
        version,
        pubkey,
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

/// Sustituye el `.exe` que está corriendo por otro ya verificado.
///
/// Es el comando de la copia **portable**: no hay instalador que ejecutar. La
/// firma se verifica antes de tocar nada; si el reemplazo falla, se restaura el
/// original y se devuelve el motivo para que la ventana enseñe el enlace.
#[tauri::command]
pub async fn instalar_portable(
    app: AppHandle,
    datos: DatosPortable,
    progreso: Channel<Progreso>,
) -> Result<(), String> {
    let pubkey = app.state::<Contexto>().pubkey.clone();

    let exe = std::env::current_exe()
        .map_err(|error| format!("no se pudo leer la ruta del ejecutable: {error}"))?;
    let temporal = temporal_de(&exe);
    let _ = std::fs::remove_file(&temporal);

    // `reqwest` va con `rustls` sin proveedor; si el `check()` del plugin ya
    // instaló `ring`, esto no hace nada y devuelve error, que se ignora.
    let _ = rustls::crypto::ring::default_provider().install_default();

    let cliente = reqwest::Client::builder()
        .user_agent(concat!("nn-anime-desktop/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| format!("no se pudo preparar la descarga: {error}"))?;

    let mut respuesta = cliente
        .get(&datos.url)
        .send()
        .await
        .map_err(|error| format!("no se pudo descargar la actualización: {error}"))?;

    if !respuesta.status().is_success() {
        return Err(format!("la descarga respondió {}", respuesta.status()));
    }

    let total = respuesta.content_length();
    let mut archivo = std::fs::File::create(&temporal).map_err(|error| {
        format!(
            "no se pudo crear {} junto al ejecutable: {error}",
            temporal.display()
        )
    })?;
    let mut descargado = 0u64;

    while let Some(trozo) = respuesta
        .chunk()
        .await
        .map_err(|error| format!("la descarga se cortó: {error}"))?
    {
        archivo
            .write_all(&trozo)
            .map_err(|error| format!("no se pudo escribir la descarga: {error}"))?;
        descargado += trozo.len() as u64;
        let _ = progreso.send(Progreso { descargado, total });
    }

    archivo
        .flush()
        .map_err(|error| format!("no se pudo cerrar la descarga: {error}"))?;
    drop(archivo);

    if let Err(error) = verificar(&temporal, &datos.signature, &pubkey, &datos.version) {
        let _ = std::fs::remove_file(&temporal);
        return Err(error);
    }

    let viejo = match reemplazar(&exe, &temporal) {
        Ok(ruta) => ruta,
        Err(error) => {
            let _ = std::fs::remove_file(&temporal);
            return Err(error);
        }
    };

    let pid = std::process::id();
    let arrancado = std::process::Command::new(&exe)
        .arg("--reemplazo-pid")
        .arg(pid.to_string())
        .spawn();

    if let Err(error) = arrancado {
        // El nuevo no llegó a arrancar: se deshace el cambio y se deja el viejo.
        let _ = std::fs::remove_file(&exe);
        let _ = std::fs::rename(&viejo, &exe);

        return Err(format!("no se pudo arrancar la versión nueva: {error}"));
    }

    crate::registrar(&format!(
        "actualización: reemplazado el portable por la {}; arrancando la nueva",
        datos.version
    ));

    // `ExitRequested` cierra el servidor con orden; el proceso nuevo espera a que
    // este muera antes de registrarse como instancia única.
    app.exit(0);

    Ok(())
}

/// Construye la ventana, oculta o visible según el caso.
fn construir(app: &AppHandle, visible: bool) -> tauri::Result<()> {
    let Some(contexto) = app.try_state::<Contexto>() else {
        return Ok(());
    };

    // La página no puede leer `instalada`, la versión ni la URL de la release sin
    // IPC, y un comando más sería un permiso más. Se inyecta como un objeto
    // congelado en el arranque del webview; `{:?}` produce un literal de cadena
    // válido en JavaScript para los textos que se le pasan.
    let guion = format!(
        "globalThis.__NN_ACTUALIZACION = Object.freeze({{ instalada: {}, version: {:?}, releases: {:?} }});",
        contexto.instalada, contexto.version, contexto.releases
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

/// El nombre del archivo a medio descargar: junto al `.exe`, para que el
/// reemplazo sea un `rename` en el mismo volumen y no una copia entre discos.
fn temporal_de(exe: &Path) -> PathBuf {
    let nombre = exe
        .file_name()
        .map(|nombre| nombre.to_string_lossy().to_string())
        .unwrap_or_else(|| "nn-anime.exe".to_string());

    exe.with_file_name(format!(".{nombre}.nuevo"))
}

/// Aparta el ejecutable actual y pone el nuevo en su sitio.
///
/// Windows permite renombrar un `.exe` en ejecución, pero no borrarlo ni
/// sobrescribirlo. Por eso el orden es renombrar → poner → arrancar el nuevo.
/// Si el segundo paso falla, el primero se deshace: el usuario se queda con la
/// versión que tenía.
fn reemplazar(exe: &Path, nuevo: &Path) -> Result<PathBuf, String> {
    let nombre = exe
        .file_name()
        .map(|nombre| nombre.to_string_lossy().to_string())
        .ok_or_else(|| format!("{} no tiene nombre de archivo", exe.display()))?;
    let viejo = exe.with_file_name(format!(".{nombre}.viejo"));
    let _ = std::fs::remove_file(&viejo);

    std::fs::rename(exe, &viejo).map_err(|error| {
        format!(
            "no se pudo apartar el ejecutable actual ({}): {error}",
            exe.display()
        )
    })?;

    if let Err(error) = std::fs::rename(nuevo, exe) {
        let _ = std::fs::rename(&viejo, exe);

        return Err(format!(
            "no se pudo poner el ejecutable nuevo en {}: {error}",
            exe.display()
        ));
    }

    Ok(viejo)
}

/// Verifica la firma minisign del `.exe` descargado y la versión que firma.
///
/// La clave pública se decodifica igual que en `tauri-plugin-updater`: el valor
/// de `pubkey` es el base64 del archivo `.pub`, y la clave es su última línea.
/// La firma también llega en base64, con el comentario de confianza dentro; ahí
/// está la versión, y compararla es lo que impide que un `latest.json` manipulado
/// instale un binario viejo y firmado.
fn verificar(
    archivo: &Path,
    firma_base64: &str,
    pubkey_base64: &str,
    version: &str,
) -> Result<(), String> {
    use base64::Engine;

    let motor = base64::engine::general_purpose::STANDARD;
    let firma_texto = String::from_utf8(
        motor
            .decode(firma_base64)
            .map_err(|error| format!("la firma no es base64: {error}"))?,
    )
    .map_err(|error| format!("la firma no es texto: {error}"))?;

    let clave_texto = String::from_utf8(
        motor
            .decode(pubkey_base64)
            .map_err(|error| format!("la clave pública no es base64: {error}"))?,
    )
    .map_err(|error| format!("la clave pública no es texto: {error}"))?;

    let clave =
        minisign_verify::PublicKey::from_base64(clave_texto.lines().last().unwrap_or_default())
            .map_err(|error| format!("la clave pública no es válida: {error}"))?;

    let firma = minisign_verify::Signature::decode(&firma_texto)
        .map_err(|error| format!("la firma no es válida: {error}"))?;

    let bytes =
        std::fs::read(archivo).map_err(|error| format!("no se pudo leer la descarga: {error}"))?;

    clave
        .verify(&bytes, &firma, true)
        .map_err(|error| format!("la firma no cuadra con el archivo: {error}"))?;

    let firmada = version_firmada(&firma_texto)
        .ok_or_else(|| "la firma no dice para qué versión es".to_string())?;

    if firmada.trim_start_matches('v') != version.trim_start_matches('v') {
        return Err(format!(
            "la firma es de la versión {firmada} y se anunció {version}"
        ));
    }

    Ok(())
}

/// La versión que va en el comentario de confianza de la firma.
fn version_firmada(firma: &str) -> Option<&str> {
    firma
        .lines()
        .find_map(|linea| linea.strip_prefix("trusted comment: "))
        .and_then(|comentario| {
            comentario
                .split('\t')
                .find_map(|campo| campo.strip_prefix("version:"))
        })
}

/// El proceso que arranca la versión nueva espera a que el viejo salga.
///
/// Es lo que evita que el plugin de instancia única vea al viejo, enfoque su
/// ventana y termine el nuevo antes de empezar. Se llama al principio de `main`,
/// antes de preparar la raíz de datos: el servidor viejo tiene que haber muerto
/// para que el nuevo no se pelee por la base.
pub fn esperar_reemplazo() {
    let Some(pid) = argumento("--reemplazo-pid").and_then(|valor| valor.parse::<u32>().ok()) else {
        return;
    };

    esperar_a(pid);
    limpiar_viejos();
}

/// Lee `--nombre valor` de la línea de comandos.
fn argumento(nombre: &str) -> Option<String> {
    let mut args = std::env::args();

    while let Some(arg) = args.next() {
        if arg == nombre {
            return args.next();
        }
    }

    None
}

fn esperar_a(pid: u32) {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::Storage::FileSystem::SYNCHRONIZE;
    use windows_sys::Win32::System::Threading::{OpenProcess, WaitForSingleObject};

    // SAFETY: sólo se pide el derecho de sincronización; si falla devuelve nulo y
    // no hay nada que cerrar.
    let handle = unsafe { OpenProcess(SYNCHRONIZE, 0, pid) };

    if handle.is_null() {
        return;
    }

    // 15 s: cerrar el servidor y salir no tarda eso. Si el viejo se atasca, se
    // sigue igual y el plugin de instancia única decidirá.
    // SAFETY: el handle lo devolvió `OpenProcess` y no se ha cerrado.
    unsafe {
        WaitForSingleObject(handle, 15_000);
        CloseHandle(handle);
    }
}

/// Borra los `.viejo` y `.nuevo` que dejó un reemplazo.
///
/// El `.viejo` sigue existiendo hasta que el proceso viejo muere, así que esto se
/// llama **después** de esperarlo. Un `.nuevo` suelto es una descarga que no
/// llegó a reemplazar nada.
fn limpiar_viejos() {
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let Some(dir) = exe.parent() else {
        return;
    };
    let Ok(entradas) = std::fs::read_dir(dir) else {
        return;
    };

    for entrada in entradas.flatten() {
        let nombre = entrada.file_name();
        let nombre = nombre.to_string_lossy();

        if nombre.ends_with(".viejo") || nombre.ends_with(".nuevo") {
            let _ = std::fs::remove_file(entrada.path());
        }
    }
}

#[cfg(test)]
mod pruebas {
    use super::{reemplazar, version_firmada};
    use std::path::PathBuf;

    fn directorio() -> PathBuf {
        let unico = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|tiempo| tiempo.as_nanos())
            .unwrap_or(0);
        let ruta =
            std::env::temp_dir().join(format!("nn-anime-prueba-{}-{unico}", std::process::id()));

        std::fs::create_dir_all(&ruta).expect("directorio de prueba");

        ruta
    }

    #[test]
    fn el_reemplazo_deja_el_nuevo_en_su_sitio_y_el_viejo_aparte() {
        let dir = directorio();
        let exe = dir.join("nn-anime.exe");
        let nuevo = dir.join(".nn-anime.exe.nuevo");
        std::fs::write(&exe, b"viejo").expect("exe");
        std::fs::write(&nuevo, b"nuevo").expect("nuevo");

        let viejo = reemplazar(&exe, &nuevo).expect("reemplazo");

        assert_eq!(std::fs::read(&exe).expect("exe nuevo"), b"nuevo");
        assert_eq!(std::fs::read(&viejo).expect("viejo"), b"viejo");
        assert!(!nuevo.exists());

        std::fs::remove_dir_all(&dir).expect("limpieza");
    }

    #[test]
    fn si_el_nuevo_no_esta_se_restaura_el_viejo() {
        let dir = directorio();
        let exe = dir.join("nn-anime.exe");
        std::fs::write(&exe, b"viejo").expect("exe");

        let resultado = reemplazar(&exe, &dir.join("no-existe.exe"));

        assert!(resultado.is_err());
        assert_eq!(std::fs::read(&exe).expect("exe restaurado"), b"viejo");

        std::fs::remove_dir_all(&dir).expect("limpieza");
    }

    #[test]
    fn la_version_firmada_se_lee_del_comentario_de_confianza() {
        let firma = concat!(
            "untrusted comment: firma\n",
            "RUfirma\n",
            "trusted comment: timestamp:1\tfile:payload\tversion:9.9.9\n",
            "R2firma"
        );

        assert_eq!(version_firmada(firma), Some("9.9.9"));
        assert_eq!(
            version_firmada("trusted comment: timestamp:1\tfile:x"),
            None
        );
    }
}
