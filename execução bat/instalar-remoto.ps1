# =============================================================================
#  INSTALAR AGENTE REMOTO no PC 192.168.0.108
#  Copia a pasta "execução bat" para o PC alvo e executa o instalador la.
#  Uso (como Administrador):
#     .\instalar-remoto.ps1 -Computador 192.168.0.108 -Usuario ADMIN -Senha "SENHA"
#
#  Se nao tiver senha, vai falhar (Windows bloqueia logon de rede sem senha) —
#  nesse caso, copie a pasta "execução bat" para o PC e rode instalar-tudo.bat la.
# =============================================================================
param(
    [string]$Computador = '192.168.0.108',
    [string]$Usuario = '',
    [string]$Senha = ''
)

$origem = Join-Path (Split-Path $PSScriptRoot -Parent) 'execução bat'
if (!(Test-Path $origem)) { Write-Error "Pasta origem nao encontrada: $origem"; exit 1 }

Write-Output "=== INSTALACAO REMOTA DO AGENTE EM $Computador ==="

# 1) credenciais
if ($Usuario -and $Senha) {
    $senhaSegura = ConvertTo-SecureString $Senha -AsPlainText -Force
    $cred = New-Object System.Management.Automation.PSCredential($Usuario, $senhaSegura)
    try {
        New-PSDrive -Name Z -PSProvider FileSystem -Root "\\$Computador\C$" -Credential $cred -ErrorAction Stop | Out-Null
        Write-Output "[OK] Conectado ao C$ remoto com credenciais de $Usuario"
    } catch {
        Write-Error "[ERRO] Falha ao conectar: $($_.Exception.Message)"; exit 1
    }
} else {
    try {
        New-PSDrive -Name Z -PSProvider FileSystem -Root "\\$Computador\C$" -ErrorAction Stop | Out-Null
        Write-Output "[OK] Conectado ao C$ remoto (conta atual)"
    } catch {
        Write-Error "[ERRO] Acesso negado ao C$. Informe -Usuario/-Senha, ou copie a pasta manualmente."; exit 1
    }
}

# 2) copia a pasta
$destino = "Z:\InstaladorZabbix"
if (!(Test-Path $destino)) { New-Item -ItemType Directory -Path $destino -Force | Out-Null }
Copy-Item -Path "$origem\*" -Destination $destino -Recurse -Force
Write-Output "[OK] Pasta copiada para \\$Computador\C$\InstaladorZabbix"

# 3) dispara o instalador silencioso remotamente via WMI/PsExec-like
$batRemoto = "C:\InstaladorZabbix\instalar-tudo.bat"
if ($cred) {
    $res = Invoke-WmiMethod -Class Win32_Process -Name Create -ComputerName $Computador -Credential $cred `
        -ArgumentList "cmd.exe /c `"$batRemoto`" /silent" -ErrorAction Stop
} else {
    $res = Invoke-WmiMethod -Class Win32_Process -Name Create -ComputerName $Computador `
        -ArgumentList "cmd.exe /c `"$batRemoto`" /silent" -ErrorAction Stop
}
Write-Output "[OK] Instalador disparado remotamente (PID $($res.ProcessId))."
Write-Output "     Aguarde ~60s. Verifique depois com: .\verificar-agente.ps1 -Computador $Computador"
