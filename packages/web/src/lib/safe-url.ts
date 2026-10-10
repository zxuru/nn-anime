/**
 * Lista blanca de esquemas para direcciones que vienen de fuera.
 *
 * Una `coverUrl` o la dirección de un subtítulo las escribe un plugin, y un
 * plugin es código de terceros: `javascript:alert(1)` en un `href` es una
 * ejecución de guiones en el origen de la aplicación, con la cookie de sesión a
 * mano. `data:` es lo mismo con otro nombre, y `vbscript:` funciona donde nadie
 * se acuerda de mirar.
 *
 * La defensa es una lista **blanca** y no negra: se acepta `http` y `https`, y
 * todo lo demás se descarta. Una lista negra se queda corta en cuanto aparece un
 * esquema nuevo, y aquí el precio de quedarse corta es ejecutar código ajeno.
 *
 * La dirección que no pasa se pinta como **texto**, no como enlace ni imagen: el
 * dato sigue visible —el usuario merece saber qué mandó el proveedor— pero no
 * hay atributo que lo convierta en algo pulsable o cargable.
 */

/** Esquemas que se aceptan. Ni uno más. */
export const SAFE_SCHEMES: readonly string[] = ['http:', 'https:']

/**
 * La dirección, si su esquema está permitido; `null` si no.
 *
 * Se resuelve con `URL` para que la comparación sea sobre el esquema real y no
 * sobre el texto: `java\nscript:` o `JaVaScRiPt:` son el mismo esquema, y una
 * comparación de cadenas los dejaría pasar.
 */
export function safeUrl(value: string | undefined): string | null {
  if (value === undefined) return null

  const limpio = value.trim()
  if (limpio === '') return null

  try {
    const url = new URL(limpio)

    return SAFE_SCHEMES.includes(url.protocol) ? url.href : null
  } catch {
    // Sin esquema ni base no es una dirección absoluta: una ruta relativa no
    // puede cambiar de origen, pero tampoco viene de un proveedor, así que aquí
    // no se admite. Devolverla tal cual sería admitir `//otro.example/x`.
    return null
  }
}

/** ¿Es una dirección que se puede usar en un atributo? */
export function isSafeUrl(value: string | undefined): boolean {
  return safeUrl(value) !== null
}
