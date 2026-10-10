# Spec: web-ui

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
GET  /api/history?limit=             vistos recientemente
POST /api/watch                      registrar inicio de reproducción
PATCH /api/watch/:id                 actualizar posición
GET  /api/favorites   POST /api/favorites
```

Rutas de la SPA, todas del lado del cliente salvo la primera:

```
/                      home: recomendaciones, continuar, favoritos, tendencias
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
- [ ] Un clic en "ver en mpv" abre la ventana de mpv; con mpv ausente se muestra el aviso y se
      ofrece el reproductor web.
- [ ] Cada recomendación de la home muestra su razón en texto legible.
- [ ] `bun run e2e` cubre home, búsqueda, detalle, recomendaciones y arranque del reproductor, y
      pasa sin red externa.
- [ ] Un recorrido completo por teclado permite llegar a buscar, elegir un título y reproducir,
      sin usar el mouse.
- [ ] Con `prefers-reduced-motion: reduce` no hay animaciones de esqueleto ni transiciones.

## Boundaries

**Always**

- Enviar el token de sesión en toda llamada a `/api/*` y `/stream/*`.
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
- Guardar el token de sesión en `localStorage` ni en una cookie persistente.
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
