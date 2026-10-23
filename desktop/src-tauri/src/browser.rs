//! Abrir un enlace externo en el navegador **del sistema**.
//!
//! La ventana no se lleva el enlace: `on_navigation` cancela la navegación y el
//! enlace se abre fuera. Es la única salida del webview que existe hoy —un enlace
//! de la ficha a AniList— y por eso este archivo es tan corto.
//!
//! **No se espera a que el navegador termine.** Es una comodidad, y bloquear el
//! bucle de eventos esperando a que alguien cierre una pestaña sería colgar la
//! ventana por abrir un enlace. Los tres descriptores van a `null` por el mismo
//! motivo que en `packages/cli/src/open-browser.ts`: un hijo que hereda la salida
//! del padre puede escribir donde no debe.
//!
//! Se lanza el abridor de cada sistema y no una API de Tauri: el plugin de shell
//! concedería capacidades al webview, y aquí el webview no puede invocar nada.

use std::process::{Command, Stdio};

/// La línea de `start` de Windows para una dirección.
///
/// `start` es un comando del intérprete, y eso tiene dos consecuencias que se ven
/// en los argumentos:
///
/// - el **primer** argumento que no es una opción es el *título* de la ventana, así
///   que sin el hueco vacío intermedio `start` se come la dirección como si fuera el
///   título y no abre nada;
/// - `cmd` trata `&`, `|`, `^`, `<` y `>` como **separadores de comando**, así que
///   una dirección con `&` —`?a=1&b=2`, que un proveedor puede poner en un enlace—
///   partiría la línea y ejecutaría lo que viniera detrás. Entre comillas es un
///   carácter más de la dirección, y por eso va entrecomillada.
///
/// Es una función pura y por eso se puede probar: la prueba no puede abrir un
/// navegador, pero sí comprobar **exactamente** lo que se le pasa al intérprete.
fn windows_args(url: &str) -> Vec<String> {
    vec![
        "/C".to_string(),
        "start".to_string(),
        String::new(),
        format!("\"{url}\""),
    ]
}

pub fn open(url: &str) -> std::io::Result<()> {
    // Una dirección que no se puede entrecomillar no se lanza: en Windows acabaría
    // dentro de una línea de comandos. La que llega viene de `Url::parse` en
    // `on_navigation`, así que sus comillas y saltos de línea vienen
    // percent-codificados; esto es la red por si algún día llega por otro camino.
    if url.contains('"') || url.contains('\n') || url.contains('\r') || url.contains('\0') {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "la dirección lleva caracteres que no se pueden pasar al abridor",
        ));
    }

    let (program, args): (&str, Vec<String>) = if cfg!(target_os = "windows") {
        ("cmd", windows_args(url))
    } else if cfg!(target_os = "macos") {
        ("open", vec![url.to_string()])
    } else {
        ("xdg-open", vec![url.to_string()])
    };

    Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_puts_an_empty_title_before_the_url() {
        let args = windows_args("https://example.org");

        assert_eq!(args[0], "/C");
        assert_eq!(args[1], "start");
        // Sin este hueco, `start` interpreta la dirección como el título de la
        // ventana y no abre nada.
        assert_eq!(args[2], "");
    }

    #[test]
    fn windows_quotes_the_url_so_its_metacharacters_do_not_split_the_command() {
        // El caso que importa: sin comillas, `&` parte la línea de `cmd` y lo que
        // venga detrás se ejecuta. La prueba mira el argumento **de verdad**, el que
        // construye el código, y no una copia del literal.
        let args = windows_args("https://example.org/?a=1&b=2");

        assert_eq!(args[3], "\"https://example.org/?a=1&b=2\"");
        assert!(args[3].starts_with('"') && args[3].ends_with('"'));
    }

    #[test]
    fn a_url_that_cannot_be_quoted_is_not_launched() {
        // Devuelve `Err` antes de lanzar nada, así que la prueba no abre un
        // navegador ni ejecuta un comando.
        assert!(open("https://example.org/\"raro").is_err());
        assert!(open("https://example.org/\ninject").is_err());
    }
}
