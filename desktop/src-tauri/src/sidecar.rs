//! El servidor que ya existe, lanzado como **hermano**.
//!
//! El anfitrión no arranca nada por su cuenta: lanza el ejecutable de consola que
//! `scripts/package.ts` instala **en el mismo directorio**, le pide `--no-open` y
//! lee la dirección que anuncia. No le pasa puerto, ni rutas de datos, ni idioma:
//! si lo hiciera, la ventana y `bun run start` usarían bases distintas y el
//! usuario vería dos aplicaciones.
//!
//! **La salida del hijo se parte en dos, y es lo que más importa de este archivo:**
//!
//! - `stdout` va a una **tubería que se drena siempre** y se descarta. El paso 8
//!   del arranque del CLI escribe ahí la URL humana **y** la línea de máquina, y
//!   **las dos llevan el token**. Escribirlas a un archivo dejaría el token en
//!   disco, que es justo lo que el spec del CLI prohíbe. De la tubería sólo se
//!   saca la línea, en memoria; el resto se tira. No vaciarla es lo que la
//!   bloquearía, y por eso el hilo lector sigue leyendo **después** de anunciar.
//! - `stderr` va a un **archivo** de registro: son avisos y errores, y ahí no hay
//!   token.

use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use crate::boot_line::{self, BootLine, BootLineError};

/// Lo que se espera a que el servidor anuncie su dirección.
pub const BOOT_TIMEOUT: Duration = Duration::from_secs(30);

/// Lo que se espera a que salga **solo** cuando se le pide el cierre.
///
/// Medido sobre el ejecutable empaquetado (T134): sale con 0 en 17 ms. El plazo
/// es holgado porque el seguro no es este número, es el `kill` de después.
pub const SHUTDOWN_GRACE: Duration = Duration::from_secs(2);

/// La línea que entiende `waitForClose` de `packages/cli/src/lifecycle.ts`.
pub const SHUTDOWN_LINE: &str = "shutdown\n";

/// El nombre del servidor, hermano del anfitrión.
const SIDECAR_NAME: &str = "nn-anime";

/// La variable con la que el CLI mueve su caché. Se respeta para que el registro
/// del anfitrión caiga donde caen los datos, y no en un directorio inventado.
pub const CACHE_DIR_ENV: &str = "NN_ANIME_CACHE_DIR";

/// `CREATE_NO_WINDOW` de Win32: el hermano es un binario de consola y sin esto
/// asoma la consola negra que este módulo existe para quitar.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug)]
pub enum SidecarError {
    /// No se encontró el ejecutable hermano.
    Missing(String),
    /// No se pudo lanzar.
    Spawn(String),
    /// No anunció su dirección a tiempo, o la anunció rota.
    Boot(BootLineError),
    /// Se acabó el plazo sin la línea.
    Timeout,
}

impl std::fmt::Display for SidecarError {
    fn fmt(&self, salida: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Missing(ruta) => write!(
                salida,
                "no se encontró el servidor en {ruta}: el anfitrión tiene que estar instalado a su lado"
            ),
            Self::Spawn(motivo) => write!(salida, "no se pudo lanzar el servidor: {motivo}"),
            Self::Boot(error) => write!(salida, "{error}"),
            Self::Timeout => write!(
                salida,
                "el servidor no anunció su dirección en {} s",
                BOOT_TIMEOUT.as_secs()
            ),
        }
    }
}

impl std::error::Error for SidecarError {}

/// El servidor vivo, con lo necesario para pedirle el cierre.
pub struct Sidecar {
    child: Child,
    /// `Option` para poder soltarlo al cerrar la tubería antes de esperar.
    stdin: Option<ChildStdin>,
    boot: BootLine,
}

impl Sidecar {
    /// La URL de arranque, con su token. Vive en memoria y no se escribe.
    pub fn url(&self) -> &str {
        &self.boot.url
    }

    /// El puerto de escucha. **Es lo único de esta línea que es seguro registrar.**
    pub fn port(&self) -> u16 {
        self.boot.port
    }

    /// Le pide el cierre con la línea que entiende el CLI, y espera.
    ///
    /// Si no sale en el plazo, se le mata: un servidor huérfano sobre la misma
    /// base es peor que un cierre brusco.
    pub fn shutdown(mut self) {
        if let Some(mut entrada) = self.stdin.take() {
            let _ = entrada.write_all(SHUTDOWN_LINE.as_bytes());
            let _ = entrada.flush();
            // Se cierra la tubería además de escribir: el CLI lee líneas y un
            // descriptor abierto no le estorba, pero dejarlo abierto mantendría
            // viva una escritura que ya no hace falta.
            drop(entrada);
        }

        if !esperar(&mut self.child, SHUTDOWN_GRACE) {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}

/// La ruta del hermano: el mismo directorio que el anfitrión.
pub fn sidecar_path() -> std::io::Result<PathBuf> {
    let exe = std::env::current_exe()?;
    let dir = exe.parent().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "el ejecutable del anfitrión no tiene directorio",
        )
    })?;

    Ok(dir.join(format!("{SIDECAR_NAME}{}", std::env::consts::EXE_SUFFIX)))
}

/// Dónde queda el registro del anfitrión.
pub fn log_path() -> PathBuf {
    let dir = cache_dir_from(|nombre| std::env::var(nombre).ok());
    let _ = fs::create_dir_all(&dir);

    dir.join("desktop.log")
}

/// El directorio de caché de la aplicación, con la misma precedencia que
/// `packages/core/src/config.ts`: la variable manda, y después las rutas de cada
/// sistema. Está duplicado a propósito —Rust no puede llamar al TypeScript— y por
/// eso es una función pura con sus pruebas y no un puñado de `env::var` sueltos.
pub fn cache_dir_from(env: impl Fn(&str) -> Option<String>) -> PathBuf {
    if let Some(dir) = env(CACHE_DIR_ENV).filter(|valor| !valor.trim().is_empty()) {
        return PathBuf::from(dir);
    }

    #[cfg(windows)]
    {
        if let Some(local) = env("LOCALAPPDATA").filter(|valor| !valor.trim().is_empty()) {
            return PathBuf::from(local).join("nn-anime").join("cache");
        }
        if let Some(perfil) = env("USERPROFILE").filter(|valor| !valor.trim().is_empty()) {
            return PathBuf::from(perfil)
                .join("AppData")
                .join("Local")
                .join("nn-anime")
                .join("cache");
        }
    }

    #[cfg(not(windows))]
    {
        if let Some(xdg) = env("XDG_CACHE_HOME").filter(|valor| !valor.trim().is_empty()) {
            return PathBuf::from(xdg).join("nn-anime");
        }
        if let Some(home) = env("HOME").filter(|valor| !valor.trim().is_empty()) {
            return PathBuf::from(home).join(".cache").join("nn-anime");
        }
    }

    // Sin nada de lo anterior queda el directorio temporal: un registro en el
    // sitio equivocado es mejor que no arrancar por no poder escribir el registro.
    std::env::temp_dir().join("nn-anime")
}

/// Lanza el hermano, espera su línea de arranque y se queda con él.
pub fn start() -> Result<Sidecar, SidecarError> {
    let ruta = sidecar_path().map_err(|error| SidecarError::Missing(error.to_string()))?;

    if !ruta.exists() {
        return Err(SidecarError::Missing(ruta.display().to_string()));
    }

    let mut command = Command::new(&ruta);
    command
        .arg("--no-open")
        // La entrada se abre porque es por donde se le pide el cierre.
        .stdin(Stdio::piped())
        .stdout(Stdio::piped());

    command.stderr(match abrir_registro() {
        Some(archivo) => Stdio::from(archivo),
        None => Stdio::null(),
    });

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    // El seguro del sistema, antes de lanzarlo: en Linux marca al hijo para que
    // muera con el anfitrión. En Windows hoy no hace nada (ver `guards.rs`).
    crate::guards::before_spawn(&mut command);

    let mut child = command
        .spawn()
        .map_err(|error| SidecarError::Spawn(error.to_string()))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| SidecarError::Spawn("el servidor no dejó su salida".to_string()))?;

    let (emisor, receptor) = mpsc::channel();
    std::thread::spawn(move || drenar(stdout, emisor));

    let boot = match receptor.recv_timeout(BOOT_TIMEOUT) {
        Ok(Ok(boot)) => boot,
        Ok(Err(error)) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(SidecarError::Boot(error));
        }
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(SidecarError::Timeout);
        }
    };

    // La entrada se guarda **antes** de construir el `Sidecar`: `take()` necesita
    // `&mut child`, y pedirla dentro del literal dejaría dos préstamos del mismo
    // `child` a la vez.
    let stdin = child.stdin.take();

    Ok(Sidecar {
        stdin,
        child,
        boot,
    })
}

fn abrir_registro() -> Option<std::fs::File> {
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path())
        .ok()
}

/// Lee la salida del hijo hasta el final, anunciando la línea de arranque.
///
/// Sigue leyendo **después** de encontrarla y tira el resto: si dejara de leer, el
/// buffer de la tubería se llenaría y el servidor se quedaría bloqueado
/// escribiendo, que es un fallo inventado por el lector.
fn drenar(stdout: impl Read, emisor: mpsc::Sender<Result<BootLine, BootLineError>>) {
    let lector = BufReader::new(stdout);
    let mut anunciado = false;

    for linea in lector.lines() {
        let Ok(linea) = linea else {
            break;
        };

        if anunciado {
            continue;
        }

        match boot_line::parse(&linea) {
            Ok(boot) => {
                anunciado = true;
                let _ = emisor.send(Ok(boot));
            }
            // Rota: se dice y se deja de buscar. Seguir buscando sería arrancar
            // con una dirección que no es la que el servidor anunció.
            Err(BootLineError::Malformed(motivo)) => {
                anunciado = true;
                let _ = emisor.send(Err(BootLineError::Malformed(motivo)));
            }
            // Esta línea no era la de arranque: se sigue leyendo.
            Err(BootLineError::Missing) => {}
        }
    }

    // El hijo cerró su salida sin anunciarse: quien espera tiene que enterarse
    // ahora, no al agotar el plazo.
    if !anunciado {
        let _ = emisor.send(Err(BootLineError::Missing));
    }
}

/// `true` si el hijo salió dentro del plazo.
fn esperar(child: &mut Child, plazo: Duration) -> bool {
    let limite = Instant::now() + plazo;

    loop {
        match child.try_wait() {
            Ok(Some(_)) => return true,
            Ok(None) => {}
            // No se pudo preguntar: se deja que lo mate el `kill` de quien llama.
            Err(_) => return false,
        }

        if Instant::now() >= limite {
            return false;
        }

        std::thread::sleep(Duration::from_millis(25));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entorno(pares: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> + '_ {
        move |nombre| {
            pares
                .iter()
                .find(|(clave, _)| *clave == nombre)
                .map(|(_, valor)| (*valor).to_string())
        }
    }

    #[test]
    fn la_variable_de_la_cache_manda_sobre_todo() {
        let dir = cache_dir_from(entorno(&[
            (CACHE_DIR_ENV, "/tmp/mia"),
            ("LOCALAPPDATA", "C:/otra"),
            ("XDG_CACHE_HOME", "/xdg"),
            ("HOME", "/home/alguien"),
        ]));

        assert_eq!(dir, PathBuf::from("/tmp/mia"));
    }

    #[test]
    fn una_variable_vacia_no_cuenta_como_puesta() {
        let dir = cache_dir_from(entorno(&[
            (CACHE_DIR_ENV, "   "),
            ("XDG_CACHE_HOME", "/xdg"),
            ("HOME", "/home/alguien"),
        ]));

        // En Windows cae a `LOCALAPPDATA`/`USERPROFILE`, que aquí no están, y en
        // el resto a `XDG_CACHE_HOME`. Lo que se fija es que **no** es la vacía.
        assert_ne!(dir, PathBuf::from("   "));
        assert!(!dir.to_string_lossy().trim().is_empty());
    }

    #[test]
    fn el_nombre_del_hermano_es_el_del_servidor() {
        assert_eq!(SIDECAR_NAME, "nn-anime");
        // El anfitrión se llama distinto: los dos viven en el mismo directorio.
        assert_ne!(SIDECAR_NAME, "nn-anime-desktop");
    }

    #[test]
    fn la_linea_de_cierre_es_la_que_espera_el_cli() {
        // Sin el salto de línea, `waitForClose` la acumularía como resto de una
        // línea a medias y no cerraría nunca.
        assert_eq!(SHUTDOWN_LINE, "shutdown\n");
    }
}
