!define APP_NAME "Portfolio"
!define APP_IDENTIFIER "cgeosoft.portfolio.desktop"
!define APP_PUBLISHER "Christos Georgiou"
!define APP_URL "https://portfolio.cgeosoft.com"
!define APP_EXE "bin\launcher.exe"

RequestExecutionLevel user
SetCompressor /SOLID lzma

Name "${APP_NAME} ${VERSION}"
OutFile "${OUTPUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\Portfolio"
InstallDirRegKey HKCU "Software\${APP_IDENTIFIER}" "InstallDir"

!include "MUI2.nsh"

!define MUI_ICON "${ICON_FILE}"
!define MUI_UNICON "${ICON_FILE}"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Launch Portfolio"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "${SOURCE_DIR}\*"

  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateDirectory "$SMPROGRAMS\Portfolio"
  CreateShortcut "$SMPROGRAMS\Portfolio\Portfolio.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\Resources\app-icon.ico"
  CreateShortcut "$SMPROGRAMS\Portfolio\Uninstall Portfolio.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortcut "$DESKTOP\Portfolio.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\Resources\app-icon.ico"

  WriteRegStr HKCU "Software\${APP_IDENTIFIER}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_IDENTIFIER}" "DisplayName" "Portfolio"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_IDENTIFIER}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_IDENTIFIER}" "DisplayIcon" "$INSTDIR\${APP_EXE}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_IDENTIFIER}" "Publisher" "${APP_PUBLISHER}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_IDENTIFIER}" "HelpLink" "${APP_URL}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_IDENTIFIER}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_IDENTIFIER}" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_IDENTIFIER}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  RMDir /r "$INSTDIR"
  Delete "$SMPROGRAMS\Portfolio\Portfolio.lnk"
  Delete "$SMPROGRAMS\Portfolio\Uninstall Portfolio.lnk"
  RMDir "$SMPROGRAMS\Portfolio"
  Delete "$DESKTOP\Portfolio.lnk"
  DeleteRegKey HKCU "Software\${APP_IDENTIFIER}"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_IDENTIFIER}"
SectionEnd
