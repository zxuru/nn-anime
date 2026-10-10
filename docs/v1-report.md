# Informe de v1

Cierre de la v1 de nn-anime: qué está cumplido, qué se difirió con qué motivo, qué falla y qué
hallazgos quedan abiertos. Los números están medidos, no estimados.

## Números

| Qué | Valor | Cómo se mide |
|---|---|---|
| Pruebas | **1450, 0 fallos** | `bun test` |
| Archivos de prueba | 74 unitarios + 5 de e2e | — |
| Cobertura | `core 98,16 %`, `catalog-store 95,84 %`, `recsys 99,65 %`, `provider-sdk 99,78 %` | `bun run coverage:gate` |
| e2e | 14 verdes, 2 marcados como pendientes, 2 del modo fallo | `bun run e2e` y `bun run e2e:fallo` |
| Tipos | 0 errores | `bun run typecheck` |
| Estilo | 0 hallazgos | `bun run lint` |
| Tareas | **55 de 55** | `tasks/plan.md` |

El gate de cobertura **discrimina**, y está comprobado: con el objetivo por defecto sale con 0, con
`0.99` sale con 1 y con un objetivo inválido, con 2.

## Auditoría de trazabilidad spec ↔ plan

Se recorrieron los requisitos normativos del spec —objetivos, arranque, contratos, tablas de TTL y de
modelo, Boundaries y Seguridad— y se comprobó cada uno contra el código y sus pruebas.

### Cumplido

| Requisito | Dónde está | Dónde se prueba |
|---|---|---|
| Arranque con token de un solo uso y apertura del navegador | `packages/cli/src/boot.ts` | `boot.test.ts`, y en vivo en T8 |
| Sesión en cookie `HttpOnly; SameSite=Strict` | `packages/server/src/session.ts` | `tests/seguridad.test.ts` (M2, M3) |
| Guards de `Host`, `Origin` y sesión en toda ruta | `packages/server/src/middleware/` | `tests/seguridad.test.ts` (M1, M2, M4), por tabla de rutas |
| CSP, `nosniff`, `Referrer-Policy`, `X-Frame-Options`, sin CORS | `middleware/security-headers.ts` | `tests/seguridad.test.ts` (M5) |
| Lista blanca de destinos, revalidada por salto | `media-proxy/src/destination-guard.ts` | `destination-guard.test.ts`, `tests/seguridad.test.ts` (M8) |
| Tickets opacos, tope de 500, vida de 600 s | `media-proxy/src/ticket-store.ts` | `ticket-store.test.ts` |
| Proxy de bytes con `Range`, sin acumular el cuerpo | `media-proxy/src/byte-proxy.ts` | `byte-proxy.test.ts` (200 MB y el RSS) |
| Saneamiento de cabeceras y tipo forzado | `media-proxy/src/response-headers.ts` | `response-headers.test.ts`, `tests/seguridad.test.ts` (M6, M7) |
| Reescritura de HLS: variantes, claves, discontinuidad | `media-proxy/src/hls.ts` | `hls.test.ts` con fixtures versionados |
| Subtítulos: proxy y conversión `srt`→`vtt` | `media-proxy/src/subtitles.ts` | `subtitles.test.ts` |
| `mpv` sin inyección de argumentos y sin huérfanos | `media-proxy/src/mpv.ts`, `mpv-args.ts` | `mpv.test.ts`, `mpv-args.test.ts`, y en vivo |
| Motor: afinidad, IDF, decaimiento, co-visita, búsqueda, filtros, MMR, razones | `recsys/src/` | 131 pruebas del paquete |
| `recommend()` determinista y con presupuesto | `recsys/src/recommend.ts` | `recommend.test.ts` (500 registros y 5000 candidatos en 40 ms) |
| Rutas de la API y su caché con `X-Cache` | `server/src/routes/`, `cache-read.ts` | `tests/ciclo-completo.test.ts` |
| Base de datos, migraciones, cola de escritura, prune | `catalog-store/src/` | 142 pruebas del paquete |
| Interfaz: búsqueda por SSE, detalle, reproductor, ajustes, home | `web/src/features/` | 269 pruebas de la web + 14 de e2e |
| Accesibilidad: foco, contraste, movimiento reducido, nombres | `web/src/styles/`, `a11y.test.ts` | `a11y.test.ts` |
| Documentación y empaquetado | `README.md`, `docs/`, `packages/cli/package.json` | `packages/web/src/docs.test.ts` |

### Huecos encontrados, con su estado

| Hueco | Qué es | Estado |
|---|---|---|
| **`revalidate_error` no está en el spec** | La migración `0003` añadió una tabla que el Data Model del spec no lista: son **11** tablas y el spec dice 10 | Anotado aquí. **Decisión pendiente** para el Checkpoint H: o se documenta la tabla o se quita |
| **La tabla `genre` no se escribe nunca** | Se crea en `0001`, `prune` la limpia y **nadie inserta en ella**: los géneros viven en `raw_json`, que es lo único que los conserva en orden | Anotado. Arreglarlo —poblarla o quitarla— es una decisión de esquema |
| **Las tendencias no se cachean** | La segunda carga de la home **vuelve a llamar a `getTrending`**: el criterio de éxito dice «sin llamadas de red» y esto es una llamada | **Medido** en `tests/ciclo-completo.test.ts`. No hay TTL de tendencias en la tabla del spec; añadirlo es una decisión de producto |
| **El guard de `Host` acepta `localhost`** | Las cookies ignoran el puerto: otra aplicación local en `localhost:OTRO_PUERTO` es el mismo sitio y podría leer la sesión | Anotado con las dos opciones. **Decisión de producto** |
| **Los ocho criterios de éxito del spec** | Siete verificados y marcados en el propio spec; uno (**home sin llamadas de red**) queda con el matiz de las tendencias | Ver abajo |

## Lo que no está verificado, y por qué

| Criterio | Motivo |
|---|---|
| El reproductor reproduce y el salto funciona | **`play()` deja el elemento en pausa y en el segundo cero.** Medido: el elemento recibe el medio, lo almacena y queda listo, y un `<video>` creado a mano con la misma URL **sí reproduce**. El entorno puede y nuestro componente no. Dos casos marcados con `test.fixme` |
| Los subtítulos aparecen en el reproductor | Depende del caso anterior: sin reproducción no hay subtítulo que enseñar |
| El aviso de mpv ausente | Hace falta arrancar el servidor del e2e con mpv simulado como ausente, y esa variable no existe |
| La home pinta antes de 1 s con `X-Cache: hit` | Es una medición de navegador con la pestaña de red; las tres lecturas van en paralelo y ninguna bloquea a las otras, pero el número no está medido |
| El recorrido completo con teclado | Necesita un navegador; lo que sí está probado es que los atajos no secuestran la escritura y que el anillo de foco existe |
| Con `mpv` real, control por SSE y cierre | **Sí medido**: mpv abre, sus eventos salen por SSE y tras `close()` el pid ya no existe |

## Diferido, con motivo

| Qué | Por qué |
|---|---|
| `downloads` (v1.5) | Aprobado como v1.5, no entra en v1 |
| `metadata-enrichment` (AniDB) | Falta verificar sus términos de uso y el registro de cliente de su API |
| Bandera `--cache-dir` | No está en la tabla de comandos del spec |
| Catálogo en inglés | La interfaz es en español; traducirla es trabajo de producto, no de v1 |
| Localización de Zod al español (`z.locales.es()`) | Medido y funcionando, pero cambia el texto de todos los errores: se decide con el catálogo |
| Playlists HLS en vivo y `#EXT-X-BYTERANGE` | Fuera de v1 por decisión del Checkpoint F, registrada en `docs/PLAN-B-HLS.md` |
| Compilar un artefacto del servidor y el CLI | `bun run build` construye la interfaz; el servidor y el CLI corren con Bun. El motivo, en el README |

## Hallazgos de método: comprobaciones que no medían lo que decían

**Cinco casos**, y los cinco se encontraron comprobando criterios, no escribiendo pruebas nuevas. Se
anotan porque son el patrón de fallo más repetido del proyecto:

1. **T29** — la comprobación de los argumentos de `mpv` pasaba con el `stderr` sin recortar.
2. **T39** — «hay un `setTimeout`» en el código: sobrevivía a quitar el retardo. Se separó el
   planificador y ahora se prueban relojes de mentira.
3. **T42** — la comprobación de nombres accesibles usaba una expresión regular y `onClick={() => act('x')}`
   lleva un `>` dentro: **un botón sin nombre pasaba la prueba**.
4. **T44** — «la consulta viaja» en la petición: el servidor la ignoraba. Se comprobaba que viajara, no
   que sirviera de algo.
5. **T46** — la comprobación de comandos del README leía `bun run e2e` como `bun run e`.

**Y dos mutaciones que sobrevivieron a la primera pasada** y se cazaron reforzando pruebas: el bonus
por estudio de T33 (medido con un coseno que no era cero) y el término de diversidad de T36 (el azar
del desempate ya dejaba un título distinto arriba).

## Cómo comprobarlo

```bash
bun install && bun run build && bun test && bun run e2e
```

Los cuatro comandos en un clon limpio, sin red salvo la instalación de dependencias.
