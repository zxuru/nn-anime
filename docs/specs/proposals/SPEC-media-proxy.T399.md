# Propuesta — emitir descargas locales por el ticket de emisión

**Sobre** `main` en `3607eef`. **Origen:** T399 del plan
[`tasks/pip-y-transmision.md`](../../tasks/pip-y-transmision.md). Hoy un episodio descargado no se
puede ver en la TV: el archivo vive en disco y la única ruta que lo sirve
(`/api/downloads/:id/file`) exige la cookie de la aplicación, que una TV no tiene. El proxy, además,
no resuelve destinos de loopback ni archivos locales: su lista blanca es para el upstream, no para
el disco.

**Estado:** **propuesta, pendiente de aprobación humana.** Abierta el 2026-11-19 por T399. No se toca
`packages/server`, `packages/media-proxy` ni `packages/catalog-store` hasta que el dueño de
`SPEC-media-proxy` la integre o la rechace. Si se rechaza, la v1 sigue emitiendo sólo lo que resuelve
el proveedor y se dice en `docs/cast.md`.

Toca **`SPEC-media-proxy`** (un tercer almacén de tickets y una ruta de bytes locales) y, de refilón,
el contrato de `core/api.ts` (la sesión de emisión puede declarar `source: 'local'`). No cambia el
contrato de descargas.

## Lo que hay y por qué no basta

- **`/api/downloads/:id/file`** sirve el archivo, pero pasa por `session-guard`: la TV no lleva
  cookie y no puede presentarla. Quitar el guard a esa ruta abriría todo el historial de descargas a
  cualquiera que alcanzara el puerto.
- **`GET /stream/:ticket`** resuelve el ticket contra `castTickets` y `tickets`; los dos guardan una
  **URL de upstream** y el proxy la pide con `fetch`. Un archivo local no es una URL y el proxy no
  debe aprender a leer `file://`: sería una segunda lista blanca, esta vez del disco.
- **El ticket de emisión actual** (T381) tiene la vida, la capacidad y la revocación que hacen falta;
  lo que no tiene es un contenido que sea un archivo. La tentación de meter una ruta en el mismo
  almacén mezcla dos clases de credencial y hace que un fallo de validación del proxy sea una lectura
  arbitraria de disco.

## El cambio, en una línea

Un almacén de tickets de archivo local, emitido sólo al abrir una sesión de emisión sobre una
descarga existente, y una ruta `/stream/local/:ticket` que sirve bytes del disco con `Range`,
sin cookie y revocable con la sesión.

## Contrato

### Almacén

```ts
// packages/server/src/container.ts
const localFileTickets = options.localFileTickets ?? createTicketStore({ capacity: 16, ttlS: 4 * 60 * 60 })
```

- **Capacidad 16 y 4 h**, igual que `castTickets`: una casa no tiene más televisiones y una emisión
  no vive más que un episodio con pausas. El reloj se inyecta en pruebas.
- El contenido es **una ruta absoluta ya validada**, su `content-type` y su tamaño, no una URL:

  ```ts
  interface LocalFileTicket {
    readonly path: string
    readonly contentType: string
    readonly size: number
    readonly downloadId: number
  }
  ```

- No se registra, no se enumera y no se sirve desde ninguna otra ruta. `size()` sólo se usa en
  pruebas.
- El ticket es opaco (192 bits, base64url), como los otros dos. No se deriva de la ruta ni del id.

### Emisión

`POST /api/cast/session` gana una forma de entrada explícita, no una URL:

```ts
{ downloadId: number, title?: string, poster?: string, startAtS?: number }
```

- El servidor lee la fila de `downloads`, comprueba que el archivo existe y que
  `insideRoot(root, fila.path)` sigue siendo cierto —la fila pudo escribirse con otra versión— y
  emite el ticket de archivo. **La ruta nunca viene del cliente**, igual que hoy la URL del upstream
  nunca viene del cliente.
- La sesión de emisión (`castSessions`) guarda también los tickets locales y `DELETE` los revoca.
  `castTickets` y `localFileTickets` no comparten el LRU.
- La respuesta añade `source: 'local'` y `kind: 'file' | 'hls'` para que la interfaz sepa qué
  mandó; el resto del contrato (`urls` absolutas, `expiresAt`, `title`, `poster`, `subtitles`) no
  cambia.
- Si la fila no existe, el archivo no está o la ruta se sale de la raíz: `404`, sin emitir ticket y
  sin decir qué comprobación falló.
- Sin `RONA_CAST=1`, sin LAN o sin token: `409`, como hoy.

### Ruta de bytes

```
GET /stream/local/:ticket
GET /stream/local/:ticket/seg/:index   # playlist descargada
```

- **MP4/archivo progresivo:** se lee con `createReadStream` y se responde con `Range` (`206`,
  `Content-Range`, `Accept-Ranges: bytes`), `content-type` del ticket y `cache-control: no-store`.
  Sin `Range`, `200` y el archivo entero en streaming; nunca se acumula en memoria.
- **Playlist HLS descargada:** se lee el `.m3u8` una vez, se reescriben las URI relativas a
  `/stream/local/:ticket/seg/:index` y se guarda en la caché de playlists que ya existe. Cada
  segmento se sirve del mismo directorio de la descarga, con el índice ya resuelto contra la lista y
  sin volver a mirar el disco fuera de él. Una URI absoluta en la playlist descargada se rechaza: un
  archivo local no puede mandar al proxy a la red.
- El `content-type` de los segmentos se decide por la extensión del archivo dentro de la raíz de la
  descarga (`insideRoot`), no por lo que diga la playlist.
- **Sólo `/stream/local/*`**: no se reutiliza `/stream/:ticket` para no mezclar la resolución de
  upstream con la de disco. Los guards de sesión y token exceptúan esta ruta igual que
  `/stream/:ticket`, y sólo con un ticket local vivo.
- `/api/*` con un ticket local: **401**, como con cualquier ticket. La TV no puede pedir
  `/api/downloads/*`.

### Subtítulos descargados

La fila de descarga ya guarda sus pistas. La sesión de emisión puede emitir un ticket de subtítulo
local por pista, servido en `GET /stream/local/:ticket/sub/:index` como VTT, con la misma conversión
que `/api/subtitles/:ticket` y sin cookie. Si la pista está en ASS, se declara que la TV no la pinta
y se omite, como en T394.

## Modelo de amenaza

| Amenaza | Mitigación |
|---|---|
| Un ticket local se filtra y lee archivos arbitrarios | El ticket sólo contiene una ruta emitida desde una fila de `downloads`, revalidada con `insideRoot`; no hay parámetro de ruta en la URL |
| Una playlist descargada apunta a un archivo de fuera o a una URL | Las URI se resuelven contra el directorio de la descarga y se reescriben a `seg/:index`; una URI absoluta se rechaza |
| La TV lee el historial o los ajustes | El ticket sólo abre `/stream/local/*`; `/api/*` sigue exigiendo cookie |
| El ticket sobrevive a la emisión | `DELETE /api/cast/session/:id` lo revoca; la siguiente petición da 404 y no se sirve ni un byte |
| Un archivo cambia después de emitir el ticket | Se sirve lo que hay en esa ruta, con su tamaño y `Range`; si desaparece, `404`. No hay caché de bytes |
| Un enlace simbólico dentro de la descarga sale de la raíz | `insideRoot` sobre la ruta resuelta y `lstat` antes de abrir; un enlace que apunta fuera no se sirve |
| Un log guarda la ruta o el ticket | El ticket se redacta; la ruta no se registra; la respuesta no se registra |

## Pruebas que pediría la implementación

- Emitir sesión sobre una descarga MP4: `GET /stream/local/:ticket` sin cookie da `200`, con
  `Range: bytes=0-1023` da `206`, `Content-Range` correcto y los mismos bytes que el archivo.
- Revocar la sesión: el siguiente `GET` da 404, también el segmento y el subtítulo.
- `GET /api/downloads/:id/file` con el ticket local: 401.
- Una fila con una ruta fuera de la raíz no emite ticket (404) y no crea entrada en el almacén.
- Playlist: el padre se reescribe a `/stream/local/:ticket/seg/:index`; un segmento fuera de rango
  da 404; una URI absoluta en la playlist da 502 sin salir a la red.
- Un enlace simbólico que apunta fuera de la raíz no se sirve.
- Mutaciones: aceptar una ruta del cliente deja en rojo el caso de la fila; no revocar deja el
  segundo `GET` en 200; leer el archivo entero en memoria deja en rojo el tope de memoria del
  segmento; usar el almacén de 500 deja la emisión sin archivo a las 4 h.

## Lo que no cambia

- El contrato de descargas (`/api/downloads/*` sigue exigiendo cookie) y el formato en disco.
- La lista blanca de destinos del proxy y su prohibición de loopback: el disco no entra por ahí.
- La vida de 600 s del ticket de navegador y su LRU de 500.
- El ticket de emisión de upstream de T381 y su revocación.
- La regla de que el cliente nunca ve una ruta del sistema de archivos.

## Criterios de éxito

1. Un MP4 descargado se emite con `Range` y sin cookie, y la TV lo reproduce igual que el del
   proveedor.
2. Un HLS descargado se sirve desde su playlist local, con segmentos reescritos y sin red.
3. Revocar la sesión corta el acceso al archivo, al segmento y al subtítulo.
4. El ticket local no abre `/api/*` ni ninguna ruta que no sea `/stream/local/*`.
5. Ninguna ruta del sistema de archivos viaja en la petición ni en la respuesta.
6. `bun test packages/server packages/media-proxy` en verde, con las mutaciones de arriba en rojo.
