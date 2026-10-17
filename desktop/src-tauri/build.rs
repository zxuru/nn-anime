// El guion de compilación de Tauri.
//
// Lee `tauri.conf.json`, valida su esquema y genera el contexto que consume
// `tauri::generate_context!()`. Sin esto, la compilación falla con un error que
// habla de un símbolo que falta y no del archivo de configuración que lo causa.
fn main() {
    tauri_build::build()
}
