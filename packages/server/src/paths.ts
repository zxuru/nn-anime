/**
 * Rutas con prefijo protegido.
 *
 * Vive en su propio módulo para que tanto la composición de la aplicación como
 * el servido de estáticos puedan consultarlo sin importarse entre sí: el
 * servido de estáticos tiene que **abstenerse** de estas rutas, porque la
 * interfaz no responde por ellas.
 */

/** Todo lo que cuelga de aquí pasa por los guards y lo responde la API. */
export const PROTECTED_PREFIXES: readonly string[] = ['/api/', '/stream/']

export function isProtectedPath(path: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => path.startsWith(prefix))
}
