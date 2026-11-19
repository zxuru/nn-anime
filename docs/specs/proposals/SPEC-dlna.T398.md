# Propuesta — DLNA/UPnP para televisiones sin Cast ni AirPlay

**Sobre** `main` en `548f63a`. **Origen:** T398 del plan
[`tasks/pip-y-transmision.md`](../../tasks/pip-y-transmision.md). Hay televisiones que no hablan
Google Cast ni AirPlay pero sí DLNA/UPnP. Es la única vía para ellas, y **no entra en la v1**: esta
propuesta fija el coste, los límites y el spike que habría que hacer antes de escribir una línea de
producción.

**Estado:** **propuesta, pendiente de aprobación humana y del spike con una TV real.** Abierta el
2026-11-19 por T398. Si no hay una TV DLNA en el cierre, no se abre la implementación y se dice.

No toca ningún `SPEC-*` canónico: si se aprueba, el contrato entra en una propuesta de
`SPEC-media-proxy` (reutiliza sus tickets) y de `SPEC-web-ui` (un mando más).

## Lo que hay y por qué no basta

- **El ticket de emisión** (T381) ya resuelve la credencial: URL de LAN, 4 h, revocable y sin cookie.
  DLNA puede usarla igual que un Chromecast, con una diferencia importante: muchos televisores piden
  el medio directamente al servidor y no aceptan una URL con `Range` si el `content-type` no es el
  que esperan.
- **El proxy** ya sirve MP4 y HLS, pero reescribe las playlists con el host y el puerto de RoNa. Un
  reproductor DLNA simple no entiende HLS ni las sub-playlists: en la práctica, **MP4 progresivo es
  el único formato que se puede prometer**. Si el proveedor sólo da HLS, el cast queda fuera y se
  dice.
- **El descubrimiento** es otra pila: SSDP (multicast UDP 1900), descripción en XML, SOAP
  `AVTransport` y `RenderingControl`. No es una dependencia de npm: son mensajes de texto y HTTP,
  pero son muchos y con variantes por fabricante.
- **No se puede medir desde CI**: hacen falta una TV real, multicast en la LAN y, en muchos casos,
  que el televisor acepte el certificado o la IP sin nombre mDNS.

## El cambio, en una línea

Un mando más en el reproductor que descubre televisores por SSDP, manda el MP4 del ticket con SOAP y
refleja play/pausa/posición; HLS queda fuera salvo que el spike demuestre lo contrario.

## Contrato propuesto

### Descubrimiento

- `M-SEARCH` por UDP a `239.255.255.250:1900`, `ST: urn:schemas-upnp-org:device:MediaRenderer:1`,
  `MX: 1`, una vez cada vez que se abre el selector (no en el arranque).
- Se aceptan respuestas con `LOCATION` en la LAN; se descarta loopback, link-local y cualquier
  dirección fuera de las interfaces del servidor.
- Tope de **10 dispositivos** y **3 s** de espera. Sin respuestas, el mando dice que no hay
  televisores y no abre un selector vacío.
- De cada `LOCATION` se lee el XML de descripción con un tope de 256 KB y se comprueba que declara
  `AVTransport`; lo que no lo declare se omite con su motivo.
- Un dispositivo se identifica por `UDN` (UUID), no por nombre: dos televisores del mismo modelo se
  llaman igual.

### Control

- `SetAVTransportURI` con la URL absoluta del ticket, `CurrentURIMetaData` con título y póster (si el
  televisor lo pinta; no se promete).
- `Play`, `Pause`, `Stop`, `Seek` (`REL_TIME`) y `GetPositionInfo`/`GetTransportInfo` cada 2 s
  mientras el selector está abierto y cada 5 s después, con un tope de peticiones en vuelo de una.
- Volumen con `RenderingControl` (`SetVolume`, `GetVolume`); si el televisor no lo declara, el mando
  se oculta, como en Cast.
- Posición, duración e historial salen del `GetPositionInfo`, con las mismas reglas que T395: 15 s
  al historial, saltos desde la posición del receptor.
- Al parar: `Stop`, `DELETE /api/cast/session/:id` y vuelta al reproductor local en la posición del
  televisor.

### Formatos y límites

- **MP4 progresivo** con el `content-type` del ticket. El `Range` lo pone el proxy; el televisor
  puede pedirlo o no.
- **HLS**: no se ofrece por defecto. El spike mide si una TV concreta reproduce el manifiesto
  reescrito; si no, se declara límite del medio y no se finge.
- **Códecs**: el televisor decide. Un HEVC que no decodifica se declara como límite del medio, no
  como fallo del cast.
- **Subtítulos**: `SetAVTransportURI` no lleva pistas VTT. Si el televisor no tiene una URL de
  subtítulo en su propio protocolo, no hay subtítulos y se dice.

### Modelo de amenaza

| Amenaza | Mitigación |
|---|---|
| Un dispositivo de la LAN se hace pasar por una TV y recibe el ticket | El ticket se manda sólo a un `LOCATION` de la LAN tras una acción explícita; no se emite hasta elegir dispositivo; 4 h y revocable |
| SSDP se usa para amplificar tráfico | Sólo `M-SEARCH` desde el servidor, sin responder a multicast ajeno; tope de 10 dispositivos y 3 s |
| La URL del ticket se filtra en un log del televisor | El ticket se emite por sesión, se revoca al parar y no se registra en RoNa; el televisor es un tercero y no se controla (se declara) |
| Un XML de descripción enorme o con entidades | Tope de 256 KB, sin resolver entidades externas, parser sin `DOCTYPE` |
| Un `LOCATION` apunta a loopback o a metadata de nube | Lista blanca de las IPv4 de la LAN, la misma que ya usa el cast |
| El televisor sigue reproduciendo tras parar | `Stop` + revocación; la siguiente petición de bytes da 404 |

## Spike que hay que hacer antes de implementar

Con una TV DLNA real, en la LAN:

1. ¿Responde al `M-SEARCH` y declara `AVTransport`?
2. ¿Reproduce un MP4 del proxy con ticket, con y sin `Range`? ¿Qué `content-type` pide?
3. ¿Acepta el `CurrentURIMetaData` con título y póster? ¿Lo pinta?
4. ¿Reproduce el HLS reescrito o hay que limitarse a MP4?
5. ¿Play, pausa, seek y volumen responden? ¿Con qué latencia?
6. ¿Qué pasa al revocar el ticket a mitad? ¿Se para o se queda con el búfer?
7. ¿Acepta la URL por IP o exige nombre/mDNS?

Sin ese informe no se abre la implementación. Si el spike falla en MP4, DLNA se cierra como «no
soportado» con el motivo medido.

## Lo que no cambia

- El ticket de emisión de T381 sigue siendo la credencial; no se inventa otra.
- La CSP no cambia: el televisor no carga la interfaz, sólo pide bytes al servidor.
- El proxy no aprende `file://` ni abre loopback: T399 es otra propuesta y tampoco lo hace.
- Chromecast y AirPlay no se tocan.

## Criterios de éxito (si se aprueba)

1. Un MP4 del proxy se ve en una TV DLNA real con play, pausa, seek y volumen.
2. Al parar, el televisor deja de reproducir y el ticket ya no sirve.
3. El descubrimiento no bloquea la interfaz, tiene topes y dice cuando no encuentra nada.
4. Lo que no se pueda medir —HLS, subtítulos, póster— se declara, no se promete.
5. `bun test packages/server packages/web` en verde, con las mutaciones de la implementación en rojo.
