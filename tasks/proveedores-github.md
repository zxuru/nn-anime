# Proveedores desde un repositorio de GitHub

Origen: hoy un proveedor entra de tres maneras —copiar un archivo a mano al directorio de plugins, el
formulario declarativo de Ajustes, o el fixture del repositorio— y ninguna sirve para lo que pidió el
usuario: **traer los proveedores de un repositorio y elegir cuáles se activan de cada uno**. Un repo
con tres scrapers obliga hoy a copiar tres archivos a mano y a saberse sus dependencias.

Decisiones tomadas con quien pidió el cambio:

1. **Sólo repos públicos, sin token.** Ni secretos que guardar ni cabecera de autorización que pueda
   acabar en un registro. El límite de la API de GitHub sin autenticar —60 peticiones por hora y por
   IP— se declara en la interfaz y en `docs/providers.md`; una instalación gasta dos.
2. **El repo se descarga a la carpeta de datos y se carga en su sitio.** El contenido vive en
   `<dataDir>/repos/<owner>__<repo>/` y la aplicación importa **sólo** los archivos habilitados. Un
   proveedor que importe un archivo hermano del repo sigue funcionando, desactivar no borra nada y
   actualizar es volver a descargar.
3. **Habilitar es el momento en que se ejecuta código.** La descarga y el listado de candidatos **no**
   ejecutan nada: el escaneo es estático, sobre el texto. Hasta que el usuario no marca una casilla no
   se importa ni un archivo, y el aviso de `SECURITY.md` —un plugin corre sin sandbox— se repite en
   esa pantalla porque es ahí donde se toma la decisión.
4. **La unidad de selección es el archivo.** Un repo declara uno o varios proveedores en archivos
   distintos; lo que el usuario marca son rutas del repo, y una ruta que el escáner no reconoció no se
   puede habilitar.

Riesgos que este trabajo añade y cómo se acotan:

| Riesgo | Acotación |
|---|---|
| SSRF: una URL que lleve al server a la red interna o a la metadata de nube | Lista blanca de **hosts de GitHub** (`api.github.com`, `raw.githubusercontent.com`) además de la comprobación de destino que ya existe, que se repite en cada salto de redirección |
| Escritura fuera de sitio con rutas del árbol de GitHub (`../`, absolutas, unidades de Windows) | Cada ruta del árbol se valida segmento a segmento y el archivo se escribe confinado al directorio del repo |
| Un repo enorme llena el disco o la memoria | Topes explícitos: 400 archivos, 512 KiB por archivo, 8 MiB en total, y un árbol truncado por GitHub es un error, no una instalación a medias |
| Un archivo que el usuario no marcó se ejecuta igual | Se declara en `SECURITY.md`: habilitar un proveedor es confiar en el repo entero, porque el archivo habilitado puede importar cualquier otro |

Rige el mismo **Definition of Done** de `tasks/plan.md`: `bun run typecheck`, `bun run lint` y
`bun test` en verde en los paquetes tocados, criterios marcados y medidos, sin `any` ni `@ts-ignore`
ni `as` para silenciar, sin tests saltados, tope de cinco archivos de implementación por task y commit
atómico que cita el task.

Siete tareas: T98 a T104. Ninguna toca `media-proxy`, `recsys` ni `catalog-store`.

## T98 — `core`: la dirección de un repo de GitHub y las formas del contrato

**Descripción:** una sola definición de «qué es un repo de GitHub» —para el formulario de la interfaz,
para la ruta del server y para lo que se guarda— y las formas que cruzan la frontera HTTP.

**Aceptación:**
- [x] `githubRepoFromUrl` acepta `https://github.com/o/r`, `github.com/o/r`, `o/r`, con o sin barra
      final, con `http` (normalizado a `https`) y con el sufijo `.git`.
- [x] `.../tree/<ref>/<subcarpeta>` devuelve `ref` y `subdir`; una subcarpeta sin `ref` no es válida
      —GitHub tampoco la admite— y `.../blob/...` se rechaza.
- [x] `owner` y `repo` se normalizan a minúsculas y se validan con la regla de GitHub: no empiezan ni
      acaban en `.` ni `-`, no son `.` ni `..`, y caben en 39 y 100 caracteres.
- [x] Otro host (`gitlab.com`), otro esquema (`file:`), un puerto, credenciales en la dirección o más
      de dos segmentos sin host (`o/r/x`) se rechazan, no se recortan en silencio.
- [x] La dirección normalizada es la que se guarda y la que se enseña, y es estable: la misma entrada
      con barra final, sin esquema o en mayúsculas da la misma cadena.
- [x] `providerRepoRecordSchema` (lo guardado), `providerRepoCandidateSchema` (una ruta con sus pistas
      de `id` y `name`), `providerRepoViewSchema` (lo guardado más los candidatos y si el contenido
      está en el disco), y las formas de petición y respuesta de las rutas, todas estrictas.

**Verificación:** `bun test packages/core` · 260 pasan, 0 fallan. Medido mutando: sin normalizar
mayúsculas fallan 2, aceptando el tercer segmento que no es `tree` 2, sin validar la ruta descodificada
3, sin los topes de cada parte 1, sin los topes del schema 3. El tope del total se **quitó**: no
discriminaba ninguna prueba porque los topes de cada parte saltan antes, y una línea que ninguna prueba
distingue de su ausencia no está midiendo nada.

**Depende de:** nada. **Tamaño:** M.

**Archivos:** `packages/core/src/repos.ts`, `packages/core/src/api.ts`, `packages/core/src/index.ts`.
**Ampliación declarada:** `packages/core/src/repos.test.ts`, `packages/core/src/api.test.ts`.

## T99 — `provider-sdk`: archivos explícitos en el loader y candidatos sin ejecutar

**Descripción:** el loader sabe cargar archivos de fuera del directorio de plugins —los que habilita un
repo— y sabe reconocer, **leyendo el texto**, qué archivos de un repo declaran un proveedor.

**Aceptación:**
- [ ] `loadProviders({ directory, files })` carga el directorio y además los archivos explícitos, en
      ese orden: un archivo del usuario con el mismo `id` gana y el del repo se reporta como duplicado
      nombrando su archivo.
- [ ] Un archivo explícito que no existe se reporta como rechazado con su motivo, no rompe la carga
      de los demás y no lanza.
- [ ] El informe sigue siendo el mismo tipo: `active` con `file`, `rejected` con `reason`, y el orden
      es determinista —directorio por nombre, después los explícitos por ruta—.
- [ ] `scanProviderSources(root)` devuelve los candidatos de un árbol: archivos `.ts`, `.js` o `.mjs`
      que declaran `export default`, `export const providers`, `export { … as default }`,
      `export { providers }` o `module.exports =`; y su pista de `id` y `name` tomada de un literal.
- [ ] Quedan fuera `node_modules`, `.git`, `.github`, `dist`, `build`, `coverage`, los directorios y
      archivos de pruebas (`*.test.*`, `*.spec.*`, `__fixtures__`, `test`, `tests`, `__tests__`) y las
      rutas ocultas: los tests de un repo exportan proveedores de mentira y no son la oferta del repo.
- [ ] `ignored` enumera los archivos con extensión de plugin que **no** declararon nada, y los topes de
      candidatos y de tamaño se declaran en el resultado (`truncated`), no se aplican en silencio.
- [ ] El escaneo no ejecuta nada: un candidato con un `throw` en la primera línea se sigue listando.

**Verificación:** `bun test packages/provider-sdk` · medido mutando: invirtiendo el orden falla 1,
sin el filtro de pruebas 2, sin el filtro de directorios 1, sin la detección de `providers` 1.

**Depende de:** nada. **Tamaño:** M.

**Archivos:** `packages/provider-sdk/src/loader.ts`, `packages/provider-sdk/src/scan.ts`,
`packages/provider-sdk/src/index.ts`.
**Ampliación declarada:** `packages/provider-sdk/src/loader.test.ts`, `packages/provider-sdk/src/scan.test.ts`.

## T100 — `server`: descargar un repo de GitHub dentro de la lista blanca

**Descripción:** el cliente que trae un repo público: resolver la rama por defecto, listar el árbol y
descargar los archivos, con lista blanca de hosts, validación de rutas y topes.

**Aceptación:**
- [ ] Sólo se piden `api.github.com` y `raw.githubusercontent.com`; cualquier otro host es un error
      antes de abrir la conexión, aunque la comprobación de destino lo dejara pasar.
- [ ] Cada petición pasa por `fetchAllowed` con el resolutor inyectado: la comprobación de red privada
      y loopback se aplica también aquí, y en cada salto de redirección.
- [ ] Sin `ref`, la rama por defecto se pregunta una vez (`GET /repos/{o}/{r}`); con `ref`, se pide el
      árbol directamente. Un 404 explica que el repositorio o la referencia no existen.
- [ ] El árbol truncado por GitHub es un error explícito: instalar la mitad de un repo es peor que no
      instalarlo.
- [ ] Una ruta con `..`, absoluta, con barra invertida, con NUL o con unidad de Windows se rechaza y
      **no** se escribe nada fuera del directorio de destino; se comprueba con una ruta hostil.
- [ ] Se saltan binarios y directorios de trabajo (`node_modules`, `.git`, `.github`, `dist`, `build`,
      `coverage`) y se respetan los tres topes: 400 archivos, 512 KiB por archivo, 8 MiB en total.
- [ ] La descarga se escribe primero en un directorio temporal dentro del destino y se mueve al
      definitivo al terminar: un fallo a mitad no deja un repo a medias que parezca completo.

**Verificación:** `bun test packages/server` · medido mutando: quitando la lista blanca de hosts falla 1
(la prueba pide un host ajeno), sin la validación de `..` falla 1, sin el tope de archivos falla 1.

**Depende de:** T98. **Tamaño:** M.

**Archivos:** `packages/server/src/github.ts`.
**Ampliación declarada:** `packages/server/src/github.test.ts`.

## T101 — `server`: los repos instalados, sus rutas y el registro vivo

**Descripción:** las cuatro rutas —listar, instalar o actualizar, elegir qué se activa, desinstalar—,
el sitio donde vive lo instalado y el `reload` del hub con los archivos habilitados.

**Aceptación:**
- [ ] `GET /api/provider-repos` devuelve cada repo con sus candidatos, leídos del disco en el momento
      de la petición, y `present: false` cuando el contenido se borró a mano.
- [ ] `POST /api/provider-repos` descarga e instala, y con un repo ya instalado **actualiza** el
      contenido conservando lo que siga existiendo de la selección anterior.
- [ ] `PATCH /api/provider-repos` sólo acepta rutas que el escáner reconoció como candidatas: una ruta
      inventada es un 400 con el motivo, no un archivo que se importa.
- [ ] La selección se guarda en la tabla de ajustes (`providerRepos`), sin migración nueva, y el hub
      recarga al instante: `/api/providers` y la búsqueda ven el cambio sin reiniciar.
- [ ] `DELETE /api/provider-repos?url=…` borra el contenido y la ficha, y deja de cargar sus archivos;
      borrar algo que no está es un 404 explicable.
- [ ] `enabledProviderFiles(store, dataDir)` es la única definición de «qué archivos de repo están
      habilitados»: devuelve las rutas existentes y ordenadas, y la usan la ruta y el arranque.
- [ ] Las cuatro rutas quedan cubiertas por el test de tabla de rutas protegidas, sin excepción.

**Verificación:** `bun test packages/server` · medido mutando: sin la comprobación de candidatos en el
`PATCH` falla 1, sin la intersección al actualizar falla 1, sin recargar el hub falla 1.

**Depende de:** T98, T99, T100. **Tamaño:** M.

**Archivos:** `packages/server/src/repo-store.ts`, `packages/server/src/routes/provider-repos.ts`,
`packages/server/src/provider-hub.ts`, `packages/server/src/app.ts`, `packages/server/src/index.ts`.
**Ampliación declarada:** `packages/server/src/repo-store.test.ts`,
`packages/server/src/routes/provider-repos.test.ts`, `packages/server/src/provider-hub.test.ts`.

## T102 — `cli`: arrancar con los proveedores de los repos habilitados

**Descripción:** el arranque carga también los archivos habilitados de los repos, para que un proveedor
instalado ayer esté activo al abrir la aplicación y salga en la lista que imprime el CLI.

**Aceptación:**
- [ ] `loadProviders` del arranque recibe los archivos habilitados, y el orden del arranque es
      migrar → abrir el contenedor → leer la selección → cargar plugins: leerla antes de migrar sería
      leer una tabla que puede no existir.
- [ ] Sin contenedor —una prueba montada sin base— el arranque carga igual que antes, sin archivos
      extra.
- [ ] Un archivo habilitado que desapareció del disco no impide arrancar y no aparece en la lista.
- [ ] La lista de proveedores que imprime el CLI incluye los de repos, con el mismo informe de
      rechazos.

**Verificación:** `bun test packages/cli` · medido mutando: quitando los archivos de la llamada falla 1,
invirtiendo el orden de migración y lectura falla 1.

**Depende de:** T101. **Tamaño:** S.

**Archivos:** `packages/cli/src/boot.ts`, `packages/cli/src/index.ts`.
**Ampliación declarada:** `packages/cli/src/boot.test.ts`.

## T103 — `web`: la sección de repositorios en Ajustes

**Descripción:** pegar la dirección de un repo, ver qué proveedores trae, marcar los que se activan y
poder actualizarlo o quitarlo.

**Aceptación:**
- [ ] Un formulario con una sola dirección: acepta lo que se copia del navegador y lo que se teclea a
      mano, y el error de una dirección inválida lo dice el schema, no el server.
- [ ] Cada repo instalado se enseña con sus candidatos, el `id` y el nombre detectados y una casilla
      por archivo; guardar manda la selección y refresca la lista de proveedores.
- [ ] Debajo del título se dice, en texto claro, que activar un proveedor ejecuta el código del repo
      sin sandbox, y el aviso del `SECURITY.md` sigue estando en la misma pantalla.
- [ ] Un repo sin candidatos, un repo con el contenido borrado (`present: false`) y un archivo que no
      cargó tienen cada uno su mensaje: ninguno se queda en silencio.
- [ ] Actualizar y quitar piden confirmación de lo que van a hacer, y quitar dice que se pierde la
      copia local.
- [ ] Todo el texto va en `packages/web/src/i18n/es.ts`, sin cadenas sueltas, y ninguna clave queda
      huérfana.

**Verificación:** `bun test packages/web` · medido mutando: sin el filtro de candidatos en las casillas
falla 1, sin refrescar tras guardar falla 1.

**Depende de:** T101. **Tamaño:** M.

**Archivos:** `packages/web/src/features/settings/ProviderRepos.tsx`,
`packages/web/src/features/settings/useSettings.ts`,
`packages/web/src/features/settings/SettingsPage.tsx`, `packages/web/src/i18n/es.ts`,
`packages/web/src/styles/shell.css`.
**Ampliación declarada:** `packages/web/src/features/settings/provider-repos.test.tsx`.

## T104 — Documentación: qué se instala, qué se ejecuta y qué no

**Descripción:** `docs/providers.md` explica el camino nuevo; `SECURITY.md` declara la superficie que
añade y el riesgo que no se mitiga; el README nombra la sección de Ajustes.

**Aceptación:**
- [ ] `docs/providers.md` explica el flujo —pegar la dirección, elegir, activar—, dónde queda el repo
      en el disco, qué gasta del límite de GitHub y cómo se actualiza.
- [ ] `SECURITY.md` dice: la descarga sale sólo a hosts de GitHub; el escaneo no ejecuta nada; activar
      ejecuta el repo entero, porque el archivo habilitado puede importar cualquier otro.
- [ ] Las direcciones y las rutas que citan los documentos existen en el código: lo comprueba
      `packages/web/src/docs.test.ts`, que falla cuando un documento cita algo que no existe.
- [ ] `tasks/todo.md` recibe la fase y las siete tareas, con la tabla de dependencias al día.

**Verificación:** `bun test packages/web` (docs) · `bun run lint` · revisión a mano de los tres
documentos contra lo implementado.

**Depende de:** T103. **Tamaño:** S.
