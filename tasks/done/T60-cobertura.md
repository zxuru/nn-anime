# T60 — Cobertura real de AniSkip v2 y resolución de `idMal` en AniList

**Estado:** medición hecha y documentada. Sin cambios de código.
**Worktree:** `.worktrees/T60` (rama `tarea/T60`). Este informe es el único archivo escrito.
**Fecha de la medición:** 2026-11-08, 07:14–07:24 UTC (04:14–04:24 en America/Santiago).
**Red:** salida a internet desde `pwsh` con `bun 1.4.3` (`fetch`). Ver §1 para por qué no fue con `Invoke-RestMethod`.

Este documento existe para que el tipado, la normalización, la caché y la UI se decidan sobre
datos medidos, no sobre la documentación de un tercero. Todo lo que sigue salió de llamadas
reales; las URLs exactas están en el anexo y la receta reproducible en §1.

---

## Resumen: lo que cambia decisiones

1. **`idMal` no es el id de AniList.** Medido: `101922 → 38000`, `21519 → 32281`,
   `154587 → 52991`, mientras que `16498 → 16498` y `21 → 21`. Y puede ser `null`
   (`162314`). Hay que usar siempre el `idMal` que devuelve AniList, nunca el id de AniList como
   si fuera MAL.
2. **`episodeLength` es obligatorio y *elige* la respuesta.** Sin él, AniSkip contesta `400` con
   «expected number, received NaN». Con él, no filtra por «caber en el episodio»: selecciona
   *otra entrada* del episodio. El mismo episodio de Shingeki devuelve un `op` en `47.365` con
   `episodeLength=0` y en `128.406` con `1440`. La duración tiene que ir en la clave de caché.
3. **`found:false` es un `404` con JSON, no un fallo de red.** Cuerpo exacto:
   `{"found":false,"results":[],"message":"No skip times found","statusCode":404}`. Es la
   respuesta **mayoritaria** medida (20 de 38 episodios, 53 %), y Cloudflare la cachea igual que
   un `200` (`cache-control: max-age=300`).
4. **La cobertura es mucho más baja de lo que sugiere «AniSkip tiene los saltos».** 18 de 38
   episodios medidos (47 %) devuelven datos. Por series: Shingeki S1 7/7 (100 %), Frieren 2/9
   (22 %), One Piece 4/11 (36 %); película, OVA y especial medidos: 0/5. Y `found:true` no
   garantiza `op`+`ed`: 12/18 tienen los dos, 5 solo `op`, 1 solo `ed`.
5. **`mixed-*` aparece de verdad y con tiempos propios.** 5 de 18 episodios con datos (28 %)
   traen `mixed-op` y/o `mixed-ed`; en Shingeki ep. 1 el `op` (`128.406–218.406`) y el
   `mixed-op` (`75–135`) se **solapan**. Traducirlos a `op`/`ed` y deduplicar por la terna
   completa está justificado por estos datos; deduplicar solo por tipo perdería un intervalo real.

---

## 1. Método

### 1.1. La herramienta: por qué `bun` y no `Invoke-RestMethod`

Desde `pwsh`, tanto `Invoke-RestMethod`/`Invoke-WebRequest` como `curl.exe` fallaron **antes de
salir a la red**, al negociar TLS:

```
curl: (35) schannel: AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS (0x8009030e)
Invoke-RestMethod: Se ha terminado la conexión: Error inesperado de recepción.
```

El DNS resolvía bien (`api.aniskip.com` → Cloudflare, A/AAAA). No es un bloqueo de red ni de
sandbox: es que el proceso no puede adquirir credenciales del paquete `schannel` en esta sesión.
La alternativa de solo lectura fue `bun 1.4.3` (`C:\Users\zxuru\.bun\bin\bun.exe`), que usa su
propia pila TLS: **todas** las mediciones de este informe salen de `fetch` de Bun. Los comandos
del anexo están en esa forma.

### 1.2. Receta reproducible

```powershell
# AniList: un POST GraphQL por id
bun -e 'const q = "query($id:Int){Media(id:$id,type:ANIME){id idMal title{romaji english} episodes format status startDate{year}}}";
const r = await fetch("https://graphql.anilist.co", { method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json" },
  body: JSON.stringify({ query: q, variables: { id: 154587 } }) });
console.log(r.status, await r.text())'
```

```powershell
# AniSkip: types[] y episodeLength son obligatorios
bun -e 'const url = "https://api.aniskip.com/v2/skip-times/52991/1?types[]=op&types[]=ed&types[]=mixed-op&types[]=mixed-ed&types[]=recap&episodeLength=1440";
const r = await fetch(url); console.log(r.status); console.log(await r.text())'
```

- **Cortesía:** 500–600 ms entre llamadas. AniSkip declara `x-ratelimit-limit: 120` por minuto;
  AniList devolvió `x-ratelimit-limit: 30` en esta medición. No se provocó ningún `429`; no se
  midió el cuerpo de un `429`.
- **Muestra:** 9 títulos de 5 formatos (TV corta, TV larga, película, OVA, ONA, especial), 38
  episodios únicos consultados (ep. 1 y 2 de cada uno más barridos dentro de serie), 1 título con
  `idMal: null`, 2 llamadas a `/v2/relation-rules`.
- **Qué significa «con datos»:** `found:true` y `results` no vacío. `found:false` es «consultado
  y sin datos», no «error».

---

## 2. AniList GraphQL: forma del JSON y `idMal`

**Endpoint:** `POST https://graphql.anilist.co` · `Content-Type: application/json`
**Query usada:** `query($id:Int){Media(id:$id,type:ANIME){id idMal title{romaji english} episodes format status startDate{year}}}`

### 2.1. Tabla medida (consulta `Media` explícita por id)

| AniList id | Título (romaji) | `format` | `episodes` | `status` | `idMal` |
|---|---|---|---|---|---|
| 154587 | Sousou no Frieren | `TV` | 28 | `FINISHED` | **52991** |
| 16498 | Shingeki no Kyojin | `TV` | 25 | `FINISHED` | **16498** |
| 21 | ONE PIECE | `TV` | **`null`** | `RELEASING` | 21 |
| 101922 | Kimetsu no Yaiba | `TV` | 26 | `FINISHED` | **38000** |
| 171018 | Dandadan | `TV` | 12 | `FINISHED` | **57334** |
| 21519 | Kimi no Na wa. | `MOVIE` | 1 | `FINISHED` | **32281** |
| 120377 | Cyberpunk: Edgerunners | `ONA` | 10 | `FINISHED` | **42310** |
| 162314 | Shingeki no Kyojin: The Final Season - Kanketsu-hen Kouhen | `SPECIAL` | 1 | `FINISHED` | **`null`** |

Tres hechos de tipado, medidos:

- **`episodes` es nullable**: ONE PIECE está `RELEASING` y AniList devuelve `"episodes":null`.
  Cualquier aritmética «episodios conocidos» tiene que tolerar `null`.
- **`idMal` es un mapeo, no una copia**: tres de ocho títulos tienen idMal distinto del id de
  AniList; AniList 16498 y 21 coinciden con MAL por historia, no por regla.
- **`idMal` tiene tres estados** (ausente / `null` / número). `null` es «AniList dice que no hay
  ficha de MAL»: medido en el especial 162314, que **no admite consulta AniSkip** (el `animeId`
  de AniSkip exige mínimo 1).

Fragmento real de la respuesta de 154587:

```json
{"data":{"Media":{"id":154587,"idMal":52991,"title":{"romaji":"Sousou no Frieren",
"english":"Frieren: Beyond Journey’s End"},"episodes":28,"format":"TV","status":"FINISHED",
"startDate":{"year":2023}}}}
```

Fragmento real de 162314 (`idMal` nulo):

```json
{"data":{"Media":{"id":162314,"idMal":null,"title":{"romaji":"Shingeki no Kyojin: The Final Season - Kanketsu-hen Kouhen"},"episodes":1,"format":"SPECIAL","status":"FINISHED"}}}
```

### 2.2. Id inexistente y cabeceras

`Media(id: 999999999)`, `id: 0` e `id: -5` devuelven **HTTP 404** con JSON (no `data.Media:null`
a secas):

```json
{"errors":[{"message":"Not Found.","status":404,"locations":[{"line":1,"column":16}]}],"data":{"Media":null}}
```

Cabeceras de una respuesta `200` (medidas):

| Cabecera | Valor |
|---|---|
| `content-type` | `application/json` |
| `access-control-allow-origin` | `*` |
| `cache-control` | `no-cache, private` |
| `server` | `cloudflare` |
| `x-ratelimit-limit` | `30` |
| `x-ratelimit-remaining` | `29` (decae una por petición) |
| `retry-after` | `null` (en las respuestas medidas) |

Consecuencia: el browser *podría* llamar a AniList por CORS abierto; lo que justifica el proxy no
es CORS, es el **límite de 30/min** y la caché persistente de `idMal` (y la lista blanca de
destinos del servidor).

---

## 3. AniSkip v2: contrato real y casos

El contrato oficial está publicado en **`https://api.aniskip.com/openapi-v2.json`**
(OpenAPI 3.0.0, `info.version: "2.5.1"`). Rutas: `GET/POST /v2/skip-times/{animeId}/{episodeNumber}`,
`POST /v2/skip-times/vote/{skipId}` y `GET /v2/relation-rules/{animeId}`.

Parámetros del `GET`, tal como los declara el spec **y como se comportan de verdad**:

| Parámetro | Spec | Comportamiento medido |
|---|---|---|
| `animeId` (path) | entero ≥ 1 | `0` → `400` «Too small: expected number to be >= 1». Id inexistente → `404` `found:false` |
| `episodeNumber` (path) | número ≥ 0, admite decimales | `-1` → `400`; `0` y `2.5` → `404 found:false`; `99` (inexistente) → `404 found:false` |
| `types[]` (query) | **requerido**, array de `op`, `ed`, `mixed-op`, `mixed-ed`, `recap` | sin él → `400`; un valor desconocido → `400`; `types=op` sin corchetes también funciona |
| `episodeLength` (query) | **requerido**, número ≥ 0; «approximate length… if 0 it will return all episodes» | sin él → `400` (`received: "NaN"`); `-1` → `400`; `"abc"` → `400`; `0` → `200` y devuelve una entrada de cada tipo; `1e20` → `404` |

### 3.1. Forma exacta del JSON

`200` con datos (Shingeki no Kyojin, MAL 16498, ep. 1, `episodeLength=1440`):

```json
{"found":true,
 "results":[
  {"interval":{"startTime":128.406,"endTime":218.406},"skipType":"op",
   "skipId":"2e4331b9-92ad-4cb5-a0f8-97c9962e7551","episodeLength":1441.9413},
  {"interval":{"startTime":1342.795,"endTime":1430.616},"skipType":"ed",
   "skipId":"d7b4737b-d3b9-4009-bbbf-1fb52a02d746","episodeLength":1446.9973},
  {"interval":{"startTime":75,"endTime":135},"skipType":"mixed-op",
   "skipId":"8e1769d5-bcae-4dc4-ae5a-98fa8c6f1f56","episodeLength":1420},
  {"interval":{"startTime":1351.63,"endTime":1441.63},"skipType":"mixed-ed",
   "skipId":"761b2960-123c-42ae-9249-1aa003fcfd59","episodeLength":1446.999}],
 "message":"Successfully found skip times","statusCode":200}
```

`404` sin datos (Frieren, MAL 52991, ep. 2), **mismo camino que un id MAL inexistente**:

```json
{"found":false,"results":[],"message":"No skip times found","statusCode":404}
```

`400` de validación (p. ej. sin `episodeLength`):

```json
{"statusCode":400,"message":"Validation failed","errors":[
 {"expected":"number","code":"invalid_type","received":"NaN",
  "path":["episodeLength"],"message":"Invalid input: expected number, received NaN"}]}
```

Notas de forma (todas medidas):

- `results` es un array de objetos con **cuatro** campos: `interval.startTime`, `interval.endTime`,
  `skipType`, `skipId` (UUID) y `episodeLength`. El `episodeLength` de la fila es el de la
  *entrada elegida*, no el que se pidió (puede diferir: `1446.999` con query `1440`).
- Los números son **flotantes** (`128.406`, `1441.9413`); el modelo debe aceptar decimales.
- El orden de `results` **no** está garantizado por tiempo: en Shingeki ep. 1 salen `op`, `ed`,
  `mixed-op`, `mixed-ed`; en One Piece ep. 1, `op`, `ed`, `mixed-op`, `mixed-ed`, `recap`.
  La normalización tiene que ordenar.
- `message` y `statusCode` vienen en el cuerpo; el `statusCode` del cuerpo coincide con el HTTP
  en lo medido (`200`/`404`). No hay `results` ausente ni `null` en las 40+ respuestas medidas;
  `found:false` siempre trae `results: []`.
- `skipId` solo sirve para votar (`POST /v2/skip-times/vote/{skipId}`); para reproducir no se usa.

### 3.2. `episodeLength`: obligatorio y discriminatorio

Esta es la medición que más afecta al diseño. **Mismo episodio, misma URL, solo cambia
`episodeLength`.** Shingeki no Kyojin MAL 16498, ep. 1:

| `episodeLength` | Resultado (`skipType@inicio–fin`, con el `episodeLength` de la fila) |
|---|---|
| `0` | `op@47.365–137.365` (1540.061) · `ed@1342.795–1430.616` (1446.9973) · `mixed-op@75–135` (1420) · `mixed-ed@24.41–114.41` (1464.4) |
| `1` | **404** `found:false` |
| `1000` | **404** `found:false` |
| `1400` | `op@40–101.845` (1420) · `mixed-op@75–135` (1420) |
| `1420` | `op@0–90` (1435) · `mixed-op@75–135` (1420) |
| `1430` | `op@128.406–218.406` (1441.94) · `ed@1342.795–1430.616` (1446.997) · `mixed-op@75–135` (1420) · `mixed-ed@1351.63–1441.63` (1446.999) |
| `1440` | igual que `1430` |
| `1445` | `op@128.406–218.406` · `ed@1342.795–1430.616` · `mixed-op@3.533–181.625` (1458.54) · `mixed-ed@24.41–114.41` (1464.4) |
| `1447` | igual que `1445` |
| `1500` | **404** `found:false` |
| `99999` | **404** `found:false` |

Lectura medida: el endpoint **elige una entrada** cuyo `episodeLength` esté cerca del pedido.
Diferencia aceptada: 20 s (`1400 → 1420`). Diferencia rechazada: 40 s (`1600 → 1560`/`1559.949`
da 404; `1500 → 1440` da 404). La frontera exacta entre 20 y 40 s **no** se caracterizó; es regla
interna del tercero. `0` está documentado y medido como «sin filtro»: devuelve una entrada por
tipo, de la longitud que sea.

Segundo control, Frieren MAL 52991 ep. 1 (dos entradas conocidas, op en 1440.022 y en 1559.949):

| `episodeLength` | `op` devuelto |
|---|---|
| 1400 | `104.344–194.344` (1420) |
| 1420 | `34.54–124.54` (1420.1) |
| 1440 | `0–96.252` (1440.022) |
| 1450 | `43.87–133.87` (1469.9) |
| 1500 | `116.748–206.748` (1510.092) |
| 1540 | `3.221–93.221` (1559.949) |
| 1580 | `96.287–186.287` (1560) |
| 1600 | **404** `found:false` |

Consecuencia directa: la duración **no es un dato de adorno** («descartar intervalos que no caben»
en el comentario del cliente actual es una descripción incompleta): dos duraciones distintas del
mismo episodio pueden devolver saltos en segundos distintos, porque son entradas distintas de la
base colaborativa. De ahí que la clave de caché tenga que incluirla (redondeada) y que «no sé la
duración» no pueda resolverse omitiendo el parámetro.

### 3.3. Cobertura medida: episodios 1 y 2

`types[]` = los cinco; `episodeLength` = 1440 para TV/ONA, 1500 para OVA/especial, 6360 para la
película. ✅ = `found:true` (con tipos y tiempos); ❌ = `404 found:false`.

| Título | MAL | ep. 1 | ep. 2 |
|---|---|---|---|
| Sousou no Frieren | 52991 | ✅ `op@0–96.252` · `ed@1330.583–1421.21` | ❌ 404 |
| Shingeki no Kyojin | 16498 | ✅ `op@128.406–218.406` · `ed@1342.795–1430.616` · `mixed-op@75–135` · `mixed-ed@1351.63–1441.63` | ✅ `op@54.312–144.312` · `ed@1372.218–1451` |
| ONE PIECE | 21 | ✅ `op@310.571–400.571` · `ed@1396.006–1434` · `mixed-op@186.231–276.231` · `mixed-ed@1401–1435` · `recap@132.773–201.296` | ❌ 404 |
| Kimetsu no Yaiba | 38000 | ✅ `op@5.617–95.617` · `ed@1295.128–1385.128` · `mixed-ed@1300.7–1415` | ✅ `op@57.48–147.48` · `ed@1289.624–1379.624` |
| Dandadan | 57334 | ✅ `op@2.648–92.648` · `ed@232.612–322.612` · `mixed-ed@6.724–96.724` | ✅ `op@121.5–208.5` · `ed@1332–1422` |
| Cyberpunk: Edgerunners | 42310 | ❌ 404 | ✅ `ed@1350–1441` (episodeLength 1443) |
| Kimi no Na wa (película) | 32281 | ❌ 404 | — (1 episodio) |
| OVA: Kuinaki Sentaku | 25781 | ❌ 404 | ❌ 404 |
| Dr. STONE: Ryuusui (especial) | 50612 | ❌ 404 | ❌ 404 |

- Ep. 1: 5/9 con datos (56 %). Ep. 2: 4/8 con datos (50 %). Total de esta tabla: **9/17 (53 %)**.
- Títulos con datos al menos en un episodio: **6/9 (67 %)**.
- El `ed@232.612–322.612` de Dandadan ep. 1 (un «ending» en el minuto 4) es dato de la fuente y
  está entre los ejemplos que obligan a validar los intervalos, no solo a copiarlos.

### 3.4. `skipType` observados, `mixed-*` incluidos

En datos reales aparecieron **los cinco** valores del enum. Frecuencia sobre los 18 episodios
`found` medidos: `op` 18, `ed` 13, `mixed-op` 3, `mixed-ed` 4, `recap` 5. Episodios con algún
`mixed-*`: **5/18 (28 %)**.

Casos con tiempos (todos reales):

| Título / episodio | `op` | `mixed-op` | `ed` | `mixed-ed` | `recap` |
|---|---|---|---|---|---|
| Shingeki ep. 1 | `128.406–218.406` | `75–135` | `1342.795–1430.616` | `1351.63–1441.63` | — |
| Shingeki ep. 25 | `84.081–173.581` | `0.5–16.542` | `1363.542–1448` | — | `18.08–82.987` |
| ONE PIECE ep. 1 | `310.571–400.571` | `186.231–276.231` | `1396.006–1434` | `1401–1435` | `132.773–201.296` |
| ONE PIECE ep. 100 | `0.957–90.957` | — | `1325–1440` | — | `124–156` |
| Kimetsu no Yaiba ep. 1 | `5.617–95.617` | — | `1295.128–1385.128` | `1300.7–1415` | — |
| Dandadan ep. 1 | `2.648–92.648` | — | `232.612–322.612` | `6.724–96.724` | — |

Lo importante no es que existan sino que **coexisten y se solapan**: en Shingeki ep. 1, el `op`
empieza en `128.406` y el `mixed-op` termina en `135` (solape de 6.6 s); en ONE PIECE ep. 1, el
`ed` y el `mixed-ed` se solapan de `1401` a `1434`; en Kimetsu, de `1300.7` a `1385.128`. Además
el `mixed-op` puede ser corto (16.5 s en Shingeki ep. 25) y puede preceder a un `recap`
(`18.08–82.987`, contiguo). Traducir `mixed-op → op` y `mixed-ed → ed` y quedarse con **los dos**
(identidad por terna, no por tipo) es lo que evita perder el salto que el otro describe; pero la
UI no puede pintar dos botones «op» solapados sin una política (ver §6).

### 3.5. `types[]`: filtro real

- `types[]=op` devuelve solo `op`; `types[]=ed`, solo `ed`; `types[]=mixed-op`, solo `mixed-op`;
  `types[]=mixed-ed`, solo `mixed-ed`. Es un filtro por tipo, no un booleano «con/sin saltos».
- `types[]=recap` sobre Shingeki ep. 1 → `404 found:false` (no hay recap en ese episodio);
  sobre ONE PIECE ep. 1 → `recap@132.773–201.296`.
- Pedir los cinco tipos devuelve la unión. El cliente actual pide los cinco; medido que así
  aparecen los `mixed-*` que con `op`+`ed` solos no saldrían.

### 3.6. Casos límite medidos

| Caso | Respuesta |
|---|---|
| episodio inexistente (Frieren 99, Shingeki 0/2.5, película ep. 1) | `404` `{"found":false,"results":[],"message":"No skip times found","statusCode":404}` |
| id MAL inexistente (`999999999`) | **mismo** `404 found:false`; el cliente no puede distinguirlo de «sin datos» (no hace falta que lo haga) |
| episodio `0` | permitido por el spec (`minimum: 0`); medido en Frieren y ONE PIECE → `404 found:false` (no hay datos de especiales ahí) |
| `episodeLength` ausente | `400` validación (`expected number, received NaN`) |
| `episodeLength` negativo | `400` «Too small: expected number to be >=0» |
| `episodeLength` no numérico (`abc`) | `400` `received: "NaN"` |
| `episodeLength` absurdo (`1e20`) | `404 found:false` (no error de validación) |
| `episodeLength=0` | `200` y devuelve una entrada por tipo («all episodes», según el spec) |
| `types` ausente o valor desconocido | `400` `invalid_value`, `path: ["types",0]`, enum listado |
| `types=op` sin corchetes | `200` (el parser es laxo); la forma canónica `types%5B%5D=op` (la que compone `URLSearchParams`) también devuelve `200` |
| película / OVA / especial | en la muestra, `404 found:false` en las 5 consultas |
| `found:true` con `results` vacío | **no observado** en 40+ respuestas; `found:false` siempre con `results: []` |

### 3.7. Cabeceras, CORS y caché

`200` (y también `404 found:false`):

| Cabecera | Valor medido |
|---|---|
| `content-type` | `application/json; charset=utf-8` |
| `access-control-allow-origin` | `*` |
| `cache-control` | `max-age=300` (5 minutos) — **también en el `404 found:false`** |
| `cf-cache-status` | `MISS` / `REVALIDATED` / `HIT` (Cloudflare cachea de verdad; repetir la URL da `HIT`, `age` 0–153 s) |
| `etag` | `W/"…"` (débil) |
| `server` | `cloudflare` |
| `x-ratelimit-limit` | `120` |
| `x-ratelimit-remaining` / `x-ratelimit-reset` | `119` / `60` (baja ~1 por petición) |
| `vary` | ausente |

`400`: mismo `content-type` y `access-control-allow-origin: *`, pero **sin** `cache-control` y con
`cf-cache-status: BYPASS`.

`OPTIONS` (preflight): `204`, `access-control-allow-origin: *`,
`access-control-allow-methods: GET,HEAD,PUT,PATCH,POST,DELETE`,
`vary: Access-Control-Request-Headers`, `x-powered-by: Express`, `cf-cache-status: DYNAMIC`.

Consecuencia para el proxy: **CORS no lo justifica** (el origen es `*`; el navegador podría llamar
a AniSkip). Lo justifican: resolver `idMal` server-side, la **caché persistente** con TTL propio
(el borde solo guarda 5 min), el **límite de 120/min** compartido, la lista blanca de destinos del
servidor y el interruptor offline del arnés e2e. Ojo: el borde **sí cachea los 404** durante 5 min,
así que un episodio recién cubierto puede tardar hasta 5 min en verse incluso sin caché propia.

### 3.8. `relation-rules` (medido de paso, relevante para normalización)

`GET /v2/relation-rules/16498` → `200` `{"found":true,"rules":[{"from":{"start":26,"end":37},"to":{"malId":25777,"start":1,"end":12}}, …5 reglas…]}`;
`/relation-rules/21` → `404` `{"found":false,"rules":[]}`. La consulta inversa (`/25777`) devuelve
la misma regla.

Pero **`skip-times` no aplica el remapeo**: `16498/26`, `/38`, `/50` dan `404 found:false`, y
`25777/1` sí tiene datos (`op@167.705–257.705`, `ed@1329–1434`). Es decir: para una temporada
partida en MAL hay que consultar el MAL de **esa** temporada (el que devuelve AniList como
`idMal`), no el número fusionado que describe `relation-rules`. Las reglas sirven para navegar o
explicar continuidad, no para componer la URL de saltos.

---

## 4. Cobertura real encontrada

### 4.1. Barridos dentro de serie (mismos parámetros)

| Serie (MAL) | Episodios consultados | `found` | Cobertura |
|---|---|---|---|
| Shingeki S1 (16498) | 1, 2, 3, 5, 10, 20, 25 | 7 | **7/7 (100 %)** |
| Frieren (52991) | 1, 2, 3, 4, 5, 10, 15, 20, 28 | 2 (1, 4; el 4 solo `op`) | **2/9 (22 %)** |
| ONE PIECE (21) | 1, 2, 3, 5, 10, 50, 100, 200, 500, 1000, 1100 | 4 (1, 100, 200, 1000) | **4/11 (36 %)** |

### 4.2. Agregado de toda la medición

- Episodios únicos consultados: **38** (9 de Frieren, 7 de Shingeki, 11 de ONE PIECE, 2 de
  Kimetsu, 2 de Dandadan, 2 de Cyberpunk, 1 de película, 2 de OVA, 2 de especial).
- Con datos (`found:true`): **18/38 = 47 %**.
- Títulos con datos en al menos un episodio: **6/9 = 67 %**.
- Por formato: TV 17/31 (55 %; sin Shingeki, 10/24 = 42 %); ONA 1/2; película 0/1; OVA 0/2;
  especial 0/2.
- De los 18 episodios con datos: **12 (67 %) traen `op` y `ed`**; **5 solo `op`**; **1 solo `ed`**
  (Cyberpunk ep. 2). Es decir, «hay saltos» no implica «hay botón para abrir y para cerrar».
- `recap` en 5/18 (28 %); `mixed-op` en 3/18; `mixed-ed` en 4/18.

### 4.3. Lectura

1. **La cobertura no es por popularidad ni por recencia de forma monótona.** Shingeki (2013) está
   al 100 % en la muestra; Frieren (2023), al 22 %. Es una base colaborativa: los títulos viejos y
   muy vistos acumulan envíos, los recientes no. Un 404 no es «esta serie no tiene openings»:
   es «nadie los ha enviado todavía», y puede cambiar con el tiempo.
2. **El 404 es el caso normal, no la excepción** (53 % de las consultas). La UI tiene que estar
   diseñada para la ausencia total de botones, no para un fallo.
3. **Película/OVA/especial: 0/5 en la muestra.** En estos formatos es razonable no pedir saltos o
   no pintar nada; si se pide, el resultado esperado es la lista vacía.
4. **La calidad del dato también varía**: hay `ed` en el minuto 4 (Dandadan ep. 1) y un `ed`
   seleccionado a mitad de episodio en Frieren con `episodeLength=1450` (`796.81–886.81`). Copiar
   sin validar puede llevar al reproductor a un salto absurdo.
5. **Extremos fuera de duración**: con `episodeLength=1440`, Shingeki ep. 25 devuelve
   `ed@1363.542–1448` (la fila tiene `episodeLength: 1448.48`) y ep. 1 devuelve
   `mixed-ed@1351.63–1441.63`. El `endTime` puede superar la duración del vídeo del usuario.

---

## 5. Consecuencias para el tipado y la normalización

Lo que el contrato de `@nn-anime/core` y el normalizador pueden afirmar con esta medición:

1. **Respuesta cruda** (`skip-times`): `statusCode: number`, `message: string`, `found: boolean`,
   `results: array` (tolerante a ausente/`null`, porque es respuesta ajena). Cada resultado:
   `interval{startTime, endTime}` (números, flotantes), `skipType` (enum de 5), `skipId` (UUID),
   `episodeLength` (número, el de la entrada, no el pedido). Campos de más se ignoran.
2. **`found:false` llega por `404` con JSON parseable.** El cliente no puede decidir «error» por
   `!response.ok`: tiene que leer el cuerpo y distinguir `found:false` (miss) de un `400`
   (petición mal formada, que el servidor no debería producir) y de un fallo de red. Si no, se
   pierde la distinción miss/error que el servicio dice mantener.
3. **`episodeLength` va en la clave y no es opcional.** Medido: el mismo episodio da saltos
   distintos según la duración y `1`, `1000`, `1500`… dan 404. Sin duración conocida hay que
   enviar `0` (documentado como «all episodes»), no omitir el parámetro. La caché debe usar el
   mismo valor que se manda (redondeado al segundo está bien: la sensibilidad medida es de
   decenas de segundos, no de fracciones).
4. **`mixed-*` se traduce a `op`/`ed` y se conservan los dos intervalos.** El solape medido
   (`op` y `mixed-op`, `ed` y `mixed-ed`) significa que «uno por tipo» es incorrecto: la
   deduplicación tiene que ser por `(type, start, end)`, que es lo que ya hace `normalize.ts`.
   También aparecen `mixed-*` sin `op`/`ed` equivalentes (Dandadan ep. 1 solo `mixed-ed`; Kimetsu
   ep. 1 `ed` + `mixed-ed`), así que pedir los cinco tipos es necesario.
5. **Validación de intervalos, más allá de `end > start`.** Datos reales que pasan la validación
   actual: `ed` a los 232 s (Dandadan), `endTime` mayor que la duración pedida (Shingeki 1448 vs
   1440), solapes entre tipos. Con la duración conocida se puede acotar: descartar o recortar
   `end` a `duration` y descartar `start >= duration`. Sin duración, al menos mantener el orden y
   no inventar.
6. **`recap` es un tipo real** (5/18 encontrados) y no debe colapsarse en `op`.
7. **`idMal null` no se llama**: 0 consultas, lista vacía, y el contrato de tres estados
   (ausente / `null` / número) ya está justificado. Además los ids pueden coincidir o no con
   AniList: nunca usar el id de AniList como `animeId`.
8. **No aplicar `relation-rules` al consultar saltos** (medido: `16498/26` no tiene datos;
   `25777/1` sí). El `idMal` correcto es el de la temporada, que es el que da AniList.
9. **`episode` del contrato** admite 0 (el spec de AniSkip lo admite y la ruta actual lo parsea);
   medido que hoy devuelve 404 en los títulos probados, pero no hay que romper el caso.

---

## 6. Consecuencias para el TTL de caché

### 6.1. Lo que hace el tercero

- `200` y `404 found:false`: `cache-control: max-age=300`, ETag débil, Cloudflare responde `HIT`.
  Es decir, **el tercero cambia como mucho cada 5 minutos** a ojos de un cliente, y cachea también
  la ausencia de datos.
- `400`: `BYPASS`, sin caché.
- Límite declarado: **120 peticiones/minuto** por IP; medido que `x-ratelimit-remaining` baja en
  cada llamada y que no hay `Retry-After` en las respuestas normales.

### 6.2. TTL actual del servidor (leído en el worktree, no medido en ejecución)

`TTL_SECONDS.aniskip` = 30 días (encontrado), `TTL_SECONDS.aniskipMiss` = 6 h (vacío),
`TTL_SECONDS.aniskipError` = 15 min (fallo). La ruta añade al navegador
`cache-control: private, max-age=3600`.

### 6.3. Qué dicen los datos

1. **El `404 found:false` debería contar como miss, no como error.** Es el 53 % de las respuestas
   medidas, es cacheable por el borde 5 min y significa «no hay datos», no «fallo». Con el código
   actual, ese 404 cae en `!response.ok` → TTL de error (15 min), no en el TTL de miss (6 h):
   se pierde la distinción de tres estados que el propio servicio declara y se multiplican las
   consultas al tercero. Además, como la cobertura se construye con el tiempo (Frieren al 22 %,
   Shingeki al 100 %), el TTL de miss es el que gobierna la probabilidad de descubrir datos nuevos.
2. **La rama «no sé la duración» está rota aguas arriba.** Si `length` no viene, `aniskipUrl` no
   añade `episodeLength` y AniSkip contesta `400` (medido). Ese 400 se cachea como error 15 min y
   el episodio nunca tendrá saltos. Hay que mandar `0` (o exigir duración) y que la clave use `0`
   como hoy.
3. **El `episodeLength` en la clave está justificado y no conviene cuantizarlo más.** 1440 y 1450
   devuelven `op` en `128.406` y `43.87` respectivamente; redondear a unidades de 60 s mezclaría
   respuestas distintas. Al segundo (lo que hace `Math.round`) es un compromiso correcto para
   variaciones del reproductor (±0.5 s).
4. **30 días para `found`** es defendible si se asume que un intervalo enviado no se corrige; con
   datos colaborativos y votos, 7–14 días reduce el riesgo de servir un intervalo corregido sin
   disparar las consultas (el borde ya absorbe 5 min). Decisión de producto; lo medido es que el
   contenido cambia y que la ausencia es lo frecuente. Si se mantiene 30 días, conviene documentar
   que una corrección puede tardar un mes en verse.
5. **La caché del navegador (1 h)** es compatible: el servidor ya responde rápido y el dato no
   cambia dentro de la hora; no hay que subirla.

### 6.4. El límite de 120/min

Un episodio = una consulta (más la deduplicación en vuelo de dos pestañas). Con la caché
persistente, el tráfico al tercero es de descubrimiento, no de reproducción. Sin caché, un usuario
que mueve la barra y recarga podría acercarse al límite por IP; con la clave por (MAL, episodio,
duración) no. Es el argumento cuantitativo del proxy, junto con el 30/min de AniList.

---

## 7. Consecuencias para la UI

1. **Ausencia de datos es el estado dominante**: 20/38 (53 %) de las consultas medidas son 404.
   El reproductor no debe enseñar cargador eterno, error ni hueco: si la lista viene vacía (200),
   no hay botones; es el caso normal.
2. **Botones por tipo, no «saltar opening/ending» a ciegas**: 5/18 encontrados solo tienen `op`,
   1/18 solo `ed`. La UI que pinta un botón de «op» y otro de «ed» debe decidir por presencia.
3. **`mixed-*` produce botones duplicados solapados** si se traduce a `op`/`ed` sin política:
   Shingeki ep. 1 tendría dos intervalos `op` (`75–135` y `128.406–218.406`) y dos `ed`
   (`1342.795–1430.616` y `1351.63–1441.63`); ONE PIECE ep. 1, dos `op` sin solape y dos `ed`
   solapados. Opciones: pintar ambos y que el reproductor elija por «el que contiene la posición
   actual», fusionar intervalos solapados del mismo tipo, o priorizar `op` sobre `mixed-op` cuando
   se solapan. Lo que no puede pasar es que el usuario vea dos botones idénticos sin explicación.
4. **Recortar `end` a la duración real del vídeo** y no saltar si `start >= duration`: hay
   `endTime` por encima de la duración pedida (Shingeki ep. 25: 1448 con `episodeLength=1440`;
   ep. 1: `mixed-ed` acaba en 1441.63) y un `ed` a los 232 s (Dandadan). Sin acotar, el salto
   puede irse al final o a un sitio raro.
5. **`recap` merece su propio texto/icono**: es un tipo del contrato y aparece en 5/18; llamarlo
   «opening» sería mentir.
6. **Película/OVA/especial**: 0/5 en la muestra. Si el reproductor pide saltos para estos
   formatos, que sea sin expectativa y sin pintar controles vacíos.
7. **`idMal null`**: no hay petición; no hay botones; no es un error que se muestre.
8. **`episodes: null`** (ONE PIECE) afecta a los totales de la ficha, no a los saltos, pero el
   tipado de la UI no puede asumir número.

---

## 8. Límites de esta medición

- **Una IP y una ventana de ~10 minutos.** Los límites y la caché son los que había el
  2026-11-08; pueden cambiar.
- **Muestra sesgada a títulos conocidos.** 38 episodios no estiman la cobertura global de AniSkip;
  estiman la de estos títulos. Los porcentajes sirven para decidir «¿la ausencia es normal?» (sí),
  no como métrica del servicio.
- **La regla interna de `episodeLength`** (ventana exacta de aceptación y desempate entre entradas)
  no se caracterizó; solo se acotó (acepta 20 s de diferencia, rechaza 40 s) y se probó que `0`
  devuelve «todas».
- **No se midió el `POST /v2/skip-times/vote/{skipId}`** ni el alta de saltos: no hacen falta para
  T60 y habrían requerido identificar un `skipId` y enviar votos a un servicio público.
- **CORS medido por cabeceras**, no desde un navegador real (no hay preflight de navegador en esta
  sesión); `access-control-allow-origin: *` y el `204` del `OPTIONS` son la evidencia.
- **No hay medición de un `429`**: no se forzó el límite.

---

## Anexo A — URLs exactas medidas (muestra representativa)

AniList (POST, body JSON con `variables.id`):

- `https://graphql.anilist.co` ids `154587`, `16498`, `21`, `101922`, `171018`, `21519`, `120377`, `162314`, `999999999`, `0`, `-5`.
- Búsquedas de formatos: `Page(perPage:8){media(type:ANIME,format:SPECIAL,sort:POPULARITY_DESC){…}}` (igual con `OVA` y `MUSIC`).

AniSkip (GET, todas con `types[]=op&types[]=ed&types[]=mixed-op&types[]=mixed-ed&types[]=recap`):

- `https://api.aniskip.com/v2/skip-times/52991/1?…&episodeLength=1440` (y ep. 2)
- `https://api.aniskip.com/v2/skip-times/16498/1?…&episodeLength=1440` (y ep. 2)
- `https://api.aniskip.com/v2/skip-times/21/1?…&episodeLength=1440` (y ep. 2)
- `https://api.aniskip.com/v2/skip-times/38000/1?…&episodeLength=1440` (y ep. 2)
- `https://api.aniskip.com/v2/skip-times/57334/1?…&episodeLength=1440` (y ep. 2)
- `https://api.aniskip.com/v2/skip-times/42310/1?…&episodeLength=1440` (y ep. 2)
- `https://api.aniskip.com/v2/skip-times/32281/1?…&episodeLength=6360`
- `https://api.aniskip.com/v2/skip-times/25781/1?…&episodeLength=1500` (y ep. 2)
- `https://api.aniskip.com/v2/skip-times/50612/1?…&episodeLength=1500` (y ep. 2)
- Barridos: `…/52991/{1,2,3,4,5,10,15,20,28}`, `…/21/{1,2,3,5,10,50,100,200,500,1000,1100}`, `…/16498/{1,2,3,5,10,20,25}`
- `episodeLength` variable sobre `…/16498/1` y `…/52991/1`: `0, 1, 1000, 1400, 1420, 1430, 1440, 1445, 1447, 1500, 1580, 1600, 99999, -1, abc, 1e20, 1440.5`
- Filtros por tipo: `…/16498/1?types[]=op|ed|mixed-op|mixed-ed|recap&episodeLength=1440`, `…/21/1?types[]=op|recap|mixed-op&mixed-ed&episodeLength=1440`
- Sin `episodeLength`: `…/52991/1?types[]=op&types[]=ed`; sin `types`: `…/52991/1?episodeLength=1440`; sin nada: `…/52991/1`
- Casos: `…/999999999/1`, `…/0/1`, `…/52991/-1`, `…/52991/0`, `…/52991/2.5`, `…/52991/99`
- `https://api.aniskip.com/v2/relation-rules/16498`, `/25777`, `/21`
- `https://api.aniskip.com/openapi-v2.json` (contrato) y `https://api.aniskip.com/` (docs Scalar que apuntan al spec)

Anexo B — fuera de alcance, anotado por si acaso: `Packages/server/src/aniskip/*.ts` del worktree
documenta en comentarios que `episodeLength` «descarta intervalos que no caben» y que «sin ella
contesta igual». Lo primero es parte de la verdad (elige la entrada) pero no toda; lo segundo es
falso medido (sin ella es `400`). No se tocó código: este informe es la evidencia para que quien
corresponda lo decida.
