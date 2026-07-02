; DeskMate hides to tray on window close, so the installer's polite WM_CLOSE never actually
; quits it — a running old version would survive the upgrade and leave two DeskMates alive.
; Force-close any running instance before installing.
!macro customInit
  nsExec::Exec 'taskkill /F /IM DeskMate.exe /T'
  Sleep 500
!macroend
