# Mejoras pendientes del scraper (post-análisis Scrapling)

Origen: [`docs/analisis-migracion-scrapling.md`](../docs/analisis-migracion-scrapling.md) — análisis
del 2026-11-08 sobre si migrar los proveedores a Scrapling. **Estado: pendiente de abrir**; ninguna de
estas tareas está aprobada ni empezada.

Decisiones que fija el análisis:

1. **No se migra el scraper a Scrapling** (ni completo ni como dependencia de la app). Las razones y el
   coste están en el informe; la condición para reabrir la decisión está al final de este archivo.
2. Lo que sí se hace es **corregir y medir** el scraper actual. Es barato, va en los dos repositorios
   que ya existen y no añade runtime.
3. Los ids de task **se asignan al abrir**, no se reservan aquí (`tasks/roadmap.md`); en esta tabla se
   numeran como `M1`–`M6` sólo para poder citarlos.

Rige el **Definition of Done** de [`tasks/plan.md`](plan.md) para lo que toque este repositorio: `bun run
typecheck`, `bun run lint` y `bun test` en verde, criterios marcados **con la medición que los sostiene**,
sin `any` implícito ni `@ts-ignore` ni `as` para silenciar, sin tests saltados, y commit atómico que cita
el task. Lo que toque el repo de proveedores (`zxuru/nn-anime-plugins`) cumple además su
`scripts/hashes.sh` y su CI de seguridad.

## Las tareas

| # | Tarea | Repo | Depende de | Tamaño | Prioridad |
|---|---|---|---|---|---|
| **M1** | `jkanime`: el slug con puntos pierde tarjetas | plugins | — | S | Alta (fallo medido) |
| **M2** | Fixtures reales y tests de parseo por proveedor | plugins | M1 | M | Alta |
| **M3** | `429`/`Retry-After` genérico por dominio en el motor | app | — | M | Alta |
| **M4** | Telemetría de fallos por proveedor y método | app | — | M | Media |
| **M5** | Evaluar `parse5`/`cheerio` para las fuentes HTML | plugins | M2 | S (spike) | Media |
| **M6** | *(condicional)* Spike de navegador en TypeScript, fuera del release | app (rama) | M2 y decisión humana | M/L | Baja, sólo si se quiere ampliar catálogo |

---

### M1 — `jkanime`: el slug con puntos pierde tarjetas

**Descripción:** en la búsqueda de jkanime, `slugDe()` sólo acepta `[a-z0-9-]`; un título cuyo slug
lleva puntos (`https://jkanime.net/naruto-...-vs.-konohamaru/`) se descarta en silencio. El PoC lo
midió: **22 tarjetas con la regex actual frente a 23 con un parser CSS sobre el mismo HTML**. Es un
fallo de datos que ningún test detecta porque no hay fixtures reales.

**Aceptación:**
- [ ] `slugDe()` acepta los puntos (y cualquier carácter que el sitio use de verdad en un slug) sin
      romper los slugs actuales; se decide explícitamente qué caracteres entran y se documenta el porqué.
- [ ] Test nuevo con un fixture del HTML real de `/buscar/<término>/` que devuelve **23** referencias.
- [ ] **Mutación**: revertir el arreglo hace fallar el test (y no por un `expect` frágil, por el conteo).
- [ ] `bun test` del repo de plugins en verde y `sh scripts/hashes.sh` regenerado en el mismo commit.

**Archivos:** `providers/jkanime.ts`, `tests/…` y el fixture nuevo. Repo de proveedores, no éste.

**Tamaño:** S. **Depende de:** nada.

---

### M2 — Fixtures reales y tests de parseo por proveedor

**Descripción:** hoy **ninguna prueba parsea HTML/JSON real** de los seis sitios; sólo hay fetch
simulado y conformidad. Un cambio de marcado se descubre en el salón, no en CI. Esta tarea crea la red
de seguridad: capturar una respuesta por método y por proveedor, sanearla (sin datos personales ni
tokens), guardarla como fixture y comprobar campos y cardinalidad.

**Aceptación:**
- [ ] Cada uno de los seis proveedores tiene al menos un fixture por método implementado
      (`search`, `getAnime`, `getEpisodes`; `resolveStream` con un embed ya resuelto cuando se pueda).
- [ ] Los fixtures van sin credenciales, sin cookies de sesión y sin datos de usuario; se documenta
      cómo se capturaron y con qué fecha.
- [ ] Los tests fallan si un campo obligatorio desaparece o si el número de resultados cambia sin
      actualizar el fixture (con el conteo esperado explícito, no un `> 0`).
- [ ] **Mutación por proveedor**: romper a mano un selector/regex hace fallar su test.
- [ ] CI del repo de proveedores ejecuta esta suite en cada push.

**Archivos:** `tests/parseo/*.test.ts` y `tests/fixtures/*` en el repo de proveedores.

**Tamaño:** M (6 proveedores). **Depende de:** M1 (el fixture de jkanime ya se escribe ahí).

---

### M3 — `429`/`Retry-After` genérico por dominio en el motor

**Descripción:** hoy el único manejo de límite de tasa es un `sleep` de 65 s **dentro** del plugin de
jkanime, en memoria y por proceso; el motor no tiene política por dominio. Un `429` de otra fuente no
se obedece y el plugin puede seguir martillando. Se mueve al motor: leer `Retry-After` (con tope), aplicar
una espera por dominio compartida entre llamadas y **no bloquear la búsqueda entera** —los demás
proveedores siguen respondiendo—.

**Aceptación:**
- [ ] La capacidad de red (`media-proxy`) obedece `Retry-After` en `429` y `503` con tope configurable
      (propuesta: 60 s) y un solo reintento; el segundo `429` se devuelve como error del proveedor.
- [ ] La espera es **por dominio** y compartida: una petición posterior al mismo dominio dentro de la
      ventana no sale a la red y devuelve error tipado con el motivo.
- [ ] La búsqueda agregada no se bloquea: un proveedor en espera no retrasa a los demás (test con reloj
      falso y dos proveedores).
- [ ] El `sleep` de 65 s de `jkanime.ts` desaparece; su 429 se explica por el mensaje del motor.
- [ ] **Mutación**: quitar el respeto del `Retry-After` hace fallar el test del reintento único.

**Archivos:** `packages/media-proxy/src/plugin-fetch.ts` (o el punto donde se construye la capacidad),
`packages/server` si el contador de dominio vive ahí, tests de ambos, y `providers/jkanime.ts` en el
repo de proveedores.

**Tamaño:** M. **Depende de:** nada.

---

### M4 — Telemetría de fallos por proveedor y método

**Descripción:** no hay forma de saber si un proveedor está roto sin abrir la app y probar. Se registran
contadores por proveedor y método (llamadas, fallos por `kind`, último mensaje, última latencia) y se
exponen donde ya se ven los proveedores (`/api/providers` y Ajustes). Es lo que permite decidir con datos
y no con impresiones.

**Aceptación:**
- [ ] Contadores en memoria con reinicio limpio (no hace falta persistirlos en SQLite; si se persisten,
      con poda y sin crecer sin límite).
- [ ] `/api/providers` incluye el resumen y la interfaz lo muestra en Ajustes → Proveedores.
- [ ] Un fallo de proveedor queda contado con su `ProviderFailureKind`; un `stale` servido desde caché
      no cuenta como fallo.
- [ ] Test con proveedor falso: 3 llamadas, 1 fallo, y el resumen devuelve exactamente eso.
- [ ] **Mutación**: dejar de contar un `kind` hace fallar el test del resumen.

**Archivos:** `packages/server/src/container.ts` y/o `provider-hub.ts`, `routes/providers.ts`,
`packages/web/src/features/settings/*`, `packages/web/src/i18n/es.ts` (textos), tests.

**Tamaño:** M. **Depende de:** nada.

---

### M5 — Evaluar `parse5`/`cheerio` para las fuentes HTML

**Descripción:** tres proveedores (`gnula`, `jkanime`, `pelisplushd`) parsean HTML a base de regex. El
PoC mostró que un parser estructural encuentra más y se mantiene mejor. Antes de adoptarlo, medir: peso
en el bundle, velocidad frente a regex y cuántos puntos de código se simplifican.

**Aceptación:**
- [ ] Spike en rama: `cheerio` (o `parse5` + selectores) sustituye las regex de **un** proveedor, el de
      peor mantenimiento, con los fixtures de M2 en verde.
- [ ] Medido y anotado: bytes añadidos al bundle del proveedor, tiempo de parseo frente a la regex y
      líneas eliminadas. Criterio de adopción propuesto: ≤ +10 MB y sin regresión de velocidad > 2×.
- [ ] Decisión escrita en este archivo (adoptar / no adoptar / sólo en un proveedor) con el número que
      la sostiene; si se adopta, se abre la tarea de migrar los otros dos.
- [ ] Sin `any` ni `as` para silenciar; los tipos de los selectores se declaran.

**Archivos:** `providers/<el peor>.ts` y su test; `package.json` del repo de proveedores (hoy con **cero
dependencias** — esto lo cambia y es parte de la decisión).

**Tamaño:** S. **Depende de:** M2.

---

### M6 — *(condicional)* Spike de navegador en TypeScript, fuera del release

**Descripción:** sólo se abre si el humano decide que el objetivo es **ampliar catálogo** (resolver los
reproductores que hoy se descartan por no ejecutar JS/WASM: 4 de 6 servidores de `cuevana3`, varios de
`gnula`, y los subtítulos de SubDivX). El spike usa **Patchright/Playwright en TypeScript**, en una rama,
**sin entrar en el build de release**, y responde una sola pregunta: ¿cuántos episodios que hoy fallan se
resuelven abriendo un navegador real?

**Aceptación:**
- [ ] 20 episodios de las fuentes problemáticas: **≥ 80 % resueltos**, p95 < 6 s por resolución.
- [ ] 0 regresiones en los seis proveedores actuales (suite completa en verde).
- [ ] Medido y anotado: RAM pico, tiempo de arranque del navegador, tamaño en disco del Chromium.
- [ ] Decisión escrita: (a) no hay hueco, se cierra el tema; (b) hay hueco y se propone worker opcional
      (arquitectura O4 del informe) con su propio task; (c) hay hueco pero no compensa el coste.
- [ ] Nada de esto se mezcla en `main` hasta que haya decisión y task abierto.

**Archivos:** rama aparte, sin tocar el árbol de release; como mucho, un `docs/` con el resultado.

**Tamaño:** M/L. **Depende de:** M2 y de la decisión del humano sobre el punto 1 de «Preguntas abiertas»
del informe.

---

## Descartado por ahora (y cuándo se reabre)

**Migrar a Scrapling** (sidecar Python empaquetado, Python del sistema/MCP, o híbrido con Python). Se
reabre sólo si se cumplen las tres condiciones del informe §1:

1. el objetivo real pasa a ser «resolver cualquier reproductor con navegador»;
2. se acepta un instalador de ~155–235 MB **o** una descarga opcional de ~500 MB;
3. se acepta firmar y actualizar ese árbol de binarios en Windows y Linux (y perder el móvil, si el móvil
   es requisito).

Si se reabre, la arquitectura preferida **no es la de Scrapling en Python**: es un worker en TypeScript
con Patchright, por las razones del informe §5.2. Scrapling sigue siendo útil **fuera de la app** (CLI o
MCP) para investigar fuentes y para medir el hueco de M6.

## Orden sugerido

1. **M1** (una tarde; corrige un fallo medido y estrena el primer fixture).
2. **M3** y **M4** en paralelo (motor; no dependen de nadie).
3. **M2** con los fixtures que M1 y M3 hayan necesitado.
4. **M5** cuando M2 esté en verde.
5. **M6** sólo con decisión explícita.

## Cómo se cierra

Cada tarea, al abrirse, recibe su id de task y se apunta en `tasks/todo.md` **por el integrador**, como
cualquier otra; este archivo es la propuesta, no el tablero. Al cerrar, el fragmento va a
[`tasks/done/`](done/README.md) con el formato de allí y el commit que lo sostiene.
