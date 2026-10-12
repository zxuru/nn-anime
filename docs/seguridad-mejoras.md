# Investigación de mejoras de seguridad

Revisión del código de v1 buscando huecos explotables y mejoras **aplicables directamente**: cada
hallazgo trae el parche, el archivo y la línea, y el coste de aplicarlo. Nada de rehacer el diseño.

Método: lectura de las fronteras de confianza (los tres guards, el proxy y su lista blanca de
destinos, el servido de estáticos, el alta de plugins, las cabeceras), más `bun audit` contra el
lockfile. Los hallazgos marcados como **probado** se reprodujeron ejecutando código, no razonando
sobre él.

Fecha: revisión sobre `8c27922`.

**Estado: los nueve aplicables, aplicados; S5 no se aplica y se declara.** El parche de S1 vive en
`ipv6Rule()` (`destination-guard.ts`) con sus pruebas en `destination-guard.test.ts` y en
`tests/seguridad.test.ts`; el de S2 es `maxRequestBodySize` en `startServer()`
(`packages/server/src/index.ts`), con la prueba de frontera en `tests/limite-cuerpo.test.ts`. S3, S4,
S6, S7, S8, S9 y S10 se aplicaron después de una auditoría previa a publicar el repositorio, cada uno
con su prueba y con la prueba medida mutando la implementación. S5 —el limitador de tasa— se decide
**no** aplicar y queda como riesgo residual número 4 de `SECURITY.md`, con el motivo escrito: es una
aplicación local de un solo usuario y un contador en memoria no cierra nada que no cierren ya el guard
de `Host` y la cookie de sesión.

## Resumen

| # | Hallazgo | Severidad | Coste | Estado |
|---|---|---|---|---|
| S1 | La lista blanca de destinos acepta IPv4 dentro de IPv6 (`::ffff:…`) | **Crítica** | Bajo | **Aplicado** |
| S2 | `Bun.serve` sin tope de cuerpo: 128 MiB por petición | Alta | Muy bajo | **Aplicado** |
| S3 | Faltan cabeceras de seguridad y dos directivas de CSP | Media | Muy bajo | **Aplicado** |
| S4 | Alta de proveedor: `access()` + `writeFile()` sin `wx` (TOCTOU) | Media | Muy bajo | **Aplicado** |
| S5 | Sin límite de tasa en ninguna ruta | Baja | Medio | **No se aplica**: riesgo residual 4 de `SECURITY.md` |
| S6 | `.gitignore` no cubre `.env*` ni material de claves | Baja | Muy bajo | **Aplicado** |
| S7 | El guard de `Host` no cubre `/` ni los estáticos | Baja | Muy bajo | **Aplicado** |
| S8 | Sin `Cache-Control: no-store` en las respuestas JSON protegidas | Baja | Bajo | **Aplicado** |
| S9 | Sin límite de tiempo hacia el upstream cuando el cliente sigue conectado | Baja | Bajo | **Aplicado** (vigilante de inactividad, no plazo total) |
| S10 | Sin CI que ejecute auditoría de dependencias y pruebas | Baja | Bajo | **Aplicado** |

Lo que ya está bien, y no hay que tocar: la sesión y el token de arranque (32 bytes, comparación en
tiempo constante, un solo uso, caducidad de 5 min, `HttpOnly; SameSite=Strict`), el guard de `Host`
con la decisión de aceptar sólo `127.0.0.1`, el guard de `Origin` en métodos mutantes, el
confinamiento de los estáticos (`..`, `\0`, `lstat`, `decodeURIComponent` antes de decidir), la
eliminación de `Set-Cookie` y del resto de cabeceras del upstream, el forzado del `Content-Type` por
lo pedido y no por lo que dice el upstream, el rechazo de SVG en las portadas, los tickets opacos,
la redacción de credenciales en el registro, y la validación con Zod de todo cuerpo entrante. La
auditoría de dependencias está limpia: 138 paquetes, cero avisos.

---

## S1 · Crítica · SSRF: la lista blanca acepta IPv4 embebida en IPv6

**Probado.** `checkDestination()` deja pasar direcciones que el sistema conecta contra `127.0.0.1`,
redes privadas y la metadata de la nube.

### Causa

`packages/media-proxy/src/destination-guard.ts:108` sólo reconoce la IPv4 dentro de una IPv6 cuando
llega escrita con puntos:

```ts
const mapeada = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(limpia)
```

Esa rama es **código muerto**. `new URL()` normaliza la forma mapeada a hexadecimal antes de que
nadie la mire:

```
new URL('http://[::ffff:127.0.0.1]/').hostname  ->  "[::ffff:7f00:1]"
```

La expresión no casa con `::ffff:7f00:1`, y las comprobaciones que vienen detrás —`::1`, `fe80::/10`,
`fc00::/7`— tampoco. La función devuelve `undefined` y el destino se considera permitido.

### Prueba

```
checkDestination('http://[::ffff:127.0.0.1]:8080/')      -> ok: true
checkDestination('http://[::ffff:7f00:1]/')              -> ok: true
checkDestination('http://[::ffff:10.0.0.1]/')            -> ok: true
checkDestination('http://[::ffff:169.254.169.254]/')     -> ok: true
```

Y el sistema **sí** conecta: contra un servidor escuchando en `127.0.0.1`, `fetch` de las dos formas
devuelve 200 con el cuerpo del servicio interno.

### Alcanzabilidad

`fetchAllowed()` valida cada salto de redirección con esta función, y su URL sale de un plugin. Basta
con que un upstream legítimo —o uno secuestrado— responda `Location: http://[::ffff:169.254.169.254]/…`
para que el proxy pida la metadata de la nube y devuelva el cuerpo al cliente. Es SSRF clásico: el
proxy sale con los permisos del proceso hacia donde el atacante elige.

### Parche

Sustituir `ipv6Rule()` por una lectura por bytes. La regla deja de ser una lista negra de formas
conocidas y pasa a ser «sólo unicast global»: cualquier dirección fuera de `2000::/3` se rechaza, y
las IPv4 embebidas se juzgan como IPv4.

```ts
/** Los 16 bytes de una IPv6. `undefined` si el texto no es una dirección. */
function ipv6Bytes(direccion: string): Uint8Array | undefined {
  const limpia = direccion.toLowerCase().split('%')[0] ?? ''
  if (limpia === '') return undefined

  const abierto = limpia.includes('::')
  const [cabeza = '', cola] = limpia.split('::')
  const grupo = /^[0-9a-f]{1,4}$/
  const izquierda = cabeza === '' ? [] : cabeza.split(':')
  const derecha = cola === undefined || cola === '' ? [] : cola.split(':')
  if (izquierda.some((t) => !grupo.test(t)) || derecha.some((t) => !grupo.test(t))) return undefined

  const faltan = 8 - izquierda.length - derecha.length
  if (abierto ? faltan < 1 : faltan !== 0) return undefined

  const grupos = [...izquierda, ...new Array<string>(faltan).fill('0'), ...derecha]
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 8; i++) {
    const valor = Number.parseInt(grupos[i] ?? '0', 16)
    bytes[i * 2] = valor >> 8
    bytes[i * 2 + 1] = valor & 0xff
  }

  return bytes
}

function ipv6Rule(direccion: string): DestinationRule | undefined {
  const limpia = direccion.toLowerCase().split('%')[0] ?? ''

  const mapeada = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(limpia)
  if (mapeada !== null) return ipv4Rule((mapeada[1] ?? '').split('.').map(Number))

  const bytes = ipv6Bytes(limpia)
  if (bytes === undefined) return 'malformed'

  const b = (i: number): number => bytes[i] ?? 0
  const ceros = (desde: number, hasta: number): boolean =>
    bytes.slice(desde, hasta).every((x) => x === 0)
  const embebida = (): DestinationRule | undefined => ipv4Rule([b(12), b(13), b(14), b(15)])

  // Una IPv4 escrita dentro de una IPv6, en cualquiera de sus formas.
  if (ceros(0, 10) && b(10) === 0xff && b(11) === 0xff) return embebida()
  if (ceros(0, 12)) return embebida()

  if (b(0) === 0xfe && b(1) >= 0x80 && b(1) <= 0xbf) return 'link-local'
  if (b(0) === 0xfc || b(0) === 0xfd) return 'private'
  if (b(0) === 0xff) return 'malformed' // multicast

  // Sólo unicast global (2000::/3). NAT64, 6to4, Teredo y lo reservado no son
  // destinos que este proxy necesite, y admitirlos es superficie gratis.
  if (b(0) < 0x20 || b(0) > 0x3f) return 'malformed'

  return undefined
}
```

Comprobado con las pruebas que ya existen (`::1`, `fe80::1`, `fd00::1`, `2001:db8::1`,
`::ffff:93.184.216.34`) y con los casos nuevos:

```
::ffff:127.0.0.1        -> loopback     (antes: permitido)
::ffff:7f00:1           -> loopback     (antes: permitido)
::ffff:10.0.0.1         -> private      (antes: permitido)
::ffff:169.254.169.254  -> metadata     (antes: permitido)
64:ff9b::7f00:1         -> malformed    (antes: permitido)
ff02::1                 -> malformed    (antes: permitido)
2606:4700::1111         -> permitido    (no cambia)
2001:4860:4860::8888    -> permitido    (no cambia)
```

**Pruebas que hay que añadir** en `destination-guard.test.ts` (tabla de `addressRule`) y un caso de
extremo a extremo en `tests/seguridad.test.ts` junto a los cinco destinos prohibidos:

```ts
const ticket = container.tickets.issue({ url: 'http://[::ffff:169.254.169.254]/', headers: {} })
const respuesta = await pedir(`/stream/${ticket}`, { headers: GOOD })
expect(respuesta.status).not.toBe(200)
```

Sin este caso, el hueco vuelve en cuanto alguien reordene la función.

---

## S2 · Alta · `Bun.serve` sin tope de cuerpo

`packages/server/src/index.ts:58` no pasa `maxRequestBodySize`, así que Bun aplica su valor por
defecto: **128 MiB**. Todas las rutas que leen cuerpo usan `await c.req.json()`, que acumula la
petición entera en memoria antes de validar nada: `register-provider.ts:62`, `stream.ts:56`,
`play.ts:53`, `settings.ts:87`, `watch.ts`, `favorites.ts`.

Un proceso local que tenga la sesión puede pedir seis cuerpos de 128 MiB a la vez. El cuerpo válido
más grande del proyecto es una descripción de proveedor: unos 2 KB.

```ts
const server = Bun.serve({
  port: options.port,
  hostname: LOOPBACK,
  // El cuerpo más grande que este servidor acepta es una descripción de
  // proveedor, y eso son dos kilobytes. Sin este tope, Bun admite 128 MiB y
  // `c.req.json()` los acumula antes de validar nada.
  maxRequestBodySize: 256 * 1024,
  fetch: served.fetch,
})
```

Ninguna ruta recibe archivos ni formularios, así que 256 KiB no rompe nada. Verificar con `bun test`
y la suite de seguridad.

---

## S3 · Media · Cabeceras de seguridad incompletas

`packages/server/src/middleware/security-headers.ts:41-44` pone cuatro cabeceras y la CSP no cierra
dos vías.

Falta:

- `form-action` en la CSP. Sin ella, `default-src` no la cubre: un formulario inyectado puede enviar
  datos a un origen ajeno.
- `frame-src`/`worker-src`/`manifest-src`. `default-src 'self'` los cubre hoy; declararlos evita que
  una futura relajación de `default-src` los abra sin que nadie lo note.
- `Permissions-Policy`: la aplicación no usa cámara, micrófono ni geolocalización, y no hay motivo
  para que un script inyectado pueda pedirlos.
- `Cross-Origin-Opener-Policy` y `Cross-Origin-Resource-Policy`: aíslan el contexto del navegador y
  evitan que otro origen incruste respuestas de este servidor.
- `X-Permitted-Cross-Domain-Policies: none`.

```ts
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "img-src 'self'",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "manifest-src 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ')

export const PERMISSIONS_POLICY = [
  'camera=()',
  'microphone=()',
  'geolocation=()',
  'payment=()',
  'usb=()',
  'serial=()',
].join(', ')
```

```ts
c.header('Content-Security-Policy', policy)
c.header('X-Content-Type-Options', 'nosniff')
c.header('Referrer-Policy', 'no-referrer')
c.header('X-Frame-Options', 'DENY')
c.header('Permissions-Policy', PERMISSIONS_POLICY)
c.header('Cross-Origin-Opener-Policy', 'same-origin')
c.header('Cross-Origin-Resource-Policy', 'same-origin')
c.header('X-Permitted-Cross-Domain-Policies', 'none')
```

`worker-src 'none'` es seguro: no hay `new Worker` ni `serviceWorker` en `packages/web/src` (medido
con búsqueda sobre el árbol). `security-headers.test.ts` hay que ampliarlo con las cuatro cabeceras
nuevas y con las tres directivas.

---

## S4 · Media · Alta de proveedor: comprobación y escritura separadas

`packages/server/src/routes/register-provider.ts:82-88` comprueba con `access()` y escribe después.
Entre las dos llamadas cabe otro proceso:

```ts
if (await exists(file)) { … 409 … }
await writeFile(file, renderProviderModule(draft), { mode: 0o600 })
```

La garantía «no se pisa nada» que el propio archivo documenta no la sostiene el sistema de archivos,
la sostiene una comprobación que puede quedar vieja. El parche es de una línea y quita la carrera:
`flag: 'wx'` falla con `EEXIST` si el archivo apareció entre medias, y eso es atómico.

```ts
try {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  // `wx` es la garantía de verdad: entre `exists()` y esta llamada cabe otro
  // proceso, y aquí el sistema de archivos decide, no una comprobación previa.
  await writeFile(file, renderProviderModule(draft), { mode: 0o600, flag: 'wx' })
} catch (cause) {
  const codigo = (cause as NodeJS.ErrnoException).code
  if (codigo === 'EEXIST') {
    return c.json(badRequest(`ya hay un proveedor con ese identificador: ${draft.id}`), 409)
  }

  return c.json(badRequest(`no se pudo escribir el plugin: ${reasonOf(cause)}`), 500)
}
```

La comprobación previa se queda: da el 409 barato en el caso normal.

---

## S5 · Baja · Sin límite de tasa

No hay ningún limitador en el proyecto (búsqueda sobre `ratelimit|throttle`: cero resultados). El
riesgo no es adivinar la sesión —32 bytes de entropía lo hacen imposible— sino el trabajo que una
petición dispara hacia fuera: cada `/api/search` consulta a todos los proveedores activos, y cada
`POST /api/providers` reimporta el directorio entero y escribe en disco.

Con un solo proceso y un solo usuario, un contador en memoria basta; no hace falta tienda
compartida mientras el servidor siga siendo un proceso en loopback. Propuesta mínima, en un
middleware nuevo montado sobre `/api/`:

| Ruta | Límite |
|---|---|
| `POST /api/providers` | 5 por minuto |
| `POST /api/stream/resolve`, `POST /api/play/mpv` | 30 por minuto |
| `/api/search` | 60 por minuto |

Respuesta 429 con `Retry-After`. Es el hallazgo con más código de los diez y el de menos impacto
real: se puede dejar para después de S1–S4.

---

## S6 · Baja · `.gitignore` sin `.env*`

`.gitignore` cubre `*.db`, `dist/`, `.tmp/` y los registros, pero no un `.env` ni material de claves.
Hoy no hay ninguno de los dos en el repo ni en el historial (`git log -p --all` no devuelve
credenciales: sólo los secretos de mentira de las pruebas). La regla existe para que siga siendo así
el día que alguien añada una integración.

```gitignore
# Secretos: nunca dentro del repo. `.env.example` sí, con marcadores.
.env
.env.*
!.env.example
*.pem
*.key
*.p12
```

---

## S7 · Baja · El guard de `Host` no cubre `/`

En `app.ts:126-138`, `hostGuard` se monta por prefijo (`/api/`, `/stream/`) y el canje de arranque
vive en `/`, fuera de los tres guards. Una petición a `/` con `Host: evil.example` se atiende.

El impacto es bajo —para canjear el token hay que tener el token, y las llamadas a la API desde ese
origen las sigue rechazando el guard—, pero es una incoherencia: el guard existe para fallar
cerrado, y aquí no se aplica. El guard no lee cookies ni estado, así que montarlo sobre `'*'` es
gratis:

```ts
// El `Host` se comprueba en todas partes, incluido `/`: el canje de arranque no
// es una excepción, y un guard que se salta una ruta deja de ser un guard.
app.use('*', hostGuard(getPort))

const guards = [originGuard(getPort), sessionGuard(options.session)]
for (const prefix of PROTECTED_PREFIXES) {
  app.use(`${prefix}*`, ...guards)
}
```

Comprobar que el e2e y `bun run start` siguen entrando: ambos usan `127.0.0.1:PUERTO`, que es lo
único que el guard admite.

**Aplicado, y con una consecuencia que conviene leer.** La prueba `app.test.ts` que se llamaba «no
toca las rutas fuera de /api y /stream» fijaba el comportamiento contrario —que `/otra/cosa` con un
`Host` ajeno **no** daba 403— y se sustituyó por la que ahora se espera: 403 en `/`, en `/otra/cosa` y
en `/?boot=…` con `Host` ajeno, más una que comprueba que el canje con el `Host` correcto sigue dando
302. Un guard que se salta una ruta no es un guard, y el precio de arreglarlo era cambiar una prueba
que decía lo contrario.

---

## S8 · Baja · Respuestas JSON protegidas sin `no-store`

`GET /api/settings` devuelve las rutas del disco del usuario (`settings.ts:41-47`) y no lleva
`Cache-Control`. En loopback no hay caché compartida, así que el riesgo es que el navegador guarde
en disco la copia de un listado de rutas.

No conviene resolverlo en `securityHeaders`: `/api/cover/:providerId/:ref` **quiere** caché larga, y
una cabecera puesta después de `next()` la pisaría. La forma limpia es un middleware propio montado
sobre `/api/` que se salte la ruta de portadas, o poner `c.header('cache-control', 'no-store')` en
las rutas que devuelven JSON. Es el arreglo con más superficie de los diez para el beneficio más
pequeño: se puede omitir sin deuda real.

---

## S9 · Baja · Sin tiempo límite hacia el upstream

`proxyBytes()` propaga la señal del cliente (`c.req.raw.signal`) y nada más. Si el cliente mantiene
la conexión abierta, un upstream que responde a cuentagotas mantiene viva la conexión con el sitio
de terceros indefinidamente: el `Accept-Encoding: identity` y el `pipeTo` acotan la memoria, no el
tiempo.

Un `AbortSignal.timeout(30_000)` combinado con la señal del cliente cierra el caso sin tocar nada
más. Es defensa contra un tercero hostil, no contra el usuario.

**Lo aplicado no es ese parche, y a propósito.** `AbortSignal.timeout` es un plazo **total**: empieza
a contar al crear la señal y dispara a los treinta segundos pase lo que pase. Aplicado aquí, mataría
la reproducción a los treinta segundos de empezar, porque un episodio de dos horas tarda dos horas en
llegar. Lo que hay es un vigilante de **inactividad** en `byte-proxy.ts` (`IDLE_TIMEOUT_MS`), que se
rearma con cada trozo que llega del upstream: corta el silencio, no la descarga. La prueba que
distingue los dos está en `byte-proxy.test.ts` —cinco trozos cada 8 ms con un plazo de 15 ms: pasa con
el vigilante y falla con un plazo total— y se midió mutando la implementación para comprobarlo.

---

## S10 · Baja · Sin CI

No hay `.github/` ni ningún pipeline. `bun audit` está limpio hoy (138 paquetes), pero nada lo
comprueba en el siguiente cambio. Un flujo mínimo que corra `bun install --frozen-lockfile`,
`bun audit`, `bun run typecheck`, `bun run lint` y `bun test` convierte las doce mitigaciones de
`tests/seguridad.test.ts` en un gate en lugar de en una promesa.

Sobre el canal de suministro, lo que ya está bien y conviene no estropear: hay un solo lockfile
(`bun.lock`) en la raíz del workspace, no hay `bunfig.toml` que apruebe guiones de instalación a
granel, y Bun bloquea los guiones de dependencias no declaradas en `trustedDependencies`. Si algún
día hace falta aprobar uno, que sea uno con nombre y motivo, y que quede en `bunfig.toml` con su
comentario.

---

## Orden de aplicación

Se aplicaron así, cada uno con su commit y su prueba:

1. **S1** — parche, pruebas nuevas, `bun test`, `bun run typecheck`.
2. **S2, S4** — dos líneas cada uno, con su prueba.
3. **S3** — cabeceras y ampliación de `security-headers.test.ts`.
4. **S6, S7** — una línea cada uno.
5. **S8, S9, S10** — opcionales, por este orden.
6. **S5** — no se aplica; queda escrito como riesgo residual en `SECURITY.md`.

S1 y S2 no se solapan con nada de lo documentado en `SECURITY.md`: el riesgo residual número 2 (DNS
rebinding) sigue siendo cierto y no lo cierra ninguno de los dos. La línea sobre IPv4 embebida se
añadió a `SECURITY.md` —y con ello a la pantalla de Ajustes, que lee ese mismo archivo— cuando se
aplicó el parche.

Sobre la tabla de amenazas de `SECURITY.md`: se amplió con las filas de S3, S4, S7, S8 y S9, y **no**
se le añadió una segunda tabla, porque `security-notice.test.tsx` fija que haya exactamente una y con
tres columnas.
