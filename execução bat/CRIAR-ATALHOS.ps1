# Cria atalhos na Area de Trabalho para abrir Painel e Zabbix sem depender de IP fixo.
#
# Corrigido em 26/11/2026:
#  - CAMINHO AUTOSSUFICIENTE: antes usava um caminho hardcoded do servidor;
#    em outro PC a pasta esta em outro lugar e os atalhos viravam atalho morto.
#  - ALVOS EXISTENTES: apontava para ABRIR-PAINEL.vbs/ABRIR-ZABBIX.vbs que
#    NAO existiam na pasta (falha silenciosa - o bat logava "[OK]" mesmo assim).
#    Agora os .vbs sao GERADOS aqui se nao existirem.
#  - Saida clara (CRIADO/ERRO) para o instalador checar o exit code.
$ErrorActionPreference = 'Stop'
$dir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$desktop = [Environment]::GetFolderPath('Desktop')

# ---- 1) gerador dos abridores (detectam o servidor e abrem o painel) ----
$vbsPainel = Join-Path $dir 'ABRIR-PAINEL.vbs'
$vbsZabbix = Join-Path $dir 'ABRIR-ZABBIX.vbs'

$vbsConteudo = @'
' ABRIR-*.vbs - detecta o IP do servidor e abre o painel (sem digitar IP).
' Gerado pelo CRIAR-ATALHOS.ps1. Funciona em qualquer PC: usa o detect-server.ps1
' ao lado (scan paralelo de toda a sub-rede na porta 5903).
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
det = dir & "\detect-server.ps1"
ip = "127.0.0.1"
If fso.FileExists(det) Then
    On Error Resume Next
    Set o = sh.Exec("powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & det & """")
    If Err.Number = 0 Then
        saida = Trim(o.StdOut.ReadAll)
        If saida <> "" Then ip = saida
    End If
    On Error GoTo 0
End If
' PORTA e CAMINHO vem do nome do proprio arquivo (ABRIR-PAINEL = 5903, ABRIR-ZABBIX = 8081)
nome = fso.GetBaseName(WScript.ScriptFullName)
If UCase(nome) = "ABRIR-ZABBIX" Then
    sh.Run "http://" & ip & ":8081/", 1, False
Else
    sh.Run "http://" & ip & ":5903/acesso-automatico.html", 1, False
End If
'@

foreach ($alvo in @($vbsPainel, $vbsZabbix)) {
    if (-not (Test-Path -LiteralPath $alvo)) {
        Set-Content -LiteralPath $alvo -Value $vbsConteudo -Encoding ASCII
    }
}

# ---- 2) atalhos ----
$WshShell = New-Object -ComObject WScript.Shell
$atalhos = @(
    @{ Nome = 'INVENTARIO TI - Abrir Painel'; Alvo = $vbsPainel; Icone = 'shell32.dll,21' },
    @{ Nome = 'ZABBIX - Abrir Painel'; Alvo = $vbsZabbix; Icone = 'shell32.dll,13' }
)
$falhas = 0
foreach ($a in $atalhos) {
    if (-not (Test-Path -LiteralPath $a.Alvo)) {
        Write-Output ("ERRO: alvo nao existe: " + $a.Alvo)
        $falhas++
        continue
    }
    try {
        $lnk = $WshShell.CreateShortcut((Join-Path $desktop ($a.Nome + '.lnk')))
        $lnk.TargetPath = 'wscript.exe'
        $lnk.Arguments = '"' + $a.Alvo + '"'
        $lnk.IconLocation = $a.Icone
        $lnk.Description = 'Detecta o IP do servidor automaticamente e abre o painel'
        $lnk.WorkingDirectory = $dir
        $lnk.Save()
        Write-Output ('CRIADO: ' + (Join-Path $desktop ($a.Nome + '.lnk')))
    } catch {
        Write-Output ('ERRO ao criar ' + $a.Nome + ': ' + $_.Exception.Message)
        $falhas++
    }
}
if ($falhas -gt 0) { exit 1 }
exit 0
