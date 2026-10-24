/**
 * La dirección de un repositorio de GitHub.
 *
 * Un repo entra en la aplicación por una sola puerta: lo que el usuario pega o
 * teclea en Ajustes. Esa cadena decide tres cosas —qué se descarga, dónde se
 * guarda y qué se le enseña— así que se analiza **una vez**, aquí, y lo que sale
 * es lo que se guarda y lo que viaja. Dos análisis distintos del mismo texto
 * —uno en el formulario y otro en el servidor— acabarían aceptando cosas
 * distintas, y la que manda es la del servidor.
 *
 * Cuatro decisiones que se leen en el código:
 *
 * 1. **Sólo GitHub.** Otro host no es «un repo raro», es otro sitio: `gitlab.com`
 *    se rechaza con su motivo en vez de intentarse. La lista de hosts es esta y
 *    no una copia en el servidor.
 * 2. **Todo lo que va a un camino se valida después de descodificar.** Una
 *    dirección con `%2e%2e` es `..` cuando el sistema de archivos la lee: la
 *    comprobación tiene que ser sobre el valor descodificado, no sobre el texto.
 * 3. **Lo que se normaliza es lo que se compara.** Mayúsculas a minúsculas en
 *    `owner` y `repo` —GitHub no distingue—, sin barra final y sin `.git`: si no,
 *    el mismo repositorio entraría dos veces y se descargaría dos veces.
 * 4. **La referencia no se inventa.** Una subcarpeta sin referencia no existe en
 *    GitHub —`/tree/` lleva siempre una rama delante— y aceptarla obligaría a
 *    adivinar cuál. Se rechaza y se dice.
 */

/**
 * El repositorio que la aplicación propone como punto de partida.
 *
 * Vive aquí, y no en la web y el CLI por separado, porque los dos lo nombran en
 * el primer arranque: una sola cadena evita que la recomendación de la consola y
 * la de la pantalla se desincronicen. No se instala ni se activa solo; el flujo
 * de dos pasos de Ajustes es el que decide qué código se ejecuta.
 */
export const RECOMMENDED_PROVIDER_REPO = 'https://github.com/zxuru/nn-anime-plugins'

/**
 * Lo máximo que puede medir una dirección normalizada.
 *
 * No es una regla del formato sino la suma de los cuatro topes de abajo —39, 100,
 * 200 y 300 más el pegamento—: nada que salga de aquí puede pasarse de esta
 * cuenta. Se declara porque es lo que acota el campo guardado: una ficha con una
 * dirección más larga no la ha escrito este módulo, y leerla sería leer algo que
 * nadie prometió.
 */
export const MAX_REPO_URL_LENGTH = 700
/** El tope de un nombre de usuario de GitHub. */
export const MAX_REPO_OWNER_LENGTH = 39
/** El tope de un nombre de repositorio de GitHub. */
export const MAX_REPO_NAME_LENGTH = 100
/** El tope de una rama, etiqueta o commit. */
export const MAX_REPO_REF_LENGTH = 200
/** El tope de la subcarpeta que se enseña y se guarda. */
export const MAX_REPO_SUBDIR_LENGTH = 300
/** El tope de una ruta dentro del repositorio: la suma de sus partes. */
export const MAX_REPO_PATH_LENGTH = 400
/** Cuántos proveedores puede ofrecer un repo antes de mirar si hay algo raro. */
export const MAX_REPO_CANDIDATES = 64
/** Cuántos archivos de repo puede tener habilitados el usuario. */
export const MAX_ENABLED_REPO_FILES = 64

/** Los hosts que son GitHub. `www.` es la misma cosa escrita de otra forma. */
const GITHUB_HOSTS: readonly string[] = ['github.com', 'www.github.com']

/** Un esquema con autoridad: `https://`, `file://`, lo que sea que venga. */
const ESQUEMA_RE = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//

/**
 * Un usuario de GitHub: alfanumérico y guiones, sin empezar ni acabar en guion.
 * Se comprueba en minúsculas porque el análisis ya normalizó.
 */
const OWNER_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/

/** Un repositorio: alfanumérico, guion, guion bajo y punto. */
const REPO_RE = /^[a-z0-9_.-]+$/

/**
 * Una rama, una etiqueta, un commit o una carpeta.
 *
 * Es más estricto que Git a propósito: lo que no cumple esto acabaría siendo un
 * nombre de archivo o una URL, y admitir un `\` o un espacio para que funcione
 * una rama exótica abre la puerta a que la ruta se salga del directorio.
 */
const SEGMENT_RE = /^[A-Za-z0-9._-]+$/

export interface GithubRepoLocation {
  /** Usuario u organización, en minúsculas. */
  readonly owner: string
  /** Repositorio, en minúsculas y sin `.git`. */
  readonly repo: string
  /** Rama, etiqueta o commit. Sin él, la rama por defecto del repositorio. */
  readonly ref?: string
  /** Subcarpeta donde viven los proveedores. Sin ella, la raíz del repo. */
  readonly subdir?: string
  /** La dirección normalizada: la que se guarda y la que se enseña. */
  readonly url: string
}

function baseUrl(owner: string, repo: string): string {
  return `https://github.com/${owner}/${repo}`
}

function stripGitSuffix(value: string): string {
  return value.endsWith('.git') ? value.slice(0, -'.git'.length) : value
}

/** Un segmento descodificado, o `undefined` si no es una descodificación válida. */
function decodeSegment(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment)
  } catch {
    return undefined
  }
}

/** Los segmentos útiles de una ruta, ya descodificados. */
function decodeSegments(segments: readonly string[]): readonly string[] | undefined {
  const salida: string[] = []

  for (const segment of segments) {
    if (segment === '') continue

    const decoded = decodeSegment(segment)
    if (decoded === undefined) return undefined

    salida.push(decoded)
  }

  return salida
}

/**
 * Los segmentos de camino de lo que se escribió, venga con esquema o sin él.
 *
 * Se admite `github.com/o/r` y `o/r` porque son las dos formas en que la gente
 * escribe esto; un texto con más de dos segmentos y sin host es ambiguo —podría
 * ser un repo y una carpeta, o dos carpetas— y se rechaza en vez de adivinar.
 */
function segmentsOf(raw: string): readonly string[] | undefined {
  if (ESQUEMA_RE.test(raw)) {
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      return undefined
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    // Credenciales y puerto: son otra cosa que un repositorio, y `https://` a un
    // puerto raro no es una dirección de GitHub que exista.
    if (url.username !== '' || url.password !== '') return undefined
    if (url.port !== '') return undefined
    if (!GITHUB_HOSTS.includes(url.hostname.toLowerCase())) return undefined

    return decodeSegments(url.pathname.split('/'))
  }

  const parts = raw.split('/')
  const first = (parts[0] ?? '').toLowerCase()
  const resto = GITHUB_HOSTS.includes(first) ? parts.slice(1) : parts

  return decodeSegments(resto)
}

function isOwner(value: string): boolean {
  return value.length <= MAX_REPO_OWNER_LENGTH && OWNER_RE.test(value)
}

function isRepoName(value: string): boolean {
  if (value.length > MAX_REPO_NAME_LENGTH) return false
  // `.` y `..` cumplen la expresión y son nombres de directorio, no de repo.
  if (value === '.' || value === '..') return false

  return REPO_RE.test(value)
}

/** Cada segmento, uno a uno: `..` dentro de una carpeta es una salida, no un nombre. */
function isPathSegments(segments: readonly string[]): boolean {
  return segments.every(
    (segment) => segment !== '.' && segment !== '..' && SEGMENT_RE.test(segment),
  )
}

function isRef(value: string): boolean {
  return value.length <= MAX_REPO_REF_LENGTH && isPathSegments([value])
}

/**
 * Lo que hay detrás de la dirección, o `undefined` si no es un repo de GitHub.
 *
 * Devuelve `undefined` y no un error con motivo porque hay dos consumidores con
 * necesidades distintas: el schema de Zod sólo quiere saber si vale —y su
 * mensaje es el que lee el usuario en el formulario— y el servidor sólo analiza
 * direcciones que ya pasaron ese schema.
 */
export function githubRepoFromUrl(raw: string): GithubRepoLocation | undefined {
  const texto = raw.trim()
  if (texto === '') return undefined

  const segments = segmentsOf(texto)
  if (segments === undefined || segments.length < 2) return undefined

  const owner = (segments[0] ?? '').toLowerCase()
  const repo = stripGitSuffix((segments[1] ?? '').toLowerCase())
  if (!isOwner(owner) || !isRepoName(repo)) return undefined

  const resto = segments.slice(2)
  if (resto.length === 0) return { owner, repo, url: baseUrl(owner, repo) }

  // `tree` es la única forma que nombra una referencia. `blob` nombra un archivo
  // y `issues` o `pulls`, una página: ninguna de las dos es el repositorio.
  if (resto[0] !== 'tree' || resto.length < 2) return undefined

  const ref = resto[1] ?? ''
  if (!isRef(ref)) return undefined

  const subdir = resto.slice(2)
  if (subdir.length === 0) return { owner, repo, ref, url: `${baseUrl(owner, repo)}/tree/${ref}` }
  if (!isPathSegments(subdir)) return undefined

  const carpeta = subdir.join('/')
  if (carpeta.length > MAX_REPO_SUBDIR_LENGTH) return undefined

  return {
    owner,
    repo,
    ref,
    subdir: carpeta,
    url: `${baseUrl(owner, repo)}/tree/${ref}/${carpeta}`,
  }
}
