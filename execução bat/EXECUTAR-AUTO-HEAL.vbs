' ============================================================================
'  EXECUTAR-AUTO-HEAL.vbs — tarefa agendada do agente Zabbix
'  wscript.exe nao tem console; Run(...,0,True) esconde o PowerShell DESDE
'  a criacao (evita o piscar que o -WindowStyle Hidden so aplica depois).
' ============================================================================
Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
dir = FSO.GetParentFolderName(WScript.ScriptFullName)
ps  = dir & "\auto-heal.ps1"
If Not FSO.FileExists(ps) Then WScript.Quit 1
cmd = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & ps & """"
WshShell.Run cmd, 0, True
