' ============================================================================
'  INSTALAR-1-CLIQUE.vbs — entry point sem flicker
'  Duplo clique aqui: roda o INSTALAR.ps1 com janela OCULTA.
'  O unico aviso visivel sera o UAC do Windows (obrigatorio para instalar
'  o servico do agente). Todo o andamento fica em instalar.log.
' ============================================================================
Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

dir = FSO.GetParentFolderName(WScript.ScriptFullName)
ps  = dir & "\INSTALAR.ps1"

If Not FSO.FileExists(ps) Then
    WScript.Quit 1
End If

' 0 = SW_HIDE (sem console). False = nao prende o WScript.
cmd = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & ps & """ -Oculto"
WshShell.Run cmd, 0, False
