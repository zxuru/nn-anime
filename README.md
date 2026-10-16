# nn-anime

Ver anime desde el navegador, con una interfaz que se lanza desde la terminal —como `ani-cli`— y que
aprende de lo que ves para recomendarte. Todo local: **no hay servidor central, ni cuentas, ni
telemetría.**

![La pantalla de inicio en tema oscuro: la cinta de lo más visto, el cartel de destacado, el top de la fuente y las filas](docs/captura.png)

![La misma pantalla en tema claro](docs/captura-claro.png)

> Las capturas son del arnés de pruebas, con el plugin de ejemplo y sus datos inventados. Las portadas
> son los degradados del diseño porque el fixture apunta a `fixture.invalid`, que no existe. Se pueden
> volver a hacer con `bun run captura` y el servidor del e2e levantado: el comando saca las dos, en
> tema oscuro y claro.

El tema por defecto es el del sistema; se cambia en **Ajustes** y queda guardado.

La home sigue el orden del diseño: cinta de lo más visto, cartel de destacado —con el botón que
reproduce el primer episodio y el de favoritos—, **top** —el ranking de AniList cuando su API
contesta y el de la fuente cuando no, numerado del uno al N y con «Mostrar más»—, **parrilla** de
estrenos —los capítulos de los próximos días, agrupados por día—, **novedades** —los episodios recién
emitidos, o el feed de la fuente—, continuar viendo, favoritos y los géneros del catálogo. Todas las piezas del mosaico son **carteles del mismo tamaño** —una columna, con la
proporción de una portada—, así que una fila pone seis títulos a la vista y no deja huecos. El motivo
de cada recomendación viaja con su pieza: se lee en el asomo, al pasar el puntero, y en la hoja que
abre el botón «i».

«Novedades» existe para que la primera pantalla no dependa de que hayas buscado antes: se llena con
lo que publica tu proveedor si declara `feed`. Lo que la aplicación ya conoce —lo que buscaste y lo
que abriste— también es la reserva del destacado: sin nada que recomendar, sale de ahí en vez de
dejar la página con un titular. Pintaba una fila propia, «último añadido», y se retiró: repetía lo
que las novedades y el top ya enseñaban.

La home y la búsqueda se parten en dos con el **conmutador de tipo**: anime a un lado y películas al
otro —con las series y los doramas, que van por el mismo camino—. La elección queda en la dirección
(`?tipo=movies`), así que se puede recargar y compartir, y cada proveedor dice en su manifiesto qué
sirve (`capabilities.media`, ausente es anime): **Ajustes** lo enseña junto a cada fuente. Un plugin que
sirva las dos cosas declara `both` y su catálogo se reparte por el tipo de cada título. Si no hay
ninguna fuente de esa mitad, la pantalla lo dice en vez de quedarse en blanco.

**La parrilla y los episodios recién emitidos salen de la API pública de AniList**, que es la única
fuente consultada con fecha de emisión por episodio: un feed da la fecha de **publicación del título**,
que no es lo mismo. Se consulta `graphql.anilist.co` directamente, con lista blanca de hosts, un
presupuesto de una petición cada dos segundos y caché con TTL en la base local; sus términos —gratuita
para uso no comercial, sin `hoarding` ni usarla como almacenamiento— se respetan no pidiendo nada que
no esté en pantalla. La ficha además se enriquece con su sinopsis, sus géneros, su nota y su portada
cuando la obra está emparejada, y `NN_ANIME_ANILIST_OFFLINE=1` apaga esa salida (lo usa el arnés de
pruebas, que no puede depender de un tercero).

## Instalación (para usuarios)

**No hace falta instalar nada más**: ni Node, ni Bun, ni Python. El instalador trae dentro el
programa entero —la interfaz, el servidor y la base de datos—, y todos están en
[la página de Releases](https://github.com/zxuru/nn-anime/releases).

| Sistema | Archivo |
|---|---|
| Windows x64 | `nn-anime-X.Y.Z-windows-x64-setup.exe` |
| macOS, chip de Apple | `nn-anime-X.Y.Z-macos-arm64.dmg` |
| macOS, Intel | `nn-anime-X.Y.Z-macos-x64.dmg` |
| Linux x64 | `nn-anime-X.Y.Z-linux-x64.AppImage`, `.deb` o `.rpm` |

### Windows

Ejecuta el `.exe` y sigue el asistente. Se instala **sólo para tu usuario** —no pide permisos de
administrador— en `%LOCALAPPDATA%\Programs\nn-anime`, y deja un acceso en el menú Inicio y otro en el
escritorio.

Al abrirlo aparece una **ventana de consola** y, a los pocos segundos, el navegador. Esa ventana es
la aplicación: mientras esté abierta, el servidor vive y ahí se leen los avisos. **Para cerrarla,
cierra la ventana**; el navegador dejará de funcionar.

Desinstalar desde «Agregar o quitar programas» **no borra tus datos**: la base, los ajustes y los
plugins viven en `%APPDATA%\nn-anime` y `%LOCALAPPDATA%\nn-anime`.

Windows avisará de que el programa viene de un **desarrollador no verificado** mientras la release no
esté firmada. En «Más información» del aviso hay un «Ejecutar de todas formas»; el aviso es de que
nadie ha pagado un certificado, no de que el archivo esté mal. El `SHA256SUMS.txt` de la release
sirve para comprobar que llegó entero.

### macOS

Abre el `.dmg` y arrastra **nn-anime** a la carpeta Aplicaciones. Hay un `.dmg` por arquitectura:
`arm64` para los Mac con chip de Apple y `x64` para los Intel. Cuál es el tuyo se ve en el menú
Apple → «Acerca de este Mac».

Mientras la release no esté firmada ni notarizada, macOS la frena la primera vez con «no se puede
abrir porque proviene de un desarrollador no identificado». Para abrirla:

- **Botón derecho sobre la aplicación → Abrir** y, en el diálogo, **Abrir**. Sólo hace falta la
  primera vez.
- Si esa opción no aparece: **Ajustes del Sistema → Privacidad y seguridad** y, abajo, **«Abrir de
  todos modos»**.

La aplicación no tiene ventana propia: abre el navegador y deja su icono en el Dock. **Para cerrarla,
botón derecho sobre el icono del Dock → Salir.**

### Linux

- **AppImage**: descárgalo, dale permiso de ejecución y lánzalo.
  `chmod +x nn-anime-X.Y.Z-linux-x64.AppImage && ./nn-anime-X.Y.Z-linux-x64.AppImage`. No instala
  nada ni toca el sistema.
- **`.deb`** (Debian, Ubuntu): `sudo apt install ./nn-anime-X.Y.Z-linux-x64.deb`. Deja `nn-anime` en
  el PATH y un acceso en el menú de aplicaciones.
- **`.rpm`** (Fedora, RHEL): `sudo dnf install ./nn-anime-X.Y.Z-linux-x64.rpm`.

El acceso del menú abre una terminal además del navegador: ahí se leen los avisos y desde ahí se para
con `Ctrl+C`. El AppImage lanzado desde el explorador de archivos no abre ninguna terminal, así que
conviene lanzarlo desde una.

### Comprobar la descarga

Cada release lleva un `SHA256SUMS.txt` con el hash SHA256 de todos sus archivos:

```bash
sha256sum -c SHA256SUMS.txt
```

En Windows, `certutil -hashfile <archivo> SHA256` y se compara a ojo.

### Después de instalar

**No hay ningún proveedor instalado de fábrica**, así que la aplicación arranca, se ve y no encuentra
nada. Para que encuentre algo hay que copiar un plugin, y eso se cuenta en
[la guía de plugins](docs/providers.md). Sin plugins no hay búsqueda, ni catálogo, ni
recomendaciones: sólo la interfaz y el motor.

Si tienes `mpv` instalado, la aplicación lo detecta al arrancar y ofrece reproducir en él además de
en el navegador. No hace falta para nada.

## Arrancar

```bash
bun install
bun run build        # construye la interfaz, que es lo que sirve `bun run start`
bun run start        # servidor real en 127.0.0.1, abre el navegador
```

`bun run start` sirve `packages/web/dist` desde el disco, así que **sin `bun run build` la interfaz no
está**: el servidor arranca y contesta 404 en `/`. Para desarrollar la interfaz con recarga en caliente
está `bun run dev`, que sirve el código fuente y no necesita el `build`.

`bun run start` levanta el servidor en `127.0.0.1`, imprime una dirección con un **token de arranque**
de un solo uso y la abre en el navegador. Sin ese token no se entra: es lo que impide que cualquier
página del navegador hable con tu aplicación local.

Si vas a contribuir, `bun run hooks:instalar` una vez por clon: instala el gancho que frena el commit
directo en `main`, y hay una prueba que comprueba que está puesto.

**En Windows** funciona igual, con dos particularidades. Bun no define `HOME` ahí, así que los datos
van a `%LOCALAPPDATA%` y la configuración a `%APPDATA%` en lugar de a las rutas de XDG. Y dos pruebas
que crean enlaces simbólicos necesitan el **modo desarrollador** activado: sin él Windows las rechaza
con `EPERM` y las pruebas lo declaran en lugar de fingir que midieron.

No hay ningún proveedor instalado de fábrica. Hasta que copies uno —ver
[la guía de plugins](docs/providers.md)— la aplicación arranca, se ve y no encuentra nada.

## Comandos

| Comando | Qué hace |
|---|---|
| `bun run dev` | Interfaz en desarrollo, con recarga en caliente |
| `bun run start` | Servidor real en `127.0.0.1`, abre el navegador |
| `bun run build` | Construye **la interfaz** en `packages/web/dist` |
| `bun test` | Todas las pruebas, sin red |
| `bun run e2e` | Pruebas en un navegador de verdad, con el plugin de ejemplo |
| `bun run e2e:fallo` | El mismo arnés con el proveedor en modo fallo |
| `bun run typecheck` | `tsc --noEmit` sobre todos los paquetes |
| `bun run lint` | Biome |
| `bun run hooks:instalar` | Instala el gancho de git que frena el commit directo en `main` |
| `bun run db:migrate` | Crea o actualiza la base |
| `bun run db:prune` | Limpia lo viejo |
| `bun run coverage:gate` | Cobertura por paquete, con su umbral |
| `bun run captura` | Vuelve a hacer la captura de este README |
| `bun run package` | Compila el ejecutable de esta plataforma, lo prueba y arma su instalador |
| `bun run package:smoke` | Arranca un ejecutable ya compilado y le pregunta si sirve la interfaz |
| `bun run version:check` | Comprueba que los diez `package.json` dicen la misma versión |
| `bun run version:set` | Sube la versión en los diez `package.json` de una vez |
| `bun run icon` | Vuelve a generar el icono (PNG, ICO e ICNS) desde código |

**Qué produce `bun run build`:** la interfaz. El servidor y el CLI **se ejecutan desde el código fuente
con Bun** para desarrollar, y `bun run package` es lo que los convierte en un programa instalable: un
ejecutable por plataforma que lleva dentro el runtime, la interfaz y las migraciones, envuelto en un
instalador. Para desarrollar hace falta Bun en la máquina —y por eso está declarado en `engines`—;
para **usar** la aplicación instalada, no hace falta nada.

## Dónde vive cada cosa

| Qué | Linux y macOS | Windows |
|---|---|---|
| Datos y base de datos | `~/.local/share/nn-anime/` | `%LOCALAPPDATA%\nn-anime\` |
| Configuración | `~/.config/nn-anime/` | `%APPDATA%\nn-anime\` |
| Tus plugins | `~/.config/nn-anime/providers/` | `%APPDATA%\nn-anime\providers\` |
| Repositorios de proveedores descargados | `~/.local/share/nn-anime/repos/` | `%LOCALAPPDATA%\nn-anime\repos\` |
| Caché | `~/.cache/nn-anime/` | `%LOCALAPPDATA%\nn-anime\cache\` |

Las rutas exactas en uso se ven en **Ajustes**, dentro de la aplicación. En Linux y macOS se respetan
`XDG_DATA_HOME`, `XDG_CONFIG_HOME` y `XDG_CACHE_HOME`; en Windows mandan `%LOCALAPPDATA%` y
`%APPDATA%` —colgando de `USERPROFILE` si faltan—, y las `XDG_*` se siguen respetando para quien las
tenga puestas.

Las variables de entorno que lee la aplicación están inventariadas en `.env.example`, sin ningún valor
real. Ninguna es obligatoria y ninguna lleva un secreto: los directorios se pueden cambiar por ahí, y
también `NN_ANIME_LANG` para el idioma. Copiar el archivo a `.env` es opcional; Bun lo carga solo.

## Aviso de seguridad: los plugins se ejecutan sin sandbox

**Un plugin se ejecuta con tus permisos y sin aislamiento.** Puede leer y escribir lo mismo que tú. No
hay sandbox, y no lo habrá en v1: el proceso que carga el plugin es el mismo que sirve la aplicación.

- Copia sólo plugins cuyo origen conozcas.
- La aplicación lo dice **en la pantalla de Ajustes**, no sólo aquí.
- El detalle está en [SECURITY.md](SECURITY.md), con el modelo de amenaza y los riesgos residuales.

En **Ajustes** hay además una sección para traer los proveedores de un repositorio de GitHub: se pega la
dirección, se mira qué trae y se marca cuáles se activan. Instalar **no ejecuta nada** —el repositorio se
descarga y sus archivos se leen, no se importan—; marcar una casilla es el momento en que ese código se
ejecuta, con el mismo aviso de arriba delante. El repositorio entero queda en `repos/` y los archivos
marcados se cargan desde ahí, así que un proveedor que importe un archivo hermano sigue funcionando.

## Este repositorio no incluye scrapers

nn-anime **no incluye ningún scraper** de sitios de video, ni torrents, ni protocolos de pares, ni
alojamiento de contenido. Lo que hay es:

- Un **contrato de plugin** (`packages/provider-sdk`) que cualquiera puede implementar.
- Un **plugin de ejemplo** (`packages/providers-fixture`) con doce títulos inventados y direcciones
  `fixture.invalid`, que no existe.
- El motor de recomendación, el proxy, la interfaz y el lanzador.

**Conseguir las fuentes es responsabilidad de quien usa el programa.** Escribe tu propio plugin, o usa
uno que respete las condiciones del sitio del que salen los datos.

Los proveedores que escribimos para sitios reales no viven aquí, viven en su propio repositorio:
[nn-anime-plugins](https://github.com/zxuru/nn-anime-plugins). Se copian a
`~/.config/nn-anime/providers/` y la aplicación los carga al arrancar. La separación es deliberada: es
lo que permite que este repositorio siga sin incluir un solo scraper.

## Cómo publicar una release (para mantenedores)

La versión vive **en un solo sitio**: `package.json` de la raíz. Los otros nueve manifiestos la copian,
y `bun run version:check` falla si alguno se desvió —lo que impide publicar un binario que dice una
versión y unos instaladores que dicen otra—.

1. **Deja que el PR de release se abra solo.** `release-please` lee los Conventional Commits
   (`feat:`, `fix:`…) que ya se escriben en `main`, y mantiene un PR con el `CHANGELOG.md` escrito y
   la versión subida en los diez `package.json`. Se titula «chore(main): release X.Y.Z».
2. **Fusiona ese PR.** Al fusionarlo, `release-please` crea el tag `vX.Y.Z` y deja la release **en
   borrador**, con el changelog como cuerpo.
3. **El resto lo hace el workflow.** El tag dispara `.github/workflows/release.yml`, que pasa el
   listón (tipos, estilo, auditoría y pruebas), compila los instaladores de Windows, macOS y Linux,
   calcula el `SHA256SUMS.txt`, sube todo al borrador y **lo publica**.

No hay que tocar nada a mano. Si hace falta lanzarlo sin publicar —para probar la cadena de
empaquetado— está **Actions → Release → Run workflow** con «publish» sin marcar: compila todo y deja
los artefactos en el resumen del propio workflow, sin gastar un número de versión.

**Compila GitHub, no tu máquina.** Cada push compila el ejecutable y el instalador en las tres
plataformas y los deja descargables en «Artifacts» del workflow, para que no haga falta tener NSIS,
`nfpm` ni un Mac a mano. Las herramientas que no vienen en la imagen las prepara
`.github/actions/herramientas`, con sus versiones y sus SHA256 en un solo sitio. El detalle está en
[la guía de publicación](docs/release.md).

Si hay que subir la versión a mano —un `hotfix` sin commits que lo justifiquen—:
`bun run version:set 0.2.1`, commit, y el tag `v0.2.1` a mano. El resto es igual.

**Lo que hay que configurar una vez:** los secretos de firma están en
[la guía de publicación](docs/release.md), junto con el ajuste del repositorio que necesita
`release-please` para poder abrir su PR. Sin ningún secreto, las releases salen **sin firmar** y se
instalan igual, con las advertencias del sistema que cuenta la sección de instalación.

## Documentación

| Documento | Qué cuenta |
|---|---|
| [docs/providers.md](docs/providers.md) | Cómo escribir un plugin, con un ejemplo comentado |
| [docs/release.md](docs/release.md) | Cómo se publica: secretos de firma, ajustes del repositorio y qué queda por probar |
| [SECURITY.md](SECURITY.md) | Modelo de amenaza, mitigaciones y riesgos residuales |
| [docs/a11y.md](docs/a11y.md) | Qué se comprueba de accesibilidad y qué no |
| [docs/PLAN-B-HLS.md](docs/PLAN-B-HLS.md) | Por qué HLS se queda en v1 |
| [docs/specs/SPEC-nn-anime.md](docs/specs/SPEC-nn-anime.md) | El spec del proyecto, con las decisiones |
| [docs/specs/CAPABILITY-MAP.md](docs/specs/CAPABILITY-MAP.md) | Qué módulo hace qué |
| [docs/estudio-busqueda-ani-cli-mx.md](docs/estudio-busqueda-ani-cli-mx.md) | Cómo busca ani-cli-mx —anime y películas—, en qué se diferencia de nn-anime y la receta para los plugins |
| [docs/estudio-tauri.md](docs/estudio-tauri.md) | La ventana propia encima de lo que ya se empaqueta: qué falta, qué se midió y en qué orden |

## Cómo está hecho

Bun y TypeScript en todo el proyecto, React en la interfaz, `bun:sqlite` para los datos y Hono para el
servidor. Los paquetes viven en `packages/`:

- `core` — tipos, esquemas y errores compartidos
- `provider-sdk` — el contrato de plugin y su prueba de conformidad
- `providers-fixture` — el plugin de ejemplo, con datos inventados
- `catalog-store` — la base de datos y sus repositorios
- `media-proxy` — el proxy de bytes y HLS, los tickets opacos y el control de `mpv`
- `recsys` — el motor de recomendación
- `server` — la API
- `web` — la interfaz
- `cli` — el lanzador
