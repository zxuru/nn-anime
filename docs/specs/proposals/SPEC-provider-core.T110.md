# Propuesta · Capacidad de red inyectada para los plugins

Sobre `b3b0422`. Origen: el informe de seguridad de `nn-anime-plugins` (hallazgos H-02, H-03, H-04) y
el **riesgo residual 2** de `SECURITY.md` —DNS rebinding—, que hoy se declara imposible de cerrar.

## El problema, en una línea

Los plugins salen a la red por el `fetch` global: el guardián de destinos de `media-proxy` protege al
proxy, **no** a las peticiones del plugin, y `checkDestination()` resuelve el DNS pero el `fetch` que
viene detrás **vuelve a resolver**, así que un DNS hostil puede cambiar la respuesta entre la
comprobación y la conexión.

## La corrección que `SECURITY.md` da por imposible, y no lo es

`SECURITY.md:42-44` dice que conectar a la IP ya validada «rompe SNI y la validación del
certificado». **Medido, no es cierto**: con `node:tls` el nombre viaja en `servername` y el
certificado se sigue validando contra él.

```
resueltas de una vez: 104.20.23.154/4 172.66.147.243/4
TLS contra 104.20.23.154: autorizado=true TLSv1.3
certificado para: example.com
respuesta: HTTP/1.1 200 OK
```

Con eso, la capacidad **cierra el riesgo residual 2 en la ruta del plugin**, y deja la técnica lista
para cerrarlo también en el proxy (propuesta aparte, misma tarea o la siguiente).

## El cambio exacto

### 1. El contrato, en `packages/provider-sdk/src/types.ts` (~`:77-81`)

Miembro **opcional**. Uno obligatorio rompe la compilación de `call.test.ts:18`,
`provider-template.test.ts:37`, `providers-fixture/src/conformance.test.ts:14-15` y
`fixture.test.ts:14-15`, además de `provider-template.ts:96,174` (la plantilla que se le enseña al
autor) y de los seis plugins de `nn-anime-plugins`.

```ts
/** Una cabecera que el motor sí deja poner a un plugin. */
export type ProviderRequest = {
  readonly method?: 'GET' | 'POST'
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: string
  /** Tope que pide el plugin. El motor impone el suyo por debajo. */
  readonly maxBytes?: number
}

/**
 * Lo que devuelve el motor. Todo él es clonable a propósito —números, cadenas y
 * objetos—: el día que el plugin corra en un hilo o en otro proceso, la misma
 * forma viaja por un socket sin cambiar el contrato.
 */
export type ProviderResponse = {
  readonly status: number
  /** La dirección final, después de los saltos revalidados. */
  readonly url: string
  /** Sólo las cabeceras que un plugin necesita: `content-type`, `set-cookie`… */
  readonly headers: Readonly<Record<string, string>>
  /** El cuerpo, ya descomprimido y ya acotado por el motor. */
  readonly body: string
}

/** La única puerta a la red que tiene un plugin. */
export type ProviderFetch = (url: string, request?: ProviderRequest) => Promise<ProviderResponse>
```

En `CallOptions`: `readonly fetch?: ProviderFetch`.

`set-cookie` **sí** se expone: el flujo de jkanime lee la cookie de la ficha y la reenvía en el POST
del paginador (`jkanime.ts`), y eso es una sesión del plugin con **ese** sitio, no una credencial del
usuario. Lo que no cruza es el cambio de origen (§4).

### 2. La inyección, en `packages/provider-sdk/src/call.ts`

Es el **único** archivo que invoca métodos de proveedor (`call.ts:116-117, 128, 138, 206, 216-217, 234,
246`), así que un envoltorio aquí cubre las ocho construcciones de `CallOptions` de las rutas
(`anime.ts:73-76`, `episodes.ts:89-94`, `stream.ts:306-309`, `play.ts:63-66`,
`recommendations.ts:107-110` y `:162-165`, `discovery.ts:117-120`, `aggregate.ts:139-142`) **y** la
búsqueda que no pasa por el contenedor (`routes/search.ts:89-91`).

```ts
const opciones = { ...recibidas, fetch: recibidas.fetch ?? capacidadDeRed }
```

### 3. La implementación, en `packages/media-proxy/src/plugin-fetch.ts`

Junto a `destination-guard.ts`, que ya tiene lo que hace falta: `checkDestination()` (endurecido por
S1: sólo unicast global, IPv4 embebida juzgada como IPv4) y el tipo `FetchLike`
(`destination-guard.ts:303`, `byte-proxy.ts:96`).

Cliente HTTP/1.1 sobre `node:net`/`node:tls` con `node:zlib`, **sin dependencias nuevas**: `undici` no
está en el árbol y `bun install --frozen-lockfile` (`ci.yml:36`) lo bloquearía. `Connection: close`,
sin `keep-alive`: una petición por conexión, menos estado y menos sorpresas.

### 4. La política, por salto

| # | Regla | De dónde sale |
|---|---|---|
| 1 | Sólo `http`/`https`, con autoridad explícita, sin credenciales en la dirección y sin caracteres de control | `httpUrlSchema` de `core`, la misma frontera que ya valida las respuestas |
| 2 | El nombre no puede ser loopback, red privada, link-local, metadata ni un IPv6 que no sea unicast global | `checkDestination()`, S1 |
| 3 | **Resolver una vez** (`node:dns/promises`, `all: true`), juzgar **todas** las respuestas y conectar a una ya validada, con `servername` para el SNI | nuevo: cierra el riesgo 2 |
| 4 | Redirecciones **manuales**, máximo 5 saltos, revalidando 1-3 en cada uno; si cambia el origen se quitan `cookie`, `authorization` y `proxy-authorization` | nuevo |
| 5 | Tope de bytes **descomprimidos**, cortando el flujo al pasarse; `content-length` sólo como aviso | nuevo (hoy el tope del proxy es otro camino) |
| 6 | Plazo total por petición (el `timeoutMs` del contrato) más vigilante de inactividad que se rearma con cada trozo | S9, `byte-proxy.ts` |
| 7 | Cabeceras que el plugin puede poner: `accept`, `accept-language`, `user-agent`, `referer`, `origin`, `content-type`, `cookie`, `range`. Lo demás se descarta | la lista blanca de `animex` que ya existe en los plugins |
| 8 | Excepción de red interna: **la misma** variable `NN_ANIME_ALLOW_LOOPBACK` (riesgo residual 5), con su aviso en el arranque, nunca por defecto, y **más estrecha que la del proxy**: en el plugin sólo se exime `loopback`, nunca una red privada | `destination-guard.ts:57-74` |

Un solo interruptor para todo lo que sale del proceso, y no dos: dos listas de excepciones divergen. Lo
que sí difiere es el alcance, y a propósito: la del proxy abre loopback **y** redes privadas —lo pide el
arnés—, y la del plugin sólo `loopback`, que es donde vive un sitio de prueba en la propia máquina. La
metadata de nube y lo link-local no se eximen en ninguna de las dos.

## Cómo se prueba

Seams inyectables (`resolver` y `connector`), como `destination-guard.test.ts` hace con `resolverCon`:
ninguna prueba toca la red ni el DNS. Casos negativos obligatorios:

- un nombre que resuelve a `127.0.0.1`, a `10.0.0.1` y a `::ffff:7f00:1` → **rechazado**;
- un nombre con **dos** respuestas, una pública y otra interna → rechazado (se miran todas);
- rebinding: se cuentan las resoluciones —**una por petición y una por cada redirección**, ni una más—
  y que la conexión vaya siempre a la dirección validada, aunque el DNS cambie de respuesta entre
  medias;
- TLS: la conexión va a la IP validada **con el nombre en el SNI y la verificación del certificado
  encendida** (`rejectUnauthorized: true`), y un certificado que no corresponde al nombre se rechaza;
- redirección a una IP interna → no se sigue; redirección a otro origen → sin `cookie` ni
  `authorization`;
- seis saltos → corta;
- bomba de compresión: 1 KiB que descomprime a 1 GiB → corta por bytes **descomprimidos**;
- plazo total y vigilante de inactividad (los dos, con su caso distinguido como en
  `byte-proxy.test.ts`);
- el upstream manda `set-cookie` y cabeceras raras → llega `set-cookie` y nada más.

Y **cada prueba negativa se mide mutando la implementación** (`AGENTS.md:93-95`): se rompe el código a
propósito, se comprueba que esa prueba se pone roja y se restaura. La salida de esa matriz va en el
informe de cierre. Si al romper el código la prueba sigue verde, la prueba no vale.

## Migración de los seis plugins

Un cambio mecánico por archivo: `respuesta.text()` → `respuesta.body`, `opciones.fetch ??` → error
claro si el motor no ofrece la capacidad, y `JSON.parse(respuesta.body)` donde ya se hace. El
`cuerpo()` que acaban de recibir (H-04) **se queda**: deja de ser la única defensa y pasa a ser la
segunda. La línea base de `tests/security/sin-fetch-global.test.ts` baja de 7 llamadas al `fetch`
global a **cero**, y esa prueba es la que impide que vuelvan.

## Alternativas descartadas

- **Miembro obligatorio en `CallOptions`**: rompe cuatro fixtures, la plantilla y los seis plugins, y no
  aporta nada que no aporte el respaldo en `call.ts`.
- **Subir `PROVIDER_API_VERSION` a `'2'`**: el registro **rechaza** el plugin con un mensaje que nombra
  las dos versiones (`registry.ts:61-65`), así que deja fuera a todo lo instalado. Es evento de versión
  mayor y hace falta aprobarlo; no compensa para añadir una capacidad que es opcional por naturaleza.
- **`undici` con `lookup` propio**: menos código, pero mete una dependencia nueva (y `--frozen-lockfile`
  la bloquea hasta que se apruebe), no está en el árbol y no es el `fetch` que usa Bun.
- **`fetch` con `redirect: 'manual'` y sin fijar la IP**: es lo barato, y deja el riesgo 2 exactamente
  donde está. Es lo que ya hace el proxy.
- **Firmas del plugin (minisign/sigstore)**: es la otra mitad del problema —saber que el archivo es el
  que se revisó— y va en su propia propuesta sobre la instalación desde GitHub.

## Lo que esta propuesta **no** cierra

1. **El plugin sigue sin sandbox** (riesgo residual 1, intacto): esto acota a dónde sale, no lo que
   puede hacer dentro del proceso.
2. **Un plugin que llame al `fetch` global se salta la política.** Mitigación de esta tarea: la prueba
   estática del repositorio de plugins y la migración de los seis. Fase 2 —no bloqueante—: que el
   cargador lea el archivo y lo **avise** en Ajustes, sin rechazarlo (bloquearlo dejaría fuera a todo
   plugin de terceros existente).
3. **Mi cliente HTTP es código nuevo**: se acota a HTTP/1.1, `Connection: close`, sin `keep-alive` ni
   `chunked` de salida, y con las pruebas de mutación de arriba. No sustituye al del proxy.
4. **El riesgo 2 sigue abierto en el proxy** mientras no se le aplique la misma técnica: hoy
   `checkDestination()` resuelve y el `fetch` de `byte-proxy` vuelve a resolver.

## Decisiones (T110)

1. **`fetch` es opcional en `CallOptions`**, y `PROVIDER_API_VERSION` **no** sube a `'2'`. A cambio, el
   motor **siempre** pone la capacidad: `call.ts` la inyecta en cada llamada, así que un plugin que
   prefiera el `fetch` global se salta la política de destinos de forma **visible** —lo delata la
   prueba estática del repositorio de plugins y, en su día, el aviso del cargador— y no por descuido.
   Para los plugins de terceros, la capacidad será **obligatoria en la siguiente versión mayor**.
2. **El cierre del riesgo 2 en el proxy entra en T110**, como paso posterior y en **commit aparte**,
   después de que esta capacidad esté probada: el proxy es otra superficie y tiene que poder revertirse
   sin tocar la de los plugins.
3. **`SECURITY.md` lo corrige esta tarea**, en un commit propio y con `security-notice.test.tsx` en el
   mismo commit. El riesgo 2 sólo pasa a mitigado en las rutas donde la mitigación esté implementada y
   probada; lo que quede sin cubrir se declara como residual.
4. **La excepción de red interna del plugin es sólo `loopback`** (política, punto 8).
5. El ID de task es **T110**: confirmado contra el índice —no está en `tasks/todo.md`, no hay
   `tasks/done/T110.md` y no hay reclamación viva en `refs/claims`—.
6. La implementación se limita a `packages/core` (los tipos, para no invertir dependencias),
   `packages/provider-sdk` (el contrato y la inyección) y `packages/media-proxy` (la implementación).
   La corrección de `SECURITY.md` va en su propio commit, con su prueba.

## Prueba de concepto del host con permisos (medida)

Lo que la aplicación podría hacer cuando los plugins dejen de ser seis archivos que alguien lee. Medido
en esta máquina (`node v26.11.1`, `bun 1.4.3`) con una sonda que lee un archivo del sistema, escribe en
el temporal y sale a la red:

| Runtime | Leer | Escribir | Red | RSS |
|---|---|---|---|---|
| `node` | permitido | permitido | permitido | 37 MiB |
| `node --permission` | **bloqueado** | **bloqueado** | **bloqueado** | 37 MiB |
| `node --permission --allow-net` | bloqueado | bloqueado | permitido | 37 MiB |
| `bun` | permitido | permitido | permitido | 39 MiB |

Tres conclusiones que cambian el plan:

1. **Bun no tiene modelo de permisos** —`bun --help` sólo ofrece `--smol`, de memoria—, así que un host
   de plugins con capacidades tendría que ser un proceso **Node**, o confiar el aislamiento al sistema
   operativo: Job Objects en Windows, cgroups o bubblewrap en Linux.
2. **El `--allow-net` de Node es binario.** Con `--allow-net=127.0.0.1`, la conexión a `1.1.1.1` se
   permitió igual: la lista de hosts no se respeta. Deno sí tiene `--allow-net=host`, pero no está
   instalado y sería un tercer runtime en el proyecto.
3. **Por eso, la configuración buena no necesita red en el hijo.** Si el proceso padre hace el HTTP por
   el hijo —que es exactamente lo que hace `createPluginFetch()`—, el host de plugins corre con
   `--permission` y **nada permitido**: ni disco, ni procesos, ni red. El aislamiento no cuesta
   permisos; lo que cuesta es un proceso más: **41 ms de arranque** (frente a 42 ms de Node sin
   permisos y 19 ms de Bun, media de cinco) y **37 MiB**.

El precio real, entonces, no es el arranque: es el puente. El contrato ya está preparado para él
—`PluginResponse` es clonable a propósito—, y lo que falta es serializar las llamadas de proveedor por
un socket, que es lo que convierte la capacidad de red en una capacidad *de verdad* y no en una
convención que cada plugin respeta si quiere.
