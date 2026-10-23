// El guion de compilación de Tauri.
//
// Hace dos cosas: generar el contexto de la aplicación (`tauri_build::build()`) y
// **meter el servidor dentro del anfitrión**, que es lo que permite entregar un
// solo `.exe`. El binario del servidor se lee aquí, se calcula su SHA-256 y las
// dos cosas se escriben como código Rust en `OUT_DIR`.
//
// Si el servidor no está compilado, el anfitrión se compila igual con un hueco
// vacío: así `cargo check` y `cargo test` funcionan en un árbol recién clonado,
// sin obligar a ejecutar Bun antes. La aplicación dirá que falta el servidor en
// vez de romperse al arrancar.
use std::path::PathBuf;

use sha2::{Digest, Sha256};

fn main() {
    let manifiesto = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let salida = PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR")).join("embebido.rs");

    // La ruta se puede forzar con `NN_ANIME_SERVIDOR`, que es lo que usará el
    // empaquetado cuando compile para otro objetivo. Por defecto, la que deja
    // `bun run package` en el repositorio.
    let servidor = std::env::var_os("NN_ANIME_SERVIDOR").map_or_else(
        || {
            manifiesto
                .join("..")
                .join("..")
                .join("build")
                .join("package")
                .join("windows-x64")
                .join("nn-anime.exe")
        },
        PathBuf::from,
    );

    println!("cargo:rerun-if-env-changed=NN_ANIME_SERVIDOR");
    println!("cargo:rerun-if-changed={}", servidor.display());

    let codigo = match std::fs::read(&servidor) {
        Ok(bytes) => {
            let hash = Sha256::digest(&bytes);
            let hex: String = hash.iter().map(|byte| format!("{byte:02x}")).collect();
            let ruta = servidor.canonicalize().unwrap_or_else(|_| servidor.clone());

            format!(
                "/// El servidor que viaja dentro del anfitrión.\n\
                 pub static SERVIDOR: &[u8] = include_bytes!({ruta:?});\n\
                 \n\
                 /// Su SHA-256, calculado al compilar: en tiempo de ejecución sólo\n\
                 /// hay que comprobar el archivo extraído contra él.\n\
                 pub const HASH_SERVIDOR: &str = \"{hex}\";\n"
            )
        }
        Err(error) => format!(
            "/// No había servidor al compilar ({error}).\n\
             pub static SERVIDOR: &[u8] = &[];\n\
             pub const HASH_SERVIDOR: &str = \"\";\n"
        ),
    };

    std::fs::write(&salida, codigo).expect("no se pudo escribir el servidor embebido");

    tauri_build::build()
}
