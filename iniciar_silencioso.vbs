Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Obtém o diretório deste script
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

' Cria pasta logs se não existir
logsDir = scriptDir & "\logs"
If Not fso.FolderExists(logsDir) Then
    fso.CreateFolder(logsDir)
End If

' Executa silenciosamente sem janela (0)
cmd = "cmd /c cd /d """ & scriptDir & """ && node index.js >> """ & logsDir & "\automation.log"" 2>&1"
WshShell.Run cmd, 0, False
