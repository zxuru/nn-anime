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
#   2. Quedan los dos ejecutables y el icono.
#   3. Hay entrada en «Agregar o quitar programas».
#   4. Los dos accesos existen y abren el **anfitrión**, no la consola.
#   5. Al abrirlo aparece una ventana, el servidor escucha **sólo en loopback** y al
#      cerrar la ventana no queda ningún proceso vivo.
#   6. Al desinstalar se van los archivos y las claves, y **los datos del usuario se
#      quedan** —la base incluida, que vive en `%LOCALAPPDATA%`, no en `%APPDATA%`—.
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

# Los dos directorios del usuario, y **no son lo mismo**: la configuración va a
# `%APPDATA%` y los datos —la base de datos entre ellos— a `%LOCALAPPDATA%`. Mirar
# sólo el primero dejaría la base fuera de la comprobación.
$datos = @(
  (Join-Path $env:APPDATA 'nn-anime'),
  (Join-Path $env:LOCALAPPDATA 'nn-anime')
)

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

# 2. Los archivos: los dos ejecutables, porque el acceso abre el anfitrión y el
#    anfitrión necesita al servidor a su lado. Esta comprobación es además la que
#    impide que una release publique **en silencio** un instalador sin ventana: si el
#    anfitrión no viajó dentro, aquí se para.
foreach ($archivo in 'nn-anime.exe', 'nn-anime-desktop.exe', 'nn-anime.ico') {
  if (-not (Test-Path (Join-Path $destino $archivo))) { throw "no se instaló $archivo" }
}
Paso 'los dos ejecutables y el icono están'

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

# 5. Abrirlo: ventana, servidor escuchando sólo en loopback, y cierre limpio.
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

$escuchas = @(Get-NetTCPConnection -OwningProcess $servidores[0].Id -State Listen -ErrorAction SilentlyContinue)
if ($escuchas.Count -lt 1) { throw 'el servidor no está escuchando' }

# Sólo loopback: escuchar en `0.0.0.0` expondría la aplicación a la red local, y
# `SPEC-cli-launcher.md` lo prohíbe en su lista de *Never*.
$permitidas = @('127.0.0.1', '::1', '::ffff:127.0.0.1')
$fuera = @($escuchas | Where-Object { $_.LocalAddress -notin $permitidas })

if ($fuera.Count -gt 0) { throw "el servidor escucha fuera de loopback: $($fuera[0].LocalAddress)" }
Paso "el servidor escucha en $($escuchas[0].LocalAddress):$($escuchas[0].LocalPort)"

# Cerrar la ventana es la forma normal de salir: tiene que apagar el servidor.
if (-not $anfitrion.CloseMainWindow()) { throw 'no se pudo cerrar la ventana del anfitrión' }
Start-Sleep -Seconds 5

$vivos = @(Get-Process -Name 'nn-anime', 'nn-anime-desktop' -ErrorAction SilentlyContinue)

if ($vivos.Count -ne 0) {
  # `Stop-Process` y no `.Kill()`: si uno ya murió entre la captura y aquí, `.Kill()`
  # lanzaría y taparía el mensaje que de verdad importa, que es el `throw` de abajo.
  $vivos | Stop-Process -Force -ErrorAction SilentlyContinue
  throw "al cerrar la ventana quedaron $($vivos.Count) procesos vivos"
}
Paso 'al cerrar la ventana no quedó ningún proceso'

# 6. Los datos del usuario, **sembrados antes de desinstalar**. No basta con mirar si
#    el directorio existía antes: en un runner limpio no existe —lo crea la aplicación
#    al arrancar, no el instalador—, así que la comprobación pasaría sin medir nada.
#    Se siembra un centinela en los DOS directorios y se exige que siga ahí.
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

foreach ($archivo in 'nn-anime.exe', 'nn-anime-desktop.exe') {
  if (Test-Path (Join-Path $destino $archivo)) { throw "el desinstalador dejó $archivo" }
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
