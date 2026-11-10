//! El entorno donde corre el anfitrión: integridad, usuario y modo portable.
//!
//! Existe por un fallo que no es del código y que cuesta horas de diagnosticar:
//! un ejecutable con la etiqueta `Low Mandatory Level` corre a integridad baja y
//! Windows le prohíbe escribir en la carpeta del usuario y crear el perfil de
//! WebView2. El anfitrión es un binario de subsistema `windows`, así que en ese
//! estado no puede enseñar ninguna ventana y no hay consola: la aplicación queda
//! muda aunque todo lo demás esté bien.
//!
//! Por eso el nivel se **lee y se registra** al arrancar, y si es bajo se enseña
//! un diálogo nativo. `MessageBoxW` no depende de archivos ni del webview, que es
//! justo lo que sí falla en ese estado: es lo único que se puede enseñar.
//!
//! El modo portable vive aquí porque es la otra mitad del mismo problema: si los
//! datos no pueden ir al perfil del usuario, van junto al ejecutable.

use std::path::PathBuf;

/// El RID de la etiqueta `Low`. Por debajo o igual, Windows no deja escribir
/// hacia arriba y la aplicación no puede arrancar.
pub const INTEGRIDAD_BAJA: u32 = 0x1000;

const TITULO_AVISO: &str = "nn-anime";

/// El nombre de la carpeta de datos en Windows.
///
/// **No es `nn-anime`**: con el instalador de Tauri en modo `currentUser`, la
/// carpeta de instalación es `%LOCALAPPDATA%\nn-anime` (el nombre del producto), y
/// los datos no pueden vivir dentro de la carpeta que el instalador y la
/// actualización reemplazan. Van en una hermana, `%LOCALAPPDATA%\nn-anime-data`,
/// que el instalador ni conoce ni toca.
///
/// `cfg(any(windows, test))`: fuera de Windows sólo lo usa la prueba que compara
/// los dos nombres; en el binario de Linux no existe y así `clippy -D warnings`
/// no lo marca como código muerto.
#[cfg(any(windows, test))]
pub const NOMBRE_DATOS: &str = "nn-anime-data";

/// El nombre de la carpeta de instalación (el `productName` del bundle).
#[cfg(any(windows, test))]
const NOMBRE_INSTALACION: &str = "nn-anime";

/// Lo que se mueve de una instalación anterior, que guardaba los datos dentro de
/// la carpeta de instalación.
///
/// Es una lista cerrada y no «todo lo que no sea un `.exe`»: un barrido copiaría
/// binarios, accesos o restos del desinstalador a la carpeta de datos.
///
/// Sólo lo lee la migración de Windows: en Linux no existe y no hay código
/// muerto que marcar.
#[cfg(windows)]
const DATOS_HEREDADOS: &[&str] = &[
    "nn-anime.db",
    "nn-anime.db-wal",
    "nn-anime.db-shm",
    "backups",
    "config",
    "cache",
    "webview",
    "bin",
    "registro.log",
    "desktop.log",
    "diagnostico.txt",
];

/// El nombre de la etiqueta de integridad, para el registro.
pub fn nombre_nivel(rid: u32) -> &'static str {
    match rid {
        0x0000 => "sin etiqueta (Untrusted)",
        0x1000 => "Low",
        0x2000 => "Medium",
        0x3000 => "High",
        0x4000 => "System",
        _ => "desconocida",
    }
}

/// Dónde viven los datos de la aplicación.
pub struct Raiz {
    /// La carpeta que contiene la base, `config`, `cache`, `bin` y `webview`.
    pub ruta: PathBuf,
    /// `true` si está junto al ejecutable en vez de en el perfil del usuario.
    pub portable: bool,
}

impl Raiz {
    /// El perfil de WebView2, para no dejarlo en `%LOCALAPPDATA%\<identificador>`.
    pub fn webview(&self) -> PathBuf {
        self.ruta.join("webview")
    }
}

/// Decide dónde viven los datos y lo deja fijado en el entorno del proceso.
///
/// El orden es una decisión, no una casualidad:
///
/// 1. **`portable.txt` junto al ejecutable**: modo portable explícito. Quien lo
///    crea sabe lo que hace y no se le discute; sus datos viajan con el `.exe`,
///    y el reemplazo del ejecutable **no toca** esos archivos.
/// 2. **`%LOCALAPPDATA%\nn-anime-data`**: lo normal. Es **hermana** de la carpeta
///    de instalación (`%LOCALAPPDATA%\nn-anime`), no su hija: el instalador y la
///    actualización reemplazan su carpeta, y los datos no pueden estar ahí.
///    Sobreviven a borrar el `.exe`, a reinstalar y a actualizar.
/// 3. **La raíz XDG del usuario** en macOS y Linux, por el mismo motivo.
///
/// **No hay un tercer camino en el directorio del ejecutable.** Una caída
/// silenciosa ahí metía la base en la carpeta que el instalador y la
/// actualización portable reemplazan, que es exactamente donde no puede estar.
///
/// La comprobación es **una escritura de verdad**, no una mirada a los permisos:
/// es lo único que responde a la pregunta que importa. Se hace una vez al
/// arrancar y nunca más.
///
/// Si no hay ninguna escribible, se dice con un diálogo nativo —con las rutas
/// probadas y su error— y se sale: arrancar sin sitio donde guardar nada deja una
/// aplicación que falla más tarde y peor.
pub fn preparar_raiz() -> Raiz {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(std::path::Path::to_path_buf));

    // 1. Modo portable explícito.
    if let Some(dir) = &exe_dir {
        if dir.join("portable.txt").is_file() {
            let raiz = Raiz {
                ruta: dir.clone(),
                portable: true,
            };

            fijar(&raiz);

            return raiz;
        }
    }

    let mut intentos: Vec<String> = Vec::new();

    // 2. El perfil del usuario en Windows. La carpeta de datos es **hermana** de
    //    la de instalación (`%LOCALAPPDATA%\nn-anime-data` frente a
    //    `%LOCALAPPDATA%\nn-anime`), para que el instalador y la actualización no
    //    compartan carpeta con la base. Las instalaciones anteriores guardaban los
    //    datos dentro de la carpeta de instalación: se trasladan una sola vez.
    #[cfg(windows)]
    if let Some(perfil) = std::env::var_os("LOCALAPPDATA") {
        let perfil = std::path::PathBuf::from(perfil);
        let ruta = perfil.join(NOMBRE_DATOS);

        match probar_escritura(&ruta) {
            Ok(()) => {
                migrar_datos_heredados(&perfil.join(NOMBRE_INSTALACION), &ruta);
                let raiz = Raiz {
                    ruta,
                    portable: false,
                };

                fijar(&raiz);

                return raiz;
            }
            Err(error) => intentos.push(format!("{}: {error}", ruta.display())),
        }
    }

    // 2b. El perfil del usuario en macOS y Linux. Sin esto caería al directorio del
    //     ejecutable, que en un `.deb` es de root y en un AppImage está montado en
    //     sólo lectura: la aplicación no podría guardar nada y saldría con un aviso.
    //     Una sola raíz para datos, configuración y caché, como en Windows; es la
    //     que el anfitrión fija en `NN_ANIME_*` y la que documenta el README.
    #[cfg(not(windows))]
    {
        let base = std::env::var_os("XDG_DATA_HOME")
            .map(std::path::PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME")
                    .map(|home| std::path::PathBuf::from(home).join(".local").join("share"))
            });

        if let Some(base) = base {
            let ruta = base.join("nn-anime");

            match probar_escritura(&ruta) {
                Ok(()) => {
                    let raiz = Raiz {
                        ruta,
                        portable: false,
                    };

                    fijar(&raiz);

                    return raiz;
                }
                Err(error) => intentos.push(format!("{}: {error}", ruta.display())),
            }
        }
    }

    // 3. Nada más. Los datos **no** caen al directorio del ejecutable: es la
    //    carpeta del programa instalado o de la copia portable, y ahí el
    //    instalador y el reemplazo del `.exe` sí borran y escriben. Un fallo de
    //    escritura en el perfil se cuenta con el diálogo nativo y se sale; es
    //    mejor que arrancar con la base en un sitio que la próxima actualización
    //    puede llevarse por delante.
    let detalle = intentos.join("\n");

    crate::registrar(&format!("sin ubicación escribible:\n{detalle}"));

    nativo::aviso(
        TITULO_AVISO,
        &format!(
            "nn-anime no puede guardar sus datos y no puede arrancar.\n\n\
             Se probaron estas ubicaciones:\n{detalle}\n\n\
             nn-anime no guarda nada junto al ejecutable: revisa los permisos de tu \
             carpeta de usuario o crea portable.txt junto al programa si de verdad \
             quieres que los datos viajen con él."
        ),
    );

    std::process::exit(1);
}

/// Deja las tres variables que lee el servidor apuntando a la raíz elegida.
///
/// Se fijan siempre, también en el modo normal: sin ellas el servidor usaría
/// `%APPDATA%` para los ajustes y la caché en otro sitio, y los datos quedarían
/// repartidos en dos carpetas que nadie relaciona.
fn fijar(raiz: &Raiz) {
    std::env::set_var("NN_ANIME_DATA_DIR", &raiz.ruta);
    std::env::set_var("NN_ANIME_CONFIG_DIR", raiz.ruta.join("config"));
    std::env::set_var("NN_ANIME_CACHE_DIR", raiz.ruta.join("cache"));
}

/// Escribe y borra un archivo de prueba. Es la única comprobación que no miente.
fn probar_escritura(dir: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;

    let prueba = dir.join(".escritura");
    std::fs::write(&prueba, b"nn-anime")?;
    std::fs::remove_file(&prueba)?;

    Ok(())
}

/// Traslada los datos de una instalación anterior, que los guardaba dentro de la
/// carpeta de instalación.
///
/// Se hace **una sola vez** y sin tocar nada si la carpeta nueva ya tiene base:
/// una actualización futura no vuelve a mover nada, y si el traslado se corta a
/// medias el siguiente arranque lo retoma (la base sigue en el origen). El
/// `rename` es barato y atómico; si un archivo está bloqueado se registra y se
/// sigue, porque perder el arranque por una caché bloqueada sería peor que
/// volver a intentarlo.
///
/// La lista de lo que se mueve es cerrada (`DATOS_HEREDADOS`): un barrido se
/// llevaría ejecutables y restos del desinstalador.
#[cfg(windows)]
fn migrar_datos_heredados(instalacion: &std::path::Path, datos: &std::path::Path) {
    let base_vieja = instalacion.join("nn-anime.db");

    if datos.join("nn-anime.db").exists() || !base_vieja.exists() {
        return;
    }

    if let Err(error) = std::fs::create_dir_all(datos) {
        crate::registrar(&format!(
            "no se pudo preparar la carpeta de datos para migrar: {error}"
        ));
        return;
    }

    let mut movidos = 0u32;

    for nombre in DATOS_HEREDADOS {
        let origen = instalacion.join(nombre);
        if !origen.exists() {
            continue;
        }

        let destino = datos.join(nombre);
        if destino.exists() {
            continue;
        }

        match std::fs::rename(&origen, &destino) {
            Ok(()) => movidos += 1,
            Err(error) => crate::registrar(&format!(
                "no se pudo mover {origen:?} a {destino:?}: {error}; se reintentará en el próximo arranque"
            )),
        }
    }

    /*
     * Si la base no llegó a su sitio, **no se arranca**: la aplicación abriría
     * una base nueva, vacía, y el usuario vería su historial desaparecido aunque
     * los datos siguieran en la carpeta antigua. Es peor que no arrancar y decirlo.
     */
    if !datos.join("nn-anime.db").exists() && base_vieja.exists() {
        let mensaje = format!(
            "nn-anime encontró datos de una instalación anterior en {} pero no pudo \
             trasladarlos a {}.\n\n\
             La base y el historial siguen en la carpeta antigua, intactos. Revisa los \
             permisos de tu carpeta de usuario y vuelve a abrir nn-anime.",
            instalacion.display(),
            datos.display()
        );

        crate::registrar(&mensaje);
        nativo::aviso(TITULO_AVISO, &mensaje);
        std::process::exit(1);
    }

    crate::registrar(&format!(
        "datos de una instalación anterior trasladados fuera de la carpeta de instalación ({movidos} entradas)"
    ));
}

/// `true` si `ruta` está dentro de `padre`. Pura, para poder probarla.
///
/// Windows no distingue mayúsculas y una comparación de cadenas diría que
/// `C:\x\nn-anime2` está dentro de `C:\x\nn-anime`; por eso se compara
/// componente a componente.
#[cfg(test)]
pub fn dentro_de(ruta: &std::path::Path, padre: &std::path::Path) -> bool {
    let normalizar = |p: &std::path::Path| {
        p.components()
            .map(|c| c.as_os_str().to_string_lossy().to_lowercase())
            .collect::<Vec<_>>()
    };
    let de = normalizar(ruta);
    let en = normalizar(padre);

    de.len() > en.len() && de.starts_with(&en)
}

/// `true` si esta copia la instaló un instalador de nn-anime.
///
/// **No se pregunta por `portable.txt`.** Ese archivo decide dónde van los datos;
/// un `.exe` suelto sin él guarda la base en el perfil, igual que el instalado, y
/// confundir las dos cosas haría que la copia portable intentara ejecutar el NSIS
/// (que instala) en vez de reemplazarse a sí misma. La marca es la entrada de
/// desinstalación y su carpeta: si apunta a la carpeta de este ejecutable, está
/// instalado.
///
/// Se miran las dos claves que han escrito los instaladores de este proyecto:
/// `InstallLocation` (el NSIS de Tauri, desde T189) e `InstallDir` (el `.nsi`
/// escrito a mano de las releases anteriores). Sin la segunda, una 0.3.1 instalada
/// pasaría a tratarse como portable y perdería su desinstalador.
#[cfg(windows)]
pub fn instalada() -> bool {
    let Some(carpeta) = registro::carpeta_instalada() else {
        return false;
    };

    let Some(directorio) = std::env::current_exe()
        .ok()
        .and_then(|ruta| ruta.parent().map(std::path::Path::to_path_buf))
    else {
        return false;
    };

    misma_carpeta(&carpeta, &directorio)
}

#[cfg(not(windows))]
#[allow(dead_code)] // En Linux no hay updater de escritorio que pregunte por la instalación.
pub fn instalada() -> bool {
    false
}

/// Compara la carpeta que dice el registro con la del ejecutable.
///
/// El registro la guarda entre comillas y puede acabar en barra; la comparación
/// no distingue mayúsculas porque Windows tampoco. Es pura para que la prueba no
/// dependa de un registro de verdad.
///
/// En Linux sólo la usan las pruebas: el binario no tiene updater que la llame.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn misma_carpeta(registro: &str, ejecutable: &std::path::Path) -> bool {
    let registrada = registro
        .trim()
        .trim_matches('"')
        .trim_end_matches(['\\', '/']);
    let actual = ejecutable.to_string_lossy();
    let actual = actual.trim_end_matches(['\\', '/']);

    !registrada.is_empty() && registrada.eq_ignore_ascii_case(actual)
}

#[cfg(windows)]
mod registro {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_SZ};

    fn a_wide(texto: &str) -> Vec<u16> {
        OsStr::new(texto)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    /// Lee un `REG_SZ` de `HKCU`; `None` si la clave o el valor no están.
    fn leer(clave: &str, valor: &str) -> Option<String> {
        let clave = a_wide(clave);
        let valor = a_wide(valor);
        let mut tamano = 0u32;

        // SAFETY: las cadenas van terminadas en cero; con `pvdata` nulo la llamada
        // sólo mide y `pcbdata` apunta a un `u32` válido.
        let estado = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                clave.as_ptr(),
                valor.as_ptr(),
                RRF_RT_REG_SZ,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                &mut tamano,
            )
        };

        if estado != ERROR_SUCCESS || tamano == 0 {
            return None;
        }

        let mut buffer = vec![0u16; (tamano as usize / 2) + 1];

        // SAFETY: el buffer tiene al menos lo que midió la llamada anterior y
        // `pcbdata` vuelve a apuntar a un `u32` válido.
        let estado = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                clave.as_ptr(),
                valor.as_ptr(),
                RRF_RT_REG_SZ,
                std::ptr::null_mut(),
                buffer.as_mut_ptr().cast(),
                &mut tamano,
            )
        };

        if estado != ERROR_SUCCESS {
            return None;
        }

        let texto: String = String::from_utf16_lossy(&buffer);
        let texto = texto.trim_end_matches('\0').to_string();

        if texto.is_empty() {
            None
        } else {
            Some(texto)
        }
    }

    /// La carpeta que dejó cualquiera de los dos instaladores.
    pub fn carpeta_instalada() -> Option<String> {
        leer(
            r"Software\Microsoft\Windows\CurrentVersion\Uninstall\nn-anime",
            "InstallLocation",
        )
        .or_else(|| leer(r"Software\nn-anime", "InstallDir"))
    }
}

#[cfg(test)]
mod pruebas_instalada {
    use super::misma_carpeta;
    use std::path::Path;

    #[test]
    fn la_carpeta_del_registro_se_compara_sin_comillas_ni_barra() {
        assert!(misma_carpeta(
            "\"C:\\Users\\ana\\nn-anime\"",
            Path::new("C:\\Users\\ana\\nn-anime")
        ));
        assert!(misma_carpeta(
            "C:\\Users\\ana\\nn-anime\\",
            Path::new("C:\\Users\\ana\\nn-anime")
        ));
        assert!(misma_carpeta(
            "c:\\users\\ana\\nn-anime",
            Path::new("C:\\Users\\Ana\\nn-anime")
        ));
    }

    #[test]
    fn otra_carpeta_o_una_vacia_no_es_una_instalacion() {
        assert!(!misma_carpeta(
            "C:\\Users\\ana\\nn-anime",
            Path::new("D:\\portable\\nn-anime")
        ));
        assert!(!misma_carpeta("", Path::new("C:\\Users\\ana\\nn-anime")));
        assert!(!misma_carpeta(
            "\"\"",
            Path::new("C:\\Users\\ana\\nn-anime")
        ));
    }
}

/// Registra el usuario y el nivel de integridad del proceso.
///
/// Ya **no decide** si se arranca: quién puede guardar datos lo decide
/// `preparar_raiz` con una escritura de verdad, que es la prueba que no miente.
/// Un proceso `Low` puede seguir funcionando si el respaldo junto al ejecutable
/// es escribible, y ahí el aviso sobra.
pub fn comprobar() {
    crate::registrar(&format!("integridad: {}", descripcion()));

    if nativo::nivel().is_some_and(|rid| rid <= INTEGRIDAD_BAJA) {
        crate::registrar(
            "integridad baja: el perfil del usuario no se deja escribir desde este proceso; \
             se usará el respaldo si es escribible",
        );
    }
}

/// `Nivel (0xRID); usuario: DOMINIO\usuario`, para el registro y `--diagnostico`.
pub fn descripcion() -> String {
    let usuario = nativo::usuario().unwrap_or_else(|| "(no se pudo leer)".to_string());

    match nativo::nivel() {
        Some(rid) => format!("{} (0x{rid:04X}); usuario: {usuario}", nombre_nivel(rid)),
        None => format!("no se pudo leer; usuario: {usuario}"),
    }
}

/// Un aviso nativo. No usa el webview a propósito: se enseña justo cuando la
/// ventana no se puede crear.
pub fn aviso_nativo(titulo: &str, mensaje: &str) {
    nativo::aviso(titulo, mensaje);
}

#[cfg(windows)]
mod nativo {
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::Security::{
        GetSidSubAuthority, GetSidSubAuthorityCount, GetTokenInformation, LookupAccountSidW,
        TokenIntegrityLevel, TokenUser, TOKEN_MANDATORY_LABEL, TOKEN_QUERY, TOKEN_USER,
    };
    // `OpenProcessToken` vive en Threading, no en Security: es donde lo pone
    // `windows-sys`, aunque la llamada sea de advapi32.
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        MessageBoxW, MB_ICONWARNING, MB_OK, MB_TOPMOST,
    };

    /// El testigo del proceso, cerrado al salir del ámbito.
    struct Testigo(HANDLE);

    impl Drop for Testigo {
        fn drop(&mut self) {
            // SAFETY: el handle lo devolvió `OpenProcessToken` y no se ha cerrado.
            unsafe { CloseHandle(self.0) };
        }
    }

    fn testigo() -> Option<Testigo> {
        let mut handle: HANDLE = std::ptr::null_mut();

        // SAFETY: el seudomando de `GetCurrentProcess` siempre es válido y
        // `handle` es un parámetro de salida que la llamada escribe.
        let ok = unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut handle) };

        if ok == 0 {
            None
        } else {
            Some(Testigo(handle))
        }
    }

    /// Pide una clase de información del testigo en un búfer alineado.
    ///
    /// `[u64; 64]` y no `[u8; 512]`: lo que se lee es una estructura con
    /// punteros, y un búfer de bytes no garantiza la alineación que exige.
    fn informacion(testigo: &Testigo, clase: i32) -> Option<[u64; 64]> {
        let mut bufer = [0u64; 64];
        let mut necesarios = 0u32;

        // SAFETY: el búfer es válido, tiene el tamaño que se declara y sólo lo
        // escribe la llamada.
        let ok = unsafe {
            GetTokenInformation(
                testigo.0,
                clase,
                bufer.as_mut_ptr().cast(),
                std::mem::size_of_val(&bufer) as u32,
                &mut necesarios,
            )
        };

        if ok == 0 {
            None
        } else {
            Some(bufer)
        }
    }

    /// El RID del último subautoridad del SID: es el número que dice el nivel.
    pub fn nivel() -> Option<u32> {
        let testigo = testigo()?;
        let bufer = informacion(&testigo, TokenIntegrityLevel)?;

        // SAFETY: `GetTokenInformation` escribió un `TOKEN_MANDATORY_LABEL`
        // completo al principio del búfer, que está alineado.
        let etiqueta = unsafe { &*(bufer.as_ptr().cast::<TOKEN_MANDATORY_LABEL>()) };
        let sid = etiqueta.Label.Sid;

        if sid.is_null() {
            return None;
        }

        // SAFETY: el SID viene del testigo y sigue vivo mientras lo esté el búfer.
        let cuenta = unsafe { *GetSidSubAuthorityCount(sid) };

        if cuenta == 0 {
            return None;
        }

        // SAFETY: el índice es el último subautoridad, que existe por `cuenta > 0`.
        Some(unsafe { *GetSidSubAuthority(sid, u32::from(cuenta) - 1) })
    }

    /// `DOMINIO\usuario` del proceso.
    ///
    /// El testigo es la fuente buena, pero se cae a las variables de entorno si
    /// la consulta no devuelve nada: para diagnosticar basta con saber qué
    /// usuario lo está intentando, y un «(no se pudo leer)» en el registro no
    /// ayuda a nadie.
    pub fn usuario() -> Option<String> {
        del_testigo().or_else(|| {
            let usuario = std::env::var("USERNAME").ok()?;

            Some(match std::env::var("USERDOMAIN") {
                Ok(dominio) => format!("{dominio}\\{usuario}"),
                Err(_) => usuario,
            })
        })
    }

    fn del_testigo() -> Option<String> {
        let testigo = testigo()?;
        let bufer = informacion(&testigo, TokenUser)?;

        // SAFETY: `GetTokenInformation` escribió un `TOKEN_USER` completo.
        let usuario = unsafe { &*(bufer.as_ptr().cast::<TOKEN_USER>()) };
        let sid = usuario.User.Sid;

        if sid.is_null() {
            return None;
        }

        let mut nombre = [0u16; 256];
        let mut dominio = [0u16; 256];
        let mut largo_nombre = nombre.len() as u32;
        let mut largo_dominio = dominio.len() as u32;
        let mut tipo = 0i32;

        // SAFETY: los dos búferes son válidos y sus longitudes van en u32, como
        // pide la firma. Sin nombre de sistema se busca en el dominio del SID.
        let ok = unsafe {
            LookupAccountSidW(
                std::ptr::null(),
                sid,
                nombre.as_mut_ptr(),
                &mut largo_nombre,
                dominio.as_mut_ptr(),
                &mut largo_dominio,
                &mut tipo,
            )
        };

        if ok == 0 {
            return None;
        }

        let nombre = String::from_utf16_lossy(&nombre[..largo_nombre as usize]);
        let dominio = String::from_utf16_lossy(&dominio[..largo_dominio as usize]);

        Some(format!("{dominio}\\{nombre}"))
    }

    pub fn aviso(titulo: &str, mensaje: &str) {
        let titulo: Vec<u16> = titulo.encode_utf16().chain(std::iter::once(0)).collect();
        let mensaje: Vec<u16> = mensaje.encode_utf16().chain(std::iter::once(0)).collect();

        // SAFETY: las dos cadenas están terminadas en cero y viven hasta que
        // vuelve la llamada. Sin ventana padre, el diálogo es de la aplicación.
        unsafe {
            MessageBoxW(
                std::ptr::null_mut(),
                mensaje.as_ptr(),
                titulo.as_ptr(),
                MB_OK | MB_ICONWARNING | MB_TOPMOST,
            );
        }
    }
}

#[cfg(not(windows))]
mod nativo {
    pub fn nivel() -> Option<u32> {
        // En POSIX la integridad no existe; los permisos son otra cosa y ya los
        // cuenta `ensureDirs`.
        Some(0x2000)
    }

    pub fn usuario() -> Option<String> {
        std::env::var("USER")
            .or_else(|_| std::env::var("LOGNAME"))
            .ok()
    }

    pub fn aviso(titulo: &str, mensaje: &str) {
        eprintln!("{titulo}: {mensaje}");
    }
}

#[cfg(test)]
mod pruebas_datos {
    use super::{dentro_de, NOMBRE_DATOS, NOMBRE_INSTALACION};
    use std::path::PathBuf;

    /// La misma ruta con el separador de la plataforma que compila la prueba.
    ///
    /// El binario sólo corre en Windows —de ahí las rutas con `\`—, pero
    /// `cargo test` también se ejecuta en Linux en el CI, y `Path::components`
    /// no parte por `\` fuera de Windows: con la cadena tal cual, la prueba medía
    /// el separador y no la contención que dice medir.
    fn ruta(texto: &str) -> PathBuf {
        if cfg!(windows) {
            PathBuf::from(texto)
        } else {
            PathBuf::from(texto.replace('\\', "/"))
        }
    }

    /// La carpeta de datos no puede estar dentro de la de instalación: es lo que
    /// el instalador reemplaza al actualizar y lo que borra al desinstalar.
    #[test]
    fn la_carpeta_de_datos_es_hermana_de_la_de_instalacion() {
        assert_ne!(NOMBRE_DATOS, NOMBRE_INSTALACION);
        assert!(!dentro_de(
            ruta("C:\\Users\\ana\\AppData\\Local\\nn-anime-data").as_path(),
            ruta("C:\\Users\\ana\\AppData\\Local\\nn-anime").as_path()
        ));
        assert!(dentro_de(
            ruta("C:\\Users\\ana\\AppData\\Local\\nn-anime\\datos").as_path(),
            ruta("C:\\Users\\ana\\AppData\\Local\\nn-anime").as_path()
        ));
        // La comparación no se deja engañar por un prefijo de cadena.
        assert!(!dentro_de(
            ruta("C:\\x\\nn-anime2").as_path(),
            ruta("C:\\x\\nn-anime").as_path()
        ));
        // Ni por las mayúsculas: la normalización las baja, que es lo que hacen
        // los datos del instalador en Windows.
        assert!(dentro_de(
            ruta("C:\\X\\NN-ANIME\\config").as_path(),
            ruta("c:\\x\\nn-anime").as_path()
        ));
    }
}
