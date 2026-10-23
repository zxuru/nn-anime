//! El servidor que viaja dentro del anfitrión.
//!
//! El entregable de Windows es **un solo `.exe`**: el servidor va comprimido en
//! bytes dentro del anfitrión y se extrae a disco la primera vez que hace falta.
//! Así no hay dos archivos que puedan separarse —el fallo más repetido de esta
//! aplicación— ni una carpeta que el usuario tenga que mantener intacta.
//!
//! Lo que se extrae se verifica **siempre** contra el SHA-256 calculado al
//! compilar, y no se vuelve a extraer si ya coincide: un archivo a medias, viejo o
//! manipulado no se ejecuta nunca. La escritura va a un temporal y después se
//! renombra, porque `rename` es atómico en el mismo volumen y nadie puede ver un
//! `.exe` a medio escribir.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

// `SERVIDOR`, `HASH_SERVIDOR` y el hueco vacío los genera `build.rs`.
include!(concat!(env!("OUT_DIR"), "/embebido.rs"));

/// La versión del anfitrión, que también es la del servidor que lleva dentro.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// `true` si este binario se compiló con el servidor dentro.
pub fn hay_servidor() -> bool {
    !SERVIDOR.is_empty()
}

/// Dónde tiene que quedar el servidor: `<raíz>\bin\<versión>\nn-anime.exe`.
///
/// La ruta la decide `sidecar`, que es quien sabe cómo se llama el servidor. La
/// versión va en ella a propósito: una actualización deja la anterior intacta
/// hasta que la nueva está entera, y volver atrás no exige nada.
pub fn ruta(raiz: &Path) -> PathBuf {
    crate::sidecar::sidecar_path(raiz)
}

/// Deja el servidor listo para ejecutar y devuelve su ruta.
pub fn preparar(raiz: &Path) -> std::io::Result<PathBuf> {
    let destino = ruta(raiz);

    if coincide(&destino) {
        return Ok(destino);
    }

    if let Some(dir) = destino.parent() {
        fs::create_dir_all(dir)?;
    }

    // A un temporal y después renombrar: si el proceso muere a mitad, el destino
    // sigue sin existir y la próxima arranque lo vuelve a intentar. Escribir
    // directamente dejaría un `.exe` truncado que `coincide` rechazaría, pero que
    // un antivirus o un usuario podrían intentar ejecutar.
    let temporal = destino.with_extension("exe.tmp");

    {
        let mut archivo = fs::File::create(&temporal)?;
        archivo.write_all(SERVIDOR)?;
        archivo.sync_all()?;
    }

    fs::rename(&temporal, &destino)?;

    Ok(destino)
}

/// `true` si el archivo existe y su SHA-256 es el esperado.
///
/// Se lee entero: no hay atajo honesto. Comparar sólo el tamaño dejaría pasar un
/// binario manipulado del mismo tamaño, que es justo lo que hay que impedir antes
/// de ejecutarlo.
pub fn coincide(ruta: &Path) -> bool {
    let Ok(meta) = fs::metadata(ruta) else {
        return false;
    };

    if meta.len() != SERVIDOR.len() as u64 {
        return false;
    }

    let Ok(bytes) = fs::read(ruta) else {
        return false;
    };

    hex(&Sha256::digest(&bytes)) == HASH_SERVIDOR
}

/// Estado del servidor embebido, para `--diagnostico`. No ejecuta nada.
pub fn estado(raiz: &Path) -> Vec<String> {
    let destino = ruta(raiz);

    vec![
        format!(
            "servidor embebido: {} ({} bytes)",
            if hay_servidor() { "sí" } else { "NO" },
            SERVIDOR.len()
        ),
        format!("sha256 esperado: {HASH_SERVIDOR}"),
        format!("ruta extraída:   {}", destino.display()),
        format!(
            "extraído:        {}",
            match fs::metadata(&destino) {
                Ok(meta) if coincide(&destino) => format!("sí, {} bytes, hash correcto", meta.len()),
                Ok(meta) => format!("sí, {} bytes, hash DISTINTO", meta.len()),
                Err(_) => "no".to_string(),
            }
        ),
    ]
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
