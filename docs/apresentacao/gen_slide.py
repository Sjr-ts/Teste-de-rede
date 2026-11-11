from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.enum.shapes import MSO_SHAPE

prs = Presentation()
prs.slide_width = Inches(13.333)
prs.slide_height = Inches(7.5)

# Color scheme
DARK_BG = RGBColor(0x0A, 0x0E, 0x1A)
CARD_BG = RGBColor(0x11, 0x18, 0x27)
ACCENT = RGBColor(0x06, 0xD6, 0xA0)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
MUTED = RGBColor(0x64, 0x74, 0x8B)
ERROR = RGBColor(0xEF, 0x44, 0x44)
SUCCESS = RGBColor(0x10, 0xB9, 0x81)
WARNING = RGBColor(0xF5, 0x9E, 0x0B)
INFO = RGBColor(0x3B, 0x82, 0xF6)

def add_background(slide, color=DARK_BG):
    bg = slide.background
    fill = bg.fill
    fill.solid()
    fill.fore_color.rgb = color

def add_shape(slide, left, top, width, height, fill_color=None, line_color=None, line_width=None):
    shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, left, top, width, height)
    shape.fill.solid()
    if fill_color:
        shape.fill.fore_color.rgb = fill_color
    else:
        shape.fill.background()
    if line_color:
        shape.line.color.rgb = line_color
    else:
        shape.line.fill.background()
    if line_width:
        shape.line.width = line_width
    return shape

def add_textbox(slide, left, top, width, height, text, font_size=18, font_color=WHITE, bold=False, alignment=PP_ALIGN.LEFT, font_name='Space Grotesk'):
    txBox = slide.shapes.add_textbox(left, top, width, height)
    tf = txBox.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.text = text
    p.font.size = Pt(font_size)
    p.font.color.rgb = font_color
    p.font.bold = bold
    p.font.name = font_name
    p.alignment = alignment
    return txBox

def add_bullet_list(slide, left, top, width, height, items, font_size=14, font_color=WHITE, spacing=6):
    txBox = slide.shapes.add_textbox(left, top, width, height)
    tf = txBox.text_frame
    tf.word_wrap = True
    for i, item in enumerate(items):
        if i == 0:
            p = tf.paragraphs[0]
        else:
            p = tf.add_paragraph()
        p.text = item
        p.font.size = Pt(font_size)
        p.font.color.rgb = font_color
        p.font.name = 'Space Grotesk'
        p.space_after = Pt(spacing)
    return txBox

# ===== SLIDE 1: Capa =====
slide = prs.slides.add_slide(prs.slide_layouts[6])
add_background(slide)
add_shape(slide, Inches(1), Inches(2.5), Inches(2), Pt(4), ACCENT)
add_textbox(slide, Inches(1), Inches(2.8), Inches(11), Inches(1.5),
    'Sistema de Inventario de TI', 44, WHITE, True, PP_ALIGN.LEFT)
add_textbox(slide, Inches(1), Inches(4.2), Inches(11), Inches(1.2),
    'Monitoramento Preventivo Zabbix 7.0 LTS', 24, MUTED, False, PP_ALIGN.LEFT)
add_textbox(slide, Inches(1), Inches(5.8), Inches(6), Inches(0.6),
    'Clone local testado \u00b7 Dados reais do ativo \u00b7 Zero alteracoes no producao', 14, ACCENT, False)
add_textbox(slide, Inches(8), Inches(5.8), Inches(4), Inches(0.6),
    'Versao 3.5.0', 14, MUTED, False, PP_ALIGN.RIGHT)

# ===== SLIDE 2: Visao Geral =====
slide = prs.slides.add_slide(prs.slide_layouts[6])
add_background(slide)
add_textbox(slide, Inches(0.8), Inches(0.5), Inches(6), Inches(0.6),
    'Visao Geral do Sistema', 32, WHITE, True)
add_shape(slide, Inches(0.8), Inches(1.2), Inches(2), Pt(4), ACCENT)
items_inv = ['101 computadores cadastrados', '97 ramais gerenciados', '22 setores configurados', '486 logs de operacao', '48 software/licencas']
add_bullet_list(slide, Inches(0.8), Inches(1.6), Inches(5.5), Inches(3), items_inv, 16, MUTED)
items_arch = ['Node.js + Express (porta 5903)', 'H2 database (arquivo)', 'WebSocket em tempo real', 'Docker Desktop 29.6.2', 'Zabbix 7.0.31 (4 containers)']
add_bullet_list(slide, Inches(7), Inches(0.8), Inches(5.5), Inches(3.5), items_arch, 16, MUTED)

# ===== SLIDE 3: M\u00dulo Monitoramento =====
slide = prs.slides.add_slide(prs.slide_layouts[6])
add_background(slide)
add_textbox(slide, Inches(0.8), Inches(0.5), Inches(6), Inches(0.6),
    'Modulo de Monitoramento', 32, WHITE, True)
add_shape(slide, Inches(0.8), Inches(1.2), Inches(2), Pt(4), ACCENT)
items_mon = ['Aba "Monitoramento" no dashboard', 'Status Zabbix em tempo real', 'KPIs: Acessiveis / Sem Resposta / Instaveis / Alertas / Incidentes', 'Tabela detalhada com CPU, GPU, RAM, Disco por PC']
add_bullet_list(slide, Inches(0.8), Inches(1.6), Inches(5.5), Inches(3.5), items_mon, 16, MUTED)
# KPI cards
kpi_data = [('11%', 'CPU', ACCENT, '12 nucleos'), ('75.4%', 'RAM', SUCCESS, '8.84/11.73 GB'), ('60.6%', 'Disco', WARNING, '281.77/465.12 GB'), ('Intel Iris Xe', 'GPU', ACCENT, '')]
for i, (val, lbl, clr, extra) in enumerate(kpi_data):
    col = Inches(0.8 + i % 2 * 5.8)
    row = Inches(5.2 + i // 2 * 1.3)
    add_shape(slide, col, row, Inches(2.5), Inches(1.5), CARD_BG, ACCENT)
    add_textbox(slide, col + Inches(0.2), row + Inches(0.2), Inches(2.1), Inches(0.8), val, 24, clr, True, PP_ALIGN.CENTER)
    add_textbox(slide, col + Inches(0.2), row + Inches(1.0), Inches(2.1), Inches(0.4), lbl, 12, MUTED, False, PP_ALIGN.CENTER)
    if extra:
        add_textbox(slide, col + Inches(0.2), row + Inches(1.2), Inches(2.1), Inches(0.3), extra, 11, MUTED, False)

# ===== SLIDE 4: Metricas Reais =====
slide = prs.slides.add_slide(prs.slide_layouts[6])
add_background(slide)
add_textbox(slide, Inches(0.8), Inches(0.5), Inches(6), Inches(0.6),
    'Metricas REAIS do PC Local', 32, WHITE, True)
items_met = ['CPU: Node os.cpus() — delta de tempo (11%, 12 nucleos)', 'GPU: nvidia-smi / Performance Counter (Intel Iris Xe, 11%)', 'RAM: os.freemem() / os.totalmem() (75.4%, 8.84/11.73 GB)', 'Disco: WMI Win32_LogicalDisk (60.6%, 281.77/465.12 GB)', 'Uptime: segundos desde boot (362h 57m) + detectao de reinicio', 'Rede: placa fisica (Ethernet) vs virtual (WSL)']
add_bullet_list(slide, Inches(0.8), Inches(1.2), Inches(8), Inches(4), items_met, 15, MUTED)
metrics = [('CPU', '11%', ACCENT, '12 nucleos'), ('RAM', '75.4%', SUCCESS, '8.84/11.73 GB'), ('Disco', '60.6%', WARNING, '281.77/465.12 GB'), ('GPU', '11%', ACCENT, 'Intel Iris Xe')]
for i, (name, val, clr, extra) in enumerate(metrics):
    col = Inches(0.8 + i % 2 * 5.9)
    add_shape(slide, col, Inches(3.5), Inches(2.7), Inches(1.8), CARD_BG, clr)
    add_textbox(slide, col + Inches(0.15), Inches(3.6), Inches(2.4), Inches(0.6), name, 14, WHITE, True)
    add_textbox(slide, col + Inches(0.15), Inches(4.1), Inches(2.4), Inches(0.6), val, 32, clr, True, PP_ALIGN.CENTER)
    add_textbox(slide, col + Inches(0.15), Inches(4.7), Inches(2.4), Inches(0.4), extra, 11, MUTED, False)

# ===== SLIDE 5: Coletor Agentless =====
slide = prs.slides.add_slide(prs.slide_layouts[6])
add_background(slide)
add_textbox(slide, Inches(0.8), Inches(0.5), Inches(6), Inches(0.6),
    'Coletor Agentless (sem instalar nada)', 32, WHITE, True)
add_shape(slide, Inches(0.8), Inches(1.2), Inches(2), Pt(4), ACCENT)
items_cl = ['Ping nativo do SO (Windows/Linux)', 'Parse em Portugues e Ingles', 'Timeout configuravel, 3 tentativas por ciclo', 'Concorrencia limitada (10 hosts simultaneos)', 'Historico JSONL + agregados diarios (retencao 30/365 dias)', 'Latencia media, P95, perda de pacotes']
add_bullet_list(slide, Inches(0.8), Inches(1.6), Inches(6), Inches(4.5), items_cl, 15, MUTED)
feats_list = ['Sem agente nos PCs: Somente ping a partir deste servidor', 'JSONL: Medicoes brutas + agregados por dia', 'Alertas: 5 gravidades x 5 confiancas + correlacao por setor']
for item in feats_list:
    add_bullet_list(slide, Inches(0.8), Inches(5.5), Inches(5.5), Inches(1.0), [item], 14, ACCENT if 'Alertas' in item else MUTED, 6)

# ===== SLIDE 6: Alertas =====
slide = prs.slides.add_slide(prs.slide_layouts[6])
add_background(slide)
add_textbox(slide, Inches(0.8), Inches(0.5), Inches(6), Inches(0.6),
    'Motor de Alertas e Diagnostico', 32, WHITE, True)
add_shape(slide, Inches(0.8), Inches(1.2), Inches(2), Pt(4), ACCENT)
add_textbox(slide, Inches(0.8), Inches(1.6), Inches(4), Inches(0.5), 'Niveis de Gravidade', 18, WHITE, True)
grav = [('CRITICA', ERROR), ('ALTA', ERROR), ('MEDIA', WARNING), ('BAIXA', WARNING), ('INFO', INFO)]
for i, (g, c) in enumerate(grav):
    r = Inches(0.8 + i % 5 * 0.9)
    add_shape(slide, r, Inches(2.2), Inches(0.7), Inches(0.4), CARD_BG, c)
    add_textbox(slide, r, Inches(2.2), Inches(0.7), Inches(0.4), g, 12, c, True, PP_ALIGN.CENTER)
add_textbox(slide, Inches(0.8), Inches(3.0), Inches(4), Inches(0.5), 'Niveis de Confianca', 18, WHITE, True)
conf = [('CONFIRMADO', SUCCESS), ('ALTA', SUCCESS), ('MODERADA', ACCENT), ('BAIXA', MUTED), ('INCONCLUSIVO', MUTED)]
for i, (g, c) in enumerate(conf):
    r = Inches(0.8 + i % 5 * 0.9)
    add_shape(slide, r, Inches(3.6), Inches(0.7), Inches(0.4), CARD_BG, c)
    add_textbox(slide, r, Inches(3.6), Inches(0.7), Inches(0.4), g, 12, c, True, PP_ALIGN.CENTER)
add_textbox(slide, Inches(0.8), Inches(4.8), Inches(6), Inches(0.5), 'Recursos', 18, WHITE, True)
items_feat = ['Correlacao por setor (incidente em massa)', 'Auto-resolucao apos N ciclos normais', 'Silencio de repetidos (15 min)']
add_bullet_list(slide, Inches(0.8), Inches(5.3), Inches(5.5), Inches(1.5), items_feat, 15, MUTED)

# ===== SLIDE: Zabbix Integration =====
slide = prs.slides.add_slide(prs.slide_layouts[6])
add_background(slide)
add_textbox(slide, Inches(0.8), Inches(0.5), Inches(6), Inches(0.6),
    'Integracao Zabbix 7.0 LTS', 32, WHITE, True)
add_shape(slide, Inches(0.8), Inches(1.2), Inches(2), Pt(4), ACCENT)
items_zz = ['Docker: postgres + server + web + agent (4 containers)', 'API JSON-RPC (login, host.get, problem.get, history.get)', 'selectTags: extend (correcao aplicada)', 'Hospedado em localhost:8081']
add_bullet_list(slide, Inches(0.8), Inches(1.6), Inches(6), Inches(3), items_zz, 15, MUTED)
zz_items = [('Status API', '/api/zabbix/status -> versao 7.0.31, ok:true'), ('Hosts Zabbix', '1 host local (agente) + configuracao para .131'), ('Sincronizacao', '/api/zabbix/sincronizar — cria/atualiza hosts automaticos')]
for i, (t, d) in enumerate(zz_items):
    add_shape(slide, Inches(0.8 + i % 2 * 6), Inches(3.5), Inches(2.8), Inches(1.5), CARD_BG, ACCENT)
    add_textbox(slide, Inches(1 + i % 2 * 6), Inches(3.6), Inches(2.4), Inches(0.4), t, 14, ACCENT, True)
    add_textbox(slide, Inches(1 + i % 2 * 6), Inches(3.95), Inches(2.4), Inches(0.8), d, 11, MUTED, False)

# ===== SLIDE: Zabbix Agent 2 =====
slide = prs.slides.add_slide(prs.slide_layouts[6])
add_background(slide)
add_textbox(slide, Inches(0.8), Inches(0.5), Inches(6), Inches(0.6),
    'Zabbix Agent 2 — Deploy Remoto', 32, WHITE, True)
add_shape(slide, Inches(0.8), Inches(1.2), Inches(2), Pt(4), ACCENT)
items_agent = ['Arquivos: zabbix_agent2-7.0-latest-windows-amd64-openssl.msi (17.6 MB)', 'zabbix_agent2.conf — config com PSK', 'psk.txt — chave: 593a91a9e1fad99ef8965bdcc830e8be6326ae30d5050fac5c2c5a9ee3ae552b', 'MANUAL_INSTALACAO_131.md — passo a passo de 6 etapas']
add_bullet_list(slide, Inches(0.8), Inches(1.6), Inches(6), Inches(3.5), items_agent, 15, MUTED)
add_textbox(slide, Inches(0.8), Inches(4.8), Inches(6), Inches(0.5), 'Metodos de Deploy', 18, WHITE, True)
methods = ['WinRM + PsExec (requer credenciais admin)', 'WMI RPC (porta 135 aberta)', 'SMB copy (porta 445 aberta) + execucao remota', 'Manual via RDP/TeamViewer']
add_bullet_list(slide, Inches(0.8), Inches(5.3), Inches(6), Inches(2), methods, 14, MUTED)

# ===== SLIDE: Endpoints API =====
slide = prs.slides.add_slide(prs.slide_layouts[6])
add_background(slide)
add_textbox(slide, Inches(0.8), Inches(0.5), Inches(6), Inches(0.6),
    'API Endpoints', 32, WHITE, True)
add_shape(slide, Inches(0.8), Inches(1.2), Inches(2), Pt(4), ACCENT)
data = [('/api/monitor/painel', 'GET', 'Resumo completo'), ('/api/monitor/sistema', 'GET', 'Metricas reais do PC local'), ('/api/monitor/ciclo', 'POST', 'Executar verificacao agora'), ('/api/monitor/host/:ip', 'GET', 'Detalhe de host'), ('/api/monitor/alertas', 'GET', 'Alertas ativos'), ('/api/zabbix/status', 'GET', 'Status Zabbix'), ('/api/zabbix/hosts', 'GET', 'Hosts cadastrados'), ('/api/zabbix/sincronizar', 'POST', 'Sincronizar hosts')]
for i, (ep, m, d) in enumerate(data):
    r = Inches(0.8 + i % 2 * 6.2)
    add_shape(slide, r, Inches(1.6), Inches(5.8), Inches(0.55), CARD_BG, ACCENT)
    add_textbox(slide, r + Inches(0.1), Inches(1.65), Inches(4.5), Inches(0.45), ep, 11, ACCENT, False, PP_ALIGN.LEFT)
    add_textbox(slide, r + Inches(4.7), Inches(1.65), Inches(1.2), Inches(0.45), m, 11, MUTED, False, PP_ALIGN.CENTER)
    add_textbox(slide, r + Inches(0.1), Inches(2.15), Inches(5.6), Inches(0.45), d, 10, MUTED, False, PP_ALIGN.LEFT)

# ===== SLIDE: Roadmap =====
slide = prs.slides.add_slide(prs.slide_layouts[6])
add_background(slide)
add_textbox(slide, Inches(0.8), Inches(0.5), Inches(6), Inches(0.6),
    'Roadmap — Próximos Passos', 32, WHITE, True)
road = [('WMI Remoto', 'CPU/RAM sem agente via WMI DCOM'), ('Agente Zabbix em todos', 'Deploy em 101 PCs via MSI'), ('Gráficos Históricos', 'Chart.js + retention 30/365 dias'), ('Notificacoes', 'Email + Telegram bot'), ('Manutencao Preditiva', 'Previsao de falha baseada em tendencias'), ('Multiusuario', 'Perfis: ADMIN / TECNICO / USER')]
for i, (t, d) in enumerate(road):
    col = Inches(0.8 + i % 3 * 4.1)
    add_shape(slide, col, Inches(1.6), Inches(3.8), Inches(1.2), CARD_BG, ACCENT)
    add_textbox(slide, col + Inches(0.15), Inches(1.7), Inches(3.5), Inches(0.55), t, 16, ACCENT, True)
    add_textbox(slide, col + Inches(0.15), Inches(2.35), Inches(3.5), Inches(0.55), d, 12, MUTED, False)
add_textbox(slide, Inches(0.8), Inches(5.5), Inches(5), Inches(1.2),
    'Prioridade: 1) WMI remoto 2) Agentes Zabbix 3) Graficos 4) Notificacoes', 13, MUTED, True)

# ===== SLIDE: Arquitetura =====
slide = prs.slides.add_slide(prs.slide_layouts[6])
add_background(slide)
add_textbox(slide, Inches(0.8), Inches(0.5), Inches(6), Inches(0.6),
    'Arquitetura do Sistema', 32, WHITE, True)
boxes = [('PCs da Rede', '192.168.0.216\n192.168.0.131\n8.8.8.8\n192.168.0.10', ACCENT), ('Coletor Agentless', 'ICMP nativo SO\nJSONL + Agregados\nLatencia/P95/Perdas', SUCCESS), ('Zabbix 7.0', 'Docker: 4 containers\nAPI JSON-RPC\nPSK encryption', ACCENT), ('Inventario TI', 'localhost:5903\nExpress + H2\nAPI REST (/api/*)', SUCCESS)]
for i, (title, desc, clr) in enumerate(boxes):
    col = Inches(0.8 + i % 2 * 6.2)
    row = Inches(1.6 + i // 2 * 2.8)
    add_shape(slide, col, row, Inches(5.8), Inches(2.5), CARD_BG, clr)
    add_textbox(slide, col + Inches(0.2), row + Inches(0.1), Inches(5.4), Inches(0.4), title, 16, clr, True)
    add_textbox(slide, col + Inches(0.2), row + Inches(0.5), Inches(5.4), Inches(1.8), desc, 12, MUTED, False)

# ===== SLIDE: Credenciais =====
slide = prs.slides.add_slide(prs.slide_layouts[6])
add_background(slide)
add_textbox(slide, Inches(0.8), Inches(0.5), Inches(6), Inches(0.6),
    'Acesso e Credenciais', 32, WHITE, True)
add_textbox(slide, Inches(0.8), Inches(1.2), Inches(5.5), Inches(0.5), 'Inventario TI', 18, WHITE, True)
inv_items = ['URL: http://localhost:5903', 'Login: admin / admin123', 'Usuario: tecnico / 123456', 'Usuario: usuario / 123456']
add_bullet_list(slide, Inches(0.8), Inches(1.8), Inches(5.5), Inches(2), inv_items, 14, MUTED)
add_textbox(slide, Inches(0.8), Inches(3.3), Inches(5.5), Inches(0.5), 'Zabbix', 18, WHITE, True)
zz_items = ['URL: http://localhost:8081', 'Login: Admin / zabbix', 'API: http://localhost:8081/api_jsonrpc.php']
add_bullet_list(slide, Inches(0.8), Inches(3.9), Inches(5.5), Inches(2), zz_items, 14, MUTED)
add_textbox(slide, Inches(0.8), Inches(5.5), Inches(5.5), Inches(0.8),
    'Build: 1790777219 | App.js: 372956 bytes | Porta: 5903 | Versao: v3578-local', 12, MUTED, True)
add_textbox(slide, Inches(0.8), Inches(6.3), Inches(5.5), Inches(0.5),
    'Regra inegociavel: so editar em C:\\Users\\usuario\\Documents\\cadastro-computadores-v3', 10, WARNING, True)

# ===== SLIDE: Footer =====
slide = prs.slides.add_slide(prs.slide_layouts[6])
add_background(slide)
add_textbox(slide, Inches(1), Inches(2.5), Inches(11), Inches(1),
    'Sistema profissional de monitoramento preventivo', 20, MUTED, False, PP_ALIGN.CENTER)
add_textbox(slide, Inches(1), Inches(3.5), Inches(11), Inches(0.5),
    'Baseada em Zabbix 7.0 LTS \u00b7 Agenteless + Agent2', 14, MUTED, False, PP_ALIGN.CENTER)
add_textbox(slide, Inches(1), Inches(4.5), Inches(11), Inches(0.5),
    'Clone local de teste \u00b7 Dados reais do ativo \u00b7 Producao em 192.168.0.94:3030', 12, MUTED, False, PP_ALIGN.CENTER)
add_textbox(slide, Inches(1), Inches(5.5), Inches(11), Inches(0.5),
    '\u00a9 2026 - Todos os direitos reservados', 10, MUTED, False, PP_ALIGN.CENTER)

# Save
output_path = r'C:\Users\usuario\Documents\cadastro-computadores-v3\Apresentacao_Inventario_Monitoramento.pptx'
prs.save(output_path)
print('Slide criado com sucesso:', output_path)