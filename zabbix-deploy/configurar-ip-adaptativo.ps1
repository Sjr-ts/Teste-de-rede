#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Opt-in: habilita "IP adaptativo" em agente Zabbix 2 no Windows.
.DESCRIPTION
  Troca HostMetadata (estatico) por HostMetadataItem (dinamico) cuja key
  "inv.meta" devolve "inventario-ti <ip-atual>". Quando o IP do PC muda
  (DHCP), o metadata muda -> o agente re-registra sozinho (sem restart)
  e o servidor Zabbix atualiza a interface do host, que o Inventario TI
  (job de 5 min) le de volta para o cadastro (IP adaptativo).

  PRE-REQUISITO: o agente precisa rodar como servico (instalado via MSI).
  Em modo console (zabbix_agent2.exe -c ...) o UserParameter pode falhar
  com "Acesso negado" por restricao de token — isso NAO ocorre no servico.

  Use -Reverter para voltar ao modo estatico seguro.
#>
param(
    [string]$Computador = 'localhost',
    [switch]$Reverter,
    [switch]$DryRun
)

$erro = $null
$conf = "\\$Computador\C$\Program Files\Zabbix Agent 2\zabbix_agent2.conf"
if (!(Test-Path $conf)) { Write-Host "Conf nao encontrado: $conf"; exit 1 }

$conteudo = [System.IO.File]::ReadAllText($conf)
$origem = $conteudo

# script de metadata (UserParameter chama powershell)
$scriptDir = "\\$Computador\C$\Program Files\Zabbix Agent 2\scripts"
$scriptFile = Join-Path $scriptDir 'inv-meta.ps1'
$scriptBody = @'
$ip = $null
try {
    $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
           Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
           Sort-Object -Property InterfaceMetric |
           Select-Object -First 1).IPAddress
} catch { $ip = $null }
if (-not $ip) { $ip = 'sem-ip' }
Write-Output ("inventario-ti " + $ip)
'@

if ($Reverter) {
    # remove UserParameter inv.meta e HostMetadataItem, restaura HostMetadata
    $conteudo = [regex]::Replace($conteudo, '(?im)^[ \t]*HostMetadataItem[ \t]*=.*\r?\n?', '')
    $conteudo = [regex]::Replace($conteudo, '(?im)^[ \t]*UserParameter[ \t]*=inv\.meta.*\r?\n?', '')
    if ($conteudo -notmatch '(?im)^[ \t]*HostMetadata[ \t]*=') {
        $conteudo = $conteudo.TrimEnd() + "`r`nHostMetadata=inventario-ti`r`n"
    } else {
        $conteudo = [regex]::Replace($conteudo, '(?im)^[ \t]*HostMetadata[ \t]*=.*$', 'HostMetadata=inventario-ti')
    }
    Write-Host 'Modo revertido para HostMetadata estatico.'
} else {
    # garante o script
    if (!(Test-Path $scriptDir)) { New-Item -ItemType Directory -Path $scriptDir -Force | Out-Null }
    if ($DryRun) { Write-Host "[DRYRUN] criaria $scriptFile" }
    else { [System.IO.File]::WriteAllText($scriptFile, $scriptBody) }

    # HostMetadata -> HostMetadataItem
    $conteudo = [regex]::Replace($conteudo, '(?im)^[ \t]*HostMetadata[ \t]*=.*$', 'HostMetadataItem=inv.meta')
    if ($conteudo -notmatch '(?im)^[ \t]*HostMetadataItem[ \t]*=') {
        $conteudo = $conteudo.TrimEnd() + "`r`nHostMetadataItem=inv.meta`r`n"
    }
    # UserParameter (idempotente)
    $conteudo = [regex]::Replace($conteudo, '(?im)^[ \t]*UserParameter[ \t]*=inv\.meta.*\r?\n?', '')
    $conteudo = $conteudo.TrimEnd() + "`r`nUserParameter=inv.meta,powershell -NoProfile -ExecutionPolicy Bypass -File `"$scriptFile`"`r`n"
}

if ($DryRun) { Write-Host '[DRYRUN] nenhuma alteracao persistida.'; exit 0 }

if ($conteudo -ne $origem) {
    Copy-Item -Path $conf -Destination "$conf.bak-$(Get-Date -Format yyyyMMddHHmm)" -Force
    [System.IO.File]::WriteAllText($conf, $conteudo)
    Write-Host 'conf atualizado.'
    # reinicia o servico para aplicar
    $svc = Get-Service -ComputerName $Computador -Name 'Zabbix Agent 2' -ErrorAction SilentlyContinue
    if ($svc) {
        Restart-Service -InputObject $svc -Force
        Write-Host 'servico Zabbix Agent 2 reiniciado.'
    } else {
        Write-Host 'AVISO: servico nao encontrado; reinicie manualmente.'
    }
} else {
    Write-Host 'conf ja estava atualizado.'
}
