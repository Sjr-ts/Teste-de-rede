# Métricas em tempo real do PC local (CPU/GPU) — 2026-11-04

## O problema relatado
- Gerenciador de Tarefas: CPU alternando entre **34–84%**; painel: **28–54%** —
  o painel mostrava sempre mais baixo e com faixa comprimida.
- GPU "chegava mais perto", mas ficava **sempre atrasada** (sempre correndo atrás).
- Não podia exigir refresh da página.

## Causa raiz (medida, não deduzida)
i7-1255U é CPU **híbrida (P+E cores)**. Há dois contadores de "% CPU":

| Contador | Leituras medidas | Veredito |
|---|---|---|
| `% Processor Time` (Processor) | 19, 32, 28, 29, 42, 30 | o que o painel usava — lê **baixo** |
| `% Processor Utility` (Processor Information) | 27, **54, 51, 53, 70, 54** | **o mesmo que o Gerenciador de Tarefas usa** |
| `os.cpus()` (delta) | 29, 50, 47, 53, 39, 45 | intermediário |

Além da métrica errada:
1. **Cada leitura spawnava um PowerShell novo** (~1.5–2.3s por amostra) → valor
   sempre velho no momento de exibir;
2. A "GPU tempo real" chamava `hostmetrics.coletar()` — a **coleta COMPLETA de
   ~6,9s** (disco WMI + 3 amostras de GPU + WMI do nome) com cache de 3s → a GPU
   exibida tinha 5–10s de idade, **sistematicamente**;
3. O `setInterval(3s)` disparava a coleta completa, que levava mais que 3s →
   **coletas sobrepostas** (concorrência PowerShell), com last-write-wins →
   jitter e mais latência;
4. `Get-Counter` direto falha no Windows pt-BR para os contadores de Processor
   ("O objeto especificado não foi encontrado") — mas o `.NET PerformanceCounter`
   com o **nome em inglês** funciona (use `% Processor Utility` / processor information).

## A solução

### 1. Amostrador persistente — `monitor/tempo-real.js`
**Um único** processo PowerShell vivo, em loop:

```
while ($true) {
  if (! (Get-Process -Id $NodePid)) { break }   // pai morreu -> sai sozinho ~1s
  CPU: PerformanceCounter('Processor Information','% Processor Utility','_Total') -> 'CPU|<pct>|<ts>' 1x/s
  GPU: Get-Counter '\GPU Engine(*)\Utilization Percentage' (soma >0, cap 100) -> 'GPU|<pct>|<ts>' 1x/2s
  Start-Sleep 1000
}
```

- Zero startup por amostra; latência ~0–2s (idade real exibida na célula:
  "agora" / "há Ns" — nunca finge).
- **Auto-termina** quando o Node morre (linha `Get-Process -Id $NodePid` no
  loop) — provado: após `Stop-Process` no servidor, o amostrador sumiu em <3s.
- Se o processo morrer por conta própria, reinicia com backoff (2s→30s);
  se ficar sem amostrar CPU por >4s, a CPU passa a ser lida por `os.cpus()`
  (delta) — sempre **rotulada** com a fonte real (`fallback-os`).

### 2. `monitor/hostmetrics.js`
- `% Processor Utility` (cadeia **Utility → Time**) — o painel passa a medir
  igual ao Gerenciador de Tarefas, em qualquer CPU (híbrida ou não).
- `cpuUsoPct()`/`coletarCpuApenas()`: primeiro consultam o amostrador (resposta
  instantânea), depois o contador direto.
- `gpu()`: primeiro o amostrador (sem spawn); nome da GPU resolvido **1 vez** e
  cacheado (`_gpuNomeCache` via WMI) em vez de WMI a cada leitura.
- `coletar()`: CPU/GPU do amostrador quando fresco (<3s); `disco()` com **cache
  de 30s** (disco muda devagar; evita spawn WMI de ~1.5s por ciclo).
- `_coletaMs` e `cpu.fonte`/`cpu.amostraMs` retornam a fonte e a idade reais.

### 3. `server.cjs`
- Amostrador iniciado no boot; **push SSE `metricas-tempo-real`** a cada amostra
  (~1s), só se houver cliente — sem polling do navegador.
- `/api/monitor/cpu-tempo-real` e `/api/monitor/gpu-tempo-real`: lêem o
  amostrador em memória — **instantâneos** (antes spawnavam PS/6,9s).
- SSE `sistema` (3s): agora praticamente grátis (CPU/GPU/RAM do amostrador,
  disco cache) — sem mais coletas de ~7s empilhadas (o travamento estatístico).

### 4. `frontend/js/monitor.js`
- `data-local="1"` na linha do PC local (match robusto — antes dependia de
  `textContent.includes(ip)`).
- Listener SSE `metricas-tempo-real`: atualiza células CPU/GPU + KPIs
  **por amostra**, sem tocar no resto da tabela (sem flicker).
- Após cada `monRenderTabela` completa, **reaplica** os valores tempo-real nas
  células (antes a célula re-renderizava para o valor base velho).
- Idade real exibida ("agora" / "há Ns") — nunca dado velho rotulado como novo.

## Resultado (verificado com o servidor rodando)
- `cpu-tempo-real`: `{"cpu":72.7, ... "fonte":"utility"}` — idade <1s.
- Stream SSE: CPU/GPU chegam a cada ~1s com idade 0–2s; `erros:0`.
- Painel/sistema mostram fonte `utility`; GPU 14% com amostra <1s e nome real
  (Intel(R) Iris(R) Xe Graphics).
- CPU agora atinge 60–72% — **mesmo patamar do Gerenciador de Tarefas**.

## Notas / honestidade
- GPU: mesma fórmula de antes (soma das engines `GPU Engine\Utilization
  Percentage`, cap 100%) — estava "mais perto"; o problema era **só latência**.
- PCs **remotos** continuam sem CPU/GPU (precisa Zabbix Agent 2 instalado —
  documentado na tela).
- Detecta automaticamente CPU híbrida vs não-híbrida pela cadeia de contadores.
- Sem valores inventados: se o amostrador falha, cai para `os.cpus()` e rotula
  como `fallback-os`; sem dados, mostra "INDISP." — nunca número fictício.
