' ============================================================================
'  ★ INSTALAR TUDO — 1 CLIQUE, SEM DIGITAR NADA ★
'
'  1. Auto-eleva a Administrador SEM SENHA (se a conta ja for admin)
'  2. Instala o Zabbix Agent automaticamente (baixa o MSI da CDN)
'  3. Configura IP adaptativo + auto-heal (sobrevive a reboot/DHCP)
'  4. Cria atalhos na Area de Trabalho
'  5. Abre os painéis JA LOGADOS (senha embutida)
'
'  USO: duplo-clique neste arquivo. Nao digita nada.
' ============================================================================

Dim WshShell, FSO, scriptDir, batPath, elevado

Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
scriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)
batPath = scriptDir & "\instalar-tudo.bat"

' Verifica se ja esta elevado (teste de escrita em Program Files)
elevado = False
On Error Resume Next
Dim f
Set f = FSO.CreateTextFile("C:\Program Files\zbx-admin-test.tmp", True)
If Err.Number = 0 Then
    elevado = True
    f.Close
    FSO.DeleteFile "C:\Program Files\zbx-admin-test.tmp"
End If
On Error GoTo 0

If Not elevado Then
    ' Auto-elevacao: se a conta for admin, o UAC so pede "Sim", NAO senha.
    WshShell.ShellExecute "wscript.exe", """" & WScript.ScriptFullName & """", "", "runas", 1
    WScript.Quit
End If

' Ja elevado: dispara o instalador principal em modo silencioso
If FSO.FileExists(batPath) Then
    WshShell.Run "cmd /c """ & batPath & """ /silent", 0, False
Else
    MsgBox "instalar-tudo.bat nao encontrado ao lado deste arquivo.", 16, "Erro"
End If

' Abre os painéis ja logados (acesso automatico com senha embutida)
Dim htmlPath
htmlPath = scriptDir & "\..\frontend\acesso-automatico.html"
If FSO.FileExists(htmlPath) Then
    WshShell.Run """" & htmlPath & """", 1, False
Else
    WshShell.Run "http://127.0.0.1:5903/index.html", 1, False
End If
