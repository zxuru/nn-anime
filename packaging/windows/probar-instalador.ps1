# Probar el instalador de Windows de verdad.
#
# Lo que `docs/release.md` declaraba sin probar: nadie había **ejecutado** el
# instalador. En la máquina donde se escribió el `.nsi` no se puede juzgar del todo,
# y **el motivo está medido**: el sandbox del agente deniega las escrituras fuera del
# espacio de trabajo, y eso incluye el registro —`HKCU` vive en `NTUSER.DAT`— y el
# escritorio. Medido con `reg.exe add`, que usa la misma API que NSIS: «Acceso
# denegado». Y NSIS **se calla** los dos fallos, así que el efecto no aparece y
# parece que el `.nsi` está mal cuando no lo está.
#
# Lo que sí funciona ahí, y también está medido: instalar los archivos. Con `cmd /c`
# el instalador sale con 0 y deja los dos ejecutables en el destino. Por eso el guion
# empieza comprobando si el entorno deja escribir en el registro y en el escritorio
# **antes** de juzgar nada: sin eso, el paso reportaría un fallo del instalador que en
# realidad es del entorno.
#
# Se comprueba lo que un usuario notaría, en el orden en que lo notaría:
#   1. Se instala en silencio, sin permisos de administrador.
#   2. Queda **un solo ejecutable** —el anfitrión, que lleva el servidor dentro— y el
#      icono. Ya no hay un `nn-anime.exe` que conservar al lado.
#   3. Hay entrada en «Agregar o quitar programas».
#   4. Los dos accesos existen y abren el **anfitrión**.
#   5. Al abrirlo aparece una ventana, el servidor se extrae a
#      `%LOCALAPPDATA%\nn-anime\bin\<versión>` y escucha **sólo en loopback**. Al
#      cerrar la ventana la aplicación **se oculta en la bandeja** (no se apaga):
#      la salida ordenada es «Salir», que no se automatiza aquí; la limpieza final
#      mata los procesos y exige que no quede ninguno.
#   6. Al desinstalar se van los archivos y las claves, y **los datos del usuario se
#      quedan** —la base incluida, que vive en `%LOCALAPPDATA%\nn-anime`—.
#
# Uso: pwsh -NoProfile -File packaging/windows/probar-instalador.ps1 -Release release

[CmdletBinding()]
param(
  [string] $Release = 'release'
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
# entrada en Agregar o quitar programas» culparía al `.nsi` de una restricción del
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

$setup = Get-ChildItem -Path $Release -Filter 'nn-anime-*-setup.exe' -ErrorAction SilentlyContinue |
  Select-Object -First 1

if (-not $setup) { throw "no hay instalador en $Release" }

# Fuera de un runner `RUNNER_TEMP` no existe, y `Join-Path $null` daría un error que
# no habla de lo que falta.
$raizTemp = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$destino = Join-Path $raizTemp 'nn-anime-instalado'

$clave = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\nn-anime'

# El anfitrión fija los tres directorios bajo una sola raíz —datos, configuración y
# caché—, así que `%APPDATA%` ya no se toca: todo vive en `%LOCALAPPDATA%\nn-anime`.
# Mirar dos directorios daría por bueno uno que la aplicación ya no usa.
$datos = @(Join-Path $env:LOCALAPPDATA 'nn-anime')

Remove-Item -Recurse -Force $destino -ErrorAction SilentlyContinue

# 1. En silencio y **sin UAC**: el `.nsi` declara `RequestExecutionLevel user`. `/D`
#    fija el destino, tiene que ir el último y sin comillas.
#
#    Se lanza con `cmd /c` y **no** con `Start-Process -FilePath <setup>`: medido aquí,
#    `Start-Process` sobre el `.exe` del instalador se queda colgado y **no llega a
#    crear el destino**, mientras que el mismo instalador con `cmd /c` termina con 0
#    y deja los archivos dentro.
Paso "instalando en $destino"
$proceso = Start-Process -FilePath 'cmd.exe' `
  -ArgumentList '/c', "`"$($setup.FullName)`" /S /D=$destino" `
  -Wait -PassThru -WindowStyle Hidden
if ($proceso.ExitCode -ne 0) { throw "el instalador salió con $($proceso.ExitCode)" }

# 2. Los archivos: **un solo ejecutable**, el anfitrión, que lleva el servidor
#    dentro. Si alguien volviera a meter el servidor suelto, el instalador dejaría
#    de ser el archivo único que se publica, y aquí se para.
foreach ($archivo in 'nn-anime-desktop.exe', 'nn-anime.ico') {
  if (-not (Test-Path (Join-Path $destino $archivo))) { throw "no se instaló $archivo" }
}
if (Test-Path (Join-Path $destino 'nn-anime.exe')) {
  throw 'el instalador dejó un nn-anime.exe suelto: el servidor tiene que viajar dentro del anfitrión'
}
Paso 'el anfitrión y el icono están, y no hay un segundo ejecutable'

# 3. La entrada de «Agregar o quitar programas».
if (-not (Test-Path $clave)) { throw 'no hay entrada en Agregar o quitar programas' }

$entrada = Get-ItemProperty $clave
if ($entrada.DisplayName -ne 'nn-anime') { throw "la entrada dice «$($entrada.DisplayName)»" }
Paso "entrada de desinstalación: $($entrada.DisplayName) $($entrada.DisplayVersion)"

# 4. Los accesos, y **a qué apuntan**. Es lo que quita la consola de la experiencia.
$shell = New-Object -ComObject WScript.Shell
$accesos = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'nn-anime.lnk'),
  (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\nn-anime\nn-anime.lnk')
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

$ventana = $false
for ($intento = 0; $intento -lt 60 -and -not $ventana; $intento++) {
  Start-Sleep -Seconds 1
  $anfitrion.Refresh()

  if ($anfitrion.HasExited) {
    $registro = Join-Path $env:LOCALAPPDATA 'nn-anime\cache\desktop.log'
    $cola = if (Test-Path $registro) { (Get-Content $registro -Tail 20) -join "`n" } else { '(sin registro)' }
    throw "el anfitrión terminó solo. Registro:`n$cola"
  }

  $ventana = $anfitrion.MainWindowHandle -ne 0
}

if (-not $ventana) { throw 'el anfitrión no abrió ninguna ventana en 60 s' }
Paso 'la ventana se abrió'

$servidores = @(Get-Process -Name 'nn-anime' -ErrorAction SilentlyContinue)
if ($servidores.Count -ne 1) { throw "se esperaba un servidor y hay $($servidores.Count)" }

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
if (-not $anfitrion.CloseMainWindow()) { throw 'no se pudo cerrar la ventana del anfitrión' }
Start-Sleep -Seconds 3
$anfitrion.Refresh()

if ($anfitrion.HasExited) {
  throw 'la X cerró la aplicación: se esperaba que la ocultara en la bandeja'
}

$handle = $anfitrion.MainWindowHandle
$visible = $false
if ($handle -ne 0) {
  if (-not ('NnAnimeVentana' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class NnAnimeVentana
{
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindowVisible(IntPtr hWnd);
}
'@
  }

  $visible = [NnAnimeVentana]::IsWindowVisible($handle)
}

if ($visible) { throw 'la ventana sigue visible después de cerrarla' }
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
#    el directorio existía antes: en un runner limpio no existe —lo crea la aplicación
#    al arrancar, no el instalador—, así que la comprobación pasaría sin medir nada.
#    Se siembra un centinela en la raíz y se exige que siga ahí.
foreach ($directorio in $datos) {
  if (-not (Test-Path $directorio)) { throw "la aplicación no creó $directorio" }

  Set-Content -Path (Join-Path $directorio 'no-borrar.txt') -Value 'sonda' -Encoding ascii
}
Paso 'los datos del usuario están y llevan su centinela'

# Desinstalar: se van los archivos y las claves; los centinelas se quedan.
$desinstalador = Join-Path $destino 'Desinstalar nn-anime.exe'
if (-not (Test-Path $desinstalador)) { throw 'no hay desinstalador' }

# `_?=<carpeta>` le dice al desinstalador dónde está instalado. Medido aquí: sin él
# —y con la clave del registro ausente, que es lo que pasa cuando el entorno no deja
# escribirla— el desinstalador **sale con 0 y no borra nada**; con él borra el
# directorio entero.
#
# Y **no se exige código de salida**: medido, con `_?=` termina con **1** después de
# haber borrado todo. El código no mide la desinstalación —NSIS relanza el
# desinstalador desde una copia temporal, así que el proceso que se espera no es el
# que hace el trabajo—, y por eso lo que se juzga es el **efecto**, que es lo que le
# importa a quien desinstala.
$proceso = Start-Process -FilePath 'cmd.exe' `
  -ArgumentList '/c', "`"$desinstalador`" /S _?=$destino" `
  -Wait -PassThru -WindowStyle Hidden

if ($proceso.ExitCode -ne 0) {
  Write-Output "  (el desinstalador salió con $($proceso.ExitCode); se juzga por el efecto)"
}

foreach ($archivo in 'nn-anime-desktop.exe', 'nn-anime.ico') {
  if (Test-Path (Join-Path $destino $archivo)) { throw "el desinstalador dejó $archivo" }
}
if (Test-Path (Join-Path $destino 'nn-anime.exe')) {
  throw 'el desinstalador dejó un nn-anime.exe suelto'
}
if (Test-Path $clave) { throw 'el desinstalador dejó la entrada del registro' }
Paso 'el desinstalador se llevó los archivos y las claves'

foreach ($directorio in $datos) {
  $centinela = Join-Path $directorio 'no-borrar.txt'

  if (-not (Test-Path $centinela)) {
    throw "el desinstalador borró los datos del usuario en ${directorio}: desinstalar no es pedir que se pierdan"
  }

  Remove-Item $centinela -Force -ErrorAction SilentlyContinue
}
Paso 'los datos del usuario, con su base, siguen donde estaban'

Write-Output 'el instalador instala, crea los accesos, abre la ventana y desinstala'
