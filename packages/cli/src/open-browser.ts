/**
 * Apertura del navegador.
 *
 * Abrir el navegador es una comodidad, no un requisito: si falla, la aplicación
 * sigue funcionando y la dirección ya está impresa en la terminal. Por eso esta
 * función devuelve si pudo lanzar el comando, no si el navegador llegó a abrir.
 */

export interface SpawnHandle {
  readonly exited: Promise<number>
}

export interface OpenDeps {
  /** Inyectable para poder testear sin lanzar procesos. */
  readonly spawn: (argv: readonly string[]) => SpawnHandle
  readonly platform?: string
}

/** Comando de apertura por plataforma, como lista de argumentos. */
export function browserCommand(platform: string): readonly string[] {
  switch (platform) {
    case 'darwin':
      return ['open']
    case 'win32':
      // El primer argumento vacío es el título de la ventana, que `start` exige.
      return ['cmd', '/c', 'start', '']
    default:
      return ['xdg-open']
  }
}

export async function openInBrowser(url: string, deps: OpenDeps): Promise<boolean> {
  const argv = [...browserCommand(deps.platform ?? process.platform), url]

  try {
    const handle = deps.spawn(argv)
    return (await handle.exited) === 0
  } catch {
    return false
  }
}
