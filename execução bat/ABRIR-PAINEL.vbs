' ============================================================================
'  ABRIR PAINEL - detecta o IP do servidor automaticamente
'  Clique duplo: abre o Inventario TI no navegador padrao, sem depender de IP fixo
'  (o servidor pode mudar de IP por DHCP — este script descobre o atual).
' ============================================================================

Set WshShell = CreateObject("WScript.Shell")

' 1) tenta localhost primeiro (se o navegador estiver na propria maquina servidora)
Function HttpOk(url)
    On Error Resume Next
    Dim http
    Set http = CreateObject("MSXML2.XMLHTTP")
    http.Open "GET", url, False
    http.setRequestHeader "X-Test", "1"
    http.Send
    HttpOk = (http.Status = 200 Or http.Status = 401)
    If Err.Number <> 0 Then HttpOk = False
    On Error GoTo 0
End Function

Dim portas, port, ip, base, abrir
portas = Array(5903)
' 2) descobre o IP LAN real (ignora WSL/Hyper-V/APIPA/loopback)
ip = ""
Dim objWMIService, colAdapters, adapter
Set objWMIService = GetObject("winmgmts:\\.\root\cimv2")
Set colAdapters = objWMIService.ExecQuery("SELECT IPAddress, IPEnabled FROM Win32_NetworkAdapterConfiguration WHERE IPEnabled = True")
For Each adapter In colAdapters
    If Not IsNull(adapter.IPAddress) Then
        For Each ipCandidate In adapter.IPAddress
            If InStr(ipCandidate, ".") > 0 And Left(ipCandidate, 4) <> "127." And Left(ipCandidate, 8) <> "169.254." Then
                If ip = "" Then ip = ipCandidate
            End If
        Next
    End If
Next

' 3) monta a URL: tenta 127.0.0.1 e o IP detectado
base = ""
If HttpOk("http://127.0.0.1:5903/actuator/health") Then
    base = "http://127.0.0.1"
ElseIf ip <> "" And HttpOk("http://" & ip & ":5903/actuator/health") Then
    base = "http://" & ip
Else
    ' fallback: ultimo IP conhecido
    base = "http://192.168.0.167"
End If

abrir = base & ":5903/index.html"
WshShell.Run """" & abrir & """", 1, False
