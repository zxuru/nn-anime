# SPEC-media-proxy.T73 — el ticket como credencial de `mpv`

**Estado:** propuesta, sin integrar. La integra el dueño de `docs/specs/SPEC-media-proxy.md`, que
anota la aprobación y borra este archivo. Aprobada en conversación por quien pidió el arreglo
(2026-10-11), con la alternativa descartada delante.

## Qué cambia

En el contrato, la frase «Todas exigen el token de sesión y el `Host` validado del server» pasa a
tener una excepción escrita:

```
GET  /stream/:ticket                 proxy de bytes o de playlist
GET  /stream/:ticket/seg/:index       segmento resuelto de una playlist HLS
GET  /stream/:ticket/key/:index       clave o inicializador de una playlist HLS
```

Estas tres rutas se autentican **con el ticket de la propia URL**, que es lo que el spec ya llama
«la única capacidad que tiene el cliente web». El guard de sesión sigue montado sobre todo
`/stream/*` —la tabla de rutas protegidas no cambia— y sigue exigiendo la cookie cuando no hay un
ticket vivo en la URL. `/api/*` no cambia en nada.

## Por qué

`mpv` es un proceso aparte: no tiene la cookie `HttpOnly` y no puede tenerla. El handoff le da una
URL, y esa petición llegaba sin sesión.

Medido con el servidor real (HEAD antes de este cambio, datos de desarrollo):

| Petición | Antes | Después |
|---|---|---|
| `GET /stream/<ticket>` con cookie | 200 | 200 |
| `GET /stream/<ticket>` **sin** cookie (lo que hace `mpv`) | **401** | 200 |
| `GET /stream/inventado` sin cookie | 401 | 401 |
| `GET /api/health` sin cookie | 401 | 401 |

El síntoma que veía el usuario: «Ver en mpv» contestaba 202, la interfaz decía «Se abrió en el
reproductor externo», y la ventana de mpv se abría sin reproducir nada. El fallo estaba a un salto
de distancia y no se veía desde la interfaz.

## Por qué es seguro

- El ticket es **CSPRNG de 24 bytes** (192 bits) en base64url: no se adivina.
- Vive **600 s**, con tope de 500 entradas y desalojo LRU.
- Vale **sólo** bajo `/stream/:ticket`: no abre `/api/*` ni ninguna otra ruta, y un ticket inventado
  no sustituye a la cookie.
- El guard de `Host` sigue delante, así que el DNS rebinding no llega a presentar un ticket.
- El ticket no se registra en ningún log (T25), y sigue sin contener la URL del upstream.

Lo que cambia en el modelo de amenaza: hasta ahora, quien no tenía la cookie no podía leer el
video; ahora lo puede quien tenga una URL de ticket viva. Es exactamente lo que el handoff necesita
y no más: la URL ya se le entrega a un proceso del usuario.

## Alternativas descartadas

1. **Pasar la cookie de sesión a `mpv`** con `--http-header-fields=Cookie: …` o con
   `--cookies-file`. La primera expone la sesión entera en `/proc/<pid>/cmdline` a cualquier usuario
   local, que es justo la amenaza que el spec da por mitigada; la segunda persiste un secreto en
   disco, y el spec dice que la cookie no se persiste.
2. **Dar a `mpv` la URL del upstream** con sus cabeceras. El spec lo prohíbe en su primera regla:
   entonces el proxy, la lista blanca de destinos y el ticket dejarían de servir para el camino que
   más fácil es saltarse.
3. **Un segundo tipo de token para `mpv`**, distinto del ticket. Es la misma capacidad con más
   piezas: otro almacén, otra vida y otro sitio donde equivocarse, sin ganar nada.

## Qué falta por hacer si se aprueba

- Integrar la excepción en la sección «Contrato» y anotarla en «Seguridad de mpv».
- `SECURITY.md`: la fila del modelo de amenaza ya está puesta por este task.
