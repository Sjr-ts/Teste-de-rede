' ============================================================================
'  ★ INSTALAR TUDO — 1 CLIQUE, SEM DIGITAR NADA ★
'
'  1. Auto-eleva a Administrador (Shell.Application — sem pedir senha)
'  2. Instala o Zabbix Agent (baixa MSI da CDN) + auto-heal
'  3. Descobre o IP do servidor via XMLHTTP (sem problema de CORS)
'  4. Abre a pagina SERVIDA PELO SERVIDOR, que faz login automatico
'
'  NOTA: abrir o HTML local (file://) NAO funciona — o navegador bloqueia
'  fetch() de file:// para http://. Por isso abrimos http://IP:5903/...
' ============================================================================

Dim WshShell, FSO, scriptDir, batPath, elevado, ShellApp

Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
scriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)
batPath = scriptDir & "\instalar-tudo.bat"

' --- elevacao ---
elevado = False
On Error Resume Next
Dim f
Set f = FSO.CreateTextFile("C:\Program Files\zbx-admin-test.tmp", True)
If Err.Number = 0 Then
    elevado = True
    f.Close
    FSO.DeleteFile "C:\Program Files\zbx-admin-test.tmp"
End If
Err.Clear
On Error GoTo 0

If Not elevado Then
    Set ShellApp = CreateObject("Shell.Application")
    ShellApp.ShellExecute "wscript.exe", """" & WScript.ScriptFullName & """", "", "runas", 1
    WScript.Quit
End If

' --- descobre o servidor via XMLHTTP (funciona ate em file://) ---
Function AcharServidor()
    Dim urls(200), n, i, u, http
    n = 0
    urls(n) = "http://127.0.0.1:5903" : n = n + 1
    urls(n) = "http://localhost:5903" : n = n + 1
    For i = 100 To 129
        urls(n) = "http://192.168.0." & i & ":5903"
        n = n + 1
    Next
    For i = 0 To n - 1
        u = urls(i)
        Set http = CreateObject("MSXML2.ServerXMLHTTP")
        http.setTimeouts 300, 300, 600, 600
        On Error Resume Next
        http.Open "GET", u & "/actuator/health", False
        http.Send
        If Err.Number = 0 And http.Status = 200 Then
            AcharServidor = u
            Err.Clear
            On Error GoTo 0
            Exit Function
        End If
        Err.Clear
        On Error GoTo 0
    Next
    AcharServidor = ""
End Function

' --- instalador silencioso ---
If FSO.FileExists(batPath) Then
    WshShell.Run "cmd /c """ & batPath & """ /silent", 0, False
Else
    MsgBox "instalar-tudo.bat nao encontrado ao lado deste arquivo.", 16, "Erro"
End If

' --- abre pagina SERVIDA PELO SERVIDOR (login automatico, sem CORS) ---
Dim base
base = AcharServidor()
If base <> "" Then
    WshShell.Run """" & base & "/acesso-automatico.html"""", 1, False
Else
    MsgBox "Servidor do Inventario TI nao encontrado na rede." & vbCrLf & _
           "O agente foi instalado, mas nao foi possivel abrir o painel." & vbCrLf & _
           "Verifique se o servidor esta ligado (porta 5903).", 48, "Aviso"
End If
