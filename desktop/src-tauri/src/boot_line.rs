//! El espejo del esquema de `packages/core/src/boot-line.ts`.
//!
//! El CLI imprime una línea **humana** con la URL —traducida— y otra **fija** que
//! lee un programa. El anfitrión lee la segunda: analizar texto traducido es un
//! contrato que se rompe el día que exista el catálogo del idioma que falta, y
//! hoy sólo hay español, así que el fallo no se vería hasta entonces.
//!
//! El formato vive en dos sitios por necesidad —uno en TypeScript, que lo
//! escribe, y otro aquí, que lo lee— y por eso este archivo lleva sus propias
//! pruebas y una que comprueba el prefijo contra el de `core`. Lo que **no** se
//! duplica es el criterio: una línea con el prefijo y el JSON roto no se ignora
//! en silencio, porque arrancar con una dirección a medias es peor que decir que
//! no se encontró.

use serde::Deserialize;

/// El prefijo literal. No se traduce y no cambia.
pub const BOOT_LINE_PREFIX: &str = "NN_ANIME_BOOT";

/// El prefijo **con el espacio** que lo separa del JSON.
const PREFIJO_CON_ESPACIO: &str = "NN_ANIME_BOOT ";

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct BootLine {
    /// Puerto real de escucha. `u16` ya rechaza lo que no cabe en un puerto.
    pub port: u16,
    /// La URL de arranque, con su token de un solo uso.
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BootLineError {
    /// Ninguna línea traía el prefijo: el servidor no llegó a anunciarse.
    Missing,
    /// La traía y no se pudo leer. Lleva el motivo para poder decirlo.
    Malformed(String),
}

impl std::fmt::Display for BootLineError {
    fn fmt(&self, salida: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Missing => write!(salida, "el servidor no anunció su dirección"),
            Self::Malformed(motivo) => {
                write!(salida, "la línea de arranque está mal formada: {motivo}")
            }
        }
    }
}

impl std::error::Error for BootLineError {}

/// La primera línea con el prefijo, o `Missing` si no hay ninguna.
///
/// Se mira el texto entero y no una línea suelta porque el `stdout` del CLI lleva
/// más cosas —la URL humana, la lista de proveedores activos— y el lector no
/// tiene por qué saber en qué orden salen.
pub fn parse(texto: &str) -> Result<BootLine, BootLineError> {
    for linea in texto.lines() {
        // El CLI escribe con `\n`, pero un `stdout` en Windows puede traer `\r\n`
        // y el `\r` se colaría dentro del JSON.
        let linea = linea.strip_suffix('\r').unwrap_or(linea);

        let Some(json) = linea.strip_prefix(PREFIJO_CON_ESPACIO) else {
            continue;
        };

        // La primera que trae el prefijo decide: no se sigue buscando. Si está
        // rota, el lector tiene que decirlo, no quedarse con la siguiente.
        return interpretar(json);
    }

    Err(BootLineError::Missing)
}

fn interpretar(json: &str) -> Result<BootLine, BootLineError> {
    let linea: BootLine =
        serde_json::from_str(json).map_err(|error| BootLineError::Malformed(error.to_string()))?;

    // El puerto 0 significa «que el sistema elija» en `Bun.serve`, y el CLI
    // anuncia el puerto **real**, así que un 0 aquí es una línea de otro sitio.
    if linea.port == 0 {
        return Err(BootLineError::Malformed(
            "el puerto anunciado es 0".to_string(),
        ));
    }

    // Lista blanca de esquemas, como en `httpUrlSchema` de `core`: la ventana
    // carga esta dirección, así que un `file:` o un `javascript:` no pasan.
    if !(linea.url.starts_with("http://") || linea.url.starts_with("https://")) {
        // La URL se ata a un local para poder interpolarla: un argumento implícito
        // de `format!` tiene que ser un identificador, y `linea.url` es un campo.
        let url = &linea.url;

        return Err(BootLineError::Malformed(format!(
            "la URL no es http ni https: {url}"
        )));
    }

    Ok(linea)
}

#[cfg(test)]
mod tests {
    use super::*;

    const BUENA: &str = r#"NN_ANIME_BOOT {"port":41235,"url":"http://127.0.0.1:41235/?boot=abc"}"#;

    #[test]
    fn lee_la_linea_buena() {
        let boot = parse(BUENA).expect("debería leerla");

        assert_eq!(boot.port, 41235);
        assert_eq!(boot.url, "http://127.0.0.1:41235/?boot=abc");
    }

    #[test]
    fn la_encuentra_entre_las_demas_lineas_del_cli() {
        // El orden real de `boot.ts`: la humana, la de máquina y los proveedores.
        let salida = format!(
            "nn-anime escuchando en http://127.0.0.1:1/?boot=x\n{BUENA}\nProveedores activos: ninguno\n"
        );

        assert_eq!(parse(&salida).expect("debería leerla").port, 41235);
    }

    #[test]
    fn acepta_el_fin_de_linea_de_windows() {
        let con_retorno = BUENA.replace('\n', "\r\n");

        assert!(parse(&con_retorno).is_ok());
    }

    #[test]
    fn sin_la_linea_dice_que_no_esta() {
        assert_eq!(
            parse("Proveedores activos: ninguno\n"),
            Err(BootLineError::Missing)
        );
        assert_eq!(parse(""), Err(BootLineError::Missing));
    }

    #[test]
    fn un_json_roto_no_se_ignora() {
        // El fallo que este archivo existe para no cometer: seguir buscando y
        // arrancar con otra dirección, o no decir nada.
        assert!(matches!(
            parse(r#"NN_ANIME_BOOT {"port":41235,"#),
            Err(BootLineError::Malformed(_))
        ));
    }

    #[test]
    fn sin_el_espacio_no_es_la_linea() {
        // `NN_ANIME_BOOT{...}` no lleva el separador, así que no es la línea: se
        // trata como si no estuviera, igual que el `startsWith` de TypeScript.
        assert_eq!(
            parse(r#"NN_ANIME_BOOT{"port":1,"url":"http://127.0.0.1:1/"}"#),
            Err(BootLineError::Missing)
        );
    }

    #[test]
    fn rechaza_el_puerto_cero_y_el_que_no_cabe() {
        assert!(matches!(
            parse(r#"NN_ANIME_BOOT {"port":0,"url":"http://127.0.0.1:1/"}"#),
            Err(BootLineError::Malformed(_))
        ));
        assert!(matches!(
            parse(r#"NN_ANIME_BOOT {"port":70000,"url":"http://127.0.0.1:1/"}"#),
            Err(BootLineError::Malformed(_))
        ));
    }

    #[test]
    fn rechaza_los_esquemas_que_no_son_http() {
        assert!(matches!(
            parse(r#"NN_ANIME_BOOT {"port":1,"url":"javascript:alert(1)"}"#),
            Err(BootLineError::Malformed(_))
        ));
        assert!(matches!(
            parse(r#"NN_ANIME_BOOT {"port":1,"url":"file:///etc/passwd"}"#),
            Err(BootLineError::Malformed(_))
        ));
        // https sí: la lista blanca es de esquemas, no de loopback.
        assert!(parse(r#"NN_ANIME_BOOT {"port":1,"url":"https://127.0.0.1:1/"}"#).is_ok());
    }

    #[test]
    fn exige_las_dos_claves() {
        assert!(matches!(
            parse(r#"NN_ANIME_BOOT {"port":41235}"#),
            Err(BootLineError::Malformed(_))
        ));
        assert!(matches!(
            parse(r#"NN_ANIME_BOOT {"url":"http://127.0.0.1:1/"}"#),
            Err(BootLineError::Malformed(_))
        ));
    }
}
