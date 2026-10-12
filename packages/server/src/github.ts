/**
 * Traer un repositorio de GitHub, con la lista blanca por delante.
 *
 * Esta es la única parte del proyecto que sale a un destino que el usuario
 * escribe, y por eso concentra las cautelas. Tres capas, en este orden:
 *
 * 1. **La lista blanca de hosts.** Sólo `api.github.com` y
 *    `raw.githubusercontent.com`. La comprobación de destinos que ya existe
 *    —loopback, redes privadas, metadata de nube— se aplica igual, pero no basta:
 *    deja pasar cualquier host público, y aquí el usuario escribe la dirección.
 * 2. **La comprobación de destino, en cada salto.** Las dos peticiones se hacen
 *    con `fetchAllowed`, que resuelve el nombre, revisa **todas** las respuestas
 *    del DNS y vuelve a validar cada redirección. Un host permitido que redirige
 *    a `127.0.0.1` se corta en el salto.
 * 3. **La ruta del árbol.** Cada ruta que llega de GitHub se valida segmento a
 *    segmento —sin `..`, sin absolutas, sin barra invertida, sin NUL, sin unidad
 *    de Windows— y además se confina contra el directorio de destino. La ruta
 *    viene de un servicio de confianza; la comprobación está igual porque un
 *    error de confianza se paga escribiendo fuera de sitio.
 *
 * Y tres topes, porque un repositorio lo elige el usuario y puede ser cualquiera:
 * 400 archivos, 512 KiB por archivo y 8 MiB en total. El de tamaño por archivo
 * **salta** el archivo —un repo puede llevar una portada grande sin que eso
 * impida instalar sus proveedores—; los otros dos son un error, porque instalar
 * la mitad de un repo sin decirlo deja un proveedor que falla por un archivo que
 * no está, lejos de la causa.
 *
 * Lo que se escribe va primero a un directorio temporal hermano del destino y se
 * mueve al final: un fallo a mitad no deja un repositorio a medias que parezca
 * completo.
 */

import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { AppError, type GithubRepoLocation, MAX_REPO_PATH_LENGTH } from '@nn-anime/core'
import { type FetchLike, fetchAllowed, type Resolver } from '@nn-anime/media-proxy'
import { z } from 'zod'

/** El host de la API. Es el que dice la rama por defecto y el árbol. */
export const GITHUB_API_HOST = 'api.github.com'
/** El host del contenido. Sirve el texto de cada archivo, sin límite de API. */
export const GITHUB_RAW_HOST = 'raw.githubusercontent.com'

/**
 * Los únicos hosts a los que esta función sale.
 *
 * `github.com` está porque una redirección al host canónico no es un cambio de
 * host: lo que no se admite es salir de GitHub, y los tres son GitHub.
 */
export const GITHUB_HOSTS: readonly string[] = [GITHUB_API_HOST, GITHUB_RAW_HOST, 'github.com']

/** Cuántos archivos se descargan antes de decir que el repo no es un repo de plugins. */
export const MAX_REPO_FILES = 400
/** Un archivo más grande que esto no es código de proveedor. Se salta. */
export const MAX_REPO_FILE_BYTES = 512 * 1024
/** Lo que puede ocupar la copia entera. */
export const MAX_REPO_TOTAL_BYTES = 8 * 1024 * 1024
/** Lo que puede medir la lista del árbol. GitHub la trunca a 7 MB por su cuenta. */
export const MAX_TREE_BYTES = 8 * 1024 * 1024

/** Lo que se espera a GitHub en cada petición. */
export const GITHUB_TIMEOUT_MS = 30_000

/** Directorios de trabajo: no son parte de lo que el plugin necesita para correr. */
const SKIPPED_SEGMENTS: readonly string[] = [
  'node_modules',
  'dist',
  'build',
  'coverage',
  'vendor',
  '__pycache__',
]

/**
 * Extensiones que no se descargan.
 *
 * No es una lista de lo permitido sino de lo que no tiene sentido traer: una
 * portada, una fuente o un video no son código, y bajarlos gastaría el tope de
 * bytes en lo que el proveedor no lee.
 */
const BINARY_EXTENSIONS: readonly string[] = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.bmp',
  '.ico',
  '.icns',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.mp3',
  '.mp4',
  '.mkv',
  '.webm',
  '.wav',
  '.ogg',
  '.flac',
  '.zip',
  '.gz',
  '.tgz',
  '.bz2',
  '.7z',
  '.rar',
  '.pdf',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.wasm',
  '.class',
  '.jar',
  '.pyc',
  '.db',
  '.sqlite',
  '.sqlite3',
  '.bin',
  '.iso',
  '.dmg',
]

export interface GithubLimits {
  readonly maxFiles: number
  readonly maxFileBytes: number
  readonly maxTotalBytes: number
}

export const DEFAULT_LIMITS: GithubLimits = {
  maxFiles: MAX_REPO_FILES,
  maxFileBytes: MAX_REPO_FILE_BYTES,
  maxTotalBytes: MAX_REPO_TOTAL_BYTES,
}

export interface DownloadGithubRepoOptions {
  readonly location: GithubRepoLocation
  /** Directorio definitivo del repositorio. Lo que haya ahí se reemplaza. */
  readonly destination: string
  /** `fetch` inyectable: las pruebas no salen a la red. */
  readonly fetchImpl?: FetchLike | undefined
  /** Resolutor inyectable: las pruebas no resuelven nombres de verdad. */
  readonly resolver?: Resolver | undefined
  readonly signal?: AbortSignal | undefined
  readonly limits?: Partial<GithubLimits> | undefined
}

export interface DownloadedRepo {
  /** La referencia que se descargó: la pedida, o la rama por defecto. */
  readonly ref: string
  /** Las rutas escritas, relativas al destino y con `/`. */
  readonly files: readonly string[]
  readonly bytes: number
}

export type DownloadOutcome =
  | ({ readonly ok: true } & DownloadedRepo)
  | { readonly ok: false; readonly error: AppError }

/** Un fallo de esta función, con el contexto que hace falta para contarlo. */
function failure(
  message: string,
  context: Readonly<Record<string, string | number | boolean>>,
  cause?: unknown,
): AppError {
  return new AppError({
    code: 'upstream',
    message,
    scope: 'github',
    op: 'downloadGithubRepo',
    context,
    cause,
  })
}

/** ¿Es una dirección de las que esta función puede pedir? */
export function isGithubUrl(raw: string): boolean {
  try {
    return GITHUB_HOSTS.includes(new URL(raw).hostname.toLowerCase())
  } catch {
    return false
  }
}

/**
 * Una ruta del árbol, tal como llega de GitHub.
 *
 * Se valida sobre el valor **tal cual** porque no hay nada que descodificar: la
 * API devuelve rutas reales, no una dirección. Lo que se comprueba es que cada
 * segmento sea un nombre: `..` deja de ser una salida, una barra invertida deja
 * de ser un separador en Windows y `C:` deja de ser una unidad.
 */
export function isSafeRepoPath(path: string): boolean {
  if (path === '' || path.length > MAX_REPO_PATH_LENGTH) return false
  if (path.includes('\\') || path.includes('\0')) return false
  if (path.startsWith('/')) return false
  if (/^[A-Za-z]:/.test(path)) return false

  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

/** ¿Esta ruta se salta? Directorios de trabajo, ocultos y binarios. */
export function isSkippedRepoPath(path: string): boolean {
  const segments = path.split('/')

  if (segments.some((segment) => segment.startsWith('.'))) return true

  const directories = segments.slice(0, -1)
  if (directories.some((segment) => SKIPPED_SEGMENTS.includes(segment))) return true

  const name = segments.at(-1) ?? ''
  const dot = name.lastIndexOf('.')

  return dot > 0 && BINARY_EXTENSIONS.includes(name.slice(dot).toLowerCase())
}

/** El archivo escrito, confinado al destino. `undefined` si se sale del sitio. */
export function confine(destination: string, path: string): string | undefined {
  const base = resolve(destination)
  const full = resolve(base, path)

  if (full !== base && !full.startsWith(`${base}${sep}`)) return undefined

  return full
}

/* Las dos formas de la respuesta de GitHub que se leen, validadas como todo lo
 * que entra de fuera. No son estrictas a propósito: GitHub añade campos con cada
 * versión de su API y una clave de más no es un error suyo. */
const repoSchema = z.object({ default_branch: z.string().min(1) })
const treeSchema = z.object({
  truncated: z.boolean().optional(),
  tree: z.array(
    z.object({
      path: z.string(),
      type: z.string(),
      size: z.number().nonnegative().optional(),
    }),
  ),
})

interface FetchContext {
  readonly fetchImpl: FetchLike
  readonly resolver: Resolver | undefined
  readonly signal: AbortSignal | undefined
}

/**
 * Un `fetch` que **además** comprueba el host en cada salto.
 *
 * La lista blanca no puede vivir sólo en la primera URL: una redirección es la
 * forma más fácil de saltársela, y `fetchAllowed` valida la dirección resuelta
 * —loopback, redes privadas— pero deja pasar cualquier host público. El envoltorio
 * va dentro de `fetchAllowed` a propósito: así se comprueba en cada salto, justo
 * antes de abrir la conexión, que es donde la comprobación sirve de algo.
 */
function guardedFetch(inner: FetchLike): FetchLike {
  return async (input, init) => {
    if (!isGithubUrl(input)) {
      throw failure(`destino que no es de GitHub: ${hostOf(input)}`, { host: hostOf(input) })
    }

    return inner(input, init)
  }
}

/**
 * Una petición a GitHub: host permitido, destino comprobado y respuesta leída con
 * tope. El cuerpo no se lee si el estado no es 2xx: se devuelve el error con su
 * código para que quien llame pueda decir qué pasó.
 */
async function get(
  url: string,
  context: FetchContext,
): Promise<
  { readonly ok: true; readonly body: string } | { readonly ok: false; readonly error: AppError }
> {
  if (!isGithubUrl(url)) {
    return { ok: false, error: failure(`destino que no es de GitHub: ${hostOf(url)}`, { url }) }
  }

  const signal =
    context.signal === undefined
      ? AbortSignal.timeout(GITHUB_TIMEOUT_MS)
      : AbortSignal.any([context.signal, AbortSignal.timeout(GITHUB_TIMEOUT_MS)])

  let response: Response
  try {
    response = await fetchAllowed({
      url,
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'nn-anime' },
      signal,
      fetchImpl: guardedFetch(context.fetchImpl),
      ...(context.resolver === undefined ? {} : { resolver: context.resolver }),
    })
  } catch (cause) {
    return { ok: false, error: asAppError(cause, url) }
  }

  if (!response.ok) {
    return { ok: false, error: statusError(response.status, url) }
  }

  // El tope se mira antes de leer cuando GitHub lo dice, y después por si no lo
  // dice: una respuesta sin `content-length` se leería entera si no.
  const declared = Number(response.headers.get('content-length') ?? '0')
  if (declared > MAX_TREE_BYTES) {
    return { ok: false, error: tooLarge(declared) }
  }

  const body = await response.text().catch(() => undefined)
  if (body === undefined)
    return { ok: false, error: failure('la respuesta no se pudo leer', { url }) }
  if (Buffer.byteLength(body, 'utf8') > MAX_TREE_BYTES) {
    return { ok: false, error: tooLarge(Buffer.byteLength(body, 'utf8')) }
  }

  return { ok: true, body }
}

function hostOf(raw: string): string {
  try {
    return new URL(raw).host
  } catch {
    return 'desconocido'
  }
}

/**
 * Un error de GitHub, con el motivo que el usuario puede accionar.
 *
 * El 404 lleva su explicación porque es el caso que de verdad ocurre: un repo
 * privado y un repo que no existe responden lo mismo para quien no tiene token, y
 * sin decirlo el mensaje no da por dónde empezar.
 */
function statusError(status: number, url: string): AppError {
  const host = hostOf(url)

  if (status === 404) {
    return failure(
      'el repositorio o la referencia no existen (si es privado, no se puede instalar)',
      {
        status,
        host,
      },
    )
  }

  if (status === 403 || status === 429) {
    return failure('GitHub no atendió la petición: puede ser el límite de peticiones por hora', {
      status,
      host,
    })
  }

  return failure(`GitHub respondió ${status}`, { status, host })
}

function tooLarge(bytes: number): AppError {
  return failure(`la respuesta ocupa ${bytes} bytes y el tope son ${MAX_TREE_BYTES}`, { bytes })
}

/** Un fallo inesperado se envuelve con el host, sin perder su mensaje. */
function asAppError(cause: unknown, url: string): AppError {
  if (cause instanceof AppError) return cause

  return failure(
    `no se pudo pedir a GitHub: ${cause instanceof Error ? cause.message : 'sin causa'}`,
    { host: hostOf(url) },
    cause,
  )
}

/** La rama por defecto, que sólo se pregunta si la dirección no trae referencia. */
async function defaultBranch(
  location: GithubRepoLocation,
  context: FetchContext,
): Promise<
  { readonly ok: true; readonly ref: string } | { readonly ok: false; readonly error: AppError }
> {
  const url = `https://${GITHUB_API_HOST}/repos/${location.owner}/${location.repo}`
  const response = await get(url, context)
  if (!response.ok) return response

  const parsed = repoSchema.safeParse(parseJson(response.body))
  if (!parsed.success) {
    return {
      ok: false,
      error: failure('la respuesta de GitHub no dice la rama por defecto', { url }),
    }
  }

  return { ok: true, ref: parsed.data.default_branch }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

interface TreeFile {
  readonly path: string
  readonly size: number | undefined
}

/** El árbol del repositorio en la referencia pedida, ya filtrado y validado. */
async function treeFiles(
  location: GithubRepoLocation,
  ref: string,
  context: FetchContext,
): Promise<
  | { readonly ok: true; readonly files: readonly TreeFile[] }
  | { readonly ok: false; readonly error: AppError }
> {
  const url = `https://${GITHUB_API_HOST}/repos/${location.owner}/${location.repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`
  const response = await get(url, context)
  if (!response.ok) return response

  const parsed = treeSchema.safeParse(parseJson(response.body))
  if (!parsed.success) {
    return {
      ok: false,
      error: failure('la respuesta de GitHub no tiene la forma de un árbol', { url }),
    }
  }

  if (parsed.data.truncated === true) {
    // Instalar la mitad de un repositorio y decir que se instaló es peor que no
    // instalarlo: el proveedor fallaría por un archivo que no está.
    return {
      ok: false,
      error: failure(
        'GitHub truncó el árbol del repositorio: es demasiado grande para instalarlo',
        {
          url,
        },
      ),
    }
  }

  // El árbol recursivo llega desde la raíz del repositorio, así que la
  // subcarpeta **filtra**: las rutas que se guardan siguen siendo las del repo
  // entero, que son las que luego se habilitan una a una.
  const prefix = location.subdir === undefined ? '' : `${location.subdir}/`
  const files: TreeFile[] = []

  for (const entry of parsed.data.tree) {
    if (entry.type !== 'blob') continue
    if (prefix !== '' && !entry.path.startsWith(prefix)) continue

    const path = entry.path
    if (!isSafeRepoPath(path) || isSkippedRepoPath(path)) continue

    files.push({ path, size: entry.size })
  }

  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

  return { ok: true, files }
}

/** El texto de un archivo del repositorio. */
async function blob(
  location: GithubRepoLocation,
  ref: string,
  path: string,
  context: FetchContext,
): Promise<
  { readonly ok: true; readonly text: string } | { readonly ok: false; readonly error: AppError }
> {
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  const url = `https://${GITHUB_RAW_HOST}/${location.owner}/${location.repo}/${encodeURIComponent(ref)}/${encoded}`
  const response = await get(url, context)

  return response.ok ? { ok: true, text: response.body } : response
}

/**
 * Descarga el repositorio en `destination`, reemplazando lo que hubiera.
 *
 * No devuelve lo que se saltó: un archivo que no se descarga y que un plugin
 * necesite aparece como un plugin rechazado con su motivo en el informe del
 * loader, que es donde el usuario lo va a leer. Un contador aquí sería un segundo
 * sitio donde mirar lo mismo.
 */
export async function downloadGithubRepo(
  options: DownloadGithubRepoOptions,
): Promise<DownloadOutcome> {
  const limits: GithubLimits = { ...DEFAULT_LIMITS, ...options.limits }
  const context: FetchContext = {
    fetchImpl: options.fetchImpl ?? ((input, init) => fetch(input, init)),
    resolver: options.resolver,
    signal: options.signal,
  }
  const destination = resolve(options.destination)
  const staging = `${destination}.descarga`

  // La referencia: la de la dirección o la rama por defecto del repositorio.
  let ref = options.location.ref
  if (ref === undefined) {
    const resolved = await defaultBranch(options.location, context)
    if (!resolved.ok) return resolved

    ref = resolved.ref
  }

  const tree = await treeFiles(options.location, ref, context)
  if (!tree.ok) return tree

  if (tree.files.length > limits.maxFiles) {
    return {
      ok: false,
      error: failure(
        `el repositorio tiene ${tree.files.length} archivos y el tope son ${limits.maxFiles}`,
        { files: tree.files.length },
      ),
    }
  }

  await rm(staging, { recursive: true, force: true })

  const written: string[] = []
  let bytes = 0

  try {
    await mkdir(staging, { recursive: true, mode: 0o700 })

    for (const file of tree.files) {
      // El tamaño del árbol es el que GitHub declara: se usa para no bajar lo que
      // se va a descartar.
      if (file.size !== undefined && file.size > limits.maxFileBytes) continue

      const content = await blob(options.location, ref, file.path, context)
      if (!content.ok) throw content.error

      // Un archivo sin tamaño declarado puede llegar grande: se mide lo que se
      // leyó antes de escribirlo, con el mismo tope que el declarado.
      const size = Buffer.byteLength(content.text, 'utf8')
      if (size > limits.maxFileBytes) continue

      if (bytes + size > limits.maxTotalBytes) {
        throw failure(
          `el repositorio ocupa más de ${limits.maxTotalBytes} bytes y no se descarga entero`,
          { bytes },
        )
      }

      const full = confine(staging, file.path)
      if (full === undefined) {
        throw failure('una ruta del repositorio se sale del directorio de descarga', {
          path: file.path,
        })
      }

      await mkdir(dirname(full), { recursive: true, mode: 0o700 })
      await writeFile(full, content.text, { mode: 0o600 })
      written.push(file.path)
      bytes += size
    }

    // El reemplazo es lo último: hasta aquí, lo que había sigue intacto.
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
    await rm(destination, { recursive: true, force: true })
    await rename(staging, destination)

    return { ok: true, ref, files: written, bytes }
  } catch (cause) {
    await rm(staging, { recursive: true, force: true }).catch(() => {})

    return { ok: false, error: asAppError(cause, destination) }
  }
}
