# =============================================================================
# Instalacao remota do Zabbix Agent 2 em computadores Windows
# Uso: .\instalar-agente.ps1 -ServidorZabbix "192.168.0.94" -Computadores "PC1","PC2"
# Requer: credenciais administrativas nos alvos, compartilhamento ADMIN$ acessivel
# =============================================================================
param(
    [string]$ServidorZabbix = "192.168.0.94",
    [string]$PSKIdentity = "",
    [string]$PSKKey = "",
    [string[]]$Computadores = @(),
    [string]$ListaCSV = "",
    [string]$MSIPath = "\\localhost\C$\Users\usuario\Documents\cadastro-computadores-v3\zabbix-deploy\zabbix_agent2-7.0-latest-windows-amd64-openssl.msi",
    [int]$Porta = 10050,
    [switch]$ModoAtivo = $true,
    [switch]$Forcar = $false,
    [switch]$DryRun = $false
)

$ErrorActionPreference = "Stop"
$LogDir = Join-Path $PSScriptRoot "logs"
if (!(Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$LogFile = Join-Path $LogDir "deploy_$(Get-Date -Format 'yyyyMMdd_HHmmss').log"

function Log($msg) {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $msg"
    Write-Host $line
    Add-Content -Path $LogFile -Value $line
}

# Carrega lista de alvos
$alvos = @()
if ($ListaCSV -and (Test-Path $ListaCSV)) {
    $alvos = Import-Csv $ListaCSV | ForEach-Object { $_.ip }
} elseif ($Computadores.Count) {
    $alvos = $Computadores
}

if (!$alvos.Count) {
    Log "ERRO: nenhum computador informado. Use -Computadores ou -ListaCSV"
    exit 1
}

Log "=== Inicio do deploy do Zabbix Agent 2 ==="
Log "Servidor Zabbix: $ServidorZabbix"
Log "Porta: $Porta | Modo ativo: $ModoAtivo | Forcar: $Forcar"
Log "Alvos: $($alvos.Count)"

foreach ($alvo in $alvos) {
    $alvo = $alvo.Trim()
    Log "--- Processando $alvo ---"

    if ($DryRun) {
        Log "  [DRYRUN] Instalaria agente em $alvo com servidor $ServidorZabbix"
        continue
    }

    try {
        # Verifica acessibilidade
        if (!(Test-Connection -ComputerName $alvo -Count 1 -Quiet -ErrorAction SilentlyContinue)) {
            Log "  FALHA: $alvo nao responde a ping"
            continue
        }

        # Verifica se ja tem o agente instalado
        $svc = Get-Service -ComputerName $alvo -Name "Zabbix Agent 2" -ErrorAction SilentlyContinue
        if ($svc -and !$Forcar) {
            Log "  PULADO: agente ja instalado (status: $($svc.Status)). Use -Forcar para reinstalar."
            continue
        }

        # Copia MSI para o alvo
        $msiRemoto = "\\$alvo\C$\Windows\Temp\zabbix_agent2.msi"
        Copy-Item -Path $MSIPath -Destination $msiRemoto -Force
        Log "  MSI copiado para $msiRemoto"

        # Monta parametros de instalacao silenciosa
        $params = @(
            "/i", "`"$msiRemoto`"",
            "/qn",
            "/norestart",
            "/l*v", "`"\\$alvo\C$\Windows\Temp\zabbix_install.log`"",
            "SERVER=$ServidorZabbix",
            "SERVERACTIVE=$ServidorZabbix",
            "HOSTNAME=$alvo",
            "LISTENPORT=$Porta"
        )

        if ($ModoAtivo) {
            $params += "SERVERACTIVE=$ServidorZabbix"
        }

        if ($PSKKey -and $PSKIdentity) {
            $params += "TLSPSKIDENTITY=$PSKIdentity"
            $params += "TLSPSKVALUE=$PSKKey"
            Log "  TLS PSK configurado (identity: $PSKIdentity)"
        }

        # Executa instalacao via Invoke-Command (requer WinRM) ou psexec
        $argStr = $params -join " "
        Log "  Executando: msiexec.exe $argStr"

        # Tenta via Invoke-Command (WinRM)
        $installOk = $false
        try {
            $result = Invoke-Command -ComputerName $alvo -ScriptBlock {
                param($args)
                $p = Start-Process -FilePath "msiexec.exe" -ArgumentList $args -Wait -PassThru -NoNewWindow
                return $p.ExitCode
            } -ArgumentList $argStr -ErrorAction Stop

            if ($result -eq 0 -or $result -eq 3010) {
                $installOk = $true
                Log "  SUCESSO: instalacao retornou codigo $result"
            } else {
                Log "  FALHA: msiexec retornou codigo $result"
            }
        } catch {
            Log "  WinRM indisponivel ($($_.Exception.Message)). Tentando psexec..."
            # Fallback: PsExec (se disponivel)
            $psexec = Get-Command psexec.exe -ErrorAction SilentlyContinue
            if ($psexec) {
                $out = & psexec.exe \\$alvo -accepteula -nobanner msiexec.exe $argStr 2>&1
                Log "  PsExec: $out"
            } else {
                Log "  FALHA: nem WinRM nem PsExec disponiveis para $alvo"
                continue
            }
        }

        if ($installOk) {
            # Aguarda servico subir
            Start-Sleep -Seconds 5
            $svc = Get-Service -ComputerName $alvo -Name "Zabbix Agent 2" -ErrorAction SilentlyContinue
            if ($svc) {
                Log "  Servico 'Zabbix Agent 2' status: $($svc.Status)"
                if ($svc.Status -ne 'Running') {
                    Log "  Tentando iniciar servico..."
                    Invoke-Command -ComputerName $alvo -ScriptBlock {
                        Start-Service "Zabbix Agent 2"
                    } -ErrorAction SilentlyContinue
                }
            }
            Log "  DEPLOY OK: $alvo"
        }
    } catch {
        Log "  ERRO em $alvo : $($_.Exception.Message)"
    }
}

Log "=== Deploy finalizado. Log: $LogFile ==="
