# Propuesta · descargas para ver sin conexión

**Task T181 (roadmap 1.1).** Sobre `da4a526` + fase 0 cerrada. Origen: `docs/roadmap.md`, fase 1, y
la decisión **D2** del humano: *«la opción que permita al usuario después visualizar fácilmente el
contenido descargado»*.

Toca una capacidad nueva —`downloads`, que `docs/specs/CAPABILITY-MAP.md` tenía como enmienda no
aprobada—, una migración de `catalog-store`, una superficie HTTP nueva y `SECURITY.md`. No toca el
contrato de plugin más que con una capacidad opcional.

## Lo que se descarga y para qué

Un episodio o una película, **para verlo después sin red**, desde el mismo equipo del usuario. Nada
se comparte, nada se sube y no hay servidor central.

## Decisión D2: MP4 primero, segmentos como respaldo

1. **Fuente `file` (MP4/WebM directo):** se guarda el archivo tal cual, con su extensión. Se abre en
   cualquier reproductor del sistema. No necesita ffmpeg.
2. **Fuente `hls` y ffmpeg disponible:** se descargan playlist y segmentos a un temporal y se
   **remezcla a un MP4** con ffmpeg (`-c copy`, sin recodificar). El resultado es un archivo único,
   movible y abrible fuera de la aplicación. Es el camino recomendado.
3. **Fuente `hls` sin ffmpeg:** se guardan playlist local y segmentos, y se reproduce **desde la
   aplicación** (proxy local). La interfaz lo dice: «descargado, sólo reproducible aquí». No se
   finge un MP4 que no existe.

El usuario puede abrir la carpeta de descargas desde la interfaz. Un MP4 es lo que hace que
«visualizar fácilmente» sea cierto; los segmentos son la red de seguridad para quien no tenga
ffmpeg.

## Dónde vive

```
<dataDir>/downloads/<provider>/<titulo-slug>/<temporada>-<episodio>-<slug>.mp4
<dataDir>/downloads/<provider>/<titulo-slug>/<temporada>-<episodio>-<slug>/   (segmentos)
```

- Cada segmento del nombre se sanea: sólo letras, números, guion y guion bajo; el resto se sustituye.
  Nada de `..`, rutas absolutas, unidades de Windows ni separadores alternativos.
- La ruta final se comprueba con `resolve` y se exige que empiece por la raíz de descargas.
- La descarga se escribe como `.part` y se renombra al terminar: un corte no deja un archivo a medias
  que parezca completo.

## La cola

Migración `0014-descargas.sql`:

```sql
CREATE TABLE download (
  id             INTEGER PRIMARY KEY,
  provider_id    TEXT NOT NULL,
  provider_ref   TEXT NOT NULL,   -- el título
  episode_ref    TEXT NOT NULL,   -- el episodio, la identidad real
  title          TEXT NOT NULL,
  episode_label  TEXT NOT NULL,
  kind           TEXT NOT NULL,   -- 'file' | 'hls' | 'segments'
  status         TEXT NOT NULL,   -- queued | downloading | paused | complete | failed | cancelled
  path           TEXT,
  bytes          INTEGER NOT NULL DEFAULT 0,
  total_bytes    INTEGER,
  error          TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  UNIQUE (provider_id, episode_ref)
);
```

- Una fila por episodio; volver a pedirlo no duplica la descarga.
- El motor reanuda las `downloading` al arrancar: el proceso se pudo cerrar a mitad.
- **Concurrencia 2** por defecto, ajustable. Una descarga es deuda de red y de disco; cuatro a la vez
  saturan la conexión y el ventilador.
- Pausar aborta el `fetch`/ffmpeg en curso y conserva lo descargado; reanudar vuelve a pedir lo que
  falta (rango HTTP cuando el servidor lo admite).
- Reintentos con espera creciente (3 intentos); un 404 no se reintenta.
- Antes de empezar se comprueba el espacio libre, con margen para el doble del tamaño estimado
  cuando hay remux.

## El motor

Paquete nuevo `packages/downloads` (o dentro de `media-proxy` si el dueño prefiere no añadir paquete;
la decisión de empaquetado no cambia el contrato). Se compone en `server/src/container.ts`.

- **Nunca recibe URLs del cliente.** El servidor resuelve el stream con `provider.resolveStream`,
  igual que la reproducción, y el motor consume esa fuente.
- Las URLs del manifiesto HLS **no se confían**: cada segmento se resuelve y se comprueba con la
  misma lista blanca del proxy. Un `.m3u8` que apunte a `127.0.0.1`, a una red privada o a otro host
  se corta.
- Las cabeceras del upstream viven en memoria, como en el proxy; **no** se escriben en la tabla ni en
  el archivo.
- ffmpeg se lanza **sin shell**, con argumentos en array, sin rutas de usuario dentro de un comando y
  con un límite de tiempo. Se detecta al arrancar; si no está, se usa el respaldo de segmentos.
- La escritura va por la cola de `catalog-store`; el motor no abre SQLite por su cuenta.

## La API

```
POST   /api/downloads            { providerId, animeRef, episodeRef, mode? } → { id }
GET    /api/downloads            → lista con estado, bytes y ruta relativa
POST   /api/downloads/:id/pause
POST   /api/downloads/:id/resume
DELETE /api/downloads/:id        → borra archivo y fila
GET    /api/downloads/:id/file   → sirve el MP4 o la playlist local, con rangos y ticket
GET    /api/downloads/events     → SSE de progreso (opcional; la lista ya se puede refrescar)
```

- `GET /:id/file` exige sesión y sirve **sólo** rutas de la tabla, nunca una ruta del cliente.
- Un archivo completo se sirve con `Range`; un episodio en curso no se sirve.
- El alta comprueba que el episodio esté en la base (la ficha se abrió antes) y que el proveedor
  exista. Si no, 404.

## La interfaz

- Botón «Descargar» en la ficha (por episodio) y en el reproductor, sólo si el proveedor declara
  `capabilities.download`.
- Página **Descargas**: cola, progreso, pausa/reanudar, cancelar, borrar, «abrir carpeta».
- Marca de «descargado» en la ficha y en la lista de episodios.
- El reproductor **prefiere la copia local**: si el episodio está descargado, resuelve
  `/api/downloads/:id/file` antes de pedir el stream al proveedor. Sin red, funciona.
- Ajustes: carpeta de descargas (por defecto `<dataDir>/downloads`), concurrencia y límite de espacio.

## Seguridad (se añade a `SECURITY.md`)

| Riesgo | Mitigación |
|---|---|
| Un manifiesto HLS apunta a loopback, red privada u otro host | Lista blanca de destinos en **cada** URL de segmento, la misma del proxy |
| Un nombre de título o episodio escribe fuera de la carpeta | Saneado por segmento y comprobación de prefijo con `resolve` |
| Una descarga llena el disco | Comprobación de espacio antes y durante; tope por archivo y por cola; el error dice cuánto falta |
| ffmpeg recibe una ruta o una opción inyectada | Sin shell, argumentos en array, rutas generadas por el servidor |
| Las cabeceras del upstream quedan en disco | Viven en memoria, como en el proxy; no se guardan |
| DRM o contenido que la fuente no permite descargar | El plugin declara `download`; si no lo declara, no hay botón. No se intenta romper DRM |

Riesgo residual: quien pueda escribir en la carpeta de descargas puede sustituir un archivo; es la
misma confianza que el resto de los datos locales. Se declara.

## Contrato de plugin

`providerCapabilitiesSchema.download: z.boolean().optional()`. Ausente es **no**: el botón no se
ofrece. No se sube `PROVIDER_API_VERSION`; es una capacidad opcional y una app vieja rechaza el
manifiesto al cargar si el plugin la declara, que es el rechazo honesto.

## Qué queda fuera

- Descarga de manga (fase 2B).
- Compartir archivos, torrents, protocolos de pares.
- DRM.
- Descargar sin que el usuario lo pida (nada de precarga silenciosa).

## Verificación por tarea

1. **1.1 (T181):** esta spec, revisada. D2 decidida; D3 y D5 siguen abiertas.
2. **1.2 (T182):** `capabilities.download` en `core` y `provider-sdk`; la conformidad no lo exige;
   el fixture declara una fuente descargable y otra no.
3. **1.3 (T183):** motor contra un servidor HTTP falso que sirve segmentos HLS: reanudación tras
   corte, pausa/cancelación a mitad, disco lleno, nombre hostil, reinicio del proceso, ffmpeg
   ausente → segmentos, ffmpeg presente → un MP4. Medido mutando cada guardián.
4. **1.4 (T184):** e2e con el fixture: descargar un episodio, verlo en la página, borrarlo.
5. **1.5 (T185):** e2e con la red del proveedor cortada: el episodio descargado se reproduce; el no
   descargado dice por qué no.
6. **1.6 (T186):** Tauri: selector de carpeta y aviso al terminar; Windows medido, macOS/Linux
   documentados.
7. **1.7 (T187):** borrar y límites de espacio; el borrado limpia archivos y filas.

## Criterios de aceptación de la fase 1

- [ ] Un episodio descargado se ve sin conexión y se abre fuera de la aplicación cuando es MP4.
- [ ] Pausar, reanudar, cancelar y borrar funcionan y no dejan archivos huérfanos.
- [ ] Un manifiesto hostil no lleva al servidor a loopback ni a otro host.
- [ ] Un nombre hostil no escribe fuera de la carpeta.
- [ ] Disco lleno se dice con el número que falta, no con un 500.
- [ ] `typecheck`, `lint`, `bun test`, `e2e` y `coverage:gate` en verde.
- [ ] `SECURITY.md` y README actualizados.
