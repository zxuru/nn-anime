# Spec: web-ui
> **Los criterios de esta lista no son el registro que se mantiene.** El trabajo se cierra contra la
> aceptación de cada tarea en `tasks/todo.md`, que está marcada **y medida mutando la implementación**;
> esta lista es el contrato —el *qué*— y duplica aquélla. Se decidió en el Checkpoint H: mantener dos
> listas de lo mismo acaba con una de las dos mintiendo, y la que mintió durante la v1 fue ésta.


Module id: `web-ui` · Depende de: la superficie HTTP de `provider-core`, `catalog-store`,
`media-proxy` y `recsys` · Paquete: `packages/web`
Convenciones heredadas de `SPEC-nn-anime.md`.

## Objective

Dar al usuario la misma experiencia que ani-cli pero con interfaz: llegar, buscar, ver,
continuar y recibir recomendaciones. Sin recargar la página y sin recargar el contenido.

Éxito significa:

1. Abrir la URL de arranque muestra una home con contenido útil en menos de 1 s, servida de la
   base local cuando ya existe.
2. Buscar no recarga la página: los resultados aparecen de forma incremental, por proveedor.
3. Se ve el video en la página, o se lanza a mpv con un clic, con sub o dub y con subtítulos.
4. El panel de recomendaciones explica cada sugerencia y reacciona a lo que el usuario busca.
5. Toda la interfaz es navegable con teclado y no rompe con `prefers-reduced-motion`.

## Contrato

Superficie HTTP que la UI consume. La implementa `server` componiendo los otros módulos.

**Las formas de estas respuestas no se declaran aquí ni se escriben dos veces.** Viven en
`packages/core/src/api.ts`, que es también lo que el server usa para construirlas. Este documento
nombra las rutas y para qué sirven; la forma exacta de cada cuerpo es un schema compartido.

```
GET  /api/health                     estado, versión, mpv disponible, proveedores activos
GET  /api/providers                  proveedores cargados y sus capabilities
GET  /api/search?q=&provider=        SSE: resultados por proveedor a medida que llegan
GET  /api/anime/:providerId/:ref     detalle, con Cache-Control y cabecera X-Cache
GET  /api/anime/:providerId/:ref/episodes
POST /api/stream/resolve             body: { episodeRef, mode } -> StreamSource sin headers
GET  /stream/:ticket                 proxy de bytes (media-proxy)
POST /api/play/mpv                   lanzar mpv
GET  /api/recommendations?limit=     ranking con razones
GET  /api/feed?limit=                novedades de la fuente, con su fecha
GET  /api/catalog/recent?limit=      lo último que la aplicación ya conoce
GET  /api/history?limit=             vistos recientemente
POST /api/watch                      registrar inicio de reproducción
PATCH /api/watch/:id                 actualizar posición
GET  /api/favorites   POST /api/favorites
GET  /api/settings    PATCH /api/settings
GET  /api/cover/:providerId/:ref     portada, servida por el proxy
```

Rutas de la SPA, todas del lado del cliente salvo la primera:

```
/                      home: recomendaciones, el top de la fuente, novedades,
                       último añadido, continuar, favoritos y géneros
/search?q=             búsqueda incremental
/anime/:providerId/:ref
/watch/:providerId/:ref
/settings              proveedores, rutas de datos, tema
```

Reglas de la interfaz:

- **Sin recarga completa.** Enrutado del lado del cliente. Cambiar de vista no vuelve a pedir lo
  que ya está en el caché de la sesión.
- **Caché de sesión por clave de URL.** Un `Map` de promesas, con deduplicación: dos componentes
  que piden lo mismo hacen una sola petición. Los datos del servidor ya vienen cacheados; esto
  sólo evita repetir la llamada dentro del mismo render.
- **Carga incremental.** La búsqueda pinta resultados por proveedor en cuanto llegan, con
  esqueletos por proveedor. La grilla nunca espera al proveedor más lento.
- **Prefetch acotado.** Sólo el detalle de las tarjetas visibles, al pasar el mouse, con
  `AbortController` al salir. Nunca el catálogo.
- **Grillas virtualizadas** cuando superan 60 elementos.
- **Recomendaciones explicables.** Cada tarjeta del panel muestra la razón principal en texto y
  las demás en el `title`. Hay un botón para abrir el detalle del score.
- **Búsqueda alimenta la recomendación.** El panel de recomendaciones se refresca al cambiar la
  consulta, con debounce de 400 ms y cancelación de la petición anterior.

Accesibilidad, mínimos verificables:

- Todo control alcanzable por `Tab` en orden lógico, con anillo de foco visible propio.
- Tarjetas como enlaces reales, no `div` con `onClick`.
- `aria-live="polite"` en la región de resultados de búsqueda y en el estado del reproductor.
- Contraste mínimo 4.5:1 en texto normal, 3:1 en texto grande, verificado en la paleta.
- Animaciones suprimidas bajo `prefers-reduced-motion: reduce`.
- Reproductor: subtítulos activables, `Enter` y `Espacio` para pausa, flechas para ±10 s.
- La página no atrapa atajos globales cuando el foco está en un campo de texto.

Estado de la UI: servidor como fuente de verdad, estado local sólo para lo efímero (consulta
actual, panel abierto, preferencia de tema). Sin librería de estado global en v1.

## Estructura del módulo

```
packages/web/
├─ index.html
├─ vite.config.ts
├─ src/
│  ├─ main.tsx
│  ├─ router.tsx                 enrutado del lado del cliente
│  ├─ api/client.ts              fetch con token, deduplicación y cancelación
│  ├─ api/stream-events.ts       consumo de SSE de búsqueda y de mpv
│  ├─ features/home/
│  ├─ features/search/
│  ├─ features/detail/
│  ├─ features/player/           hls.js, subtítulos, sub/dub
│  ├─ features/recommendations/
│  ├─ features/settings/
│  ├─ components/                tarjeta, grilla virtualizada, esqueleto, diálogo
│  ├─ styles/tokens.css          color, espaciado, tipografía, radios
│  └─ i18n/                      es.ts ahora; en.ts y otros idiomas después
└─ e2e/                          Playwright contra providers-fixture
```

## Success Criteria

- [ ] Con la base ya poblada, la home pinta contenido antes de 1 s y `X-Cache` es `hit`.
- [ ] Buscar "naruto" muestra resultados parciales sin recargar y sin bloquear la interfaz.
- [ ] Desconectar un proveedor no deja la grilla en esqueleto para siempre.
- [ ] Un mp4 de fixture se reproduce en la página y adelantar 30 s funciona.
- [ ] Elegir subtítulo en español muestra el texto sobre el video.
- [ ] Cambiar de sub a dub vuelve a resolver el stream y reinicia en la misma posición.
- [x] Un clic en "ver en mpv" abre la ventana de mpv; con mpv ausente se muestra el aviso y se
      ofrece el reproductor web. **Medido en el navegador**: el clic manda el cuerpo del handoff y el
      servidor contesta 202 con el `pid`, y la pantalla lo dice. El 503 por mpv ausente se pinta con
      el mensaje del servidor, que es el que dice qué pasa y qué hacer; esa parte tiene prueba propia,
      medida mutando la implementación. **Lo que no mide esta pantalla** es que la ventana de mpv
      llegue a abrirse: eso es del handoff y lo mide T29 con mpv real.
- [ ] Cada recomendación de la home muestra su razón en texto legible.
- [ ] `bun run e2e` cubre home, búsqueda, detalle, recomendaciones y arranque del reproductor, y
      pasa sin red externa.
- [ ] Un recorrido completo por teclado permite llegar a buscar, elegir un título y reproducir,
      sin usar el mouse.
- [ ] Con `prefers-reduced-motion: reduce` no hay animaciones de esqueleto ni transiciones.
- [ ] Toda respuesta de la SPA trae `Content-Security-Policy`, `X-Content-Type-Options: nosniff`,
      `Referrer-Policy: no-referrer` y `X-Frame-Options: DENY`.
- [ ] Un título de proveedor con `javascript:` como URL de portada se renderiza como texto plano
      y no produce ningún `href` ni `src` ejecutable.
- [ ] Ninguna petición de la SPA sale hacia un origen externo: el e2e falla si detecta una.

## Boundaries

**Always**

- Confiar en la cookie `HttpOnly` para la sesión: el cliente nunca lee, escribe ni guarda el
  token. Toda llamada usa `credentials: 'same-origin'`.
- Validar toda URL que venga de un proveedor con una lista blanca de esquemas `http` y `https`
  antes de usarla en `href` o `src`. Si no pasa, se renderiza como texto plano.
- Tratar todo dato de proveedor como hostil: título, sinopsis, géneros y URLs.
- Cancelar la petición anterior cuando cambia la consulta o se desmonta la vista.
- Mostrar el precio real de cada acción: spinner para revalidar, aviso cuando un proveedor falla.
- Centralizar el color, el espaciado y el radio en `tokens.css`. Sin valores sueltos.
- Escribir las cadenas de la interfaz en `i18n/<locale>.ts` mediante `t()` de `core`, nunca
  incrustadas en el JSX. Añadir un idioma no debe tocar ningún componente.

**Ask first**

- Añadir una librería de UI, de estado o de animación.
- Añadir una vista nueva con datos de un tercero.
- Incrustar una miniatura o un recurso remoto directamente, en lugar de pasar por el proxy.
- Cambiar los valores de la paleta.

**Never**

- Usar `dangerouslySetInnerHTML` con datos de un proveedor: las sinopsis vienen de fuera.
- Escribir, leer o borrar cookies desde JavaScript.
- Incrustar un recurso remoto directamente: portadas, subtítulos y video pasan por el proxy. Las
  portadas van por `GET /api/cover/:providerId/:ref`: el cliente manda una referencia, nunca una
  dirección, así que el navegador no puede convertirse en un proxy hacia donde quiera. La referencia
  se codifica con `encodeURIComponent` antes de componer la ruta: puede contener barras, y sin
  escapar la ruta daría 404.
- Construir un `href` o un `src` con una URL de proveedor sin pasar por la lista blanca de
  esquemas.
- Cargar un iframe o script de un dominio externo.
- Bloquear el hilo principal con trabajo de decenas de milisegundos por render.
- Recargar la página como forma de refrescar datos.

## Open Questions

1. ¿Tema oscuro por defecto con opción clara, o sólo oscuro en v1? Se propone oscuro por defecto
   y claro disponible.
2. ¿La fila "continuar viendo" muestra la posición exacta o sólo el porcentaje? Decisión cerrada
   en el spec de proyecto: se registra la posición, sin reanudación automática en v1.
3. ¿Se muestran los resultados de proveedores distintos como listas separadas o fusionados en
   una sola grilla con etiqueta de origen? Se propone grilla única con etiqueta, para no
   duplicar interfaz.
