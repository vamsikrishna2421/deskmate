; DeskMate NSIS customization.
;
; customHeader: the assisted installer's Welcome/Finish pages become a mini-introduction —
; what DeskMate is, the one shortcut that matters, and the handoff to the in-app tour.
; (NSIS can't host the real interactive tutorial; the welcome tour runs on first launch.)
!macro customHeader
  !define MUI_WELCOMEPAGE_TITLE "Meet DeskMate"
  !define MUI_WELCOMEPAGE_TEXT "A quiet ledge for the tasks that land on you.$\r$\n$\r$\nPaste a message from your manager or a teammate — DeskMate reads it, splits it into tasks, figures out the deadline, and asks when it's unsure.$\r$\n$\r$\n  •  Everything stays on this machine — no accounts, no cloud$\r$\n  •  Invisible to Teams and Zoom screen sharing$\r$\n  •  Copy anywhere, press Ctrl+Shift+Space, press Enter$\r$\n$\r$\nAfter setup, DeskMate opens with a short interactive tour."
  !define MUI_FINISHPAGE_TITLE "DeskMate is ready"
  !define MUI_FINISHPAGE_TEXT "The welcome tour starts on first launch — four short steps, then try it live with a sample message.$\r$\n$\r$\nThe floating dot opens DeskMate from anywhere. Press F1 inside the app any time for the full guide."
!macroend

; DeskMate hides to tray on window close, so the installer's polite WM_CLOSE never actually
; quits it — a running old version would survive the upgrade and leave two DeskMates alive.
!macro customInit
  nsExec::Exec 'taskkill /F /IM DeskMate.exe /T'
  Sleep 500
!macroend
