# Zabbix Agent 2 — Instalação no PC 192.168.0.131

## Pré-requisitos
- Acesso administrativo ao PC 192.168.0.131
- Arquivos copiados para o PC destino (pasta `C:\zabbix\` ou similar)
- Porta 10050/tcp aberta no firewall do PC destino

---

## Passo 1 — Copiar arquivos para o PC 131

Neste computador (192.168.0.216), abra o PowerShell **como Administrador** e copie:

```powershell
# Cria pasta no PC destino (precisa credenciais admin do .131)
net use \\192.168.0.131\C$ /user:ADMINISTRADOR SUA_SENHA

# Copia o instalador e o config
copy "C:\Users\usuario\Documents\cadastro-computadores-v3\zabbix-deploy\zabbix_agent2-7.0-latest-windows-amd64-openssl.msi" \\192.168.0.131\C$\
copy "C:\Users\usuario\Documents\cadastro-computadores-v3\zabbix-deploy\zabbix_agent2.conf" \\192.168.0.131\C$\
```

Ou copie manualmente via pendrive/remotedesktop:
- `zabbix_agent2-7.0-latest-windows-amd64-openssl.msi` (17.6 MB)
- `zabbix_agent2.conf` (config com PSK já preenchido)

---

## Passo 2 — Instalar (no PC 131)

Abra **Prompt como Administrador** no PC 131:

```cmd
cd C:\
zabbix_agent2-7.0-latest-windows-amd64-openssl.msi /qn SERVER=192.168.0.216 SERVERACTIVE=192.168.0.216 HOSTNAME=pc-131 ENABLEPATH=1 ALLOWKEY=system.run[*]
```

**OU** instalação interativa:
1. Execute o `.msi`
2. Next → Next → Next
3. Em **Server address**: `192.168.0.216`
4. Em **Server active**: `192.168.0.216`
5. Finish

---

## Passo 3 — Configurar PSK (criptografia)

No PC 131, edite `C:\Program Files\Zabbix Agent 2\zabbix_agent2.d\psk.conf`:

```ini
TLSConnect=psk
TLSAccept=psk
TLSPSKIdentity=inventario-ti-psk
TLSPSKFile=C:\Program Files\Zabbix Agent 2\zabbix_agent2.d\psk.txt
```

Crie o arquivo `psk.txt` na mesma pasta com esta chave (sem quebra de linha):

```
593a91a9e1fad99ef8965bdcc830e8be6326ae30d5050fac5c2c5a9ee3ae552b
```

---

## Passo 4 — Firewall

No PC 131 (Prompt Admin):

```cmd
netsh advfirewall firewall add rule name="Zabbix Agent 2" dir=in action=allow protocol=TCP localport=10050
```

---

## Passo 5 — Reiniciar serviço

```cmd
net stop "Zabbix Agent 2"
net start "Zabbix Agent 2"
```

Ou via Services.msc → "Zabbix Agent 2" → Restart.

---

## Passo 6 — Verificar

No PC 131:
```cmd
"C:\Program Files\Zabbix Agent 2\zabbix_agent2.exe" -t agent.version
```

Deve retornar: `agent.version=7.0.x`

No PC 192.168.0.216 (este), teste a conectividade:
```powershell
Test-NetConnection -ComputerName 192.168.0.131 -Port 10050
```

---

## Passo 7 — Ver no Zabbix

1. Abra http://localhost:8081 (ou http://192.168.0.216:8081)
2. Login: `Admin` / `zabbix`
3. Vá em **Monitoring → Hosts**
4. Procure por `pc-131` — deve aparecer com availability verde (ZBX)

---

## Passo 8 — Ver no Inário TI

1. Abra http://localhost:5903
2. Login: `admin` / `admin123`
3. Clique em **Monitoramento** no menu lateral
4. O PC 192.168.0.131 agora terá CPU, RAM, GPU, disco reais (via Zabbix)

---

## Solução de problemas

| Problema | Solução |
|----------|---------|
| Availability vermelha no Zabbix | Verifique firewall porta 10050 |
| "Connection refused" | Serviço parado → `net start "Zabbix Agent 2"` |
| PSK error | Confira se TLSPSKFile aponta para o arquivo correto |
| Host aparece mas sem dados | Aguarde 1-2 minutos (intervalo padrão do template) |
| Acesso negado ao copiar | Use credenciais de administrador do domínio |
