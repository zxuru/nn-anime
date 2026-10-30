# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Una sola persona, en su equipo, con su propio historial. Hay un **Perfil** —favoritos, ya vistos e
historial—, pero no cuentas ni perfiles de varias personas. Dos maneras de llegar, que casi siempre
son la misma persona en momentos distintos:

- **Quien viene de `ani-cli`.** Ya ve anime desde la terminal y quiere lo mismo con interfaz: un
  comando levanta todo y abre la página.
- **Quien quiere ver sin cuentas ni telemetría.** Le importa que nada salga del equipo; la terminal
  es sólo el medio.

El despliegue en Docker, NAS o LAN **no es un público de primera clase**: existe para quien ya sabe
administrarlo y no arrastra decisiones de producto (sin sesiones, sin perfiles de varias personas,
sin «quién ve qué»).

Situación de uso: sentado en su máquina, abre la ventana o lanza el comando, busca o mira lo que la
home ya le enseña, elige episodio y modo sub o dub, y reproduce en la página o en `mpv`. Al volver
al día siguiente, «continuar viendo» está donde lo dejó, sin pedirle nada a la red.

## Product Purpose

Ver anime —y también películas, series y doramas— en el navegador, con una interfaz que se lanza
desde la terminal, que recomienda a partir de lo que se busca y se ve, y que guarda todo en el
equipo. **No hay servidor central, ni cuentas, ni telemetría.** De lo que se reproduce no
se guarda el vídeo, sólo metadatos, historial, favoritos y ajustes; lo único que se escribe en disco
es lo que el usuario manda descargar.

Éxito, en los términos del spec del proyecto:

1. Arranca en menos de 2 s, abre el navegador en `http://127.0.0.1:<puerto>` y muestra contenido
   útil sin ningún paso manual.
2. Se busca un anime, se ve la ficha, se elige episodio y modo sub o dub, y se reproduce dentro de
   la página o se lanza a `mpv`.
3. Las recomendaciones concuerdan con lo que se va buscando y viendo, **con una razón legible por
   recomendación**.
4. Nunca se recarga todo el contenido: sólo se persiste lo que hizo falta para funcionar.
5. Al reabrir la aplicación, el estado anterior está ahí sin volver a pedirlo a la red.

## Positioning

Lo que un vecino no puede copiar sin mentir:

- **El núcleo no trae fuentes.** Este repositorio no incluye ni un scraper: publica el contrato de
  plugin (`packages/provider-sdk`), su cargador y un fixture con datos inventados. Los proveedores
  de sitios reales viven fuera, en `nn-anime-plugins`. Es lo que permite que el repositorio sea
  publicable y la separación es deliberada, no un pendiente.
- **Todo ocurre en el equipo.** En uso local el servidor escucha en `127.0.0.1` y exige token de
  arranque; no hay cuentas ni telemetría, y los datos viven en un SQLite del usuario. El contenedor,
  que sí escucha en la red, exige `NN_ANIME_TOKEN` y deja público sólo `/healthz`.
- **La recomendación se explica.** Cada sugerencia lleva su motivo y su puntuación; se puede leer
  sin abrir nada, y la ficha repite el porqué. No hay caja negra.
- **Se comporta como `ani-cli` en el arranque.** Un comando levanta servidor e interfaz y abre la
  página. La diferencia con `ani-cli` es que hay interfaz gráfica, catálogo y motor propio.

## Operating Context

- **Cómo se usa.** `nn-anime` desde la terminal, el ejecutable instalado —una ventana propia de
  Tauri, en `desktop/`, que envuelve la misma interfaz web—, el archivo único de Windows o el
  contenedor Docker. En todos, la interfaz es la misma SPA.
- **Las fuentes se instalan a mano.** La aplicación no trae ningún proveedor de fábrica. Se copian
  plugins a `~/.config/nn-anime/providers/` o se añade un repositorio de GitHub desde **Ajustes**:
  primero se miran los archivos, después se marcan. Marcar una casilla es el momento en que ese
  código se ejecuta.
- **Qué hay instalado, si hay algo.** `mpv` se detecta al arrancar y es opcional. La parrilla y los
  episodios recién emitidos salen de la API pública de AniList, la única fuente con fecha por
  episodio; las películas y series se completan con una clave opcional de TMDB que se guarda en la
  base local y nunca se devuelve al navegador.
- **Dónde viven los datos.** Rutas XDG en Linux y macOS, `%LOCALAPPDATA%` y `%APPDATA%` en Windows,
  una sola raíz en la ventana, y `portable.txt` para llevar todo junto en Windows. Las rutas en uso
  se ven en **Ajustes**.
- **Cómo se trabaja el repositorio.** Una tarea por worktree y por rama, `tasks/plan.md` y
  `tasks/todo.md` como fuentes de verdad, Definition of Done de ocho puntos y commit atómico que
  cita el task. `typecheck`, `lint` y `test` en verde antes de cerrar. Los textos de interfaz pasan
  por el catálogo de i18n, nunca sueltos en el componente.

## Capabilities and Constraints

**Lo que hace hoy (0.4.0):** búsqueda agregada entre proveedores, ficha con temporadas y episodios,
reproductor HLS (`hls.js`) con subtítulos y `mpv` opcional, «continuar viendo», favoritos, perfil con
historial y ya vistos, motor de recomendación con motivo, top (AniList o el de la fuente), parrilla
de estrenos, novedades, conmutador de tipo anime / películas —series y doramas van por el mismo
camino—, descargas con cola, pausa, reanudación y gestión de espacio, ajustes con repositorios de
proveedores y aviso de seguridad, ventana de escritorio, Docker y las releases de las tres
plataformas.

**Restricciones que no se negocian** (si una tarea las contradice, se replantea la tarea):

- **Local primero:** sin servidor central, sin cuentas, sin telemetría. En uso local el servidor
  escucha sólo en `127.0.0.1` y exige token de arranque; el contenedor es la excepción declarada y
  exige `NN_ANIME_TOKEN`. Cualquier otra función que abra la red es opt-in, avisa en la interfaz y
  tiene su modelo de amenaza en `SECURITY.md`.
- **Sin scrapers, torrents, protocolos de pares ni alojamiento de contenido aquí.** El núcleo sólo
  define contratos y motores genéricos.
- **Los plugins se ejecutan sin sandbox**, con los permisos del usuario. El aviso va en la interfaz
  y en el README, no sólo en la documentación; simular aislamiento está prohibido.
- **Una conexión SQLite, escrituras serializadas**; una sola réplica por volumen. WAL y migraciones
  se prueban con archivo temporal, nunca en memoria.
- **Bun y TypeScript en todo el proyecto**, React 19 y Vite en la interfaz, Hono, `bun:sqlite`, Zod
  y `hls.js`. Ninguna dependencia nueva fuera de la tabla de Tech Stack del spec sin pasar por el
  límite «Ask first». El movimiento es CSS, con los tokens de la casa; GSAP no es dependencia.
- **AniList se respeta:** lista blanca de hosts, una petición cada dos segundos, caché con TTL y
  `NN_ANIME_ANILIST_OFFLINE=1` para las pruebas.
- **Compatibilidad del contrato de plugin:** `capabilities.media` ausente significa anime.
- **Idioma:** hoy la interfaz es sólo español y todo texto nuevo pasa por
  `packages/web/src/i18n/es.ts`; el inglés está planificado, no construido. Los identificadores y
  los comentarios de código van en inglés y en español respectivamente; los documentos y la interfaz,
  en español.

**Decisiones tomadas:** D1, clave opcional de TMDB con el plugin como respaldo. D2, descarga en MP4
primero (copia directa para `file`, remux con `ffmpeg` para HLS, segmentos locales si no hay
`ffmpeg`), para que lo descargado se pueda abrir fuera de nn-anime.

**Sin decidir, y por eso no se implementa sin preguntar:** el lector de manga (fase 2A; el tipo
`manga` ya está en el modelo, y la propuesta es CBZ para lo descargado), el watch party (fase 3; la
recomendación es WebRTC con señalización manual, por respetar «sin servidor central») y el formato
de esa señalización. Ninguna de las dos fases está abierta.

## Brand Commitments

- **Nombre:** nn-anime, `zxuru/nn-anime`, paquetes `@nn-anime/*`, binario `nn-anime`.
- **Voz:** español directo, sin superlativos ni lenguaje de marketing. Los documentos dicen lo que
  falla, lo que no se midió y lo que se retiró, con el motivo. Un cambio que se descarta se explica
  en vez de borrarse en silencio.
- **La promesa pública se dice en la interfaz, no sólo en el README:** todo local, sin cuentas, sin
  telemetría, y plugins sin sandbox.
- **Nada de cifras inventadas.** No hay clientes, ni testimonios, ni prensa, ni usuarios contados; no
  se fabrican. Las capturas que se publiquen salen del arnés de pruebas y se declaran como tales.

## Evidence on Hand

- `docs/captura.png`: la home real en tema oscuro, sacada del arnés de e2e con el plugin de
  ejemplo. Las portadas son degradados porque el fixture apunta a `fixture.invalid`, que no existe.
- `packages/providers-fixture`: doce títulos inventados. No hay contenido, ni proveedores reales, ni
  datos de terceros en el repositorio.
- `README.md`, `SECURITY.md`, `docs/*.md`, `docs/specs/*` y `tasks/*`: comportamiento, riesgo
  residual, decisiones y verificación medida.
- `docs/v1-report.md`: el informe de v1 con lo que se probó y los cinco fallos de medición que
  aparecieron por el camino.
- **Ausencias que no se rellenan:** no hay testimonios, clientes, métricas de uso, prensa, precios
  ni certificaciones. Las releases pueden salir sin firma, con las advertencias del sistema, y el
  README lo explica en vez de maquillarlo.

## Product Principles

1. **Lo local es el contrato, no una opción.** Nada sale del equipo sin que el usuario lo pida; una
   función que abre la red nace opt-in, avisada y con su modelo de amenaza.
2. **El núcleo no trae fuentes.** El contrato de plugin y el fixture sostienen el repositorio; las
   fuentes son de quien las escribe y las ejecuta.
3. **La recomendación se explica.** Toda sugerencia lleva su motivo; un motor que no puede decir por
   qué recomienda no se muestra.
4. **Ningún estado se queda en blanco.** Vacío, cargando y fallo son parte del producto: si no hay
   fuente para esa mitad del catálogo, la pantalla lo dice.
5. **El riesgo residual se declara.** Lo que no se mitiga se documenta como tal, en `SECURITY.md` y
   en la interfaz; esconderlo sería cambiar el producto.
6. **Lo que no se midió no está hecho.** Cada criterio se marca con la medición que lo sostiene, y
   una prueba que pasa con el código roto no mide nada.

## Accessibility & Inclusion

- **Contraste WCAG 2.1 medido en los dos temas**, por `packages/web/src/a11y.test.ts`: 4.5:1 en
  texto normal y 3:1 en partes de componente. El tema claro redefine todo lo que define el oscuro.
- **Foco visible de teclado**, con anillo de dos píxeles y separación por tokens; ningún `:focus` a
  secas que lo dibuje también al hacer clic.
- **Movimiento reducido respetado:** con `prefers-reduced-motion: reduce` las transiciones y los
  tokens de entrada valen `0 ms` y el esqueleto deja de latir. Una animación propia lleva su propio
  apagado.
- **Nombres accesibles y anuncios:** todo botón y enlace tiene nombre; hay regiones `aria-live` en
  los resultados de búsqueda y en el estado del reproductor; los diálogos usan `<dialog>` nativo con
  `showModal`, y los atajos no secuestran el teclado cuando se escribe.
- **Medidas:** los mandos no bajan de 44 px y no hay desbordamiento horizontal entre 320 y 1920 px,
  medido en navegador.
- **Límites declarados:** el recorrido completo con teclado se prueba en el e2e, no en `bun test`; los
  lectores de pantalla no se automatizan; el contraste se mide sobre tokens, no sobre el píxel
  renderizado, y un modo de alto contraste del navegador puede cambiarlo.
