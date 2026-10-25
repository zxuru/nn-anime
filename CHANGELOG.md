# Changelog

Todas las versiones de nn-anime. El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).

**Este archivo es el cuerpo de la release.** `release.yml` saca de aquí la sección de la versión que
está publicando —desde `## [X.Y.Z]` hasta el encabezado siguiente— y la pega tal cual, así que lo que
se escriba aquí es lo que se lee en la página de descargas. La versión la sube `release-please` en los
diez `package.json`; este archivo lo mantiene él cuando el PR de release se fusiona.

## [0.3.0](https://github.com/zxuru/nn-anime/compare/v0.2.0...v0.3.0) (2026-10-25)


### Features

* **cli:** host, puerto y modo servidor por entorno (T168) ([c1b79b3](https://github.com/zxuru/nn-anime/commit/c1b79b3634e9bf724edba12bb0dc6ce388645a5f))
* **docker:** desplegar nn-anime como contenedor y en modo servidor (T168) ([6b64376](https://github.com/zxuru/nn-anime/commit/6b6437608dcc68a7878304538a46b11d456ba177))
* **docker:** imagen, compose y publicación multi-arquitectura (T168) ([d6b2fc0](https://github.com/zxuru/nn-anime/commit/d6b2fc046c47908e981ab1e29721ad1c4b554579))
* **server:** token fijo, login, healthz y modo restringido (T168) ([c9adf5a](https://github.com/zxuru/nn-anime/commit/c9adf5a1152cd4d5a37fdba4d9a3388bf0c07553))


### Bug Fixes

* **cli:** declarar la dependencia de media-proxy (T168) ([75c0274](https://github.com/zxuru/nn-anime/commit/75c027491508c1008a992a055bb2d498cb383884))
* **cli:** preferir el origen público en modo token (T168) ([32e6cbe](https://github.com/zxuru/nn-anime/commit/32e6cbed00246f8a38f2e5faa760deefcdf9f15f))
* **docker:** copiar las dependencias por paquete al runtime (T168) ([ceeb6b7](https://github.com/zxuru/nn-anime/commit/ceeb6b7e90cac0cf4e974a41129b2913b1285b90))
* **lint:** quitar imports sin uso y ordenar dos selectores (T168) ([a07d574](https://github.com/zxuru/nn-anime/commit/a07d574ec3ee1362c0cff8101590a70931c4dee2))

## [0.2.0](https://github.com/zxuru/nn-anime/compare/v0.1.0...v0.2.0) (2026-10-24)


### Features

* **web,cli:** el primer arranque recomienda el repositorio de proveedores (T165) ([aabc1f8](https://github.com/zxuru/nn-anime/commit/aabc1f8ad9009e7f864577d6e5736e619c49c447))


### Bug Fixes

* **web:** la marquesina de reserva usa la tinta del tema (T165) ([333af73](https://github.com/zxuru/nn-anime/commit/333af73fc887353318a786ccbff527c37616ccc1))
* **web:** los esqueletos se ven y la home dice que carga (T165) ([df1f92a](https://github.com/zxuru/nn-anime/commit/df1f92ab2645ddc9d53eecb6e093500e4ae895f3))

## [0.1.0] - 2026-10-16

La primera versión que se instala y se usa sin saber nada de terminales.

### Añadido

- **La ventana propia.** El acceso del escritorio —y el del menú Inicio, y el del menú de
  aplicaciones— abre una **ventana con la interfaz dentro**, no una consola. Detrás está el webview del
  sistema: WebView2 en Windows, WKWebView en macOS y WebKitGTK en Linux.
- **Un solo archivo para Windows.** `nn-anime-X.Y.Z-windows-x64.exe` lleva dentro el servidor y la
  interfaz: se descarga, se ejecuta y abre la ventana, sin instalar nada. El servidor se extrae a
  `%LOCALAPPDATA%\nn-anime\bin\<versión>` y se verifica con su SHA-256 antes de lanzarlo. Con un
  `portable.txt` al lado, los datos viajan con el `.exe`.
- **La X oculta la ventana en la bandeja; «Salir» apaga la aplicación.** El anfitrión le pide el
  cierre al servidor y espera a que salga; no queda ningún proceso vivo. Cerrar el servidor de golpe
  tampoco lo deja huérfano en Linux.
- **Una sola aplicación a la vez.** Volver a pulsar el acceso enfoca la ventana que ya está, en vez de
  abrir un segundo servidor sobre la misma base de datos.
- **Los enlaces externos abren en el navegador** y no se llevan la ventana.
- **Instaladores autocontenidos**, sin Bun, Node ni Python en la máquina de quien los usa:
  - Windows x64: el archivo único y el instalador `.exe`, por usuario y sin permisos de administrador.
    El instalador instala ese mismo archivo.
  - macOS: `.dmg` para Apple Silicon y para Intel.
  - Linux x64: AppImage, `.deb` y `.rpm`.
- **La release se publica sola.** `release-please` mantiene el PR de versión y, al fusionarlo, el tag
  dispara `release.yml`: compila el archivo único y los instaladores, calcula `SHA256SUMS.txt` y
  publica. Hay un solo publicador.

### Notas

- Los instaladores salen **sin firmar** mientras no haya certificados configurados. Windows avisa con
  SmartScreen y macOS con Gatekeeper la primera vez; el `SHA256SUMS.txt` de la release sirve para
  comprobar que la descarga llegó entera.
- Desinstalar **no borra los datos**: la base, los ajustes y los plugins viven en la carpeta del
  usuario y se quedan donde están.
- No hay ningún proveedor instalado de fábrica: hasta que se copie un plugin, la aplicación arranca,
  se ve y no encuentra nada. Se explica en [la guía de plugins](docs/providers.md).
