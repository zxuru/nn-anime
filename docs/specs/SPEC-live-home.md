# Spec: live-home (la home que se refresca y se mueve)

Estado: **propuesta · pendiente de aprobación humana** · 2026-10-11 · decisiones del humano ya
tomadas: **relectura al volver a la pestaña y cada minuto** (sin SSE y sin ruta nueva) y
**movimiento sutil** (esqueletos y entrada escalonada, sin librería de animación).

Esta entrega **no crea un módulo**: extiende contratos y paquetes ya aprobados. No toca
`docs/specs/CAPABILITY-MAP.md` ni su build order.

Módulos que toca: `catalog-store` (el tipo `RevalidateResource`), `server` (el contenedor y dos
rutas), `web-ui` (el hook de la home, sus componentes y sus estilos). `recsys`, `media-proxy`,
`provider-sdk`, `provider-core` y `providers-fixture` **no se tocan**.

Antecedente, y es el hallazgo que abre esta entrega: **las dos filas que más cambian no se
refrescan nunca**. `GET /api/feed` y `GET /api/trending` leen la caché y devuelven lo que haya
aunque esté caducado:

```ts
// packages/server/src/routes/discovery.ts:92 — lo mismo en recommendations.ts:77
const cacheado = await options.container.store.readFeed(provider.id)
if (cacheado !== null) return cacheado.value   // `cacheado.stale` no se mira
```

El TTL existe y se calcula (`TTL_SECONDS.feed` = 1800, `TTL_SECONDS.trending` = 900), pero ahí nadie
lo lee: una entrada publicada después de la primera carga **no aparece jamás** en esa instalación.
Refrescar el cliente sin arreglar esto sería mover el problema de sitio: la home releería cada
minuto, con toda la razón, y recibiría exactamente lo mismo.

## Objective

Que la home se sienta viva: que **se entere sola** de que hay algo nuevo sin recargar la página, y
que **se vea que está trabajando** mientras carga y cuando llega contenido.

Éxito significa:

1. Con la fuente publicando una entrada nueva, la home la enseña **sin recargar y sin que el usuario
   haga nada**, en cuanto el TTL del recurso vence y la relectura siguiente lo trae.
2. Volver a la pestaña después de un rato **relee**, y volver antes de un minuto **no** vuelve a
   pedir: el usuario no puede provocar una tormenta de peticiones cambiando de pestaña.
3. Una relectura que falla **no borra lo que ya estaba pintado**: la fila se queda como estaba y lo
   único que se dice es que el refresco no llegó.
4. Mientras la home carga por primera vez se ven **esqueletos**, no una frase suelta, y las filas
   entran de forma escalonada.
5. Con `prefers-reduced-motion: reduce` no hay ni una animación de entrada: la página aparece entera
   y quieta.

## Supuestos declarados

1. **Sin SSE y sin ruta nueva.** El usuario ya eligió relectura periódica sobre push. Un
   `/api/events` habría sido una ruta nueva en el contrato —evento de versión mayor y aprobación
   aparte—, y para un dato que cambia como mucho a diario no compra nada. **Esto se aparta de la
   decisión 6 del plan** («SSE en lugar de sondeo»), que se escribió para la búsqueda incremental y
   el estado de mpv, donde hay muchos mensajes por segundo y el servidor sabe cuándo cambian. Aquí
   no los hay. La aparta se declara en vez de dejarla escrita en contra.
2. **La relectura del cliente no salta el TTL del servidor.** El feed se pide a un tercero, y
   pedírselo cada minuto sería convertir una función de la interfaz en tráfico contra un sitio
   ajeno. El cliente relee contra la caché local; quién sale a la red lo decide el TTL, y por eso
   una entrada nueva puede tardar hasta ~31 min en el feed y ~16 min en tendencias (TTL + una
   relectura). Se dice en el spec y no se disimula en la interfaz.
3. **La revalidación de fondo es la que ya existe.** Se reusa `readThrough` y el `Revalidator` del
   contenedor: deduplicación por clave, concurrencia 2 y errores anotados en `revalidate_error`. No
   se escribe un segundo mecanismo.
4. **El movimiento es CSS puro y se apoya en `tokens.css`.** Nada de librería de animación: es un
   *Ask first* del spec de `web-ui` y no hace falta para un fundido y un escalón.
5. **El esqueleto nuevo es el `.skeleton` que ya existe.** La búsqueda y el detalle ya lo usan, con
   su latido y su supresión bajo `prefers-reduced-motion`. Se replica el patrón, no se inventa otro.
6. **«hace 2 min» es presentación y se calcula en el cliente**, igual que la duración del reproductor
   en `useDetail.ts`. No se persiste texto relativo ni se pide al servidor la hora.

→ Si alguno de estos seis supuestos no es el que se quiere, se corrige **antes** de escribir código.

## Contrato

### Lo que **no** cambia

Ninguna ruta nueva, ninguna forma de respuesta nueva, ninguna cabecera nueva. `feedResponseSchema`,
`trendingResponseSchema`, `recentResponseSchema`, `continueWatchingResponseSchema` y
`favoritesResponseSchema` se quedan como están. `GET /api/feed` y `GET /api/trending` siguen
devolviendo lo mismo para la misma caché: lo que cambia es **cuándo la caché deja de mandar**.

### `catalog-store`: `RevalidateResource` gana dos recursos

```ts
// packages/catalog-store/src/revalidate.ts:26
export type RevalidateResource = 'anime' | 'episodes' | 'search' | 'feed' | 'trending'
```

Sin migración: la tabla `revalidate_error` guarda `resource TEXT NOT NULL` sin `CHECK`, y la fila
del error de un feed no pisa la de un anime porque la clave primaria es `(resource, key)`.

Claves de deduplicación, con el mismo razonamiento que `refKey`: el `#` no puede aparecer en un
identificador de proveedor, que es kebab-case por contrato.

```
feed#<providerId>        trending#<providerId>
```

### `server`: el contenedor gana dos lecturas, y las rutas las usan

Se añaden al `ServerContainer` con la forma de las que ya están —`Result<CacheOutcome<T>,
ProviderError>`— para que la ruta no sepa de revalidadores ni de la tabla de errores:

```ts
getFeed(provider: Provider, callOptions: CallOptions):
  Promise<Result<CacheOutcome<readonly FeedEntry[]>, ProviderError>>

getTrending(provider: Provider, callOptions: CallOptions):
  Promise<Result<CacheOutcome<readonly SearchResult[]>, ProviderError>>
```

Las dos se implementan con `readThrough`, `onError`/`onSuccess` sobre `revalidate_error` con su
recurso, y el reloj inyectable que el contenedor ya acepta (`options.now`), que es lo que permite
probar la caducidad sin esperar media hora.

Lo que **no** cambia en las rutas: un proveedor que falla sigue devolviendo lista vacía y no tumba
la fila, y el tope de entradas del feed (`MAX_FEED_ENTRIES`) se sigue aplicando **antes** de
escribir en la caché.

### `web-ui`: la relectura

`useHomeRows` pasa a devolver, además de las cinco filas:

```ts
interface HomeRows {
  readonly loading: boolean
  readonly error: string | undefined
  readonly refrescando: boolean          // hay una relectura en curso
  readonly refreshedAt: Date | undefined // cuándo llegó lo último que se ve
  // …las cinco filas de siempre
}
```

Reglas:

- **Primera carga**: las cinco lecturas en paralelo, como ahora.
- **Relectura**: cuando `document.visibilityState` pasa a `visible`, si han pasado **60 s** o más
  desde la última lectura completa. Y un intervalo de **60 s** que sólo corre con la pestaña
  visible: se para al ocultarla.
- **Fusión, no sustitución.** Una lectura que falla conserva **el valor anterior de esa fila**; lo
  que falla no se pinta como vacío. El error se declara sólo si no hay nada que enseñar —ni de esta
  lectura ni de la anterior—, que es la condición que ya existe, ahora con memoria.
- **Sin parpadeo.** `loading` sólo es cierto la primera vez; una relectura marca `refrescando` y
  deja el contenido en su sitio.
- **Movimiento reducido**: si `prefers-reduced-motion: reduce`, el cliente no cambia la cadencia
  (el movimiento no es lo que se reduce, la animación sí).

### `web-ui`: el movimiento

1. **Esqueletos de la home.** Mientras `loading`, la home pinta una banda de tarjetas con
   `.skeleton` por fila en vez de la frase `home.loading`. La frase se queda para lectores de
   pantalla, porque el esqueleto es `aria-hidden`.
2. **Entrada escalonada.** Las filas y las tarjetas entran con un fundido corto y un retardo por
   índice. Se anima **al montar**, no en cada relectura: una firma de render repetida no puede
   reiniciar la animación.
3. **Lo nuevo se nota.** Una tarjeta que no estaba en la lectura anterior entra con el fundido
   marcado; volver a pintar lo que ya estaba no anima nada.
4. **Sin movimiento en la cinta.** La cinta de lo más visto se queda quieta: en movimiento perpetuo
   es lo primero que cansa y lo primero que rompe la lectura.
5. **Tokens.** La duración del fundido y el paso del escalón van en `tokens.css`, con nombre, como
   el resto. Nada de `0.3s` suelto en una regla.

## Estructura

```
packages/catalog-store/src/revalidate.ts      el tipo gana 'feed' y 'trending'
packages/server/src/container.ts              getFeed y getTrending con readThrough
packages/server/src/routes/discovery.ts       /api/feed usa el contenedor
packages/server/src/routes/recommendations.ts /api/trending usa el contenedor
packages/web/src/features/home/useHomeRows.ts lectura, relectura y fusión
packages/web/src/features/home/HomePage.tsx   esqueletos y marcas de lo nuevo
packages/web/src/styles/{tokens,shell}.css    duraciones y animaciones
packages/web/src/i18n/es.ts                   las cadenas nuevas
```

## Estrategia de pruebas

Como en el resto del repositorio, cada criterio se mide **mutando la implementación** y viendo
fallar la prueba.

- **TTL del feed y de las tendencias**: reloj inyectable. Una lectura caducada devuelve el valor
  viejo **y** programa el refresco; con el refresco aplicado, la lectura siguiente devuelve lo
  nuevo. Mutación: volver a `if (cacheado !== null) return cacheado.value` tiene que dar fallo.
- **Un refresco que falla conserva la fila vieja**: proveedor que lanza en la revalidación. Mutación:
  borrar la fila al fallar tiene que dar fallo.
- **La relectura no se dispara antes de tiempo**: temporizadores falsos. Una vuelta a la pestaña a
  los 10 s no produce petición; a los 70 s sí. Mutación: quitar la comprobación de los 60 s da fallo.
- **La fusión conserva lo bueno**: una lectura rechazada entre cuatro buenas. Mutación: sustituir el
  valor anterior por `[]` da fallo.
- **Movimiento reducido**: la prueba de accesibilidad ya comprueba que el `@media` apaga el
  esqueleto; se extiende a las animaciones nuevas. Mutación: sacar una animación del `@media` da
  fallo.

## Success Criteria

- [ ] Con una entrada nueva en la fuente, la home la enseña sin recargar dentro del plazo del TTL.
- [ ] Volver a la pestaña antes de 60 s no produce ninguna petición nueva.
- [ ] Un fallo de relectura no vacía ninguna fila que ya tuviera contenido.
- [ ] La primera carga de la home muestra esqueletos, no una frase.
- [ ] Con `prefers-reduced-motion: reduce` no hay animaciones de entrada.
- [ ] `bun run typecheck`, `bun run lint` y `bun test` en verde, y el e2e de home sin cambios.

## Boundaries

**Always**

- Servir primero lo que hay y revalidar después: nadie espera a un tercero por un dato que ya
  existía.
- Anotar el error de una revalidación en `revalidate_error` y **no borrar** el dato viejo.
- Una lectura que falla deja su fila como estaba.
- Respetar `prefers-reduced-motion: reduce` en toda animación nueva.
- Las cadenas nuevas, en `packages/web/src/i18n/es.ts` mediante `t()`.

**Ask first**

- Cambiar la cadencia de relectura (60 s) o el TTL de feed y tendencias.
- Añadir cualquier librería de animación o de estado.
- Tocar el orden o la composición de las filas de la home.

**Never**

- Recargar la página como forma de refrescar datos (ya estaba prohibido; esta entrega es
  exactamente lo contrario).
- Salir a la red desde el cliente por un refresco: la relectura va contra la caché local.
- Animar en cada render, ni animar bajo `prefers-reduced-motion`.
- Un `setInterval` que siga corriendo con la pestaña oculta.

## Seguridad

No se añade superficie: no hay ruta nueva, ni destino nuevo para la lista blanca del proxy, ni
petición del cliente hacia fuera. La relectura usa las mismas rutas con la misma cookie `HttpOnly`.
El único efecto medible es de carga: una relectura por minuto y pestaña visible, contra SQLite
local.

## Decisiones tomadas (eran las preguntas abiertas)

1. **Relectura periódica, no SSE.** Elegido por el humano. Se declara el apartamiento de la decisión
   6 del plan y su motivo.
2. **Movimiento sutil.** Esqueletos y entrada escalonada; ni cinta en movimiento ni aviso con latido
   ni zoom en portadas.
3. **Los dos arreglos van juntos.** Refrescar el cliente sin arreglar el TTL no habría cambiado nada
   de lo que el usuario ve, y el arreglo del TTL sin relectura tampoco: el primero no se nota hasta
   la siguiente carga de la home.

## Open Questions

1. ¿60 s es la cadencia correcta, o prefieres 30 s (más vivo, el doble de lecturas locales) o 120 s
   (más tranquilo)? Se propone 60 s.
2. ¿La marca de «actualizado hace X» se enseña siempre o sólo cuando el dato viene de una relectura
   y no de la primera carga? Se propone enseñarla sólo tras la primera relectura: al abrir, «hace 0
   s» no dice nada.
3. ¿Las tarjetas nuevas se marcan de algún modo permanente (un punto) o sólo con el fundido de
   entrada? Se propone sólo el fundido: un punto permanente es un aviso que nadie limpia.

## Enmiendas propuestas a specs aprobados

| Spec | Qué se enmienda |
|---|---|
| `SPEC-web-ui.md` (reglas de la interfaz) | Se añade la relectura de la home: al volver a la pestaña y cada 60 s con la pestaña visible, con fusión sobre lo ya pintado. Se añade la regla de movimiento: esqueletos de la home y entrada escalonada, ambas suprimidas con `prefers-reduced-motion` |
| `SPEC-web-ui.md` (Contrato) | Sin cambios: no hay ruta ni forma nueva |
| `SPEC-catalog-store.md` | `RevalidateResource` pasa de tres recursos a cinco: `feed` y `trending`. Sin migración |
| `SPEC-discovery.md` | `GET /api/feed` respeta el TTL y revalida por detrás, como el resto de lecturas con caché |
| `SPEC-recsys.md` | `GET /api/trending` respeta el TTL y revalida por detrás |
| `tasks/plan.md` (decisión 6) | Se anota el alcance: «SSE en lugar de sondeo» vale para la búsqueda y mpv; la home relee. La decisión no se borra, se acota |

## Tareas

### T54 — `catalog-store` y `server`: el feed y las tendencias respetan su TTL

**Descripción:** Que las dos lecturas que la home refresca dejen de servir caché caducada para
siempre, con el `readThrough` que ya usan el detalle y los episodios.

**Aceptación:**
- [ ] `RevalidateResource` incluye `feed` y `trending`, y hay una prueba que falla si un recurso se
      anota con la clave de otro.
- [ ] `getFeed` y `getTrending` en el contenedor: acierto dentro del TTL, `miss` sin fila, y
      `stale` cuando toca, con reloj inyectable.
- [ ] Una lectura caducada **devuelve el valor viejo y programa el refresco**; la siguiente
      devuelve lo nuevo.
- [ ] Un refresco que falla conserva la fila vieja y anota el error en `revalidate_error`.
- [ ] Las rutas no cambian su comportamiento ante un proveedor que falla: lista vacía y el resto de
      la fila se pinta.
- [ ] El tope `MAX_FEED_ENTRIES` se sigue aplicando antes de escribir en la caché.

**Verificación:** pruebas de la ruta con reloj fijo y proveedor de fixture; mutación de la rama
`stale` y de la fusión, con el recuento de fallos.

**Depende de:** T50 (la ruta del feed), T41 (las tendencias).

**Archivos:** `packages/catalog-store/src/revalidate.ts`, `packages/server/src/container.ts`,
`packages/server/src/routes/{discovery,recommendations}.ts` y sus pruebas.

**Tamaño:** M.

---

### T55 — `web`: la home relee y no pierde lo que ya tenía

**Descripción:** El hook de las filas relee al volver a la pestaña y cada minuto, fusiona en vez de
sustituir, y dice cuándo se refrescó.

**Aceptación:**
- [ ] Una vuelta a la pestaña antes de 60 s no lanza ninguna petición; a partir de 60 s, sí.
- [ ] El intervalo no corre con la pestaña oculta.
- [ ] Una lectura rechazada conserva el valor anterior de esa fila; el error sólo se declara cuando
      no hay nada, de esta lectura ni de la anterior.
- [ ] `loading` es cierto sólo la primera vez; una relectura marca `refrescando` y no vacía nada.
- [ ] La marca de refresco se enseña con su texto en i18n y no con una cadena suelta.
- [ ] Todas las pruebas nuevas fallan al mutar: quitar la comprobación de los 60 s, sustituir el
      valor anterior por `[]` y hacer que el intervalo ignore la visibilidad.

**Depende de:** T54.

**Archivos:** `packages/web/src/features/home/useHomeRows.ts`, `HomePage.tsx`,
`packages/web/src/i18n/es.ts` y las pruebas del hook.

**Tamaño:** M.

---

### T56 — `web`: esqueletos y entrada escalonada

**Descripción:** Que la home se vea trabajando mientras carga y que el contenido entre con un
movimiento corto, sin librería y sin molestar a quien pidió movimiento reducido.

**Aceptación:**
- [ ] La primera carga pinta esqueletos por fila, con el `.skeleton` que ya existe, y mantiene el
      texto para lectores de pantalla.
- [ ] Las filas entran escalonadas al montar, y una relectura no reinicia la animación.
- [ ] Una tarjeta que no estaba entra con el fundido; volver a pintar lo que ya estaba no anima.
- [ ] Con `prefers-reduced-motion: reduce` no hay ninguna animación de entrada, medido en la prueba
      de accesibilidad que ya lee el `@media`.
- [ ] Las duraciones salen de `tokens.css`; ninguna regla nueva escribe un tiempo suelto.

**Depende de:** T55.

**Archivos:** `packages/web/src/features/home/HomePage.tsx`, `packages/web/src/styles/{tokens,shell}.css`,
`packages/web/src/a11y.test.ts` y, si el componente crece, un `HomeSkeletons.tsx` nuevo.

**Tamaño:** M.

## Dependencias

```
T50 ─┐
     ├─ T54 ── T55 ── T56
T41 ─┘
```

| Task | Depende de |
|---|---|
| T54 | T50, T41 |
| T55 | T54 |
| T56 | T55 |

Camino crítico: T54 → T55 → T56.
