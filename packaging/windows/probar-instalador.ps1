# Probar el instalador de Windows de verdad.
#
# Lo que `docs/release.md` declaraba sin probar: nadie había **ejecutado** el
# instalador. En la máquina donde se escribió el `.nsi` no se podía juzgar, y el
# motivo está medido: lanzado en silencio instalaba los archivos pero no dejaba ni
# los accesos ni las claves del registro, y todo apuntaba a un contexto sin
# escritorio interactivo —NSIS falla en silencio al crear accesos y al escribir el
# registro—. Un runner de GitHub sí tiene sesión, así que aquí sí se puede juzgar.
#
# Se comprueba lo que un usuario notaría, en el orden en que lo notaría:
#   1. Se instala en silencio, sin permisos de administrador.
#   2. Quedan los dos ejecutables y el icono.
#   3. Hay entrada en «Agregar o quitar programas».
#   4. Los dos accesos existen y abren el **anfitrión**, no la consola.
#   5. Al abrirlo aparece una ventana, el servidor escucha **sólo en loopback** y al
#      cerrar la ventana no queda ningún proceso vivo.
#   6. Al desinstalar se van los archivos y las claves, y los datos del usuario
#      **se quedan**.
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

$setup = Get-ChildItem -Path $Release -Filter 'nn-anime-*-setup.exe' -ErrorAction SilentlyContinue |
  Select-Object -First 1

if (-not $setup) { throw "no hay instalador en $Release" }

$destino = Join-Path $env:RUNNER_TEMP 'nn-anime-instalado'
$clave = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\nn-anime'
$datos = Join-Path $env:APPDATA 'nn-anime'

Remove-Item -Recurse -Force $destino -ErrorAction SilentlyContinue

# 1. En silencio y **sin UAC**: el `.nsi` declara `RequestExecutionLevel user`. `/D`
#    fija el destino, tiene que ir el último y sin comillas.
Paso "instalando en $destino"
$proceso = Start-Process -FilePath $setup.FullName -ArgumentList '/S', "/D=$destino" -Wait -PassThru
if ($proceso.ExitCode -ne 0) { throw "el instalador salió con $($proceso.ExitCode)" }

# 2. Los archivos: los dos ejecutables, porque el acceso abre el anfitrión y el
#    anfitrión necesita al servidor a su lado.
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
$datosAntes = Test-Path $datos
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
$anfitrion.CloseMainWindow() | Out-Null
Start-Sleep -Seconds 5

$vivos = @(Get-Process -Name 'nn-anime', 'nn-anime-desktop' -ErrorAction SilentlyContinue)

if ($vivos.Count -ne 0) {
  $vivos | ForEach-Object { $_.Kill() }
  throw "al cerrar la ventana quedaron $($vivos.Count) procesos vivos"
}
Paso 'al cerrar la ventana no quedó ningún proceso'

# 6. Desinstalar: se van los archivos y las claves; los datos se quedan.
$desinstalador = Join-Path $destino 'Desinstalar nn-anime.exe'
if (-not (Test-Path $desinstalador)) { throw 'no hay desinstalador' }

$proceso = Start-Process -FilePath $desinstalador -ArgumentList '/S' -Wait -PassThru
if ($proceso.ExitCode -ne 0) { throw "el desinstalador salió con $($proceso.ExitCode)" }

foreach ($archivo in 'nn-anime.exe', 'nn-anime-desktop.exe') {
  if (Test-Path (Join-Path $destino $archivo)) { throw "el desinstalador dejó $archivo" }
}
if (Test-Path $clave) { throw 'el desinstalador dejó la entrada del registro' }
Paso 'el desinstalador se llevó los archivos y las claves'

if ($datosAntes -and -not (Test-Path $datos)) {
  throw 'el desinstalador borró los datos del usuario: desinstalar no es pedir que se pierdan'
}
Paso 'los datos del usuario siguen donde estaban'

Write-Output 'el instalador instala, crea los accesos, abre la ventana y desinstala'
