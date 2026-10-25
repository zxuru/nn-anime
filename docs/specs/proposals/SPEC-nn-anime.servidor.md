# Propuesta: modo servidor de nn-anime

Módulo: `nn-anime` · Task: T168 · Estado: **propuesta**, no contrato aprobado.

El spec del proyecto dice que el servidor escucha sólo en `127.0.0.1` y que la autenticación es un
token de arranque de un solo uso. Esta propuesta **añade un modo**, no cambia el modo local: sin las
variables nuevas, todo lo que dice el spec sigue siendo literal.

## Lo que cambia en el contrato público

### Variables de entorno

| Variable | Valor por defecto | Contrato |
|---|---|---|
| `NN_ANIME_HOST` | `127.0.0.1` | Interfaz de escucha. `localhost` se normaliza a `127.0.0.1`. |
| `NN_ANIME_PORT` | `7717` | Puerto. Precedencia: `--port` > variable > `config.json` > `7717`. |
| `NN_ANIME_NO_OPEN` | sin definir | `1`/`true` desactiva la apertura del navegador. `--no-open` gana. |
| `NN_ANIME_TOKEN` | sin definir | Token fijo del modo servidor. Obligatorio si el host o el origen público no son loopback; mínimo 16 caracteres. |
| `NN_ANIME_PUBLIC_ORIGIN` | sin definir | Origen canónico (`http`/`https`). Fija Host/Origin admitidos y marca la cookie `Secure` si es https. |
| `NN_ANIME_LOCKED` | sin definir | `1`/`true` activa el modo restringido. |

`NN_ANIME_ALLOW_LOOPBACK=1` deja de ser válido con un host no loopback: el arranque se niega.

### Arranque

- Sin `NN_ANIME_TOKEN`, un host no loopback o un origen público no loopback es **error de arranque**,
  no un aviso. Sale con 1 y no migra ni abre el socket.
- Con token, el canje `?boot=` no se registra y `/login` es la única forma de obtener la cookie.
- `NN_ANIME_TOKEN` no se imprime, no se registra y no aparece en ninguna URL.

### Rutas y autenticación

- `/healthz` es pública y devuelve sólo `{"status":"ok"}`.
- `/login` es pública: `GET` sirve un formulario sin JS; `POST` compara el token en tiempo constante,
  emite `nn_session` con `HttpOnly; SameSite=Strict`, `Secure` si el origen es https, y redirige 303.
- Todo lo demás —incluidos los estáticos— exige cookie. Sin ella: 401 vacío en API/estáticos y 401
  con el formulario en una navegación HTML.
- `/stream/:ticket` con ticket vivo sigue siendo la excepción de credencial para `mpv`.

### Host y Origin

- Modo local: sin cambios; sólo `127.0.0.1:<puerto>`.
- Modo servidor: se admite loopback, el host de `NN_ANIME_PUBLIC_ORIGIN` y, si no hay origen público,
  cualquier `Host`. El `Origin` de un método mutante debe ser el origen público exacto o el mismo
  host de la petición.

### Modo restringido

Con `NN_ANIME_LOCKED=1`:

- No se registra `POST /api/providers`.
- De `/api/provider-repos` sólo se registra `GET`; `POST`, `PATCH` y `DELETE` no existen.
- No se registran `/api/play/mpv*`.
- `/api/settings` devuelve `locked: true` y `mpv.available: false`.
- Los plugins del directorio se siguen cargando.

## Lo que no cambia

- El modo local sin variables: `127.0.0.1:7717`, token de arranque de un solo uso, navegador.
- `config.json` y su esquema; las banderas siguen ganando.
- El contrato de plugins y el esquema de la base.
- La política de CSP, `Permissions-Policy` y guards de seguridad; el modo token **añade** uno.

## Consecuencias

- Es un cambio **aditivo** de configuración y de rutas; ninguna instalación local cambia de
  comportamiento.
- Añade una superficie nueva (un servidor que puede escuchar fuera de loopback) y, con ella, el modelo
  de amenaza de `SECURITY.md`: token compartido, sin cuentas, sin limitador de tasa y con plugins sin
  sandbox.
- El contrato de `createApp`/`startServer` gana opciones (`auth`, `network`, `locked`, `host`) y
  `settingsResponseSchema` gana `locked`. Son cambios internos del monorepo, no de la API HTTP
  pública más allá del campo aditivo.

## Aprobación

Este documento no modifica `docs/specs/SPEC-nn-anime.md`. Si se aprueba, el dueño del spec lo
incorpora en la sección de arranque y seguridad; mientras tanto, la fuente de verdad del
comportamiento es el código y las pruebas de T168.
