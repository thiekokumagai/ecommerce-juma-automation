!macro customUnInstall
  ; Só limpa na desinstalação manual (nunca durante atualização automática)
  ${ifNot} ${isUpdated}
    ; Remove entradas de inicialização com o Windows criadas pelo Electron
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.Juma Automação"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Juma Automação"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.juma-automation"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "juma-automation"

    ; Remove o histórico de aprovação da aba Aplicativos de Inicialização do Windows
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "electron.app.Juma Automação"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "Juma Automação"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "electron.app.juma-automation"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "juma-automation"

    ; Remove atalho legado da pasta Inicializar (Startup), caso exista
    Delete "$SMSTARTUP\PodEMais-Juma-Automation.lnk"

    ; Remove cache do atualizador automático
    RMDir /r "$LOCALAPPDATA\juma-automation-updater"
  ${endIf}
!macroend