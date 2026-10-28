# Probar el instalador de Windows de verdad.
#
# Desde T189 el instalador de Windows **no** lo escribe este repositorio: lo arma
# `tauri-bundler` (`bun run desktop:installer`) a partir de `tauri.conf.json`. Eso
# trae tres cosas que este guion tiene que saber y el anterior no:
#
#   - Instala en `%LOCALAPPDATA%\nn-anime`, la misma carpeta que la aplicación usa
#     para sus datos. El desinstalador borra **los archivos que instaló** y deja el
#     resto; por eso el centinela de los datos se comprueba después de desinstalar.
#   - El desinstalador se llama `uninstall.exe`, no «Desinstalar nn-anime.exe».
#   - En modo silencioso (`/S`) crea los dos accesos, porque la página final —la
#     que tiene la casilla del acceso de escritorio— no llega a verse.
#
# Lo que se comprueba es lo que un usuario notaría, en el orden en que lo notaría:
#   1. Se instala en silencio, sin permisos de administrador.
#   2. Queda **un solo ejecutable** —el anfitrión, que lleva el servidor dentro—.
#   3. Hay entrada en «Agregar o quitar programas».
#   4. Los dos accesos existen y abren el **anfitrión**.
#   5. Al abrirlo aparece una ventana, el servidor se extrae a
#      `%LOCALAPPDATA%\nn-anime\bin\<versión>` y escucha **sólo en loopback**. Al
#      cerrar la ventana la aplicación **se oculta en la bandeja** (no se apaga).
#   6. Al desinstalar se van el ejecutable, el desinstalador y las claves, y **los
#      datos del usuario se quedan** —la base incluida—.
#
# Uso: pwsh -NoProfile -File packaging/windows/probar-instalador.ps1
#      pwsh -NoProfile -File packaging/windows/probar-instalador.ps1 -Bundle <carpeta>

[CmdletBinding()]
param(
  [string] $Bundle = 'desktop/src-tauri/target/release/bundle/nsis'
)

$ErrorActionPreference = 'Stop'

function Paso([string] $mensaje) { Write-Output "  $mensaje" }

# Un servidor de una ejecución anterior dejaría el recuento de procesos mintiendo.
Get-Process -Name 'nn-anime', 'nn-anime-desktop' -ErrorAction SilentlyContinue | Stop-Process -Force

# Sonda de sesión, para el día que algo de esto falle: se deja escrito, no se afirma
# nada con ella.
Write-Output "  sesion: SESSIONNAME='$env:SESSIONNAME' interactivo=$([Environment]::UserInteractive)"

# Y la comprobación que de verdad importa antes de empezar: **¿deja este entorno
# escribir donde el instalador tiene que escribir?** Si el registro o el escritorio no
# son escribibles, las comprobaciones 3 y 4 no pueden pasar nunca, y decir «no hay
# entrada en Agregar o quitar programas» culparía al instalador de una restricción del
# entorno. Se para aquí y se dice cuál de las dos cosas falta.
$escritorio = [Environment]::GetFolderPath('Desktop')
$sondaClave = 'HKCU:\Software\nn-anime-sonda-entorno'
$sondaArchivo = Join-Path $escritorio 'nn-anime-sonda-entorno.txt'

try {
  New-Item -Path $sondaClave -Force -ErrorAction Stop | Out-Null
  Remove-Item $sondaClave -Force -ErrorAction Stop
} catch {
  throw "este entorno NO deja escribir en el registro (HKCU), así que el instalador no puede crear su entrada de desinstalación y este paso no mediría lo que dice. Ejecútalo en un runner. Detalle: $($_.Exception.Message)"
}

try {
  Set-Content -Path $sondaArchivo -Value 'sonda' -ErrorAction Stop
  Remove-Item $sondaArchivo -Force -ErrorAction Stop
} catch {
  throw "este entorno NO deja escribir en el escritorio ($escritorio), así que el instalador no puede crear los accesos y este paso no mediría lo que dice. Ejecútalo en un runner. Detalle: $($_.Exception.Message)"
}

Paso 'el entorno deja escribir en el registro y en el escritorio'

$setup = Get-ChildItem -Path $Bundle -Filter '*-setup.exe' -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $setup) { throw "no hay instalador en $Bundle" }

# El instalador de Tauri, en modo `currentUser`, instala aquí. Es también la raíz de
# datos de la aplicación: el desinstalador borra lo suyo y deja lo demás.
$destino = Join-Path $env:LOCALAPPDATA 'nn-anime'
$uninstaller = Join-Path $destino 'uninstall.exe'
$clave = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\nn-anime'

# Los restos de una ejecución anterior harían que la instalación «funcionara» sin
# haber instalado nada.
Get-Process -Name 'nn-anime-desktop' -ErrorAction SilentlyContinue | Stop-Process -Force
Remove-Item -Recurse -Force $destino -ErrorAction SilentlyContinue

# 1. En silencio y **sin UAC** (`RequestExecutionLevel user` en la plantilla de Tauri).
#
#    Se lanza con `cmd /c` y **no** con `Start-Process -FilePath <setup>`: medido aquí,
#    `Start-Process` sobre el `.exe` del instalador se queda colgado y **no llega a
#    crear el destino**, mientras que el mismo instalador con `cmd /c` termina con 0
#    y deja los archivos dentro.
Paso "instalando $($setup.Name) en $destino"
$proceso = Start-Process -FilePath 'cmd.exe' `
  -ArgumentList '/c', "`"$($setup.FullName)`" /S" `
  -Wait -PassThru -WindowStyle Hidden
if ($proceso.ExitCode -ne 0) { throw "el instalador salió con $($proceso.ExitCode)" }

# 2. Los archivos: **un solo ejecutable**, el anfitrión, que lleva el servidor dentro.
#    Si alguien volviera a meter el servidor suelto, el instalador dejaría de ser el
#    archivo único que se publica, y aquí se para.
if (-not (Test-Path (Join-Path $destino 'nn-anime-desktop.exe'))) {
  throw 'no se instaló nn-anime-desktop.exe'
}
if (Test-Path (Join-Path $destino 'nn-anime.exe')) {
  throw 'el instalador dejó un nn-anime.exe suelto: el servidor tiene que viajar dentro del anfitrión'
}
Paso 'el anfitrión está y no hay un segundo ejecutable'

# 3. La entrada de «Agregar o quitar programas».
if (-not (Test-Path $clave)) { throw 'no hay entrada en Agregar o quitar programas' }

$entrada = Get-ItemProperty $clave
if ($entrada.DisplayName -ne 'nn-anime') { throw "la entrada dice «$($entrada.DisplayName)»" }
Paso "entrada de desinstalación: $($entrada.DisplayName) $($entrada.DisplayVersion)"

# 4. Los accesos, y **a qué apuntan**. En modo silencioso los crea la sección de
#    instalación porque la página final no se ve.
$shell = New-Object -ComObject WScript.Shell
$accesos = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'nn-anime.lnk'),
  (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\nn-anime.lnk')
)

foreach ($acceso in $accesos) {
  if (-not (Test-Path $acceso)) { throw "no se creó el acceso $acceso" }

  $apunta = $shell.CreateShortcut($acceso).TargetPath
  if ($apunta -notlike '*nn-anime-desktop.exe') { throw "el acceso $acceso apunta a $apunta" }

  Paso "acceso $(Split-Path -Leaf $acceso) -> $(Split-Path -Leaf $apunta)"
}

# 5. Abrirlo: ventana, servidor extraído del `.exe` único, sólo en loopback, y la X
#    ocultando en la bandeja (la salida ordenada, «Salir», no se automatiza).
Paso 'abriendo el anfitrión instalado'
$anfitrion = Start-Process -FilePath (Join-Path $destino 'nn-anime-desktop.exe') -PassThru

# El archivo único **extrae** ~98 MB antes de lanzar el servidor, y la ventana de la
# bandeja puede dar un `MainWindowHandle` antes de que la aplicación exista. Se
# espera a las dos cosas, no a la primera: mirar el servidor a los 0,5 s de ver un
# handle era medir la extracción, no el arranque.
$servidores = @()
$ventana = $false
for ($intento = 0; $intento -lt 60 -and -not ($servidores.Count -eq 1 -and $ventana); $intento++) {
  Start-Sleep -Seconds 1
  $anfitrion.Refresh()

  if ($anfitrion.HasExited) {
    $registro = Join-Path $env:LOCALAPPDATA 'nn-anime\cache\desktop.log'
    $cola = if (Test-Path $registro) { (Get-Content $registro -Tail 20) -join "`n" } else { '(sin registro)' }
    throw "el anfitrión terminó solo. Registro:`n$cola"
  }

  $servidores = @(Get-Process -Name 'nn-anime' -ErrorAction SilentlyContinue)
  $ventana = $anfitrion.MainWindowHandle -ne 0
}

if ($servidores.Count -eq 1 -and $ventana) {
  Paso "la ventana se abrió: '$($anfitrion.MainWindowTitle)'"
}

# El handle de **la ventana de la aplicación**, tomado ahora. Después de ocultarla,
# `MainWindowHandle` puede pasar a otra ventana del proceso —la de la bandeja—, y
# preguntar por esa diría que sigue visible cuando la aplicación ya se ocultó.
$handleVentana = 0
if ($ventana) { $handleVentana = $anfitrion.MainWindowHandle }

if ($servidores.Count -ne 1) {
  # Sin el registro, este fallo no dice **por qué**: el anfitrión abre el aviso de
  # fallo y la ventana aparece igual. Se vuelca lo que escribió antes de salir y lo
  # que quedó extraído; es la diferencia entre «no arrancó» y «no hay servidor».
  $registro = Join-Path $env:LOCALAPPDATA 'nn-anime\cache\desktop.log'
  if (-not (Test-Path $registro)) { $registro = Join-Path $destino 'desktop.log' }

  $cola = if (Test-Path $registro) {
    (Get-Content $registro -Tail 40) -join "`n"
  } else {
    '(sin registro)'
  }

  $raizBin = Join-Path $env:LOCALAPPDATA 'nn-anime\bin'
  $extraidos = if (Test-Path $raizBin) {
    @(Get-ChildItem $raizBin -Recurse -Filter 'nn-anime.exe' |
      ForEach-Object { "$($_.FullName) ($($_.Length) bytes)" }) -join "`n"
  } else {
    '(no hay carpeta bin)'
  }

  throw "se esperaba un servidor y hay $($servidores.Count). Registro:`n$cola`nExtraídos:`n$extraidos"
}

if (-not $ventana) {
  throw 'el servidor arrancó, pero el anfitrión no abrió ninguna ventana en 60 s'
}

# La prueba de que el servidor viaja **dentro** del `.exe`: el proceso que corre
# sale de la carpeta de datos, no de la carpeta de instalación. Si el anfitrión se
# hubiera construido antes que el servidor, aquí no habría nada extraído y la
# ventana habría enseñado el aviso de fallo.
$rutaServidor = $servidores[0].Path
$raizBin = Join-Path $env:LOCALAPPDATA 'nn-anime\bin'

if (-not $rutaServidor -or -not (Test-Path -LiteralPath $rutaServidor)) {
  throw "no se puede leer la ruta del servidor en ejecución: '$rutaServidor'"
}

$padre = Split-Path (Split-Path $rutaServidor -Parent) -Parent
if ([IO.Path]::GetFullPath($padre) -ne [IO.Path]::GetFullPath($raizBin)) {
  throw "el servidor corre desde $rutaServidor y no desde $raizBin (no se extrajo del .exe)"
}
Paso "el servidor embebido se extrajo en $rutaServidor"

$escuchas = @(Get-NetTCPConnection -OwningProcess $servidores[0].Id -State Listen -ErrorAction SilentlyContinue)
if ($escuchas.Count -lt 1) { throw 'el servidor no está escuchando' }

# Sólo loopback: escuchar en `0.0.0.0` expondría la aplicación a la red local, y
# `SPEC-cli-launcher.md` lo prohíbe en su lista de *Never*.
$permitidas = @('127.0.0.1', '::1', '::ffff:127.0.0.1')
$fuera = @($escuchas | Where-Object { $_.LocalAddress -notin $permitidas })

if ($fuera.Count -gt 0) { throw "el servidor escucha fuera de loopback: $($fuera[0].LocalAddress)" }
Paso "el servidor escucha en $($escuchas[0].LocalAddress):$($escuchas[0].LocalPort)"

# La X **oculta** en la bandeja; no cierra. Es el comportamiento del `.exe` que se
# publica, y por eso se mide aquí en vez de exigir el que decía el README viejo.
#
# La ventana acaba de abrirse: se le da un momento para que el bucle de eventos
# esté asentado. Cerrar en el mismo instante del anuncio del servidor hacía que,
# a veces, el cierre llegara antes que el manejador y la aplicación terminara.
Start-Sleep -Seconds 2

if ($handleVentana -eq 0) { throw 'no hay una ventana del anfitrión a la que mandar la X' }

if (-not ('NnAnimeVentana' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class NnAnimeVentana
{
    public const uint WM_CLOSE = 0x0010;

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindowVisible(IntPtr hWnd);
}
'@
}

# La X se manda **a la ventana que se midió**, no a `CloseMainWindow()`: después de
# crear el icono de la bandeja, `MainWindowHandle` puede apuntar a otra ventana del
# proceso, y el cierre llegaba a la ventana equivocada. En el runner eso terminaba
# la aplicación y hacía fallar una prueba que el comportamiento del anfitrión sí
# pasa.
$cerrada = [NnAnimeVentana]::PostMessage(
  $handleVentana,
  [NnAnimeVentana]::WM_CLOSE,
  [IntPtr]::Zero,
  [IntPtr]::Zero
)
if (-not $cerrada) { throw 'no se pudo cerrar la ventana del anfitrión' }
Start-Sleep -Seconds 3
$anfitrion.Refresh()

if ($anfitrion.HasExited) {
  throw 'la X cerró la aplicación: se esperaba que la ocultara en la bandeja'
}

$handle = $handleVentana
$visible = $false
if ($handle -ne 0) {
  $visible = [NnAnimeVentana]::IsWindowVisible($handle)
}

if ($visible) {
  throw "la ventana sigue visible después de cerrarla (título: '$($anfitrion.MainWindowTitle)')"
}
Paso 'la ventana quedó oculta y la aplicación sigue viva en la bandeja'

# La salida ordenada es «Salir» del menú de la bandeja, y no se automatiza aquí. Se
# mata el anfitrión y, si el servidor quedó vivo —Windows todavía no tiene el Job
# Object de T155—, también el servidor. Lo que se exige es que la limpieza deje cero
# procesos, no que la X los deje: eso es lo que hace «Salir», y no se finge medirlo.
$anfitrion | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

$servidoresVivos = @(Get-Process -Name 'nn-anime' -ErrorAction SilentlyContinue)
if ($servidoresVivos.Count -gt 0) {
  $servidoresVivos | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
}

$vivos = @(Get-Process -Name 'nn-anime', 'nn-anime-desktop' -ErrorAction SilentlyContinue)
if ($vivos.Count -ne 0) {
  # `Stop-Process` y no `.Kill()`: si uno ya murió entre la captura y aquí, `.Kill()`
  # lanzaría y taparía el mensaje que de verdad importa.
  $vivos | Stop-Process -Force -ErrorAction SilentlyContinue
  throw "quedaron $($vivos.Count) procesos vivos después de la limpieza"
}
Paso 'la limpieza no dejó ningún proceso'

# 6. Los datos del usuario, **sembrados antes de desinstalar**. No basta con mirar si
#    el directorio existía antes: en un runner limpio lo crea la aplicación al
#    arrancar, no el instalador. Se siembra un centinela en la raíz y se exige que
#    siga ahí después de desinstalar.
$centinela = Join-Path $destino 'no-borrar.txt'
Set-Content -Path $centinela -Value 'sonda' -Encoding ascii
Paso 'los datos del usuario están y llevan su centinela'

# Desinstalar. El desinstalador de Tauri copia el proceso a un temporal y borra el
# de la carpeta, así que se espera a que desaparezca el ejecutable en vez de a un
# código de salida que mide al proceso equivocado.
$proceso = Start-Process -FilePath 'cmd.exe' `
  -ArgumentList '/c', "`"$uninstaller`" /S" `
  -Wait -PassThru -WindowStyle Hidden

for ($intento = 0; $intento -lt 30 -and (Test-Path $uninstaller); $intento++) {
  Start-Sleep -Milliseconds 500
}

if (Test-Path (Join-Path $destino 'nn-anime-desktop.exe')) {
  throw 'el desinstalador dejó nn-anime-desktop.exe'
}
if (Test-Path $uninstaller) { throw 'el desinstalador dejó uninstall.exe' }
if (Test-Path (Join-Path $destino 'nn-anime.exe')) {
  throw 'el desinstalador dejó un nn-anime.exe suelto'
}
if (Test-Path $clave) { throw 'el desinstalador dejó la entrada del registro' }
Paso 'el desinstalador se llevó los archivos y las claves'

if (-not (Test-Path $centinela)) {
  throw "el desinstalador borró los datos del usuario en $destino: desinstalar no es pedir que se pierdan"
}
Remove-Item $centinela -Force -ErrorAction SilentlyContinue
Paso 'los datos del usuario, con su base, siguen donde estaban'

Write-Output 'el instalador instala, crea los accesos, abre la ventana y desinstala'
