/**
 * Los ajustes del servidor, en un solo sitio.
 *
 * Antes cada consumidor montaba su propia lectura: `useAppTheme`, en la raíz, y
 * `SettingsPage`. Los dos hooks pedían `/api/settings` por su cuenta y el dedupe
 * de `api/client.ts` no los juntaba porque no estaban en vuelo a la vez —la raíz
 * lee al arrancar y la página lee al abrirse—, así que con Ajustes abierto el
 * servidor recibía **dos** peticiones de lo mismo.
 *
 * Con los ajustes en un almacén de módulo, la lectura es una y la comparten
 * todos: la raíz la pide la primera vez y la página la encuentra hecha. Se
 * escribe aquí y no con un contexto de React por dos motivos. El primero es que
 * el repositorio ya resuelve así el estado que no es de una pantalla
 * (`features/guia/estado.ts`, el historial de `router.tsx`), y mezclar dos
 * mecanismos para lo mismo obliga a saber cuál toca en cada archivo. El segundo
 * pesa más: un contexto habría que montarlo para poder probarlo, y en este
 * repositorio no hay DOM en las pruebas. Un cargador de módulo se mide con un
 * `fetch` inyectado (`RequestDeps`) contando peticiones, que es exactamente lo
 * que esta tarea pide demostrar.
 *
 * El objeto de estado se cachea para que `useSyncExternalStore` reciba siempre la
 * misma referencia mientras no haya cambios: devolver uno nuevo en cada lectura es
 * un bucle de renderizado.
 */

import type { ProviderSummary, SettingsResponse } from '@rona/core/api'
import { providerRegisterResponseSchema, settingsResponseSchema } from '@rona/core/api'
import { apiGet, apiPatch, apiPostJson, type RequestDeps } from '../../api/client'
import { describirFallo, type Fallo } from '../../api/fallo'

export type SettingsState = 'loading' | 'ready' | 'error'

export interface Ajustes {
  readonly state: SettingsState
  readonly data: SettingsResponse | undefined
  readonly error: Fallo | undefined
}

const INICIAL: Ajustes = { state: 'loading', data: undefined, error: undefined }

let cache: Ajustes = INICIAL
const oyentes = new Set<() => void>()

/**
 * De dónde se piden los ajustes.
 *
 * En producción queda sin definir y el cliente usa el `fetch` del navegador. Los
 * tests inyectan el suyo al cargar; las escrituras usan el mismo, para que una
 * prueba pueda mirar también el `PATCH` sin tocar la red.
 */
let deps: RequestDeps | undefined

/**
 * La lectura en vuelo, si la hay.
 *
 * Es el «una sola vez»: mientras exista, quien vuelva a pedir los ajustes espera
 * esta lectura en vez de abrir otra. Existe aparte del estado y no se puede
 * deducir de él porque `loading` es el estado inicial y también el de una lectura
 * que aún no ha arrancado.
 */
let enVuelo: Promise<void> | undefined

/** El estado actual. La misma referencia mientras no cambie nada. */
export function estadoAjustes(): Ajustes {
  return cache
}

export function suscribirAjustes(oyente: () => void): () => void {
  oyentes.add(oyente)

  return () => {
    oyentes.delete(oyente)
  }
}

function publicar(siguiente: Ajustes): void {
  if (siguiente === cache) return

  cache = siguiente

  for (const oyente of [...oyentes]) oyente()
}

/**
 * Aplica un cambio sobre los datos ya leídos.
 *
 * Un cambio con los datos sin leer no se pinta: no hay nada que enseñar y
 * inventarse un objeto a medias haría que la pantalla dejara de estar «cargando»
 * con la mitad de los campos.
 */
function actualizar(cambio: (actual: SettingsResponse) => SettingsResponse): void {
  const actual = cache.data
  if (actual === undefined) return

  publicar({ ...cache, data: cambio(actual) })
}

/**
 * La lectura del servidor.
 *
 * No pasa por «cargando» al releer: la pantalla ya tiene datos y parpadearlos
 * mientras se refrescan es peor que enseñar los de hace un segundo. Un fallo
 * conserva los datos anteriores por el mismo motivo, y deja el error para que la
 * pantalla decida qué enseñar.
 */
async function leer(): Promise<void> {
  try {
    const salida = await apiGet('/api/settings', settingsResponseSchema, {}, deps)

    publicar({ state: 'ready', data: salida, error: undefined })
  } catch (cause) {
    publicar({ state: 'error', data: cache.data, error: describirFallo(cause) })
  }
}

/**
 * Lee los ajustes, una sola vez.
 *
 * La llaman los dos consumidores —la raíz, que aplica el tema, y la pantalla de
 * Ajustes, que los pinta— y sólo la primera hace la petición: la segunda
 * encuentra la lectura en vuelo o el dato ya leído.
 *
 * Tras un fallo sí se vuelve a intentar. Si no, una raíz que arrancó sin red
 * dejaría la pantalla de Ajustes en error para siempre, y volver a entrar en ella
 * —que antes reintentaba por su cuenta— no arreglaría nada.
 *
 * `entorno` sólo lo pasan los tests; en producción es `undefined` y el cliente
 * usa el `fetch` del navegador.
 */
export function cargarAjustes(entorno?: RequestDeps): Promise<void> {
  if (entorno !== undefined) deps = entorno
  if (enVuelo !== undefined) return enVuelo
  if (cache.state === 'ready') return Promise.resolve()

  const lectura = leer().finally(() => {
    // La entrada se borra antes de que nadie continúe: si sobreviviera al final,
    // la siguiente carga —otra pantalla, otra prueba— esperaría una lectura ya
    // terminada y se quedaría sin sus datos.
    if (enVuelo === lectura) enVuelo = undefined
  })

  enVuelo = lectura

  return lectura
}

/**
 * Vuelve a leer los ajustes.
 *
 * Lo necesita la sección de repositorios: activar uno carga un proveedor nuevo y
 * la lista de proveedores de esta pantalla es la que tiene que enterarse. Se
 * relee en vez de componer la lista a mano porque el servidor es quien sabe qué
 * cargó de verdad —un archivo del repositorio puede estar rechazado—, y
 * componerla aquí sería una segunda versión de esa verdad.
 */
export function recargarAjustes(): void {
  void leer()
}

/**
 * El tema, optimista.
 *
 * Un selector de tema que espera a la red para cambiar de color se siente roto, y
 * el cambio es reversible: si el servidor falla se vuelve al valor anterior,
 * porque el tema que se ve tiene que ser el que está guardado.
 */
export function fijarTema(theme: SettingsResponse['theme']): void {
  const previo = cache.data?.theme

  actualizar((actual) => ({ ...actual, theme }))

  void apiPatch('/api/settings', { theme }, {}, deps).catch(() => {
    if (previo === undefined) return

    actualizar((actual) => ({ ...actual, theme: previo }))
  })
}

/**
 * El contenido para adultos, también optimista.
 *
 * El cambio no se ve en Ajustes —no pinta ninguna fila— sino al volver a la
 * vitrina: sus filas se leen al montar la página, así que el ajuste nuevo lo ven
 * sin reiniciar nada.
 */
export function fijarContenidoAdultos(adultContent: boolean): void {
  const previo = cache.data?.adultContent

  actualizar((actual) => ({ ...actual, adultContent }))

  void apiPatch('/api/settings', { adultContent }, {}, deps).catch(() => {
    // Si no se pudo guardar, el interruptor vuelve a donde estaba: lo que se ve
    // tiene que ser lo que el servidor está aplicando.
    if (previo === undefined) return

    actualizar((actual) => ({ ...actual, adultContent: previo }))
  })
}

/**
 * El orden de proveedores, también optimista.
 *
 * Subir un proveedor se ve al instante y se deshace si el servidor falla. Un
 * botón que espera a la red para mover una fila invita a pulsarlo dos veces, y la
 * segunda pulsación movería la fila equivocada.
 */
export function fijarPrioridadProveedores(order: readonly string[]): void {
  const previo = cache.data?.providerPriority

  actualizar((actual) => ({ ...actual, providerPriority: [...order] }))

  void apiPatch('/api/settings', { providerPriority: order }, {}, deps).catch(() => {
    if (previo === undefined) return

    actualizar((actual) => ({ ...actual, providerPriority: previo }))
  })
}

/**
 * La clave de TMDB, sin optimismo.
 *
 * La clave no se puede pintar —no se devuelve—, así que lo único que cambia es
 * «configurada», y enseñarlo antes de que el servidor conteste sería afirmar que
 * se guardó cuando puede que no. Lanza el fallo para que el formulario lo cuente.
 */
export async function fijarClaveTmdb(key: string | null): Promise<void> {
  const previo = cache.data?.tmdb.configured ?? false
  const configurada = key !== null

  actualizar((actual) => ({ ...actual, tmdb: { configured: configurada } }))

  try {
    await apiPatch('/api/settings', { tmdbApiKey: key }, {}, deps)
  } catch (cause) {
    actualizar((actual) => ({ ...actual, tmdb: { configured: previo } }))
    throw cause
  }
}

/**
 * Registra un proveedor y añade lo que el servidor devolvió.
 *
 * Aquí no hay escritura optimista, y es a propósito: esto no pinta una lista,
 * escribe un archivo. Enseñar «guardado» antes de que el servidor conteste sería
 * enseñarlo justo cuando más importa saber si el plugin cargó.
 */
export async function registrarProveedor(draft: unknown): Promise<ProviderSummary> {
  const salida = await apiPostJson(
    '/api/providers',
    draft,
    providerRegisterResponseSchema,
    {},
    deps,
  )

  // La lista se actualiza con lo que el servidor devolvió, sin volver a pedirla:
  // la respuesta es el proveedor que quedó activo, y el servidor acaba de
  // recargar su registro, así que no hay nada más que preguntar. Se sustituye por
  // identificador en vez de añadir a ciegas, para que un alta repetida no deje dos
  // filas del mismo.
  actualizar((actual) => ({
    ...actual,
    providers: [
      ...actual.providers.filter((provider) => provider.id !== salida.provider.id),
      salida.provider,
    ],
  }))

  return salida.provider
}

/**
 * Devuelve el almacén a su estado inicial.
 *
 * Lo usan los tests, que comparten el módulo entre casos: sin esto, el primero
 * que carga deja los ajustes leídos para el siguiente y su cuenta de peticiones
 * empieza con el dato ya puesto. En producción no se llama nunca —un ajuste leído
 * no se olvida—, igual que `olvidarPrefetch`.
 */
export function olvidarAjustes(): void {
  cache = INICIAL
  deps = undefined
  enVuelo = undefined

  for (const oyente of [...oyentes]) oyente()
}
