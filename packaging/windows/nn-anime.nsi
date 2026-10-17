; Instalador de nn-anime para Windows.
;
; Instalación **por usuario**: va a `%LOCALAPPDATA%\Programs\nn-anime` y no pide
; permisos de administrador. Un programa que sirve en 127.0.0.1 y guarda sus
; datos en la carpeta del usuario no tiene nada que hacer en `Program Files`, y
; pedir UAC para eso es la forma más rápida de que alguien no lo instale.
;
; Lo que **no** hace el desinstalador: borrar los datos. `%APPDATA%\nn-anime` y
; `%LOCALAPPDATA%\nn-anime` tienen la base, los ajustes y los plugins de quien lo
; usó; desinstalar el programa no es pedir que se pierdan. Se dice en la página
; final y en el README.
;
; Los defines los pasa `scripts/package/windows.ts`.

Unicode true

!include "MUI2.nsh"
!include "FileFunc.nsh"

!ifndef VERSION
  !define VERSION "0.0.0"
!endif

; La versión de cuatro números que Windows guarda en el ejecutable. `VERSION`
; puede llevar preestreno (`1.2.3-rc.1`) y ahí no cabe.
!ifndef VERSION4
  !define VERSION4 "0.0.0.0"
!endif

!ifndef SOURCE
  !error "Falta SOURCE: el directorio que contiene nn-anime.exe"
!endif

!ifndef OUTFILE
  !error "Falta OUTFILE: la ruta del instalador que hay que escribir"
!endif

!ifndef ICON
  !define ICON ""
!endif

; El icono del asistente, que **no** es el mismo que el que se instala.
;
; NSIS no admite un `.ico` con la entrada de 256 px —la escribe como un cero y
; aborta con «invalid icon file size»—, así que el asistente lleva uno sin ese
; tamaño y el programa instala el completo, que es el que usan el explorador, los
; accesos y «Agregar o quitar programas».
!ifndef MUIICON
  !define MUIICON ""
!endif

!define APP_NAME "nn-anime"
!define APP_EXE "nn-anime.exe"
; El anfitrión de ventana. Vive **al lado** del servidor y no dentro: incrustarlo
; duplicaría los 93,8 MB del ejecutable por plataforma, y así la consola sigue
; existiendo para quien quiera `nn-anime "naruto"` desde una terminal.
!define APP_HOST "nn-anime-desktop.exe"
!define APP_ICO "nn-anime.ico"
!define UNINSTALLER "Desinstalar nn-anime.exe"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\nn-anime"

Name "${APP_NAME}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\nn-anime"
InstallDirRegKey HKCU "Software\nn-anime" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma

VIProductVersion "${VERSION4}"
VIAddVersionKey "ProductName" "${APP_NAME}"
VIAddVersionKey "FileDescription" "Instalador de ${APP_NAME}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "${APP_NAME}"

!define MUI_ABORTWARNING

; El icono sólo si existe: `MUI_ICON` con una ruta que no está rompe la
; compilación, y quedarse sin icono no es motivo para no publicar.
!if "${ICON}" != ""
  !define ACCESO_ICONO "$INSTDIR\${APP_ICO}"
!else
  !define ACCESO_ICONO "$INSTDIR\${APP_EXE}"
!endif

!if "${MUIICON}" != ""
  !define MUI_ICON "${MUIICON}"
  !define MUI_UNICON "${MUIICON}"
!endif

; ¿Va el anfitrión dentro? Se pregunta al **archivo**, no a quien compila: un
; `bun run package --skip-desktop` produce un instalador sin él, y entonces el
; acceso abre la consola de siempre en lugar de romperse. El empaquetado de la
; release lo exige (ver `scripts/package.ts`), así que este camino es sólo para
; quien compila a mano sin el árbol de Rust.
!if /FileExists "${SOURCE}\${APP_HOST}"
  !define WITH_HOST
!endif

; A qué ejecutable apunta el acceso del escritorio. Con anfitrión, a la ventana:
; **es lo único que quita la consola** de la experiencia de quien instala.
!ifdef WITH_HOST
  !define ACCESO_EXE "$INSTDIR\${APP_HOST}"
!else
  !define ACCESO_EXE "$INSTDIR\${APP_EXE}"
!endif

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "Spanish"

Section "${APP_NAME}" SecApp
  SetOutPath "$INSTDIR"
  File "${SOURCE}\${APP_EXE}"

  ; El anfitrión, si el empaquetado lo compiló. Va en el **mismo directorio**
  ; porque el anfitrión busca al servidor como hermano, por su propio nombre.
  !ifdef WITH_HOST
    File "${SOURCE}\${APP_HOST}"
  !endif

  ; El icono lo lleva el instalador porque el ejecutable no puede: `--windows-icon`
  ; de Bun 1.4.3 produce un `.exe` que Windows rechaza —medido—, así que el icono
  ; lo usan los accesos y «Agregar o quitar programas» en lugar del propio
  ; programa. Cuando Bun lo arregle, se pone ahí y este archivo se queda igual.
  !if "${ICON}" != ""
    File /oname=${APP_ICO} "${ICON}"
  !endif

  WriteUninstaller "$INSTDIR\${UNINSTALLER}"

  ; El acceso abre **la ventana**, no la consola: el anfitrión lanza el servidor,
  ; lee su dirección y abre la ventana en ella, y al cerrarla le pide el cierre y
  ; lo apaga. La consola sigue existiendo en el PATH del usuario para quien la
  ; quiera; lo que ya no aparece es una ventana negra al pulsar el acceso.
  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "${ACCESO_EXE}" "" "${ACCESO_ICONO}" 0
  CreateShortCut "$DESKTOP\${APP_NAME}.lnk" "${ACCESO_EXE}" "" "${ACCESO_ICONO}" 0

  WriteRegStr HKCU "Software\nn-anime" "InstallDir" "$INSTDIR"

  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "${APP_NAME}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "${ACCESO_ICONO}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\${UNINSTALLER}"'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1

  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "EstimatedSize" "$0"
SectionEnd

Section "Uninstall"
  Delete "$DESKTOP\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk"
  RMDir "$SMPROGRAMS\${APP_NAME}"

  Delete "$INSTDIR\${APP_EXE}"
  ; El anfitrión puede no estar (instalador compilado sin el árbol de Rust):
  ; `Delete` de un archivo que no existe no es un error en NSIS.
  Delete "$INSTDIR\${APP_HOST}"
  Delete "$INSTDIR\${APP_ICO}"
  Delete "$INSTDIR\${UNINSTALLER}"
  ; Sólo si quedó vacío: si alguien dejó algo suyo ahí, no se borra.
  RMDir "$INSTDIR"

  ; Los datos **no** se tocan: `%APPDATA%\nn-anime` y `%LOCALAPPDATA%\nn-anime`
  ; siguen ahí. Desinstalar no es pedir que se pierda la base ni los plugins.
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  DeleteRegKey HKCU "Software\nn-anime"
SectionEnd
