# Transmitir a la TV

RoNa puede mandar el episodio que se está viendo a un **Chromecast** o a una **TV con Google TV**.
La TV pide el vídeo a la instancia de RoNa por la red local; la pestaña sigue siendo el mando.

**Estado:** base implementada (tickets, sesión, mandos y parada). **Sin medir todavía con una TV
real**: el spike T379 es la puerta. AirPlay (T387), subtítulos en la TV (T394), progreso y saltos
(T395), reconexión (T396), móvil (T397) y descargas (T399) están en el plan y **no** se anuncian como
si ya estuvieran.

## Requisitos

- La aplicación escuchando en la LAN y con token. Sin las dos cosas, `GET /api/cast/info` dice
  `available: false` y el mando no aparece.
- `RONA_CAST=1`: el cast está apagado por defecto, como el watch party.
- El emisor se abre en **`http://127.0.0.1:PUERTO`**. Loopback es contexto seguro para el SDK; una
  pestaña abierta por la IP de la LAN puede no ofrecerlo.
- La TV y el ordenador, en la misma red. La TV no lleva la cookie de la aplicación: recibe una URL
  con ticket, y por eso el servidor tiene que ser alcanzable por su IP.

```bash
export RONA_TOKEN="$(openssl rand -base64 32)"
RONA_HOST=0.0.0.0 RONA_CAST=1 bun run start
```

Abre la dirección que imprime el arranque (loopback), entra en el episodio y pulsa el icono de
**transmitir**, arriba a la derecha del reproductor. Elige la TV en el selector. El aviso dice en qué
dispositivo se está viendo y permite **dejar de transmitir**.

## Lo que hace hoy

- Manda **HLS y MP4** del proxy, con título y póster en los metadatos del receptor.
- Los mandos del reproductor —play, pausa, ±10 s, buscar, volumen, silencio y las teclas— hablan con
  la TV. El vídeo local se pausa para no descargar dos veces.
- Al parar, revoca la sesión y reanuda el vídeo local en la posición de la TV.
- Los subtítulos del proveedor viajan como pistas VTT con un ticket propio; el primero queda activo y
  se puede cambiar desde los ajustes del reproductor. Si el receptor no los pinta, se dice.
- El ticket de emisión dura **4 horas**, hay como mucho **16** por instancia y se revoca al parar.
- La URL de la TV no lleva cookie y sólo abre `/stream/*`; nunca `/api/*`.
- Sin `RONA_CAST=1` no se pide nada a `gstatic` y la CSP es la de siempre.

## Lo que falta

- **Progreso, saltos y siguiente episodio**: el historial y AniSkip siguen la reproducción local; con
  cast, la TV no avisa. T395.
- **AirPlay**: Safari no es el emisor todavía. T387.
- **Móvil**: Chrome de Android exige contexto seguro; la vía TLS está en T397.
- **Descargas**: un archivo descargado no tiene ticket de emisión. T399.
- **La app de escritorio**: WebView2 no trae el ecosistema de Cast del navegador. Se abre en el
  navegador; T378 lo mide.

## Red y seguridad

- **LAN de confianza.** El vídeo y el ticket viajan sin TLS por la red local. No expongas el puerto a
  Internet para esto.
- **El ticket es la credencial de la TV.** 192 bits de CSPRNG, 4 h, revocable y limitado a una
  fuente. No se registra en logs y no abre la API.
- **El SDK de Google se carga sólo con `RONA_CAST=1` y a petición.** La CSP añade únicamente
  `https://www.gstatic.com` y `https://clients3.google.com`; no hay `unsafe-inline` ni `unsafe-eval`.
- **Lo no medido se dice.** Si la TV real exige CORS o rechaza el `Cross-Origin-Resource-Policy:
  same-origin`, T379 lo mide y se acota antes de prometerlo. El plan y el modelo de amenaza están en
  `docs/specs/proposals/SPEC-web-ui.T375.md` y `docs/specs/proposals/SPEC-media-proxy.T375.md`.
