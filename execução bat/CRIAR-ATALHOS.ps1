# Cria atalhos na Area de Trabalho para abrir Painel e Zabbix sem depender de IP fixo
$root = 'C:\Users\usuario\Documents\cadastro-computadores-v3'
$dir = (Get-ChildItem -Path $root -Directory | Where-Object { $_.Name -like 'execu*bat' } | Select-Object -First 1).FullName
$desktop = [Environment]::GetFolderPath('Desktop')
$WshShell = New-Object -ComObject WScript.Shell

$atalhos = @(
    @{ Nome='INVENTARIO TI - Abrir Painel'; Alvo=(Join-Path $dir 'ABRIR-PAINEL.vbs'); Icone='shell32.dll,21' },
    @{ Nome='ZABBIX - Abrir Painel'; Alvo=(Join-Path $dir 'ABRIR-ZABBIX.vbs'); Icone='shell32.dll,13' }
)
foreach ($a in $atalhos) {
    $lnk = $WshShell.CreateShortcut((Join-Path $desktop ($a.Nome + '.lnk')))
    $lnk.TargetPath = 'wscript.exe'
    $lnk.Arguments = '"' + $a.Alvo + '"'
    $lnk.IconLocation = $a.Icone
    $lnk.Description = 'Detecta o IP do servidor automaticamente e abre o painel'
    $lnk.Save()
    Write-Output ('CRIADO: ' + (Join-Path $desktop ($a.Nome + '.lnk')))
}
