# =============================================================================
# Instalacao remota do Zabbix Agent 2 em computadores Windows
# Uso: .\instalar-agente.ps1 -ServidorZabbix "192.168.0.186" -Computadores "PC1","PC2"
#      .\instalar-agente.ps1 -Usuario "ADMINISTRADOR" -Senha "***" -Computadores "192.168.0.131"
# Requer: credenciais administrativas nos alvos, compartilhamento ADMIN$ acessivel
# Obs: sem -Usuario/-Senha usa a conta logada nesta maquina; contas sem senha
#      NAO conseguem logar na rede (Windows bloqueia) -> informe as credenciais.
# =============================================================================
param(
    [string]$ServidorZabbix = "192.168.0.186",
    [string]$Usuario = "",
    [string]$Senha = "",
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

# --- Helpers de acesso remoto com credenciais opcionais ---
function ConectarShare($alvo) {
    if (!$Usuario) {
        # Sem credenciais explicitas: usa a conta logada (falha se ela for sem senha)
        try {
            Get-ChildItem "\\$alvo\C$" -ErrorAction Stop | Select-Object -First 1 | Out-Null
            return $true
        } catch {
            Log "  FALHA: sem acesso a \\$alvo\C$ com a conta atual. Use -Usuario/-Senha com administrador do alvo."
            return $false
        }
    }
    cmd /c "net use \\$alvo\C$ /delete /y" >$null 2>&1
    & net.exe use "\\$alvo\C$" "/user:$Usuario" $Senha >$null 2>&1
    if ($LASTEXITCODE -ne 0) {
        Log "  FALHA: sem acesso ao share \\$alvo\C$ com as credenciais informadas"
        return $false
    }
    return $true
}

function DesconectarShare($alvo) {
    if ($Usuario) { cmd /c "net use \\$alvo\C$ /delete /y" >$null 2>&1 }
}

# Estado do servico do agente: 'Running'/'Stopped'/... ou $null se inexiste/sem acesso
function ObterServico($alvo) {
    if ($Usuario) {
        $cred = New-Object System.Management.Automation.PSCredential(
            $Usuario, (ConvertTo-SecureString $Senha -AsPlainText -Force))
        try {
            $w = Get-WmiObject -ComputerName $alvo -Credential $cred -Class Win32_Service `
                -Filter "Name='Zabbix Agent 2'" -ErrorAction Stop
            if ($w) { return ($w | Select-Object -First 1) }
            return $null
        } catch { return $null }
    }
    return (Get-Service -ComputerName $alvo -Name "Zabbix Agent 2" -ErrorAction SilentlyContinue)
}

# Reinicia o servico do agente no alvo (com credenciais via tarefa agendada)
function ReiniciarServico($alvo) {
    if ($Usuario) {
        $tr = 'cmd /c net stop "Zabbix Agent 2" & timeout /t 2 & net start "Zabbix Agent 2"'
        & schtasks.exe "\\$alvo" /create /u $Usuario /p $Senha /ru SYSTEM /sc once /st 00:00 `
            /tn "zbx-restart" /tr $tr /f >$null 2>&1
        & schtasks.exe "\\$alvo" /run /u $Usuario /p $Senha /tn "zbx-restart" >$null 2>&1
        if ($LASTEXITCODE -eq 0) {
            Start-Sleep -Seconds 8
            & schtasks.exe "\\$alvo" /delete /u $Usuario /p $Senha /tn "zbx-restart" /f >$null 2>&1
            return $true
        }
        return $false
    }
    try {
        Invoke-Command -ComputerName $alvo -ScriptBlock {
            Restart-Service -Name "Zabbix Agent 2" -Force
        } -ErrorAction Stop
        return $true
    } catch {
        & sc.exe "\\$alvo" stop "Zabbix Agent 2" 2>&1 | Out-Null
        Start-Sleep -Seconds 2
        & sc.exe "\\$alvo" start "Zabbix Agent 2" 2>&1 | Out-Null
        return $true
    }
}

# Carrega lista de alvos
$alvos = @()
if ($ListaCSV -and (Test-Path $ListaCSV)) {
    $alvos = Import-Csv $ListaCSV | ForEach-Object { $_.ip }
} elseif ($Computadores.Count) {
    $alvos = $Computadores
}
# Aceita lista separada por virgula tambem (ex.: -Computadores "192.168.0.131,192.168.0.108")
$alvos = @($alvos | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })

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

        # Conecta no share ADMIN$ (credenciais opcionais -Usuario/-Senha)
        if (!(ConectarShare $alvo)) { continue }

        # Verifica se ja tem o agente instalado
        $svc = ObterServico $alvo
        if ($svc -and !$Forcar) {
            $estado = if ($svc.State) { $svc.State } else { "$($svc.Status)" }
            Log "  Agente ja instalado (status: $estado). Atualizando conf para servidor $ServidorZabbix..."
            try {
                $confRemoto = "\\$alvo\C$\Program Files\Zabbix Agent 2\zabbix_agent2.conf"
                if (Test-Path $confRemoto) {
                    $conteudo = [System.IO.File]::ReadAllText($confRemoto)
                    $origem = $conteudo
                    # Server/ServerActive -> servidor atual (IPs antigos quebram a coleta)
                    $conteudo = [regex]::Replace($conteudo, '(?im)^[ \t]*Server[ \t]*=.*$', "Server=$ServidorZabbix")
                    $conteudo = [regex]::Replace($conteudo, '(?im)^[ \t]*ServerActive[ \t]*=.*$', "ServerActive=$ServidorZabbix")
                    # HostMetadata -> habilita o auto-registro/IP adaptativo
                    if ($conteudo -match '(?im)^[ \t]*HostMetadata[ \t]*=') {
                        $conteudo = [regex]::Replace($conteudo, '(?im)^[ \t]*HostMetadata[ \t]*=.*$', 'HostMetadata=inventario-ti')
                    } else {
                        $conteudo = $conteudo.TrimEnd() + "`r`nHostMetadata=inventario-ti`r`n"
                    }
                    if ($conteudo -ne $origem) {
                        Copy-Item -Path $confRemoto -Destination "$confRemoto.bak-$(Get-Date -Format yyyyMMddHHmm)" -Force
                        [System.IO.File]::WriteAllText($confRemoto, $conteudo)
                        Log "  conf atualizado (Server/ServerActive=$ServidorZabbix, HostMetadata=inventario-ti)"
                        if (ReiniciarServico $alvo) { Log "  servico reiniciado" }
                        else { Log "  AVISO: conf atualizado, mas o servico nao foi reiniciado (reinicie manualmente)" }
                    } else {
                        Log "  conf ja estava atualizado"
                    }
                } else {
                    Log "  AVISO: conf remoto nao encontrado ($confRemoto)"
                }
            } catch {
                Log "  ERRO ao atualizar conf de $alvo : $($_.Exception.Message)"
            }
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
            "HOSTMETADATA=inventario-ti",
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
            $svc = ObterServico $alvo
            if ($svc) {
                $estado = if ($svc.State) { $svc.State } else { "$($svc.Status)" }
                Log "  Servico 'Zabbix Agent 2' status: $estado"
                if ($estado -ne 'Running') {
                    Log "  Tentando iniciar servico..."
                    if ($Usuario) {
                        if (ReiniciarServico $alvo) { Log "  servico iniciado" }
                        else { Log "  AVISO: nao foi possivel iniciar o servico" }
                    } else {
                        Invoke-Command -ComputerName $alvo -ScriptBlock {
                            Start-Service "Zabbix Agent 2"
                        } -ErrorAction SilentlyContinue
                    }
                }
            } else {
                Log "  AVISO: nao foi possivel consultar o servico do agente"
            }
            Log "  DEPLOY OK: $alvo"
        }
    } catch {
        Log "  ERRO em $alvo : $($_.Exception.Message)"
    } finally {
        DesconectarShare $alvo
    }
}

Log "=== Deploy finalizado. Log: $LogFile ==="
