# Escribir un plugin de proveedor

Un plugin es **un archivo `.ts`** que exporta por defecto un objeto que cumple el contrato. Se copia a
`~/.config/nn-anime/providers/` y la aplicación lo carga al arrancar.

Los proveedores de sitios reales que escribimos viven en su propio repositorio,
[nn-anime-plugins](https://github.com/zxuru/nn-anime-plugins), y de ahí se copian a esa misma carpeta.
Este repositorio no incluye ninguno: publica el contrato y un plugin de prueba con datos inventados.

> **Un plugin se ejecuta con tus permisos y sin sandbox.** Puede leer y escribir lo mismo que tú.
> Cópialo sólo si sabes de dónde viene. El detalle está en [SECURITY.md](../SECURITY.md).

## Traer los proveedores de un repositorio

Copiar archivos a mano funciona hasta que el repositorio tiene tres proveedores y uno importa un
archivo hermano. En **Ajustes**, la sección *Proveedores de un repositorio* hace el trabajo: se pega la
dirección, se elige qué se activa y se guarda.

| Lo que se pega | Qué se instala |
|---|---|
| `https://github.com/usuario/repo` | El repositorio entero, rama por defecto |
| `usuario/repo` | Lo mismo, sin escribir el host |
| `github.com/usuario/repo/tree/dev` | La rama `dev` |
| `.../tree/main/src/providers` | La rama `main`, y sólo la subcarpeta `src/providers` |

Sólo repositorios **públicos**: no hay token, ni campo donde ponerlo. Un repositorio privado responde
404 y la aplicación lo dice con esas palabras. Cada instalación gasta **dos peticiones** a la API de
GitHub —la rama por defecto y el árbol— y sin autenticar el límite es de 60 por hora y por dirección;
si se agota, el mensaje lo nombra en vez de quedarse en un «falló».

**Nada se ejecuta al instalar.** El repositorio se descarga y se miran sus archivos leyendo el texto:
se ofrecen los que declaran un proveedor (`export default`, `export const providers`, una cláusula
`export { … as default }` o `module.exports =`), y se quedan fuera los directorios de trabajo
(`node_modules`, `dist`…), los archivos de pruebas y lo oculto. El `id` y el nombre que se enseñan al
lado de cada casilla salen de leer un literal del texto: son una **pista**, y el que vale es el que dice
el plugin cuando se carga.

Marcar una casilla y guardar es el momento en que ese archivo se importa. Desde ahí es un proveedor
más: aparece en la lista de arriba, con sus capacidades y su puesto en el orden de preferencia.

Dónde queda todo:

| Qué | Dónde |
|---|---|
| La copia del repositorio | `<dataDir>/repos/<usuario>__<repo>/<marca>/` — la marca es la fecha de la descarga |
| Qué está activado | La tabla de ajustes de la base, clave `providerRepos` |
| El proveedor cargado | El mismo proceso del servidor, como cualquier plugin |

**Actualizar** vuelve a descargar y conserva marcados los archivos que sigan existiendo; los que ya no
están desaparecen de la lista. Cada descarga estrena carpeta a propósito: los módulos se cachean por
ruta, y reutilizarla haría que se siguiera ejecutando el código viejo. **Quitar** borra la copia
descargada y desactiva sus proveedores.

Los topes, para que un repositorio no llene el disco: 400 archivos, 512 KiB por archivo —los más
grandes se saltan, no rompen la instalación— y 8 MiB en total. Si GitHub trunca el árbol, la
instalación se rechaza: instalar la mitad sin decirlo deja un proveedor que falla por un archivo que no
está.

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
| `capabilities` | Qué sabe hacer: `search`, `sub`, `dub`, `trending`, `feed`, `episodePages`, `download` —y, con `media`, qué sirve: `anime`, `movies` o `both` |
| `search(query, options)` | Busca títulos |
| `getAnime(ref, options)` | Detalle de un título |
| `getEpisodes(ref, options)` | Lista de episodios |
| `resolveStream(request, options)` | Enlaces de reproducción de un episodio |
| `getTrending(options)` | **Opcional.** Lo que está de moda |
| `getFeed(options)` | **Opcional.** Novedades de la fuente, con su fecha de publicación |
| `getEpisodesPage(ref, page, options)` | **Opcional.** Una página de episodios |
| `getEpisode(ref, number, options)` | **Opcional.** Un episodio por su número |
| `getLatestEpisode(ref, options)` | **Opcional.** El último episodio del título |

Los tres últimos van juntos y con `capabilities.episodePages: true`: declarar la capacidad sin los
métodos, o tener los métodos sin declararla, se rechaza al cargar el plugin nombrando lo que falta.

`capabilities.download` **se acepta y se ignora**. Descargar no es un permiso que conceda la fuente:
la aplicación resuelve el mismo stream que la reproducción —un archivo directo o un HLS— y lo baja a
la carpeta de descargas, así que el botón se ofrece en todas las fuentes. El campo queda para que un
manifiesto que ya lo declare siga cargando; un plugin nuevo no lo necesita.

`capabilities.media` dice **qué sirve** el plugin, que es otra cosa que lo que sabe hacer: la interfaz
divide la home y la búsqueda con un conmutador entre anime y películas, y cada título cae en una mitad
según lo que declare su fuente. Vale `'anime'`, `'movies'` —películas, series y doramas: lo que no es
anime va por el mismo camino— o `'both'`. **No declararlo es `'anime'`**: es lo que eran todos los
plugins antes de que el campo existiera, así que no hay nada que cambiar para seguir funcionando. Un
plugin de las dos cosas declara `'both'` y reparte por el `kind` de cada título (`'movie'` para las
películas, lo demás del lado del anime), que es un dato que sus resultados ya pueden traer.

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

### Si tu fuente publica un feed

Un feed —RSS, Atom o tu propia lista de novedades— es la única forma de que la home tenga contenido
**sin que nadie haya buscado nada**, y la única que trae una fecha. Se declara con
`capabilities.feed: true` y se implementa `getFeed`:

```ts
const proveedor = {
  // …lo de arriba…
  capabilities: { search: true, sub: true, dub: false, trending: false, feed: true },

  async getFeed(options) {
    void options
    // El formato lo decides tú: el contrato pide referencias ya convertidas, no
    // XML. Parsear el RSS es de este método, y por eso la aplicación nunca sale a
    // buscar la dirección del feed: la conoce el plugin, que ya se ejecuta con tus
    // permisos.
    return [
      {
        ref: { providerId: 'mi-proveedor', value: 'titulo-1' },
        title: 'Un título',
        publishedAt: new Date().toISOString(), // ISO-8601; si no lo tienes, se omite
      },
    ]
  },
}
```

Tres cosas que conviene saber antes de escribirlo:

- **`publishedAt` es opcional, pero es lo que hace útil un feed.** Con fecha, la fila de novedades se
  ordena por lo último; sin ella, se respeta el orden de tu lista y las entradas van al final.
- **Hay un tope de 200 entradas por proveedor**, recortado antes de guardarse: una lista enorme no
  llena el disco ni pinta mil tarjetas.
- **La respuesta se valida antes de salir.** Una fecha que no es ISO-8601 se rechaza nombrando el
  campo, así que no llega a la caché.

### Si tu fuente pagina los episodios

Traer el catálogo entero para pintar una ventana del selector es lo que convierte una serie de mil
doscientos episodios en 76 peticiones seguidas, y lo que hace que un sitio que limita por ráfaga
responda 429 y te deje sin nada. Se declara con `capabilities.episodePages: true` y se implementan
los **tres** métodos:

```ts
const proveedor = {
  // …lo de arriba…
  capabilities: { search: true, sub: true, dub: false, trending: false, episodePages: true },

  async getEpisodesPage(ref, page, options) {
    void options
    // `page` se numera desde 1 y el tamaño de la página lo decides tú: el
    // contrato no lo fija. `hasMore` no se deduce de que la página venga llena:
    // en el borde del catálogo una página puede venir corta sin ser la última.
    return {
      episodes: [
        {
          ref: { providerId: 'mi-proveedor', value: `${ref.value}#1` },
          animeRef: ref,
          number: 1,
          mode: 'sub',
        },
      ],
      page,
      hasMore: true,
      total: 26, // opcional: sin él, el selector no promete un total
    }
  },

  async getEpisode(ref, number, options) {
    void options
    // Un número que no existe se dice aquí, con su motivo: la interfaz lo enseña
    // tal cual. Devolver un episodio inventado deja el fallo para el reproductor.
    return {
      ref: { providerId: 'mi-proveedor', value: `${ref.value}#${number}` },
      animeRef: ref,
      number,
      mode: 'sub',
    }
  },

  async getLatestEpisode(ref, options) {
    void options
    // El último de la fuente, no el mayor de una página: si tu sitio ordena al
    // revés, el que manda es el número.
    return {
      ref: { providerId: 'mi-proveedor', value: `${ref.value}#26` },
      animeRef: ref,
      number: 26,
      mode: 'sub',
    }
  },
}
```

Cuatro cosas que conviene saber antes de escribirlos:

- **Los números son de la fuente, no un índice.** Un `12.5` es un episodio válido —así numera el
  sitio los recopilatorios— y un hueco no se rellena: si tu fuente numera 1, 2, 4, eso es lo que se
  pinta.
- **Las páginas se cachean cinco minutos** en la aplicación. Tú no guardes nada entre llamadas: el
  plugin se ejecuta en el proceso del servidor y su estado no sobrevive a un reinicio.
- **Si no declaras la capacidad, el servidor trocea por ti**: pide `getEpisodes` una vez, lo cachea
  con su TTL de siempre y sirve páginas de 100. Es el camino de un plugin que tiene la lista entera,
  y el que deja a un plugin escrito antes de esto con su selector completo.
- **Un 429 no es un error de datos.** Si tu sitio limita por ráfaga, deja de pedirle durante un rato
  —el plugin de jkanime espera 65 s— y dilo en el mensaje: la interfaz enseña el motivo, y un «el
  proveedor no dio ninguna fuente» sin motivo no se puede arreglar desde fuera.

## Subtítulos de SubDivX para películas y series

Un proveedor de películas —con `capabilities.media: 'movies'`— puede acompañar
cada fuente con subtítulos de SubDivX. No hay API: el plugin busca en
`https://www.subdivx.com` y devuelve el enlace de descarga como una pista más de
`resolveStream`. Lo que el plugin no tiene que resolver —y por eso esta receta
es corta— lo resuelve el servidor:

- Cada pista se convierte en un ticket `/api/subtitles/…`: el reproductor web
  sólo acepta rutas del proxy, y sin ese ticket la pista no llegaría a pintarse.
- Si la descarga es un zip —el caso de SubDivX, cuyo `bajar.php` no lleva
  extensión—, se extrae en memoria la primera entrada `.srt`, `.vtt` o `.ass` y
  se sirve. Un rar se rechaza diciéndolo, con un 415.
- Un `srt` se convierte a `vtt`, que es lo que el navegador entiende. Un `ass`
  se sirve tal cual para mpv; la web lo omite, como todos.
- Las cabeceras que la fuente declare (`headers`) valen también para descargar
  sus pistas.

```ts
async resolveStream(request, options) {
  void options
  const video = {
    url: `${BASE}/video/${request.episodeRef.value}.mp4`,
    kind: 'file' as const,
  }

  // La búsqueda en SubDivX y la elección de la descarga son del plugin: este
  // repositorio no incluye scrapers y su guía no los enseña. Lo que salga de
  // esa búsqueda —el enlace de descarga tal cual, o nada si no hay subtítulo—
  // se enchufa aquí, con su formato.
  const descarga: string | undefined = undefined // ← tu búsqueda aquí

  if (descarga === undefined) return [video]

  return [
    {
      ...video,
      // Si SubDivX exige `Referer` para descargar, se declara aquí: la pista lo
      // hereda y el navegador no lo ve nunca.
      headers: { Referer: 'https://www.subdivx.com/' },
      subtitles: [{ lang: 'es', label: 'Español (SubDivX)', url: descarga, format: 'srt' }],
    },
  ]
}
```

Tres cosas que conviene saber antes de escribirlo:

- **SubDivX no tiene API y su página puede cambiar.** El día que cambie, se
  actualiza el plugin, no la aplicación: el contrato (`subtitles` en cada
  fuente) sigue valiendo igual.
- **SubDivX está tras una protección anti-bots.** Si la búsqueda falla, el
  episodio se reproduce igual y sin subtítulos: un fallo de la fuente de
  subtítulos no puede ser un fallo de la reproducción.
- **En mpv las pistas aún no se pasan.** El reproductor web las recibe por sus
  tickets; el handoff a mpv de momento sólo lleva el video.

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
