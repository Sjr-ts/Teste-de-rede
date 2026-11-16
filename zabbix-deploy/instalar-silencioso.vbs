' ============================================================================
'  EXECUTOR SILENCIOSO - Zabbix Agent 2 + IP Adaptativo
'  Inventário TI - Monitoramento de TI
'
'  Executa o instalador sem mostrar nenhuma janela.
'  Usado pela Tarefa Agendada (inicializacao do Windows) e por usuarios
'  que nao querem ver telas.
'
'  Uso: duplo-clique ou via Tarefa Agendada
' ============================================================================

Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

' Descobre a pasta deste script
scriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)
batPath = scriptDir & "\instalar-tudo.bat"

' Verifica se o bat existe
If Not FSO.FileExists(batPath) Then
    WScript.Quit 1
End If

' Executa o bat em modo oculto (0 = SW_HIDE), aguarda conclusao
WshShell.Run "cmd /c """ & batPath & """", 0, True
