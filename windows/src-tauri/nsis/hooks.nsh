; Qanot AI installer hooks, including the verified per-user brand migration.
;
; The app stages coucou-hook.exe into %LOCALAPPDATA%\Coucou\bin at launch, so the
; installer never recorded it and the default uninstaller leaves it behind. The
; inbox and the log live in the same place and are ours too.
;
; Claude Code's own settings.json is deliberately NOT touched here: it belongs to
; the user, it may contain hooks from other tools, and rewriting somebody's
; config from an uninstaller with no diff and no consent is exactly what the rest
; of this app goes out of its way not to do. A relay that is gone exits 0 without
; printing anything, so a leftover entry costs nothing beyond a dead path.

!define QANOT_LEGACY_UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Coucou"
!define QANOT_LEGACY_MANUPRODUCTKEY "Software\louisraille\Coucou"
!define QANOT_RUNKEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define QANOT_APPROVEDKEY "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"

Var QanotLegacyDir
Var QanotUpgradeDir

; Only matching current-user records identify an installation we may replace.
; This function never runs its uninstaller and never changes user data.
Function QanotFindLegacyInstall
  Push $R0
  Push $R1
  StrCpy $QanotLegacyDir ""
  ReadRegStr $R0 HKCU "${QANOT_LEGACY_UNINSTKEY}" "DisplayName"
  StrCmp $R0 "Coucou" 0 qanot_legacy_done
  ReadRegStr $R0 HKCU "${QANOT_LEGACY_UNINSTKEY}" "Publisher"
  StrCmp $R0 "louisraille" 0 qanot_legacy_done
  ReadRegStr $R0 HKCU "${QANOT_LEGACY_MANUPRODUCTKEY}" ""
  StrCmp $R0 "" qanot_legacy_done
  GetFullPathName $R1 "$R0"
  StrCmp $R0 $R1 0 qanot_legacy_done
  ${GetRoot} "$R0" $R1
  StrCmp $R0 $R1 qanot_legacy_done
  StrCmp $R0 "$R1\" qanot_legacy_done
  ReadRegStr $R1 HKCU "${QANOT_LEGACY_UNINSTKEY}" "InstallLocation"
  StrCmp $R1 '$\"$R0$\"' 0 qanot_legacy_done
  ReadRegStr $R1 HKCU "${QANOT_LEGACY_UNINSTKEY}" "UninstallString"
  StrCmp $R1 '$\"$R0\uninstall.exe$\"' 0 qanot_legacy_done
  IfFileExists "$R0\coucou.exe" 0 qanot_legacy_done
  IfFileExists "$R0\uninstall.exe" 0 qanot_legacy_done
  StrCpy $QanotLegacyDir $R0
qanot_legacy_done:
  Pop $R1
  Pop $R0
FunctionEnd

; Preserve an explicitly owned no-argument startup entry and its Task Manager
; override. Never enable a disabled override or overwrite an existing new entry.
Function QanotMigrateOwnedAutostart
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  ReadRegStr $0 HKCU "${QANOT_RUNKEY}" "Coucou"
  StrCmp $0 "$QanotUpgradeDir\coucou.exe " qanot_autostart_owned
  StrCmp $0 "$QanotUpgradeDir\coucou.exe" qanot_autostart_owned
  StrCmp $0 '$\"$QanotUpgradeDir\coucou.exe$\"' qanot_autostart_owned
  StrCmp $0 '$\"$QanotUpgradeDir\coucou.exe$\" ' qanot_autostart_owned qanot_autostart_done
qanot_autostart_owned:
  StrCpy $2 0
  ; Any existing value belongs to the user, including empty/non-string data.
  ; ReadRegStr cannot distinguish a non-string value from a missing value.
  System::Call 'advapi32::RegOpenKeyExW(p 0x80000001, w "${QANOT_RUNKEY}", i 0, i 0x101, *p .r2) i .r1'
  StrCmp $1 0 0 qanot_autostart_done
  System::Call 'advapi32::RegQueryValueExW(p r2, w "Qanot AI", p 0, p 0, p 0, p 0) i .r1'
  System::Call 'advapi32::RegCloseKey(p r2)'
  StrCpy $2 0
  StrCmp $1 2 0 qanot_autostart_done
  StrCpy $3 0
  System::Call 'advapi32::RegOpenKeyExW(p 0x80000001, w "${QANOT_APPROVEDKEY}", i 0, i 0x103, *p .r2) i .r1'
  StrCmp $1 2 qanot_autostart_copy_run
  StrCmp $1 0 0 qanot_autostart_done
  ; Even an approval override without a Run entry belongs to the new app/user.
  System::Call 'advapi32::RegQueryValueExW(p r2, w "Qanot AI", p 0, p 0, p 0, p 0) i .r1'
  StrCmp $1 2 0 qanot_autostart_close
  System::Alloc 4096
  Pop $3
  StrCmp $3 0 qanot_autostart_close
  StrCpy $4 4096
  System::Call 'advapi32::RegQueryValueExW(p r2, w "Coucou", p 0, *i .r5, p r3, *i r4 r4) i .r1'
  StrCmp $1 2 qanot_autostart_free_and_copy
  StrCmp $1 0 0 qanot_autostart_free
  StrCmp $5 3 0 qanot_autostart_free
  IntCmp $4 0 qanot_autostart_free qanot_autostart_free 0
  IntCmp $4 4096 0 0 qanot_autostart_free
  System::Call 'advapi32::RegSetValueExW(p r2, w "Qanot AI", i 0, i 3, p r3, i r4) i .r1'
  StrCmp $1 0 0 qanot_autostart_free
  System::Free $3
  StrCpy $3 0
  ClearErrors
  WriteRegStr HKCU "${QANOT_RUNKEY}" "Qanot AI" '$\"$QanotUpgradeDir\coucou.exe$\"'
  IfErrors qanot_autostart_close
  DeleteRegValue HKCU "${QANOT_RUNKEY}" "Coucou"
  System::Call 'advapi32::RegDeleteValueW(p r2, w "Coucou") i .r1'
  Goto qanot_autostart_close
qanot_autostart_free_and_copy:
  System::Free $3
  StrCpy $3 0
  System::Call 'advapi32::RegCloseKey(p r2)'
  StrCpy $2 0
qanot_autostart_copy_run:
  ClearErrors
  WriteRegStr HKCU "${QANOT_RUNKEY}" "Qanot AI" '$\"$QanotUpgradeDir\coucou.exe$\"'
  IfErrors qanot_autostart_done
  DeleteRegValue HKCU "${QANOT_RUNKEY}" "Coucou"
  Goto qanot_autostart_done
qanot_autostart_free:
  System::Free $3
qanot_autostart_close:
  System::Call 'advapi32::RegCloseKey(p r2)'
qanot_autostart_done:
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

!macro NSIS_HOOK_PREINSTALL
  StrCpy $QanotUpgradeDir ""
  Call QanotFindLegacyInstall
  ${If} $QanotLegacyDir != ""
    ; Respect an explicit/custom destination. Only the new default opts into
    ; migration, or the caller may select the already verified old destination.
    ${If} $INSTDIR == "$LOCALAPPDATA\${PRODUCTNAME}"
      StrCpy $INSTDIR $QanotLegacyDir
    ${EndIf}
    ${If} $INSTDIR == $QanotLegacyDir
      StrCpy $QanotUpgradeDir $QanotLegacyDir
      ; The template set its output path before this hook. Keep the main File
      ; instruction on the verified destination, followed by its normal
      ; CheckIfAppIsRunning check for that same executable path.
      SetOutPath $INSTDIR
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro IsShortcutTarget "$SMPROGRAMS\Qanot AI LocalAI Studio.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  Pop $0
  ${If} $0 = 1
    Delete "$SMPROGRAMS\Qanot AI LocalAI Studio.lnk"
  ${EndIf}
  RMDir /r "$LOCALAPPDATA\Coucou\bin"
  RMDir /r "$LOCALAPPDATA\Coucou\inbox"
  Delete "$LOCALAPPDATA\Coucou\coucou.log"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ${If} $QanotUpgradeDir != ""
    ; Recheck ownership after every replacement file and the new registration
    ; were written. Cleanup can only follow a successful same-path upgrade.
    Call QanotFindLegacyInstall
    ${If} $QanotLegacyDir == $QanotUpgradeDir
    ${AndIf} $INSTDIR == $QanotUpgradeDir
      ReadRegStr $0 HKCU "${UNINSTKEY}" "DisplayName"
      ReadRegStr $1 HKCU "${UNINSTKEY}" "Publisher"
      ReadRegStr $2 HKCU "${UNINSTKEY}" "InstallLocation"
      ReadRegStr $3 HKCU "${UNINSTKEY}" "UninstallString"
      ${If} $0 == "${PRODUCTNAME}"
      ${AndIf} $1 == "${MANUFACTURER}"
      ${AndIf} $2 == '$\"$INSTDIR$\"'
      ${AndIf} $3 == '$\"$INSTDIR\uninstall.exe$\"'
        Call QanotMigrateOwnedAutostart
        DeleteRegKey HKCU "${QANOT_LEGACY_UNINSTKEY}"
        DeleteRegValue HKCU "${QANOT_LEGACY_MANUPRODUCTKEY}" ""
        DeleteRegKey /ifempty HKCU "${QANOT_LEGACY_MANUPRODUCTKEY}"
        !insertmacro IsShortcutTarget "$SMPROGRAMS\Coucou.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
        Pop $0
        ${If} $0 = 1
          Delete "$SMPROGRAMS\Coucou.lnk"
        ${EndIf}
        !insertmacro IsShortcutTarget "$DESKTOP\Coucou.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
        Pop $0
        ${If} $0 = 1
          Delete "$DESKTOP\Coucou.lnk"
        ${EndIf}
      ${EndIf}
    ${EndIf}
  ${EndIf}
  !insertmacro IsShortcutTarget "$SMPROGRAMS\Coucou LocalAI Studio.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  Pop $0
  ${If} $0 = 1
    Delete "$SMPROGRAMS\Coucou LocalAI Studio.lnk"
  ${EndIf}
  CreateShortcut "$SMPROGRAMS\Qanot AI LocalAI Studio.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "--studio"
!macroend
