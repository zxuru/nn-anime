//! El seguro contra la muerte brusca del anfitrión.
//!
//! El cierre ordenado —pedirle `shutdown` al servidor y esperarle— cubre el
//! camino normal: se cierra la ventana. Esto cubre el otro: que al anfitrión lo
//! mate el sistema, el administrador de tareas o un `kill -9`. En ese caso el
//! proceso no ejecuta ni una línea de su cierre, y sin este seguro el servidor se
//! queda vivo sobre la base de datos sin nadie que lo pare.
//!
//! El mecanismo no es del CLI, es del sistema operativo, y por eso vive aquí y no
//! en `packages/`: el anfitrión marca al hijo para que muera con él, en el momento
//! de lanzarlo.
//!
//! **Windows no está.** El Job Object con `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` es
//! la forma de hacerlo ahí, y **no se ha escrito a propósito**: es FFI `unsafe`
//! contra `windows-sys` —tipos de `HANDLE`, el tamaño y el empaquetado de
//! `JOBOBJECT_EXTENDED_LIMIT_INFORMATION`, las características que hay que activar
//! en `Cargo.toml`— y en el entorno donde se escribió esto **no se puede compilar**
//! nada de Rust (sin HTTPS, `cargo` no alcanza crates.io). Escribir un bloque
//! `unsafe` a ciegas es la peor clase de código no verificado: compila o no, y si
//! compila puede fallar en tiempo de ejecución sin que nadie lo mida. Queda
//! declarado como pendiente en `tasks/done/T155.md`, con lo que falta.

use std::process::Command;

/// Marca el proceso que se va a lanzar para que muera con el anfitrión.
///
/// Se llama **antes** de `spawn` porque es una propiedad del hijo en el momento de
/// crearlo: el `prctl` tiene que correr en el proceso hijo, entre el `fork` y el
/// `exec`, que es justo lo que ofrece `pre_exec`.
#[cfg(target_os = "linux")]
pub fn before_spawn(command: &mut Command) {
    use std::os::unix::process::CommandExt;

    // `pre_exec` está marcada como `unsafe` por lo que corre ahí: entre el `fork`
    // y el `exec` sólo se puede llamar a funciones seguras para el proceso hijo.
    // `prctl` lo es —es una llamada al sistema, no toca memoria compartida—, y es
    // la forma documentada de pedir `PR_SET_PDEATHSIG`.
    unsafe {
        command.pre_exec(|| {
            if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM) != 0 {
                return Err(std::io::Error::last_os_error());
            }

            Ok(())
        });
    }
}

/// En el resto de los sistemas no hay nada que marcar.
///
/// En macOS no existe equivalente a `PR_SET_PDEATHSIG`: si el anfitrión muere de
/// golpe, el servidor puede quedar vivo. Es un **riesgo residual declarado** en
/// `docs/specs/SPEC-desktop.md`, mitigado por el cierre explícito de la ventana.
#[cfg(not(target_os = "linux"))]
pub fn before_spawn(_command: &mut Command) {}
