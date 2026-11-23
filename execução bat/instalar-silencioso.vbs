' ============================================================================
'  EXECUTOR SILENCIOSO — chamado pelas tarefas agendadas no boot
'  Executa o instalar-tudo.bat SEM JANELA e sem interacao.
' ============================================================================
Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

scriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)
batPath = scriptDir & "\instalar-tudo.bat"

If Not FSO.FileExists(batPath) Then
    WScript.Quit 1
End If

' 0 = SW_HIDE (sem janela). /silent evita pause e abertura de navegador.
' False = nao prende a tarefa agendada.
WshShell.Run "cmd /c """ & batPath & """ /silent", 0, False
