# Spec: provider-core

Module id: `provider-core` · Depende de: `core` · Paquetes: `packages/provider-sdk`, `packages/server`
Convenciones heredadas de `SPEC-nn-anime.md`. Este documento define el contrato que todos los
proveedores deben cumplir.

## Objective

Definir una frontera estable entre la aplicación y cualquier fuente de contenido, y cargar
plugins que el usuario instala por su cuenta. El repo no incluye ni distribuye scrapers de
sitios sin licencia; publica la interfaz, el loader y un proveedor de prueba.

Éxito significa:

1. Un archivo en `~/.config/nn-anime/providers/` que exporte un `Provider` válido aparece en
   la aplicación sin recompilar y sin tocar el repo.
2. La búsqueda consulta todos los proveedores activos en paralelo y muestra los resultados
   aunque uno de ellos falle o tarde más de lo permitido.
3. Un plugin que exporta una forma inválida no tumba el arranque: se rechaza, se reporta y el
   resto sigue funcionando.
4. El detalle, la lista de episodios y la resolución de stream son intercambiables entre
   proveedores: el resto de la aplicación no sabe de qué sitio vienen los datos.

## Contrato

Este es el contrato público del módulo. Cambiarlo es un evento de versión mayor y requiere
aprobación.

```ts
// packages/provider-sdk/src/types.ts

export interface Provider {
  /** Identificador estable, kebab-case, único entre plugins. Ej: 'mi-fuente'. */
  readonly id: string
  /** Nombre para mostrar. */
  readonly name: string
  /** Versión del contrato que implementa. Hoy: '1'. */
  readonly apiVersion: '1'
  readonly capabilities: ProviderCapabilities

  search(query: string, options: CallOptions): Promise<readonly SearchResult[]>
  getAnime(ref: ProviderRef, options: CallOptions): Promise<AnimeDetail>
  getEpisodes(ref: ProviderRef, options: CallOptions): Promise<readonly Episode[]>
  resolveStream(request: StreamRequest, options: CallOptions): Promise<readonly StreamSource[]>
  /** Opcional. Listas curadas para arranque en frío de recsys. */
  getTrending?(options: CallOptions): Promise<readonly SearchResult[]>
}

export interface ProviderCapabilities {
  readonly search: boolean
  readonly sub: boolean
  readonly dub: boolean
  readonly trending: boolean
}

export interface CallOptions {
  readonly signal: AbortSignal
  /** Milisegundos. El módulo ya aplica un timeout mayor; esto es una sugerencia. */
  readonly timeoutMs: number
}

/** Referencia opaca a un título dentro de un proveedor. */
export interface ProviderRef {
  readonly providerId: string
  readonly value: string
}

export interface SearchResult {
  readonly ref: ProviderRef
  readonly title: string
  readonly titleAlt?: string
  readonly coverUrl?: string
  readonly year?: number
  readonly kind?: 'tv' | 'movie' | 'ova' | 'ona' | 'special'
}

export interface AnimeDetail extends SearchResult {
  readonly synopsis?: string
  readonly status?: 'airing' | 'finished' | 'upcoming' | 'unknown'
  readonly episodeCount?: number
  readonly genres: readonly string[]
  readonly studios: readonly string[]
}

export interface Episode {
  readonly ref: ProviderRef
  readonly animeRef: ProviderRef
  readonly number: number
  readonly title?: string
  readonly durationS?: number
  readonly mode: 'sub' | 'dub' | 'raw'
}

export interface StreamRequest {
  readonly episodeRef: ProviderRef
  readonly mode: 'sub' | 'dub'
  readonly preferredQuality?: string
}

export interface StreamSource {
  readonly url: string
  /** 'hls' para playlists m3u8, 'file' para mp4 u otro contenedor progresivo. */
  readonly kind: 'hls' | 'file'
  readonly quality?: string
  /**
   * Headers que el upstream exige. Nunca salen del proceso:
   * media-proxy los inyecta server-side.
   */
  readonly headers?: Readonly<Record<string, string>>
  readonly subtitles?: readonly SubtitleTrack[]
}

export interface SubtitleTrack {
  readonly lang: string
  readonly label: string
  readonly url: string
  readonly format: 'vtt' | 'srt' | 'ass'
  readonly default?: boolean
}
```

Forma del archivo de plugin. Módulo ESM, sin build step, cargado con `import()` dinámico:

```ts
// ~/.config/nn-anime/providers/ejemplo.ts
import type { Provider } from 'nn-anime/provider-sdk'

const provider: Provider = {
  id: 'ejemplo',
  name: 'Ejemplo',
  apiVersion: '1',
  capabilities: { search: true, sub: true, dub: false, trending: false },
  async search(query, { signal }) { /* ... */ },
  async getAnime(ref, { signal }) { /* ... */ },
  async getEpisodes(ref, { signal }) { /* ... */ },
  async resolveStream(request, { signal }) { /* ... */ },
}

export default provider
```

También se acepta `export const providers: readonly Provider[]` para agrupar varios en un archivo.

Validación de headers: `validateProvider` rechaza nombres que no cumplan `^[A-Za-z0-9-]+$` y
valores que contengan caracteres de control (`\r`, `\n`, `\0`). Un plugin que los declare se
rechaza **nombrando el header ofensor**. La validación vive en el schema, no en el consumidor, para
que ningún header sin validar pueda llegar a `media-proxy` ni a `mpv`.

El objeto del plugin se valida **sin descartar las claves propias**. Un plugin puede llevar su
propio estado —una caché, un cliente HTTP— y sus métodos pueden llegar a él con `this`; un schema
estricto lo borraría en silencio y el plugin fallaría en su primera llamada, con un error que no
habla del plugin. El contrato exige que estén sus campos; lo demás es del plugin y se respeta.

El orden de la validación es: primero `apiVersion`, después la forma. Un plugin escrito para otra
versión tiene métodos que existen y una forma que se parece, así que validarlo campo a campo
produce errores que hablan de un header cuando el problema es la versión.

Reglas del loader:

- Escanea `providers/` por `*.ts`, `*.js`, `*.mjs`, en orden alfabético.
- Valida cada `Provider` con Zod antes de registrarlo. Un fallo aísla ese plugin, no el arranque.
- Detecta `id` duplicado: gana el primero, el segundo se reporta como conflicto.
- Un plugin puede exportar `default` o `providers`, no ambos.
- `apiVersion` distinto de `'1'` se rechaza con un mensaje que indica la versión esperada.

Reglas de la búsqueda agregada:

- Todos los proveedores activos, en paralelo, con `AbortSignal.timeout(8000)` propio.
- El cierre del plazo lo garantiza el módulo, no la buena voluntad del plugin: uno que ignore la
  señal no puede mantener la búsqueda abierta. Pasar la señal no basta, porque no hay forma de
  obligar a un plugin a mirarla.
- Se devuelven resultados parciales en cuanto llegan, vía el stream de eventos del server.
- El resultado se cachea por proveedor y por consulta normalizada (`trim`, minúsculas, NFC).
- Agrupación de duplicados entre proveedores por título normalizado más año, como pista visual,
  sin fusión automática de refs.

## Estructura del módulo

```
packages/provider-sdk/
├─ src/index.ts               fachada: lo que importa un autor de plugins
├─ src/types.ts               contrato Provider y tipos asociados
├─ src/schema.ts              validación Zod del contrato y de las respuestas
├─ src/registry.ts            alta, baja, consulta e índice por id
├─ src/call.ts                llamadas que nunca lanzan: Result, capacidad y validación
├─ src/conformance.ts         test de conformidad reutilizable
├─ src/loader.ts              escaneo y carga de plugins
├─ src/errors.ts              ProviderError y clasificación de fallos
├─ src/__fixtures__/*         plugins de prueba: uno bueno, uno que lanza, uno duplicado
└─ src/*.test.ts
```

`call.ts` y `conformance.ts` no estaban en esta lista. El primero existe porque el contrato exige
que ninguna excepción de un plugin salga del módulo, y eso no es una forma ni una clasificación:
es una llamada envuelta. El segundo, porque el spec pide un test de conformidad que el autor del
plugin pueda correr, y eso es código del paquete, no de su suite.

## Success Criteria

- [ ] Copiar un plugin válido a `providers/` y reiniciar lo hace aparecer en `/api/providers`.
- [ ] Un plugin con `apiVersion: '2'` se rechaza con mensaje claro y el resto sigue cargando.
- [ ] Un plugin cuyo `search` lanza excepción no impide ver los resultados de los demás.
- [ ] Un plugin que nunca resuelve se aborta a los 8 s y su ausencia no bloquea la respuesta.
- [ ] Dos plugins con el mismo `id` producen un conflicto reportado, no una caída.
- [x] `providers-fixture` implementa el contrato completo y pasa los tests de conformidad.
      Doce títulos inventados, streams `file` y `hls`, subtítulos `vtt` y `srt`, y modos de fallo
      (latencia, timeout, 500, 404, excepción y `Referer` obligatorio) elegibles por opciones, por
      variables de entorno o por referencia especial.
- [ ] El test de conformidad es reutilizable: correrlo contra un plugin indica qué método
      incumple el contrato.
- [ ] Ningún header de `StreamSource.headers` aparece en una respuesta al cliente web.

## Boundaries

**Always**

- Validar toda respuesta de proveedor con Zod antes de que salga del módulo.
- Validar nombres y valores de header en el schema, no en quien los consume.
- Tratar toda URL de proveedor como no confiable: el esquema se valida en la frontera.
- Tratar a los plugins como código no confiable en cuanto a forma: nunca en cuanto a permisos
  (ver el aviso de seguridad abajo).
- Convertir excepciones de plugin en `Result` con proveedor, método y causa.
- Documentar el contrato con un test de conformidad que el autor del plugin pueda correr.

**Ask first**

- Cambiar cualquier tipo del contrato de la sección Contrato.
- Añadir un proveedor al repo, aunque sea de ejemplo.
- Añadir un capability nuevo.

**Never**

- Incluir, enlazar ni referenciar scrapers de sitios sin licencia en el repo.
- Ejecutar un plugin en otro proceso o asumir que está aislado: no hay sandbox.
- Enviar a un proveedor datos del historial del usuario.
- Filtrar headers de upstream, cookies o tokens hacia el cliente web o hacia los logs.

## Seguridad

Los plugins se importan en el proceso principal con los mismos permisos del usuario. Un plugin
malicioso puede leer la base, el historial y el sistema de archivos. Esto no se mitiga con
código: se mitiga informando. La UI y `README` deben decir, en texto claro, que instalar un
plugin equivale a ejecutar código arbitrario en la máquina. Cualquier intento de "sandbox" con
`node:vm` da falsa seguridad y queda prohibido como sustituto.

## Política de proveedores y referentes nombrados

El humano nombró cuatro referentes usados por ani-cli-mx: AnimeAV1, JKAnime, AniDB y AnimeX.
No hubo verificación en línea en esta sesión, así que esto es posición de proyecto, no un
informe.

- **AnimeAV1, JKAnime y AnimeX son sitios de streaming sin licencia.** No escribo, no reviso y
  no incluyo scrapers para ellos en este repo. La capacidad de usarlos existe igual: son plugins
  que el usuario instala por su cuenta. El repo entrega el contrato, el loader, el test de
  conformidad, el proveedor fixture y una plantilla comentada. Esa es toda la contribución del
  proyecto a esas fuentes.
- **AniDB no es un sitio de video, es una base de datos de metadatos.** Encaja como fuente de
  metadatos para enriquecer `recsys`, no como fuente de streams. Por eso aparece propuesto como
  `metadata-enrichment` y no como proveedor de video. Antes de implementarlo hay que verificar
  sus términos: su API exige registrar un cliente y respeta límites de peticiones, y el abuso
  conlleva bloqueo. Verificación pendiente.
- **Ningún proveedor de video con licencia está elegido.** Si aparece uno, entra como plugin y no
  cambia nada del contrato.

Consecuencia práctica: en v1 el usuario que quiera ver contenido real escribe o instala sus
propios plugins. El proyecto se verifica de punta a punta con `providers-fixture`.

## Open Questions

1. ¿Se publica `nn-anime/provider-sdk` como paquete npm para que los autores de plugins tengan
   tipos, o basta una ruta de importación resuelta por el loader? La decisión de distribución del
   proyecto es publicar en npm en v1.5, así que se propone publicarlo.
2. ¿Hace falta un caché de resolución de streams en disco, o el TTL de 600 s en `catalog-store`
   es suficiente?
3. ¿La plantilla de plugin comentada se entrega en el repo, o se documenta sólo en el `README`?
   Se propone entregarla, sin ninguna lógica de scraping real.
