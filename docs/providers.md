# Escribir un plugin de proveedor

Un plugin es **un archivo `.ts`** que exporta por defecto un objeto que cumple el contrato. Se copia a
`~/.config/nn-anime/providers/` y la aplicación lo carga al arrancar.

> **Un plugin se ejecuta con tus permisos y sin sandbox.** Puede leer y escribir lo mismo que tú.
> Cópialo sólo si sabes de dónde viene. El detalle está en [SECURITY.md](../SECURITY.md).

## El camino fácil: registrarlo desde Ajustes

Si el sitio es una API JSON —una dirección, unas rutas y unos nombres de campo— no hace falta
escribir el archivo. En **Ajustes** hay un formulario: se rellena, se guarda, y el plugin queda escrito
en `~/.config/nn-anime/providers/<id>.ts` y **activo al instante, sin reiniciar**.

| Campo | Qué es |
|---|---|
| Identificador | `id` en minúsculas y con guiones. Es el nombre del archivo y el de las rutas |
| Nombre visible | Lo que se ve en la interfaz |
| Dirección base | El origen del sitio, con `https://` |
| Rutas | Relativas a la dirección base. `{query}` es lo que se busca y `{ref}` el título o el episodio |
| Campos de la respuesta | Dónde está cada dato dentro del JSON, con puntos (`data.items`). Plegado: los valores por defecto valen para casi todo |

Lo que se guarda es un plugin normal, generado a partir de esa descripción. Se puede abrir y editar a
mano después; la aplicación no lo vuelve a generar sola. Si el sitio necesita algo que esas rutas no
saben expresar —una firma, un `POST`, dos peticiones por título— esto no llega: es el momento de
escribir el plugin, que es el resto de este documento.

Dos cosas que el formulario **no** hace, a propósito: no acepta código y no sobrescribe. Un
identificador ya ocupado es un error, no una sustitución silenciosa.

## El contrato

Un proveedor es un objeto con:

| Campo | Qué es |
|---|---|
| `id` | Identificador corto, en minúsculas y con guiones. Es el que aparece en las rutas |
| `name` | Nombre visible |
| `apiVersion` | Versión del contrato. Hoy `1` |
| `capabilities` | Qué sabe hacer: `search`, `sub`, `dub`, `trending` |
| `search(query, options)` | Busca títulos |
| `getAnime(ref, options)` | Detalle de un título |
| `getEpisodes(ref, options)` | Lista de episodios |
| `resolveStream(request, options)` | Enlaces de reproducción de un episodio |
| `getTrending(options)` | **Opcional.** Lo que está de moda |

Todos los métodos devuelven `Promise<Result<T, ProviderError>>` o lanzan: el SDK convierte lo que se
lance en un `Result` fallido, así que **no hace falta envolver nada a mano**.

## Un ejemplo, sin lógica de scraping

Este plugin devuelve datos inventados. **No incluye ningún scraper**: la parte de conseguir los datos
es tuya, y este ejemplo no la enseña a propósito.

```ts
// mi-proveedor.ts — se copia a ~/.config/nn-anime/providers/
import type { Provider } from '@nn-anime/provider-sdk'

const BASE = 'https://mi-sitio.example'

const proveedor: Provider = {
  id: 'mi-proveedor',
  name: 'Mi proveedor',
  apiVersion: '1',
  // Se declara lo que se sabe hacer, no lo que se querría: la interfaz deshabilita
  // el doblaje si `dub` es falso, y el motor no pide tendencias si `trending` lo es.
  capabilities: { search: true, sub: true, dub: false, trending: false },

  async search(query, options) {
    // `options.signal` se aborta cuando el usuario cambia de consulta: hay que
    // pasarlo a `fetch` para no dejar peticiones vivas.
    const respuesta = await fetch(`${BASE}/buscar?q=${encodeURIComponent(query)}`, {
      signal: options.signal,
    })

    // Un `throw` también vale: el SDK lo convierte en un `Result` fallido y la
    // interfaz muestra el error del proveedor, con su nombre.
    if (!respuesta.ok) throw new Error(`el sitio respondió ${respuesta.status}`)

    const datos = (await respuesta.json()) as { id: string; titulo: string }[]

    return datos.map((fila) => ({
      ref: { providerId: 'mi-proveedor', value: fila.id },
      title: fila.titulo,
    }))
  },

  async getAnime(ref, options) {
    void options
    // `genres` y `studios` son lo que el motor de recomendación usa para saber qué
    // te gusta: un título sin géneros no entra en el ranking por afinidad.
    return { ref, title: 'Un título', genres: ['Acción'], studios: ['Un estudio'] }
  },

  async getEpisodes(ref, options) {
    void options
    return [
      {
        ref: { providerId: 'mi-proveedor', value: `${ref.value}#1` },
        animeRef: ref,
        number: 1,
        title: 'Episodio 1',
        durationS: 1440,
        mode: 'sub',
      },
    ]
  },

  async resolveStream(request, options) {
    void options
    // `headers` es lo que el sitio exija para servir el video (un `Referer`, por
    // ejemplo). **No salen del proceso**: el cliente recibe un ticket opaco.
    return [
      {
        url: `${BASE}/video/${request.episodeRef.value}.m3u8`,
        kind: 'hls',
        headers: { Referer: `${BASE}/` },
      },
    ]
  },
}

export default proveedor
```

## Comprobar que conforma

El SDK trae la prueba de conformidad, que es la misma que usa el plugin de ejemplo:

```bash
bun test packages/providers-fixture   # el ejemplo, como referencia
```

Y desde código:

```ts
import { assertConforms, inspectConformance } from '@nn-anime/provider-sdk'

const resultado = assertConforms(miProveedor)
if (!resultado.ok) {
  // `inspectConformance` dice **qué** falta, no sólo que falta algo: es lo que se
  // usa para explicar un rechazo en los ajustes.
  console.error(inspectConformance(miProveedor).problems)
}
```

Un plugin que no conforma **no se carga**, y aparece en **Ajustes** como rechazado con su motivo. Es
deliberado: un plugin a medias que se carga y falla al usarlo es peor que uno que no se carga y lo dice.

## Lo que el proxy no te deja hacer

- Salir a la red local: `127.0.0.1`, `10.0.0.0/8`, `192.168.0.0/16`, `169.254.0.0/16` y la metadata de
  nube se rechazan, y también después de resolver el DNS y en cada salto de redirección.
- Servir algo que no sea `http` o `https`.
- Colar cabeceras del upstream al cliente: sólo pasa una lista blanca, y `Set-Cookie` nunca.
- Inyectar argumentos en `mpv`: el nombre de una cabecera se valida y el valor no admite saltos de
  línea.

Si tu plugin necesita algo de eso, no es un plugin para esta aplicación.
