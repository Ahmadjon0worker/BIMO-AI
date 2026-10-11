; BIMO AI current-user upgrade. Storage stays in AppData\Local\Coucou.
; Never execute a legacy uninstaller or change another application's hooks.
!define BIMO_RUNKEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define BIMO_APPROVEDKEY "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"
Var BimoQanotDir
Var BimoCoucouDir
Var BimoUpgradeDir
Var BimoAutostartName

!macro BIMO_FIND_LEGACY ID BRAND PUBLISHER
Function BimoFind${ID}Install
  Push $R0
  Push $R1
  Push $R2
  StrCpy $Bimo${ID}Dir ""
  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${BRAND}" "DisplayName"
  StrCmp $R0 "${BRAND}" 0 bimo_${ID}_legacy_done
  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${BRAND}" "Publisher"
  StrCmp $R0 "${PUBLISHER}" 0 bimo_${ID}_legacy_done
  ReadRegStr $R0 HKCU "Software\${PUBLISHER}\${BRAND}" ""
  StrCmp $R0 "" bimo_${ID}_legacy_done
  GetFullPathName $R1 "$R0"
  StrCmp $R0 $R1 0 bimo_${ID}_legacy_done
  ${GetRoot} "$R0" $R1
  StrCmp $R0 $R1 bimo_${ID}_legacy_done
  StrCmp $R0 "$R1\" bimo_${ID}_legacy_done
  ; Reject a redirected destination or any redirected ancestor before writing.
  StrCpy $R2 $R0
bimo_${ID}_check_parent:
  System::Call 'kernel32::GetFileAttributesW(w R2) i .R1'
  IntCmp $R1 -1 bimo_${ID}_legacy_done
  IntOp $R1 $R1 & 0x400
  StrCmp $R1 0 0 bimo_${ID}_legacy_done
  ${GetParent} "$R2" $R1
  StrCmp $R1 "" bimo_${ID}_parents_checked
  StrCmp $R1 $R2 bimo_${ID}_parents_checked
  StrCpy $R2 $R1
  Goto bimo_${ID}_check_parent
bimo_${ID}_parents_checked:
  ReadRegStr $R1 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${BRAND}" "InstallLocation"
  StrCmp $R1 '$\"$R0$\"' 0 bimo_${ID}_legacy_done
  ReadRegStr $R1 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${BRAND}" "UninstallString"
  StrCmp $R1 '$\"$R0\uninstall.exe$\"' 0 bimo_${ID}_legacy_done
  IfFileExists "$R0\coucou.exe" 0 bimo_${ID}_legacy_done
  IfFileExists "$R0\uninstall.exe" 0 bimo_${ID}_legacy_done
  System::Call 'kernel32::GetFileAttributesW(w "$R0\coucou.exe") i .R1'
  IntOp $R1 $R1 & 0x400
  StrCmp $R1 0 0 bimo_${ID}_legacy_done
  System::Call 'kernel32::GetFileAttributesW(w "$R0\uninstall.exe") i .R1'
  IntOp $R1 $R1 & 0x400
  StrCmp $R1 0 0 bimo_${ID}_legacy_done
  StrCpy $Bimo${ID}Dir $R0
bimo_${ID}_legacy_done:
  Pop $R2
  Pop $R1
  Pop $R0
FunctionEnd
!macroend
!insertmacro BIMO_FIND_LEGACY Qanot "Qanot AI" "Ahmadjon0worker"
!insertmacro BIMO_FIND_LEGACY Coucou "Coucou" "louisraille"

Function BimoMigrateOwnedAutostart
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  StrCpy $BimoAutostartName "Qanot AI"
  ReadRegStr $0 HKCU "${BIMO_RUNKEY}" "$BimoAutostartName"
  StrCmp $0 "$BimoUpgradeDir\coucou.exe " bimo_autostart_owned
  StrCmp $0 "$BimoUpgradeDir\coucou.exe" bimo_autostart_owned
  StrCmp $0 '$\"$BimoUpgradeDir\coucou.exe$\"' bimo_autostart_owned
  StrCmp $0 '$\"$BimoUpgradeDir\coucou.exe$\" ' bimo_autostart_owned
  StrCpy $BimoAutostartName "Coucou"
  ReadRegStr $0 HKCU "${BIMO_RUNKEY}" "$BimoAutostartName"
  StrCmp $0 "$BimoUpgradeDir\coucou.exe " bimo_autostart_owned
  StrCmp $0 "$BimoUpgradeDir\coucou.exe" bimo_autostart_owned
  StrCmp $0 '$\"$BimoUpgradeDir\coucou.exe$\"' bimo_autostart_owned
  StrCmp $0 '$\"$BimoUpgradeDir\coucou.exe$\" ' bimo_autostart_owned bimo_autostart_done
bimo_autostart_owned:
  StrCpy $2 0
  ; Any existing value belongs to the user, including empty/non-string data.
  ; ReadRegStr cannot distinguish a non-string value from a missing value.
  System::Call 'advapi32::RegOpenKeyExW(p 0x80000001, w "${BIMO_RUNKEY}", i 0, i 0x101, *p .r2) i .r1'
  StrCmp $1 0 0 bimo_autostart_done
  System::Call 'advapi32::RegQueryValueExW(p r2, w "$BimoAutostartName", p 0, *i .r5, p 0, p 0) i .r1'
  ${If} $1 != 0
  ${OrIf} $5 != 1
    System::Call 'advapi32::RegCloseKey(p r2)'
    Goto bimo_autostart_done
  ${EndIf}
  System::Call 'advapi32::RegQueryValueExW(p r2, w "BIMO AI", p 0, p 0, p 0, p 0) i .r1'
  System::Call 'advapi32::RegCloseKey(p r2)'
  StrCpy $2 0
  StrCmp $1 2 0 bimo_autostart_done
  StrCpy $3 0
  System::Call 'advapi32::RegOpenKeyExW(p 0x80000001, w "${BIMO_APPROVEDKEY}", i 0, i 0x103, *p .r2) i .r1'
  StrCmp $1 2 bimo_autostart_copy_run
  StrCmp $1 0 0 bimo_autostart_done
  ; Even an approval override without a Run entry belongs to the new app/user.
  System::Call 'advapi32::RegQueryValueExW(p r2, w "BIMO AI", p 0, p 0, p 0, p 0) i .r1'
  StrCmp $1 2 0 bimo_autostart_close
  System::Alloc 4096
  Pop $3
  StrCmp $3 0 bimo_autostart_close
  StrCpy $4 4096
  System::Call 'advapi32::RegQueryValueExW(p r2, w "$BimoAutostartName", p 0, *i .r5, p r3, *i r4 r4) i .r1'
  StrCmp $1 2 bimo_autostart_free_and_copy
  StrCmp $1 0 0 bimo_autostart_free
  StrCmp $5 3 0 bimo_autostart_free
  IntCmp $4 0 bimo_autostart_free bimo_autostart_free 0
  IntCmp $4 4096 0 0 bimo_autostart_free
  System::Call 'advapi32::RegSetValueExW(p r2, w "BIMO AI", i 0, i 3, p r3, i r4) i .r1'
  StrCmp $1 0 0 bimo_autostart_free
  System::Free $3
  StrCpy $3 0
  ClearErrors
  WriteRegStr HKCU "${BIMO_RUNKEY}" "BIMO AI" '$\"$BimoUpgradeDir\coucou.exe$\"'
  IfErrors bimo_autostart_close
  DeleteRegValue HKCU "${BIMO_RUNKEY}" "$BimoAutostartName"
  System::Call 'advapi32::RegDeleteValueW(p r2, w "$BimoAutostartName") i .r1'
  Goto bimo_autostart_close
bimo_autostart_free_and_copy:
  System::Free $3
  StrCpy $3 0
  System::Call 'advapi32::RegCloseKey(p r2)'
  StrCpy $2 0
bimo_autostart_copy_run:
  ClearErrors
  WriteRegStr HKCU "${BIMO_RUNKEY}" "BIMO AI" '$\"$BimoUpgradeDir\coucou.exe$\"'
  IfErrors bimo_autostart_done
  DeleteRegValue HKCU "${BIMO_RUNKEY}" "$BimoAutostartName"
  Goto bimo_autostart_done
bimo_autostart_free:
  System::Free $3
bimo_autostart_close:
  System::Call 'advapi32::RegCloseKey(p r2)'
bimo_autostart_done:
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

; Only old aliases of the exact replacement executable can be redundant.
; A customized BIMO Run value prevents all alias cleanup.
!macro BIMO_REMOVE_AUTOSTART_ALIAS BRAND
  System::Call 'advapi32::RegOpenKeyExW(p 0x80000001, w "${BIMO_RUNKEY}", i 0, i 0x101, *p .r2) i .r1'
  ${If} $1 == 0
    System::Call 'advapi32::RegQueryValueExW(p r2, w "${BRAND}", p 0, *i .r0, p 0, p 0) i .r1'
    System::Call 'advapi32::RegCloseKey(p r2)'
    ${If} $1 == 0
    ${AndIf} $0 == 1
      ReadRegStr $0 HKCU "${BIMO_RUNKEY}" "${BRAND}"
      ${If} $0 == "$BimoUpgradeDir\coucou.exe "
      ${OrIf} $0 == "$BimoUpgradeDir\coucou.exe"
      ${OrIf} $0 == '$\"$BimoUpgradeDir\coucou.exe$\"'
      ${OrIf} $0 == '$\"$BimoUpgradeDir\coucou.exe$\" '
        DeleteRegValue HKCU "${BIMO_RUNKEY}" "${BRAND}"
        DeleteRegValue HKCU "${BIMO_APPROVEDKEY}" "${BRAND}"
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend
Function BimoRemoveOwnedAutostartDuplicates
  Push $0
  Push $1
  Push $2
  System::Call 'advapi32::RegOpenKeyExW(p 0x80000001, w "${BIMO_RUNKEY}", i 0, i 0x101, *p .r2) i .r1'
  ${If} $1 != 0
    Goto bimo_duplicates_done
  ${EndIf}
  System::Call 'advapi32::RegQueryValueExW(p r2, w "BIMO AI", p 0, *i .r0, p 0, p 0) i .r1'
  System::Call 'advapi32::RegCloseKey(p r2)'
  ${If} $1 != 0
  ${OrIf} $0 != 1
    Goto bimo_duplicates_done
  ${EndIf}
  ReadRegStr $0 HKCU "${BIMO_RUNKEY}" "BIMO AI"
  ${If} $0 == "$BimoUpgradeDir\coucou.exe "
  ${OrIf} $0 == "$BimoUpgradeDir\coucou.exe"
  ${OrIf} $0 == '$\"$BimoUpgradeDir\coucou.exe$\"'
  ${OrIf} $0 == '$\"$BimoUpgradeDir\coucou.exe$\" '
    !insertmacro BIMO_REMOVE_AUTOSTART_ALIAS "Qanot AI"
    !insertmacro BIMO_REMOVE_AUTOSTART_ALIAS "Coucou"
  ${EndIf}
bimo_duplicates_done:
  Pop $2
  Pop $1
  Pop $0
FunctionEnd

!macro NSIS_HOOK_PREINSTALL
  StrCpy $BimoUpgradeDir ""
  Call BimoFindQanotInstall
  Call BimoFindCoucouInstall
  ; Only an uncustomized default destination opts into the preferred migration.
  ${If} $INSTDIR == "$LOCALAPPDATA\${PRODUCTNAME}"
    ${If} $BimoQanotDir != ""
      StrCpy $INSTDIR $BimoQanotDir
    ${ElseIf} $BimoCoucouDir != ""
      StrCpy $INSTDIR $BimoCoucouDir
    ${EndIf}
  ${EndIf}
  ${If} $INSTDIR == $BimoQanotDir
  ${OrIf} $INSTDIR == $BimoCoucouDir
    StrCpy $BimoUpgradeDir $INSTDIR
    SetOutPath $INSTDIR
  ${EndIf}
!macroend

!macro BIMO_REMOVE_OWNED_SHORTCUT PATH
  !insertmacro IsShortcutTarget "${PATH}" "$INSTDIR\${MAINBINARYNAME}.exe"
  Pop $0
  ${If} $0 = 1
    Delete "${PATH}"
  ${EndIf}
!macroend
!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro BIMO_REMOVE_OWNED_SHORTCUT "$SMPROGRAMS\BIMO AI LocalAI Studio.lnk"
  RMDir /r "$LOCALAPPDATA\Coucou\bin"
  RMDir /r "$LOCALAPPDATA\Coucou\inbox"
  Delete "$LOCALAPPDATA\Coucou\coucou.log"
!macroend

!macro BIMO_REMOVE_LEGACY_REGISTRATION ID BRAND PUBLISHER
  Call BimoFind${ID}Install
  ${If} $Bimo${ID}Dir == $BimoUpgradeDir
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${BRAND}"
    DeleteRegValue HKCU "Software\${PUBLISHER}\${BRAND}" ""
    DeleteRegKey /ifempty HKCU "Software\${PUBLISHER}\${BRAND}"
    !insertmacro BIMO_REMOVE_OWNED_SHORTCUT "$SMPROGRAMS\${BRAND}.lnk"
    !insertmacro BIMO_REMOVE_OWNED_SHORTCUT "$DESKTOP\${BRAND}.lnk"
    !insertmacro BIMO_REMOVE_OWNED_SHORTCUT "$SMPROGRAMS\${BRAND} LocalAI Studio.lnk"
  ${EndIf}
!macroend
!macro NSIS_HOOK_POSTINSTALL
  ${If} $BimoUpgradeDir != ""
  ${AndIf} $INSTDIR == $BimoUpgradeDir
    ; Cleanup only follows a successful same-path replacement registration.
    ReadRegStr $0 HKCU "${UNINSTKEY}" "DisplayName"
    ReadRegStr $1 HKCU "${UNINSTKEY}" "Publisher"
    ReadRegStr $2 HKCU "${UNINSTKEY}" "InstallLocation"
    ReadRegStr $3 HKCU "${UNINSTKEY}" "UninstallString"
    ${If} $0 == "${PRODUCTNAME}"
    ${AndIf} $1 == "${MANUFACTURER}"
    ${AndIf} $2 == '$\"$INSTDIR$\"'
    ${AndIf} $3 == '$\"$INSTDIR\uninstall.exe$\"'
      Call BimoMigrateOwnedAutostart
      Call BimoRemoveOwnedAutostartDuplicates
      !insertmacro BIMO_REMOVE_LEGACY_REGISTRATION Qanot "Qanot AI" "Ahmadjon0worker"
      !insertmacro BIMO_REMOVE_LEGACY_REGISTRATION Coucou "Coucou" "louisraille"
    ${EndIf}
  ${EndIf}
  ; Old studio aliases are removed only when their target is this exact app.
  !insertmacro BIMO_REMOVE_OWNED_SHORTCUT "$SMPROGRAMS\Qanot AI LocalAI Studio.lnk"
  !insertmacro BIMO_REMOVE_OWNED_SHORTCUT "$SMPROGRAMS\Coucou LocalAI Studio.lnk"
  ; A pre-existing named link may contain a user's custom target or arguments.
  IfFileExists "$SMPROGRAMS\BIMO AI LocalAI Studio.lnk" +2 0
  CreateShortcut "$SMPROGRAMS\BIMO AI LocalAI Studio.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "--studio"
!macroend
