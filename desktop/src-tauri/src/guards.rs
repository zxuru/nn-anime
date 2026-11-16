//! El seguro contra la muerte brusca del anfitrión.
//!
//! El cierre ordenado —pedirle `shutdown` al servidor y esperarle— cubre el
//! camino normal: se cierra la ventana. Esto cubre el otro: que al anfitrión lo
//! mate el sistema, el administrador de tareas o un `kill -9`. En ese caso el
//! proceso no ejecuta ni una línea de su cierre, y sin este seguro el servidor se
//! queda vivo sobre la base de datos sin nadie que lo pare: ocupa el puerto, la
//! cookie de sesión y el archivo, así que el siguiente arranque se pelea con él.
//!
//! El mecanismo no es del CLI, es del sistema operativo, y por eso vive aquí y no
//! en `packages/`: el anfitrión marca al hijo para que muera con él, en el momento
//! de lanzarlo. **Ninguno de los tres sistemas lo pide en el mismo momento**, y de
//! ahí que haya dos funciones y no una:
//!
//! - **Linux**: `PR_SET_PDEATHSIG` es una propiedad del proceso hijo y sólo se
//!   puede fijar entre el `fork` y el `exec`. Va en [`before_spawn`].
//! - **Windows**: el Job Object lo crea el anfitrión y el hijo se **asigna** a él
//!   después de existir; no hay `pre_exec` que valga. Va en [`after_spawn`].
//! - **macOS**: no hay equivalente y no se finge que lo haya. Está escrito en
//!   [`after_spawn`] y en `SECURITY.md`.
//!
//! **Por qué el Job Object cierra el caso en Windows.** Cuando a un proceso lo
//! matan de golpe no corre ni una línea suya: lo único que corre es el kernel. Y
//! el kernel, al cerrar el proceso, **cierra todos sus handles**. Un job con
//! `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` mata a todo lo que quede dentro cuando se
//! cierra su último handle, así que «muere el anfitrión» y «se cierra el job» son
//! el mismo instante, sin que el anfitrión tenga que ejecutar nada.
//!
//! **La ventana que queda, y es de milisegundos.** El hijo se asigna al job justo
//! después de `spawn`; entre una cosa y otra el proceso ya existe y todavía no está
//! protegido. Cerrarla del todo pediría lanzarlo suspendido (`CREATE_SUSPENDED`) y
//! reanudar su hilo principal después de asignarlo, y eso es FFI de hilos que este
//! anfitrión no necesita: quien mata un proceso en ese hueco tiene que acertar en
//! una ventana de dos llamadas al sistema.

use std::process::{Child, Command};

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

/// En Windows y macOS no hay nada que marcar antes de lanzar el proceso.
///
/// Windows lo hace **después**, en [`after_spawn`]: el job se asigna a un proceso
/// que ya existe. macOS no lo hace en ningún momento, por el motivo que cuenta
/// `after_spawn`.
#[cfg(not(target_os = "linux"))]
pub fn before_spawn(_command: &mut Command) {}

/// Deja al hijo bajo el seguro del sistema, cuando el sistema lo pide **después**
/// de crearlo.
///
/// Se llama justo después de `spawn` y antes de leer nada del hijo: cada
/// milisegundo que se tarde es un milisegundo en el que un `kill` del anfitrión
/// dejaría al servidor vivo (ver la cabecera).
///
/// **macOS: no hay equivalente, y se dice aquí en vez de callarlo.**
/// `PR_SET_PDEATHSIG` es una llamada del kernel de Linux; macOS no tiene nada
/// parecido —`kqueue`/`EVFILT_PROC` existe, pero hay que **observarlo desde el
/// proceso que sobrevive**, o sea desde el servidor, y ese código es del CLI, no
/// del anfitrión—. El anfitrión tampoco puede hacerlo por su cuenta: cuando se
/// muere no ejecuta nada. La otra vía sería que el servidor cerrara al ver el fin
/// de su entrada estándar, y `waitForClose` de `packages/cli` **no cierra por
/// `end`, a propósito** (los guiones de empaquetado lanzan el servidor con la
/// entrada cerrada de nacimiento, así que moriría al arrancar). Mientras eso no
/// cambie, en macOS un `kill -9` del anfitrión puede dejar el servidor vivo: es el
/// riesgo residual que declara `SECURITY.md`, mitigado por el cierre explícito de
/// la ventana.
#[cfg(windows)]
pub fn after_spawn(child: &Child) -> Result<(), String> {
    job::asignar(child.id())
}

/// En el resto de los sistemas no hay nada que asignar.
///
/// En Linux ya está hecho en [`before_spawn`]; en macOS no hay mecanismo con el
/// que hacerlo (ver arriba, en la versión de Windows de esta misma función).
#[cfg(not(windows))]
pub fn after_spawn(_child: &Child) -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
mod job {
    use std::sync::OnceLock;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
    };

    /// El job del anfitrión, guardado como entero y no como `HANDLE`.
    ///
    /// `HANDLE` es un puntero crudo, así que un `static` que lo guarde pediría
    /// `unsafe impl Send`/`Sync`; guardarlo como `usize` lo evita sin perder nada:
    /// el handle es un valor opaco que no se desreferencia nunca, sólo se pasa a
    /// las llamadas que lo esperan.
    ///
    /// **Nunca se suelta**: se crea la primera vez que se lanza el servidor y vive
    /// hasta que el proceso muere, que es justo lo que el seguro necesita. Cerrarlo
    /// a mano mataría al servidor en mitad de una sesión.
    static JOB: OnceLock<usize> = OnceLock::new();

    /// Crea un job con `KILL_ON_JOB_CLOSE` y devuelve su handle.
    fn crear() -> Result<usize, String> {
        // SAFETY: sin atributos de seguridad y sin nombre, que es lo que admiten
        // los dos punteros nulos. Devuelve un handle o nulo, y el nulo se mira.
        let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };

        if job.is_null() {
            return Err(format!(
                "CreateJobObjectW: {}",
                std::io::Error::last_os_error()
            ));
        }

        // `Default` y no `zeroed`: la estructura lo implementa en `windows-sys`, y
        // así no hace falta un `unsafe` para construirla.
        let mut limites = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limites.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

        // SAFETY: `limites` es del tipo que pide la clase, `tamano` es su tamaño
        // real y el búfer vive hasta que la llamada vuelve. Sólo la lee.
        let ok = unsafe {
            SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                (&limites as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };

        if ok == 0 {
            let error = std::io::Error::last_os_error();
            // SAFETY: el handle salió de `CreateJobObjectW` y no se ha cerrado.
            unsafe { CloseHandle(job) };

            return Err(format!("SetInformationJobObject: {error}"));
        }

        Ok(job as usize)
    }

    /// El job del anfitrión, creado la primera vez que se pide.
    fn job() -> Result<usize, String> {
        if let Some(job) = JOB.get() {
            return Ok(*job);
        }

        let job = crear()?;

        // Si otro hilo llegó antes, el job recién creado sobra: se cierra para no
        // dejar un handle abierto por cada carrera. Hoy sólo llama `sidecar::start`,
        // pero cerrarlo cuesta dos líneas y suponer un solo hilo no cuesta nada.
        if JOB.set(job).is_err() {
            // SAFETY: el handle salió de `crear` y no se ha cerrado.
            unsafe { CloseHandle(job as HANDLE) };

            return JOB
                .get()
                .copied()
                .ok_or_else(|| "el job se perdió entre dos hilos".to_string());
        }

        Ok(job)
    }

    /// Mete el proceso `pid` en el job.
    ///
    /// Los dos derechos que se piden son los que exige `AssignProcessToJobObject`
    /// y ninguno más: `PROCESS_SET_QUOTA` y `PROCESS_TERMINATE`.
    fn asignar_a(job: usize, pid: u32) -> Result<(), String> {
        // SAFETY: `OpenProcess` no toca memoria nuestra; devuelve un handle o nulo,
        // y el nulo se mira antes de usarlo.
        let proceso = unsafe { OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, 0, pid) };

        if proceso.is_null() {
            return Err(format!(
                "OpenProcess({pid}): {}",
                std::io::Error::last_os_error()
            ));
        }

        // SAFETY: los dos handles son válidos y no se han cerrado; la llamada sólo
        // los usa.
        let ok = unsafe { AssignProcessToJobObject(job as HANDLE, proceso) };
        let error = std::io::Error::last_os_error();

        // SAFETY: el handle salió de `OpenProcess` y no se ha cerrado. El job se
        // queda con su propia referencia al proceso, así que cerrar ésta no lo
        // saca del job.
        unsafe { CloseHandle(proceso) };

        if ok == 0 {
            // Puede pasar por dos motivos: el hijo ya no está, o Windows lo niega
            // —un job ajeno con restricciones de interfaz, o un sistema anterior a
            // Windows 8, donde no hay anidamiento—. Cuando es lo segundo, el hijo se
            // queda en el job que heredó al nacer, si había alguno. Se cuenta y se
            // sigue: sin job propio el servidor sigue en pie, y matar el arranque
            // por no poder poner el seguro sería peor que quedarse sin él.
            return Err(format!("AssignProcessToJobObject({pid}): {error}"));
        }

        Ok(())
    }

    /// Asigna el `pid` al job del anfitrión, creándolo si es el primer hijo.
    pub fn asignar(pid: u32) -> Result<(), String> {
        asignar_a(job()?, pid)
    }

    #[cfg(test)]
    pub use pruebas::*;

    #[cfg(test)]
    mod pruebas {
        use super::*;

        /// Crea el job y mete el `pid` dentro. Devuelve su handle, que la prueba
        /// cierra a mano.
        pub fn crear_y_asignar(pid: u32) -> Result<usize, String> {
            let job = crear()?;
            asignar_a(job, pid)?;

            Ok(job)
        }

        /// Cierra el handle del job, que es lo que hace el kernel al morir el
        /// anfitrión.
        pub fn cerrar(job: usize) {
            // SAFETY: el handle salió de `crear_y_asignar` y no se ha cerrado.
            unsafe { CloseHandle(job as HANDLE) };
        }
    }
}

#[cfg(all(test, any(windows, target_os = "linux")))]
mod pruebas {
    use std::io::{BufRead, BufReader, Write};
    use std::process::{Child, Command, Stdio};
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    use super::*;

    /// La variable con la que se distingue el proceso que **hace de anfitrión**.
    ///
    /// La prueba necesita que muera un anfitrión de verdad, y el proceso que corre
    /// las pruebas no puede matarse a sí mismo sin llevarse el informe por delante.
    /// Así que se reejecuta a sí misma una vez —sólo una— como anfitrión: un
    /// proceso que llama a [`before_spawn`]/[`after_spawn`] con el código que se
    /// entrega, lanza al «servidor» y se queda esperando a que lo maten.
    const ROL: &str = "NN_ANIME_PRUEBA_MUERTE";

    const ANFITRION: &str = "anfitrion";

    /// El filtro que hay que pasarle a libtest para reejecutar **sólo** esta
    /// prueba.
    ///
    /// `module_path!()` lleva el nombre del crate delante —`nn_anime_desktop::guards::pruebas`—
    /// y los nombres que lista el arnés de pruebas no lo llevan: con el prefijo,
    /// `--exact` no casa con nada y el hijo arranca para no hacer nada. Se quita el
    /// primer segmento aquí y no se escribe la ruta a mano, que se quedaría vieja en
    /// cuanto el módulo se mueva.
    fn filtro() -> String {
        const COMPLETO: &str = concat!(module_path!(), "::el_servidor_no_sobrevive_al_anfitrion");

        match COMPLETO.split_once("::") {
            Some((_, resto)) => resto.to_string(),
            None => COMPLETO.to_string(),
        }
    }

    /// Lo que se espera a que el servidor desaparezca. Generoso a propósito: en el
    /// CI el runner puede tardar en darle CPU al kernel para matarlo, y un plazo
    /// corto convertiría un seguro que funciona en una prueba intermitente.
    const PLAZO: Duration = Duration::from_secs(10);

    #[test]
    fn el_servidor_no_sobrevive_al_anfitrion() {
        if std::env::var(ROL).is_ok_and(|rol| rol == ANFITRION) {
            hacer_de_anfitrion();
        }

        medir();
    }

    /// El anfitrión de la prueba: lanza al servidor con el seguro y no vuelve.
    ///
    /// `zombie_processes` se calla a propósito: el que esperaría al hijo es este
    /// proceso y el que lo mata es el que mide, así que aquí no hay `wait` posible
    /// —ni falta que hace: al morir este proceso nadie recoge un zombi porque el
    /// hijo se lo lleva el job—.
    #[allow(clippy::zombie_processes)]
    fn hacer_de_anfitrion() -> ! {
        let hijo = lanzar_servidor();

        match after_spawn(&hijo) {
            // El pid va en una línea con marca: el que mide necesita saber a quién
            // vigilar, y `stdout` del anfitrión es una tubería que él lee.
            Ok(()) => println!("PID={}", hijo.id()),
            Err(error) => println!("FALLO={error}"),
        }

        // Sin esto la línea se queda en el búfer y el que mide espera en vano.
        let _ = std::io::stdout().flush();

        loop {
            std::thread::sleep(Duration::from_secs(1));
        }
    }

    /// Un proceso del sistema que **no** termina por su cuenta: el «servidor».
    ///
    /// Es un binario del sistema y no una copia de este binario de pruebas a
    /// propósito. Aquí sobran las copias: lo que hay que medir es que un proceso
    /// cualquiera lanzado con el seguro muere con el anfitrión, y `ping`/`sleep` lo
    /// son sin arrastrar nada.
    fn lanzar_servidor() -> Child {
        #[cfg(windows)]
        let mut command = {
            let mut command = Command::new("cmd");
            // `ping` y no `timeout`: `timeout` se niega a correr sin consola.
            command.arg("/c").arg("ping -n 120 127.0.0.1");
            command
        };

        #[cfg(target_os = "linux")]
        let mut command = {
            let mut command = Command::new("sleep");
            command.arg("120");
            command
        };

        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        before_spawn(&mut command);

        command.spawn().expect("el servidor de la prueba")
    }

    /// El que mide: arranca el anfitrión, lo mata de golpe y mira al servidor.
    fn medir() {
        let exe = std::env::current_exe().expect("la ruta del binario de pruebas");
        let filtro = filtro();
        let mut anfitrion = Command::new(exe)
            .arg(&filtro)
            .arg("--exact")
            .arg("--nocapture")
            .env(ROL, ANFITRION)
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .expect("el anfitrión de la prueba");

        // La línea con el pid llega por `stdout`, y se lee en otro hilo para poder
        // rendirse: un anfitrión que no llega a lanzar nada no puede colgar el CI.
        // Lo que diga el anfitrión se guarda: una prueba que falla sin contar lo
        // que el otro proceso dijo obliga a repetirla a ciegas.
        let salida = anfitrion.stdout.take().expect("la salida del anfitrión");
        let (emisor, receptor) = mpsc::channel::<String>();

        std::thread::spawn(move || {
            for linea in BufReader::new(salida).lines().map_while(Result::ok) {
                if emisor.send(linea).is_err() {
                    return;
                }
            }
        });

        let limite = Instant::now() + Duration::from_secs(30);
        let mut dicho: Vec<String> = Vec::new();

        let encontrado = loop {
            let restante = limite.saturating_duration_since(Instant::now());

            if restante.is_zero() {
                break None;
            }

            let Ok(linea) = receptor.recv_timeout(restante) else {
                break None;
            };

            if let Some(pid) = linea.strip_prefix("PID=") {
                let pid = pid.trim();

                break Some(
                    pid.parse::<u32>()
                        .map_err(|error| format!("pid ilegible ({pid}): {error}")),
                );
            }

            if let Some(motivo) = linea.strip_prefix("FALLO=") {
                break Some(Err(motivo.to_string()));
            }

            dicho.push(linea);
        };

        let pid = match encontrado {
            Some(Ok(pid)) => pid,
            Some(Err(motivo)) => {
                matar_de_golpe(anfitrion.id());
                let _ = anfitrion.wait();

                panic!("el anfitrión no pudo poner el seguro: {motivo}");
            }
            None => {
                matar_de_golpe(anfitrion.id());
                let estado = anfitrion.wait();

                panic!(
                    "el anfitrión de la prueba no llegó a lanzar el servidor \
                     (filtro: {filtro}; estado: {estado:?}; dijo: {dicho:?})"
                );
            }
        };

        // El servidor tiene que estar vivo **antes** de matar nada: si ya murió,
        // esta prueba no mediría el seguro, mediría un proceso que no arranca.
        std::thread::sleep(Duration::from_millis(500));
        assert!(
            vivo(pid),
            "el servidor de la prueba ({pid}) no llegó a arrancar: no hay nada que medir"
        );

        // La muerte del anfitrión, sin cierre ordenado: `TerminateProcess` en
        // Windows y `SIGKILL` en Linux, que es el `kill -9` que el seguro cubre.
        matar_de_golpe(anfitrion.id());
        let _ = anfitrion.wait();

        let limite = Instant::now() + PLAZO;

        while Instant::now() < limite {
            if !vivo(pid) {
                return;
            }

            std::thread::sleep(Duration::from_millis(100));
        }

        // Se limpia antes de fallar: una prueba roja no debe dejar un proceso
        // durmiendo dos minutos en el CI.
        matar_de_golpe(pid);

        panic!("el servidor ({pid}) sobrevivió {PLAZO:?} a la muerte del anfitrión");
    }

    /// `true` si el proceso sigue en pie.
    #[cfg(windows)]
    fn vivo(pid: u32) -> bool {
        use windows_sys::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
        use windows_sys::Win32::Storage::FileSystem::SYNCHRONIZE;
        use windows_sys::Win32::System::Threading::{OpenProcess, WaitForSingleObject};

        // SAFETY: `OpenProcess` no toca memoria nuestra; devuelve un handle o nulo.
        let proceso = unsafe { OpenProcess(SYNCHRONIZE, 0, pid) };

        // Un pid sin proceso detrás no se puede abrir: ya murió.
        if proceso.is_null() {
            return false;
        }

        // SAFETY: el handle lo devolvió `OpenProcess` y no se ha cerrado; el plazo
        // cero sólo pregunta, no espera.
        let estado = unsafe { WaitForSingleObject(proceso, 0) };

        // SAFETY: el handle salió de `OpenProcess` y no se ha cerrado.
        unsafe { CloseHandle(proceso) };

        estado != WAIT_OBJECT_0
    }

    /// `true` si el proceso sigue en pie, y **no** cuenta un zombi.
    ///
    /// `kill(pid, 0)` diría que un zombi está vivo: el pid existe hasta que alguien
    /// lo recoja, y este servidor de prueba pierde a su padre, así que lo recoge el
    /// `init` del contenedor, que puede tardar. Se mira el estado en `/proc`.
    #[cfg(target_os = "linux")]
    fn vivo(pid: u32) -> bool {
        let Ok(stat) = std::fs::read_to_string(format!("/proc/{pid}/stat")) else {
            return false;
        };

        // El formato es `pid (nombre con espacios) estado ...`: el estado es el
        // primer carácter después del **último** paréntesis.
        stat.rsplit_once(')')
            .map(|(_, resto)| !resto.trim_start().starts_with('Z'))
            .unwrap_or(false)
    }

    #[cfg(windows)]
    fn matar_de_golpe(pid: u32) {
        use windows_sys::Win32::Foundation::CloseHandle;
        use windows_sys::Win32::System::Threading::{
            OpenProcess, TerminateProcess, PROCESS_TERMINATE,
        };

        // SAFETY: sólo se pide el derecho de matar; si falla devuelve nulo.
        let proceso = unsafe { OpenProcess(PROCESS_TERMINATE, 0, pid) };

        if proceso.is_null() {
            return;
        }

        // SAFETY: el handle lo devolvió `OpenProcess` y no se ha cerrado.
        unsafe {
            TerminateProcess(proceso, 1);
            CloseHandle(proceso);
        }
    }

    #[cfg(target_os = "linux")]
    fn matar_de_golpe(pid: u32) {
        // SAFETY: `kill` no toca memoria del proceso; `pid` es un proceso que este
        // mismo test lanzó y `SIGKILL` no se puede atrapar.
        unsafe { libc::kill(pid as libc::pid_t, libc::SIGKILL) };
    }

    /// Cerrar el job es lo que hace el kernel al morir el anfitrión; aquí se cierra
    /// a mano, que es la mitad que se puede medir dentro de un solo proceso.
    ///
    /// Va aparte de la prueba de arriba porque dice **qué** falla cuando algo
    /// falla: si el job no mata al cerrarse, el fallo está en `crear` o en
    /// `asignar_a`, no en la muerte del anfitrión.
    #[cfg(windows)]
    #[test]
    fn cerrar_el_job_se_lleva_lo_que_quedaba_dentro() {
        let mut hijo = lanzar_servidor();
        let pid = hijo.id();
        std::thread::sleep(Duration::from_millis(500));

        let job = crate::guards::job::crear_y_asignar(pid).expect("el job de la prueba");

        assert!(
            vivo(pid),
            "el proceso de la prueba ({pid}) no llegó a arrancar"
        );

        crate::guards::job::cerrar(job);

        let limite = Instant::now() + PLAZO;

        while Instant::now() < limite {
            if !vivo(pid) {
                let _ = hijo.wait();
                return;
            }

            std::thread::sleep(Duration::from_millis(100));
        }

        matar_de_golpe(pid);
        let _ = hijo.wait();

        panic!("cerrar el job no mató al proceso ({pid}) que tenía dentro");
    }
}
