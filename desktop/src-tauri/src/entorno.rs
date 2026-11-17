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

const TITULO_AVISO: &str = "RoNa";

/// El nombre de la carpeta de datos en Windows.
///
/// Es hermana de la carpeta del producto (`%LOCALAPPDATA%\RoNa`), no su hija:
/// el actualizador reemplaza el `.exe` y los datos no pueden estar ahí.
///
/// `cfg(any(windows, test))`: fuera de Windows sólo lo usa la prueba que compara
/// los dos nombres; en el binario de Linux no existe y así `clippy -D warnings`
/// no lo marca como código muerto.
#[cfg(any(windows, test))]
pub const NOMBRE_DATOS: &str = "rona-data";

/// La carpeta de datos que usaban las versiones con el nombre anterior.
///
/// Sólo se lee para migrarla una vez: sin esto, el primer arranque con el nombre
/// nuevo abriría una base vacía y el historial parecería perdido.
#[cfg(windows)]
pub const NOMBRE_DATOS_LEGADO: &str = "nn-anime-data";

/// La carpeta que usaban las versiones instaladas (el `productName` anterior).
#[cfg(any(windows, test))]
const NOMBRE_INSTALACION_LEGADO: &str = "nn-anime";

/// Lo que se mueve de una instalación anterior, que guardaba los datos dentro de
/// la carpeta de instalación.
///
/// Es una lista cerrada y no «todo lo que no sea un `.exe`»: un barrido copiaría
/// binarios, accesos o restos de una instalación anterior a la carpeta de datos.
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
/// 2. **`%LOCALAPPDATA%\rona-data`**: lo normal. Es **hermana** de la carpeta
///    del producto (`%LOCALAPPDATA%\RoNa`), no su hija:
///    la actualización reemplaza el `.exe` y los datos no pueden estar ahí.
///    Sobreviven a mover o borrar el `.exe` y a actualizar.
/// 3. **La raíz XDG del usuario** en macOS y Linux, por el mismo motivo.
///
/// **No hay un tercer camino en el directorio del ejecutable.** Una caída
/// silenciosa ahí metía la base en la carpeta que la actualización portable
/// reemplaza, que es exactamente donde no puede estar.
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
            // Los datos viajan con el `.exe`; si vienen de la versión anterior,
            // la base se llama distinto y hay que renombrarla en el sitio.
            renombrar_base(dir);

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
    //    la del producto (`%LOCALAPPDATA%\rona-data` frente a
    //    `%LOCALAPPDATA%\RoNa`), para que la actualización no comparta carpeta con
    //    la base. Las instalaciones anteriores guardaban los datos dentro de la
    //    carpeta del programa: se trasladan una sola vez.
    #[cfg(windows)]
    if let Some(perfil) = std::env::var_os("LOCALAPPDATA") {
        let perfil = std::path::PathBuf::from(perfil);
        let ruta = perfil.join(NOMBRE_DATOS);

        // Primero el nombre anterior de la carpeta de datos; si ya hay datos en
        // el nombre nuevo, esto no toca nada.
        migrar_datos_del_nombre_anterior(&perfil.join(NOMBRE_DATOS_LEGADO), &ruta);

        match probar_escritura(&ruta) {
            Ok(()) => {
                migrar_datos_heredados(&perfil.join(NOMBRE_INSTALACION_LEGADO), &ruta);
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
    //     ejecutable, que dentro de un AppImage está montado en sólo lectura: la
    //     aplicación no podría guardar nada y saldría con un aviso.
    //     Una sola raíz para datos, configuración y caché, como en Windows; es la
    //     que el anfitrión fija en `RONA_*` y la que documenta el README.
    #[cfg(not(windows))]
    {
        let base = std::env::var_os("XDG_DATA_HOME")
            .map(std::path::PathBuf::from)
            .or_else(|| {
                std::env::var_os("HOME")
                    .map(|home| std::path::PathBuf::from(home).join(".local").join("share"))
            });

        if let Some(base) = base {
            let ruta = base.join("rona");

            // La carpeta de datos de la versión anterior se traslada entera:
            // dentro van la base, `config`, `cache` y el perfil del webview.
            migrar_datos_del_nombre_anterior(&base.join("nn-anime"), &ruta);

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
    //    carpeta del programa, y ahí el reemplazo del `.exe` borra y escribe. Un fallo de
    //    escritura en el perfil se cuenta con el diálogo nativo y se sale; es
    //    mejor que arrancar con la base en un sitio que la próxima actualización
    //    puede llevarse por delante.
    let detalle = intentos.join("\n");

    crate::registrar(&format!("sin ubicación escribible:\n{detalle}"));

    nativo::aviso(
        TITULO_AVISO,
        &format!(
            "RoNa no puede guardar sus datos y no puede arrancar.\n\n\
             Se probaron estas ubicaciones:\n{detalle}\n\n\
             RoNa no guarda nada junto al ejecutable: revisa los permisos de tu \
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
    std::env::set_var("RONA_DATA_DIR", &raiz.ruta);
    std::env::set_var("RONA_CONFIG_DIR", raiz.ruta.join("config"));
    std::env::set_var("RONA_CACHE_DIR", raiz.ruta.join("cache"));
}

/// Escribe y borra un archivo de prueba. Es la única comprobación que no miente.
fn probar_escritura(dir: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;

    let prueba = dir.join(".escritura");
    std::fs::write(&prueba, b"RoNa")?;
    std::fs::remove_file(&prueba)?;

    Ok(())
}

/// Traslada los datos de una instalación anterior, que los guardaba dentro de la
/// carpeta del programa.
///
/// Se hace **una sola vez** y sin tocar nada si la carpeta nueva ya tiene base:
/// una actualización futura no vuelve a mover nada, y si el traslado se corta a
/// medias el siguiente arranque lo retoma (la base sigue en el origen). El
/// `rename` es barato y atómico; si un archivo está bloqueado se registra y se
/// sigue, porque perder el arranque por una caché bloqueada sería peor que
/// volver a intentarlo.
///
/// La lista de lo que se mueve es cerrada (`DATOS_HEREDADOS`): un barrido se
/// llevaría ejecutables y restos de una instalación anterior.
#[cfg(windows)]
fn migrar_datos_heredados(instalacion: &std::path::Path, datos: &std::path::Path) {
    let base_vieja = instalacion.join("nn-anime.db");

    if datos.join("rona.db").exists() || !base_vieja.exists() {
        // Si ya hay una base con el nombre nuevo, no hay nada que mover. Si la
        // carpeta nueva tiene la base antigua de un traslado a medias, se
        // renombra aquí y el siguiente arranque la encuentra.
        renombrar_base(datos);
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
    renombrar_base(datos);

    if !datos.join("rona.db").exists() && base_vieja.exists() {
        let mensaje = format!(
            "RoNa encontró datos de una instalación anterior en {} pero no pudo \
             trasladarlos a {}.\n\n\
             La base y el historial siguen en la carpeta antigua, intactos. Revisa los \
             permisos de tu carpeta de usuario y vuelve a abrir RoNa.",
            instalacion.display(),
            datos.display()
        );

        crate::registrar(&mensaje);
        nativo::aviso(TITULO_AVISO, &mensaje);
        std::process::exit(1);
    }

    crate::registrar(&format!(
        "datos de una instalación anterior trasladados fuera de la carpeta del programa ({movidos} entradas)"
    ));
}

/// Renombra la carpeta de datos de la versión anterior, si la nueva no existe.
///
/// Se llama **antes** de crear la carpeta nueva: si se creara primero, `rename`
/// fallaría y el primer arranque con el nombre nuevo abriría una base vacía.
/// Si las dos existen, no se mezcla nada: la nueva manda y la vieja se queda
/// intacta para que el usuario decida.
pub fn migrar_datos_del_nombre_anterior(viejo: &std::path::Path, nuevo: &std::path::Path) {
    if !viejo.join("nn-anime.db").exists() {
        return;
    }

    if nuevo.exists() {
        // Una carpeta vacía de un intento anterior no puede impedir el traslado;
        // una con datos, sí: no se pisa lo que el usuario ya tenga ahí.
        let vacia = nuevo
            .read_dir()
            .map(|mut entradas| entradas.next().is_none())
            .unwrap_or(false);

        if !vacia {
            return;
        }

        let _ = std::fs::remove_dir(nuevo);
    }

    match std::fs::rename(viejo, nuevo) {
        Ok(()) => {
            renombrar_base(nuevo);
            crate::registrar("datos de la versión anterior trasladados al nombre nuevo");
        }
        Err(error) => crate::registrar(&format!(
            "no se pudo trasladar la carpeta de datos de {viejo:?} a {nuevo:?}: {error}"
        )),
    }
}

/// Renombra `nn-anime.db` y sus compañeros a `rona.db`, sin pisar nada.
///
/// La base cambia de nombre con el producto. Se hace con la aplicación cerrada,
/// así que no hay ningún proceso con el archivo abierto.
pub fn renombrar_base(dir: &std::path::Path) {
    for sufijo in ["", "-wal", "-shm"] {
        let viejo = dir.join(format!("nn-anime.db{sufijo}"));
        let nuevo = dir.join(format!("rona.db{sufijo}"));

        if viejo.exists() && !nuevo.exists() {
            if let Err(error) = std::fs::rename(&viejo, &nuevo) {
                crate::registrar(&format!("no se pudo renombrar {viejo:?}: {error}"));
            }
        }
    }
}

/// `true` si `ruta` está dentro de `padre`. Pura, para poder probarla.
///
/// Windows no distingue mayúsculas y una comparación de cadenas diría que
/// `C:\x\rona2` está dentro de `C:\x\rona`; por eso se compara
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
             revisa los permisos de la carpeta de datos o usa portable.txt",
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
    use super::{
        dentro_de, migrar_datos_del_nombre_anterior, renombrar_base, NOMBRE_DATOS,
        NOMBRE_INSTALACION_LEGADO,
    };
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

    /// La carpeta de datos no puede estar dentro de la del programa: es la que
    /// el actualizador reemplaza al actualizar.
    #[test]
    fn la_carpeta_de_datos_es_hermana_de_la_del_programa() {
        assert_ne!(NOMBRE_DATOS, NOMBRE_INSTALACION_LEGADO);
        assert!(!dentro_de(
            ruta("C:\\Users\\ana\\AppData\\Local\\rona-data").as_path(),
            ruta("C:\\Users\\ana\\AppData\\Local\\rona").as_path()
        ));
        assert!(dentro_de(
            ruta("C:\\Users\\ana\\AppData\\Local\\rona\\datos").as_path(),
            ruta("C:\\Users\\ana\\AppData\\Local\\rona").as_path()
        ));
        // La comparación no se deja engañar por un prefijo de cadena.
        assert!(!dentro_de(
            ruta("C:\\x\\rona2").as_path(),
            ruta("C:\\x\\rona").as_path()
        ));
        // Ni por las mayúsculas: la normalización las baja, como en las rutas de
        // Windows.
        assert!(dentro_de(
            ruta("C:\\X\\RONA\\config").as_path(),
            ruta("c:\\x\\rona").as_path()
        ));
    }

    /// El nombre anterior de la carpeta de datos se traslada entero y la base
    /// cambia de nombre: sin esto, el primer arranque con «RoNa» abriría una
    /// base vacía y el historial parecería perdido.
    #[test]
    fn la_carpeta_y_la_base_del_nombre_anterior_se_trasladan() {
        let raiz = std::env::temp_dir().join(format!("rona-migracion-{}", std::process::id()));
        let viejo = raiz.join("nn-anime-data");
        let nuevo = raiz.join("rona-data");

        let _ = std::fs::remove_dir_all(&raiz);
        std::fs::create_dir_all(&viejo).expect("crear la carpeta vieja");
        std::fs::write(viejo.join("nn-anime.db"), b"historial").expect("escribir la base");

        migrar_datos_del_nombre_anterior(&viejo, &nuevo);

        assert!(
            nuevo.join("rona.db").exists(),
            "la base tiene el nombre nuevo"
        );
        assert!(!viejo.exists(), "la carpeta vieja se movió, no se copió");
        assert_eq!(
            std::fs::read(nuevo.join("rona.db")).expect("leer la base"),
            b"historial"
        );

        let _ = std::fs::remove_dir_all(&raiz);
    }

    /// El renombrado no pisa una base que ya tenga el nombre nuevo.
    #[test]
    fn renombrar_la_base_no_pisa_la_nueva() {
        let dir = std::env::temp_dir().join(format!("rona-base-{}", std::process::id()));

        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("crear la carpeta");
        std::fs::write(dir.join("nn-anime.db"), b"vieja").expect("escribir la vieja");
        std::fs::write(dir.join("rona.db"), b"nueva").expect("escribir la nueva");

        renombrar_base(&dir);

        assert_eq!(
            std::fs::read(dir.join("rona.db")).expect("leer la nueva"),
            b"nueva"
        );
        assert!(dir.join("nn-anime.db").exists(), "la vieja no se toca");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
