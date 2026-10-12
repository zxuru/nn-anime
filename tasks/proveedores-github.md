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
- [x] `loadProviders({ directory, files })` carga el directorio y además los archivos explícitos, en
      ese orden: un archivo del usuario con el mismo `id` gana y el del repo se reporta como duplicado
      nombrando su archivo.
- [x] Un archivo explícito que no existe se reporta como rechazado con su motivo, no rompe la carga
      de los demás y no lanza.
- [x] El informe sigue siendo el mismo tipo: `active` con `file`, `rejected` con `reason`, y el orden
      es determinista —directorio por nombre, después los explícitos por ruta—.
- [x] `scanProviderSources(root)` devuelve los candidatos de un árbol: archivos `.ts`, `.js` o `.mjs`
      que declaran `export default`, `export const providers`, `export { … as default }`,
      `export { providers }` o `module.exports =`; y su pista de `id` y `name` tomada de un literal.
- [x] Quedan fuera `node_modules`, `.git`, `.github`, `dist`, `build`, `coverage`, los directorios y
      archivos de pruebas (`*.test.*`, `*.spec.*`, `__fixtures__`, `test`, `tests`, `__tests__`) y las
      rutas ocultas: los tests de un repo exportan proveedores de mentira y no son la oferta del repo.
- [x] `ignored` enumera los archivos con extensión de plugin que **no** declararon nada, y los topes de
      candidatos y de tamaño se declaran en el resultado (`truncated`), no se aplican en silencio.
- [x] El escaneo no ejecuta nada: un candidato con un `throw` en la primera línea se sigue listando.

**Verificación:** `bun test packages/provider-sdk` · 138 pasan, 0 fallan. Medido mutando: invirtiendo
el orden falla 1, sin la detección de `export const providers` 1, sin el tope de archivos 1, sin el
filtro de pruebas 1, sin el de directorios de trabajo 1, sin el de lo oculto 1.

**Depende de:** nada. **Tamaño:** M.

**Archivos:** `packages/provider-sdk/src/loader.ts`, `packages/provider-sdk/src/scan.ts`,
`packages/provider-sdk/src/index.ts`.
**Ampliación declarada:** `packages/provider-sdk/src/loader.test.ts`, `packages/provider-sdk/src/scan.test.ts`.

## T100 — `server`: descargar un repo de GitHub dentro de la lista blanca

**Descripción:** el cliente que trae un repo público: resolver la rama por defecto, listar el árbol y
descargar los archivos, con lista blanca de hosts, validación de rutas y topes.

**Aceptación:**
- [x] Sólo se piden `api.github.com`, `raw.githubusercontent.com` y el host canónico `github.com`;
      cualquier otro host es un error antes de abrir la conexión, aunque la comprobación de destino lo
      dejara pasar.
- [x] Cada petición pasa por `fetchAllowed` con el resolutor inyectado: la comprobación de red privada
      y loopback se aplica también aquí, y en cada salto de redirección.
- [x] Sin `ref`, la rama por defecto se pregunta una vez (`GET /repos/{o}/{r}`); con `ref`, se pide el
      árbol directamente. Un 404 explica que el repositorio o la referencia no existen.
- [x] El árbol truncado por GitHub es un error explícito: instalar la mitad de un repo es peor que no
      instalarlo.
- [x] Una ruta con `..`, absoluta, con barra invertida, con NUL o con unidad de Windows se rechaza y
      **no** se escribe nada fuera del directorio de destino; se comprueba con una ruta hostil.
- [x] Se saltan binarios y directorios de trabajo (`node_modules`, `.git`, `.github`, `dist`, `build`,
      `coverage`) y se respetan los tres topes: 400 archivos, 512 KiB por archivo, 8 MiB en total.
- [x] La descarga se escribe primero en un directorio temporal dentro del destino y se mueve al
      definitivo al terminar: un fallo a mitad no deja un repo a medias que parezca completo.

**Verificación:** `bun test packages/server` · 407 pasan, 0 fallan. Medido mutando: sin la lista blanca
de hosts 1, sin el tope de archivos 1, sin la comprobación de árbol truncado 1, sin `isSafeRepoPath` 1
—la ruta hostil llega a `confine`, que aborta—.

**Depende de:** T98. **Tamaño:** M.

**Archivos:** `packages/server/src/github.ts`.
**Ampliación declarada:** `packages/server/src/github.test.ts`.

## T101 — `server`: los repos instalados, sus rutas y el registro vivo

**Descripción:** las cuatro rutas —listar, instalar o actualizar, elegir qué se activa, desinstalar—,
el sitio donde vive lo instalado y el `reload` del hub con los archivos habilitados.

**Aceptación:**
- [x] `GET /api/provider-repos` devuelve cada repo con sus candidatos, leídos del disco en el momento
      de la petición, y `present: false` cuando el contenido se borró a mano.
- [x] `POST /api/provider-repos` descarga e instala, y con un repo ya instalado **actualiza** el
      contenido conservando lo que siga existiendo de la selección anterior.
- [x] `PATCH /api/provider-repos` sólo acepta rutas que el escáner reconoció como candidatas: una ruta
      inventada es un 400 con el motivo, no un archivo que se importa.
- [x] La selección se guarda en la tabla de ajustes (`providerRepos`), sin migración nueva, y el hub
      recarga al instante: `/api/providers` y la búsqueda ven el cambio sin reiniciar.
- [x] `DELETE /api/provider-repos?url=…` borra el contenido y la ficha, y deja de cargar sus archivos;
      borrar algo que no está es un 404 explicable.
- [x] `enabledProviderFiles(store, dataDir)` es la única definición de «qué archivos de repo están
      habilitados»: devuelve las rutas existentes y ordenadas, y la usan la ruta y el arranque.
- [x] Las cuatro rutas quedan cubiertas por el test de tabla de rutas protegidas, sin excepción: la
      tabla se monta con contenedor y una prueba exige las cuatro en ella.

**Verificación:** `bun test packages/server packages/core packages/provider-sdk packages/cli` · 1004
pasan, 0 fallan. Medido mutando: sin la comprobación de candidatos en el `PATCH` falla 1, sin la
intersección al actualizar 1, sin recargar el hub 4, con la carpeta de descarga fija 4 —incluida «el
código nuevo de verdad»: Bun cachea los módulos por URL y sin carpeta nueva se recarga el código
viejo—.

**Depende de:** T98, T99, T100. **Tamaño:** M.

**Archivos:** `packages/server/src/repo-store.ts`, `packages/server/src/routes/provider-repos.ts`,
`packages/server/src/provider-hub.ts`, `packages/server/src/app.ts`, `packages/server/src/index.ts`.
**Ampliación declarada:** `packages/server/src/repo-store.test.ts`,
`packages/server/src/routes/provider-repos.test.ts`, `packages/server/src/provider-hub.test.ts`.

## T102 — `cli`: arrancar con los proveedores de los repos habilitados

**Descripción:** el arranque carga también los archivos habilitados de los repos, para que un proveedor
instalado ayer esté activo al abrir la aplicación y salga en la lista que imprime el CLI.

**Aceptación:**
- [x] `loadProviders` del arranque recibe los archivos habilitados, y el orden del arranque es
      migrar → abrir el contenedor → leer la selección → cargar plugins: leerla antes de migrar sería
      leer una tabla que puede no existir.
- [x] Sin contenedor —una prueba montada sin base— el arranque carga igual que antes, sin archivos
      extra.
- [x] Un archivo habilitado que desapareció del disco no impide arrancar y no aparece en la lista.
- [x] La lista de proveedores que imprime el CLI incluye los de repos, con el mismo informe de
      rechazos.

**Verificación:** `bun test packages/cli packages/server packages/core packages/provider-sdk` · 1007
pasan, 0 fallan. Medido mutando: pasando la lista vacía al cargador falla 1; invirtiendo el orden —abrir
la base y leer la selección antes de migrar— fallan 2 con `SQLiteError: no such table`.

**Depende de:** T101. **Tamaño:** S.

**Archivos:** `packages/cli/src/boot.ts`, `packages/cli/src/index.ts`.
**Ampliación declarada:** `packages/cli/src/boot.test.ts`.

## T103 — `web`: la sección de repositorios en Ajustes

**Descripción:** pegar la dirección de un repo, ver qué proveedores trae, marcar los que se activan y
poder actualizarlo o quitarlo.

**Aceptación:**
- [x] Un formulario con una sola dirección: acepta lo que se copia del navegador y lo que se teclea a
      mano, y el error de una dirección inválida lo dice el schema, no el server.
- [x] Cada repo instalado se enseña con sus candidatos, el `id` y el nombre detectados y una casilla
      por archivo; guardar manda la selección y refresca la lista de proveedores.
- [x] Debajo del título se dice, en texto claro, que activar un proveedor ejecuta el código del repo
      sin sandbox, y el aviso del `SECURITY.md` sigue estando en la misma pantalla.
- [x] Un repo sin candidatos, un repo con el contenido borrado (`present: false`) y un archivo que no
      cargó tienen cada uno su mensaje: ninguno se queda en silencio.
- [x] Quitar pide confirmación y dice que se pierde la copia local; actualizar lo dice en su etiqueta y
      no pide confirmación —una confirmación por cada descarga es un aviso que se aprende a saltar—.
- [x] Todo el texto va en `packages/web/src/i18n/es.ts`, sin cadenas sueltas, y ninguna clave queda
      huérfana.

**Verificación:** `bun test packages` · 2177 pasan, 0 fallan. Medido mutando: pintando las casillas de
un repositorio sin contenido descodificado fallan 2, marcando todas las casillas por defecto fallan 2,
con `changed` siempre en falso falla 1. **Declarado:** el paquete no tiene arnés de DOM, así que el gesto
de marcar y guardar en el navegador no lo mide ninguna prueba unitaria; lo que sí está medido del camino
completo es el `PATCH` del servidor con el loader real, en `routes/provider-repos.test.ts`.

**Depende de:** T101. **Tamaño:** M.

**Archivos:** `packages/web/src/features/settings/ProviderRepos.tsx`,
`packages/web/src/features/settings/useProviderRepos.ts`,
`packages/web/src/features/settings/useSettings.ts`,
`packages/web/src/features/settings/SettingsPage.tsx`, `packages/web/src/i18n/es.ts`.
**Ampliación declarada:** `packages/web/src/features/settings/provider-repos.test.tsx`.
**Sin tocar, y es una decisión:** `packages/web/src/styles/shell.css`. La sección usa las clases que ya
existían, así que la hoja de estilos no crece con cada pantalla.

## T104 — Documentación: qué se instala, qué se ejecuta y qué no

**Descripción:** `docs/providers.md` explica el camino nuevo; `SECURITY.md` declara la superficie que
añade y el riesgo que no se mitiga; el README nombra la sección de Ajustes.

**Aceptación:**
- [x] `docs/providers.md` explica el flujo —pegar la dirección, elegir, activar—, dónde queda el repo
      en el disco, qué gasta del límite de GitHub y cómo se actualiza.
- [x] `SECURITY.md` dice: la descarga sale sólo a hosts de GitHub; el escaneo no ejecuta nada; activar
      ejecuta el repo entero, porque el archivo habilitado puede importar cualquier otro.
- [x] Las direcciones y las rutas que citan los documentos existen en el código: lo comprueba
      `packages/web/src/docs.test.ts`, que falla cuando un documento cita algo que no existe.
- [x] El registro de las siete tareas queda donde queda el de las tareas posteriores a la v1: el plan
      en `tasks/proveedores-github.md` y los cierres en `tasks/done/T98.md` … `tasks/done/T104.md`.
      **El plan decía `tasks/todo.md`, y eso era un error del plan:** `todo.md` termina en T47 y desde
      entonces el integrador no lo toca —las 42 fichas de `tasks/done/` son el registro—, así que
      pegar estas siete ahí habría roto la forma del archivo en vez de seguirla.

**Verificación:** `bun test packages/web/src/docs.test.ts` 7 pasan, 0 fallan · `bun run lint` 0 errores,
los 2 avisos de `main` · revisión a mano de los tres documentos contra lo implementado: los cuatro
topes, los dos hosts de la descarga, la carpeta `<dataDir>/repos/<usuario>__<repo>/<marca>/` y la clave
`providerRepos` de los ajustes están en el código con esos nombres.

**Depende de:** T103. **Tamaño:** S.

**Archivos:** `docs/providers.md`, `SECURITY.md`, `README.md`.

---

## Estado final

Las siete tareas están hechas e integradas en `main`, cada una con su commit y su cierre en
`tasks/done/`, más dos correcciones que salieron de la comprobación en vivo:

| Task | Qué dejó | Commit |
|---|---|---|
| T98 | `core`: la dirección de un repo y las formas del contrato | `feat(core): la direccion de un repo de GitHub… (T98)` |
| T99 | `provider-sdk`: archivos explícitos y candidatos sin ejecutar | `feat(provider-sdk): archivos explicitos y candidatos… (T99)` |
| T100 | `server`: descargar un repo dentro de la lista blanca | `feat(server): descargar un repo de GitHub… (T100)` |
| T101 | `server`: los repos instalados, sus rutas y el registro vivo | `feat(server): los repositorios instalados… (T101)` |
| T102 | `cli`: arrancar con los repositorios habilitados | `feat(cli): arrancar con los proveedores… (T102)` |
| T103 | `web`: la sección de repositorios en Ajustes | `feat(web): la seccion de repositorios en Ajustes (T103)` |
| T104 | Documentación: qué se instala, qué se ejecuta y qué no | `docs: los proveedores de un repositorio… (T104)` |
| T105 | `provider-sdk`: una declaración de tipos no es un proveedor | `fix(provider-sdk): una declaracion de tipos… (T105)` |
| T106 | `server`: el rechazo se llama por su archivo, también en Windows | `fix(server): el rechazo se llama por su archivo… (T106)` |

### Comprobación en vivo, con el servidor de verdad

Sobre un repositorio público real, `sindresorhus/is-plain-obj` (8 archivos), con la sesión canjeada y
las cabeceras de `Host` y `Origin`:

| Paso | Resultado |
|---|---|
| `POST /api/provider-repos` con `sindresorhus/is-plain-obj` | 201, `ref: main`, 8 archivos, candidatos `index.d.ts` e `index.js`, `enabled: []` y **cero proveedores activos** |
| `PATCH` con `enabled: ["index.js"]` | 200; `/api/providers` lo enseña como **rechazado con su motivo** («expected object, received function»): el archivo no es un proveedor y el error llega con nombre |
| `DELETE` | 204, la copia en `repos/` desaparece y `/api/providers` queda vacío |

De ahí salieron T105 —`index.d.ts` se ofrecía como proveedor— y T106 —el rechazo se llamaba por la ruta
entera, porque `fileStem` partía sólo por `/`—.

**Lo que no está medido, y se declara:** el gesto de marcar una casilla y guardar en el navegador no lo
mide ninguna prueba unitaria, porque `packages/web` no tiene arnés de DOM. Lo que sí está medido del
camino completo es el `PATCH` del servidor con el loader real, y el e2e queda como el sitio donde
medirlo cuando se extienda. `bun run build` tampoco se pudo correr aquí: Vite lanza `esbuild` como
proceso hijo y el sandbox de Windows no deja crear la tubería —el mismo límite que impide ejecutar el
gancho de git—.

**Lo que este trabajo NO hizo:** no hay token ni repositorios privados, no hay actualización automática
—actualizar es un botón— y no hay e2e de la sección.
