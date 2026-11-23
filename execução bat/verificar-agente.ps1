# =============================================================================
#  VERIFICAR AGENTE — checa se o PC esta com ping OK E agente Zabbix conectado
#  Uso: .\verificar-agente.ps1 -Computador 192.168.0.108
# =============================================================================
param([string]$Computador = '192.168.0.108')

Write-Output "=== VERIFICACAO DE $Computador ==="
$ping = Test-Connection -ComputerName $Computador -Count 2 -Quiet -ErrorAction SilentlyContinue
Write-Output "Ping ................ $(if($ping){'OK'}else{'FALHA'})"

$porta = Test-NetConnection -ComputerName $Computador -Port 10050 -InformationLevel Quiet -WarningAction SilentlyContinue
Write-Output "Porta 10050 (agente) . $(if($porta){'ABERTA'}else{'FECHADA — agente NAO esta rodando'})"

# consulta a API do Zabbix
try {
    $body = '{"jsonrpc":"2.0","method":"user.login","params":{"username":"Admin","password":"Monitor2026!"},"id":1}'
    $auth = (Invoke-RestMethod -Uri 'http://127.0.0.1:8081/api_jsonrpc.php' -Method Post -Body $body -ContentType 'application/json').result
    $hbody = "{`"jsonrpc`":`"2.0`",`"method`":`"host.get`",`"params`":{`"output`":[`"hostid`",`"host`",`"status`"],`"selectInterfaces`":[`"ip`",`"available`",`"error`"],`"filter`":{`"host`":[`"$Computador`",`"TERM-COMPRAS10`"]}},`"id`":2,`"auth`":`"$auth`"}"
    $hosts = (Invoke-RestMethod -Uri 'http://127.0.0.1:8081/api_jsonrpc.php' -Method Post -Body $hbody -ContentType 'application/json').result
    if ($hosts) {
        $h = $hosts[0]; $i = ($h.interfaces)[0]
        Write-Output "Host Zabbix ......... $($h.host) (id $($h.hostid)), status $($h.status)"
        Write-Output "Interface ........... $($i.ip), disponibilidade: $($i.available) (1=agente ON, 0=OFF)"
        if ($i.available -eq '1') { Write-Output '>>> AGENTE CONECTADO — OK!' }
        else { Write-Output '>>> AGENTE AINDA NAO CONECTOU — execute instalar-tudo.bat no PC' }
    } else {
        Write-Output "Host Zabbix ......... NAO ENCONTRADO (auto-registro deve criar quando agente subir)"
    }
} catch {
    Write-Output "Zabbix API .......... ERRO: $($_.Exception.Message)"
}
