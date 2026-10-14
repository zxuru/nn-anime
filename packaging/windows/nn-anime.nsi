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

!define APP_NAME "nn-anime"
!define APP_EXE "nn-anime.exe"
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
  !define MUI_ICON "${ICON}"
  !define MUI_UNICON "${ICON}"
  !define ACCESO_ICONO "$INSTDIR\${APP_ICO}"
!else
  !define ACCESO_ICONO "$INSTDIR\${APP_EXE}"
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

  ; El icono lo lleva el instalador porque el ejecutable no puede: `--windows-icon`
  ; de Bun 1.4.3 produce un `.exe` que Windows rechaza —medido—, así que el icono
  ; lo usan los accesos y «Agregar o quitar programas» en lugar del propio
  ; programa. Cuando Bun lo arregle, se pone ahí y este archivo se queda igual.
  !if "${ICON}" != ""
    File /oname=${APP_ICO} "${ICON}"
  !endif

  WriteUninstaller "$INSTDIR\${UNINSTALLER}"

  ; El acceso abre el ejecutable, que es una aplicación de consola: la ventana
  ; que aparece **es** la aplicación mientras vive, y cerrarla la apaga. Ocultarla
  ; dejaría un servidor sin forma de pararlo.
  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "${ACCESO_ICONO}" 0
  CreateShortCut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "${ACCESO_ICONO}" 0

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
  Delete "$INSTDIR\${APP_ICO}"
  Delete "$INSTDIR\${UNINSTALLER}"
  ; Sólo si quedó vacío: si alguien dejó algo suyo ahí, no se borra.
  RMDir "$INSTDIR"

  ; Los datos **no** se tocan: `%APPDATA%\nn-anime` y `%LOCALAPPDATA%\nn-anime`
  ; siguen ahí. Desinstalar no es pedir que se pierda la base ni los plugins.
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  DeleteRegKey HKCU "Software\nn-anime"
SectionEnd
