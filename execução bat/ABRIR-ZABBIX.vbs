' ============================================================================
'  ABRIR ZABBIX - detecta o IP do servidor automaticamente
' ============================================================================

Set WshShell = CreateObject("WScript.Shell")

Function HttpOk(url)
    On Error Resume Next
    Dim http
    Set http = CreateObject("MSXML2.XMLHTTP")
    http.Open "GET", url, False
    http.Send
    HttpOk = (http.Status = 200 Or http.Status = 401)
    If Err.Number <> 0 Then HttpOk = False
    On Error GoTo 0
End Function

ip = ""
Dim objWMIService, colAdapters, adapter, ipCandidate
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

base = ""
If HttpOk("http://127.0.0.1:8081/") Then
    base = "http://127.0.0.1"
ElseIf ip <> "" And HttpOk("http://" & ip & ":8081/") Then
    base = "http://" & ip
Else
    base = "http://192.168.0.167"
End If

WshShell.Run """" & base & ":8081/" & """", 1, False
