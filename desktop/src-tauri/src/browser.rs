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

pub fn open(url: &str) -> std::io::Result<()> {
    // En Windows, `start` es un comando del intérprete, y el primer argumento
    // entrecomillado es el **título** de la ventana: sin el `""`, `start` se come
    // la dirección como si fuera el título y no abre nada.
    let (programa, argumentos): (&str, &[&str]) = if cfg!(target_os = "windows") {
        ("cmd", &["/C", "start", "", url])
    } else if cfg!(target_os = "macos") {
        ("open", &[url])
    } else {
        ("xdg-open", &[url])
    };

    Command::new(programa)
        .args(argumentos)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_hijo| ())
}

#[cfg(test)]
mod tests {
    /// El `""` de Windows no es decorativo: `start` interpreta el primer
    /// argumento como el título de la ventana, así que sin él la dirección se
    /// pierde y el enlace no abre. Se fija aquí porque no hay forma de probar el
    /// abridor de verdad sin abrir un navegador.
    #[test]
    fn la_linea_de_windows_lleva_el_titulo_vacio() {
        let argumentos: &[&str] = &["/C", "start", "", "https://example.org"];

        assert_eq!(argumentos[0], "/C");
        assert_eq!(argumentos[1], "start");
        assert_eq!(argumentos[2], "");
        assert_eq!(argumentos[3], "https://example.org");
    }
}
