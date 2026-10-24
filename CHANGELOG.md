# Changelog

Todas las versiones de nn-anime. El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).

**Este archivo es el cuerpo de la release.** `release.yml` saca de aquí la sección de la versión que
está publicando —desde `## [X.Y.Z]` hasta el encabezado siguiente— y la pega tal cual, así que lo que
se escriba aquí es lo que se lee en la página de descargas. La versión la sube `release-please` en los
diez `package.json`; este archivo lo mantiene él cuando el PR de release se fusiona.

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
