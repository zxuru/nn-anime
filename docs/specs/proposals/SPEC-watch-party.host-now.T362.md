# Propuesta: el join de la sala sella el reloj del anfitrión

Módulo: `watch-party` · Task: T362 · Estado: pendiente de que lo integre el dueño del spec.

## Qué cambia

La respuesta de `POST /api/party/rooms/:code/join` gana un campo obligatorio:

```json
{ "roomId": "…", "token": "…", "expiresAt": 65000, "hostNowMs": 5000, "state": null, "roster": [] }
```

`hostNowMs` es el reloj monotónico del anfitrión —el mismo de `expiresAt`— en el momento de
contestar. El invitado guarda `expiresAt - hostNowMs` como vida restante y la suma a su propio reloj;
la caducidad de la reconexión del SSE se mide con ese plazo local.

## Por qué

`expiresAt` viaja en el reloj monotónico del anfitrión (`performance.now()`), que no es el del
invitado. `RemoteParty` lo comparaba con su `Date.now()`: en el camino feliz no se notaba, pero al
reconectar el SSE el enlace se cerraba como caducado aunque la sala siguiera viva. Con el sello, la
vida restante es un dato transportable y la comparación ocurre en un solo dominio.

## Compatibilidad

El campo es obligatorio para el anfitrión de esta versión. El cliente tolera su ausencia —un
anfitrión anterior— y en ese caso deja el enlace sin plazo local: lo cierra el anfitrión con
`401`/`404` en el SSE o con `closed`. El resto de eventos (`state`, `ping`, `sync`) no cambian.

## Lo que no cambia

El token de sala, el guard del invitado, la forma de `PartyMedia`, el roster (el anfitrión sigue sin
entrar en él) y el protocolo de sincronización. `SPEC-watch-party.md` conserva su versión mayor; este
es un campo aditivo y el dueño decide si sube la versión del contrato.
