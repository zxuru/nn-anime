# Propuesta — tickets de emisión y CORS del receptor

**Sobre** `main` en `d54cbed`. **Origen:** la retransmisión a la TV de
[`SPEC-web-ui.T375.md`](SPEC-web-ui.T375.md) necesita una credencial que una TV pueda presentar sin
cookie, que dure más que una reproducción y que se pueda revocar. El ticket actual no cumple ninguna
de las tres cosas.

**Estado:** **propuesta, pendiente de aprobación humana.** Abierta el 2026-11-19 por T375. No se
toca `packages/media-proxy` hasta que el dueño de `SPEC-media-proxy` la integre o la rechace; si la
rechaza, D6 se reduce a lo que se pueda hacer sin ticket de emisión y se dice.

Toca **`SPEC-media-proxy`** y, de refilón, el contrato HTTP de `core` (`StreamSourceResponse` no
cambia; se añade el de la sesión de emisión en `core/api.ts`, que lo propone T381).

## Lo que hay y por qué no basta

`packages/media-proxy/src/ticket-store.ts` tiene cuatro reglas y las cuatro se prueban:

1. 24 bytes de CSPRNG en base64url (192 bits).
2. Tope de 500 entradas con desalojo LRU.
3. Vida de 600 s; un vencido da 410 y un desconocido 404.
4. No se registra nada.

El ticket es la credencial de `mpv` y del navegador. Para la TV no sirve:

- **600 s no cubren un episodio.** Una emisión de 24 min con pausas, rebuffering y una segunda
  temporada encadenada supera los diez minutos con facilidad. La TV no puede «volver a resolver el
  stream» como hace la interfaz: no tiene sesión ni nuestro código.
- **No se puede revocar.** Al parar la emisión, la URL sigue viva hasta que vence. En una LAN de
  confianza es un riesgo bajo, pero es exactamente el tipo de cosa que este repositorio no deja
  abierta.
- **El LRU de 500 lo puede desalojar.** Una reproducción HLS emite tickets hijos al reescribir
  playlists; una emisión larga compite con ellos y puede perder su entrada.
- **La URL es relativa y con cookie.** `streamSourceResponse.url` es `/stream/:ticket`; la TV no
  resuelve contra `127.0.0.1` ni tiene la cookie.

## El cambio, en una línea

Un segundo almacén, pequeño y revocable, para las emisiones; el `/stream/:ticket` resuelve contra los
dos; los tickets hijos siguen en el almacén de 600 s.

## Contrato

### `TicketStore`

Se añade **una** operación, sin cambiar las existentes:

```ts
export interface TicketStore {
  issue(contents: TicketContents, ttlS?: number): string
  resolve(ticket: string): TicketOutcome
  /** Revoca una entrada viva. `false` si no existe o ya venció. */
  revoke(ticket: string): boolean
  size(): number
  prune(): number
}
```

- `revoke` borra la entrada y devuelve si estaba viva; no la marca como vencida. Un `resolve`
  posterior es `unknown` (404), no `expired` (410): «se cerró» y «nunca existió» no se distinguen
  para quien tiene la URL, y no hace falta.
- `revoke` no toca el LRU ni la capacidad.
- Los tickets hijos de una playlist se emiten contra el almacén normal, con 600 s. Una emisión que
  recarga el manifiesto a los diez minutos recibe hijos nuevos, sin tocar el ticket padre.

### Almacén de emisión

En `ServerContainer`, separado del de 500:

```ts
const castTickets = options.castTickets ?? createTicketStore({ capacity: 16, ttlS: 4 * 60 * 60 })
```

- **16 emisiones vivas** por instancia. Una casa no tiene más televisores; el tope es una defensa, no
  una promesa de producto.
- **4 h de vida.** Cubre un episodio, una pausa larga y el arranque de la TV. No se renueva solo: si
  se acaba, se vuelve a emitir desde la interfaz.
- Capacidad y TTL se inyectan en los tests; el reloj también, como hoy.
- El almacén no se registra, no se enumera y su `size()` sólo se usa en tests.

### Resolución en `/stream`

`contentsOf` prueba **primero** el almacén de emisión y después el de navegador. El ticket de
emisión sólo existe bajo `/stream/:ticket` y sus hijos:

- `GET /stream/:ticket` con ticket de emisión: bytes o playlist, con `Range`, sin cookie.
- `GET /stream/:ticket/seg/:index` y `/key/:index`: resuelven contra la playlist cacheada, igual que
  hoy; el ticket hijo es del almacén normal.
- `GET /api/*` con ticket de emisión: **401**, como cualquier ticket; el guard sólo exceptúa
  `/stream/`.
- Un ticket revocado: 404. Uno vencido: 410. La diferencia se mantiene.

### Emisión y revocación

`POST /api/cast/session` (T381) resuelve el stream **en el servidor** y emite contra el almacén de
emisión:

```
POST /api/cast/session
{ providerId, episodeRef, mode }
→ 200 { id, kind, urls, expiresAt, title, poster? }
```

- `id` es el ticket (o un alias opaco que lo contiene; no se duplica la credencial).
- `urls` es `http://<ipv4>:<puerto>/stream/<ticket>` por cada IPv4 útil. Todas apuntan al mismo
  ticket; el emisor elige la que pruebe.
- `DELETE /api/cast/session/:id` revoca el ticket; 204 si estaba vivo, 404 si ya no. No hay
  `DELETE` de un ticket ajeno: el `id` es el ticket y sólo lo conoce quien lo pidió.
- Sin `RONA_CAST=1`, sin LAN o sin token: 409 con el motivo, y no se emite nada.
- La respuesta no incluye la URL del upstream ni las cabeceras del proveedor.

### CORS, si T379 lo exige

La regla actual de `SPEC-media-proxy` es explícita: **no** se añade CORS abierto a `/stream/*`. Esta
propuesta la mantiene y la acota:

- Sólo si el receptor real lo exige (T379), `GET /stream/:ticket` con ticket **de emisión** añade
  `Access-Control-Allow-Origin: *` y **no** añade `Access-Control-Allow-Credentials`.
- No se añade a `/api/*`, ni a un ticket de navegador, ni a un `OPTIONS` genérico.
- El `Vary: Origin` no hace falta con `*`; si se decide reflejar el origen, se limita a los orígenes
  de la LAN y se prueba que un origen ajeno no lo recibe.
- Se declara en `SECURITY.md` y se mide con la petición del receptor, no con `curl` desde la misma
  máquina.

Si T379 mide que no hace falta CORS, **no se añade nada** y esta sección se retira de la propuesta.

## Modelo de amenaza

| Amenaza | Mitigación |
|---|---|
| Un ticket de 4 h se filtra y alguien ve el episodio | 192 bits, 16 vivos, revocable, sólo una fuente y sólo `/stream`; no se registra |
| El ticket de emisión abre la API | El guard sólo exceptúa `/stream/`; `/api/*` sigue pidiendo cookie y un ticket inventado da 401 |
| El ticket de emisión desaloja al del navegador | Almacén separado y pequeño; los hijos siguen en el de 500 |
| La TV sigue después de parar | `revoke` + siguiente petición 404; la conexión abierta se corta al cerrar el proceso o al vencer |
| CORS abre la API a un origen ajeno | Sólo `*` en `/stream/:ticket` de emisión, sin credenciales, y sólo si T379 lo exige |
| Un log guarda la URL de la TV | El ticket se redacta; el almacén no escribe; la respuesta no se registra |

## Pruebas

- `issue` + `revoke` + `resolve` da `unknown`; `revoke` de un vencido da `false`.
- El TTL de 4 h se mide con reloj falso; a las 4 h y un segundo, 410.
- Capacidad 16: la 17.ª emisión desaloja la más antigua, no la del navegador.
- `/stream/:ticket` con ticket de emisión y sin cookie: 200/206; con `Range`, 206 y los bytes.
- `/api/health` con ticket de emisión: 401.
- `POST` sin `RONA_CAST=1`: 409; sin LAN: 409; sin token: 409.
- `DELETE` y después `GET`: 404.
- Playlist HLS: el padre es de emisión, los hijos de 600 s; a los 601 s el hijo viejo da 410 y una
  recarga del padre emite hijos nuevos.
- CORS: si se enciende, la petición del receptor recibe `*`; `/api/*` no; un ticket de navegador no.

## Lo que no cambia

- La vida de 600 s del ticket normal, su capacidad de 500 y su LRU.
- La redacción de `ticket` en los logs.
- El contrato de `POST /api/stream/resolve`; la emisión es una ruta nueva.
- La regla de que el cliente nunca ve la URL del upstream.
- La lista blanca de destinos y el proxy de bytes.

## Criterios de éxito

1. Una emisión de 4 h se sirve con un ticket que no compite con los 500 del navegador.
2. Al revocar, la siguiente petición da 404 y no se sirve ni un byte más.
3. El ticket de emisión no abre `/api/*` y no lleva cookie.
4. Los hijos de una playlist siguen viviendo 600 s y se renuevan al recargar el padre.
5. Sin CORS medido no se añade CORS; si se añade, es `*` sin credenciales y sólo en el ticket de
   emisión.
6. `bun test packages/media-proxy` y `packages/server` en verde; mutaciones: resolver sólo contra el
   almacén normal deja el episodio sin segmentos a los diez minutos; no revocar deja el segundo `GET`
   en 200.
