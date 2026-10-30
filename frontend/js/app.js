// ==========================================
// Cadastro de Computadores - Invent�rio de TI
// Complete Rewrite v4.2 - Audit logging, cross-tab refresh
// ==========================================
const API = '';
let currentPage = { computadores: 0, manutencoes: 0, ordensServico: 0, logs: 0, software: 0, ramais: 0, trocas: 0 };
let allComputadores = [];
let selectedComputadores = new Set();
let USE_MOCK = false;
let _relData = { eq: null, man: null, os: null };
let _dashData = { eq: null, man: null, os: null, alertas: null };
let _activeStatKey = null;
let _activeKpiKey = null;
let _currentSection = 'painel';
let _currentTab = 0;
let _photoUploading = false;
let _ramalPhotoUploading = false;
let _manPhotoUploading = false;
let _manFilters = { status: '', termo: '', showConcluidas: false };
let _wsClient = null;
let _wsConnected = false;
let _wsReconnectTimer = null;
if (typeof Chart !== 'undefined') {
    Chart.defaults.color = '#606070';
    Chart.defaults.borderColor = 'rgba(255,255,255,0.04)';
    Chart.defaults.font.family = "'Inter', sans-serif";
}

var _curDate = new Date();
var _curYear = _curDate.getFullYear();
var _curMonth = _curDate.getMonth();
var _prevDate = new Date(_curYear, _curMonth - 1, 1);
var _prevYear = _prevDate.getFullYear();
var _prevMonth = _prevDate.getMonth();
function _dyn(y, m, d, h) { return new Date(y, m, d, h || 9, 0, 0).toISOString(); }

var MOCK_COMPUTADORES = [
    { id: 1, nomePc: 'PC-ADM-001', numeroSerie: 'SN-2024-001', modeloMarca: 'Dell OptiPlex 7090', processador: 'Intel Core i7-11700', memoriaRam: '16GB DDR4', armazenamento: '512GB SSD NVMe', usuarioDesignado: 'Carlos Silva', fornecedor: 'Dell Tecnologia', status: 'ATIVO', fotoUrl: '', dataCadastro: '2024-01-15T10:00:00', dataInicioCiclo: _dyn(_curYear, _curMonth - 2, 1), proximaManutencao: _dyn(_curYear, _curMonth + 6, 1), dataUltimaManutencao: _dyn(_curYear, _curMonth - 2, 1) },
    { id: 2, nomePc: 'PC-ADM-002', numeroSerie: 'SN-2024-002', modeloMarca: 'Lenovo ThinkCentre M920', processador: 'Intel Core i5-9500', memoriaRam: '8GB DDR4', armazenamento: '256GB SSD', usuarioDesignado: 'Ana Beatriz', fornecedor: 'Lenovo', status: 'ATIVO', fotoUrl: '', dataCadastro: '2024-02-10T10:00:00', dataInicioCiclo: _dyn(_curYear, _curMonth - 5, 1), proximaManutencao: _dyn(_curYear, _curMonth + 3, 1), dataUltimaManutencao: _dyn(_curYear, _curMonth - 5, 1) },
    { id: 3, nomePc: 'PC-LOG-001', numeroSerie: 'SN-2024-003', modeloMarca: 'HP ProDesk 400 G7', processador: 'Intel Core i5-10500', memoriaRam: '8GB DDR4', armazenamento: '256GB SSD', usuarioDesignado: 'Roberto Souza', fornecedor: 'HP Brasil', status: 'MANUTENCAO_PREVENTIVA', fotoUrl: '', dataCadastro: '2024-01-20T10:00:00', dataInicioCiclo: _dyn(_curYear, _curMonth - 7, 1), proximaManutencao: _dyn(_curYear, _curMonth + 1, 1), dataUltimaManutencao: _dyn(_curYear, _curMonth - 1, 15) },
    { id: 4, nomePc: 'PC-LOG-002', numeroSerie: 'SN-2024-004', modeloMarca: 'Dell Vostro 3681', processador: 'Intel Core i3-10100', memoriaRam: '4GB DDR4', armazenamento: '1TB HDD', usuarioDesignado: 'Maria Oliveira', fornecedor: 'Dell Tecnologia', status: 'MANUTENCAO_EMERGENCIAL', fotoUrl: '', dataCadastro: '2024-03-05T10:00:00', dataInicioCiclo: _dyn(_curYear, _curMonth - 9, 1), proximaManutencao: _dyn(_curYear, _curMonth - 1, 1), dataUltimaManutencao: _dyn(_curYear, _curMonth - 3, 10) },
    { id: 5, nomePc: 'PC-TI-001', numeroSerie: 'SN-2024-005', modeloMarca: 'Lenovo ThinkPad T490', processador: 'Intel Core i7-8565U', memoriaRam: '16GB DDR4', armazenamento: '512GB SSD', usuarioDesignado: 'Joao Pedro', fornecedor: 'Lenovo', status: 'ATIVO', fotoUrl: '', dataCadastro: '2024-01-10T10:00:00', dataInicioCiclo: _dyn(_curYear, _curMonth, 1), proximaManutencao: _dyn(_curYear, _curMonth + 8, 1), dataUltimaManutencao: _dyn(_curYear, _curMonth, 1) },
    { id: 6, nomePc: 'PC-FIN-001', numeroSerie: 'SN-2024-006', modeloMarca: 'HP EliteDesk 800 G6', processador: 'Intel Core i5-10500T', memoriaRam: '8GB DDR4', armazenamento: '256GB SSD', usuarioDesignado: 'Fernanda Lima', fornecedor: 'HP Brasil', status: 'ATIVO', fotoUrl: '', dataCadastro: '2024-02-15T10:00:00', dataInicioCiclo: _dyn(_curYear, _curMonth - 3, 1), proximaManutencao: _dyn(_curYear, _curMonth + 5, 1), dataUltimaManutencao: _dyn(_curYear, _curMonth - 3, 1) },
    { id: 7, nomePc: 'PC-FIN-002', numeroSerie: 'SN-2024-007', modeloMarca: 'Dell OptiPlex 3080', processador: 'Intel Core i3-10100', memoriaRam: '4GB DDR4', armazenamento: '500GB HDD', usuarioDesignado: 'Pedro Henrique', fornecedor: 'Dell Tecnologia', status: 'MANUTENCAO_PREDITIVA', fotoUrl: '', dataCadastro: '2024-03-01T10:00:00', dataInicioCiclo: _dyn(_curYear, _curMonth - 6, 1), proximaManutencao: _dyn(_curYear, _curMonth + 2, 1), dataUltimaManutencao: _dyn(_curYear, _curMonth - 1, 5) },
    { id: 8, nomePc: 'PC-RH-001', numeroSerie: 'SN-2024-008', modeloMarca: 'Acer Veriton M4660G', processador: 'Intel Core i5-9400', memoriaRam: '8GB DDR4', armazenamento: '256GB SSD', usuarioDesignado: 'Juliana Costa', fornecedor: 'Acer', status: 'ATIVO', fotoUrl: '', dataCadastro: '2024-01-25T10:00:00', dataInicioCiclo: _dyn(_curYear, _curMonth - 1, 1), proximaManutencao: _dyn(_curYear, _curMonth + 7, 1), dataUltimaManutencao: _dyn(_curYear, _curMonth - 1, 1) },
    { id: 9, nomePc: 'PC-VEN-001', numeroSerie: 'SN-2024-009', modeloMarca: 'Lenovo IdeaCentre 520', processador: 'AMD Ryzen 5 3500', memoriaRam: '8GB DDR4', armazenamento: '1TB HDD', usuarioDesignado: 'Lucas Almeida', fornecedor: 'Lenovo', status: 'CONCLUIDO', fotoUrl: '', dataCadastro: '2024-02-20T10:00:00', dataInicioCiclo: _dyn(_curYear, _curMonth - 4, 1), proximaManutencao: _dyn(_curYear, _curMonth + 4, 1), dataUltimaManutencao: _dyn(_curYear, _curMonth - 4, 1) },
    { id: 10, nomePc: 'PC-VEN-002', numeroSerie: 'SN-2024-010', modeloMarca: 'HP ProOne 440 G6', processador: 'Intel Core i5-9500T', memoriaRam: '8GB DDR4', armazenamento: '256GB SSD', usuarioDesignado: 'Mariana Santos', fornecedor: 'HP Brasil', status: 'ATIVO', fotoUrl: '', dataCadastro: '2024-03-10T10:00:00', dataInicioCiclo: _dyn(_curYear, _curMonth - 8, 1), proximaManutencao: _dyn(_curYear, _curMonth, 1), dataUltimaManutencao: _dyn(_curYear, _curMonth - 2, 20) },
    { id: 11, nomePc: 'PC-PRD-001', numeroSerie: 'SN-2024-011', modeloMarca: 'Dell Precision 3430', processador: 'Intel Core i7-8700', memoriaRam: '32GB DDR4', armazenamento: '1TB SSD', usuarioDesignado: 'T�cnico A', fornecedor: 'Dell Tecnologia', status: 'ATIVO', fotoUrl: '', dataCadastro: '2024-01-05T10:00:00', dataInicioCiclo: _dyn(_curYear, _curMonth - 2, 15), proximaManutencao: _dyn(_curYear, _curMonth + 6, 15), dataUltimaManutencao: _dyn(_curYear, _curMonth - 2, 15) },
    { id: 12, nomePc: 'PC-PRD-002', numeroSerie: 'SN-2024-012', modeloMarca: 'Lenovo ThinkStation P330', processador: 'Intel Core i9-9900', memoriaRam: '64GB DDR4', armazenamento: '2TB SSD', usuarioDesignado: 'T�cnico B', fornecedor: 'Lenovo', status: 'ATIVO', fotoUrl: '', dataCadastro: '2024-02-01T10:00:00', dataInicioCiclo: _dyn(_curYear, _curMonth - 5, 15), proximaManutencao: _dyn(_curYear, _curMonth + 3, 15), dataUltimaManutencao: _dyn(_curYear, _curMonth - 5, 15) },
    { id: 13, nomePc: 'PC-PRD-003', numeroSerie: 'SN-2024-013', modeloMarca: 'HP Z2 Tower G4', processador: 'Intel Core i7-9700', memoriaRam: '16GB DDR4', armazenamento: '512GB SSD', usuarioDesignado: 'T�cnico C', fornecedor: 'HP Brasil', status: 'MANUTENCAO_PREVENTIVA', fotoUrl: '', dataCadastro: '2024-03-15T10:00:00', dataInicioCiclo: _dyn(_curYear, _curMonth - 6, 10), proximaManutencao: _dyn(_curYear, _curMonth + 2, 10), dataUltimaManutencao: _dyn(_curYear, _curMonth - 1, 10) },
    { id: 14, nomePc: 'PC-ADM-003', numeroSerie: 'SN-2024-014', modeloMarca: 'Dell Latitude 5520', processador: 'Intel Core i5-1135G7', memoriaRam: '8GB DDR4', armazenamento: '256GB SSD', usuarioDesignado: 'Gerente TI', fornecedor: 'Dell Tecnologia', status: 'ATIVO', fotoUrl: '', dataCadastro: '2024-01-18T10:00:00', dataInicioCiclo: _dyn(_curYear, _curMonth - 3, 10), proximaManutencao: _dyn(_curYear, _curMonth + 5, 10), dataUltimaManutencao: _dyn(_curYear, _curMonth - 3, 10) },
    { id: 15, nomePc: 'PC-ALM-001', numeroSerie: 'SN-2024-015', modeloMarca: 'Acer Aspire TC-885', processador: 'Intel Core i3-9100', memoriaRam: '4GB DDR4', armazenamento: '1TB HDD', usuarioDesignado: 'Auxiliar Almox', fornecedor: 'Acer', status: 'MANUTENCAO_EMERGENCIAL', fotoUrl: '', dataCadastro: '2024-02-28T10:00:00', dataInicioCiclo: _dyn(_curYear, _curMonth - 10, 1), proximaManutencao: _dyn(_curYear, _curMonth - 2, 1), dataUltimaManutencao: _dyn(_curYear, _curMonth - 4, 5) },
    { id: 16, nomePc: 'PC-ADM-004', numeroSerie: 'SN-2024-016', modeloMarca: 'Lenovo ThinkCentre M70s', processador: 'Intel Core i5-11400', memoriaRam: '16GB DDR4', armazenamento: '512GB SSD', usuarioDesignado: 'Assistente Adm', fornecedor: 'Lenovo', status: 'ATIVO', fotoUrl: '', dataCadastro: '2024-03-20T10:00:00', dataInicioCiclo: _dyn(_curYear, _curMonth - 1, 20), proximaManutencao: _dyn(_curYear, _curMonth + 7, 20), dataUltimaManutencao: _dyn(_curYear, _curMonth - 1, 20) },
    { id: 17, nomePc: 'PC-LOG-003', numeroSerie: 'SN-2024-017', modeloMarca: 'HP ProDesk 600 G6', processador: 'Intel Core i7-10700', memoriaRam: '16GB DDR4', armazenamento: '512GB SSD', usuarioDesignado: 'Supervisor Log', fornecedor: 'HP Brasil', status: 'CONCLUIDO', fotoUrl: '', dataCadastro: '2024-01-22T10:00:00', dataInicioCiclo: _dyn(_curYear, _curMonth - 4, 10), proximaManutencao: _dyn(_curYear, _curMonth + 4, 10), dataUltimaManutencao: _dyn(_curYear, _curMonth - 4, 10) },
    { id: 18, nomePc: 'PC-FIN-003', numeroSerie: 'SN-2024-018', modeloMarca: 'Dell OptiPlex 5090', processador: 'Intel Core i5-11500', memoriaRam: '8GB DDR4', armazenamento: '256GB SSD', usuarioDesignado: 'Analista Fin', fornecedor: 'Dell Tecnologia', status: 'ATIVO', fotoUrl: '', dataCadastro: '2024-02-12T10:00:00', dataInicioCiclo: _dyn(_curYear, _curMonth - 7, 5), proximaManutencao: _dyn(_curYear, _curMonth + 1, 5), dataUltimaManutencao: _dyn(_curYear, _curMonth - 1, 5) },
    { id: 19, nomePc: 'PC-VEN-003', numeroSerie: 'SN-2024-019', modeloMarca: 'Lenovo ThinkCentre M920t', processador: 'Intel Core i5-9500', memoriaRam: '8GB DDR4', armazenamento: '256GB SSD', usuarioDesignado: 'Consultor Vendas', fornecedor: 'Lenovo', status: 'ATIVO', fotoUrl: '', dataCadastro: '2024-03-08T10:00:00', dataInicioCiclo: _dyn(_curYear, _curMonth, 5), proximaManutencao: _dyn(_curYear, _curMonth + 8, 5), dataUltimaManutencao: _dyn(_curYear, _curMonth, 5) },
    { id: 20, nomePc: 'PC-TI-002', numeroSerie: 'SN-2024-020', modeloMarca: 'Dell XPS 8940', processador: 'Intel Core i9-11900', memoriaRam: '32GB DDR4', armazenamento: '1TB SSD NVMe', usuarioDesignado: 'Dev Senior', fornecedor: 'Dell Tecnologia', status: 'ATIVO', fotoUrl: '', dataCadastro: '2024-01-08T10:00:00', dataInicioCiclo: _dyn(_curYear, _curMonth - 2, 10), proximaManutencao: _dyn(_curYear, _curMonth + 6, 10), dataUltimaManutencao: _dyn(_curYear, _curMonth - 2, 10) }
];


var MOCK_MANUTENCOES = [
    { id: 1, computadorId: 3, computadorNome: 'PC-LOG-001', tipo: 'PREVENTIVA', status: 'EM_ANDAMENTO', descricao: 'Troca de pasta termica e limpeza geral', tecnicoResponsavel: 'Carlos Mendes', pecasTrocadas: 'Pasta termica Artic MX-5', observacoes: 'Agendado para manha', dataCadastro: _dyn(_curYear, _curMonth, 5, 8), dataConclusao: null },
    { id: 2, computadorId: 4, computadorNome: 'PC-LOG-002', tipo: 'EMERGENCIAL', status: 'PENDENTE', descricao: 'PC nao liga. Verificar fonte e placa mae', tecnicoResponsavel: 'Roberto Alves', pecasTrocadas: '', observacoes: 'Prioridade alta', dataCadastro: _dyn(_curYear, _curMonth, 7, 14), dataConclusao: null },
    { id: 3, computadorId: 7, computadorNome: 'PC-FIN-002', tipo: 'PREDITIVA', status: 'CONCLUIDA', descricao: 'Atualizacao de firmware SSD', tecnicoResponsavel: 'Carlos Mendes', pecasTrocadas: 'Nenhuma', observacoes: 'Disco com 87% de saude', dataCadastro: _dyn(_prevMonth === _curMonth ? _curYear - 1 : _prevYear, _prevMonth, 10, 9), dataConclusao: _dyn(_prevMonth === _curMonth ? _curYear - 1 : _prevYear, _prevMonth, 10, 11) },
    { id: 4, computadorId: 13, computadorNome: 'PC-PRD-003', tipo: 'PREVENTIVA', status: 'PENDENTE', descricao: 'Limpeza preventiva trimestral', tecnicoResponsavel: 'Maria Ferreira', pecasTrocadas: 'Filtro de po', observacoes: 'Equipamento de producao', dataCadastro: _dyn(_curYear, _curMonth, 3, 7), dataConclusao: null },
    { id: 5, computadorId: 15, computadorNome: 'PC-ALM-001', tipo: 'CORRETIVA', status: 'EM_ANDAMENTO', descricao: 'Substituicao de HD danificado por SSD', tecnicoResponsavel: 'Roberto Alves', pecasTrocadas: 'SSD Kingston A400 240GB', observacoes: 'Backup realizado', dataCadastro: _dyn(_curYear, _curMonth, 2, 10), dataConclusao: null },
    { id: 6, computadorId: 1, computadorNome: 'PC-ADM-001', tipo: 'PREVENTIVA', status: 'CONCLUIDA', descricao: 'Atualizacao de BIOS', tecnicoResponsavel: 'Carlos Mendes', pecasTrocadas: 'Nenhuma', observacoes: 'BIOS atualizada v1.3 para v1.5', dataCadastro: _dyn(_prevMonth === _curMonth ? _curYear - 1 : _prevYear, _prevMonth, 18, 14), dataConclusao: _dyn(_prevMonth === _curMonth ? _curYear - 1 : _prevYear, _prevMonth, 18, 15) },
    { id: 7, computadorId: 2, computadorNome: 'PC-ADM-002', tipo: 'CORRETIVA', status: 'CANCELADA', descricao: 'Substituicao de teclado', tecnicoResponsavel: 'Maria Ferreira', pecasTrocadas: 'Teclado USB ABNT2', observacoes: 'Cancelado', dataCadastro: _dyn(_prevMonth === _curMonth ? _curYear - 1 : _prevYear, _prevMonth, 5, 11), dataConclusao: null },
    { id: 8, computadorId: 9, computadorNome: 'PC-VEN-001', tipo: 'EMERGENCIAL', status: 'CONCLUIDA', descricao: 'Remocao de malware e formatacao', tecnicoResponsavel: 'Roberto Alves', pecasTrocadas: 'Nenhuma', observacoes: 'Sistema reinstalado com Windows 11 Pro', dataCadastro: _dyn(_prevMonth === _curMonth ? _curYear - 1 : _prevYear, _prevMonth, 20, 8), dataConclusao: _dyn(_prevMonth === _curMonth ? _curYear - 1 : _prevYear, _prevMonth, 21, 17) },
    { id: 9, computadorId: 5, computadorNome: 'PC-TI-001', tipo: 'PREDITIVA', status: 'EM_ANDAMENTO', descricao: 'Teste de estresse na memoria RAM', tecnicoResponsavel: 'Carlos Mendes', pecasTrocadas: '', observacoes: 'Rodando MemTest86 por 4 horas', dataCadastro: _dyn(_curYear, _curMonth, 6, 9), dataConclusao: null },
    { id: 10, computadorId: 6, computadorNome: 'PC-FIN-001', tipo: 'PREVENTIVA', status: 'PENDENTE', descricao: 'Instalacao de updates acumulados', tecnicoResponsavel: 'Maria Ferreira', pecasTrocadas: 'Nenhuma', observacoes: 'Agendar para horario de almoco', dataCadastro: _dyn(_curYear, _curMonth, 10, 8), dataConclusao: null },
    { id: 11, computadorId: 10, computadorNome: 'PC-VEN-002', tipo: 'CORRETIVA', status: 'CONCLUIDA', descricao: 'Reparo no ventilador cooling', tecnicoResponsavel: 'Roberto Alves', pecasTrocadas: 'Cooler fan 80mm', observacoes: 'Equipamento operando normalmente', dataCadastro: _dyn(_prevMonth === _curMonth ? _curYear - 1 : _prevYear, _prevMonth, 14, 13), dataConclusao: _dyn(_prevMonth === _curMonth ? _curYear - 1 : _prevYear, _prevMonth, 14, 15) },
    { id: 12, computadorId: 8, computadorNome: 'PC-RH-001', tipo: 'PREDITIVA', status: 'CONCLUIDA', descricao: 'Otimizacao do Windows e desfragmentacao do SSD', tecnicoResponsavel: 'Carlos Mendes', pecasTrocadas: 'Nenhuma', observacoes: 'Boot reduzido de 45s para 18s', dataCadastro: _dyn(_prevMonth === _curMonth ? _curYear - 1 : _prevYear, _prevMonth, 25, 16), dataConclusao: _dyn(_prevMonth === _curMonth ? _curYear - 1 : _prevYear, _prevMonth, 25, 18) },
    { id: 13, computadorId: 11, computadorNome: 'PC-PRD-001', tipo: 'CORRETIVA', status: 'CONCLUIDA', descricao: 'Troca de fonte queimada', tecnicoResponsavel: 'Roberto Alves', pecasTrocadas: 'Fonte 500W', observacoes: 'Equipamento em producao recuperado', dataCadastro: _dyn(_curYear, _curMonth, 8, 10), dataConclusao: _dyn(_curYear, _curMonth, 8, 14) },
    { id: 14, computadorId: 14, computadorNome: 'PC-ADM-003', tipo: 'PREVENTIVA', status: 'CONCLUIDA', descricao: 'Backup completo do sistema', tecnicoResponsavel: 'Maria Ferreira', pecasTrocadas: 'Nenhuma', observacoes: 'Backup em HD externo', dataCadastro: _dyn(_curYear, _curMonth, 12, 9), dataConclusao: _dyn(_curYear, _curMonth, 12, 11) },
    { id: 15, computadorId: 18, computadorNome: 'PC-FIN-003', tipo: 'EMERGENCIAL', status: 'CONCLUIDA', descricao: 'Tela azul constante. Reinstalacao do Windows', tecnicoResponsavel: 'Carlos Mendes', pecasTrocadas: 'Nenhuma', observacoes: 'Formatacao e reinstalacao completos', dataCadastro: _dyn(_curYear, _curMonth, 14, 8), dataConclusao: _dyn(_curYear, _curMonth, 14, 17) },
    { id: 16, computadorId: 16, computadorNome: 'PC-ADM-004', tipo: 'PREDITIVA', status: 'PENDENTE', descricao: 'Verificar saude do disco SSD', tecnicoResponsavel: 'Carlos Mendes', pecasTrocadas: '', observacoes: 'Agendar para proxima semana', dataCadastro: _dyn(_curYear, _curMonth, 1, 8), dataConclusao: null }
];

var MOCK_ORDENS = [
    { id: 1, titulo: 'Instalar software de controle de acesso', descricao: 'Instalar BioAccess v3.0 nos PCs da recep��o.', computadorId: 2, computadorNome: 'PC-ADM-002', prioridade: 'ALTA', status: 'EM_EXECUCAO', solicitante: 'Gerencia de TI', tecnicoResponsavel: 'Joao Pedro', dataAbertura: _dyn(_curYear, _curMonth, 4, 9), dataPrevisao: _dyn(_curYear, _curMonth, 20, 17), dataConclusao: null, solucao: null },
    { id: 2, titulo: 'Migracao de dados para novo servidor', descricao: 'Transferir dados para novo storage NAS.', computadorId: null, computadorNome: '-', prioridade: 'CRITICA', status: 'EM_ANALISE', solicitante: 'Diretor de TI', tecnicoResponsavel: 'Joao Pedro', dataAbertura: _dyn(_curYear, _curMonth, 2, 14), dataPrevisao: _dyn(_curYear, _curMonth, 25, 17), dataConclusao: null, solucao: null },
    { id: 3, titulo: 'Substituir monitor com dead pixels', descricao: 'Monitor do PC-ADM-001 com dead pixels.', computadorId: 1, computadorNome: 'PC-ADM-001', prioridade: 'BAIXA', status: 'ABERTA', solicitante: 'Carlos Silva', tecnicoResponsavel: '', dataAbertura: _dyn(_curYear, _curMonth, 6, 10), dataPrevisao: _dyn(_curYear, _curMonth, 30, 17), dataConclusao: null, solucao: null },
    { id: 4, titulo: 'Configuracao de impressora em rede', descricao: 'Configurar HP LaserJet Pro M404dn.', computadorId: 6, computadorNome: 'PC-FIN-001', prioridade: 'MEDIA', status: 'CONCLUIDA', solicitante: 'Fernanda Lima', tecnicoResponsavel: 'Roberto Alves', dataAbertura: _dyn(_prevMonth === _curMonth ? _curYear - 1 : _prevYear, _prevMonth, 5, 8), dataPrevisao: _dyn(_prevMonth === _curMonth ? _curYear - 1 : _prevYear, _prevMonth, 10, 17), dataConclusao: _dyn(_prevMonth === _curMonth ? _curYear - 1 : _prevYear, _prevMonth, 8, 16), solucao: 'Impressora configurada com IP estatico.' },
    { id: 5, titulo: 'Atualizar BIOS de todos PCs Dell', descricao: 'Verificar e atualizar BIOS de equipamentos Dell.', computadorId: null, computadorNome: '-', prioridade: 'MEDIA', status: 'ABERTA', solicitante: 'Carlos Mendes', tecnicoResponsavel: '', dataAbertura: _dyn(_curYear, _curMonth, 8, 11), dataPrevisao: _dyn(_curMonth === 11 ? _curYear + 1 : _curYear, _curMonth + 1, 15, 17), dataConclusao: null, solucao: null },
    { id: 6, titulo: 'Corrigir falha de rede no PC-LOG-002', descricao: 'PC com desconex�es frequentes da rede.', computadorId: 4, computadorNome: 'PC-LOG-002', prioridade: 'ALTA', status: 'EM_EXECUCAO', solicitante: 'Maria Oliveira', tecnicoResponsavel: 'Carlos Mendes', dataAbertura: _dyn(_curYear, _curMonth, 3, 8), dataPrevisao: _dyn(_curYear, _curMonth, 15, 17), dataConclusao: null, solucao: null },
    { id: 7, titulo: 'Instalar antiviruses nos novos PCs', descricao: 'Instalar Kaspersky nos 5 novos PCs.', computadorId: 15, computadorNome: 'PC-ALM-001', prioridade: 'ALTA', status: 'ABERTA', solicitante: 'Auxiliar Almox', tecnicoResponsavel: '', dataAbertura: _dyn(_curYear, _curMonth, 9, 9), dataPrevisao: _dyn(_curYear, _curMonth, 18, 17), dataConclusao: null, solucao: null },
    { id: 8, titulo: 'Migrar Windows 10 para Windows 11', descricao: 'Atualizar OS de 3 PCs eleg�veis.', computadorId: 14, computadorNome: 'PC-ADM-003', prioridade: 'BAIXA', status: 'CANCELADA', solicitante: 'Gerente TI', tecnicoResponsavel: 'Maria Ferreira', dataAbertura: _dyn(_prevMonth === _curMonth ? _curYear - 1 : _prevYear, _prevMonth, 10, 10), dataPrevisao: _dyn(_prevMonth === _curMonth ? _curYear - 1 : _prevYear, _prevMonth, 28, 17), dataConclusao: null, solucao: 'Cancelado - PCs n�o atendem TPM 2.0.' },
    { id: 9, titulo: 'Configurar VPN corporativa', descricao: 'Configurar VPN no PC-TI-001.', computadorId: 5, computadorNome: 'PC-TI-001', prioridade: 'CRITICA', status: 'CONCLUIDA', solicitante: 'Joao Pedro', tecnicoResponsavel: 'Joao Pedro', dataAbertura: _dyn(_prevMonth === _curMonth ? _curYear - 1 : _prevYear, _prevMonth, 12, 14), dataPrevisao: _dyn(_prevMonth === _curMonth ? _curYear - 1 : _prevYear, _prevMonth, 15, 17), dataConclusao: _dyn(_prevMonth === _curMonth ? _curYear - 1 : _prevYear, _prevMonth, 14, 11), solucao: 'VPN configurada com WireGuard.' },
    { id: 10, titulo: 'Limpeza geral dos equipamentos', descricao: 'Limpeza preventiva em todos PCs do estoque.', computadorId: null, computadorNome: '-', prioridade: 'MEDIA', status: 'EM_ANALISE', solicitante: 'Supervisor Log', tecnicoResponsavel: '', dataAbertura: _dyn(_curYear, _curMonth, 1, 8), dataPrevisao: _dyn(_curYear, _curMonth, 22, 17), dataConclusao: null, solucao: null },
    { id: 11, titulo: 'Reinstalar Office em todos PCs', descricao: 'Office 365 com problemas de ativacao.', computadorId: null, computadorNome: '-', prioridade: 'ALTA', status: 'CONCLUIDA', solicitante: 'Gerente TI', tecnicoResponsavel: 'Joao Pedro', dataAbertura: _dyn(_curYear, _curMonth, 11, 9), dataPrevisao: _dyn(_curYear, _curMonth, 13, 17), dataConclusao: _dyn(_curYear, _curMonth, 12, 17), solucao: 'Reinstalado em 18 maquinas.' },
    { id: 12, titulo: 'Configurar email corporativo', descricao: 'Configurar Outlook em 5 PCs novos.', computadorId: 8, computadorNome: 'PC-RH-001', prioridade: 'MEDIA', status: 'CONCLUIDA', solicitante: 'Juliana Costa', tecnicoResponsavel: 'Maria Ferreira', dataAbertura: _dyn(_prevMonth === _curMonth ? _curYear - 1 : _prevYear, _prevMonth, 22, 10), dataPrevisao: _dyn(_prevMonth === _curMonth ? _curYear - 1 : _prevYear, _prevMonth, 25, 17), dataConclusao: _dyn(_prevMonth === _curMonth ? _curYear - 1 : _prevYear, _prevMonth, 24, 15), solucao: 'Emails configurados com sucesso.' }
];

var MOCK_USUARIOS = [
    { id: 1, nomeCompleto: 'Administrador', username: 'admin', email: 'admin@empresa.com', perfil: 'ADMIN', ativo: true, dataCadastro: '2024-01-01T00:00:00' },
    { id: 2, nomeCompleto: 'Carlos Silva', username: 'carlos', email: 'carlos@empresa.com', perfil: 'USUARIO', ativo: true, dataCadastro: '2024-01-10T08:00:00' },
    { id: 3, nomeCompleto: 'Ana Beatriz', username: 'ana', email: 'ana@empresa.com', perfil: 'USUARIO', ativo: true, dataCadastro: '2024-01-10T08:00:00' },
    { id: 4, nomeCompleto: 'Carlos Mendes', username: 'carlos.mendes', email: 'carlos.mendes@empresa.com', perfil: 'TECNICO', ativo: true, dataCadastro: '2024-01-15T08:00:00' },
    { id: 5, nomeCompleto: 'Roberto Alves', username: 'roberto', email: 'roberto@empresa.com', perfil: 'TECNICO', ativo: true, dataCadastro: '2024-01-15T08:00:00' },
    { id: 6, nomeCompleto: 'Maria Ferreira', username: 'maria', email: 'maria@empresa.com', perfil: 'TECNICO', ativo: true, dataCadastro: '2024-01-20T08:00:00' },
    { id: 7, nomeCompleto: 'Joao Pedro', username: 'joao.pedro', email: 'joao.pedro@empresa.com', perfil: 'ADMIN', ativo: true, dataCadastro: '2024-01-10T08:00:00' },
    { id: 8, nomeCompleto: 'Fernanda Lima', username: 'fernanda', email: 'fernanda@empresa.com', perfil: 'USUARIO', ativo: true, dataCadastro: '2024-02-01T08:00:00' },
    { id: 9, nomeCompleto: 'Roberto Souza', username: 'roberto.souza', email: 'roberto.souza@empresa.com', perfil: 'USUARIO', ativo: false, dataCadastro: '2024-02-05T08:00:00' }
];

var MOCK_DEPARTAMENTOS = [
    { id: 1, nome: 'TI', totalComputadores: 12 },
    { id: 2, nome: 'Financeiro', totalComputadores: 5 },
    { id: 3, nome: 'RH', totalComputadores: 3 },
    { id: 4, nome: 'Marketing', totalComputadores: 4 },
    { id: 5, nome: 'Opera��es', totalComputadores: 6 }
];

var MOCK_SOFTWARE = [
    { id: 1, nomeSoftware: 'Microsoft Office 365', fabricante: 'Microsoft', chaveLicenca: 'XXXXX-XXXXX-001', tipoLicenca: 'PRO', quantidadeTotal: 20, quantidadeUtilizada: 15, dataAquisicao: '2024-01-01', dataExpiracao: '2025-01-01', observacoes: '', dataCriacao: '2024-01-15T10:00:00', dataAtualizacao: '2024-01-15T10:00:00' },
    { id: 2, nomeSoftware: 'Kaspersky Endpoint', fabricante: 'Kaspersky', chaveLicenca: 'XXXXX-XXXXX-002', tipoLicenca: 'ENTERPRISE', quantidadeTotal: 50, quantidadeUtilizada: 45, dataAquisicao: '2024-03-01', dataExpiracao: '2025-03-01', observacoes: '', dataCriacao: '2024-03-01T10:00:00', dataAtualizacao: '2024-03-01T10:00:00' }
];

var MOCK_RAMAIS = [
    { id: 1, numeroRamal: '1001', setor: 'TI', descricao: 'Ramal sala TI - 1o andar', computadorId: 1, status: 'ATIVO', fotoUrl: '', dataCadastro: '2024-01-15T10:00:00', dataInicioCiclo: _dyn(_curYear, _curMonth - 2, 1), proximaManutencao: _dyn(_curYear, _curMonth + 10, 1), dataUltimaManutencao: _dyn(_curYear, _curMonth - 2, 1) },
    { id: 2, numeroRamal: '1002', setor: 'TI', descricao: 'Ramal sala TI - 2o andar', computadorId: 5, status: 'EM_MANUTENCAO', fotoUrl: '', dataCadastro: '2024-01-15T10:00:00', dataInicioCiclo: _dyn(_curYear, _curMonth - 10, 1), proximaManutencao: _dyn(_curYear, _curMonth + 2, 1), dataUltimaManutencao: _dyn(_curYear, _curMonth - 2, 10) },
    { id: 3, numeroRamal: '2001', setor: 'Financeiro', descricao: 'Ramal Financeiro - Sala 201', computadorId: 6, status: 'ATIVO', fotoUrl: '', dataCadastro: '2024-02-10T10:00:00', dataInicioCiclo: _dyn(_curYear, _curMonth - 5, 1), proximaManutencao: _dyn(_curYear, _curMonth + 7, 1), dataUltimaManutencao: _dyn(_curYear, _curMonth - 5, 1) },
    { id: 4, numeroRamal: '2002', setor: 'Financeiro', descricao: 'Ramal Financeiro - Sala 202', computadorId: 7, status: 'CONFERIR', fotoUrl: '', dataCadastro: '2024-02-10T10:00:00', dataInicioCiclo: _dyn(_curYear, _curMonth - 14, 1), proximaManutencao: _dyn(_curYear, _curMonth - 2, 1), dataUltimaManutencao: _dyn(_curYear, _curMonth - 4, 5) },
    { id: 5, numeroRamal: '3001', setor: 'RH', descricao: 'Ramal RH - Sala 301', computadorId: 8, status: 'ATIVO', fotoUrl: '', dataCadastro: '2024-03-01T10:00:00', dataInicioCiclo: _dyn(_curYear, _curMonth - 1, 1), proximaManutencao: _dyn(_curYear, _curMonth + 11, 1), dataUltimaManutencao: _dyn(_curYear, _curMonth - 1, 1) },
    { id: 6, numeroRamal: '3002', setor: 'RH', descricao: 'Ramal RH - Sala 302', computadorId: null, status: 'INATIVO', fotoUrl: '', dataCadastro: '2024-03-01T10:00:00', dataInicioCiclo: _dyn(_curYear, _curMonth - 16, 1), proximaManutencao: _dyn(_curYear, _curMonth - 4, 1), dataUltimaManutencao: _dyn(_curYear, _curMonth - 6, 15) },
    { id: 7, numeroRamal: '4001', setor: 'Operacoes', descricao: 'Ramal Operacoes - Galpao', computadorId: 3, status: 'EM_MANUTENCAO', fotoUrl: '', dataCadastro: '2024-04-01T10:00:00', dataInicioCiclo: _dyn(_curYear, _curMonth - 7, 1), proximaManutencao: _dyn(_curYear, _curMonth + 5, 1), dataUltimaManutencao: _dyn(_curYear, _curMonth - 1, 20) },
    { id: 8, numeroRamal: '4002', setor: 'Operacoes', descricao: 'Ramal Operacoes - Estoque', computadorId: 15, status: 'ATIVO', fotoUrl: '', dataCadastro: '2024-04-01T10:00:00', dataInicioCiclo: _dyn(_curYear, _curMonth - 3, 1), proximaManutencao: _dyn(_curYear, _curMonth + 9, 1), dataUltimaManutencao: _dyn(_curYear, _curMonth - 3, 1) },
    { id: 9, numeroRamal: '5001', setor: 'Marketing', descricao: 'Ramal Marketing - Sala 501', computadorId: null, status: 'CONFERIR', fotoUrl: '', dataCadastro: '2024-05-01T10:00:00', dataInicioCiclo: _dyn(_curYear, _curMonth - 11, 1), proximaManutencao: _dyn(_curYear, _curMonth + 1, 1), dataUltimaManutencao: _dyn(_curYear, _curMonth - 1, 10) },
    { id: 10, numeroRamal: '5002', setor: 'Marketing', descricao: 'Ramal Marketing - Sala 502', computadorId: null, status: 'INATIVO', fotoUrl: '', dataCadastro: '2024-05-01T10:00:00', dataInicioCiclo: _dyn(_curYear, _curMonth - 18, 1), proximaManutencao: _dyn(_curYear, _curMonth - 6, 1), dataUltimaManutencao: _dyn(_curYear, _curMonth - 8, 5) }
];

var MOCK_TROCAS = [
    { id: 1, tipoEquipamento: 'COMPUTADOR', equipamentoId: 3, equipamentoNome: 'PC-LOG-001', tipoMovimento: 'TROCA', descricao: 'Troca preventiva - HD antigo por SSD', responsavel: 'Carlos Mendes', dataTroca: _dyn(_curYear, _curMonth, 5, 14), observacoes: 'HD com 90% de uso. SSD Kingston A400 240GB instalado.' },
    { id: 2, tipoEquipamento: 'RAMAL', equipamentoId: 4, equipamentoNome: 'Ramal 2002', tipoMovimento: 'SAIDA', descricao: 'Ramal retirado do setor Financeiro para manutencao', responsavel: 'Roberto Alves', dataTroca: _dyn(_curYear, _curMonth, 6, 9), observacoes: 'Aparelho com defeito no audifone' },
    { id: 3, tipoEquipamento: 'COMPUTADOR', equipamentoId: 15, equipamentoNome: 'PC-ALM-001', tipoMovimento: 'ENTRADA', descricao: 'Novo computador alocado no Almoxarifado', responsavel: 'Joao Pedro', dataTroca: _dyn(_curYear, _curMonth, 8, 10), observacoes: 'Equipamento novo Dell OptiPlex 3080' },
    { id: 4, tipoEquipamento: 'RAMAL', equipamentoId: 6, equipamentoNome: 'Ramal 3002', tipoMovimento: 'ENTRADA', descricao: 'Novo ramal instalado no RH', responsavel: 'Carlos Mendes', dataTroca: _dyn(_curYear, _curMonth, 9, 11), observacoes: 'Aparelho novo Polycom' },
    { id: 5, tipoEquipamento: 'COMPUTADOR', equipamentoId: 1, equipamentoNome: 'PC-ADM-001', tipoMovimento: 'TROCA', descricao: 'Troca de monitor com dead pixels', responsavel: 'Maria Ferreira', dataTroca: _dyn(_curYear, _curMonth, 12, 15), observacoes: 'Monitor Dell 24 substituido por Dell 27' },
    { id: 6, tipoEquipamento: 'RAMAL', equipamentoId: 2, equipamentoNome: 'Ramal 1002', tipoMovimento: 'TROCA', descricao: 'Substituicao do aparelho de ramal TI 2o andar', responsavel: 'Roberto Alves', dataTroca: _dyn(_curYear, _curMonth, 13, 8), observacoes: 'Aparelho antigo nao registrava chamadas' },
    { id: 7, tipoEquipamento: 'COMPUTADOR', equipamentoId: 11, equipamentoNome: 'PC-PRD-001', tipoMovimento: 'ENTRADA', descricao: 'Equipamento de producao substitu�do', responsavel: 'Joao Pedro', dataTroca: _dyn(_prevMonth === _curMonth ? _curYear - 1 : _prevYear, _prevMonth, 15, 10), observacoes: 'Novo Dell Precision 3660' },
    { id: 8, tipoEquipamento: 'RAMAL', equipamentoId: 5, equipamentoNome: 'Ramal 3001', tipoMovimento: 'SAIDA', descricao: 'Ramal antigo retirado do RH', responsavel: 'Maria Ferreira', dataTroca: _dyn(_prevMonth === _curMonth ? _curYear - 1 : _prevYear, _prevMonth, 20, 14), observacoes: 'Substituido por modelo mais novo' },
    { id: 9, tipoEquipamento: 'COMPUTADOR', equipamentoId: 7, equipamentoNome: 'PC-FIN-002', tipoMovimento: 'TROCA', descricao: 'Troca de memoria RAM', responsavel: 'Carlos Mendes', dataTroca: _dyn(_prevMonth === _curMonth ? _curYear - 1 : _prevYear, _prevMonth, 25, 11), observacoes: '4GB para 8GB DDR4' },
    { id: 10, tipoEquipamento: 'RAMAL', equipamentoId: 7, equipamentoNome: 'Ramal 4001', tipoMovimento: 'ENTRADA', descricao: 'Ramal novo para Operacoes', responsavel: 'Roberto Alves', dataTroca: _dyn(_curYear, _curMonth, 14, 9), observacoes: 'Aparelho Intelbras' }
];

var MOCK_LOGS = [
    { id: 1, usuario: 'admin', acao: 'LOGIN', entidade: 'USUARIO', entidadeId: null, descricao: 'Login realizado com sucesso', dataAtividade: '2024-06-15T10:30:00', ipAddress: '192.168.1.100' },
    { id: 2, usuario: 'admin', acao: 'CRIACAO', entidade: 'COMPUTADOR', entidadeId: 1, descricao: 'Computador PC-ADM-001 cadastrado', dataAtividade: '2024-06-10T09:00:00', ipAddress: '192.168.1.100' },
    { id: 4, usuario: 'admin', acao: 'ALTERACAO', entidade: 'COMPUTADOR', entidadeId: 5, descricao: 'Atualizado status de PC-TI-001 para MANUTENCAO_PREDITIVA', dataAtividade: '2024-06-11T16:00:00', ipAddress: '192.168.1.100' }
];

// ==========================================
// MOCK FUNCTIONS
// ==========================================
function mockAuth(user, pass) {
    var creds = { admin: { senha: 'admin123', perfil: 'ADMIN', nome: 'Administrador' }, tecnico: { senha: '123456', perfil: 'TECNICO', nome: 'Tecnico de TI' }, usuario: { senha: '123456', perfil: 'USUARIO', nome: 'Usuario Comum' }, 'joao.silva': { senha: '123456', perfil: 'USUARIO', nome: 'Joao Silva' }, 'maria.santos': { senha: '123456', perfil: 'USUARIO', nome: 'Maria Santos' }, 'pedro.costa': { senha: '123456', perfil: 'TECNICO', nome: 'Pedro Costa' }, 'ana.oliveira': { senha: '123456', perfil: 'USUARIO', nome: 'Ana Oliveira' }, 'carlos.pereira': { senha: '123456', perfil: 'TECNICO', nome: 'Carlos Pereira' }, 'lucia.ferreira': { senha: '123456', perfil: 'USUARIO', nome: 'Lucia Ferreira' } };
    var c = creds[user];
    if (!c || c.senha!== pass) return null;
    return { token: 'mock-token-' + user + '-' + Date.now(), username: user, nomeCompleto: c.nome, perfil: c.perfil, expiresIn: 1800000 };
}

function computeCycle(eq) {
    if (!eq.dataInicioCiclo && eq.dataCadastro) eq.dataInicioCiclo = eq.dataCadastro;
    if (!eq.dataInicioCiclo) return eq;
    var inicio = new Date(eq.dataInicioCiclo);
    var now = new Date();
    var diffMs = now - inicio;
    var diasDesdeInicio = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    var diasTotal = 240;
    var diasRestantes = diasTotal - diasDesdeInicio;
    var fase = 'ATIVO';
    if (diasDesdeInicio > 120 && diasDesdeInicio <= 180) fase = 'PREDITIVO';
    else if (diasDesdeInicio > 180 && diasDesdeInicio <= 240) fase = 'PREVENTIVO';
    else if (diasDesdeInicio > 240) fase = 'ATRASADO';
    eq.diasDesdeInicioCiclo = diasDesdeInicio;
    eq.diasRestantes = diasRestantes;
    eq.faseCiclo = fase;
    return eq;
}

function computeRamalCycle(r) {
    if (!r.dataInicioCiclo) return r;
    var inicio = new Date(r.dataInicioCiclo);
    var now = new Date();
    var diffMs = now - inicio;
    var diasDesdeInicio = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    var diasTotal = 365;
    var diasRestantes = diasTotal - diasDesdeInicio;
    var fase = 'ATIVO';
    if (diasDesdeInicio > 183 && diasDesdeInicio <= 274) fase = 'PREDITIVO';
    else if (diasDesdeInicio > 274 && diasDesdeInicio <= 365) fase = 'PREVENTIVO';
    else if (diasDesdeInicio > 365) fase = 'ATRASADO';
    r.diasDesdeInicioCiclo = diasDesdeInicio;
    r.diasRestantes = diasRestantes;
    r.faseCiclo = fase;
    return r;
}

function parseDataISO(valor) {
    var s = String(valor || '').trim();
    if (!s) return null;
    var d = new Date(s.length === 10 ? s + 'T00:00:00' : s);
    return isNaN(d.getTime()) ? null : d;
}

function computadorAlertasGarantia() {
    var agora = new Date();
    var vencidas = [], proximas = [];
    MOCK_COMPUTADORES.forEach(function(c) {
        var g = parseDataISO(c.dataGarantia);
        if (!g) return;
        var dias = Math.ceil((g.getTime() - agora.getTime()) / 86400000);
        if (dias < 0) vencidas.push({ id: c.id, nomePc: c.nomePc, dias: Math.abs(dias) });
        else if (dias <= 30) proximas.push({ id: c.id, nomePc: c.nomePc, diasRestantes: dias });
    });
    vencidas.sort(function(a, b) { return b.dias - a.dias; });
    proximas.sort(function(a, b) { return a.diasRestantes - b.diasRestantes; });
    return { garantiaVencida: vencidas, garantiaProxima: proximas, totalAlertas: vencidas.length + proximas.length };
}

function computadoresCicloVencido() {
    return MOCK_COMPUTADORES
        .map(function(c) { return computeCycle(Object.assign({}, c)); })
        .filter(function(c) { return typeof c.diasRestantes === 'number' && c.diasRestantes < 0; })
        .sort(function(a, b) { return a.diasRestantes - b.diasRestantes; });
}

function migrarSetor(deAntigo, paraNovo) {
    var kOld = normSetor(deAntigo), kNew = normSetor(paraNovo);
    if (!kOld || !kNew || kOld === kNew) return 0;
    var movidos = 0;
    MOCK_COMPUTADORES.forEach(function(c) {
        if (normSetor(c.departamento) === kOld) { c.departamento = paraNovo; movidos++; }
    });
    MOCK_RAMAIS.forEach(function(r) { if (normSetor(r.setor) === kOld) r.setor = paraNovo; });
    return movidos;
}

function syncManutencaoWithComputador(computadorId, manutStatus, manutTipo) {
    var comp = MOCK_COMPUTADORES.find(function(c) { return c.id === computadorId; });
    if (!comp) return;
    var statusMap = {
        'PENDENTE': manutTipo === 'EMERGENCIAL' || manutTipo === 'CORRETIVA' ? 'MANUTENCAO_EMERGENCIAL' : manutTipo === 'PREDITIVA' ? 'MANUTENCAO_PREDITIVA' : 'MANUTENCAO_PREVENTIVA',
        'EM_ANDAMENTO': manutTipo === 'EMERGENCIAL' || manutTipo === 'CORRETIVA' ? 'MANUTENCAO_EMERGENCIAL' : manutTipo === 'PREDITIVA' ? 'MANUTENCAO_PREDITIVA' : 'MANUTENCAO_PREVENTIVA',
        'CONCLUIDA': 'CONCLUIDO',
        'CANCELADA': 'ATIVO'
    };
    var hasActiveMaint = MOCK_MANUTENCOES.some(function(m) {
        return m.computadorId === computadorId && m.id !== undefined && m.status !== 'CONCLUIDA' && m.status !== 'CANCELADA';
    });
    if (manutStatus === 'CONCLUIDA' || manutStatus === 'CANCELADA') {
        if (!hasActiveMaint) comp.status = 'ATIVO';
    } else {
        comp.status = statusMap[manutStatus] || 'MANUTENCAO_PREVENTIVA';
    }
}


var MOCK_COMPUTADORES_ORIG = null;
var _persistTimer = null;
var _dataLoaded = false;
var _serverRev = 0;
var _beaconSalvo = false;
var _cargaTentativas = 0;

function serverSnapshot() {
    return {
        computadores: MOCK_COMPUTADORES,
        manutencoes: MOCK_MANUTENCOES,
        ordens: MOCK_ORDENS,
        usuarios: MOCK_USUARIOS,
        departamentos: MOCK_DEPARTAMENTOS,
        software: MOCK_SOFTWARE,
        ramais: MOCK_RAMAIS,
        trocas: MOCK_TROCAS,
        logs: MOCK_LOGS,
        baseRev: _serverRev
    };
}

function persistNow() {
    if (_persistTimer) { clearTimeout(_persistTimer); _persistTimer = null; }
    if (!_dataLoaded) return Promise.resolve();
    try {
        return fetch('/api/data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(serverSnapshot())
        }).then(function(resp) {
            if (!resp || typeof resp.json !== 'function') return;
            return resp.json().then(function(j) {
                if (j && typeof j.rev === 'number') { _serverRev = j.rev; broadcastRev(); }
                if (j && j.merged) {
                    try { if (typeof showToast === 'function') showToast('Sincronizado com alteracoes de outro dispositivo.', 'warning'); } catch (e) {}
                }
            }).catch(function() {});
        }).catch(function(e) { console.error('Erro ao salvar:', e); });
    } catch (e) { console.error('Erro ao salvar:', e); return Promise.resolve(); }
}

function persistAll() {
    if (_persistTimer) clearTimeout(_persistTimer);
    _persistTimer = setTimeout(persistNow, 300);
}

function flushPendingSave() {
    if (!_dataLoaded || !_persistTimer) return;
    clearTimeout(_persistTimer); _persistTimer = null;
    var enviado = false;
    try {
        var payload = JSON.stringify(serverSnapshot());
        if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
            enviado = navigator.sendBeacon('/api/data', payload);
            if (!enviado) { try { console.warn('Beacon rejeitado (payload grande), gravando via fetch'); } catch (e) {} }
        }
    } catch (e) { enviado = false; }
    if (enviado) { _beaconSalvo = true; return; }
    // fallback: o beacon nao aceitou (ou nao existe) - grava mesmo assim
    persistNow();
}

if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('pagehide', flushPendingSave);
    document.addEventListener('visibilitychange', function() { if (document.hidden) flushPendingSave(); });
}

async function loadServerData() {
    try {
        var resp = await fetch('/api/data');
        if (resp.ok) {
            var data = await resp.json();
            if (data && Array.isArray(data.computadores)) {
                if (typeof data._rev === 'number') _serverRev = data._rev;
                MOCK_COMPUTADORES.length = 0; MOCK_COMPUTADORES.push.apply(MOCK_COMPUTADORES, data.computadores);
                MOCK_MANUTENCOES.length = 0; MOCK_MANUTENCOES.push.apply(MOCK_MANUTENCOES, data.manutencoes || []);
                MOCK_ORDENS.length = 0; MOCK_ORDENS.push.apply(MOCK_ORDENS, data.ordens || []);
                MOCK_USUARIOS.length = 0; MOCK_USUARIOS.push.apply(MOCK_USUARIOS, data.usuarios || []);
                MOCK_DEPARTAMENTOS.length = 0; MOCK_DEPARTAMENTOS.push.apply(MOCK_DEPARTAMENTOS, data.departamentos || []);
                MOCK_SOFTWARE.length = 0; MOCK_SOFTWARE.push.apply(MOCK_SOFTWARE, data.software || []);
                MOCK_RAMAIS.length = 0; MOCK_RAMAIS.push.apply(MOCK_RAMAIS, data.ramais || []);
                MOCK_TROCAS.length = 0; MOCK_TROCAS.push.apply(MOCK_TROCAS, data.trocas || []);
                MOCK_LOGS.length = 0; MOCK_LOGS.push.apply(MOCK_LOGS, data.logs || []);
                console.log('Dados carregados do servidor');
                return 'loaded';
            }
            return 'error';
        }
        if (resp.status === 404) return 'empty';
        return 'error';
    } catch(e) { console.log('Servidor indisponivel, usando dados locais'); }
    return 'error';
}

function saveInitialData() {
    fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serverSnapshot())
    }).then(function(r) { return (r && typeof r.json === 'function') ? r.json() : null; }).then(function(j) {
        if (j && typeof j.rev === 'number') { _serverRev = j.rev; broadcastRev(); }
    }).catch(function() {});
}

function pruneOldLogs() {
    if (!Array.isArray(MOCK_LOGS) || MOCK_LOGS.length === 0) return 0;
    var now = new Date();
    var kept = [], removed = 0;
    MOCK_LOGS.forEach(function(l) {
        var d = new Date(l.dataAtividade);
        if (!l.dataAtividade || isNaN(d.getTime())) { kept.push(l); return; }
        var age = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
        if (age < 12) kept.push(l);
        else removed++;
    });
    if (removed > 0) {
        MOCK_LOGS.length = 0;
        MOCK_LOGS.push.apply(MOCK_LOGS, kept);
    }
    return removed;
}

async function initPersistence() {
    if (!MOCK_COMPUTADORES_ORIG) MOCK_COMPUTADORES_ORIG = MOCK_COMPUTADORES.map(function(c) { return Object.assign({}, c); });
    var st = await loadServerData();
    if (st === 'loaded') {
        _dataLoaded = true;
        var pruned = 0;
        try { pruned = pruneOldLogs(); } catch (e) { pruned = 0; }
        if (pruned > 0) {
            persistAll();
            try { console.log(pruned + ' registro(s) do hist�rico com mais de 12 meses removidos.'); } catch (e2) {}
        }
    }
    else if (st === 'empty') { saveInitialData(); _dataLoaded = true; }
    else { tentarCargaInicial(); }
}

// primeira carga falhou (servidor reiniciando/rede): tenta de novo e, se
// desistir, avisa que nada sera salvo - sem isso a sessao inteira fica
// "salvavel so de nome" (_dataLoaded continua false)
function tentarCargaInicial() {
    if (_dataLoaded) return;
    _cargaTentativas++;
    if (_cargaTentativas > 5) {
        try { showToast('Servidor indispon�vel: as altera��es desta sess�o N�O ser�o salvas. Recarregue a p�gina.', 'error'); } catch (e) {}
        return;
    }
    setTimeout(function() {
        if (_dataLoaded) return;
        loadServerData().then(function(st) {
            if (st === 'loaded') { _dataLoaded = true; try { pruneOldLogs(); } catch (e) {} }
            else if (st === 'empty') { saveInitialData(); _dataLoaded = true; }
            else tentarCargaInicial();
        }).catch(function() { tentarCargaInicial(); });
    }, 3000 * _cargaTentativas);
}

var _dataReady = initPersistence();

var MAX_COMPUTADORES = 1000;
var MAX_RAMAIS = 1000;
var MAX_MANUTENCOES = 2000;
var MAX_ORDENS = 2000;

function evictOldest(arr) {
    if (!arr || !arr.length) return;
    var minId = Math.min.apply(null, arr.map(function(x) { return x.id; }));
    var idx = arr.findIndex(function(x) { return x.id === minId; });
    if (idx !== -1) arr.splice(idx, 1);
}

// ==========================================
// LOG DE ATIVIDADE + SETORES DINAMICOS + SINCRONIZACAO
// ==========================================
function normSetor(s) { return (s || '').trim().toLowerCase(); }

function computeSetorCounts() {
    var counts = {};
    MOCK_COMPUTADORES.forEach(function(c) {
        var k = normSetor(c.departamento);
        if (k) counts[k] = (counts[k] || 0) + 1;
    });
    return counts;
}

function withSetorCounts() {
    var counts = computeSetorCounts();
    var changed = false;
    var used = {};
    MOCK_DEPARTAMENTOS.forEach(function(d) {
        var k = normSetor(d.nome);
        var n = counts[k] || 0;
        if (d.totalComputadores !== n) { d.totalComputadores = n; changed = true; }
        used[k] = true;
    });
    Object.keys(counts).forEach(function(k) {
        if (used[k]) return;
        var nome = '';
        for (var i = 0; i < MOCK_COMPUTADORES.length; i++) {
            if (normSetor(MOCK_COMPUTADORES[i].departamento) === k) { nome = String(MOCK_COMPUTADORES[i].departamento || '').trim(); break; }
        }
        if (!nome) return;
        var nid = MOCK_DEPARTAMENTOS.length > 0 ? Math.max.apply(null, MOCK_DEPARTAMENTOS.map(function(d) { return d.id || 0; })) + 1 : 1;
        MOCK_DEPARTAMENTOS.push({ id: nid, nome: nome, totalComputadores: counts[k] });
        changed = true;
    });
    return MOCK_DEPARTAMENTOS;
}

function ensureSetor(nome) {
    nome = String(nome || '').trim();
    if (!nome) return false;
    var k = normSetor(nome);
    for (var i = 0; i < MOCK_DEPARTAMENTOS.length; i++) {
        if (normSetor(MOCK_DEPARTAMENTOS[i].nome) === k) return false;
    }
    var nid = MOCK_DEPARTAMENTOS.length > 0 ? Math.max.apply(null, MOCK_DEPARTAMENTOS.map(function(d) { return d.id || 0; })) + 1 : 1;
    MOCK_DEPARTAMENTOS.push({ id: nid, nome: nome, totalComputadores: computeSetorCounts()[k] || 0 });
    pushLog('CRIACAO', 'SETOR', nid, 'Setor criado automaticamente: ' + nome);
    return true;
}

// Devolve o nome canonicos do setor ja cadastrado (evita "ti" x "TI" virarem dois setores)
function canonSetor(nome) {
    nome = String(nome || '').trim();
    if (!nome) return nome;
    var k = normSetor(nome);
    for (var i = 0; i < MOCK_DEPARTAMENTOS.length; i++) {
        if (normSetor(MOCK_DEPARTAMENTOS[i].nome) === k) return MOCK_DEPARTAMENTOS[i].nome;
    }
    return nome;
}

function pushLog(acao, entidade, entidadeId, descricao) {
    try {
        var nid = 1;
        for (var i = 0; i < MOCK_LOGS.length; i++) { var x = MOCK_LOGS[i].id || 0; if (x >= nid) nid = x + 1; }
        MOCK_LOGS.unshift({
            id: nid,
            usuario: (typeof localStorage !== 'undefined' && localStorage.getItem('userName')) || 'admin',
            acao: acao,
            entidade: entidade,
            entidadeId: (entidadeId === undefined ? null : entidadeId),
            descricao: descricao,
            dataAtividade: new Date().toISOString(),
            ipAddress: ''
        });
        if (MOCK_LOGS.length > 1000) MOCK_LOGS.length = 1000;
        persistAll();
        scheduleAfterMutation();
    } catch (e) {}
}

var _afterTimer = null;
function scheduleAfterMutation() {
    if (_afterTimer) clearTimeout(_afterTimer);
    _afterTimer = setTimeout(function() {
        _afterTimer = null;
        try { updateNotifBadge(); } catch (e) {}
        try { updateSidebarBadges(); } catch (e) {}
        if (_currentSection === 'departamentos') { try { loadDepartamentos(); } catch (e) {} }
        else if (_currentSection === 'logs') { try { loadLogs(currentPage.logs || 0); } catch (e) {} }
    }, 250);
}

var _bcChannel = null;
try {
    if (typeof BroadcastChannel !== 'undefined') {
        _bcChannel = new BroadcastChannel('inventario-ti');
        _bcChannel.onmessage = function(ev) {
            if (ev && ev.data && typeof ev.data.rev === 'number' && ev.data.rev !== _serverRev) remoteRefresh();
        };
    }
} catch (e) {}

function broadcastRev() {
    if (_bcChannel) { try { _bcChannel.postMessage({ rev: _serverRev }); } catch (e) {} }
}

var _remoteBusy = false;
function remoteRefresh() {
    if (_remoteBusy) return;
    _remoteBusy = true;
    // grava pendencias locais antes de sobrescrever os arrays com o servidor
    var pendente = _persistTimer ? persistNow() : Promise.resolve();
    pendente.then(function() { return loadServerData(); }).then(function() {
        _remoteBusy = false;
        try { refreshCurrentSection(); } catch (e) {}
        try { updateSidebarBadges(); } catch (e) {}
        try { updateNotifBadge(); } catch (e) {}
        try { showToast('Dados sincronizados de outra aba/dispositivo.', 'info'); } catch (e) {}
    }).catch(function() { _remoteBusy = false; });
}

function checkRemoteRev() {
    if (typeof getToken === 'function' && !getToken()) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    fetch('/api/rev').then(function(r) { return r.json(); }).then(function(j) {
        if (!j || typeof j.rev !== 'number') return;
        if (_beaconSalvo) {
            // a ultima gravacao foi via beacon (sem resposta): adota a rev do
            // servidor sem recarregar nem avisar - os dados la sao os nossos
            _beaconSalvo = false;
            if (j.rev !== _serverRev) { _serverRev = j.rev; broadcastRev(); }
            else persistNow(); // rev nao andou: o beacon nao chegou, regrava
            return;
        }
        if (j.rev !== _serverRev) remoteRefresh();
    }).catch(function() {});
}

if (typeof window !== 'undefined' && window.setInterval) {
    setInterval(checkRemoteRev, 15000);
    document.addEventListener('visibilitychange', function() { if (!document.hidden) checkRemoteRev(); });
}

function mockFetch(url, opts) {
    opts = opts || {};
    var method = (opts.method || 'GET').toUpperCase();
    var body = {};
    try { body = opts.body ? JSON.parse(opts.body) : {}; } catch(e) { body = {}; }

    if (url.indexOf('/api/auth/login') !== -1) return mockAuth(body.username, body.senha);
    if (url.indexOf('/api/auth/me') !== -1) return { username: localStorage.getItem('userName') || 'admin', nomeCompleto: localStorage.getItem('userName') || 'Administrador', perfil: getPerfil() };
    if (url.indexOf('/api/historico/') !== -1 || url.indexOf('/api/hist�rico/') !== -1) return [];
    if (url.indexOf('/api/computadores/manutencao-vencida') !== -1) return computadoresCicloVencido();
    if (url.indexOf('/api/computadores/alertas') !== -1) return computadorAlertasGarantia();
    if (url.indexOf('/actuator/health') !== -1) return { status: 'UP', componentes: { db: { status: 'UP', details: { database: 'JSON (data.json) - Node.js' } }, diskSpace: { status: 'UP' } } };

    if (url.indexOf('/api/departamentos') !== -1) {
        if (method === 'GET' && url.indexOf('/api/departamentos/') === -1) return withSetorCounts();
        if (url.indexOf('/api/departamentos/') !== -1 && method === 'GET') {
            withSetorCounts();
            var dId = parseInt(url.split('/api/departamentos/')[1].split('?')[0]);
            return MOCK_DEPARTAMENTOS.find(function(d) { return d.id === dId; }) || null;
        }
        if (method === 'POST') {
            var dNome = String(body.nome === undefined ? '' : body.nome).trim();
            if (!dNome) throw new Error('Informe o nome do setor.');
            var dDup = MOCK_DEPARTAMENTOS.some(function(d) { return normSetor(d.nome) === normSetor(dNome); });
            if (dDup) throw new Error('J� existe um setor com o nome "' + dNome + '".');
            var dNewId = MOCK_DEPARTAMENTOS.length > 0 ? Math.max.apply(null, MOCK_DEPARTAMENTOS.map(function(d) { return d.id; })) + 1 : 1;
            body.id = dNewId;
            body.nome = dNome;
            body.totalComputadores = 0;
            MOCK_DEPARTAMENTOS.push(body);
            pushLog('CRIACAO', 'SETOR', dNewId, 'Setor criado: ' + (body.nome || ''));
            persistAll();
            return body;
        }
        if (url.indexOf('/api/departamentos/') !== -1 && method === 'PUT') {
            var dUpId = parseInt(url.split('/api/departamentos/')[1]);
            var dIdx = MOCK_DEPARTAMENTOS.findIndex(function(d) { return d.id === dUpId; });
            if (dIdx !== -1) {
                if (body.nome !== undefined) {
                    var dNovoNome = String(body.nome).trim();
                    if (!dNovoNome) throw new Error('Informe o nome do setor.');
                    var dConflito = MOCK_DEPARTAMENTOS.some(function(d) { return d.id !== dUpId && normSetor(d.nome) === normSetor(dNovoNome); });
                    if (dConflito) throw new Error('J� existe um setor com o nome "' + dNovoNome + '".');
                    body.nome = dNovoNome;
                }
                var prevNome = MOCK_DEPARTAMENTOS[dIdx].nome;
                Object.assign(MOCK_DEPARTAMENTOS[dIdx], body);
                var setorMovidos = 0;
                if (body.nome !== undefined && String(body.nome || '').trim() !== String(prevNome || '').trim()) {
                    setorMovidos = migrarSetor(prevNome, body.nome);
                }
                withSetorCounts();
                pushLog('ALTERACAO', 'SETOR', dUpId, 'Setor atualizado: ' + (prevNome || '') + (body.nome && body.nome !== prevNome ? ' ? ' + body.nome : '') + (setorMovidos ? ' (' + setorMovidos + ' computador(es) movido(s))' : ''));
                persistAll();
                return MOCK_DEPARTAMENTOS[dIdx];
            }
            return null;
        }
        if (url.indexOf('/api/departamentos/') !== -1 && method === 'DELETE') {
            var dDelId = parseInt(url.split('/api/departamentos/')[1]);
            var dDel = MOCK_DEPARTAMENTOS.find(function(d) { return d.id === dDelId; });
            if (!dDel) return null;
            withSetorCounts();
            var pcsNoSetor = dDel.totalComputadores || 0;
            var ramaisNoSetor = MOCK_RAMAIS.filter(function(r) { return normSetor(r.setor) === normSetor(dDel.nome); }).length;
            if (pcsNoSetor > 0 || ramaisNoSetor > 0) {
                var motivos = [];
                if (pcsNoSetor > 0) motivos.push(pcsNoSetor + ' computador(es)');
                if (ramaisNoSetor > 0) motivos.push(ramaisNoSetor + ' ramal(is)');
                throw new Error('N�o � poss�vel excluir "' + dDel.nome + '": vinculado a ' + motivos.join(' e ') + '. Transfira-os para outro setor primeiro.');
            }
            MOCK_DEPARTAMENTOS = MOCK_DEPARTAMENTOS.filter(function(d) { return d.id !== dDelId; });
            pushLog('EXCLUSAO', 'SETOR', dDelId, 'Setor removido: ' + (dDel ? dDel.nome : ''));
            persistAll();
            return {};
        }
    }

    if (url.indexOf('/api/software-licencas') !== -1) {
        if (method === 'GET' && url.indexOf('/api/software-licencas/') === -1) {
            var swPs = new URLSearchParams(url.split('?')[1] || '');
            var swPage = parseInt(swPs.get('page')) || 0;
            var swSize = parseInt(swPs.get('size')) || 10;
            var swTermo = (swPs.get('termo') || '').toLowerCase();
            var swFiltered = MOCK_SOFTWARE;
            if (swTermo) {
                swFiltered = MOCK_SOFTWARE.filter(function(s) { return (s.nomeSoftware || '').toLowerCase().indexOf(swTermo) !== -1 || (s.fabricante || '').toLowerCase().indexOf(swTermo) !== -1 || (s.chaveLicenca || '').toLowerCase().indexOf(swTermo) !== -1; });
            }
            var swContent = swFiltered.slice(swPage * swSize, (swPage + 1) * swSize);
            return { content: swContent, page: swPage, size: swSize, totalElements: swFiltered.length, totalPages: Math.ceil(swFiltered.length / swSize) };
        }
        if (url.indexOf('/api/software-licencas/') !== -1 && method === 'GET') {
            var swId = parseInt(url.split('/api/software-licencas/')[1].split('?')[0]);
            return MOCK_SOFTWARE.find(function(s) { return s.id === swId; }) || null;
        }
        if (method === 'POST') {
            var swNewId = MOCK_SOFTWARE.length > 0 ? Math.max.apply(null, MOCK_SOFTWARE.map(function(s) { return s.id; })) + 1 : 1;
            body.id = swNewId; body.dataCriacao = new Date().toISOString(); body.dataAtualizacao = new Date().toISOString();
            MOCK_SOFTWARE.push(body);
            pushLog('CRIACAO', 'SOFTWARE_LICENCA', swNewId, 'Software cadastrado: ' + (body.nomeSoftware || ''));
            persistAll();
            return body;
        }
        if (url.indexOf('/api/software-licencas/') !== -1 && method === 'PUT') {
            var swId = parseInt(url.split('/api/software-licencas/')[1].split('?')[0]);
            var swIdx = MOCK_SOFTWARE.findIndex(function(s) { return s.id === swId; });
            if (swIdx !== -1) {
                Object.assign(MOCK_SOFTWARE[swIdx], body);
                pushLog('ALTERACAO', 'SOFTWARE_LICENCA', swId, 'Software atualizado: ' + ((body.nomeSoftware || MOCK_SOFTWARE[swIdx].nomeSoftware) || ''));
                persistAll();
                return MOCK_SOFTWARE[swIdx];
            }
            return null;
        }
        if (url.indexOf('/api/software-licencas/') !== -1 && method === 'DELETE') {
            var swDelId = parseInt(url.split('/api/software-licencas/')[1]);
            var swDel = MOCK_SOFTWARE.find(function(s) { return s.id === swDelId; });
            MOCK_SOFTWARE = MOCK_SOFTWARE.filter(function(s) { return s.id !== swDelId; });
            pushLog('EXCLUSAO', 'SOFTWARE_LICENCA', swDelId, 'Software removido: ' + (swDel ? swDel.nomeSoftware : ''));
            persistAll();
            return {};
        }
    }

    if (url.indexOf('/api/logs') !== -1) {
        if (method === 'POST') {
            pushLog(body.acao || 'ALTERACAO', body.entidade || 'SISTEMA', body.entidadeId || null, body.descricao || 'Atividade registrada');
            return { ok: true };
        }
        if (url.indexOf('/api/logs/recentes') !== -1) {
            var lLim = parseInt(new URLSearchParams(url.split('?')[1] || '').get('limit') || '10');
            return MOCK_LOGS.slice().sort(function(a, b) { return new Date(b.dataAtividade) - new Date(a.dataAtividade); }).slice(0, lLim);
        }
        if (method === 'GET' && url.indexOf('/api/logs/') === -1) {
            var psL = new URLSearchParams(url.split('?')[1] || '');
            var lUsuarioF = psL.get('usuario') || '';
            var lEntidadeF = psL.get('entidade') || '';
            var lMesF = psL.get('mes');
            var lAnoF = psL.get('ano');
            var lPage = parseInt(psL.get('page')) || 0;
            var lSize = parseInt(psL.get('size')) || 10;
            var lFiltered = MOCK_LOGS.filter(function(l) {
                if (lUsuarioF && (l.usuario || '').toLowerCase().indexOf(lUsuarioF.toLowerCase()) === -1) return false;
                if (lEntidadeF && l.entidade !== lEntidadeF) return false;
                if ((lMesF !== null && lMesF !== '') || (lAnoF !== null && lAnoF !== '')) {
                    var ld = new Date(l.dataAtividade);
                    if (!l.dataAtividade || isNaN(ld.getTime())) return false;
                    if (lMesF !== null && lMesF !== '' && ld.getMonth() !== parseInt(lMesF)) return false;
                    if (lAnoF !== null && lAnoF !== '' && ld.getFullYear() !== parseInt(lAnoF)) return false;
                }
                return true;
            }).slice().sort(function(a, b) { return new Date(b.dataAtividade) - new Date(a.dataAtividade); });
            var lStart = lPage * lSize;
            return { content: lFiltered.slice(lStart, lStart + lSize), totalElements: lFiltered.length, totalPages: Math.ceil(lFiltered.length / lSize), number: lPage, size: lSize };
        }
    }

    if (url.indexOf('/api/computadores/estatisticas') !== -1) {
        var ativos = MOCK_COMPUTADORES.filter(function(c) { return (c.status || 'ATIVO') === 'ATIVO'; }).length;
        var pred = MOCK_COMPUTADORES.filter(function(c) { return c.status === 'MANUTENCAO_PREDITIVA'; }).length;
        var prev = MOCK_COMPUTADORES.filter(function(c) { return c.status === 'MANUTENCAO_PREVENTIVA'; }).length;
        var emerg = MOCK_COMPUTADORES.filter(function(c) { return c.status === 'MANUTENCAO_EMERGENCIAL'; }).length;
        var concl = MOCK_COMPUTADORES.filter(function(c) { return c.status === 'CONCLUIDO'; }).length;
        var fases = { ATIVO: 0, PREDITIVO: 0, PREVENTIVO: 0, ATRASADO: 0 };
        MOCK_COMPUTADORES.forEach(function(c) { var f = computeCycle(Object.assign({}, c)).faseCiclo; if (fases[f] !== undefined) fases[f]++; });
        return { total: MOCK_COMPUTADORES.length, ativos: ativos, manutencaoPreditiva: pred, manutencaoPreventiva: prev, manutencaoEmergencial: emerg, concluidos: concl, manutencaoVencida: computadoresCicloVencido().length, faseAtivo: fases.ATIVO, fasePreditivo: fases.PREDITIVO, fasePreventivo: fases.PREVENTIVO, faseAtrasado: fases.ATRASADO, porStatus: { ATIVO: ativos, MANUTENCAO_PREDITIVA: pred, MANUTENCAO_PREVENTIVA: prev, MANUTENCAO_EMERGENCIAL: emerg, CONCLUIDO: concl } };
    }

    if (url.indexOf('/api/manutencoes/estatisticas') !== -1) {
        var pend = MOCK_MANUTENCOES.filter(function(m) { return m.status === 'PENDENTE'; }).length;
        var andam = MOCK_MANUTENCOES.filter(function(m) { return m.status === 'EM_ANDAMENTO'; }).length;
        var conc = MOCK_MANUTENCOES.filter(function(m) { return m.status === 'CONCLUIDA'; }).length;
        var corr = MOCK_MANUTENCOES.filter(function(m) { return m.tipo === 'CORRETIVA'; }).length;
        var prev = MOCK_MANUTENCOES.filter(function(m) { return m.tipo === 'PREVENTIVA'; }).length;
        var pred = MOCK_MANUTENCOES.filter(function(m) { return m.tipo === 'PREDITIVA'; }).length;
        var emer = MOCK_MANUTENCOES.filter(function(m) { return m.tipo === 'EMERGENCIAL'; }).length;
        var porMes = {};
        MOCK_MANUTENCOES.forEach(function(m) {
            if (m.dataCadastro) { var dt = new Date(m.dataCadastro); var k = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0'); porMes[k] = (porMes[k] || 0) + 1; }
        });
        var porStatus = { PENDENTE: pend, EM_ANDAMENTO: andam, CONCLUIDA: conc, CANCELADA: MOCK_MANUTENCOES.length - pend - andam - conc };
        return { total: MOCK_MANUTENCOES.length, pendentes: pend, emAndamento: andam, concluidas: conc, canceladas: MOCK_MANUTENCOES.length - pend - andam - conc, porTipo: { CORRETIVA: corr, PREVENTIVA: prev, PREDITIVA: pred, EMERGENCIAL: emer }, porMes: porMes, porStatus: porStatus };
    }

    if (url.indexOf('/api/ordens-servico/estatisticas') !== -1) {
        var ab = MOCK_ORDENS.filter(function(o) { return o.status === 'ABERTA'; }).length;
        var ea = MOCK_ORDENS.filter(function(o) { return o.status === 'EM_ANALISE'; }).length;
        var ee = MOCK_ORDENS.filter(function(o) { return o.status === 'EM_EXECUCAO'; }).length;
        var co = MOCK_ORDENS.filter(function(o) { return o.status === 'CONCLUIDA'; }).length;
        var bx = MOCK_ORDENS.filter(function(o) { return o.prioridade === 'BAIXA'; }).length;
        var md = MOCK_ORDENS.filter(function(o) { return o.prioridade === 'MEDIA'; }).length;
        var al = MOCK_ORDENS.filter(function(o) { return o.prioridade === 'ALTA'; }).length;
        var cr = MOCK_ORDENS.filter(function(o) { return o.prioridade === 'CRITICA'; }).length;
        return { total: MOCK_ORDENS.length, abertas: ab, emAnalise: ea, emExecucao: ee, concluidas: co, canceladas: MOCK_ORDENS.length - ab - ea - ee - co, porPrioridade: { BAIXA: bx, MEDIA: md, ALTA: al, CRITICA: cr } };
    }

    if (url.indexOf('/api/computadores/paginado') !== -1) {
        var ps = new URLSearchParams(url.split('?')[1] || '');
        var termo = (ps.get('termo') || '').toLowerCase();
        var statusF = ps.get('status') || '';
        var page = parseInt(ps.get('page')) || 0;
        var size = parseInt(ps.get('size')) || 12;
        var filtered = MOCK_COMPUTADORES.filter(function(c) {
            if (statusF && (c.status || 'ATIVO') !== statusF) return false;
            if (termo && (((c.nomePc || '').toLowerCase().indexOf(termo) === -1 && (c.modeloMarca || '').toLowerCase().indexOf(termo) === -1 && (c.usuarioDesignado || '').toLowerCase().indexOf(termo) === -1 && (c.numeroSerie || '').toLowerCase().indexOf(termo) === -1))) return false;
            return true;
        }).map(function(c) { return computeCycle(Object.assign({}, c)); });
        filtered.sort(function(a, b) {
            var da = a.diasRestantes !== undefined ? a.diasRestantes : 9999;
            var db = b.diasRestantes !== undefined ? b.diasRestantes : 9999;
            return da - db;
        });
        var start = page * size;
        return { content: filtered.slice(start, start + size), totalElements: filtered.length, totalGeral: MOCK_COMPUTADORES.length, totalPages: Math.ceil(filtered.length / size), number: page, size: size };
    }

    if (url.indexOf('/api/computadores/') !== -1 && method === 'GET') {
        var found = MOCK_COMPUTADORES.find(function(c) { return c.id === parseInt(url.split('/api/computadores/')[1]); });
        return found ? computeCycle(Object.assign({}, found)) : null;
    }
    if (url.indexOf('/api/computadores') !== -1 && method === 'POST') {
        if (MOCK_COMPUTADORES.length >= MAX_COMPUTADORES) throw new Error('Limite de 1000 computadores atingido.');
        if (!body.modeloMarca) body.modeloMarca = '';
        if (!body.fornecedor) body.fornecedor = '';
        if (!body.dataAquisicao) body.dataAquisicao = null;
        if (!body.dataGarantia) body.dataGarantia = null;
        if (!body.status) body.status = 'ATIVO';
        if (!body.nomePc) body.nomePc = '';
        if (!body.numeroSerie) body.numeroSerie = '';
        if (body.usuarioDesignado === undefined || body.usuarioDesignado === null) body.usuarioDesignado = '';
        if (!body.processador) body.processador = 'A definir';
        if (!body.memoriaRam) body.memoriaRam = 'A definir';
        if (!body.armazenamento) body.armazenamento = 'A definir';
        if (body.departamento) body.departamento = canonSetor(body.departamento);
        body.id = MOCK_COMPUTADORES.length > 0 ? Math.max.apply(null, MOCK_COMPUTADORES.map(function(c) { return c.id; })) + 1 : 1;
        if (!body.dataCadastro) body.dataCadastro = new Date().toISOString();
        if (!body.dataInicioCiclo) body.dataInicioCiclo = body.dataCadastro;
        if (!body.proximaManutencao) body.proximaManutencao = new Date(new Date(body.dataInicioCiclo).getTime() + 240 * 24 * 60 * 60 * 1000).toISOString();
        MOCK_COMPUTADORES.push(body);
        ensureSetor(body.departamento);
        withSetorCounts();
        pushLog('CRIACAO', 'COMPUTADOR', body.id, 'Computador cadastrado: ' + (body.nomePc || '') + (body.departamento ? ' (Setor: ' + body.departamento + ')' : ''));
        persistAll();
        return body;
    }
    if (url.indexOf('/api/computadores/') !== -1 && method === 'PUT') {
        var uid = parseInt(url.split('/api/computadores/')[1]);
        var idx = MOCK_COMPUTADORES.findIndex(function(c) { return c.id === uid; });
            if (idx !== -1) {
                var prevPc = MOCK_COMPUTADORES[idx];
                if (body.departamento !== undefined && body.departamento) body.departamento = canonSetor(body.departamento);
                var diffParts = [];
            if (body.departamento !== undefined && normSetor(body.departamento) !== normSetor(prevPc.departamento)) {
                diffParts.push('Setor: ' + (prevPc.departamento || '-') + ' ? ' + (String(body.departamento || '').trim() || '-'));
            }
            if (body.status !== undefined && body.status !== prevPc.status) diffParts.push('Status: ' + prevPc.status + ' ? ' + body.status);
            if (body.nomePc !== undefined && body.nomePc !== prevPc.nomePc) diffParts.push('Nome: ' + prevPc.nomePc + ' ? ' + body.nomePc);
            if (body.usuarioDesignado !== undefined && body.usuarioDesignado !== prevPc.usuarioDesignado) diffParts.push('Usu�rio: ' + (prevPc.usuarioDesignado || '-') + ' ? ' + (body.usuarioDesignado || '-'));
            var nomeFinal = body.nomePc || prevPc.nomePc;
            var setorFinal = body.departamento !== undefined ? body.departamento : prevPc.departamento;
            Object.assign(prevPc, body);
            ensureSetor(setorFinal);
            withSetorCounts();
            pushLog('ALTERACAO', 'COMPUTADOR', uid, 'Computador atualizado: ' + nomeFinal + (diffParts.length ? ' (' + diffParts.join('; ') + ')' : ''));
            persistAll();
            return prevPc;
        }
        return null;
    }
    if (url.indexOf('/api/computadores/') !== -1 && method === 'DELETE') {
        var delId = parseInt(url.split('/api/computadores/')[1]);
        var delPc = MOCK_COMPUTADORES.find(function(c) { return c.id === delId; });
        MOCK_COMPUTADORES = MOCK_COMPUTADORES.filter(function(c) { return c.id !== delId; });
        withSetorCounts();
        pushLog('EXCLUSAO', 'COMPUTADOR', delId, 'Computador removido: ' + (delPc ? delPc.nomePc : ''));
        persistAll();
        return {};
    }
    if (url.indexOf('/api/computadores/bulk-status') !== -1 && method === 'PATCH') {
        var ids = body.ids || [];
        var st = body.status || 'ATIVO';
        var count = 0;
        ids.forEach(function(bid) {
            var bi = MOCK_COMPUTADORES.findIndex(function(c) { return c.id === bid; });
            if (bi !== -1) { MOCK_COMPUTADORES[bi].status = st; count++; }
        });
        if (count > 0) pushLog('ALTERACAO_EM_MASSA', 'COMPUTADOR', null, count + ' computador(es) com status alterado para ' + st);
        else persistAll();
        return { atualizados: count };
    }

    if (url.indexOf('/api/manutencoes') !== -1 && url.indexOf('estatisticas') === -1) {
        var ps2 = new URLSearchParams(url.split('?')[1] || '');
        var stF = ps2.get('status') || '';
        var tmF = (ps2.get('termo') || '').toLowerCase();
        var compIdF = parseInt(ps2.get('computadorId')) || 0;
        var showConc = ps2.get('showConcluidas') === 'true';
        var pg = parseInt(ps2.get('page')) || 0;
        var sz = parseInt(ps2.get('size')) || 10;
        if (method === 'GET' && url.indexOf('/api/manutencoes/') === -1) {
            var mf = MOCK_MANUTENCOES.filter(function(m) {
                if (compIdF && m.computadorId !== compIdF) return false;
                if (stF) {
                    if (m.status !== stF) return false;
                } else if (!showConc) {
                    if (m.status === 'CONCLUIDA' || m.status === 'CANCELADA') return false;
                }
                if (tmF && (m.computadorNome || '').toLowerCase().indexOf(tmF) === -1 && (m.tecnicoResponsavel || '').toLowerCase().indexOf(tmF) === -1 && (m.descricao || '').toLowerCase().indexOf(tmF) === -1) return false;
                return true;
            });
            var ms = pg * sz;
            return { content: mf.slice(ms, ms + sz), totalElements: mf.length, totalPages: Math.ceil(mf.length / sz), number: pg, size: sz };
        }
        if (url.indexOf('/api/manutencoes/') !== -1 && method === 'GET') {
            return MOCK_MANUTENCOES.find(function(m) { return m.id === parseInt(url.split('/api/manutencoes/')[1]); }) || null;
        }
        if (method === 'POST') {
            if (MOCK_MANUTENCOES.length >= MAX_MANUTENCOES) {
                evictOldest(MOCK_MANUTENCOES);
                try { if (typeof showToast === 'function') showToast('Limite de 2000 manutencoes: a mais antiga foi removida.', 'warning'); } catch (e) {}
            }
            body.id = MOCK_MANUTENCOES.length > 0 ? Math.max.apply(null, MOCK_MANUTENCOES.map(function(m) { return m.id; })) + 1 : 1;
            if (!body.status) body.status = 'PENDENTE';
            if (!body.tipo) body.tipo = 'PREVENTIVA';
            var comp = MOCK_COMPUTADORES.find(function(c) { return c.id === body.computadorId; });
            body.computadorNome = comp ? comp.nomePc : '-'; body.dataCadastro = new Date().toISOString(); body.dataConclusao = null;
            MOCK_MANUTENCOES.push(body);
            pushLog('CRIACAO', 'MANUTENCAO', body.id, 'Manuten��o criada: ' + (body.tipo || '') + ' - ' + (body.computadorNome || ''));
            persistAll();
            syncManutencaoWithComputador(body.computadorId, body.status, body.tipo);
            return body;
        }
        if (url.indexOf('/api/manutencoes/') !== -1 && method === 'PUT') {
            var muId = parseInt(url.split('/api/manutencoes/')[1]);
            var mi = MOCK_MANUTENCOES.findIndex(function(m) { return m.id === muId; });
            if (mi !== -1) {
                var prevStatus = MOCK_MANUTENCOES[mi].status;
                var prevCompId = MOCK_MANUTENCOES[mi].computadorId;
                var prevTipo = MOCK_MANUTENCOES[mi].tipo;
                Object.assign(MOCK_MANUTENCOES[mi], body);
                if (MOCK_MANUTENCOES[mi].computadorId === undefined || MOCK_MANUTENCOES[mi].computadorId === null) MOCK_MANUTENCOES[mi].computadorId = prevCompId;
                if (!MOCK_MANUTENCOES[mi].tipo) MOCK_MANUTENCOES[mi].tipo = prevTipo || 'PREVENTIVA';
                if (!MOCK_MANUTENCOES[mi].status) MOCK_MANUTENCOES[mi].status = prevStatus || 'PENDENTE';
                var novoComp = MOCK_COMPUTADORES.find(function(c) { return c.id === MOCK_MANUTENCOES[mi].computadorId; });
                MOCK_MANUTENCOES[mi].computadorNome = novoComp ? novoComp.nomePc : (MOCK_MANUTENCOES[mi].computadorNome || '-');
                var mudouPc = prevCompId !== MOCK_MANUTENCOES[mi].computadorId;
                if (mudouPc) {
                    // devolve o PC antigo e aplica a manutencao no novo
                    syncManutencaoWithComputador(prevCompId, 'CONCLUIDA', prevTipo);
                    syncManutencaoWithComputador(MOCK_MANUTENCOES[mi].computadorId, MOCK_MANUTENCOES[mi].status, MOCK_MANUTENCOES[mi].tipo);
                } else if (body.status && body.status !== prevStatus) {
                    syncManutencaoWithComputador(MOCK_MANUTENCOES[mi].computadorId, body.status, MOCK_MANUTENCOES[mi].tipo);
                }
                if (body.status && body.status !== prevStatus) {
                    if (body.status === 'CONCLUIDA') MOCK_MANUTENCOES[mi].dataConclusao = new Date().toISOString();
                    if (prevStatus === 'CONCLUIDA') MOCK_MANUTENCOES[mi].dataConclusao = null;
                }
                pushLog('ALTERACAO', 'MANUTENCAO', muId, 'Manuten��o atualizada: ' + (MOCK_MANUTENCOES[mi].computadorNome || '-') + (body.status && body.status !== prevStatus ? ' (Status: ' + prevStatus + ' ? ' + body.status + ')' : ''));
                persistAll();
                return MOCK_MANUTENCOES[mi];
            }
            return null;
        }
        if (url.indexOf('/api/manutencoes/') !== -1 && method === 'DELETE') {
            var mDelId = parseInt(url.split('/api/manutencoes/')[1]);
            var mDel = MOCK_MANUTENCOES.find(function(m) { return m.id === mDelId; });
            MOCK_MANUTENCOES = MOCK_MANUTENCOES.filter(function(m) { return m.id !== mDelId; });
            // a manutencao aberta sumiu: o PC nao pode ficar preso em MANUTENCAO_*
            if (mDel && mDel.computadorId) syncManutencaoWithComputador(mDel.computadorId, 'CONCLUIDA', mDel.tipo);
            pushLog('EXCLUSAO', 'MANUTENCAO', mDelId, 'Manuten��o removida: ' + (mDel ? (mDel.computadorNome || '') : ''));
            persistAll();
            return {};
        }
    }

    if (url.indexOf('/api/ordens-servico') !== -1) {
        var ps3 = new URLSearchParams(url.split('?')[1] || '');
        var stF3 = ps3.get('status') || '';
        var prF = ps3.get('prioridade') || '';
        var tmF3 = (ps3.get('termo') || '').toLowerCase();
        var pg3 = parseInt(ps3.get('page')) || 0;
        var sz3 = parseInt(ps3.get('size')) || 10;
        if (method === 'GET' && url.indexOf('/api/ordens-servico/') === -1) {
            var of3 = MOCK_ORDENS.filter(function(o) {
                if (stF3 && o.status !== stF3) return false;
                if (prF && o.prioridade !== prF) return false;
                if (tmF3 && (o.titulo || '').toLowerCase().indexOf(tmF3) === -1 && (o.solicitante || '').toLowerCase().indexOf(tmF3) === -1 && (o.computadorNome || '').toLowerCase().indexOf(tmF3) === -1) return false;
                return true;
            });
            var os3 = pg3 * sz3;
            return { content: of3.slice(os3, os3 + sz3), totalElements: of3.length, totalPages: Math.ceil(of3.length / sz3), number: pg3, size: sz3 };
        }
        if (url.indexOf('/api/ordens-servico/') !== -1 && method === 'GET') {
            return MOCK_ORDENS.find(function(o) { return o.id === parseInt(url.split('/api/ordens-servico/')[1]); }) || null;
        }
        if (method === 'POST') {
            if (MOCK_ORDENS.length >= MAX_ORDENS) {
                evictOldest(MOCK_ORDENS);
                try { if (typeof showToast === 'function') showToast('Limite de 2000 ordens: a mais antiga foi removida.', 'warning'); } catch (e) {}
            }
            body.id = MOCK_ORDENS.length > 0 ? Math.max.apply(null, MOCK_ORDENS.map(function(o) { return o.id; })) + 1 : 1;
            if (!body.status) body.status = 'ABERTA';
            if (!body.prioridade) body.prioridade = 'MEDIA';
            var comp2 = MOCK_COMPUTADORES.find(function(c) { return c.id === body.computadorId; });
            body.computadorNome = comp2 ? comp2.nomePc : '-'; body.dataAbertura = new Date().toISOString(); body.dataConclusao = null; body.solucao = null;
            MOCK_ORDENS.push(body);
            pushLog('CRIACAO', 'ORDEM_SERVICO', body.id, 'OS criada: ' + (body.titulo || '') + ' (' + (body.computadorNome || '') + ')');
            persistAll();
            return body;
        }
        if (url.indexOf('/api/ordens-servico/') !== -1 && method === 'PUT') {
            var ouId = parseInt(url.split('/api/ordens-servico/')[1]);
            var oi2 = MOCK_ORDENS.findIndex(function(o) { return o.id === ouId; });
            if (oi2 !== -1) {
                var prevOsStatus = MOCK_ORDENS[oi2].status;
                Object.assign(MOCK_ORDENS[oi2], body);
                pushLog('ALTERACAO', 'ORDEM_SERVICO', ouId, 'OS atualizada: ' + ((body.titulo || MOCK_ORDENS[oi2].titulo) || '') + (body.status && body.status !== prevOsStatus ? ' (Status: ' + prevOsStatus + ' ? ' + body.status + ')' : ''));
                persistAll();
                return MOCK_ORDENS[oi2];
            }
            return null;
        }
        if (url.indexOf('/api/ordens-servico/') !== -1 && method === 'DELETE') {
            var oDelId = parseInt(url.split('/api/ordens-servico/')[1]);
            var oDel = MOCK_ORDENS.find(function(o) { return o.id === oDelId; });
            MOCK_ORDENS = MOCK_ORDENS.filter(function(o) { return o.id !== oDelId; });
            pushLog('EXCLUSAO', 'ORDEM_SERVICO', oDelId, 'OS removida: ' + (oDel ? (oDel.titulo || '') : ''));
            persistAll();
            return {};
        }
    }

    if (url.indexOf('/api/usuarios') !== -1) {
        if (method === 'GET' && url.indexOf('/api/usuarios/') === -1) return MOCK_USUARIOS;
        if (url.indexOf('/api/usuarios/') !== -1 && method === 'GET') {
            return MOCK_USUARIOS.find(function(u) { return u.id === parseInt(url.split('/api/usuarios/')[1]); }) || null;
        }
        if (method === 'POST') {
            body.id = MOCK_USUARIOS.length > 0 ? Math.max.apply(null, MOCK_USUARIOS.map(function(u) { return u.id; })) + 1 : 1;
            body.ativo = true; body.dataCadastro = new Date().toISOString();
            if (!body.perfil) body.perfil = 'TECNICO';
            if (!body.nomeCompleto) body.nomeCompleto = body.username || '-';
            MOCK_USUARIOS.push(body);
            pushLog('CRIACAO', 'USUARIO', body.id, 'Usu�rio criado: ' + (body.username || body.nomeCompleto || ''));
            persistAll();
            return body;
        }
        if (url.indexOf('/api/usuarios/') !== -1 && method === 'PUT') {
            var uuId = parseInt(url.split('/api/usuarios/')[1]);
            var ui2 = MOCK_USUARIOS.findIndex(function(u) { return u.id === uuId; });
            if (ui2 !== -1) {
                Object.assign(MOCK_USUARIOS[ui2], body);
                pushLog('ALTERACAO', 'USUARIO', uuId, 'Usu�rio atualizado: ' + ((body.username || MOCK_USUARIOS[ui2].username) || ''));
                persistAll();
                return MOCK_USUARIOS[ui2];
            }
            return null;
        }
        if (url.indexOf('/api/usuarios/') !== -1 && method === 'DELETE') {
            var uDelId = parseInt(url.split('/api/usuarios/')[1]);
            var uDel = MOCK_USUARIOS.find(function(u) { return u.id === uDelId; });
            MOCK_USUARIOS = MOCK_USUARIOS.filter(function(u) { return u.id !== uDelId; });
            pushLog('EXCLUSAO', 'USUARIO', uDelId, 'Usu�rio removido: ' + (uDel ? (uDel.username || uDel.nomeCompleto || '') : ''));
            persistAll();
            return {};
        }
    }

    if (url.indexOf('/api/ramais') !== -1) {
        if (method === 'GET' && url.indexOf('/api/ramais/') === -1) {
            var rp = new URLSearchParams(url.split('?')[1] || '');
            var rTermo = (rp.get('termo') || '').toLowerCase();
            var rStatus = rp.get('status') || '';
            var rSetor = rp.get('setor') || '';
            var rPeriodo = rp.get('periodo') || '';
            var rPrioridade = rp.get('prioridade') || '';
            var rFiltered = MOCK_RAMAIS.filter(function(r) {
                if (rStatus && r.status !== rStatus) return false;
                if (rSetor && r.setor !== rSetor) return false;
                if (rTermo && ((String(r.numeroRamal || '').toLowerCase().indexOf(rTermo) === -1 && String(r.setor || '').toLowerCase().indexOf(rTermo) === -1 && (r.descricao || '').toLowerCase().indexOf(rTermo) === -1))) return false;
                return true;
            }).map(function(r) { return computeRamalCycle(Object.assign({}, r)); });
            if (rPeriodo) {
                var now = new Date();
                rFiltered = rFiltered.filter(function(r) {
                    if (!r.diasRestantes && r.diasRestantes !== 0) return true;
                    if (rPeriodo === 'atrasado') return r.diasRestantes < 0;
                    if (rPeriodo === '30d') return r.diasRestantes >= 0 && r.diasRestantes <= 30;
                    if (rPeriodo === '90d') return r.diasRestantes > 30 && r.diasRestantes <= 90;
                    if (rPeriodo === '180d') return r.diasRestantes > 90 && r.diasRestantes <= 180;
                    if (rPeriodo === '365d') return r.diasRestantes > 180;
                    return true;
                });
            }
            if (rPrioridade) {
                rFiltered = rFiltered.filter(function(r) {
                    if (rPrioridade === 'ATRASADO') return r.faseCiclo === 'ATRASADO';
                    if (rPrioridade === 'PREVENTIVO') return r.faseCiclo === 'PREVENTIVO';
                    if (rPrioridade === 'PREDITIVO') return r.faseCiclo === 'PREDITIVO';
                    if (rPrioridade === 'ATIVO') return r.faseCiclo === 'ATIVO';
                    return true;
                });
            }
            rFiltered.sort(function(a, b) {
                var da = a.diasRestantes !== undefined ? a.diasRestantes : 9999;
                var db = b.diasRestantes !== undefined ? b.diasRestantes : 9999;
                return da - db;
            });
            return rFiltered;
        }
        if (url.indexOf('/api/ramais/') !== -1 && method === 'GET') {
            var rId = parseInt(url.split('/api/ramais/')[1].split('?')[0]);
            var found = MOCK_RAMAIS.find(function(r) { return r.id === rId; }) || null;
            if (found) {
                var comp = MOCK_COMPUTADORES.find(function(c) { return c.id === found.computadorId; });
                var out = Object.assign({}, found);
                out.computadorNome = comp ? comp.nomePc : null;
                out.computadorModelo = comp ? comp.modeloMarca : null;
                computeRamalCycle(out);
                return out;
            }
            return null;
        }
        if (method === 'POST') {
            if (MOCK_RAMAIS.length >= MAX_RAMAIS) throw new Error('Limite de 1000 ramais atingido.');
            body.id = MOCK_RAMAIS.length > 0 ? Math.max.apply(null, MOCK_RAMAIS.map(function(r) { return r.id; })) + 1 : 1;
            if (body.numeroRamal === undefined || body.numeroRamal === null) body.numeroRamal = '';
            if (!body.status) body.status = 'ATIVO';
            var rNum = String(body.numeroRamal || '').trim();
            if (rNum && MOCK_RAMAIS.some(function(r) { return String(r.numeroRamal || '').trim() === rNum; })) throw new Error('J� existe um ramal com o n�mero ' + rNum + '.');
            if (body.setor) { body.setor = canonSetor(body.setor); ensureSetor(body.setor); }
            body.dataCadastro = new Date().toISOString();
            if (!body.dataInicioCiclo) body.dataInicioCiclo = new Date().toISOString();
            MOCK_RAMAIS.push(body);
            pushLog('CRIACAO', 'RAMAL', body.id, 'Ramal criado: ' + (body.numeroRamal || '') + (body.setor ? ' (' + body.setor + ')' : ''));
            persistAll();
            return body;
        }
        if (url.indexOf('/api/ramais/') !== -1 && method === 'PUT') {
            var ruId = parseInt(url.split('/api/ramais/')[1]);
            var ri = MOCK_RAMAIS.findIndex(function(r) { return r.id === ruId; });
            if (ri !== -1) {
                var oldStatus = MOCK_RAMAIS[ri].status;
                var oldSetor = MOCK_RAMAIS[ri].setor;
                var rNumU = String(body.numeroRamal === undefined ? MOCK_RAMAIS[ri].numeroRamal : body.numeroRamal).trim();
                if (rNumU && MOCK_RAMAIS.some(function(r) { return r.id !== ruId && String(r.numeroRamal || '').trim() === rNumU; })) throw new Error('J� existe um ramal com o n�mero ' + rNumU + '.');
                if (body.setor) { body.setor = canonSetor(body.setor); ensureSetor(body.setor); }
                Object.assign(MOCK_RAMAIS[ri], body);
                if (body.status === 'EM_MANUTENCAO' && oldStatus !== 'EM_MANUTENCAO') {
                    var manutId = MOCK_MANUTENCOES.length > 0 ? Math.max.apply(null, MOCK_MANUTENCOES.map(function(m) { return m.id; })) + 1 : 1;
                    MOCK_MANUTENCOES.push({ id: manutId, computadorId: MOCK_RAMAIS[ri].computadorId, computadorNome: 'Ramal ' + MOCK_RAMAIS[ri].numeroRamal, tipo: 'CORRETIVA', status: 'PENDENTE', descricao: 'Manutencao do ramal ' + MOCK_RAMAIS[ri].numeroRamal + ' - ' + (MOCK_RAMAIS[ri].descricao || ''), tecnicoResponsavel: '', pecasTrocadas: '', observacoes: 'Aberto automaticamente ao colocar ramal em manutencao', fotoUrl: '', dataCadastro: new Date().toISOString(), dataConclusao: null });
                    var osId = MOCK_ORDENS.length > 0 ? Math.max.apply(null, MOCK_ORDENS.map(function(o) { return o.id; })) + 1 : 1;
                    MOCK_ORDENS.push({ id: osId, titulo: 'OS - Ramal ' + MOCK_RAMAIS[ri].numeroRamal, descricao: 'Ordem aberta para manutencao do ramal ' + MOCK_RAMAIS[ri].numeroRamal, computadorId: MOCK_RAMAIS[ri].computadorId, computadorNome: 'Ramal ' + MOCK_RAMAIS[ri].numeroRamal, prioridade: 'MEDIA', status: 'ABERTA', solicitante: 'Sistema', tecnicoResponsavel: '', dataAbertura: new Date().toISOString(), dataPrevisao: '', dataConclusao: '', solucao: '' });
                }
                if (body.status === 'ATIVO' && oldStatus === 'EM_MANUTENCAO') {
                    MOCK_MANUTENCOES.forEach(function(m) { if (m.computadorNome === 'Ramal ' + MOCK_RAMAIS[ri].numeroRamal && m.status !== 'CONCLUIDA' && m.status !== 'CANCELADA') { m.status = 'CONCLUIDA'; m.dataConclusao = new Date().toISOString(); } });
                    MOCK_ORDENS.forEach(function(o) { if (o.computadorNome === 'Ramal ' + MOCK_RAMAIS[ri].numeroRamal && o.status !== 'CONCLUIDA' && o.status !== 'CANCELADA') { o.status = 'CONCLUIDA'; o.dataConclusao = new Date().toISOString(); } });
                }
                var rDiff = [];
                if (body.status !== undefined && body.status !== oldStatus) rDiff.push('Status: ' + oldStatus + ' ? ' + body.status);
                if (body.setor !== undefined && normSetor(body.setor) !== normSetor(oldSetor)) rDiff.push('Setor: ' + (oldSetor || '-') + ' ? ' + body.setor);
                pushLog('ALTERACAO', 'RAMAL', ruId, 'Ramal atualizado: ' + (MOCK_RAMAIS[ri].numeroRamal || '') + (rDiff.length ? ' (' + rDiff.join('; ') + ')' : ''));
                persistAll();
                return MOCK_RAMAIS[ri];
            }
            return null;
        }
        if (url.indexOf('/api/ramais/') !== -1 && method === 'DELETE') {
            var rDelId = parseInt(url.split('/api/ramais/')[1]);
            var rDel = MOCK_RAMAIS.find(function(r) { return r.id === rDelId; });
            MOCK_RAMAIS = MOCK_RAMAIS.filter(function(r) { return r.id !== rDelId; });
            pushLog('EXCLUSAO', 'RAMAL', rDelId, 'Ramal removido: ' + (rDel ? (rDel.numeroRamal + (rDel.setor ? ' (' + rDel.setor + ')' : '')) : ''));
            persistAll();
            return {};
        }
    }

    if (url.indexOf('/api/trocas') !== -1) {
        if (method === 'GET' && url.indexOf('/api/trocas/') === -1) {
            var tp = new URLSearchParams(url.split('?')[1] || '');
            var tTipo = tp.get('tipoEquipamento') || '';
            var tTermo = (tp.get('termo') || '').toLowerCase();
            var tFiltered = MOCK_TROCAS.filter(function(t) {
                if (tTipo && t.tipoEquipamento !== tTipo) return false;
                if (tTermo && (((t.equipamentoNome || '').toLowerCase().indexOf(tTermo) === -1 && (t.descricao || '').toLowerCase().indexOf(tTermo) === -1 && (t.responsavel || '').toLowerCase().indexOf(tTermo) === -1))) return false;
                return true;
            });
            return tFiltered;
        }
        if (url.indexOf('/api/trocas/') !== -1 && method === 'GET') {
            var tId2 = parseInt(url.split('/api/trocas/')[1].split('?')[0]);
            return MOCK_TROCAS.find(function(t) { return t.id === tId2; }) || null;
        }
        if (method === 'POST') {
            body.id = MOCK_TROCAS.length > 0 ? Math.max.apply(null, MOCK_TROCAS.map(function(t) { return t.id; })) + 1 : 1;
            body.dataTroca = new Date().toISOString();
            if (!body.tipoMovimento) body.tipoMovimento = 'SAIDA';
            if (body.equipamentoNome === undefined || body.equipamentoNome === null) body.equipamentoNome = '-';
            MOCK_TROCAS.push(body);
            pushLog('CRIACAO', 'TROCA', body.id, 'Troca registrada: ' + (body.equipamentoNome || '') + (body.tipoEquipamento ? ' (' + body.tipoEquipamento + ')' : ''));
            persistAll();
            return body;
        }
        if (url.indexOf('/api/trocas/') !== -1 && method === 'PUT') {
            var tuId = parseInt(url.split('/api/trocas/')[1]);
            var ti = MOCK_TROCAS.findIndex(function(t) { return t.id === tuId; });
            if (ti !== -1) {
                Object.assign(MOCK_TROCAS[ti], body);
                pushLog('ALTERACAO', 'TROCA', tuId, 'Troca atualizada: ' + ((body.equipamentoNome || MOCK_TROCAS[ti].equipamentoNome) || ''));
                persistAll();
                return MOCK_TROCAS[ti];
            }
            return null;
        }
        if (url.indexOf('/api/trocas/') !== -1 && method === 'DELETE') {
            var tDelId = parseInt(url.split('/api/trocas/')[1]);
            var tDel = MOCK_TROCAS.find(function(t) { return t.id === tDelId; });
            MOCK_TROCAS = MOCK_TROCAS.filter(function(t) { return t.id !== tDelId; });
            pushLog('EXCLUSAO', 'TROCA', tDelId, 'Troca removida: ' + (tDel ? (tDel.equipamentoNome || '') : ''));
            persistAll();
            return {};
        }
    }

    return null;
}

// ==========================================
// AUTH & API
// ==========================================
function getToken() { try { return localStorage.getItem('authToken'); } catch(e) { return null; } }
function getPerfil() { try { return localStorage.getItem('userPerfil') || 'USUARIO'; } catch(e) { return 'USUARIO'; } }
function apiHeaders() { var t = getToken(); var h = { 'Content-Type': 'application/json' }; if (t) h['Authorization'] = 'Bearer ' + t; return h; }

async function apiFetch(url, opts) {
    opts = opts || {};
    opts.headers = Object.assign({}, apiHeaders(), opts.headers || {});
    if (!USE_MOCK) {
        try {
            var res = await fetch(API + url, opts);
            if (res.status === 401 || res.status === 403) { try { localStorage.clear(); } catch(e) {} window.location.href = 'login.html'; return; }
            if (res.status === 204) return {};
            var text = await res.text();
            var data = text ? JSON.parse(text) : {};
            if (!res.ok) throw new Error(data.erro || data.mensagem || 'Erro na requisi��o');
            return data;
        } catch (e) {
            if (e.name === 'TypeError' && e.message === 'Failed to fetch') {
                if (!USE_MOCK) {
                    USE_MOCK = true;
                    setTimeout(function() {
                        if (USE_MOCK && getToken()) {
                            apiFetch('/api/auth/me').then(function() { USE_MOCK = false; }).catch(function() {});
                        }
                    }, 30000);
                }
            } else { throw e; }
        }
    }
    var mockResult = mockFetch(url, opts);
    if (mockResult === null) throw new Error('Recurso n�o encontrado (mock)');
    return mockResult;
}

function handleLogout() { disconnectWs(); try { localStorage.clear(); } catch(e) {} window.location.href = 'login.html'; }

// ==========================================
// HEADER: Notificacoes / Configuracoes / Plano de Fundo
// ==========================================
function hideHdrDropdowns() {
    var np = document.getElementById('notifPanel'), sp = document.getElementById('settingsPanel');
    if (np) np.style.display = 'none';
    if (sp) sp.style.display = 'none';
    var nb = document.getElementById('notifBtn'); if (nb) nb.classList.remove('active');
    var sb = document.getElementById('settingsBtn'); if (sb) sb.classList.remove('active');
}

function toggleNotifPanel(e) {
    if (e) e.stopPropagation();
    var np = document.getElementById('notifPanel'), sp = document.getElementById('settingsPanel');
    var open = np && np.style.display !== 'none';
    hideHdrDropdowns();
    if (!open && np) {
        np.style.display = 'block';
        var nb = document.getElementById('notifBtn'); if (nb) nb.classList.add('active');
        renderNotifPanel();
    }
}

function toggleSettingsPanel(e) {
    if (e) e.stopPropagation();
    var np = document.getElementById('notifPanel'), sp = document.getElementById('settingsPanel');
    var open = sp && sp.style.display !== 'none';
    hideHdrDropdowns();
    if (!open && sp) {
        sp.style.display = 'block';
        var sb = document.getElementById('settingsBtn'); if (sb) sb.classList.add('active');
        updateBgOptionActive();
    }
}

async function renderNotifPanel() {
    var listEl = document.getElementById('notifList');
    if (!listEl) return;
    var items = [];
    var alertasCount = 0;
    try {
        var alertas = await apiFetch('/api/computadores/alertas');
        (alertas.garantiaVencida || []).forEach(function(a) {
            items.push({ i: 'fa-exclamation-circle', c: 'red', t: 'Garantia vencida: ' + a.nomePc, s: 'H� ' + a.dias + ' dia(s)', k: 'alerta' });
        });
        (alertas.garantiaProxima || []).forEach(function(a) {
            items.push({ i: 'fa-clock', c: 'yellow', t: 'Garantia vence: ' + a.nomePc, s: 'Em ' + a.diasRestantes + ' dia(s)', k: 'alerta' });
        });
        alertasCount = ((alertas.garantiaVencida || []).length + (alertas.garantiaProxima || []).length);
    } catch (e) {}
    var unread = alertasCount;
    try {
        var seenTs = parseInt(localStorage.getItem('notifSeen') || '0', 10) || 0;
        for (var ui = 0; ui < MOCK_LOGS.length; ui++) {
            var lts = new Date(MOCK_LOGS[ui].dataAtividade).getTime();
            if (!isNaN(lts) && lts > seenTs) unread++;
        }
    } catch (e) {}
    try {
        var logs = await apiFetch('/api/logs?page=0&size=8');
        var ll = (logs && (logs.content || logs)) || [];
        var acaoMap = { 'LOGIN': 'cyan', 'CRIACAO': 'green', 'ALTERACAO': 'yellow', 'EXCLUSAO': 'red', 'ALTERACAO_EM_MASSA': 'yellow', 'IMPORTACAO': 'green', 'EXPORTACAO': 'cyan' };
        ll.forEach(function(lg) {
            var when = '';
            try { var dt = new Date(lg.dataAtividade); when = dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); } catch (e) {}
            items.push({ i: 'fa-circle', c: acaoMap[lg.acao] || 'cyan', t: lg.descricao || lg.acao, s: (lg.usuario || '') + (when ? ' � ' + when : ''), k: 'log' });
        });
    } catch (e) {}
    try { localStorage.setItem('notifSeen', String(Date.now())); } catch (e) {}
    updateNotifBadge();

    // ---- NOTIFICACOES DE FALHAS DE MONITORAMENTO (novo) ----
    try {
        // Se houver falhas recentes conhecidas via SSE (monitoramento), adiciona notificação
        if (window._monAlertasZabbix && window._monAlertasZabbix.length > 0) {
            var ultimoAlerta = window._monAlertasZabbix[0];
            if (ultimoAlerta && ultimoAlerta.trigger) {
                items.push({ i: 'fa-triangle-exclamation', c: ultimoAlerta.status === 'PROBLEM' ? 'red' : 'green', t: (ultimoAlerta.status === 'PROBLEM' ? 'PROBLEMA: ' : 'RESOLVIDO: ') + ultimoAlerta.trigger + ' @ ' + (ultimoAlerta.host || '?'), s: ultimoAlerta.severidade || 'N/A', k: 'falha-monitor' });
                alertasCount++;
            }
        }
    } catch (e) {}

    // Notificacao de falhas recentes do historico (se o usuario abriu historico de 192.168.0.108)
    try {
        if (typeof _monDados !== 'undefined' && _monDados && _monDados.linhas) {
            var falhasHost = _monDados.linhas.filter(function(l){ return l.falhasConsecutivas > 2 || l.estado === 'SEM_RESPOSTA'; });
            if (falhasHost.length > 0) {
                var nomeHost = falhasHost[0].nome || falhasHost[0].ip;
                items.unshift({ i: 'fa-network-wired', c: 'red', t: 'Falha de conectividade: ' + nomeHost + ' (IP ' + falhasHost[0].ip + ')', s: falhasHost[0].falhasConsecutivas + ' falhas consecutivas', k: 'falha-net' });
                alertasCount++;
            }
        }
    } catch (e) {}

    var lbl = document.getElementById('notifCountLabel');
    if (lbl) lbl.textContent = unread > 99 ? '99+' : String(unread);
    if (items.length === 0) {
        listEl.innerHTML = '<div class="hdr-notif-empty"><i class="fas fa-check-circle"></i><p>Nenhuma notifica��o</p></div>';
        return;
    }
    var html = items.map(function(x) {
        return '<div class="hdr-notif-item"><div class="hdr-notif-icon hdr-notif-' + x.c + '"><i class="fas ' + x.i + '"></i></div><div class="hdr-notif-info"><p>' + escapeHtml(x.t) + '</p><span>' + escapeHtml(x.s) + '</span></div></div>';
    }).join('');
    if (unread > items.length) {
        html += '<div class="hdr-notif-item"><div class="hdr-notif-icon hdr-notif-cyan"><i class="fas fa-ellipsis-h"></i></div><div class="hdr-notif-info"><p>+' + (unread - items.length) + ' notifica��o(�es) anterior(es)</p><span>Atualize a p�gina para ver todas</span></div></div>';
    }
    listEl.innerHTML = html;
}

function showFailureNotification(title, body) {
    try {
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            new Notification(title, { body: body, icon: 'assets/logo.png', tag: 'falha-monitor-' + Date.now() });
        }
    } catch (e) {}
    if (typeof showToast === 'function') showToast(title + ': ' + body, 'error');
}
function updateNotifBadge() {
    var badge = document.getElementById('notifBadge');
    if (!badge) return;
    var seen = 0;
    try { seen = parseInt(localStorage.getItem('notifSeen') || '0', 10) || 0; } catch (e) {}
    if (!seen) {
        seen = Date.now();
        try { localStorage.setItem('notifSeen', String(seen)); } catch (e) {}
    }
    var n = 0;
    for (var i = 0; i < MOCK_LOGS.length; i++) {
        var ts = new Date(MOCK_LOGS[i].dataAtividade).getTime();
        if (!isNaN(ts) && ts > seen) n++;
    }
    function showBadge(v) {
        if (v > 0) { badge.style.display = 'flex'; badge.textContent = v > 99 ? '99+' : String(v); }
        else badge.style.display = 'none';
    }
    apiFetch('/api/computadores/alertas').then(function(a) {
        showBadge(n + ((a && a.garantiaVencida) || []).length + ((a && a.garantiaProxima) || []).length);
    }).catch(function() { showBadge(n); });
}

function setAppBg(name) {
    if (['dots', 'xbox', 'universe'].indexOf(name) === -1) name = 'dots';
    var main = document.querySelector('.main-content');
    if (main) {
        main.classList.remove('app-bg-dots', 'app-bg-xbox', 'app-bg-universe');
        main.classList.add('app-bg-' + name);
    }
    try { localStorage.setItem('appBg', name); } catch (e) {}
    updateBgOptionActive();
}

function applyAppBg() {
    var name = 'dots';
    try { name = localStorage.getItem('appBg') || 'dots'; } catch (e) {}
    setAppBg(name);
}

function updateBgOptionActive() {
    var name = 'dots';
    try { name = localStorage.getItem('appBg') || 'dots'; } catch (e) {}
    document.querySelectorAll('.bg-option').forEach(function(el) {
        el.classList.toggle('active', el.dataset.bg === name);
    });
}
function checkAuth() {
    if (!getToken()) { window.location.href = 'login.html'; return; }
    var n = localStorage.getItem('userName') || 'Usu�rio', p = getPerfil();
    var el = function(id) { return document.getElementById(id); };
    if (el('sidebarUserName')) el('sidebarUserName').textContent = n;
    if (el('sidebarUserRole')) el('sidebarUserRole').textContent = p;
    if (el('header-user-name')) el('header-user-name').textContent = n;
    var adminBtn = document.querySelector('[data-section="admin"]');
    if (adminBtn) adminBtn.style.display = (p === 'ADMIN') ? '' : 'none';
    connectWs();
}

// ==========================================
// WEBSOCKET (STOMP over SockJS)
// ==========================================
function connectWs() {
    if (_wsConnected || USE_MOCK) return;
    try {
        var ws = new SockJS('/ws');
        _wsClient = Stomp.over(ws);
        _wsClient.debug = null;
        _wsClient.connect({}, function() {
            _wsConnected = true;
            if (_wsReconnectTimer) { clearTimeout(_wsReconnectTimer); _wsReconnectTimer = null; }

            _wsClient.subscribe('/topic/computadores', function(msg) { try { handleWsEvent(JSON.parse(msg.body)); } catch(e) { console.warn('[WS] Erro parse:', e); } });
            _wsClient.subscribe('/topic/manutencoes', function(msg) { try { handleWsEvent(JSON.parse(msg.body)); } catch(e) { console.warn('[WS] Erro parse:', e); } });
            _wsClient.subscribe('/topic/ordens-servico', function(msg) { try { handleWsEvent(JSON.parse(msg.body)); } catch(e) { console.warn('[WS] Erro parse:', e); } });
            _wsClient.subscribe('/topic/checkin-checkout', function(msg) { try { handleWsEvent(JSON.parse(msg.body)); } catch(e) { console.warn('[WS] Erro parse:', e); } });
            _wsClient.subscribe('/topic/departamentos', function(msg) { try { handleWsEvent(JSON.parse(msg.body)); } catch(e) { console.warn('[WS] Erro parse:', e); } });
            _wsClient.subscribe('/topic/usuarios', function(msg) { try { handleWsEvent(JSON.parse(msg.body)); } catch(e) { console.warn('[WS] Erro parse:', e); } });
            _wsClient.subscribe('/topic/logs', function(msg) { try { handleWsEvent(JSON.parse(msg.body)); } catch(e) { console.warn('[WS] Erro parse:', e); } });
            _wsClient.subscribe('/topic/software-licencas', function(msg) { try { handleWsEvent(JSON.parse(msg.body)); } catch(e) { console.warn('[WS] Erro parse software-licencas:', e); } });
        }, function() {
            _wsConnected = false;
            console.warn('[WS] Desconectado. Reconectando em 5s...');
            scheduleReconnect();
        });
    } catch (e) {
        console.warn('[WS] Erro ao conectar:', e.message);
        scheduleReconnect();
    }
}

function disconnectWs() {
    if (_wsClient) {
        try { _wsClient.disconnect(); } catch(e) {}
        _wsClient = null;
    }
    _wsConnected = false;
    if (_wsReconnectTimer) { clearTimeout(_wsReconnectTimer); _wsReconnectTimer = null; }
}

function scheduleReconnect() {
    if (_wsReconnectTimer) return;
    _wsReconnectTimer = setTimeout(function() {
        _wsReconnectTimer = null;
        if (getToken()) connectWs();
    }, 5000);
}

function handleWsEvent(event) {
    if (!event || !event.acao) return;
    var tipo = event.tipo;
    var acao = event.acao;
    var dados = event.dados || {};
    var toastMsg = '';
    var toastType = 'info';

    if (tipo === 'COMPUTADOR') {
        if (acao === 'CRIACAO') { toastMsg = 'Novo computador: ' + (dados.nomePc || ''); toastType = 'success'; }
        else if (acao === 'ALTERACAO') { toastMsg = 'Computador atualizado por outro usuario: ' + (dados.nomePc || ''); toastType = 'info'; }
        else if (acao === 'EXCLUSAO') { toastMsg = 'Computador removido (ID: ' + (dados.id || '') + ')'; toastType = 'warning'; }
        else if (acao === 'ALTERACAO_EM_MASSA') { toastMsg = (dados.total || 0) + ' computadores atualizados em massa'; toastType = 'info'; }
        else if (acao === 'EXCLUSAO_EM_MASSA') { toastMsg = (dados.total || 0) + ' computadores exclu�dos em massa'; toastType = 'warning'; }
        else if (acao === 'IMPORTACAO') { toastMsg = (dados.total || 0) + ' computadores importados via CSV'; toastType = 'success'; }
        refreshCurrentSection(tipo);
    } else if (tipo === 'MANUTENCAO') {
        if (acao === 'CRIACAO') { toastMsg = 'Nova manuten��o criada'; toastType = 'success'; }
        else if (acao === 'ALTERACAO') { toastMsg = 'Manuten��o atualizada'; toastType = 'info'; }
        else if (acao === 'EXCLUSAO') { toastMsg = 'Manuten��o exclu�da'; toastType = 'warning'; }
        refreshCurrentSection(tipo);
    } else if (tipo === 'ORDEM_SERVICO') {
        if (acao === 'CRIACAO') { toastMsg = 'Nova OS criada: ' + (dados.titulo || ''); toastType = 'success'; }
        else if (acao === 'ALTERACAO') { toastMsg = 'OS atualizada: ' + (dados.titulo || ''); toastType = 'info'; }
        else if (acao === 'EXCLUSAO') { toastMsg = 'OS exclu�da'; toastType = 'warning'; }
        refreshCurrentSection(tipo);
    } else if (tipo === 'CHECKIN_CHECKOUT') {
        if (acao === 'CHECKOUT') { toastMsg = 'Checkout realizado'; toastType = 'info'; }
        else if (acao === 'CHECKIN') { toastMsg = 'Checkin realizado'; toastType = 'success'; }
        refreshCurrentSection(tipo);
    } else if (tipo === 'DEPARTAMENTO') {
        if (acao === 'CRIACAO') { toastMsg = 'Setor criado: ' + (dados.nome || ''); toastType = 'success'; }
        else if (acao === 'ALTERACAO') { toastMsg = 'Setor atualizado'; toastType = 'info'; }
        else if (acao === 'EXCLUSAO') { toastMsg = 'Setor exclu�do'; toastType = 'warning'; }
        refreshCurrentSection(tipo);
    } else if (tipo === 'USUARIO') {
        if (acao === 'CRIACAO') { toastMsg = 'Usu�rio criado: ' + (dados.username || ''); toastType = 'success'; }
        else if (acao === 'ALTERACAO') { toastMsg = 'Usu�rio atualizado'; toastType = 'info'; }
        else if (acao === 'EXCLUSAO') { toastMsg = 'Usu�rio exclu�do'; toastType = 'warning'; }
        refreshCurrentSection(tipo);
    } else if (tipo === 'LOG') {
        refreshCurrentSection(tipo);
    } else if (tipo === 'SOFTWARE_LICENCA') {
        if (acao === 'CRIACAO') { toastMsg = 'Software/licenca cadastrado: ' + (dados.nomeSoftware || ''); toastType = 'success'; }
        else if (acao === 'ALTERACAO') { toastMsg = 'Software/licenca atualizado'; toastType = 'info'; }
        else if (acao === 'EXCLUSAO') { toastMsg = 'Software/licenca removido'; toastType = 'warning'; }
        refreshCurrentSection(tipo);
    }

    if (toastMsg) showToast(toastMsg, toastType);
}

// ==========================================
// ==========================================
// NAVIGATION
// ==========================================
function showSection(id) {
    _currentSection = id;
    try { localStorage.setItem('currentSection', id); } catch (e) {}
    document.querySelectorAll('.section-content').forEach(function(s) { s.classList.add('hidden'); });
    var sec = document.getElementById(id);
    if (sec) sec.classList.remove('hidden');
    document.querySelectorAll('.nav-btn').forEach(function(b) { b.classList.remove('active'); if (b.dataset.section === id) b.classList.add('active'); });
    closeStatDetail(); closeKpiDetail(); closeManKpiDetail(); closeOsKpiDetail();
    document.querySelectorAll('canvas').forEach(function(c) { if (c._chart) { c._chart.destroy(); c._chart = null; } });
    var t = {
        'painel': ['Dashboard', 'Vis�o geral do sistema'],
        'computadores': ['Computadores', 'Gerenciamento de computadores'],
        'ramais': ['Ramais', 'Gerenciamento de ramais'],
        'manutencoes': ['Manutencoes', 'Controle de manutencoes'],
        'ordens-servico': ['Ordens de Servico', 'Gestao de OS'],
        'trocas': ['Troca de Equipamento', 'Historico de trocas e movimentacoes'],
        'departamentos': ['Setores', 'Gest�o de setores'],
        'software-licencas': ['Software/Licencas', 'Gestao de software e licencas'],
        'logs': ['Hist�rico', 'Hist�rico de opera��es'],
        'relatorios': ['Relat�rios', 'Relat�rio gerencial'],
        'usuarios': ['Usuarios', 'Gerenciamento de usuarios'],
        'admin': ['Ferramentas', 'Painel administrativo'],
        'monitoramento': ['Monitoramento', 'Verificacao preventiva de rede e Zabbix']
    };
    var d = t[id] || ['', ''];
    var el2 = function(x) { return document.getElementById(x); };
    if (el2('page-title')) el2('page-title').textContent = d[0];
    if (el2('page-subtitle')) el2('page-subtitle').textContent = d[1];
    switch (id) {
        case 'painel': loadDashboard(); break;
        case 'computadores': loadComputadores(0); break;
        case 'ramais': loadRamais(0); break;
        case 'manutencoes': loadManutencoes(0); break;
        case 'ordens-servico': loadOrdensServico(0); break;
        case 'trocas': loadTrocas(); break;
        case 'departamentos': loadDepartamentos(); break;
        case 'software-licencas': loadSoftwareLicencas(0); break;
        case 'logs': loadLogs(0); break;
        case 'relatorios': loadRelatorios(); break;
        case 'usuarios': loadUsuarios(); break;
        case 'admin': loadAdmin(); break;
        case 'monitoramento': if (typeof monInit === 'function') monInit(); else if (typeof monAtualizar === 'function') monAtualizar(); break;
    }
    if (window.innerWidth < 1024) { var sb = document.getElementById('sidebar'); if (sb && sb.classList.contains('open')) toggleSidebar(); }
}

function toggleSidebar() { var s = document.getElementById('sidebar'), o = document.getElementById('sidebar-overlay'); if (!s || !o) return; s.classList.toggle('open'); o.classList.toggle('open'); }

async function loadAdmin() {
    var el = document.getElementById('admin-db-info');
    var elTotal = document.getElementById('admin-total-comps');
    var elAtivos = document.getElementById('admin-ativos-comps');
    var elManut = document.getElementById('admin-manut-comps');
    var elStatComps = document.getElementById('admin-stat-comps');
    try {
        var stats = await apiFetch('/api/computadores/estatisticas');
        var total = stats.total || 0;
        var ativos = stats.ativos || 0;
        var manut = (stats.manutencaoPreditiva || 0) + (stats.manutencaoPreventiva || 0) + (stats.manutencaoEmergencial || 0);
        if (el) {
            el.innerHTML =
                '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);"><span>Servidor</span><span style="color:var(--green);font-weight:600;">Online</span></div>' +
                '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);"><span>Banco de Dados</span><span style="font-weight:600;color:var(--cyan);">H2 (arquivo)</span></div>' +
                '<div style="display:flex;justify-content:space-between;padding:6px 0;"><span>Computadores</span><span style="font-weight:600;color:var(--cyan);">' + total + '</span></div>';
        }
        if (elTotal) elTotal.textContent = total;
        if (elAtivos) elAtivos.textContent = ativos;
        if (elManut) elManut.textContent = manut;
        if (elStatComps) elStatComps.textContent = total + ' registrados';
    } catch (e) {
        if (el) el.innerHTML = '<span style="color:var(--red);">Erro ao carregar</span>';
    }
}

// ==========================================
// DASHBOARD
// ==========================================
async function loadDashboard() {
    renderSkeletonKpis(6);
    try {
        var r = await Promise.all([
            apiFetch('/api/computadores/estatisticas').catch(function() { return null; }),
            apiFetch('/api/manutencoes/estatisticas').catch(function() { return null; }),
            apiFetch('/api/ordens-servico/estatisticas').catch(function() { return null; }),
            apiFetch('/api/computadores/alertas').catch(function() { return null; }),
            apiFetch('/api/ramais').catch(function() { return []; }),
            apiFetch('/api/trocas').catch(function() { return []; }),
            apiFetch('/api/logs?page=0&size=8').catch(function() { return null; }),
            apiFetch('/api/computadores/paginado?page=0&size=8&status=&termo=').catch(function() { return null; })
        ]);
        var navTotal = document.getElementById('nav-total');
        if (navTotal && r[0]) navTotal.textContent = r[0].total || 0;
        renderDashboardKpis(r[0], r[1], r[2], r[3], r[4], r[5]);
        renderChartStatus(r[0]);
        renderDashboardManutRows(r[1]);
        renderDashboardOrdemRows(r[2]);
        renderDashboardAtividade(r[6]);
        renderDashboardCompList(r[7]);
    } catch (e) { showToast('Erro ao carregar dashboard', 'error'); }
}

function renderDashboardKpis(eq, man, os, alertas, ramais, trocas) {
    eq = eq || {}; man = man || {}; os = os || {}; alertas = alertas || {};
    ramais = ramais || []; trocas = trocas || [];
    _dashData = { eq: eq, man: man, os: os, alertas: alertas, ramais: ramais, trocas: trocas };
    var totalAlertas = (alertas.totalAlertas || 0);
    var ramaisAtivos = ramais.filter(function(r) { return (r.status || 'ATIVO') === 'ATIVO'; }).length;
    var k = [
        { i: 'fa-desktop', l: 'Total Computadores', v: eq.total || 0, c: 'cyan', t: 'TOTAL', key: 'dsh-eq-total' },
        { i: 'fa-bolt', l: 'Ativos', v: eq.ativos || 0, c: 'green', t: 'ATIVOS', key: 'dsh-eq-ativos' },
        { i: 'fa-tools', l: 'Em Manutencao', v: (eq.manutencaoPreditiva || 0) + (eq.manutencaoPreventiva || 0) + (eq.manutencaoEmergencial || 0), c: 'yellow', t: 'MANUTENCAO', key: 'dsh-eq-manut' },
        { i: 'fa-phone-alt', l: 'Ramais Ativos', v: ramaisAtivos, c: 'cyan', t: 'RAMAIS', key: 'dsh-ramais' },
        { i: 'fa-clipboard-list', l: 'OS Abertas', v: (os.abertas || 0) + (os.emAnalise || 0), c: 'orange', t: 'OS ABERTAS', key: 'dsh-os-abertas' },
        { i: 'fa-exclamation-triangle', l: 'Alertas', v: totalAlertas, c: 'red', t: 'ALERTAS', key: 'dsh-alertas' }
    ];
    var dkEl = document.getElementById('dashboardKpis');
    if (dkEl) dkEl.innerHTML = k.map(function(x) {
        return '<div class="kpi-card kpi-card-' + x.c + '" onclick="toggleKpiDetail(\'' + x.key + '\')" data-key="' + x.key + '">' +
            '<div class="kpi-header"><span class="kpi-tag kpi-tag-' + x.c + '">' + x.t + '</span><div class="kpi-icon kpi-icon-' + x.c + '"><i class="fas ' + x.i + '"></i></div></div>' +
            '<p class="kpi-value">' + x.v + '</p>' +
            '<div class="kpi-bar kpi-bar-' + x.c + '"></div>' +
            '<p class="kpi-label">' + x.l + '</p></div>';
    }).join('');
    var navRamais = document.getElementById('nav-ramais-total');
    if (navRamais) navRamais.textContent = ramais.length || 0;
}

function toggleKpiDetail(key) {
    if (_activeKpiKey === key) { closeKpiDetail(); return; }
    closeKpiDetail();
    _activeKpiKey = key;
    document.querySelectorAll('.kpi-card').forEach(function(el) { el.classList.toggle('active', el.dataset.key === key); });
    renderKpiDetailPanel(key);
}

function closeKpiDetail() {
    _activeKpiKey = null;
    document.querySelectorAll('.kpi-card').forEach(function(el) { el.classList.remove('active'); });
    var ov = document.getElementById('sdOverlay-kpi'); if (ov) ov.remove();
    var ct = document.getElementById('sdContainer-kpi'); if (ct) ct.remove();
}

function renderKpiDetailPanel(key) {
    var container = document.getElementById('kpiDetail');
    if (!container) return;
    var title = '', icon = '', color = '';
    var sm = { 'ATIVO': { c: 'badge-ativo', i: 'fa-check-circle' }, 'MANUTENCAO_PREDITIVA': { c: 'badge-preditiva', i: 'fa-search' }, 'MANUTENCAO_PREVENTIVA': { c: 'badge-preventiva', i: 'fa-shield-alt' }, 'MANUTENCAO_EMERGENCIAL': { c: 'badge-emergencial', i: 'fa-exclamation-triangle' }, 'CONCLUIDO': { c: 'badge-concluido', i: 'fa-check-double' } };

    if (key === 'dsh-eq-total') {
        title = 'Todos os Computadores'; icon = 'fa-desktop'; color = 'cyan';
        apiFetch('/api/computadores/paginado?page=0&size=1000&status=&termo=').then(function(d) {
            var list = d.content || d || [];
            renderKpiDetailHTML(container, title, icon, color, list.map(function(eq) {
                var s = sm[eq.status || 'ATIVO'] || { c: 'badge-inativo', i: 'fa-circle' };
                var sl = escapeHtml((eq.status || 'ATIVO').replace('MANUTENCAO_', 'Man. ').replace(/_/g, ' '));
                return '<div class="stat-detail-item" onclick="showComputadorDetail(' + eq.id + ')"><div class="stat-detail-item-icon" style="background:var(--cyan-bg);color:var(--cyan);"><i class="fas fa-desktop"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">' + escapeHtml(eq.nomePc) + '</div><div class="stat-detail-item-sub">' + escapeHtml(eq.modeloMarca) + ' - ' + escapeHtml(eq.usuarioDesignado || '') + '</div></div><div class="stat-detail-item-badge"><span class="badge ' + s.c + '">' + sl + '</span></div></div>';
            }).join(''));
        });
    } else if (key === 'dsh-eq-ativos') {
        title = 'Computadores Ativos'; icon = 'fa-check-circle'; color = 'green';
        apiFetch('/api/computadores/paginado?page=0&size=1000&status=ATIVO&termo=').then(function(d) {
            var list = d.content || d || [];
            renderKpiDetailHTML(container, title, icon, color, list.map(function(eq) {
                return '<div class="stat-detail-item" onclick="showComputadorDetail(' + eq.id + ')"><div class="stat-detail-item-icon" style="background:var(--green-bg);color:var(--green);"><i class="fas fa-check-circle"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">' + escapeHtml(eq.nomePc) + '</div><div class="stat-detail-item-sub">' + escapeHtml(eq.modeloMarca) + ' - ' + escapeHtml(eq.usuarioDesignado || '') + '</div></div><div class="stat-detail-item-badge"><span class="badge badge-ativo">Ativo</span></div></div>';
            }).join(''));
        });
    } else if (key === 'dsh-eq-manut') {
        title = 'Computadores em Manuten��o'; icon = 'fa-wrench'; color = 'yellow';
        Promise.all([
            apiFetch('/api/computadores/paginado?page=0&size=1000&status=MANUTENCAO_PREDITIVA&termo='),
            apiFetch('/api/computadores/paginado?page=0&size=1000&status=MANUTENCAO_PREVENTIVA&termo='),
            apiFetch('/api/computadores/paginado?page=0&size=1000&status=MANUTENCAO_EMERGENCIAL&termo=')
        ]).then(function(results) {
            var list = [];
            results.forEach(function(d) { list = list.concat(d.content || d || []); });
            list.sort(function(a, b) { return a.id - b.id; });
            renderKpiDetailHTML(container, title, icon, color, list.map(function(eq) {
                var s = sm[eq.status || 'ATIVO'] || { c: 'badge-inativo', i: 'fa-circle' };
                var sl = escapeHtml((eq.status || 'ATIVO').replace('MANUTENCAO_', 'Man. ').replace(/_/g, ' '));
                return '<div class="stat-detail-item" onclick="showComputadorDetail(' + eq.id + ')"><div class="stat-detail-item-icon" style="background:var(--yellow-bg);color:var(--yellow);"><i class="fas fa-wrench"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">' + escapeHtml(eq.nomePc) + '</div><div class="stat-detail-item-sub">' + escapeHtml(eq.modeloMarca) + ' - ' + escapeHtml(eq.usuarioDesignado || '') + '</div></div><div class="stat-detail-item-badge"><span class="badge ' + s.c + '">' + sl + '</span></div></div>';
            }).join(''));
        });
    } else if (key === 'dsh-os-abertas') {
        title = 'OS Abertas'; icon = 'fa-clipboard-list'; color = 'orange';
        Promise.all([
            apiFetch('/api/ordens-servico?page=0&size=100&status=ABERTA'),
            apiFetch('/api/ordens-servico?page=0&size=100&status=EM_ANALISE')
        ]).then(function(results) {
            var list = [];
            results.forEach(function(d) { list = list.concat(d.content || d || []); });
            renderKpiDetailHTML(container, title, icon, color, list.map(function(o) {
                return '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--orange-bg);color:var(--orange);"><i class="fas fa-clipboard-list"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">' + escapeHtml(o.titulo) + '</div><div class="stat-detail-item-sub">' + escapeHtml(o.computadorNome || 'Sem v�nculo') + ' - ' + escapeHtml(o.solicitante || '') + '</div></div><div class="stat-detail-item-badge"><span class="badge badge-pendente">' + escapeHtml((o.status || 'ABERTA').replace(/_/g, ' ')) + '</span></div></div>';
            }).join(''));
        });
    } else if (key === 'dsh-ramais') {
        title = 'Ramais Ativos'; icon = 'fa-phone-alt'; color = 'cyan';
        apiFetch('/api/ramais').then(function(list) {
            var ramais = (Array.isArray(list) ? list : []).filter(function(r) { return (r.status || 'ATIVO') === 'ATIVO'; });
            renderKpiDetailHTML(container, title, icon, color, ramais.map(function(r) {
                return '<div class="stat-detail-item" onclick="showRamalDetail(' + r.id + ')"><div class="stat-detail-item-icon" style="background:var(--cyan-bg);color:var(--cyan);"><i class="fas fa-phone-alt"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">' + escapeHtml(r.numeroRamal) + '</div><div class="stat-detail-item-sub">' + escapeHtml(r.setor || '') + ' - ' + escapeHtml(r.descricao || '') + '</div></div><div class="stat-detail-item-badge"><span class="badge badge-ativo">Ativo</span></div></div>';
            }).join(''));
        });
    } else if (key === 'dsh-trocas') {
        title = 'Trocas Registradas'; icon = 'fa-exchange-alt'; color = 'yellow';
        apiFetch('/api/trocas').then(function(list) {
            var trocas = Array.isArray(list) ? list : [];
            renderKpiDetailHTML(container, title, icon, color, trocas.map(function(t) {
                return '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--yellow-bg);color:var(--yellow);"><i class="fas fa-exchange-alt"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">' + escapeHtml(t.equipamentoNome || '-') + '</div><div class="stat-detail-item-sub">' + escapeHtml(t.tipoMovimento || '') + ' - ' + escapeHtml(t.responsavel || '') + '</div></div><div class="stat-detail-item-badge"><span class="badge badge-' + escapeHtml((t.tipoMovimento || '').toLowerCase()) + '">' + escapeHtml(t.tipoMovimento || '-') + '</span></div></div>';
            }).join(''));
        });
    } else if (key === 'dsh-alertas') {
        title = 'Alertas Ativos'; icon = 'fa-exclamation-triangle'; color = 'red';
        apiFetch('/api/computadores/alertas').then(function(alertas) {
            var a = alertas || {};
            var items = [].concat((a.garantiaVencida || []).map(function(x) { return { nome: x.nomePc, msg: 'Garantia vencida ha ' + x.dias + ' dias', icon: 'fa-shield-alt' }; }), (a.garantiaProxima || []).map(function(x) { return { nome: x.nomePc, msg: 'Garantia vence em ' + x.diasRestantes + ' dias', icon: 'fa-clock' }; }));
            renderKpiDetailHTML(container, title, icon, color, items.length === 0 ? '<div class="stat-detail-empty"><i class="fas fa-check-circle"></i> Nenhum alerta ativo</div>' : items.map(function(x) {
                return '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--red-bg);color:var(--red);"><i class="fas ' + x.icon + '"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">' + escapeHtml(x.nome) + '</div><div class="stat-detail-item-sub">' + escapeHtml(x.msg) + '</div></div></div>';
            }).join(''));
        });
    } else {
        var detailMap = {
            'dsh-eq-concluidos': { title: 'Computadores Conclu�dos', icon: 'fa-check-circle', color: 'green', filter: 'CONCLUIDO' },
            'dsh-man-vencida': { title: 'Manuten��es Vencidas', icon: 'fa-exclamation-triangle', color: 'red' },
            'dsh-garantia': { title: 'Garantia Vencida', icon: 'fa-shield-alt', color: 'red' }
        };
        var cfg = detailMap[key];
        if (cfg) {
            title = cfg.title; icon = cfg.icon; color = cfg.color;
            if (cfg.filter) {
                apiFetch('/api/computadores/paginado?page=0&size=1000&status=' + cfg.filter + '&termo=').then(function(d) {
                    var list = d.content || d || [];
                    renderKpiDetailHTML(container, title, icon, color, list.map(function(eq) {
                        var s = sm[eq.status || 'ATIVO'] || { c: 'badge-inativo', i: 'fa-circle' };
                        var sl = escapeHtml((eq.status || 'ATIVO').replace('MANUTENCAO_', 'Man. ').replace(/_/g, ' '));
                        return '<div class="stat-detail-item" onclick="showComputadorDetail(' + eq.id + ')"><div class="stat-detail-item-icon" style="background:var(--red-bg);color:var(--red);"><i class="fas fa-check-circle"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">' + escapeHtml(eq.nomePc) + '</div><div class="stat-detail-item-sub">' + escapeHtml(eq.modeloMarca) + '</div></div><div class="stat-detail-item-badge"><span class="badge ' + s.c + '">' + sl + '</span></div></div>';
                    }).join(''));
                });
            } else if (key === 'dsh-man-vencida') {
                apiFetch('/api/computadores/manutencao-vencida').then(function(list) {
                    renderKpiDetailHTML(container, title, icon, color, list.map(function(eq) {
                        var s = sm[eq.status || 'ATIVO'] || { c: 'badge-inativo', i: 'fa-circle' };
                        var sl = escapeHtml((eq.status || 'ATIVO').replace(/_/g, ' '));
                        var atrasoDias = eq.diasRestantes !== null && eq.diasRestantes !== undefined ? Math.abs(eq.diasRestantes) : '?';
                        return '<div class="stat-detail-item" onclick="showComputadorDetail(' + eq.id + ')"><div class="stat-detail-item-icon" style="background:var(--red-bg);color:var(--red);"><i class="fas fa-exclamation-triangle"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">' + escapeHtml(eq.nomePc) + '</div><div class="stat-detail-item-sub">' + escapeHtml(eq.modeloMarca) + ' - Atrasado ha ' + atrasoDias + ' dias</div></div><div class="stat-detail-item-badge"><span class="badge badge-emergencial">' + sl + '</span></div></div>';
                    }).join(''));
                });
            } else if (key === 'dsh-eq-atraso') {
                title = 'Computadores com Ciclo Atrasado'; icon = 'fa-clock'; color = 'red';
                apiFetch('/api/computadores/manutencao-vencida').then(function(list) {
                    renderKpiDetailHTML(container, title, icon, color, list.map(function(eq) {
                        var atrasoDias = eq.diasRestantes !== null && eq.diasRestantes !== undefined ? Math.abs(eq.diasRestantes) : '?';
                        return '<div class="stat-detail-item" onclick="showComputadorDetail(' + eq.id + ')"><div class="stat-detail-item-icon" style="background:var(--red-bg);color:var(--red);"><i class="fas fa-clock"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">' + escapeHtml(eq.nomePc) + '</div><div class="stat-detail-item-sub">' + escapeHtml(eq.modeloMarca) + ' - ' + atrasoDias + ' dias de atraso</div></div><div class="stat-detail-item-badge"><span class="badge badge-emergencial">Atrasado</span></div></div>';
                    }).join(''));
                });
            } else if (key === 'dsh-garantia') {
                var alertas2 = _dashData.alertas || {};
                var vencidas = alertas2.garantiaVencida || [];
                renderKpiDetailHTML(container, title, icon, color, vencidas.map(function(a) {
                    return '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--red-bg);color:var(--red);"><i class="fas fa-exclamation-triangle"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">' + escapeHtml(a.nomePc) + '</div><div class="stat-detail-item-sub">Vencida h� ' + a.dias + ' dias</div></div></div>';
                }).join(''));
            } else {
                renderKpiDetailHTML(container, title, icon, color, '');
            }
        }
    }
}

function renderKpiDetailHTML(container, title, icon, color, itemsHtml) {
    if (!itemsHtml) itemsHtml = '<div class="stat-detail-empty"><i class="fas fa-inbox"></i> Nenhum item encontrado</div>';
    var count = (itemsHtml.match(/class="stat-detail-item"/g) || []).length;
    var ov = document.createElement('div'); ov.id = 'sdOverlay-kpi'; ov.className = 'sd-overlay';
    var ct = document.createElement('div'); ct.id = 'sdContainer-kpi'; ct.className = 'sd-container';
    ct.innerHTML = '<div class="stat-detail-header"><h4><i class="fas ' + icon + '" style="color:var(--' + color + ');"></i> ' + title + ' <span style="font-weight:400;font-size:11px;color:var(--text-muted);">(' + count + ' itens)</span></h4><button class="stat-detail-close" onclick="closeKpiDetail()"><i class="fas fa-times"></i> Fechar</button></div><div class="stat-detail-body">' + itemsHtml + '</div>';
    document.body.appendChild(ov); document.body.appendChild(ct);
}

function renderChartStatus(s) {
    var ctx = document.getElementById('chartStatus'); if (!ctx) return; if (ctx._chart) ctx._chart.destroy();
    var d = (s && s.porStatus) || {}, lb = Object.keys(d), vl = Object.values(d);
    var colorMap = { 'ATIVO': '#2fd08e', 'MANUTENCAO_PREDITIVA': '#ffe600', 'MANUTENCAO_PREVENTIVA': '#00e5c7', 'MANUTENCAO_EMERGENCIAL': '#ff9f43', 'CONCLUIDO': '#b24dff', 'INATIVO': '#ff4757' };
    var fallback = ['#2fd08e', '#ffe600', '#00e5c7', '#ff9f43', '#b24dff', '#ff4757'];
    var cg = lb.map(function(k, i) { return colorMap[k] || fallback[i % fallback.length]; });
    var pretty = lb.map(function(k) { return k.replace('MANUTENCAO_', 'Man. ').replace(/_/g, ' '); });
    ctx._chart = new Chart(ctx, { type: 'doughnut', data: { labels: pretty, datasets: [{ data: vl, backgroundColor: cg, borderWidth: 0, hoverOffset: 8 }] }, options: { responsive: true, maintainAspectRatio: false, cutout: '72%', layout: { padding: 6 }, plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(10,16,32,0.95)', titleColor: '#00e5c7', bodyColor: '#e4e8f1', borderColor: 'rgba(0,229,199,0.25)', borderWidth: 1, cornerRadius: 8, padding: 10, displayColors: true, boxPadding: 4 } } } });
    var total = vl.reduce(function(a, b) { return a + b; }, 0);
    var tot = document.getElementById('dshDonutTotal'); if (tot) tot.textContent = total;
    var leg = document.getElementById('chartStatusLegend');
    if (leg) {
        if (pretty.length === 0) { leg.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">Sem dados</p>'; return; }
        leg.innerHTML = pretty.map(function(l, i) {
            return '<div class="dsh-count-item"><span class="dsh-count-dot" style="background:' + cg[i] + ';"></span><span class="dsh-count-name">' + escapeHtml(l) + '</span><b>' + vl[i] + '</b></div>';
        }).join('');
    }
}

function dshRowHtml(label, value, color) {
    return '<div class="dsh-row dsh-row-' + color + '"><span class="dsh-row-dot"></span><span class="dsh-row-name">' + escapeHtml(label) + '</span><b>' + value + '</b></div>';
}

function renderDashboardManutRows(man) {
    var el = document.getElementById('dashboardManutRows'); if (!el) return;
    man = man || {};
    var pt = man.porTipo || {};
    el.innerHTML = dshRowHtml('Corretiva', pt.CORRETIVA || 0, 'red')
        + dshRowHtml('Preventiva', pt.PREVENTIVA || 0, 'cyan')
        + dshRowHtml('Preditiva', pt.PREDITIVA || 0, 'yellow')
        + dshRowHtml('Emergencial', pt.EMERGENCIAL || 0, 'orange');
}

function renderDashboardOrdemRows(os) {
    var el = document.getElementById('dashboardOrdemRows'); if (!el) return;
    os = os || {};
    var pp = os.porPrioridade || {};
    el.innerHTML = dshRowHtml('Critica', pp.CRITICA || 0, 'red')
        + dshRowHtml('Alta', pp.ALTA || 0, 'orange')
        + dshRowHtml('Media', pp.MEDIA || 0, 'yellow')
        + dshRowHtml('Baixa', pp.BAIXA || 0, 'green');
}

function renderDashboardAtividade(d) {
    var el = document.getElementById('dashboardAtividade'); if (!el) return;
    var list = (d && (d.content || d)) || [];
    if (list.length === 0) {
        el.innerHTML = '<div class="empty-state" style="padding:24px;"><i class="fas fa-history"></i><p>Nenhuma atividade recente</p></div>';
        return;
    }
    var acaoMap = { 'LOGIN': ['cyan', 'Login'], 'CRIACAO': ['green', 'Criacao'], 'ALTERACAO': ['yellow', 'Alteracao'], 'ALTERACAO_EM_MASSA': ['yellow', 'Alteracao'], 'IMPORTACAO': ['green', 'Importacao'], 'EXPORTACAO': ['cyan', 'Exportacao'], 'EXCLUSAO': ['red', 'Exclusao'] };
    el.innerHTML = '<table class="dsh-table"><thead><tr><th>Atividade</th><th>Usuario</th><th>Quando</th></tr></thead><tbody>' +
        list.slice(0, 8).map(function(lg) {
            var a = acaoMap[lg.acao] || ['cyan', lg.acao || '-'];
            var when = '';
            try { var dt = new Date(lg.dataAtividade); when = dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); } catch (e) { when = '-'; }
            return '<tr><td><span class="dsh-acao-dot" style="background:var(--' + a[0] + ');"></span> ' + escapeHtml(lg.descricao || a[1]) + '</td><td>' + escapeHtml(lg.usuario || '-') + '</td><td class="dsh-td-muted">' + when + '</td></tr>';
        }).join('') + '</tbody></table>';
}

function renderDashboardCompList(d) {
    var el = document.getElementById('dashboardCompList'); if (!el) return;
    var list = (d && (d.content || d)) || [];
    if (list.length === 0) {
        el.innerHTML = '<div class="empty-state" style="padding:24px;"><i class="fas fa-desktop"></i><p>Nenhum computador cadastrado</p></div>';
        return;
    }
    var sm = { 'ATIVO': ['badge-ativo', 'Ativo'], 'MANUTENCAO_PREDITIVA': ['badge-preditiva', 'Man. Preditiva'], 'MANUTENCAO_PREVENTIVA': ['badge-preventiva', 'Man. Preventiva'], 'MANUTENCAO_EMERGENCIAL': ['badge-emergencial', 'Man. Emergencial'], 'CONCLUIDO': ['badge-concluido', 'Concluido'] };
    el.innerHTML = '<table class="dsh-table"><thead><tr><th>Computador</th><th>Responsavel</th><th>Status</th></tr></thead><tbody>' +
        list.map(function(eq) {
            var s = sm[eq.status || 'ATIVO'] || ['badge-inativo', 'Inativo'];
            return '<tr class="dsh-tr-click" onclick="showComputadorDetail(' + eq.id + ')"><td>' + escapeHtml(eq.nomePc) + '</td><td class="dsh-td-muted">' + escapeHtml(eq.usuarioDesignado || '-') + '</td><td><span class="badge ' + s[0] + '">' + s[1] + '</span></td></tr>';
        }).join('') + '</tbody></table>';
}

function chartPalette(n) {
    var cols = [];
    for (var i = 0; i < n; i++) {
        cols.push('hsl(' + Math.round((i * 360) / Math.max(n, 1)) + ', 72%, 55%)');
    }
    return cols;
}

function renderChartRamais(ramais) {
    ramais = ramais || [];
    var setorCount = {};
    ramais.forEach(function(r) {
        var s = r.setor || 'Sem Setor';
        setorCount[s] = (setorCount[s] || 0) + 1;
    });
    var labels = Object.keys(setorCount).sort(function(a, b) { return setorCount[b] - setorCount[a]; });
    var values = labels.map(function(l) { return setorCount[l]; });
    var colors = chartPalette(labels.length);
    var ctx = document.getElementById('chartRamais');
    if (!ctx) return;
    if (ctx._chart) ctx._chart.destroy();
    var legendEl = document.getElementById('chartRamaisLegend');
    if (labels.length > 0) {
        ctx._chart = new Chart(ctx, {
            type: 'doughnut',
            data: { labels: labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 0 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
        });
        if (legendEl) {
            legendEl.innerHTML = labels.map(function(l, i) {
                return '<span class="chart-legend-item"><span class="chart-legend-dot" style="background:' + colors[i] + ';"></span>' + escapeHtml(l) + ' <span class="chart-legend-count">' + values[i] + '</span></span>';
            }).join('');
        }
    } else if (legendEl) {
        legendEl.innerHTML = '';
    }
}

// ==========================================
// COMPUTERS
// ==========================================
async function loadComputadores(page) {
    if (page !== undefined) currentPage.computadores = page;
    renderSkeletonCards(6);
    var s = (document.getElementById('busca-input') || {}).value || '', st = (document.getElementById('filtro-status') || {}).value || '';
    try {
        var d = await apiFetch('/api/computadores/paginado?page=' + currentPage.computadores + '&size=12&status=' + st + '&termo=' + encodeURIComponent(s));
        // pagina fora do intervalo (ex.: registros foram excluidos): volta pra pagina 1
        if (d && d.totalElements > 0 && (!d.content || d.content.length === 0) && (currentPage.computadores || 0) > 0) return loadComputadores(0);
        renderComputadoresCards(d);
    } catch (e) {
        var grid = document.getElementById('pc-cards-grid');
        if (grid) grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><i class="fas fa-inbox"></i><p>Nenhum computador encontrado</p></div>';
    }
}

function renderComputadoresCards(data) {
    var grid = document.getElementById('pc-cards-grid');
    var navTotal = document.getElementById('nav-total');
    if (navTotal) navTotal.textContent = data.totalGeral !== undefined ? data.totalGeral : (data.totalElements || 0);
    if (!grid) return;
    if (!data.content || data.content.length === 0) {
        grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><i class="fas fa-inbox"></i><p>Nenhum computador encontrado</p></div>';
        var cp = document.getElementById('cards-pagination'); if (cp) cp.innerHTML = '';
        return;
    }
    var sm = { 'ATIVO': { c: 'badge-ativo', i: 'fa-check-circle' }, 'MANUTENCAO_PREDITIVA': { c: 'badge-preditiva', i: 'fa-search' }, 'MANUTENCAO_PREVENTIVA': { c: 'badge-preventiva', i: 'fa-shield-alt' }, 'MANUTENCAO_EMERGENCIAL': { c: 'badge-emergencial', i: 'fa-exclamation-triangle' }, 'CONCLUIDO': { c: 'badge-concluido', i: 'fa-check-double' } };
    grid.innerHTML = data.content.map(function(eq) {
        var isSelected = selectedComputadores.has(eq.id);
        var s = sm[eq.status || 'ATIVO'] || { c: 'badge-inativo', i: 'fa-circle' }, sl = escapeHtml((eq.status || 'ATIVO').replace('MANUTENCAO_', 'Man. ').replace(/_/g, ' '));
        var admin = getPerfil() === 'ADMIN' ? '<button onclick="event.stopPropagation();confirmDelete(\'computador\',' + eq.id + ',\'' + escapeJsStr(eq.nomePc) + '\')" class="action-btn action-btn-delete" title="Excluir"><i class="fas fa-trash"></i></button>' : '';
        var checkHtml = getPerfil() === 'ADMIN' ? '<input type="checkbox" class="bulk-check" ' + (isSelected ? 'checked' : '') + ' onclick="event.stopPropagation();toggleSelection(' + eq.id + ',this.checked)" title="Selecionar">' : '';
        var cicloHtml = '';
        if (eq.diasDesdeInicioCiclo !== null && eq.diasDesdeInicioCiclo !== undefined) {
            var pct = Math.min(100, Math.max(0, (eq.diasDesdeInicioCiclo / 240) * 100));
            var corCiclo = pct < 50 ? 'var(--green)' : pct < 75 ? 'var(--yellow)' : 'var(--red)';
            var cicloTexto = eq.diasRestantes > 0 ? eq.diasRestantes + 'd restantes' : eq.diasRestantes === 0 ? 'Vence hoje' : Math.abs(eq.diasRestantes) + 'd atrasado';
            var faseLabel = { 'ATIVO': 'Ativo', 'PREDITIVO': 'Preditivo', 'PREVENTIVO': 'Preventivo', 'ATRASADO': 'Atrasado' };
            cicloHtml = '<div class="pc-card-ciclo"><div class="ciclo-bar"><div class="ciclo-fill" style="width:' + pct + '%;background:' + corCiclo + ';"></div></div><div class="ciclo-info"><span class="ciclo-fase" style="color:' + corCiclo + ';">' + (faseLabel[eq.faseCiclo] || eq.faseCiclo) + '</span><span class="ciclo-dias">' + cicloTexto + '</span></div></div>';
        }
        return '<div class="pc-card' + (isSelected ? ' selected' : '') + (eq.faseCiclo === 'ATRASADO' ? ' pc-card-atrasado' : '') + '" onclick="showComputadorDetail(' + eq.id + ')">' + checkHtml + '<div class="pc-card-foto">' + getComputerPhoto(eq, { w: 320, h: 220 }) + '<div class="pc-card-status-bar"><span class="badge ' + s.c + '"><i class="fas ' + s.i + '" style="font-size:9px;"></i> ' + sl + '</span></div></div><div class="pc-card-body"><div class="pc-card-name">' + escapeHtml(eq.nomePc) + '</div><div class="pc-card-model">' + escapeHtml(eq.modeloMarca) + '</div>' + (eq.departamento ? '<div class="pc-card-dept"><i class="fas fa-sitemap"></i> ' + escapeHtml(eq.departamento) + '</div>' : '') + '<div class="pc-card-specs"><span class="pc-card-spec">' + escapeHtml(eq.processador) + '</span><span class="pc-card-spec">' + escapeHtml(eq.memoriaRam) + '</span><span class="pc-card-spec">' + escapeHtml(eq.armazenamento) + '</span></div>' + cicloHtml + '<div class="pc-card-footer"><span class="pc-card-user"><i class="fas fa-user"></i> ' + escapeHtml(eq.usuarioDesignado || 'Sem usuario') + '</span><div class="pc-card-actions" onclick="event.stopPropagation()"><button onclick="event.stopPropagation();showComputadorForm(' + eq.id + ')" class="action-btn action-btn-edit" title="Editar"><i class="fas fa-pen"></i></button>' + admin + '</div></div></div></div>';
    }).join('');
    renderPagination('cards-pagination', data.totalPages, data.page !== undefined ? data.page : data.number, loadComputadores);
}

async function showComputadorDetail(id) {
    try {
        var eq = await apiFetch('/api/computadores/' + id);
        var sm = { 'ATIVO': { c: 'badge-ativo', i: 'fa-check-circle' }, 'MANUTENCAO_PREDITIVA': { c: 'badge-preditiva', i: 'fa-search' }, 'MANUTENCAO_PREVENTIVA': { c: 'badge-preventiva', i: 'fa-shield-alt' }, 'MANUTENCAO_EMERGENCIAL': { c: 'badge-emergencial', i: 'fa-exclamation-triangle' }, 'CONCLUIDO': { c: 'badge-concluido', i: 'fa-check-double' } };
        var s = sm[eq.status || 'ATIVO'] || { c: 'badge-inativo', i: 'fa-circle' }, sl = escapeHtml((eq.status || 'ATIVO').replace('MANUTENCAO_', 'Man. ').replace(/_/g, ' '));
        var fotoHtml = '<div class="detail-foto" style="overflow:hidden;width:200px;height:200px;border-radius:12px;flex-shrink:0;">' + getComputerPhoto(eq, { w: 200, h: 200 }) + '</div>';
        var manutHtml = '';
        try {
            var manutData = await apiFetch('/api/manutencoes?computadorId=' + id + '&page=0&size=100');
            var manutList = manutData.content || manutData;
            if (manutList.length > 0) {
                manutHtml = '<div style="margin-top:20px;"><h4 style="font-size:13px;color:var(--text-secondary);margin-bottom:10px;"><i class="fas fa-wrench" style="color:var(--primary-light);margin-right:6px;"></i>Hist�rico de Manuten��o</h4>';
                manutList.forEach(function(m) {
                    var ms = escapeHtml((m.status || 'PENDENTE').replace(/_/g, ' '));
                    manutHtml += '<div style="padding:10px;background:rgba(255,255,255,0.02);border:1px solid var(--border);border-radius:8px;margin-bottom:8px;"><div style="display:flex;justify-content:space-between;align-items:center;"><span class="badge badge-' + escapeHtml((m.tipo || 'PREVENTIVA').toLowerCase()) + '">' + escapeHtml(m.tipo) + '</span><span class="badge badge-' + escapeHtml((m.status || 'PENDENTE').toLowerCase().replace(/_/g, '-')) + '">' + ms + '</span></div><p style="font-size:12px;color:var(--text-secondary);margin-top:6px;">' + escapeHtml(m.descricao || '') + '</p>' + (m.tecnicoResponsavel ? '<p style="font-size:11px;color:var(--text-muted);margin-top:4px;"><i class="fas fa-user"></i> ' + escapeHtml(m.tecnicoResponsavel) + '</p>' : '') + '</div>';
                });
                manutHtml += '</div>';
            }
        } catch (e) { }
        var extraHtml = '';
        var extraItems = [];
        if (eq.departamento) extraItems.push(['Setor', escapeHtml(eq.departamento)]);
        if (eq.localizacao) extraItems.push(['Localiza��o', escapeHtml(eq.localizacao)]);
        if (eq.fornecedor) extraItems.push(['Fornecedor', escapeHtml(eq.fornecedor)]);
        if (eq.ipAddress) extraItems.push(['Endere�o IP', escapeHtml(eq.ipAddress)]);
        if (eq.sistemaOperacional) extraItems.push(['Sistema Operacional', escapeHtml(eq.sistemaOperacional)]);
        if (eq.softwareInstalado) extraItems.push(['Software Instalado', escapeHtml(eq.softwareInstalado)]);
        if (eq.dataAquisicao) extraItems.push(['Data Aquisi��o', new Date(eq.dataAquisicao + 'T00:00:00').toLocaleDateString('pt-BR')]);
        if (eq.dataGarantia) {
            var garDate = new Date(eq.dataGarantia + 'T00:00:00');
            var garLabel = garDate.toLocaleDateString('pt-BR');
            var garStatus = garDate > new Date() ? '<span style="color:var(--green);font-size:11px;">(Ativa)</span>' : '<span style="color:var(--red);font-size:11px;">(Vencida)</span>';
            extraItems.push(['Garantia', garLabel + ' ' + garStatus]);
        }
        if (eq.notas) extraItems.push(['Notas', escapeHtml(eq.notas)]);
        if (eq.diasDesdeInicioCiclo !== null && eq.diasDesdeInicioCiclo !== undefined) {
            var pct = Math.min(100, Math.max(0, (eq.diasDesdeInicioCiclo / 240) * 100));
            var corCiclo = pct < 50 ? 'var(--green)' : pct < 75 ? 'var(--yellow)' : 'var(--red)';
            var faseLabel = { 'ATIVO': 'Ativo (0-4m)', 'PREDITIVO': 'Preditivo (5-6m)', 'PREVENTIVO': 'Preventivo (7-8m)', 'ATRASADO': 'Atrasado (8m+)' };
            var cicloInfo = '<div style="margin-top:4px;"><div style="height:8px;background:rgba(255,255,255,0.05);border-radius:4px;overflow:hidden;"><div style="height:100%;width:' + pct + '%;background:' + corCiclo + ';border-radius:4px;transition:width 0.3s;"></div></div><div style="display:flex;justify-content:space-between;margin-top:6px;font-size:11px;"><span style="color:' + corCiclo + ';font-weight:600;">' + (faseLabel[eq.faseCiclo] || eq.faseCiclo) + '</span><span style="color:var(--text-muted);">' + eq.diasDesdeInicioCiclo + ' dias / 240 dias</span></div><div style="font-size:11px;color:' + (eq.diasRestantes > 0 ? 'var(--text-muted)' : 'var(--red)') + ';margin-top:2px;">' + (eq.diasRestantes > 0 ? eq.diasRestantes + ' dias restantes' : 'Atrasado ha ' + Math.abs(eq.diasRestantes) + ' dias') + '</div></div>';
            extraItems.push(['Ciclo Manutencao (8 meses)', cicloInfo]);
        }
        if (extraItems.length > 0) {
            extraHtml = '<div style="margin-top:20px;"><h4 style="font-size:13px;color:var(--text-secondary);margin-bottom:10px;"><i class="fas fa-info-circle" style="color:var(--primary-light);margin-right:6px;"></i>Detalhes Adicionais</h4><div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">';
            extraItems.forEach(function(item) { extraHtml += '<div><label style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">' + escapeHtml(item[0]) + '</label><p style="font-size:13px;color:var(--text-primary);font-weight:500;margin-top:2px;">' + item[1] + '</p></div>'; });
            extraHtml += '</div></div>';
        }
        openModal('Detalhes do Computador', '<div class="detail-header">' + fotoHtml + '<div class="detail-info"><h2>' + escapeHtml(eq.nomePc) + '</h2><p>' + escapeHtml(eq.modeloMarca) + ' &mdash; ' + escapeHtml(eq.numeroSerie) + '</p><span class="badge ' + s.c + '"><i class="fas ' + s.i + '" style="font-size:9px;"></i> ' + sl + '</span></div></div><div class="detail-specs"><div class="detail-spec-item"><label>Processador</label><p>' + escapeHtml(eq.processador) + '</p></div><div class="detail-spec-item"><label>Memoria RAM</label><p>' + escapeHtml(eq.memoriaRam) + '</p></div><div class="detail-spec-item"><label>Armazenamento</label><p>' + escapeHtml(eq.armazenamento) + '</p></div><div class="detail-spec-item"><label>Usu�rio Designado</label><p>' + escapeHtml(eq.usuarioDesignado || 'Nao atribuido') + '</p></div><div class="detail-spec-item"><label>N�mero de S�rie</label><p>' + escapeHtml(eq.numeroSerie) + '</p></div></div>' + extraHtml + manutHtml, '<button onclick="closeModal()" class="btn btn-ghost btn-sm">Fechar</button><button onclick="showComputadorForm(' + eq.id + ')" class="btn btn-primary btn-sm"><i class="fas fa-pen"></i> Editar</button>');
    } catch (e) { showToast(e.message, 'error'); }
}

function renderSkeletonCards(count) {
    var grid = document.getElementById('pc-cards-grid');
    if (!grid) return;
    var html = '';
    for (var i = 0; i < (count || 6); i++) { html += '<div class="pc-card"><div class="skeleton skeleton-card"></div></div>'; }
    grid.innerHTML = html;
}

function renderSkeletonTableRows(count) {
    var html = '';
    for (var i = 0; i < (count || 5); i++) { html += '<tr><td colspan="100%"><div class="skeleton skeleton-row"></div></td></tr>'; }
    return html;
}

function renderSkeletonKpis(count) {
    var container = document.getElementById('dashboardKpis');
    if (!container) return;
    var html = '';
    for (var i = 0; i < (count || 4); i++) { html += '<div class="kpi-card"><div class="skeleton" style="height:40px;width:60px;margin-bottom:8px;"></div><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text short"></div></div>'; }
    container.innerHTML = html;
}

function toggleSelection(id, checked) {
    if (checked !== undefined) {
        if (checked) selectedComputadores.add(id); else selectedComputadores.delete(id);
    } else {
        if (selectedComputadores.has(id)) selectedComputadores.delete(id); else selectedComputadores.add(id);
    }
    var count = selectedComputadores.size;
    var toolbar = document.getElementById('bulk-toolbar');
    var countEl = document.getElementById('bulk-count');
    if (toolbar) toolbar.classList.toggle('active', count > 0);
    if (countEl) countEl.textContent = count + ' selecionado' + (count !== 1 ? 's' : '');
}

function clearBulkSelection() {
    selectedComputadores.clear();
    var toolbar = document.getElementById('bulk-toolbar');
    if (toolbar) toolbar.classList.remove('active');
    var countEl = document.getElementById('bulk-count');
    if (countEl) countEl.textContent = '0 selecionados';
    document.querySelectorAll('.pc-card.selected').forEach(function(c) { c.classList.remove('selected'); });
    document.querySelectorAll('.bulk-check:checked').forEach(function(c) { c.checked = false; });
    var bulkSt = document.getElementById('bulk-status'); if (bulkSt) bulkSt.value = '';
}

async function applyBulkStatus() {
    var bulkEl = document.getElementById('bulk-status');
    var status = bulkEl ? bulkEl.value : '';
    if (!status || selectedComputadores.size === 0) { showToast('Selecione um status e ao menos um computador', 'error'); return; }
    try {
        var res = await apiFetch('/api/computadores/bulk-status', { method: 'PATCH', body: JSON.stringify({ ids: Array.from(selectedComputadores), status: status }) });
        showToast(res.mensagem || (res.atualizados + ' computadores atualizados'), 'success');
        clearBulkSelection();
        loadComputadores(currentPage.computadores);
        refreshAllData();
    } catch (e) { showToast(e.message, 'error'); }
}

async function showComputadorForm(id) {
    var eq = { nomePc: '', numeroSerie: '', modeloMarca: '', processador: '', memoriaRam: '', armazenamento: '', usuarioDesignado: '', fornecedor: '', status: 'ATIVO', fotoUrl: '' };
    if (id) { try { eq = await apiFetch('/api/computadores/' + id); } catch (e) { showToast('Erro ao carregar computador: ' + e.message, 'error'); return; } }
    var fotoHtml = '<div class="photo-upload-area" id="photoUploadArea"><input type="file" id="eqFotoFile" accept=".jpg,.jpeg,.jfif,.png,.gif,.webp,.bmp,.tiff,.tif,.heic,.heif,.avif,.svg,.ico,image/*" style="display:none;"><div id="fotoDropZone" class="foto-drop-zone"><div id="fotoPreview" class="foto-preview">' + (eq.fotoUrl && eq.fotoUrl.trim() ? '<div style="position:relative;display:inline-block;"><img src="' + escapeHtml(eq.fotoUrl) + '" style="max-height:240px;object-fit:contain;border-radius:8px;border:1px solid var(--border);" onload="this.style.display=\'block\';" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';"><div style="display:none;flex-direction:column;align-items:center;color:var(--red);padding:10px;"><i class="fas fa-exclamation-triangle" style="font-size:16px;"></i><p style="font-size:11px;margin-top:4px;">Imagem n�oencontrada</p></div></div><div style="display:flex;gap:4px;margin-top:8px;"><button type="button" onclick="event.stopPropagation();document.getElementById(\'eqFotoFile\').click();" class="btn btn-primary btn-sm"><i class="fas fa-upload"></i> Trocar Foto</button><button type="button" onclick="event.stopPropagation();removePhoto()" class="btn btn-ghost btn-sm"><i class="fas fa-trash"></i> Remover</button></div>' : '<i class="fas fa-image" style="font-size:36px;color:var(--text-muted);margin-bottom:12px;opacity:0.4;"></i><p style="font-size:14px;color:var(--text-secondary);margin-bottom:12px;">Arraste fotos ou clique para selecionar</p><button type="button" id="fotoUploadBtn" onclick="event.stopPropagation();document.getElementById(\'eqFotoFile\').click();" class="btn btn-primary btn-sm"><i class="fas fa-upload"></i> importar Foto</button><p style="font-size:11px;color:var(--text-muted);margin-top:10px;">JPG, PNG, GIF, WebP, HEIC, AVIF, BMP, TIFF, SVG (max 50MB)</p>') + '</div></div><input type="hidden" id="eqFotoUrlFinal" value="' + escapeAttr(eq.fotoUrl || '') + '"></div>';
    var statusOpts = ['ATIVO', 'MANUTENCAO_PREDITIVA', 'MANUTENCAO_PREVENTIVA', 'MANUTENCAO_EMERGENCIAL', 'CONCLUIDO'].map(function(st) {
        var labels = { 'ATIVO': 'Ativo', 'MANUTENCAO_PREDITIVA': 'Manuten��o Preditiva', 'MANUTENCAO_PREVENTIVA': 'Manuten��o Preventiva', 'MANUTENCAO_EMERGENCIAL': 'Manuten��o Emergencial', 'CONCLUIDO': 'Conclu�do' };
        return '<option value="' + st + '"' + (eq.status === st ? ' selected' : '') + '>' + labels[st] + '</option>';
    }).join('');
    var manutDescHtml = '<div id="manutDescGroup" class="form-group" style="margin-top:14px;' + (eq.status && eq.status.indexOf('MANUTENCAO_') === 0 ? '' : 'display:none;') + '"><label class="form-label">Descri��o do Problema * <span style="color:var(--red);font-size:11px;">(obrigat�rio para manuten��o)</span></label><textarea id="eqManutDesc" class="form-input" style="min-height:80px;resize:vertical;" maxlength="2000" placeholder="Descreva o problema encontrado...">' + escapeHtml(eq.notas || '') + '</textarea></div>';
    var soOpts = ['', 'Windows 10', 'Windows 11', 'Linux Ubuntu', 'Linux Mint', 'macOS', 'Outro'].map(function(so) {
        return '<option value="' + so + '"' + (eq.sistemaOperacional === so ? ' selected' : '') + '>' + (so || 'Selecione...') + '</option>';
    }).join('');
    var detHtml = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">' +
        '<div class="form-group"><label class="form-label">Setor</label><div class="searchable-dropdown" id="setorDropdown"><input type="text" id="eqDeptoSearch" class="form-input" placeholder="Buscar setor..." autocomplete="off" value="' + escapeAttr(eq.departamento || '') + '"><input type="hidden" id="eqDepto" value="' + escapeAttr(eq.departamento || '') + '"><div id="setorDropdownList" class="searchable-dropdown-list" style="display:none;"></div></div></div>' +
        '<div class="form-group"><label class="form-label">Localiza��o</label><input id="eqLocal" value="' + escapeAttr(eq.localizacao || '') + '" class="form-input" placeholder="Ex: Sala 101, 2o andar" maxlength="150"></div>' +
        '<div class="form-group"><label class="form-label">Endere�o IP</label><input id="eqIP" value="' + escapeAttr(eq.ipAddress || '') + '" class="form-input" placeholder="Ex: 192.168.1.100" maxlength="50"></div>' +
        '<div class="form-group"><label class="form-label">Sistema Operacional</label><select id="eqSO" class="form-input">' + soOpts + '</select></div>' +
        '<div class="form-group"><label class="form-label">Software Instalado</label><input id="eqSoftware" value="' + escapeAttr(eq.softwareInstalado || '') + '" class="form-input" placeholder="Ex: Office 365, Adobe CC" maxlength="200"></div>' +
        '</div>' +
        '<div class="form-group" style="margin-top:14px;"><label class="form-label">Notas</label><textarea id="eqNotas" class="form-input" style="min-height:60px;resize:vertical;" maxlength="2000">' + escapeHtml(eq.notas || '') + '</textarea></div>';
    var tabIdx = id ? _currentTab : 0;
    var tabClasses = ['form-tab' + (tabIdx === 0 ? ' active' : ''), 'form-tab' + (tabIdx === 1 ? ' active' : ''), 'form-tab' + (tabIdx === 2 ? ' active' : '')];
    var tabDisplays = [tabIdx === 0 ? '' : 'display:none;', tabIdx === 1 ? '' : 'display:none;', tabIdx === 2 ? '' : 'display:none;'];
    var tabActives = [tabIdx === 0 ? 'active' : '', tabIdx === 1 ? 'active' : '', tabIdx === 2 ? 'active' : ''];
    openModal(id ? 'Editar Computador' : 'Novo Computador',
        '<form id="eqForm">' +
        '<div class="form-tabs" id="eqTabs">' +
        '<button type="button" class="' + tabClasses[0] + '" data-tab="tabgeral"><i class="fas fa-desktop"></i> Geral</button>' +
        '<button type="button" class="' + tabClasses[1] + '" data-tab="tabfoto"><i class="fas fa-camera"></i> Foto</button>' +
        '<button type="button" class="' + tabClasses[2] + '" data-tab="tabdet"><i class="fas fa-cog"></i> Detalhes</button>' +
        '</div>' +
        '<div id="tabgeral" class="form-tab-content ' + tabActives[0] + '" style="' + tabDisplays[0] + '">' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">' +
        '<div class="form-group"><label class="form-label">Nome PC *</label><input id="eqNome" value="' + escapeAttr(eq.nomePc) + '" required class="form-input" maxlength="100"></div>' +
        '<div class="form-group"><label class="form-label">N�mero S�rie *</label><input id="eqSerie" value="' + escapeAttr(eq.numeroSerie) + '" required class="form-input" maxlength="50"></div>' +
        '<div class="form-group"><label class="form-label">Processador *</label><input id="eqProc" value="' + escapeAttr(eq.processador) + '" required class="form-input" maxlength="100"></div>' +
        '<div class="form-group"><label class="form-label">Memoria RAM *</label><input id="eqRam" value="' + escapeAttr(eq.memoriaRam) + '" required class="form-input" maxlength="50"></div>' +
        '<div class="form-group"><label class="form-label">Armazenamento *</label><input id="eqArm" value="' + escapeAttr(eq.armazenamento) + '" required class="form-input" maxlength="50"></div>' +
        '<div class="form-group"><label class="form-label">Usu�rio Designado</label><input id="eqUsuario" value="' + escapeAttr(eq.usuarioDesignado || '') + '" class="form-input" maxlength="100"></div>' +
        '</div>' +
        '<div class="form-group" style="margin-top:14px;"><label class="form-label">Status</label><select id="eqStatus" class="form-input">' + statusOpts + '</select></div>' +
        manutDescHtml +
        '</div>' +
        '<div id="tabfoto" class="form-tab-content ' + tabActives[1] + '" style="' + tabDisplays[1] + '">' + fotoHtml + '</div>' +
        '<div id="tabdet" class="form-tab-content ' + tabActives[2] + '" style="' + tabDisplays[2] + '">' + detHtml + '</div>' +
        '</form>',
        '<button onclick="closeModal()" class="btn btn-ghost btn-sm">Cancelar</button><button onclick="document.getElementById(\'eqForm\').requestSubmit()" class="btn btn-primary btn-sm"><i class="fas fa-save"></i> ' + (id ? 'Salvar' : 'Cadastrar') + '</button>'
    );
    setupPhotoUpload();
    setupFormTabs();
    setupSetorSearchableDropdown(eq.departamento || '');
    var eqStatusEl = document.getElementById('eqStatus');
    var manutDescGroup = document.getElementById('manutDescGroup');
    if (eqStatusEl && manutDescGroup) {
        eqStatusEl.addEventListener('change', function() {
            manutDescGroup.style.display = this.value.indexOf('MANUTENCAO_') === 0 ? '' : 'none';
        });
    }
    document.getElementById('eqForm').addEventListener('submit', async function(e) {
        e.preventDefault();
        if (_photoUploading) {
            showToast('Aguarde o envio da foto antes de salvar.', 'warning');
            return;
        }
        var statusVal = document.getElementById('eqStatus').value;
        var prevStatus = eq.status || 'ATIVO';
        var enteringManut = statusVal.indexOf('MANUTENCAO_') === 0 && prevStatus.indexOf('MANUTENCAO_') !== 0;
        var manutDesc = document.getElementById('eqManutDesc') ? document.getElementById('eqManutDesc').value.trim() : '';
        if (enteringManut && !manutDesc) {
            showToast('Descri��o do problema e obrigat�ria ao registrar manuten��o.', 'error');
            var descGroup = document.getElementById('manutDescGroup');
            if (descGroup) descGroup.style.display = '';
            var descField = document.getElementById('eqManutDesc');
            if (descField) descField.focus();
            return;
        }
        var fotoVal = document.getElementById('eqFotoUrlFinal').value || null;
        var p = {
            nomePc: document.getElementById('eqNome').value,
            numeroSerie: document.getElementById('eqSerie').value,
            processador: document.getElementById('eqProc').value,
            memoriaRam: document.getElementById('eqRam').value,
            armazenamento: document.getElementById('eqArm').value,
            usuarioDesignado: document.getElementById('eqUsuario').value,
            status: statusVal,
            fotoUrl: fotoVal,
            departamento: document.getElementById('eqDepto').value || null,
            localizacao: document.getElementById('eqLocal').value || null,
            ipAddress: document.getElementById('eqIP').value || null,
            sistemaOperacional: document.getElementById('eqSO').value || null,
            softwareInstalado: document.getElementById('eqSoftware').value || null,
            notas: document.getElementById('eqNotas').value || null
        };
        var isNewManut = id && enteringManut;
        try {
            if (id) {
                await apiFetch('/api/computadores/' + id, { method: 'PUT', body: JSON.stringify(p) });
                showToast('Computador atualizado!');
            } else {
                var res = await apiFetch('/api/computadores', { method: 'POST', body: JSON.stringify(p) });
                if (res && res.id) id = res.id;
                showToast('Computador cadastrado!');
            }
            if (isNewManut) {
                var tipoMap = { 'MANUTENCAO_PREDITIVA': 'PREDITIVA', 'MANUTENCAO_PREVENTIVA': 'PREVENTIVA', 'MANUTENCAO_EMERGENCIAL': 'EMERGENCIAL' };
                try {
                    await apiFetch('/api/manutencoes', { method: 'POST', body: JSON.stringify({ computadorId: id, tipo: tipoMap[statusVal] || 'PREVENTIVA', descricao: manutDesc, status: 'PENDENTE', tecnicoResponsavel: '' }) });
                    showToast('Manuten��o criada automaticamente!', 'success');
                } catch (me) { showToast('Computador salvo, mas erro ao criar manuten��o: ' + me.message, 'warning'); }
            }
            closeModal();
            _currentTab = 0;
            loadComputadores(currentPage.computadores);
            refreshAllData();
        } catch (e) { showToast(e.message, 'error'); }
    });
}

function setupFormTabs() {
    var tabs = document.querySelectorAll('.form-tab');
    tabs.forEach(function(tab) {
        tab.addEventListener('click', function() {
            tabs.forEach(function(t) { t.classList.remove('active'); });
            document.querySelectorAll('.form-tab-content').forEach(function(c) { c.style.display = 'none'; c.classList.remove('active'); });
            tab.classList.add('active');
            var target = document.getElementById(tab.dataset.tab);
            if (target) { target.style.display = ''; target.classList.add('active'); }
            var tabMap = { 'tabgeral': 0, 'tabfoto': 1, 'tabdet': 2 };
            _currentTab = tabMap[tab.dataset.tab] || 0;
        });
    });
}

function setupSetorSearchableDropdown(currentValue) {
    var searchInput = document.getElementById('eqDeptoSearch');
    var hiddenInput = document.getElementById('eqDepto');
    var listEl = document.getElementById('setorDropdownList');
    if (!searchInput || !listEl) return;
    var setores = [];
    async function loadSetores() {
        try { setores = await apiFetch('/api/departamentos'); } catch (e) { setores = []; }
    }
    function filterAndShow(term) {
        var filtered = setores.filter(function(s) { return (s.nome || '').toLowerCase().indexOf(term.toLowerCase()) !== -1; });
        if (filtered.length === 0) { listEl.style.display = 'none'; return; }
        listEl.innerHTML = filtered.map(function(s) {
            return '<div class="searchable-dropdown-item" data-value="' + escapeAttr(s.nome) + '">' + escapeHtml(s.nome) + ' <span style="color:var(--text-muted);font-size:11px;">(' + (s.totalComputadores || 0) + ' PCs)</span></div>';
        }).join('');
        listEl.style.display = 'block';
        listEl.querySelectorAll('.searchable-dropdown-item').forEach(function(item) {
            item.addEventListener('click', function() {
                hiddenInput.value = item.dataset.value;
                searchInput.value = item.dataset.value;
                listEl.style.display = 'none';
            });
        });
    }
    searchInput.addEventListener('focus', function() {
        if (setores.length === 0) loadSetores().then(function() { filterAndShow(searchInput.value); });
        else filterAndShow(searchInput.value);
    });
    searchInput.addEventListener('input', function() { hiddenInput.value = searchInput.value; filterAndShow(searchInput.value); });
    searchInput.addEventListener('blur', function() { setTimeout(function() { listEl.style.display = 'none'; }, 200); });
}

function setupSearchableSelect(searchId, hiddenId, listId, items, allowCustom) {
    var searchInput = document.getElementById(searchId);
    var hiddenInput = document.getElementById(hiddenId);
    var listEl = document.getElementById(listId);
    if (!searchInput || !hiddenInput || !listEl) return;
    items = items || [];
    listEl._allItems = items;
    function render(term) {
        var t = (term || '').toLowerCase();
        var filtered = items.filter(function(it) {
            return !t || (it.label || '').toLowerCase().indexOf(t) !== -1 || (it.sub || '').toLowerCase().indexOf(t) !== -1;
        }).slice(0, 60);
        if (filtered.length === 0) { listEl.style.display = 'none'; return; }
        listEl.innerHTML = filtered.map(function(it, i) {
            return '<div class="searchable-dropdown-item" data-idx="' + i + '">' + escapeHtml(it.label) + (it.sub ? ' <span style="color:var(--text-muted);font-size:11px;">(' + escapeHtml(it.sub) + ')</span>' : '') + '</div>';
        }).join('');
        listEl._items = filtered;
        listEl.style.display = 'block';
        listEl.querySelectorAll('.searchable-dropdown-item').forEach(function(el) {
            el.addEventListener('click', function() {
                var it = listEl._items[parseInt(el.dataset.idx)];
                hiddenInput.value = it.value;
                searchInput.value = it.label;
                listEl.style.display = 'none';
            });
        });
    }
    searchInput.addEventListener('focus', function() { render(searchInput.value); });
    searchInput.addEventListener('input', function() {
        var m = null, tx = (searchInput.value || '').toLowerCase();
        for (var i = 0; i < items.length; i++) {
            if ((items[i].label || '').toLowerCase() === tx) { m = items[i]; break; }
        }
        hiddenInput.value = m ? m.value : (allowCustom ? searchInput.value : '');
        render(searchInput.value);
    });
    searchInput.addEventListener('blur', function() { setTimeout(function() { listEl.style.display = 'none'; }, 200); });
}

function searchableValue(searchId, hiddenId, listId, allowCustom) {
    var searchInput = document.getElementById(searchId);
    var hiddenInput = document.getElementById(hiddenId);
    var listEl = document.getElementById(listId);
    var hv = hiddenInput ? hiddenInput.value : '';
    if (hv) return hv;
    var text = searchInput ? searchInput.value : '';
    if (!text) return '';
    var items = (listEl && listEl._allItems) || [];
    var t = text.toLowerCase();
    for (var i = 0; i < items.length; i++) {
        if ((items[i].label || '').toLowerCase() === t) return items[i].value;
    }
    return allowCustom ? text : '';
}

// ==========================================
// PHOTO UPLOAD
// ==========================================
function fetchUploadJSON(file) {
    return new Promise(function(resolve, reject) {
        var reader = new FileReader();
        reader.onload = function(ev) {
            fetch(API + '/api/upload', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: file.name, data: ev.target.result })
            }).then(resolve).catch(reject);
        };
        reader.onerror = function() { reject(new Error('Erro ao ler arquivo.')); };
        reader.readAsDataURL(file);
    });
}

function setupPhotoUpload() {
    var dropZone = document.getElementById('fotoDropZone');
    var fileInput = document.getElementById('eqFotoFile');
    var urlFinal = document.getElementById('eqFotoUrlFinal');
    var preview = document.getElementById('fotoPreview');
    if (!dropZone) return;
    dropZone.addEventListener('click', function(e) { e.stopPropagation(); if (e.target === fileInput || e.target.tagName === 'BUTTON' || e.target.tagName === 'I' || e.target.tagName === 'IMG') return; fileInput.click(); });
    fileInput.addEventListener('click', function(e) { e.stopPropagation(); });
    dropZone.addEventListener('dragover', function(e) { e.preventDefault(); e.stopPropagation(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', function(e) { e.preventDefault(); e.stopPropagation(); dropZone.classList.remove('drag-over'); });
    dropZone.addEventListener('drop', function(e) { e.preventDefault(); e.stopPropagation(); dropZone.classList.remove('drag-over'); if (e.dataTransfer.files.length) handlePhotoFile(e.dataTransfer.files[0]); });
    fileInput.addEventListener('change', function() { if (this.files.length) handlePhotoFile(this.files[0]); });
    function isImageFile(file) {
        var n = (file.name || '').toLowerCase();
        return !!n.match(/\.(jpe?g|jfif|png|gif|webp|bmp|tiff?|heic|heif|ico|avif|svg)$/);
    }
    function handlePhotoFile(file) {
        if (!isImageFile(file)) { showToast('Formato n�o suportado.', 'error'); return; }
        if (file.size > 50 * 1024 * 1024) { showToast('Arquivo excede 50MB.', 'error'); return; }
        _photoUploading = true;
        preview.innerHTML = '<div style="text-align:center;padding:30px;"><div class="spinner"></div><p style="font-size:12px;color:var(--text-muted);margin-top:10px;">Enviando ' + formatFileSize(file.size) + '...</p></div>';
        if (USE_MOCK) {
            var reader = new FileReader();
            reader.onload = function(ev) {
                _photoUploading = false;
                var dataUrl = ev.target.result;
                urlFinal.value = dataUrl;
                preview.innerHTML = '<div style="position:relative;display:inline-block;"><img src="' + escapeHtml(dataUrl) + '" style="max-height:240px;object-fit:contain;border-radius:8px;border:1px solid var(--border);" onload="this.style.display=\'block\';" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';"><div style="display:none;flex-direction:column;align-items:center;justify-content:center;padding:20px;color:var(--red);"><i class="fas fa-exclamation-triangle" style="font-size:20px;"></i><p style="font-size:11px;margin-top:4px;">Foto salva mas n�o carregou</p></div></div><div style="display:flex;gap:4px;margin-top:8px;"><button type="button" onclick="event.stopPropagation();document.getElementById(\'eqFotoFile\').click();" class="btn btn-primary btn-sm"><i class="fas fa-upload"></i> Trocar</button><button type="button" onclick="event.stopPropagation();removePhoto()" class="btn btn-ghost btn-sm"><i class="fas fa-trash"></i> Remover</button></div>';
                preview.style.position = 'relative';
                showToast('Foto carregada com sucesso!', 'success');
            };
            reader.onerror = function() {
                _photoUploading = false;
                showToast('Erro ao ler arquivo.', 'error');
                preview.innerHTML = '<div style="text-align:center;padding:20px;"><i class="fas fa-exclamation-triangle" style="font-size:28px;color:var(--red);"></i><p style="font-size:12px;color:var(--red);margin-top:8px;max-width:220px;">Erro ao ler arquivo</p><button type="button" onclick="event.stopPropagation();document.getElementById(\'eqFotoFile\').click();" class="btn btn-ghost btn-sm" style="margin-top:8px;"><i class="fas fa-redo"></i> Tentar novamente</button></div>';
            };
            reader.readAsDataURL(file);
            return;
        }
        fetchUploadJSON(file)
            .then(function(r) {
                if (r.status === 413) throw new Error('Arquivo muito grande.');
                if (r.status === 415) throw new Error('Tipo n�o suportado.');
                if (r.status === 401 || r.status === 403) throw new Error('Sess�o expirada.');
                if (!r.ok) {
                    return r.text().then(function(text) {
                        var msg = 'Erro no servidor';
                        try { var data = JSON.parse(text); msg = data.erro || data.mensagem || msg; } catch(ex) {}
                        throw new Error(msg);
                    });
                }
                return r.json();
            })
            .then(function(data) {
                _photoUploading = false;
                if (data.url) {
                    urlFinal.value = data.url;
                    preview.innerHTML = '<div style="position:relative;display:inline-block;"><img src="' + escapeHtml(data.url) + '" style="max-height:240px;object-fit:contain;border-radius:8px;border:1px solid var(--border);" onload="this.style.display=\'block\';" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';"><div style="display:none;flex-direction:column;align-items:center;justify-content:center;padding:20px;color:var(--red);"><i class="fas fa-exclamation-triangle" style="font-size:20px;"></i><p style="font-size:11px;margin-top:4px;">Foto salva mas n�o carregou</p></div></div><div style="display:flex;gap:4px;margin-top:8px;"><button type="button" onclick="event.stopPropagation();document.getElementById(\'eqFotoFile\').click();" class="btn btn-primary btn-sm"><i class="fas fa-upload"></i> Trocar</button><button type="button" onclick="event.stopPropagation();removePhoto()" class="btn btn-ghost btn-sm"><i class="fas fa-trash"></i> Remover</button></div>';
                    preview.style.position = 'relative';
                    showToast('Foto enviada com sucesso!', 'success');
                } else { throw new Error(data.erro || 'Erro no upload'); }
            })
            .catch(function(err) {
                _photoUploading = false;
                showToast('Erro no upload: ' + err.message, 'error');
                preview.innerHTML = '<div style="text-align:center;padding:20px;"><i class="fas fa-exclamation-triangle" style="font-size:28px;color:var(--red);"></i><p style="font-size:12px;color:var(--red);margin-top:8px;max-width:220px;">' + escapeHtml(err.message) + '</p><button type="button" onclick="event.stopPropagation();document.getElementById(\'eqFotoFile\').click();" class="btn btn-ghost btn-sm" style="margin-top:8px;"><i class="fas fa-redo"></i> Tentar novamente</button></div>';
            });
    }
}

function removePhoto() {
    var preview = document.getElementById('fotoPreview');
    var urlFinal = document.getElementById('eqFotoUrlFinal');
    var fileInput = document.getElementById('eqFotoFile');
    _photoUploading = false;
    if (urlFinal) urlFinal.value = '';
    if (fileInput) fileInput.value = '';
    if (preview) {
        preview.style.position = '';
        preview.innerHTML = '<i class="fas fa-image" style="font-size:36px;color:var(--text-muted);margin-bottom:12px;opacity:0.4;"></i><p style="font-size:14px;color:var(--text-secondary);margin-bottom:12px;">Arraste fotos ou clique para selecionar</p><button type="button" id="fotoUploadBtn" onclick="event.stopPropagation();document.getElementById(\'eqFotoFile\').click();" class="btn btn-primary btn-sm"><i class="fas fa-upload"></i> importar Foto</button><p style="font-size:11px;color:var(--text-muted);margin-top:10px;">JPG, PNG, GIF, WebP, HEIC, AVIF, BMP, TIFF, SVG (max 50MB)</p>';
    }
}

function setupRamalPhotoUpload() {
    var dropZone = document.getElementById('ramalFotoDropZone');
    var fileInput = document.getElementById('ramalFotoFile');
    var urlFinal = document.getElementById('ramalFotoUrlFinal');
    var preview = document.getElementById('ramalFotoPreview');
    if (!dropZone) return;
    dropZone.addEventListener('click', function(e) { e.stopPropagation(); if (e.target === fileInput || e.target.tagName === 'BUTTON' || e.target.tagName === 'I' || e.target.tagName === 'IMG') return; fileInput.click(); });
    fileInput.addEventListener('click', function(e) { e.stopPropagation(); });
    dropZone.addEventListener('dragover', function(e) { e.preventDefault(); e.stopPropagation(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', function(e) { e.preventDefault(); e.stopPropagation(); dropZone.classList.remove('drag-over'); });
    dropZone.addEventListener('drop', function(e) { e.preventDefault(); e.stopPropagation(); dropZone.classList.remove('drag-over'); if (e.dataTransfer.files.length) handleRamalPhotoFile(e.dataTransfer.files[0]); });
    fileInput.addEventListener('change', function() { if (this.files.length) handleRamalPhotoFile(this.files[0]); });
    function isImageFile(file) {
        var n = (file.name || '').toLowerCase();
        return !!n.match(/\.(jpe?g|jfif|png|gif|webp|bmp|tiff?|heic|heif|ico|avif|svg)$/);
    }
    function handleRamalPhotoFile(file) {
        if (!isImageFile(file)) { showToast('Formato n�o suportado.', 'error'); return; }
        if (file.size > 50 * 1024 * 1024) { showToast('Arquivo excede 50MB.', 'error'); return; }
        _ramalPhotoUploading = true;
        preview.innerHTML = '<div style="text-align:center;padding:30px;"><div class="spinner"></div><p style="font-size:12px;color:var(--text-muted);margin-top:10px;">Enviando ' + formatFileSize(file.size) + '...</p></div>';
        if (USE_MOCK) {
            var reader = new FileReader();
            reader.onload = function(ev) {
                _ramalPhotoUploading = false;
                var dataUrl = ev.target.result;
                urlFinal.value = dataUrl;
                preview.innerHTML = '<div style="position:relative;display:inline-block;"><img src="' + escapeHtml(dataUrl) + '" style="max-height:240px;object-fit:contain;border-radius:8px;border:1px solid var(--border);" onload="this.style.display=\'block\';" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';"><div style="display:none;flex-direction:column;align-items:center;justify-content:center;padding:20px;color:var(--red);"><i class="fas fa-exclamation-triangle" style="font-size:20px;"></i><p style="font-size:11px;margin-top:4px;">Foto salva mas nao carregou</p></div></div><div style="display:flex;gap:4px;margin-top:8px;"><button type="button" onclick="event.stopPropagation();document.getElementById(\'ramalFotoFile\').click();" class="btn btn-primary btn-sm"><i class="fas fa-upload"></i> Trocar</button><button type="button" onclick="event.stopPropagation();removeRamalPhoto()" class="btn btn-ghost btn-sm"><i class="fas fa-trash"></i> Remover</button></div>';
                preview.style.position = 'relative';
                showToast('Foto carregada com sucesso!', 'success');
            };
            reader.onerror = function() {
                _ramalPhotoUploading = false;
                showToast('Erro ao ler arquivo.', 'error');
                preview.innerHTML = '<div style="text-align:center;padding:20px;"><i class="fas fa-exclamation-triangle" style="font-size:28px;color:var(--red);"></i><p style="font-size:12px;color:var(--red);margin-top:8px;max-width:220px;">Erro ao ler arquivo</p><button type="button" onclick="event.stopPropagation();document.getElementById(\'ramalFotoFile\').click();" class="btn btn-ghost btn-sm" style="margin-top:8px;"><i class="fas fa-redo"></i> Tentar novamente</button></div>';
            };
            reader.readAsDataURL(file);
            return;
        }
        fetchUploadJSON(file)
            .then(function(r) {
                if (r.status === 413) throw new Error('Arquivo muito grande.');
                if (r.status === 415) throw new Error('Tipo n�o suportado.');
                if (r.status === 401 || r.status === 403) throw new Error('Sess�o expirada.');
                if (!r.ok) {
                    return r.text().then(function(text) {
                        var msg = 'Erro no servidor';
                        try { var data = JSON.parse(text); msg = data.erro || data.mensagem || msg; } catch(ex) {}
                        throw new Error(msg);
                    });
                }
                return r.json();
            })
            .then(function(data) {
                _ramalPhotoUploading = false;
                if (data.url) {
                    urlFinal.value = data.url;
                    preview.innerHTML = '<div style="position:relative;display:inline-block;"><img src="' + escapeHtml(data.url) + '" style="max-height:240px;object-fit:contain;border-radius:8px;border:1px solid var(--border);" onload="this.style.display=\'block\';" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';"><div style="display:none;flex-direction:column;align-items:center;justify-content:center;padding:20px;color:var(--red);"><i class="fas fa-exclamation-triangle" style="font-size:20px;"></i><p style="font-size:11px;margin-top:4px;">Foto salva mas nao carregou</p></div></div><div style="display:flex;gap:4px;margin-top:8px;"><button type="button" onclick="event.stopPropagation();document.getElementById(\'ramalFotoFile\').click();" class="btn btn-primary btn-sm"><i class="fas fa-upload"></i> Trocar</button><button type="button" onclick="event.stopPropagation();removeRamalPhoto()" class="btn btn-ghost btn-sm"><i class="fas fa-trash"></i> Remover</button></div>';
                    preview.style.position = 'relative';
                    showToast('Foto enviada com sucesso!', 'success');
                } else { throw new Error(data.erro || 'Erro no upload'); }
            })
            .catch(function(err) {
                _ramalPhotoUploading = false;
                showToast('Erro no upload: ' + err.message, 'error');
                preview.innerHTML = '<div style="text-align:center;padding:20px;"><i class="fas fa-exclamation-triangle" style="font-size:28px;color:var(--red);"></i><p style="font-size:12px;color:var(--red);margin-top:8px;max-width:220px;">' + escapeHtml(err.message) + '</p><button type="button" onclick="event.stopPropagation();document.getElementById(\'ramalFotoFile\').click();" class="btn btn-ghost btn-sm" style="margin-top:8px;"><i class="fas fa-redo"></i> Tentar novamente</button></div>';
            });
    }
}

function removeRamalPhoto() {
    var preview = document.getElementById('ramalFotoPreview');
    var urlFinal = document.getElementById('ramalFotoUrlFinal');
    var fileInput = document.getElementById('ramalFotoFile');
    _ramalPhotoUploading = false;
    if (urlFinal) urlFinal.value = '';
    if (fileInput) fileInput.value = '';
    if (preview) {
        preview.style.position = '';
        preview.innerHTML = '<i class="fas fa-image" style="font-size:36px;color:var(--text-muted);margin-bottom:12px;opacity:0.4;"></i><p style="font-size:14px;color:var(--text-secondary);margin-bottom:12px;">Arraste fotos ou clique para selecionar</p><button type="button" id="ramalFotoUploadBtn" onclick="event.stopPropagation();document.getElementById(\'ramalFotoFile\').click();" class="btn btn-primary btn-sm"><i class="fas fa-upload"></i> Importar Foto</button><p style="font-size:11px;color:var(--text-muted);margin-top:10px;">JPG, PNG, GIF, WebP, HEIC, AVIF, BMP, TIFF, SVG (max 50MB)</p>';
    }
}

async function quickToggleManStatus(id, currentStatus) {
    var nextStatus = { 'PENDENTE': 'EM_ANDAMENTO', 'EM_ANDAMENTO': 'CONCLUIDA', 'CONCLUIDA': 'PENDENTE', 'CANCELADA': 'PENDENTE' };
    var newStatus = nextStatus[currentStatus];
    if (!newStatus) return;
    try {
        var m = await apiFetch('/api/manutencoes/' + id);
        await apiFetch('/api/manutencoes/' + id, { method: 'PUT', body: JSON.stringify({ ...m, status: newStatus }) });
        showToast('Status alterado para ' + newStatus.replace(/_/g, ' '));
        if (newStatus === 'CONCLUIDA' || newStatus === 'CANCELADA') {
            try {
                var allOS = await apiFetch('/api/ordens-servico?page=0&size=100');
                var osList = allOS.content || allOS || [];
                var linkedOS = osList.filter(function(o) { return o.titulo && o.titulo.indexOf('Manuten��o #' + id) !== -1; });
                for (var oi = 0; oi < linkedOS.length; oi++) {
                    await apiFetch('/api/ordens-servico/' + linkedOS[oi].id, { method: 'PUT', body: JSON.stringify({ ...linkedOS[oi], status: newStatus === 'CONCLUIDA' ? 'CONCLUIDA' : 'CANCELADA', solucao: 'Manuten��o #' + id + ' ' + (newStatus === 'CONCLUIDA' ? 'concluida' : 'cancelada') }) });
                }
            } catch (e) { }
        }
        refreshAllData();
    } catch (e) { showToast(e.message, 'error'); }
}

function setupManutencaoPhotoUpload() {
    var dropZone = document.getElementById('manFotoDropZone');
    var fileInput = document.getElementById('manFotoFile');
    var urlFinal = document.getElementById('manFotoUrlFinal');
    var preview = document.getElementById('manFotoPreview');
    if (!dropZone) return;
    dropZone.addEventListener('click', function(e) { e.stopPropagation(); if (e.target === fileInput || e.target.tagName === 'BUTTON' || e.target.tagName === 'I' || e.target.tagName === 'IMG') return; fileInput.click(); });
    fileInput.addEventListener('click', function(e) { e.stopPropagation(); });
    dropZone.addEventListener('dragover', function(e) { e.preventDefault(); e.stopPropagation(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', function(e) { e.preventDefault(); e.stopPropagation(); dropZone.classList.remove('drag-over'); });
    dropZone.addEventListener('drop', function(e) { e.preventDefault(); e.stopPropagation(); dropZone.classList.remove('drag-over'); if (e.dataTransfer.files.length) handleManPhotoFile(e.dataTransfer.files[0]); });
    fileInput.addEventListener('change', function() { if (this.files.length) handleManPhotoFile(this.files[0]); });
    function isManImageFile(file) {
        var n = (file.name || '').toLowerCase();
        return !!n.match(/\.(jpe?g|jfif|png|gif|webp|bmp|tiff?|heic|heif|ico|avif|svg)$/);
    }
    function handleManPhotoFile(file) {
        if (!isManImageFile(file)) { showToast('Formato n�o suportado.', 'error'); return; }
        if (file.size > 50 * 1024 * 1024) { showToast('Arquivo excede 50MB.', 'error'); return; }
        _manPhotoUploading = true;
        preview.innerHTML = '<div style="text-align:center;padding:16px;"><div class="spinner"></div><p style="font-size:11px;color:var(--text-muted);margin-top:6px;">Enviando...</p></div>';
        if (USE_MOCK) {
            var reader = new FileReader();
            reader.onload = function(ev) {
                _manPhotoUploading = false;
                var dataUrl = ev.target.result;
                urlFinal.value = dataUrl;
                preview.innerHTML = '<img src="' + escapeHtml(dataUrl) + '" style="max-height:100px;object-fit:contain;border-radius:8px;border:1px solid var(--border);" onload="this.style.display=\'block\';" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';"><div style="display:none;color:var(--red);font-size:11px;">Falha ao carregar</div><div style="display:flex;gap:4px;margin-top:6px;"><button type="button" onclick="event.stopPropagation();document.getElementById(\'manFotoFile\').click();" class="btn btn-primary btn-sm"><i class="fas fa-upload"></i> Trocar</button><button type="button" onclick="event.stopPropagation();removeManFoto()" class="btn btn-ghost btn-sm"><i class="fas fa-trash"></i> Remover</button></div>';
                showToast('Foto carregada com sucesso!', 'success');
            };
            reader.onerror = function() {
                _manPhotoUploading = false;
                showToast('Erro ao ler arquivo.', 'error');
                preview.innerHTML = '<i class="fas fa-camera" style="font-size:24px;color:var(--text-muted);margin-bottom:8px;opacity:0.4;"></i><p style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;">Arraste ou clique para adicionar foto</p><button type="button" onclick="event.stopPropagation();document.getElementById(\'manFotoFile\').click();" class="btn btn-primary btn-sm"><i class="fas fa-upload"></i> importar</button>';
            };
            reader.readAsDataURL(file);
            return;
        }
        fetchUploadJSON(file)
            .then(function(r) {
                if (r.status === 413) throw new Error('Arquivo muito grande.');
                if (r.status === 415) throw new Error('Tipo n�o suportado.');
                if (r.status === 401 || r.status === 403) throw new Error('Sess�o expirada.');
                if (!r.ok) {
                    return r.text().then(function(text) {
                        var msg = 'Erro no servidor';
                        try { var data = JSON.parse(text); msg = data.erro || data.mensagem || msg; } catch(ex) {}
                        throw new Error(msg);
                    });
                }
                return r.json();
            })
            .then(function(data) {
                _manPhotoUploading = false;
                if (data.url) {
                    urlFinal.value = data.url;
                    preview.innerHTML = '<img src="' + escapeHtml(data.url) + '" style="max-height:100px;object-fit:contain;border-radius:8px;border:1px solid var(--border);" onload="this.style.display=\'block\';" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';"><div style="display:none;color:var(--red);font-size:11px;">Falha ao carregar</div><div style="display:flex;gap:4px;margin-top:6px;"><button type="button" onclick="event.stopPropagation();document.getElementById(\'manFotoFile\').click();" class="btn btn-primary btn-sm"><i class="fas fa-upload"></i> Trocar</button><button type="button" onclick="event.stopPropagation();removeManFoto()" class="btn btn-ghost btn-sm"><i class="fas fa-trash"></i> Remover</button></div>';
                    showToast('Foto enviada!', 'success');
                } else { throw new Error(data.erro || 'Erro no upload'); }
            })
            .catch(function(err) {
                _manPhotoUploading = false;
                showToast('Erro no upload: ' + err.message, 'error');
                preview.innerHTML = '<div style="text-align:center;padding:12px;"><i class="fas fa-exclamation-triangle" style="font-size:20px;color:var(--red);"></i><p style="font-size:11px;color:var(--red);margin-top:4px;">' + escapeHtml(err.message) + '</p><button type="button" onclick="event.stopPropagation();document.getElementById(\'manFotoFile\').click();" class="btn btn-ghost btn-sm" style="margin-top:4px;"><i class="fas fa-redo"></i> Tentar</button></div>';
            });
    }
}

function removeManFoto() {
    var preview = document.getElementById('manFotoPreview');
    var urlFinal = document.getElementById('manFotoUrlFinal');
    var fileInput = document.getElementById('manFotoFile');
    _manPhotoUploading = false;
    if (urlFinal) urlFinal.value = '';
    if (fileInput) fileInput.value = '';
    if (preview) {
        preview.innerHTML = '<i class="fas fa-camera" style="font-size:24px;color:var(--text-muted);margin-bottom:8px;opacity:0.4;"></i><p style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;">Arraste ou clique para adicionar foto</p><button type="button" onclick="event.stopPropagation();document.getElementById(\'manFotoFile\').click();" class="btn btn-primary btn-sm"><i class="fas fa-upload"></i> importar</button>';
    }
}

// ==========================================
// MAINTENANCE
// ==========================================
async function loadManutencoes(page) {
    if (page !== undefined) currentPage.manutencoes = page;
    var st = (document.getElementById('man-filtro-status') || {}).value || '';
    var sb = (document.getElementById('man-busca-input') || {}).value || '';
    _manFilters.status = st;
    _manFilters.termo = sb;
    try {
        var allUrl = '/api/manutencoes?page=' + currentPage.manutencoes + '&size=10' + (st ? '&status=' + st : '') + (sb ? '&termo=' + encodeURIComponent(sb) : '') + (_manFilters.showConcluidas ? '&showConcluidas=true' : '');
        var d = await apiFetch(allUrl);
        if (d && d.totalElements > 0 && (!d.content || d.content.length === 0) && (currentPage.manutencoes || 0) > 0) return loadManutencoes(0);
        renderManutencoes(d, sb, st);
        renderManKpis();
    } catch (e) {
        var tb = document.querySelector('#manutencoesTable tbody');
        if (tb) tb.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)"><i class="fas fa-inbox"></i> Nenhuma manuten��o encontrada</td></tr>';
    }
}

async function renderManKpis() {
    try {
        var stats = await apiFetch('/api/manutencoes/estatisticas');
        stats = stats || {};
        var k = [
            { i: 'fa-tools', l: 'Total', v: stats.total || 0, c: 'cyan', t: 'TOTAL', key: 'man-kpi-total' },
            { i: 'fa-clock', l: 'Pendentes', v: stats.pendentes || 0, c: 'yellow', t: 'PENDENTE', key: 'man-kpi-pendentes' },
            { i: 'fa-spinner', l: 'Em Andamento', v: stats.emAndamento || 0, c: 'orange', t: 'ANDAMENTO', key: 'man-kpi-andamento' },
            { i: 'fa-check-double', l: 'Conclu�das', v: stats.concluidas || 0, c: 'green', t: 'CONCLUIDA', key: 'man-kpi-concluidas' },
            { i: 'fa-times-circle', l: 'Canceladas', v: stats.canceladas || 0, c: 'red', t: 'CANCELADA', key: 'man-kpi-canceladas' }
        ];
        var el = document.getElementById('manKpis');
        if (el) el.innerHTML = k.map(function(x) {
            return '<div class="kpi-card kpi-card-' + x.c + '" onclick="toggleManKpiDetail(\'' + x.key + '\')" data-key="' + x.key + '"><div class="kpi-header"><div class="kpi-icon kpi-icon-' + x.c + '"><i class="fas ' + x.i + '"></i></div><span class="kpi-tag kpi-tag-' + x.c + '">' + x.t + '</span></div><p class="kpi-value"><span class="kpi-value-shine">' + x.v + '</span></p><p class="kpi-label">' + x.l + '</p></div>';
        }).join('');
    } catch (e) { }
}

var _activeManKpiKey = null;
function toggleManKpiDetail(key) {
    if (_activeManKpiKey === key) { closeManKpiDetail(); return; }
    closeManKpiDetail();
    _activeManKpiKey = key;
    document.querySelectorAll('#manKpis .kpi-card').forEach(function(el) { el.classList.toggle('active', el.dataset.key === key); });
    renderManKpiDetail(key);
}
function closeManKpiDetail() {
    _activeManKpiKey = null;
    document.querySelectorAll('#manKpis .kpi-card').forEach(function(el) { el.classList.remove('active'); });
    var ov = document.getElementById('sdOverlay-man'); if (ov) ov.remove();
    var ct = document.getElementById('sdContainer-man'); if (ct) ct.remove();
}
function renderManKpiDetail(key) {
    var container = document.getElementById('manKpiDetail');
    if (!container) return;
    var title = '', icon = '', color = '', statusFilter = '';
    if (key === 'man-kpi-total') { title = 'Todas as Manuten��es'; icon = 'fa-tools'; color = 'cyan'; statusFilter = ''; }
    else if (key === 'man-kpi-pendentes') { title = 'Manuten��es Pendentes'; icon = 'fa-clock'; color = 'yellow'; statusFilter = '&status=PENDENTE'; }
    else if (key === 'man-kpi-andamento') { title = 'Manuten��es Em Andamento'; icon = 'fa-spinner'; color = 'orange'; statusFilter = '&status=EM_ANDAMENTO'; }
    else if (key === 'man-kpi-concluidas') { title = 'Manuten��es Conclu�das'; icon = 'fa-check-double'; color = 'green'; statusFilter = '&status=CONCLUIDA'; }
    else if (key === 'man-kpi-canceladas') { title = 'Manuten��es Canceladas'; icon = 'fa-times-circle'; color = 'red'; statusFilter = '&status=CANCELADA'; }
    apiFetch('/api/manutencoes?page=0&size=100' + statusFilter + '&showConcluidas=true').then(function(d) {
        closeManKpiDetail();
        var list = (d.content || d || []);
        var count = list.length;
        var ov = document.createElement('div'); ov.id = 'sdOverlay-man'; ov.className = 'sd-overlay';
        var ct = document.createElement('div'); ct.id = 'sdContainer-man'; ct.className = 'sd-container';
        var itemsHtml = list.map(function(m) {
            return '<div class="stat-detail-item" onclick="showManutencaoForm(' + m.id + ')"><div class="stat-detail-item-icon" style="background:var(--' + color + '-bg);color:var(--' + color + ');"><i class="fas fa-wrench"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">' + escapeHtml(m.computadorNome || 'PC #' + m.computadorId) + '</div><div class="stat-detail-item-sub">' + escapeHtml(m.tipo) + ' - ' + escapeHtml(m.tecnicoResponsavel || 'Sem tecnico') + '</div></div><div class="stat-detail-item-badge"><span class="badge badge-' + escapeHtml((m.status || 'PENDENTE').toLowerCase().replace(/_/g, '-')) + '">' + escapeHtml((m.status || 'PENDENTE').replace(/_/g, ' ')) + '</span></div></div>';
        }).join('');
        if (!itemsHtml) itemsHtml = '<div class="stat-detail-empty"><i class="fas fa-inbox"></i> Nenhum item encontrado</div>';
        ct.innerHTML = '<div class="stat-detail-header"><h4><i class="fas ' + icon + '" style="color:var(--' + color + ');"></i> ' + title + ' <span style="font-weight:400;font-size:11px;color:var(--text-muted);">(' + count + ' itens)</span></h4><button class="stat-detail-close" onclick="closeManKpiDetail()"><i class="fas fa-times"></i> Fechar</button></div><div class="stat-detail-body">' + itemsHtml + '</div>';
        document.body.appendChild(ov); document.body.appendChild(ct);
    });
}

function renderManutencoes(data, searchTerm, serverStatus) {
    var tb = document.querySelector('#manutencoesTable tbody');
    if (!tb) return;
    if (!data.content || data.content.length === 0) {
        tb.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)"><i class="fas fa-inbox"></i> Nenhuma manuten��o encontrada</td></tr>';
        var mp = document.getElementById('man-pagination'); if (mp) mp.innerHTML = '';
        return;
    }
    var items = data.content;
    if (searchTerm) {
        var sl = searchTerm.toLowerCase();
        items = items.filter(function(m) { return (m.computadorNome || '').toLowerCase().indexOf(sl) !== -1 || (m.tecnicoResponsavel || '').toLowerCase().indexOf(sl) !== -1 || (m.descricao || '').toLowerCase().indexOf(sl) !== -1; });
    }
    if (items.length === 0) {
        tb.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)"><i class="fas fa-inbox"></i> Nenhuma manuten��o encontrada</td></tr>';
        var mp2 = document.getElementById('man-pagination'); if (mp2) mp2.innerHTML = '';
        return;
    }
    var pageSize = data.size || 10;
    var filteredTotalPages = data.totalPages || Math.max(1, Math.ceil((data.totalElements !== undefined ? data.totalElements : items.length) / pageSize));
    var filteredPage = data.number !== undefined ? data.number : Math.min(currentPage.manutencoes || 0, filteredTotalPages - 1);
    if (filteredPage < 0) filteredPage = 0;
    renderPagination('man-pagination', filteredTotalPages, filteredPage, loadManutencoes);
    var pagedItems = items;
    tb.innerHTML = pagedItems.map(function(m) {
        var isCompleted = m.status === 'CONCLUIDA';
        var rowStyle = isCompleted ? 'opacity:0.55;' : '';
        var checkIcon = isCompleted ? '<i class="fas fa-check-circle" style="color:var(--green);margin-right:4px;"></i>' : '';
        var dtCadastro = m.dataCadastro ? new Date(m.dataCadastro) : null;
        var tempoAberto = '';
        if (dtCadastro) {
            var diff = Math.floor((Date.now() - dtCadastro.getTime()) / 86400000);
            tempoAberto = diff === 0 ? 'Hoje' : diff + 'd atr�s';
        }
        return '<tr style="' + rowStyle + '"><td class="font-medium">' + checkIcon + m.id + '</td><td>' + escapeHtml(m.computadorNome) + '</td><td><span class="badge badge-' + escapeHtml((m.tipo || 'PREVENTIVA').toLowerCase()) + '">' + escapeHtml(m.tipo) + '</span></td><td style="cursor:pointer;" onclick="quickToggleManStatus(' + m.id + ',\'' + escapeJsStr(m.status) + '\')"><span class="badge badge-' + escapeHtml((m.status || 'PENDENTE').toLowerCase().replace(/_/g, '-')) + '">' + escapeHtml((m.status || 'PENDENTE').replace(/_/g, ' ')) + '</span>' + (tempoAberto ? '<div style="font-size:9px;color:var(--text-muted);margin-top:2px;">' + tempoAberto + '</div>' : '') + '</td><td>' + escapeHtml(m.tecnicoResponsavel || '-') + '</td><td><div style="display:flex;gap:4px;"><button onclick="showManutencaoForm(' + m.id + ')" class="action-btn action-btn-edit"><i class="fas fa-pen"></i></button><button onclick="confirmDelete(\'manuten��o\',' + m.id + ',\'Manuten��o #' + m.id + '\')" class="action-btn action-btn-delete"><i class="fas fa-trash"></i></button></div></td></tr>';
    }).join('');
}

async function showManutencaoForm(id) {
    var m = { tipo: 'CORRETIVA', status: 'PENDENTE', descricao: '' };
    if (id) { try { m = await apiFetch('/api/manutencoes/' + id); } catch (e) { showToast('Erro ao carregar manuten��o: ' + e.message, 'error'); return; } }
    try { allComputadores = await apiFetch('/api/computadores/paginado?page=0&size=1000&status=&termo='); } catch (e) { allComputadores = { content: [] }; }
    var compList = allComputadores.content || allComputadores;
    var manCompItems = compList.map(function(c) { return { value: String(c.id), label: c.nomePc, sub: c.numeroSerie }; });
    var manCompInit = compList.find(function(c) { return m.computadorId != null && c.id == m.computadorId; });
    var usuarios = [];
    try { usuarios = await apiFetch('/api/usuarios'); } catch (e) { }
    var tecnicos = usuarios.filter(function(u) { return u.perfil === 'ADMIN' || u.perfil === 'TECNICO'; });
    var manTecItems = tecnicos.map(function(u) { return { value: u.nomeCompleto, label: u.nomeCompleto, sub: u.perfil }; });
    openModal(id ? 'Editar Manuten��o' : 'Nova Manuten��o',
        '<form id="manForm"><div class="form-group"><label class="form-label">Computador</label><div class="searchable-dropdown"><input type="text" id="manCompSearch" required class="form-input" placeholder="Buscar computador..." autocomplete="off" value="' + escapeAttr(manCompInit ? manCompInit.nomePc : (m.computadorNome || '')) + '"><input type="hidden" id="manComputador" value="' + (m.computadorId != null ? m.computadorId : '') + '"><div id="manCompList" class="searchable-dropdown-list" style="display:none;"></div></div></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px;"><div class="form-group"><label class="form-label">Tipo</label><select id="manTipo" class="form-input"><option value="CORRETIVA"' + (m.tipo === 'CORRETIVA' ? ' selected' : '') + '>Corretiva</option><option value="PREVENTIVA"' + (m.tipo === 'PREVENTIVA' ? ' selected' : '') + '>Preventiva</option><option value="PREDITIVA"' + (m.tipo === 'PREDITIVA' ? ' selected' : '') + '>Preditiva</option><option value="EMERGENCIAL"' + (m.tipo === 'EMERGENCIAL' ? ' selected' : '') + '>Emergencial</option></select></div>' +
        '<div class="form-group"><label class="form-label">Status</label><select id="manStatus" class="form-input"><option value="PENDENTE"' + (m.status === 'PENDENTE' ? ' selected' : '') + '>Pendente</option><option value="EM_ANDAMENTO"' + (m.status === 'EM_ANDAMENTO' ? ' selected' : '') + '>Em Andamento</option><option value="CONCLUIDA"' + (m.status === 'CONCLUIDA' ? ' selected' : '') + '>Conclu�da</option><option value="CANCELADA"' + (m.status === 'CANCELADA' ? ' selected' : '') + '>Cancelada</option></select></div></div>' +
        '<div class="form-group" style="margin-top:14px;"><label class="form-label">Descri��o</label><textarea id="manDescricao" required class="form-input" style="min-height:80px;resize:vertical;">' + escapeHtml(m.descricao || '') + '</textarea></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px;"><div class="form-group"><label class="form-label">T�cnico Respons�vel</label><div class="searchable-dropdown"><input type="text" id="manTecSearch" class="form-input" placeholder="Buscar t�cnico..." autocomplete="off" value="' + escapeAttr(m.tecnicoResponsavel || '') + '"><input type="hidden" id="manTecnico" value="' + escapeAttr(m.tecnicoResponsavel || '') + '"><div id="manTecList" class="searchable-dropdown-list" style="display:none;"></div></div></div></div>' +
        '<div class="form-group" style="margin-top:14px;"><label class="form-label">Pe�as Trocadas</label><input id="manPecas" value="' + escapeAttr(m.pecasTrocadas || '') + '" class="form-input"></div>' +
        '<div class="form-group" style="margin-top:14px;"><label class="form-label">Observa��es</label><textarea id="manObs" class="form-input" style="min-height:60px;resize:vertical;">' + escapeHtml(m.observacoes || '') + '</textarea></div>' +
        '<div class="photo-upload-area" style="margin-top:14px;"><input type="file" id="manFotoFile" accept=".jpg,.jpeg,.jfif,.png,.gif,.webp,.bmp,.tiff,.tif,.heic,.heif,.avif,.svg,.ico,image/*" style="display:none;"><div id="manFotoDropZone" class="foto-drop-zone" style="min-height:80px;"><div id="manFotoPreview" class="foto-preview"><i class="fas fa-camera" style="font-size:24px;color:var(--text-muted);margin-bottom:8px;opacity:0.4;"></i><p style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;">Arraste ou clique para adicionar foto</p><button type="button" onclick="event.stopPropagation();document.getElementById(\'manFotoFile\').click();" class="btn btn-primary btn-sm"><i class="fas fa-upload"></i> importar</button></div></div><input type="hidden" id="manFotoUrlFinal" value="' + escapeAttr(m.fotoUrl || '') + '"></div></form>',
        '<button onclick="closeModal()" class="btn btn-ghost btn-sm">Cancelar</button><button onclick="document.getElementById(\'manForm\').requestSubmit()" class="btn btn-primary btn-sm"><i class="fas fa-save"></i> ' + (id ? 'Salvar' : 'Cadastrar') + '</button>'
    );
    setupSearchableSelect('manCompSearch', 'manComputador', 'manCompList', manCompItems, false);
    setupSearchableSelect('manTecSearch', 'manTecnico', 'manTecList', manTecItems, false);
    document.getElementById('manForm').addEventListener('submit', async function(e) {
        e.preventDefault();
        if (_manPhotoUploading) {
            showToast('Aguarde o envio da foto antes de salvar.', 'warning');
            return;
        }
        var manCompVal = searchableValue('manCompSearch', 'manComputador', 'manCompList', false);
        if (!manCompVal) { showToast('Selecione um computador', 'error'); return; }
        var p = {
            computadorId: parseInt(manCompVal),
            tipo: document.getElementById('manTipo').value,
            status: document.getElementById('manStatus').value,
            descricao: document.getElementById('manDescricao').value,
            tecnicoResponsavel: searchableValue('manTecSearch', 'manTecnico', 'manTecList', false),
            pecasTrocadas: document.getElementById('manPecas').value,
            observacoes: document.getElementById('manObs').value,
            fotoUrl: document.getElementById('manFotoUrlFinal').value || null
        };
        try {
            if (id) {
                await apiFetch('/api/manutencoes/' + id, { method: 'PUT', body: JSON.stringify(p) });
                showToast('Manuten��o atualizada!');
            } else {
                var res = await apiFetch('/api/manutencoes', { method: 'POST', body: JSON.stringify(p) });
                showToast('Manuten��o cadastrada!');
                if (res && res.id) {
                    try {
                        var comp = compList.find(function(c) { return c.id === p.computadorId; });
                        await apiFetch('/api/ordens-servico', { method: 'POST', body: JSON.stringify({ titulo: 'OS - Manuten��o #' + res.id + ' - ' + (comp ? comp.nomePc : ''), descricao: 'Ordem aberta automaticamente para manuten��o #' + res.id, computadorId: p.computadorId, prioridade: 'MEDIA', status: 'ABERTA', solicitante: p.tecnicoResponsavel || '', tecnicoResponsavel: p.tecnicoResponsavel || '', solucao: 'Aguardando in�cio da manuten��o ' + res.id }) });
                    } catch (e) { console.warn('[MANUT] Erro ao criar OS:', e); }
                }
            }
            if (p.computadorId) {
                // Sincronizacao de status do PC e feita pelo mock (syncManutencaoWithComputador)
            }
            if (p.status === 'CONCLUIDA' || p.status === 'CANCELADA' || p.status === 'EM_ANDAMENTO') {
                try {
                    var manutId = id || (res && res.id) || null;
                    if (manutId) {
                        var statusFiltro = p.status === 'EM_ANDAMENTO' ? 'ABERTA' : '';
                        var allOSUrl = '/api/ordens-servico?page=0&size=100' + (statusFiltro ? '&status=' + statusFiltro : '');
                        var allOS = await apiFetch(allOSUrl);
                        var osList = allOS.content || allOS || [];
                        var linkedOS = osList.filter(function(o) { return o.titulo && o.titulo.indexOf('Manuten��o #' + manutId) !== -1; });
                        var osStatusMap = { 'EM_ANDAMENTO': 'EM_EXECUCAO', 'CONCLUIDA': 'CONCLUIDA', 'CANCELADA': 'CANCELADA' };
                        var osSolucaoMap = { 'EM_ANDAMENTO': 'Manuten��o #' + manutId + ' em andamento', 'CONCLUIDA': 'Manuten��o #' + manutId + ' concluida', 'CANCELADA': 'Manuten��o #' + manutId + ' cancelada' };
                        for (var oi = 0; oi < linkedOS.length; oi++) {
                            await apiFetch('/api/ordens-servico/' + linkedOS[oi].id, { method: 'PUT', body: JSON.stringify({ ...linkedOS[oi], status: osStatusMap[p.status], solucao: osSolucaoMap[p.status] }) });
                        }
                    }
                } catch (e) { console.warn('[MANUT] Erro ao sincronizar OS:', e); }
            }
            closeModal(); loadManutencoes(0);
        } catch (e) { showToast(e.message, 'error'); }
    });
    setupManutencaoPhotoUpload();
}

// ==========================================
// ORDENS DE SERVICO (Helpdesk Style)
// ==========================================
async function loadOrdensServico(page) {
    if (page !== undefined) currentPage.ordensServico = page;
    var st = (document.getElementById('os-filtro-status') || {}).value || '';
    var pr = (document.getElementById('os-filtro-prioridade') || {}).value || '';
    var sb = (document.getElementById('os-busca-input') || {}).value || '';
    try {
        var osUrl = '/api/ordens-servico?page=' + currentPage.ordensServico + '&size=10' + (st ? '&status=' + st : '') + (pr ? '&prioridade=' + pr : '') + (sb ? '&termo=' + encodeURIComponent(sb) : '');
        var d = await apiFetch(osUrl);
        if (d && d.totalElements > 0 && (!d.content || d.content.length === 0) && (currentPage.ordensServico || 0) > 0) return loadOrdensServico(0);
        renderOrdensServico(d, sb);
        renderOsKpis();
    } catch (e) {
        var tb = document.querySelector('#ordensTable tbody');
        if (tb) tb.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted)"><i class="fas fa-inbox"></i> Nenhuma ordem encontrada</td></tr>';
    }
}

async function renderOsKpis() {
    try {
        var stats = await apiFetch('/api/ordens-servico/estatisticas');
        stats = stats || {};
        var k = [
            { i: 'fa-clipboard-list', l: 'Total', v: stats.total || 0, c: 'cyan', t: 'TOTAL', key: 'os-kpi-total' },
            { i: 'fa-folder-open', l: 'Abertas', v: stats.abertas || 0, c: 'orange', t: 'ABERTA', key: 'os-kpi-abertas' },
            { i: 'fa-search', l: 'Em Analise', v: stats.emAnalise || 0, c: 'yellow', t: 'ANALISE', key: 'os-kpi-analise' },
            { i: 'fa-cogs', l: 'Em Execu��o', v: stats.emExecucao || 0, c: 'green', t: 'EXECUCAO', key: 'os-kpi-execucao' },
            { i: 'fa-check-circle', l: 'Conclu�das', v: stats.concluidas || 0, c: 'green', t: 'CONCLUIDA', key: 'os-kpi-concluidas' }
        ];
        var el = document.getElementById('osKpis');
        if (el) el.innerHTML = k.map(function(x) {
            return '<div class="kpi-card kpi-card-' + x.c + '" onclick="toggleOsKpiDetail(\'' + x.key + '\')" data-key="' + x.key + '"><div class="kpi-header"><div class="kpi-icon kpi-icon-' + x.c + '"><i class="fas ' + x.i + '"></i></div><span class="kpi-tag kpi-tag-' + x.c + '">' + x.t + '</span></div><p class="kpi-value"><span class="kpi-value-shine">' + x.v + '</span></p><p class="kpi-label">' + x.l + '</p></div>';
        }).join('');
    } catch (e) { }
}

var _activeOsKpiKey = null;
function toggleOsKpiDetail(key) {
    if (_activeOsKpiKey === key) { closeOsKpiDetail(); return; }
    closeOsKpiDetail();
    _activeOsKpiKey = key;
    document.querySelectorAll('#osKpis .kpi-card').forEach(function(el) { el.classList.toggle('active', el.dataset.key === key); });
    renderOsKpiDetail(key);
}
function closeOsKpiDetail() {
    _activeOsKpiKey = null;
    document.querySelectorAll('#osKpis .kpi-card').forEach(function(el) { el.classList.remove('active'); });
    var ov = document.getElementById('sdOverlay-os'); if (ov) ov.remove();
    var ct = document.getElementById('sdContainer-os'); if (ct) ct.remove();
}
function renderOsKpiDetail(key) {
    var container = document.getElementById('osKpiDetail');
    if (!container) return;
    var title = '', icon = '', color = '', statusFilter = '';
    if (key === 'os-kpi-total') { title = 'Todas as OS'; icon = 'fa-clipboard-list'; color = 'cyan'; statusFilter = ''; }
    else if (key === 'os-kpi-abertas') { title = 'OS Abertas'; icon = 'fa-folder-open'; color = 'orange'; statusFilter = '&status=ABERTA'; }
    else if (key === 'os-kpi-analise') { title = 'OS Em Analise'; icon = 'fa-search'; color = 'yellow'; statusFilter = '&status=EM_ANALISE'; }
    else if (key === 'os-kpi-execucao') { title = 'OS Em Execu��o'; icon = 'fa-cogs'; color = 'green'; statusFilter = '&status=EM_EXECUCAO'; }
    else if (key === 'os-kpi-concluidas') { title = 'OS Conclu�das'; icon = 'fa-check-circle'; color = 'green'; statusFilter = '&status=CONCLUIDA'; }
    apiFetch('/api/ordens-servico?page=0&size=100' + statusFilter).then(function(d) {
        closeOsKpiDetail();
        var list = (d.content || d || []);
        var count = list.length;
        var ov = document.createElement('div'); ov.id = 'sdOverlay-os'; ov.className = 'sd-overlay';
        var ct = document.createElement('div'); ct.id = 'sdContainer-os'; ct.className = 'sd-container';
        var itemsHtml = list.map(function(o) {
            return '<div class="stat-detail-item" onclick="showOrdemForm(' + o.id + ')"><div class="stat-detail-item-icon" style="background:var(--' + color + '-bg);color:var(--' + color + ');"><i class="fas fa-clipboard-list"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">' + escapeHtml(o.titulo) + '</div><div class="stat-detail-item-sub">' + escapeHtml(o.computadorNome || 'Sem v�nculo') + ' - ' + escapeHtml(o.solicitante || '') + '</div></div><div class="stat-detail-item-badge"><span class="badge badge-' + escapeHtml((o.status || 'ABERTA').toLowerCase().replace(/_/g, '-')) + '">' + escapeHtml((o.status || 'ABERTA').replace(/_/g, ' ')) + '</span></div></div>';
        }).join('');
        if (!itemsHtml) itemsHtml = '<div class="stat-detail-empty"><i class="fas fa-inbox"></i> Nenhum item encontrado</div>';
        ct.innerHTML = '<div class="stat-detail-header"><h4><i class="fas ' + icon + '" style="color:var(--' + color + ');"></i> ' + title + ' <span style="font-weight:400;font-size:11px;color:var(--text-muted);">(' + count + ' itens)</span></h4><button class="stat-detail-close" onclick="closeOsKpiDetail()"><i class="fas fa-times"></i> Fechar</button></div><div class="stat-detail-body">' + itemsHtml + '</div>';
        document.body.appendChild(ov); document.body.appendChild(ct);
    });
}

function renderOrdensServico(data, searchTerm) {
    var tb = document.querySelector('#ordensTable tbody');
    if (!tb) return;
    if (!data.content || data.content.length === 0) {
        tb.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted)"><i class="fas fa-inbox"></i> Nenhuma ordem encontrada</td></tr>';
        var op = document.getElementById('os-pagination'); if (op) op.innerHTML = '';
        return;
    }
    var items = data.content;
    if (searchTerm) {
        var sl = searchTerm.toLowerCase();
        items = items.filter(function(o) { return (o.titulo || '').toLowerCase().indexOf(sl) !== -1 || (o.solicitante || '').toLowerCase().indexOf(sl) !== -1 || (o.computadorNome || '').toLowerCase().indexOf(sl) !== -1; });
    }
    var priorityColors = { 'BAIXA': 'var(--green)', 'MEDIA': 'var(--yellow)', 'ALTA': 'var(--orange)', 'CRITICA': 'var(--red)' };
    var priorityBg = { 'BAIXA': 'var(--green-bg)', 'MEDIA': 'var(--yellow-bg)', 'ALTA': 'var(--orange-bg)', 'CRITICA': 'var(--red-bg)' };
    var statusColors = { 'ABERTA': 'badge-aberta', 'EM_ANALISE': 'badge-em-analise', 'EM_EXECUCAO': 'badge-em-execucao', 'CONCLUIDA': 'badge-concluida', 'CANCELADA': 'badge-cancelada' };
    var statusIcons = { 'ABERTA': 'fa-folder-open', 'EM_ANALISE': 'fa-search', 'EM_EXECUCAO': 'fa-cogs', 'CONCLUIDA': 'fa-check-circle', 'CANCELADA': 'fa-times-circle' };
    var osPageSize = data.size || 10;
    var filteredOsTotalPages = data.totalPages || Math.max(1, Math.ceil((data.totalElements !== undefined ? data.totalElements : items.length) / osPageSize));
    var filteredOsPage = data.number !== undefined ? data.number : Math.min(currentPage.ordensServico || 0, filteredOsTotalPages - 1);
    if (filteredOsPage < 0) filteredOsPage = 0;
    renderPagination('os-pagination', filteredOsTotalPages, filteredOsPage, loadOrdensServico);
    var pagedOsItems = items;
    tb.innerHTML = pagedOsItems.map(function(o) {
        var dt = o.dataPrevisao ? new Date(o.dataPrevisao).toLocaleDateString('pt-BR') : '-';
        var dtAbertura = o.dataAbertura ? new Date(o.dataAbertura) : null;
        var tempoAberto = '';
        var diff = 0;
        if (dtAbertura) {
            diff = Math.floor((Date.now() - dtAbertura.getTime()) / 86400000);
            tempoAberto = diff === 0 ? 'Hoje' : diff + 'd';
        }
        var pColor = priorityColors[o.prioridade] || 'var(--text-muted)';
        var pBg = priorityBg[o.prioridade] || 'rgba(255,255,255,0.04)';
        var sIcon = statusIcons[o.status] || 'fa-circle';
        var isCompleted = o.status === 'CONCLUIDA' || o.status === 'CANCELADA';
        var rowOpacity = isCompleted ? 'opacity:0.55;' : '';
        return '<tr style="cursor:pointer;' + rowOpacity + '" onclick="showOrdemForm(' + o.id + ')">' +
            '<td style="font-weight:700;color:' + pColor + ';">#' + o.id + '</td>' +
            '<td style="max-width:250px;"><div style="display:flex;align-items:center;gap:8px;"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:' + pColor + ';flex-shrink:0;"></span><span style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(o.titulo) + '</span></div></td>' +
            '<td>' + (o.computadorNome ? escapeHtml(o.computadorNome) : '<span style="color:var(--text-muted)">-</span>') + '</td>' +
            '<td><span class="badge badge-' + escapeHtml((o.prioridade || 'MEDIA').toLowerCase()) + '">' + escapeHtml(o.prioridade || 'MEDIA') + '</span></td>' +
            '<td><span class="badge ' + (statusColors[o.status] || 'badge-pendente') + '" style="cursor:pointer;" onclick="event.stopPropagation();quickToggleOsStatus(' + o.id + ',\'' + escapeJsStr(o.status || 'ABERTA') + '\')"><i class="fas ' + sIcon + '" style="font-size:8px;margin-right:3px;"></i>' + escapeHtml((o.status || 'ABERTA').replace(/_/g, ' ')) + '</span></td>' +
            '<td>' + (o.solicitante ? escapeHtml(o.solicitante) : '<span style="color:var(--text-muted)">-</span>') + '</td>' +
            '<td><div style="text-align:center;"><div style="font-size:11px;">' + dt + '</div>' + (tempoAberto ? '<div style="font-size:9px;color:' + (diff > 7 ? 'var(--red)' : diff > 3 ? 'var(--yellow)' : 'var(--text-muted)') + ';">' + tempoAberto + '</div>' : '') + '</div></td>' +
            '<td onclick="event.stopPropagation()"><div style="display:flex;gap:4px;"><button onclick="showOrdemForm(' + o.id + ')" class="action-btn action-btn-edit"><i class="fas fa-pen"></i></button><button onclick="confirmDelete(\'ordem\',' + o.id + ',\'' + escapeJsStr(o.titulo) + '\')" class="action-btn action-btn-delete"><i class="fas fa-trash"></i></button></div></td></tr>';
    }).join('');
}

async function quickToggleOsStatus(id, currentStatus) {
    var nextStatus = { 'ABERTA': 'EM_ANALISE', 'EM_ANALISE': 'EM_EXECUCAO', 'EM_EXECUCAO': 'CONCLUIDA' };
    var newStatus = nextStatus[currentStatus];
    if (!newStatus) return;
    try {
        var o = await apiFetch('/api/ordens-servico/' + id);
        await apiFetch('/api/ordens-servico/' + id, { method: 'PUT', body: JSON.stringify({ ...o, status: newStatus }) });
        showToast('OS #' + id + ' alterada para ' + newStatus.replace(/_/g, ' '));
        refreshAllData();
    } catch (e) { showToast(e.message, 'error'); }
}

async function showOrdemForm(id) {
    var o = { titulo: '', descricao: '', prioridade: 'MEDIA', status: 'ABERTA', solicitante: '', tecnicoResponsavel: '' };
    if (id) { try { o = await apiFetch('/api/ordens-servico/' + id); } catch (e) { showToast('Erro ao carregar OS: ' + e.message, 'error'); return; } }
    try { allComputadores = await apiFetch('/api/computadores/paginado?page=0&size=1000&status=&termo='); } catch (e) { allComputadores = { content: [] }; }
    var compList = allComputadores.content || allComputadores;
    var osCompItems = compList.map(function(c) { return { value: String(c.id), label: c.nomePc, sub: c.numeroSerie }; });
    var osCompInit = compList.find(function(c) { return o.computadorId != null && c.id == o.computadorId; });
    var usuarios = [];
    try { usuarios = await apiFetch('/api/usuarios'); } catch (e) { }
    var tecnicos = usuarios.filter(function(u) { return u.perfil === 'ADMIN' || u.perfil === 'TECNICO'; });
    var osTecItems = tecnicos.map(function(u) { return { value: u.nomeCompleto, label: u.nomeCompleto, sub: u.perfil }; });
    var dataPrevisao = o.dataPrevisao ? o.dataPrevisao.substring(0, 10) : '';
    openModal(id ? 'Editar Ordem de Servi�o' : 'Nova Ordem de Servi�o',
        '<form id="osForm"><div class="form-group"><label class="form-label">Titulo *</label><input id="osTitulo" value="' + escapeAttr(o.titulo) + '" required class="form-input"></div>' +
        '<div class="form-group" style="margin-top:14px;"><label class="form-label">Descri��o</label><textarea id="osDescricao" class="form-input" style="min-height:80px;resize:vertical;">' + escapeHtml(o.descricao || '') + '</textarea></div>' +
        '<div class="form-group" style="margin-top:14px;"><label class="form-label">Equipamento</label><div class="searchable-dropdown"><input type="text" id="osCompSearch" class="form-input" placeholder="Buscar equipamento..." autocomplete="off" value="' + escapeAttr(osCompInit ? osCompInit.nomePc : (o.computadorNome || '')) + '"><input type="hidden" id="osComputador" value="' + (o.computadorId != null ? o.computadorId : '') + '"><div id="osCompList" class="searchable-dropdown-list" style="display:none;"></div></div></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px;"><div class="form-group"><label class="form-label">Prioridade</label><select id="osPrioridade" class="form-input"><option value="BAIXA"' + (o.prioridade === 'BAIXA' ? ' selected' : '') + '>Baixa</option><option value="MEDIA"' + (o.prioridade === 'MEDIA' ? ' selected' : '') + '>Media</option><option value="ALTA"' + (o.prioridade === 'ALTA' ? ' selected' : '') + '>Alta</option><option value="CRITICA"' + (o.prioridade === 'CRITICA' ? ' selected' : '') + '>Critica</option></select></div>' +
        '<div class="form-group"><label class="form-label">Status</label><select id="osStatus" class="form-input"><option value="ABERTA"' + (o.status === 'ABERTA' ? ' selected' : '') + '>Aberta</option><option value="EM_ANALISE"' + (o.status === 'EM_ANALISE' ? ' selected' : '') + '>Em Analise</option><option value="EM_EXECUCAO"' + (o.status === 'EM_EXECUCAO' ? ' selected' : '') + '>Em Execu��o</option><option value="CONCLUIDA"' + (o.status === 'CONCLUIDA' ? ' selected' : '') + '>Conclu�da</option><option value="CANCELADA"' + (o.status === 'CANCELADA' ? ' selected' : '') + '>Cancelada</option></select></div></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px;"><div class="form-group"><label class="form-label">Solicitante</label><input id="osSolicitante" value="' + escapeAttr(o.solicitante || '') + '" class="form-input"></div>' +
        '<div class="form-group"><label class="form-label">Respons�vel</label><div class="searchable-dropdown"><input type="text" id="osTecSearch" class="form-input" placeholder="Buscar respons�vel..." autocomplete="off" value="' + escapeAttr(o.tecnicoResponsavel || '') + '"><input type="hidden" id="osTecnico" value="' + escapeAttr(o.tecnicoResponsavel || '') + '"><div id="osTecList" class="searchable-dropdown-list" style="display:none;"></div></div></div></div>' +
        '<div class="form-group" style="margin-top:14px;"><label class="form-label">Data Previs�o</label><input type="date" id="osDataPrevisao" value="' + dataPrevisao + '" class="form-input"></div>' +
        '<div class="form-group" style="margin-top:14px;"><label class="form-label">Solu��o</label><textarea id="osSolucao" class="form-input" style="min-height:60px;resize:vertical;">' + escapeHtml(o.solucao || '') + '</textarea></div></form>',
        '<button onclick="closeModal()" class="btn btn-ghost btn-sm">Cancelar</button><button onclick="document.getElementById(\'osForm\').requestSubmit()" class="btn btn-primary btn-sm"><i class="fas fa-save"></i> ' + (id ? 'Salvar' : 'Cadastrar') + '</button>'
    );
    setupSearchableSelect('osCompSearch', 'osComputador', 'osCompList', osCompItems, false);
    setupSearchableSelect('osTecSearch', 'osTecnico', 'osTecList', osTecItems, false);
    document.getElementById('osForm').addEventListener('submit', async function(e) {
        e.preventDefault();
        var osCompVal = searchableValue('osCompSearch', 'osComputador', 'osCompList', false);
        var p = {
            titulo: document.getElementById('osTitulo').value,
            descricao: document.getElementById('osDescricao').value,
            computadorId: osCompVal ? parseInt(osCompVal) : null,
            prioridade: document.getElementById('osPrioridade').value,
            status: document.getElementById('osStatus').value,
            solicitante: document.getElementById('osSolicitante').value,
            tecnicoResponsavel: searchableValue('osTecSearch', 'osTecnico', 'osTecList', false),
            dataPrevisao: document.getElementById('osDataPrevisao').value ? document.getElementById('osDataPrevisao').value + 'T17:00:00' : null,
            solucao: document.getElementById('osSolucao').value
        };
        try {
            if (id) {
                await apiFetch('/api/ordens-servico/' + id, { method: 'PUT', body: JSON.stringify(p) });
                showToast('Ordem atualizada!');
            } else {
                await apiFetch('/api/ordens-servico', { method: 'POST', body: JSON.stringify(p) });
                showToast('Ordem criada!');
            }
            closeModal(); loadOrdensServico(0); refreshAllData();
        } catch (e) { showToast(e.message, 'error'); }
    });
}

// ==========================================
// REPORTS
// ==========================================
async function loadRelatorios() {
    try {
        var eqData = await apiFetch('/api/computadores/paginado?page=0&size=1000&status=&termo=');
        var eqList = eqData.content || eqData;
        var r2 = await Promise.all([apiFetch('/api/computadores/estatisticas').catch(function() { return null; }), apiFetch('/api/manutencoes/estatisticas').catch(function() { return null; }), apiFetch('/api/ordens-servico/estatisticas').catch(function() { return null; })]);
        renderChartMarcas(eqList); renderChartManTipos(r2[1]); renderChartManutencoesMes(r2[1]); renderChartOSPrioridade(r2[2]); renderChartOSStatus(r2[2]); renderChartManStatus(r2[1]); renderStatsGerais(r2[0], r2[1], r2[2]);
    } catch (e) { showToast('Erro ao carregar relat�rios', 'error'); }
}

function renderChartMarcas(eq) {
    var ctx = document.getElementById('chartMarcas'); if (!ctx) return; if (ctx._chart) ctx._chart.destroy();
    var m = {}; (eq || []).forEach(function(e) { var k = ((e.modeloMarca || '').split(' ')[0]) || 'Outro'; m[k] = (m[k] || 0) + 1; });
    var s = Object.entries(m).sort(function(a, b) { return b[1] - a[1]; }).slice(0, 10);
    if (s.length === 0) s = [['Sem dados', 0]];
    var palette = [['#7dfce4','#30c8a8','#0affdc'],['#b090f0','#9070d0','#c0a0ff'],['#f080b0','#d06090','#ff70a0'],['#f0b060','#d09040','#ffb840'],['#70e8a0','#40c880','#60ffb0'],['#70b0f0','#5090d0','#60c0ff'],['#f08080','#d06060','#ff7070'],['#f8e070','#d8b830','#ffe840'],['#50d0d0','#30b0c0','#60e8e8'],['#a090e0','#8070c0','#b0a0ff']];
    var cArr = s.map(function(_, i) { var p = palette[i % palette.length]; var g = ctx.getContext('2d').createLinearGradient(0,0,400,0); g.addColorStop(0,'#ffffff'); g.addColorStop(0.05,p[2]); g.addColorStop(0.15,p[0]); g.addColorStop(0.55,p[0]); g.addColorStop(1,p[1]); return g; });
    ctx._chart = new Chart(ctx, { type: 'bar', data: { labels: s.map(function(x) { return x[0]; }), datasets: [{ label: 'Quantidade', data: s.map(function(x) { return x[1]; }), backgroundColor: cArr, borderRadius: 6, borderSkipped: false, barPercentage: 0.65 }] }, options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, layout: { padding: { right: 16 } }, plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(10,16,32,0.95)', titleColor: '#00e5c7', bodyColor: '#e4e8f1', borderColor: 'rgba(0,229,199,0.25)', borderWidth: 1, cornerRadius: 8, padding: 10, callbacks: { label: function(c) { return c.raw + ' equipamento(s)'; } } } }, scales: { x: { beginAtZero: true, ticks: { color: '#4e5a72', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.03)', lineWidth: 1 } }, y: { ticks: { color: '#8892a8', font: { size: 10, weight: '500' } }, grid: { display: false } } } } });
}

function renderChartManutencoesMes(s) {
    var ctx = document.getElementById('chartManutencoesMes'); if (!ctx) return; if (ctx._chart) ctx._chart.destroy();
    var d = (s && s.porMes) || {}; var keys = Object.keys(d).sort().slice(-8);
    var lb = keys.map(function(k) { var p = k.split('-'); return p[1] + '/' + p[0].slice(2); });
    var vl = keys.map(function(k) { return d[k]; });
    if (lb.length === 0) { lb = ['Sem dados']; vl = [0]; }
    var gFill = ctx.getContext('2d').createLinearGradient(0,0,0,260); gFill.addColorStop(0,'rgba(125,252,228,0.25)'); gFill.addColorStop(0.5,'rgba(125,252,228,0.08)'); gFill.addColorStop(1,'rgba(125,252,228,0.01)');
    var gLine = ctx.getContext('2d').createLinearGradient(0,0,400,0); gLine.addColorStop(0,'#7dfce4'); gLine.addColorStop(0.5,'#50e8d0'); gLine.addColorStop(1,'#30c8b0');
    ctx._chart = new Chart(ctx, { type: 'line', data: { labels: lb, datasets: [{ label: 'Manuten��es', data: vl, borderColor: gLine, backgroundColor: gFill, fill: true, tension: 0.4, pointRadius: 4, pointBackgroundColor: '#00e5c7', pointBorderColor: '#0c1022', pointBorderWidth: 2, pointHoverRadius: 7, pointHoverBackgroundColor: '#00e5c7', pointHoverBorderColor: '#fff', pointHoverBorderWidth: 2, borderWidth: 2.5 }] }, options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 8, bottom: 4 } }, plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(10,16,32,0.95)', titleColor: '#00e5c7', bodyColor: '#e4e8f1', borderColor: 'rgba(0,229,199,0.25)', borderWidth: 1, cornerRadius: 8, padding: 10, callbacks: { label: function(c) { return c.raw + ' manuten��o(oes)'; } } } }, scales: { y: { beginAtZero: true, ticks: { color: '#4e5a72', font: { size: 10 }, stepSize: 1 }, grid: { color: 'rgba(255,255,255,0.03)', lineWidth: 1 } }, x: { ticks: { color: '#8892a8', font: { size: 10 } }, grid: { display: false } } } } });
}

function renderChartManTipos(man) {
    var ctx = document.getElementById('chartManTipo'); if (!ctx) return; if (ctx._chart) ctx._chart.destroy();
    var d = (man && man.porTipo) || {}; var labels = Object.keys(d); var vals = Object.values(d);
    if (labels.length === 0) { labels = ['Sem dados']; vals = [0]; }
    var palette = [['#7dfce4','#30c8a8','#0affdc'],['#b090f0','#9070d0','#c0a0ff'],['#f080b0','#d06090','#ff70a0'],['#f0b060','#d09040','#ffb840'],['#70e8a0','#40c880','#60ffb0'],['#70b0f0','#5090d0','#60c0ff']];
    var cArr = labels.map(function(_, i) { var p = palette[i % palette.length]; var g = ctx.getContext('2d').createRadialGradient(90,90,5,90,90,160); g.addColorStop(0,'#ffffff'); g.addColorStop(0.08,p[2]); g.addColorStop(0.25,p[0]); g.addColorStop(0.65,p[0]); g.addColorStop(1,p[1]); return g; });
    ctx._chart = new Chart(ctx, { type: 'doughnut', data: { labels: labels, datasets: [{ data: vals, backgroundColor: cArr, borderWidth: 2, borderColor: 'rgba(8,12,24,0.9)', hoverOffset: 8 }] }, options: { responsive: true, maintainAspectRatio: false, cutout: '65%', layout: { padding: 8 }, plugins: { legend: { position: 'bottom', labels: { color: '#8892a8', padding: 12, usePointStyle: true, pointStyle: 'circle', font: { size: 10, family: 'Inter' } } }, tooltip: { backgroundColor: 'rgba(10,16,32,0.95)', titleColor: '#00e5c7', bodyColor: '#e4e8f1', borderColor: 'rgba(0,229,199,0.25)', borderWidth: 1, cornerRadius: 8, padding: 10, callbacks: { label: function(c) { var total = c.dataset.data.reduce(function(a, b) { return a + b; }, 0); var pct = total > 0 ? Math.round(c.raw / total * 100) : 0; return c.label + ': ' + c.raw + ' (' + pct + '%)'; } } } } } });
}

function renderChartOSPrioridade(os) {
    var ctx = document.getElementById('chartOSPrioridade'); if (!ctx) return; if (ctx._chart) ctx._chart.destroy();
    var d = (os && os.porPrioridade) || {}; var labels = Object.keys(d); var vals = Object.values(d);
    if (labels.length === 0) { labels = ['Sem dados']; vals = [0]; }
    var palette = [['#70e8a0','#40c880','#60ffb0'],['#f8e070','#d8b830','#ffe840'],['#f0b060','#d09040','#ffb840'],['#f080b0','#d06090','#ff70a0'],['#b080f0','#9060d0','#c0a0ff']];
    var cArr = labels.map(function(_, i) { var p = palette[i % palette.length]; var g = ctx.getContext('2d').createRadialGradient(90,90,5,90,90,160); g.addColorStop(0,'#ffffff'); g.addColorStop(0.08,p[2]); g.addColorStop(0.25,p[0]); g.addColorStop(0.65,p[0]); g.addColorStop(1,p[1]); return g; });
    ctx._chart = new Chart(ctx, { type: 'doughnut', data: { labels: labels, datasets: [{ data: vals, backgroundColor: cArr, borderWidth: 2, borderColor: 'rgba(8,12,24,0.9)', hoverOffset: 8 }] }, options: { responsive: true, maintainAspectRatio: false, cutout: '65%', layout: { padding: 8 }, plugins: { legend: { position: 'bottom', labels: { color: '#8892a8', padding: 12, usePointStyle: true, pointStyle: 'circle', font: { size: 10, family: 'Inter' } } }, tooltip: { backgroundColor: 'rgba(10,16,32,0.95)', titleColor: '#00e5c7', bodyColor: '#e4e8f1', borderColor: 'rgba(0,229,199,0.25)', borderWidth: 1, cornerRadius: 8, padding: 10, callbacks: { label: function(c) { var total = c.dataset.data.reduce(function(a, b) { return a + b; }, 0); var pct = total > 0 ? Math.round(c.raw / total * 100) : 0; return c.label + ': ' + c.raw + ' (' + pct + '%)'; } } } } } });
}

function renderChartOSStatus(os) {
    var ctx = document.getElementById('chartOSStatus'); if (!ctx) return; if (ctx._chart) ctx._chart.destroy();
    var labels = ['Aberta', 'Em Analise', 'Em Execu��o', 'Conclu�da', 'Cancelada'];
    var vals = [os.abertas || 0, os.emAnalise || 0, os.emExecucao || 0, os.concluidas || 0, os.canceladas || 0];
    var palette = [['#70b0f0','#5090d0','#60c0ff'],['#f8e070','#d8b830','#ffe840'],['#7dfce4','#30c8a8','#0affdc'],['#70e8a0','#40c880','#60ffb0'],['#f08080','#d06060','#ff7070']];
    var cArr = labels.map(function(_, i) { var p = palette[i]; var g = ctx.getContext('2d').createRadialGradient(90,90,5,90,90,160); g.addColorStop(0,'#ffffff'); g.addColorStop(0.08,p[2]); g.addColorStop(0.25,p[0]); g.addColorStop(0.65,p[0]); g.addColorStop(1,p[1]); return g; });
    ctx._chart = new Chart(ctx, { type: 'doughnut', data: { labels: labels, datasets: [{ data: vals, backgroundColor: cArr, borderWidth: 0, hoverOffset: 8 }] }, options: { responsive: true, maintainAspectRatio: false, cutout: '65%', layout: { padding: 8 }, plugins: { legend: { position: 'bottom', labels: { color: '#8892a8', padding: 12, usePointStyle: true, pointStyle: 'circle', font: { size: 10, family: 'Inter' } } }, tooltip: { backgroundColor: 'rgba(10,16,32,0.95)', titleColor: '#00e5c7', bodyColor: '#e4e8f1', borderColor: 'rgba(0,229,199,0.25)', borderWidth: 1, cornerRadius: 8, padding: 10, callbacks: { label: function(c) { var total = c.dataset.data.reduce(function(a, b) { return a + b; }, 0); var pct = total > 0 ? Math.round(c.raw / total * 100) : 0; return c.label + ': ' + c.raw + ' (' + pct + '%)'; } } } } } });
}

function renderChartManStatus(man) {
    var ctx = document.getElementById('chartManStatus'); if (!ctx) return; if (ctx._chart) ctx._chart.destroy();
    var d = (man && man.porStatus) || {}; var labels = Object.keys(d); var vals = Object.values(d);
    if (labels.length === 0) { labels = ['Sem dados']; vals = [0]; }
    var palette = [['#f8e070','#d8b830','#ffe840'],['#7dfce4','#30c8a8','#0affdc'],['#70e8a0','#40c880','#60ffb0'],['#f08080','#d06060','#ff7070'],['#909098','#707078','#b0b0b8']];
    var cArr = labels.map(function(_, i) { var p = palette[i % palette.length]; var g = ctx.getContext('2d').createLinearGradient(0,0,0,260); g.addColorStop(0,'#ffffff'); g.addColorStop(0.05,p[2]); g.addColorStop(0.15,p[0]); g.addColorStop(0.6,p[0]); g.addColorStop(1,p[1]); return g; });
    ctx._chart = new Chart(ctx, { type: 'bar', data: { labels: labels, datasets: [{ label: 'Quantidade', data: vals, backgroundColor: cArr, borderRadius: 6, borderSkipped: false, barPercentage: 0.6 }] }, options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 8 } }, plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(10,16,32,0.95)', titleColor: '#00e5c7', bodyColor: '#e4e8f1', borderColor: 'rgba(0,229,199,0.25)', borderWidth: 1, cornerRadius: 8, padding: 10 } }, scales: { x: { ticks: { color: '#8892a8', font: { size: 10 } }, grid: { display: false } }, y: { beginAtZero: true, ticks: { color: '#4e5a72', font: { size: 10 }, stepSize: 1 }, grid: { color: 'rgba(255,255,255,0.03)', lineWidth: 1 } } } } });
}

function exportRelatoriosCSV() {
    var rows = [];
    rows.push(['Relat�rio de Estat�sticas - Invent�rio de TI']);
    rows.push(['Data: ' + new Date().toLocaleDateString('pt-BR') + ' ' + new Date().toLocaleTimeString('pt-BR')]);
    rows.push([]);
    rows.push(['Categoria', 'M�trica', 'Valor']);
    var gc = document.getElementById('statsGerais');
    if (gc) {
        var groups = gc.querySelectorAll('.stat-card-group');
        groups.forEach(function(gr) {
            var title = gr.querySelector('.stat-card-group-title');
            var grpName = title ? title.textContent.trim() : '';
            var items = gr.querySelectorAll('.stat-card-item');
            items.forEach(function(item) {
                var val = item.querySelector('.stat-card-value');
                var lbl = item.querySelector('.stat-card-label');
                if (val && lbl) rows.push([grpName, lbl.textContent.trim(), val.textContent.trim()]);
            });
        });
    }
    function csvEscape(val) {
        var s = String(val || '');
        if (s.indexOf(';') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
            return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
    }
    var csv = rows.map(function(r) { return r.map(csvEscape).join(';'); }).join('\n');
    var BOM = '\uFEFF';
    var blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob); var a = document.createElement('a'); a.href = url; a.download = 'relat�rios_invent�rio_ti_' + new Date().toISOString().slice(0, 10) + '.csv'; a.click(); setTimeout(function() { URL.revokeObjectURL(url); }, 100);
    showToast('Relat�rio exportado!');
}

function renderStatsGerais(eq, man, os) {
    var div = document.getElementById('statsGerais'); if (!div) return; eq = eq || {}; man = man || {}; os = os || {};
    _relData = { eq: eq, man: man, os: os };
    var totalMan = (eq.manutencaoPreditiva || 0) + (eq.manutencaoPreventiva || 0) + (eq.manutencaoEmergencial || 0);
    var html = '';
    html += '<div class="stat-card-group"><div class="stat-card-group-title"><i class="fas fa-desktop"></i> COMPUTADORES</div><div class="stat-card-items">';
    html += '<div class="stat-card-item" onclick="toggleStatDetail(\'eq-total\')" data-key="eq-total"><div class="stat-card-icon cyan"><i class="fas fa-desktop"></i></div><div><div class="stat-card-value">' + (eq.total || 0) + '</div><div class="stat-card-label">Total Computadores</div></div></div>';
    html += '<div class="stat-card-item" onclick="toggleStatDetail(\'eq-ativos\')" data-key="eq-ativos"><div class="stat-card-icon green"><i class="fas fa-check-circle"></i></div><div><div class="stat-card-value">' + (eq.ativos || 0) + '</div><div class="stat-card-label">Ativos</div></div></div>';
    html += '<div class="stat-card-item" onclick="toggleStatDetail(\'eq-manut\')" data-key="eq-manut"><div class="stat-card-icon yellow"><i class="fas fa-wrench"></i></div><div><div class="stat-card-value">' + totalMan + '</div><div class="stat-card-label">Em Manuten��o</div></div></div>';
    html += '</div></div>';
    html += '<div class="stat-card-group" style="margin-top:14px;"><div class="stat-card-group-title"><i class="fas fa-wrench"></i> MANUTENCOES</div><div class="stat-card-items">';
    html += '<div class="stat-card-item" onclick="toggleStatDetail(\'man-total\')" data-key="man-total"><div class="stat-card-icon orange"><i class="fas fa-tools"></i></div><div><div class="stat-card-value">' + (man.total || 0) + '</div><div class="stat-card-label">Total Manuten��es</div></div></div>';
    html += '<div class="stat-card-item" onclick="toggleStatDetail(\'man-pendentes\')" data-key="man-pendentes"><div class="stat-card-icon yellow"><i class="fas fa-clock"></i></div><div><div class="stat-card-value">' + (man.pendentes || 0) + '</div><div class="stat-card-label">Pendentes</div></div></div>';
    html += '<div class="stat-card-item" onclick="toggleStatDetail(\'man-concluidas\')" data-key="man-concluidas"><div class="stat-card-icon green"><i class="fas fa-check-double"></i></div><div><div class="stat-card-value">' + (man.concluidas || 0) + '</div><div class="stat-card-label">Conclu�das</div></div></div>';
    html += '</div></div>';
    html += '<div class="stat-card-group" style="margin-top:14px;"><div class="stat-card-group-title"><i class="fas fa-clock"></i> CICLO MANUTENCAO (8 meses)</div><div class="stat-card-items">';
    html += '<div class="stat-card-item" onclick="toggleStatDetail(\'ciclo-ativos\')" data-key="ciclo-ativos"><div class="stat-card-icon green"><i class="fas fa-check-circle"></i></div><div><div class="stat-card-value">' + (eq.faseAtivo || 0) + '</div><div class="stat-card-label">Ativos (0-4m)</div></div></div>';
    html += '<div class="stat-card-item" onclick="toggleStatDetail(\'ciclo-preditivos\')" data-key="ciclo-preditivos"><div class="stat-card-icon yellow"><i class="fas fa-search"></i></div><div><div class="stat-card-value">' + (eq.fasePreditivo || 0) + '</div><div class="stat-card-label">Preditivos (5-6m)</div></div></div>';
    html += '<div class="stat-card-item" onclick="toggleStatDetail(\'ciclo-preventivos\')" data-key="ciclo-preventivos"><div class="stat-card-icon orange"><i class="fas fa-shield-alt"></i></div><div><div class="stat-card-value">' + (eq.fasePreventivo || 0) + '</div><div class="stat-card-label">Preventivos (7-8m)</div></div></div>';
    html += '<div class="stat-card-item" onclick="toggleStatDetail(\'ciclo-atrasados\')" data-key="ciclo-atrasados"><div class="stat-card-icon red"><i class="fas fa-exclamation-triangle"></i></div><div><div class="stat-card-value">' + (eq.faseAtrasado || 0) + '</div><div class="stat-card-label">Atrasados (8m+)</div></div></div>';
    html += '</div></div>';
    html += '<div class="stat-card-group" style="margin-top:14px;"><div class="stat-card-group-title"><i class="fas fa-clipboard-list"></i> ORDENS DE SERVICO</div><div class="stat-card-items">';
    html += '<div class="stat-card-item" onclick="toggleStatDetail(\'os-total\')" data-key="os-total"><div class="stat-card-icon purple"><i class="fas fa-clipboard-list"></i></div><div><div class="stat-card-value">' + (os.total || 0) + '</div><div class="stat-card-label">Total OS</div></div></div>';
    html += '<div class="stat-card-item" onclick="toggleStatDetail(\'os-abertas\')" data-key="os-abertas"><div class="stat-card-icon red"><i class="fas fa-folder-open"></i></div><div><div class="stat-card-value">' + (os.abertas || 0) + '</div><div class="stat-card-label">OS Abertas</div></div></div>';
    html += '<div class="stat-card-item" onclick="toggleStatDetail(\'os-execucao\')" data-key="os-execucao"><div class="stat-card-icon cyan"><i class="fas fa-cogs"></i></div><div><div class="stat-card-value">' + (os.emExecucao || 0) + '</div><div class="stat-card-label">OS Em Execu��o</div></div></div>';
    html += '<div class="stat-card-item" onclick="toggleStatDetail(\'os-concluidas\')" data-key="os-concluidas"><div class="stat-card-icon green"><i class="fas fa-check-circle"></i></div><div><div class="stat-card-value">' + (os.concluidas || 0) + '</div><div class="stat-card-label">OS Conclu�das</div></div></div>';
    html += '</div></div>';
    div.innerHTML = html;
    var ts = document.getElementById('relatorioTimestamp');
    if (ts) ts.textContent = 'Atualizado: ' + new Date().toLocaleString('pt-BR');
    var pd = document.getElementById('printDate');
    if (pd) pd.textContent = new Date().toLocaleDateString('pt-BR') + ' ' + new Date().toLocaleTimeString('pt-BR');
    var pfd = document.getElementById('printFooterDate');
    if (pfd) pfd.textContent = new Date().toLocaleDateString('pt-BR');
}

// ==========================================
// STAT DETAIL PANELS (Reports)
// ==========================================
function toggleStatDetail(key) {
    if (_activeStatKey === key) { closeStatDetail(); return; }
    closeStatDetail();
    _activeStatKey = key;
    document.querySelectorAll('.stat-card-item').forEach(function(el) { el.classList.toggle('active', el.dataset.key === key); });
    renderStatDetailPanel(key);
}

function closeStatDetail() {
    _activeStatKey = null;
    document.querySelectorAll('.stat-card-item').forEach(function(el) { el.classList.remove('active'); });
    var ov = document.getElementById('sdOverlay'); if (ov) ov.remove();
    var ct = document.getElementById('sdContainer'); if (ct) ct.remove();
}

function renderStatDetailPanel(key) {
    var container = document.getElementById('statDetail');
    if (!container) return;
    var title = '', icon = '', color = '';
    var sm = { 'ATIVO': { c: 'badge-ativo', i: 'fa-check-circle' }, 'MANUTENCAO_PREDITIVA': { c: 'badge-preditiva', i: 'fa-search' }, 'MANUTENCAO_PREVENTIVA': { c: 'badge-preventiva', i: 'fa-shield-alt' }, 'MANUTENCAO_EMERGENCIAL': { c: 'badge-emergencial', i: 'fa-exclamation-triangle' }, 'CONCLUIDO': { c: 'badge-concluido', i: 'fa-check-double' } };
    var statusMap = { 'PENDENTE': 'badge-pendente', 'EM_ANDAMENTO': 'badge-em_andamento', 'CONCLUIDA': 'badge-concluida', 'CANCELADA': 'badge-cancelada', 'ABERTA': 'badge-aberta', 'EM_ANALISE': 'badge-em-analise', 'EM_EXECUCAO': 'badge-em-execucao' };

    if (key === 'eq-total') {
        title = 'Todos os Computadores'; icon = 'fa-desktop'; color = 'cyan';
        apiFetch('/api/computadores/paginado?page=0&size=1000&status=&termo=').then(function(d) {
            var list = d.content || d || [];
            renderStatDetailHTML(container, title, icon, color, list.map(function(eq) {
                var s = sm[eq.status || 'ATIVO'] || { c: 'badge-inativo', i: 'fa-circle' };
                var sl = escapeHtml((eq.status || 'ATIVO').replace('MANUTENCAO_', 'Man. ').replace(/_/g, ' '));
                return '<div class="stat-detail-item" onclick="showComputadorDetail(' + eq.id + ')"><div class="stat-detail-item-icon" style="background:var(--cyan-bg);color:var(--cyan);"><i class="fas fa-desktop"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">' + escapeHtml(eq.nomePc) + '</div><div class="stat-detail-item-sub">' + escapeHtml(eq.modeloMarca) + ' - ' + escapeHtml(eq.usuarioDesignado || 'Sem usuario') + '</div></div><div class="stat-detail-item-badge"><span class="badge ' + s.c + '"><i class="fas ' + s.i + '"></i> ' + sl + '</span></div></div>';
            }).join(''));
        });
    } else if (key === 'eq-ativos') {
        title = 'Computadores Ativos'; icon = 'fa-check-circle'; color = 'green';
        apiFetch('/api/computadores/paginado?page=0&size=1000&status=ATIVO&termo=').then(function(d) {
            var list = d.content || d || [];
            renderStatDetailHTML(container, title, icon, color, list.map(function(eq) {
                return '<div class="stat-detail-item" onclick="showComputadorDetail(' + eq.id + ')"><div class="stat-detail-item-icon" style="background:var(--green-bg);color:var(--green);"><i class="fas fa-desktop"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">' + escapeHtml(eq.nomePc) + '</div><div class="stat-detail-item-sub">' + escapeHtml(eq.modeloMarca) + ' - ' + escapeHtml(eq.usuarioDesignado || 'Sem usuario') + '</div></div><div class="stat-detail-item-badge"><span class="badge badge-ativo"><i class="fas fa-check-circle"></i> Ativo</span></div></div>';
            }).join(''));
        });
    } else if (key === 'eq-manut') {
        title = 'Computadores em Manuten��o'; icon = 'fa-wrench'; color = 'yellow';
        Promise.all([
            apiFetch('/api/computadores/paginado?page=0&size=1000&status=MANUTENCAO_PREDITIVA&termo='),
            apiFetch('/api/computadores/paginado?page=0&size=1000&status=MANUTENCAO_PREVENTIVA&termo='),
            apiFetch('/api/computadores/paginado?page=0&size=1000&status=MANUTENCAO_EMERGENCIAL&termo=')
        ]).then(function(results) {
            var list = [];
            results.forEach(function(d) { list = list.concat(d.content || d || []); });
            list.sort(function(a, b) { return a.id - b.id; });
            renderStatDetailHTML(container, title, icon, color, list.map(function(eq) {
                var s = sm[eq.status || 'ATIVO'] || { c: 'badge-inativo', i: 'fa-circle' };
                var sl = escapeHtml((eq.status || 'ATIVO').replace('MANUTENCAO_', 'Man. ').replace(/_/g, ' '));
                return '<div class="stat-detail-item" onclick="showComputadorDetail(' + eq.id + ')"><div class="stat-detail-item-icon" style="background:var(--yellow-bg);color:var(--yellow);"><i class="fas fa-desktop"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">' + escapeHtml(eq.nomePc) + '</div><div class="stat-detail-item-sub">' + escapeHtml(eq.modeloMarca) + ' - ' + escapeHtml(eq.usuarioDesignado || 'Sem usuario') + '</div></div><div class="stat-detail-item-badge"><span class="badge ' + s.c + '"><i class="fas ' + s.i + '"></i> ' + sl + '</span></div></div>';
            }).join(''));
        });
    } else if (key === 'ciclo-ativos') {
        title = 'Computadores na Fase Ativa (0-4 meses)'; icon = 'fa-check-circle'; color = 'green';
        apiFetch('/api/computadores/paginado?page=0&size=1000&status=ATIVO&termo=').then(function(d) {
            var list = d.content || d || [];
            renderStatDetailHTML(container, title, icon, color, list.map(function(eq) {
                return '<div class="stat-detail-item" onclick="showComputadorDetail(' + eq.id + ')"><div class="stat-detail-item-icon" style="background:var(--green-bg);color:var(--green);"><i class="fas fa-check-circle"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">' + escapeHtml(eq.nomePc) + '</div><div class="stat-detail-item-sub">' + escapeHtml(eq.modeloMarca) + ' - ' + escapeHtml(eq.usuarioDesignado || 'Sem usuario') + '</div></div><div class="stat-detail-item-badge"><span class="badge badge-ativo">Ativo</span></div></div>';
            }).join(''));
        });
    } else if (key === 'ciclo-preditivos') {
        title = 'Computadores na Fase Preditiva (5-6 meses)'; icon = 'fa-search'; color = 'yellow';
        apiFetch('/api/computadores/paginado?page=0&size=1000&status=MANUTENCAO_PREDITIVA&termo=').then(function(d) {
            var list = d.content || d || [];
            renderStatDetailHTML(container, title, icon, color, list.map(function(eq) {
                return '<div class="stat-detail-item" onclick="showComputadorDetail(' + eq.id + ')"><div class="stat-detail-item-icon" style="background:var(--yellow-bg);color:var(--yellow);"><i class="fas fa-search"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">' + escapeHtml(eq.nomePc) + '</div><div class="stat-detail-item-sub">' + escapeHtml(eq.modeloMarca) + ' - ' + escapeHtml(eq.usuarioDesignado || 'Sem usuario') + '</div></div><div class="stat-detail-item-badge"><span class="badge badge-preditiva">Preditiva</span></div></div>';
            }).join(''));
        });
    } else if (key === 'ciclo-preventivos') {
        title = 'Computadores na Fase Preventiva (7-8 meses)'; icon = 'fa-shield-alt'; color = 'orange';
        apiFetch('/api/computadores/paginado?page=0&size=1000&status=MANUTENCAO_PREVENTIVA&termo=').then(function(d) {
            var list = d.content || d || [];
            renderStatDetailHTML(container, title, icon, color, list.map(function(eq) {
                return '<div class="stat-detail-item" onclick="showComputadorDetail(' + eq.id + ')"><div class="stat-detail-item-icon" style="background:var(--orange-bg);color:var(--orange);"><i class="fas fa-shield-alt"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">' + escapeHtml(eq.nomePc) + '</div><div class="stat-detail-item-sub">' + escapeHtml(eq.modeloMarca) + ' - ' + escapeHtml(eq.usuarioDesignado || 'Sem usuario') + '</div></div><div class="stat-detail-item-badge"><span class="badge badge-preventiva">Preventiva</span></div></div>';
            }).join(''));
        });
    } else if (key === 'ciclo-atrasados') {
        title = 'Computadores Atrasados (8m+)'; icon = 'fa-exclamation-triangle'; color = 'red';
        apiFetch('/api/computadores/paginado?page=0&size=1000&status=MANUTENCAO_EMERGENCIAL&termo=').then(function(d) {
            var list = d.content || d || [];
            renderStatDetailHTML(container, title, icon, color, list.map(function(eq) {
                return '<div class="stat-detail-item" onclick="showComputadorDetail(' + eq.id + ')"><div class="stat-detail-item-icon" style="background:var(--red-bg);color:var(--red);"><i class="fas fa-exclamation-triangle"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">' + escapeHtml(eq.nomePc) + '</div><div class="stat-detail-item-sub">' + escapeHtml(eq.modeloMarca) + ' - ' + escapeHtml(eq.usuarioDesignado || 'Sem usuario') + '</div></div><div class="stat-detail-item-badge"><span class="badge badge-emergencial">Emergencial</span></div></div>';
            }).join(''));
        });
    } else if (key === 'man-total') {
        title = 'Todas as Manuten��es'; icon = 'fa-wrench'; color = 'orange';
        apiFetch('/api/manutencoes?page=0&size=100&showConcluidas=true').then(function(d) {
            var list = d.content || d || [];
            renderStatDetailHTML(container, title, icon, color, list.map(function(m) {
                var st = statusMap[m.status || 'PENDENTE'] || 'badge-pendente';
                return '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--orange-bg);color:var(--orange);"><i class="fas fa-wrench"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">' + escapeHtml(m.computadorNome || 'PC #' + m.computadorId) + '</div><div class="stat-detail-item-sub">' + escapeHtml(m.tipo) + ' - ' + escapeHtml(m.tecnicoResponsavel || 'Sem tecnico') + '</div></div><div class="stat-detail-item-badge"><span class="badge ' + st + '">' + escapeHtml((m.status || 'PENDENTE').replace(/_/g, ' ')) + '</span></div></div>';
            }).join(''));
        });
    } else if (key === 'man-pendentes') {
        title = 'Manuten��es Pendentes'; icon = 'fa-clock'; color = 'yellow';
        apiFetch('/api/manutencoes?page=0&size=100&status=PENDENTE').then(function(d) {
            var list = d.content || d || [];
            renderStatDetailHTML(container, title, icon, color, list.map(function(m) {
                return '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--yellow-bg);color:var(--yellow);"><i class="fas fa-clock"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">' + escapeHtml(m.computadorNome || 'PC #' + m.computadorId) + '</div><div class="stat-detail-item-sub">' + escapeHtml(m.tipo) + ' - ' + escapeHtml(m.tecnicoResponsavel || 'Sem tecnico') + '</div></div><div class="stat-detail-item-badge"><span class="badge badge-pendente">PENDENTE</span></div></div>';
            }).join(''));
        });
    } else if (key === 'man-concluidas') {
        title = 'Manuten��es Conclu�das'; icon = 'fa-check-double'; color = 'green';
        apiFetch('/api/manutencoes?page=0&size=100&status=CONCLUIDA').then(function(d) {
            var list = d.content || d || [];
            renderStatDetailHTML(container, title, icon, color, list.map(function(m) {
                return '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--green-bg);color:var(--green);"><i class="fas fa-check-double"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">' + escapeHtml(m.computadorNome || 'PC #' + m.computadorId) + '</div><div class="stat-detail-item-sub">' + escapeHtml(m.tipo) + ' - ' + escapeHtml(m.tecnicoResponsavel || 'Sem tecnico') + '</div></div><div class="stat-detail-item-badge"><span class="badge badge-concluida">CONCLUIDA</span></div></div>';
            }).join(''));
        });
    } else if (key === 'os-total') {
        title = 'Todas as Ordens de Servi�o'; icon = 'fa-clipboard-list'; color = 'purple';
        apiFetch('/api/ordens-servico?page=0&size=100').then(function(d) {
            var list = d.content || d || [];
            renderStatDetailHTML(container, title, icon, color, list.map(function(o) {
                var st = statusMap[o.status] || 'badge-pendente';
                return '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--purple-bg);color:var(--purple);"><i class="fas fa-clipboard-list"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">' + escapeHtml(o.titulo) + '</div><div class="stat-detail-item-sub">' + escapeHtml(o.computadorNome || 'Sem v�nculo') + ' - ' + escapeHtml(o.solicitante || '') + '</div></div><div class="stat-detail-item-badge"><span class="badge ' + st + '">' + escapeHtml((o.status || 'ABERTA').replace(/_/g, ' ')) + '</span></div></div>';
            }).join(''));
        });
    } else if (key === 'os-abertas') {
        title = 'OS Abertas'; icon = 'fa-folder-open'; color = 'red';
        Promise.all([apiFetch('/api/ordens-servico?page=0&size=100&status=ABERTA'), apiFetch('/api/ordens-servico?page=0&size=100&status=EM_ANALISE')]).then(function(results) {
            var list = [];
            results.forEach(function(d) { list = list.concat(d.content || d || []); });
            renderStatDetailHTML(container, title, icon, color, list.map(function(o) {
                var st = statusMap[o.status] || 'badge-pendente';
                return '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--red-bg);color:var(--red);"><i class="fas fa-folder-open"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">' + escapeHtml(o.titulo) + '</div><div class="stat-detail-item-sub">' + escapeHtml(o.computadorNome || 'Sem v�nculo') + ' - ' + escapeHtml(o.solicitante || '') + '</div></div><div class="stat-detail-item-badge"><span class="badge ' + st + '">' + escapeHtml((o.status || 'ABERTA').replace(/_/g, ' ')) + '</span></div></div>';
            }).join(''));
        });
    } else if (key === 'os-execucao') {
        title = 'OS em Execu��o'; icon = 'fa-cogs'; color = 'cyan';
        apiFetch('/api/ordens-servico?page=0&size=100&status=EM_EXECUCAO').then(function(d) {
            var list = d.content || d || [];
            renderStatDetailHTML(container, title, icon, color, list.map(function(o) {
                return '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--cyan-bg);color:var(--cyan);"><i class="fas fa-cogs"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">' + escapeHtml(o.titulo) + '</div><div class="stat-detail-item-sub">' + escapeHtml(o.computadorNome || 'Sem v�nculo') + ' - ' + escapeHtml(o.tecnicoResponsavel || 'Sem tecnico') + '</div></div><div class="stat-detail-item-badge"><span class="badge badge-em-execucao">EM EXECUCAO</span></div></div>';
            }).join(''));
        });
    } else if (key === 'os-concluidas') {
        title = 'OS Conclu�das'; icon = 'fa-check-circle'; color = 'green';
        apiFetch('/api/ordens-servico?page=0&size=100&status=CONCLUIDA').then(function(d) {
            var list = d.content || d || [];
            renderStatDetailHTML(container, title, icon, color, list.map(function(o) {
                return '<div class="stat-detail-item"><div class="stat-detail-item-icon" style="background:var(--green-bg);color:var(--green);"><i class="fas fa-check-circle"></i></div><div class="stat-detail-item-info"><div class="stat-detail-item-name">' + escapeHtml(o.titulo) + '</div><div class="stat-detail-item-sub">' + escapeHtml(o.computadorNome || 'Sem v�nculo') + ' - ' + escapeHtml(o.tecnicoResponsavel || '') + '</div></div><div class="stat-detail-item-badge"><span class="badge badge-concluida">CONCLUIDA</span></div></div>';
            }).join(''));
        });
    }
}

function renderStatDetailHTML(container, title, icon, color, itemsHtml) {
    if (!itemsHtml) itemsHtml = '<div class="stat-detail-empty"><i class="fas fa-inbox"></i> Nenhum item encontrado</div>';
    var count = (itemsHtml.match(/class="stat-detail-item"/g) || []).length;
    closeStatDetail();
    var ov = document.createElement('div'); ov.id = 'sdOverlay'; ov.className = 'sd-overlay';
    var ct = document.createElement('div'); ct.id = 'sdContainer'; ct.className = 'sd-container';
    ct.innerHTML = '<div class="stat-detail-header"><h4><i class="fas ' + icon + '" style="color:var(--' + color + ');"></i> ' + title + ' <span style="font-weight:400;font-size:11px;color:var(--text-muted);">(' + count + ' itens)</span></h4><button class="stat-detail-close" onclick="closeStatDetail()"><i class="fas fa-times"></i> Fechar</button></div><div class="stat-detail-body">' + itemsHtml + '</div>';
    document.body.appendChild(ov); document.body.appendChild(ct);
}

// ==========================================
// DEPARTMENTS (Setores)
// ==========================================
async function loadDepartamentos() {
    try {
        var d = await apiFetch('/api/departamentos');
        var s = (document.getElementById('depto-busca-input') || {}).value || '';
        if (s) { var sl = s.toLowerCase(); d = (d || []).filter(function(x) { return (x.nome || '').toLowerCase().indexOf(sl) !== -1; }); }
        renderDepartamentos(d);
    } catch (e) {
        var tb = document.querySelector('#departamentosTable tbody');
        if (tb) tb.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--text-muted)"><i class="fas fa-inbox"></i> Erro ao carregar setores</td></tr>';
    }
}

function renderDepartamentos(deptos) {
    var tb = document.querySelector('#departamentosTable tbody');
    if (!tb) return;
    if (!deptos || deptos.length === 0) {
        tb.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--text-muted);padding:24px;"><i class="fas fa-inbox"></i> Nenhum setor encontrado</td></tr>';
        return;
    }
    tb.innerHTML = deptos.map(function(d) {
        return '<tr style="cursor:pointer;" onclick="showSetorDetail(' + d.id + ',\'' + escapeJsStr(d.nome) + '\',' + (d.totalComputadores || 0) + ')"><td style="font-weight:600;color:var(--text-primary);"><i class="fas fa-sitemap" style="color:var(--cyan);margin-right:8px;"></i>' + escapeHtml(d.nome) + '</td><td><span style="font-weight:700;color:var(--cyan);">' + (d.totalComputadores || 0) + '</span> <span style="color:var(--text-muted);font-size:11px;">computadores</span></td><td><button onclick="event.stopPropagation();confirmDelete(\'departamento\',' + d.id + ',\'' + escapeJsStr(d.nome) + '\')" class="action-btn action-btn-delete"><i class="fas fa-trash"></i></button></td></tr>';
    }).join('');
}

function showSetorDetail(id, nome, count) {
    openModal('Setor: ' + escapeHtml(nome),
        '<div style="padding:10px;text-align:center;">' +
        '<div style="font-size:48px;font-weight:800;color:var(--cyan);margin-bottom:8px;">' + count + '</div>' +
        '<p style="color:var(--text-muted);font-size:13px;">computadores vinculados a este setor</p>' +
        '<div style="margin-top:16px;text-align:left;">' +
        '<p style="font-size:12px;color:var(--text-secondary);">Para vincular computadores a este setor, edite o computador na aba <b>Detalhes</b> e selecione o setor.</p>' +
        '</div></div>',
        '<button onclick="closeModal()" class="btn btn-ghost btn-sm">Fechar</button>'
    );
}

async function showDeptoForm(id) {
    var d = { nome: '' };
    if (id) { try { d = await apiFetch('/api/departamentos/' + id); } catch (e) { showToast('Erro ao carregar setor: ' + e.message, 'error'); return; } }
    openModal(id ? 'Editar Setor' : 'Novo Setor',
        '<form id="deptoForm"><div class="form-group"><label class="form-label">Nome *</label><input id="deptoNome" value="' + escapeAttr(d.nome) + '" required class="form-input" placeholder="Ex: TI, Financeiro, RH"></div></form>',
        '<button onclick="closeModal()" class="btn btn-ghost btn-sm">Cancelar</button><button onclick="document.getElementById(\'deptoForm\').requestSubmit()" class="btn btn-primary btn-sm"><i class="fas fa-save"></i> ' + (id ? 'Salvar' : 'Criar') + '</button>'
    );
    document.getElementById('deptoForm').addEventListener('submit', async function(e) {
        e.preventDefault();
        var p = { nome: document.getElementById('deptoNome').value };
        try {
            if (id) { await apiFetch('/api/departamentos/' + id, { method: 'PUT', body: JSON.stringify(p) }); showToast('Setor atualizado!'); }
            else { await apiFetch('/api/departamentos', { method: 'POST', body: JSON.stringify(p) }); showToast('Setor criado!'); }
            closeModal(); loadDepartamentos(); refreshAllData();
        } catch (e) { showToast(e.message, 'error'); }
    });
}

// ==========================================
// LOGS (Hist�rico)
// ==========================================
var LOG_MONTHS = ['Janeiro', 'Fevereiro', 'Mar�o', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

function initLogDateFilters() {
    var mesSel = document.getElementById('log-filtro-mes');
    var anoSel = document.getElementById('log-filtro-ano');
    if (!mesSel || !anoSel) return;
    var now = new Date();
    if (mesSel.options.length === 0) {
        mesSel.innerHTML = LOG_MONTHS.map(function(m, i) { return '<option value="' + i + '">' + m + '</option>'; }).join('');
        mesSel.value = String(now.getMonth());
    }
    var prevAno = anoSel.value;
    var years = {};
    (MOCK_LOGS || []).forEach(function(l) {
        var d = new Date(l.dataAtividade);
        if (l.dataAtividade && !isNaN(d.getTime())) years[d.getFullYear()] = true;
    });
    years[now.getFullYear()] = true;
    var ylist = Object.keys(years).map(Number).sort(function(a, b) { return b - a; });
    anoSel.innerHTML = ylist.map(function(y) { return '<option value="' + y + '">' + y + '</option>'; }).join('');
    if (prevAno && ylist.indexOf(parseInt(prevAno)) !== -1) anoSel.value = prevAno;
    else anoSel.value = String(now.getFullYear());
}

async function loadLogs(page) {
    if (page !== undefined) currentPage.logs = page;
    initLogDateFilters();
    var usuario = (document.getElementById('log-busca-usuario') || {}).value || '';
    var entidade = (document.getElementById('log-filtro-entidade') || {}).value || '';
    var mes = (document.getElementById('log-filtro-mes') || {}).value;
    var ano = (document.getElementById('log-filtro-ano') || {}).value;
    mes = (mes === undefined || mes === null) ? '' : mes;
    ano = (ano === undefined || ano === null) ? '' : ano;
    try {
        var d = await apiFetch('/api/logs?page=' + currentPage.logs + '&size=15&usuario=' + encodeURIComponent(usuario) + '&entidade=' + encodeURIComponent(entidade) + '&mes=' + encodeURIComponent(mes) + '&ano=' + encodeURIComponent(ano));
        if (d && d.totalElements > 0 && (!d.content || d.content.length === 0) && (currentPage.logs || 0) > 0) return loadLogs(0);
        renderLogs(d);
    } catch (e) {
        var tb = document.querySelector('#logsTable tbody');
        if (tb) tb.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)"><i class="fas fa-inbox"></i> Erro ao carregar hist�rico</td></tr>';
    }
}

function renderLogs(data) {
    var tb = document.querySelector('#logsTable tbody');
    if (!tb) return;
    var items = data.content || data || [];
    if (items.length === 0) {
        tb.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)"><i class="fas fa-inbox"></i> Nenhum log encontrado</td></tr>';
        var lp = document.getElementById('logs-pagination'); if (lp) lp.innerHTML = '';
        return;
    }
    var acoes = { 'LOGIN': 'badge-em_andamento', 'CRIACAO': 'badge-concluida', 'ALTERACAO': 'badge-pendente', 'ALTERACAO_EM_MASSA': 'badge-pendente', 'EXCLUSAO': 'badge-cancelada', 'EXPORTACAO': 'badge-em_andamento', 'IMPORTACAO': 'badge-concluida' };
    var entityIcons = { 'COMPUTADOR': 'fa-desktop', 'MANUTENCAO': 'fa-wrench', 'ORDEM_SERVICO': 'fa-clipboard-list', 'USUARIO': 'fa-user', 'DEPARTAMENTO': 'fa-building', 'SETOR': 'fa-sitemap', 'RAMAL': 'fa-phone', 'TROCA': 'fa-exchange-alt', 'SOFTWARE_LICENCA': 'fa-compact-disc', 'SISTEMA': 'fa-cog' };
    tb.innerHTML = items.map(function(l) {
        var dt = l.dataAtividade ? new Date(l.dataAtividade).toLocaleDateString('pt-BR') + ' ' + new Date(l.dataAtividade).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '-';
        var badge = acoes[l.acao] || 'badge-inativo';
        var eIcon = entityIcons[l.entidade] || 'fa-circle';
        return '<tr><td class="font-medium">' + (l.id || '-') + '</td><td><span class="badge ' + badge + '">' + escapeHtml(l.acao || '-') + '</span></td><td><i class="fas ' + eIcon + '" style="margin-right:4px;color:var(--text-muted);"></i>' + escapeHtml(l.entidade || '-') + '</td><td>' + escapeHtml(l.usuario || '-') + '</td><td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeAttr(l.descricao || '') + '">' + escapeHtml(l.descricao || '-') + '</td><td style="white-space:nowrap;">' + dt + '</td></tr>';
    }).join('');
    var totalPages = data.totalPages || 1;
    renderPagination('logs-pagination', totalPages, data.page !== undefined ? data.page : (data.number || 0), loadLogs);
}

// ==========================================
// USERS
// ==========================================
async function loadUsuarios() {
    try {
        var d = await apiFetch('/api/usuarios');
        var s = (document.getElementById('user-busca-input') || {}).value || '';
        if (s) { var sl = s.toLowerCase(); d = (d || []).filter(function(x) { return (x.nomeCompleto || '').toLowerCase().indexOf(sl) !== -1 || (x.username || '').toLowerCase().indexOf(sl) !== -1 || (x.email || '').toLowerCase().indexOf(sl) !== -1; }); }
        renderUsuarios(d);
    } catch (e) {
        var tb = document.querySelector('#usuariosTable tbody');
        if (tb) tb.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted)"><i class="fas fa-inbox"></i> Erro ao carregar</td></tr>';
    }
}

function renderUsuarios(usuarios) {
    var tb = document.querySelector('#usuariosTable tbody');
    if (!tb) return;
    tb.innerHTML = usuarios.map(function(u) {
        return '<tr><td class="font-medium">' + u.id + '</td><td>' + escapeHtml(u.nomeCompleto) + '</td><td class="font-mono">' + escapeHtml(u.username) + '</td><td>' + escapeHtml(u.email || '-') + '</td><td><span class="badge badge-' + escapeHtml((u.perfil || 'TECNICO').toLowerCase()) + '">' + escapeHtml(u.perfil || 'TECNICO') + '</span></td><td><span class="badge badge-' + (u.ativo ? 'ativo' : 'cancelada') + '">' + (u.ativo ? 'Ativo' : 'Inativo') + '</span></td><td><div style="display:flex;gap:4px;"><button onclick="showUsuarioForm(' + u.id + ')" class="action-btn action-btn-edit"><i class="fas fa-pen"></i></button><button onclick="confirmDelete(\'usuario\',' + u.id + ',\'' + escapeJsStr(u.nomeCompleto) + '\')" class="action-btn action-btn-delete"><i class="fas fa-trash"></i></button></div></td></tr>';
    }).join('');
}

async function showUsuarioForm(id) {
    var u = { username: '', nomeCompleto: '', email: '', perfil: 'USUARIO', senha: '' };
    if (id) { try { u = await apiFetch('/api/usuarios/' + id); } catch (e) { showToast('Erro ao carregar usuario: ' + e.message, 'error'); return; } }
    openModal(id ? 'Editar Usu�rio' : 'Novo Usu�rio',
        '<form id="userForm"><div class="form-group"><label class="form-label">Nome Completo *</label><input id="userNome" value="' + escapeAttr(u.nomeCompleto) + '" required class="form-input"></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px;"><div class="form-group"><label class="form-label">Username *</label><input id="userUsername" value="' + escapeAttr(u.username) + '" ' + (id ? 'disabled' : '') + ' required class="form-input"></div>' +
        '<div class="form-group"><label class="form-label">Email</label><input type="email" id="userEmail" value="' + escapeAttr(u.email || '') + '" class="form-input"></div></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px;"><div class="form-group"><label class="form-label">Perfil</label><select id="userPerfil" class="form-input"><option value="USUARIO"' + (u.perfil === 'USUARIO' ? ' selected' : '') + '>Usu�rio</option><option value="TECNICO"' + (u.perfil === 'TECNICO' ? ' selected' : '') + '>T�cnico</option><option value="ADMIN"' + (u.perfil === 'ADMIN' ? ' selected' : '') + '>Admin</option></select></div>' +
        '<div class="form-group"><label class="form-label">' + (id ? 'Nova Senha (opcional)' : 'Senha*') + '</label><input type="password" id="userSenha" ' + (id ? '' : 'required') + ' minlength="6" class="form-input"></div></div></form>',
        '<button onclick="closeModal()" class="btn btn-ghost btn-sm">Cancelar</button><button onclick="document.getElementById(\'userForm\').requestSubmit()" class="btn btn-primary btn-sm"><i class="fas fa-save"></i> ' + (id ? 'Salvar' : 'Cadastrar') + '</button>'
    );
    document.getElementById('userForm').addEventListener('submit', async function(e) {
        e.preventDefault();
        var p = { nomeCompleto: document.getElementById('userNome').value, email: document.getElementById('userEmail').value, perfil: document.getElementById('userPerfil').value };
        var pw = document.getElementById('userSenha').value; if (pw) p.senha= pw;
        if (!id) p.username = document.getElementById('userUsername').value;
        try {
            if (id) {
                await apiFetch('/api/usuarios/' + id, { method: 'PUT', body: JSON.stringify(p) });
                showToast('Usu�rio atualizado!');
            } else {
                await apiFetch('/api/usuarios', { method: 'POST', body: JSON.stringify(p) });
                showToast('Usu�rio cadastrado!');
            }
            closeModal(); loadUsuarios(); refreshAllData();
        } catch (e) { showToast(e.message, 'error'); }
    });
}

// ==========================================
// MODAL, CONFIRM, TOAST
// ==========================================
function openModal(title, body, footer) {
    var mt = document.getElementById('modal-title'); if (mt) mt.innerHTML = escapeHtml(title);
    var mb = document.getElementById('modal-body'); if (mb) mb.innerHTML = body;
    var mf = document.getElementById('modal-footer'); if (mf) mf.innerHTML = footer || '';
    var mo = document.getElementById('modal-overlay'); if (mo) mo.classList.add('active');
}

function closeModal() { var mo = document.getElementById('modal-overlay'); if (mo) mo.classList.remove('active'); }

function confirmDelete(type, id, name) {
    var ct = document.getElementById('confirm-text'); if (ct) ct.textContent = 'Tem certeza que deseja excluir "' + name + '"?';
    var co = document.getElementById('confirm-overlay'); if (co) co.classList.add('active');
    var cy = document.getElementById('confirm-yes-btn');
    if (cy) cy.onclick = async function() {
        try {
            if (type === 'computador') await apiFetch('/api/computadores/' + id, { method: 'DELETE' });
            else if (type === 'manuten��o') await apiFetch('/api/manutencoes/' + id, { method: 'DELETE' });
            else if (type === 'ordem') await apiFetch('/api/ordens-servico/' + id, { method: 'DELETE' });
            else if (type === 'usuario') await apiFetch('/api/usuarios/' + id, { method: 'DELETE' });
            else if (type === 'departamento') await apiFetch('/api/departamentos/' + id, { method: 'DELETE' });
            else if (type === 'software') await apiFetch('/api/software-licencas/' + id, { method: 'DELETE' });
            else if (type === 'ramal') await apiFetch('/api/ramais/' + id, { method: 'DELETE' });
            else if (type === 'troca') await apiFetch('/api/trocas/' + id, { method: 'DELETE' });
            showToast('Exclu�do com sucesso!');
            closeConfirm();
            refreshAllData();
        } catch (e) { showToast(e.message, 'error'); closeConfirm(); }
    };
}

function closeConfirm() { var co = document.getElementById('confirm-overlay'); if (co) co.classList.remove('active'); }

function showToast(message, type) {
    type = type || 'info';
    var c = document.getElementById('toast-container');
    if (!c) return;
    var t = document.createElement('div');
    t.className = 'toast toast-' + type;
    var icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', info: 'fa-info-circle', warning: 'fa-exclamation-triangle' };
    t.innerHTML = '<i class="fas ' + (icons[type] || icons.info) + '"></i><span>' + escapeHtml(message) + '</span>';
    c.appendChild(t);
    setTimeout(function() { t.classList.add('toast-out'); setTimeout(function() { t.remove(); }, 300); }, type === 'error' ? 5000 : 3500);
}

// ==========================================
// PAGINATION
// ==========================================
function renderPagination(containerId, totalPages, curPage, loadFn) {
    var c = document.getElementById(containerId);
    if (!c || !totalPages || totalPages <= 1) { if (c) c.innerHTML = ''; return; }
    var html = '<button class="pagination-btn" data-page="' + (curPage - 1) + '" ' + (curPage === 0 ? 'disabled' : '') + '><i class="fas fa-chevron-left"></i></button>';
    for (var i = 0; i < totalPages; i++) { html += '<button class="pagination-btn ' + (i === curPage ? 'active' : '') + '" data-page="' + i + '">' + (i + 1) + '</button>'; }
    html += '<button class="pagination-btn" data-page="' + (curPage + 1) + '" ' + (curPage >= totalPages - 1 ? 'disabled' : '') + '><i class="fas fa-chevron-right"></i></button>';
    c.innerHTML = html;
    c.querySelectorAll('.pagination-btn').forEach(function(btn) {
        btn.addEventListener('click', function() { var p = parseInt(btn.dataset.page); if (!isNaN(p) && p >= 0 && p < totalPages) loadFn(p); });
    });
}

// ==========================================
// UTILITIES
// ==========================================
function escapeHtml(t) { if (t === null || t === undefined) return ''; var m = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }; return String(t).replace(/[&<>"']/g, function(c) { return m[c]; }); }
function escapeAttr(t) { if (t === null || t === undefined) return ''; return String(t).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function escapeJsStr(t) {
    if (t === null || t === undefined) return '';
    // 1) escapa como literal JS (o conteudo cai dentro de uma string '...')
    var s = String(t)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/`/g, '\\`')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
    // 2) escapa como atributo HTML: todos os usos ficam dentro de onclick="..."
    //    entao uma aspa ou um & do usuario nao podem fechar o atributo/entidade
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function formatNumber(num) { return Number(num).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function formatFileSize(bytes) { if (bytes < 1024) return bytes + ' B'; if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB'; return (bytes / (1024 * 1024)).toFixed(1) + ' MB'; }
function debounce(fn, delay) { var t; return function() { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function() { fn.apply(c, a); }, delay); }; }

function getComputerPhoto(eq, size) {
    size = size || {};
    var w = size.w || 200, h = size.h || 150;
    var brand = (eq && eq.modeloMarca) ? eq.modeloMarca.split(' ')[0].toUpperCase() : 'PC';
    var svg = generatePlaceholderSVG(eq ? eq.modeloMarca : 'PC', w, h);
    if (eq && eq.fotoUrl && eq.fotoUrl.trim() !== '') {
        return '<div class="pc-photo-container" style="cursor:zoom-in;" onclick="openLightbox(\'' + escapeJsStr(eq.fotoUrl) + '\')"><img src="' + escapeHtml(eq.fotoUrl) + '" alt="' + escapeHtml(eq.nomePc) + '" style="width:100%;height:100%;object-fit:contain;pointer-events:none;" onload="this.style.display=\'block\';var fb=this.nextElementSibling;if(fb)fb.style.display=\'none\';" onerror="this.style.display=\'none\';var fb=this.nextElementSibling;if(fb)fb.style.display=\'flex\';"><div class="pc-photo-fallback" style="display:flex;width:100%;height:100%;align-items:center;justify-content:center;">' + svg + '</div></div>';
    }
    return svg;
}

function generatePlaceholderSVG(modelo, w, h) {
    w = w || 200; h = h || 150;
    var brand = (modelo || 'PC').split(' ')[0].toUpperCase();
    var colorMap = { 'DELL': '#3b82f6', 'LENOVO': '#34d399', 'HP': '#ff9f43', 'ACER': '#b24dff', 'SAMSUNG': '#00e5c7', 'POSITIVO': '#fbbf24', 'APPLE': '#9ca3af' };
    var color = '#4e5a72';
    for (var k in colorMap) { if (brand.indexOf(k) !== -1) { color = colorMap[k]; break; } }
    var isLaptop = modelo && (modelo.toLowerCase().indexOf('thinkpad') !== -1 || modelo.toLowerCase().indexOf('latitude') !== -1 || modelo.toLowerCase().indexOf('proone') !== -1 || modelo.toLowerCase().indexOf('notebook') !== -1);
    if (isLaptop) {
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '"><rect width="' + w + '" height="' + h + '" fill="#1f2937"/><rect x="' + Math.round(w * 0.15) + '" y="' + Math.round(h * 0.1) + '" width="' + Math.round(w * 0.7) + '" height="' + Math.round(h * 0.5) + '" rx="6" fill="#374151" stroke="#4b5563"/><rect x="' + Math.round(w * 0.18) + '" y="' + Math.round(h * 0.14) + '" width="' + Math.round(w * 0.64) + '" height="' + Math.round(h * 0.4) + '" rx="3" fill="#111827"/><rect x="' + Math.round(w * 0.25) + '" y="' + Math.round(h * 0.62) + '" width="' + Math.round(w * 0.5) + '" height="' + Math.round(h * 0.04) + '" rx="2" fill="#4b5563"/><rect x="' + Math.round(w * 0.2) + '" y="' + Math.round(h * 0.68) + '" width="' + Math.round(w * 0.6) + '" height="' + Math.round(h * 0.03) + '" rx="2" fill="#4b5563"/><text x="' + Math.round(w / 2) + '" y="' + Math.round(h * 0.4) + '" text-anchor="middle" fill="' + color + '" font-size="' + Math.round(h * 0.08) + '" font-family="Arial,sans-serif" font-weight="bold">' + escapeHtml(brand) + '</text></svg>';
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '"><rect width="' + w + '" height="' + h + '" fill="#1f2937"/><rect x="' + Math.round(w * 0.25) + '" y="' + Math.round(h * 0.08) + '" width="' + Math.round(w * 0.5) + '" height="' + Math.round(h * 0.52) + '" rx="6" fill="#374151" stroke="#4b5563"/><rect x="' + Math.round(w * 0.28) + '" y="' + Math.round(h * 0.12) + '" width="' + Math.round(w * 0.44) + '" height="' + Math.round(h * 0.4) + '" rx="3" fill="#111827"/><rect x="' + Math.round(w * 0.38) + '" y="' + Math.round(h * 0.62) + '" width="' + Math.round(w * 0.24) + '" height="' + Math.round(h * 0.06) + '" rx="2" fill="#4b5563"/><rect x="' + Math.round(w * 0.3) + '" y="' + Math.round(h * 0.7) + '" width="' + Math.round(w * 0.4) + '" height="' + Math.round(h * 0.03) + '" rx="2" fill="#4b5563"/><text x="' + Math.round(w / 2) + '" y="' + Math.round(h * 0.38) + '" text-anchor="middle" fill="' + color + '" font-size="' + Math.round(h * 0.09) + '" font-family="Arial,sans-serif" font-weight="bold">' + escapeHtml(brand) + '</text></svg>';
}

// ==========================================
// MANUAL
// ==========================================
function showManual() {
    openModal('Manual do Sistema',
        '<div style="font-size:13px;color:var(--text-secondary);line-height:1.8;">' +
        '<h3 style="color:var(--cyan);font-size:15px;margin-bottom:10px;">1. Vis�o Geral</h3>' +
        '<p>O sistema de Invent�rio de TI permite gerenciar computadores, manuten��es, ordens de servi�o, setores e usu�rios. O dashboard fornece uma vis�o completa do invent�rio.</p>' +
        '<h3 style="color:var(--cyan);font-size:15px;margin:14px 0 10px;">2. Computadores</h3>' +
        '<p>Cadastre equipamentos com tr�s abas: <b>Geral</b> (dados b�sicos), <b>Foto</b> (upload de imagem) e <b>Detalhes</b> (setor, IP, SO, etc). Use os filtros e busca para encontrar equipamentos. A��es em massa dispon�veis para usu�rios ADMIN.</p>' +
        '<h3 style="color:var(--cyan);font-size:15px;margin:14px 0 10px;">3. Manuten��es</h3>' +
        '<p>Registre manuten��es corretivas, preventivas, preditivas ou emergenciais. Ao cadastrar uma manuten��o, uma OS � criada automaticamente. Ao concluir, o status do computador � atualizado.</p>' +
        '<h3 style="color:var(--cyan);font-size:15px;margin:14px 0 10px;">4. Ordens de Servi�o</h3>' +
        '<p>Gerencie tickets de suporte com prioridade, status, respons�vel e solu��o. Clique em uma OS na tabela para editar. Use filtros por status e prioridade.</p>' +
        '<h3 style="color:var(--cyan);font-size:15px;margin:14px 0 10px;">5. Setores</h3>' +
        '<p>Gerencie os setores da empresa. Apenas nome � necess�rio. O n�mero de computadores vinculados � exibido automaticamente.</p>' +
        '<h3 style="color:var(--cyan);font-size:15px;margin:14px 0 10px;">6. Hist�rico</h3>' +
        '<p>Visualize todas as opera��es realizadas no sistema com filtros por entidade (Computador, Manuten��o, OS, etc).</p>' +
        '<h3 style="color:var(--cyan);font-size:15px;margin:14px 0 10px;">7. Relat�rios</h3>' +
        '<p>Visualize gr�ficos e estat�sticas detalhadas. Clique nos cards de estat�sticas para ver os itens individuais. Exporte em CSV ou imprima em PDF.</p>' +
        '<h3 style="color:var(--cyan);font-size:15px;margin:14px 0 10px;">8. Ferramentas</h3>' +
        '<p>Painel administrativo com status do sistema, H2 Console, Swagger, Actuator e m�tricas. Apenas usu�rios ADMIN tem acesso.</p>' +
        '</div>',
        '<button onclick="closeModal()" class="btn btn-ghost btn-sm">Fechar</button>'
    );
}

// ==========================================
// ADMIN TOOLS FUNCTIONS
// ==========================================
function showSystemInfo() {
    apiFetch('/actuator/health').then(function(data) {
        var status = (data && data.status) ? escapeHtml(data.status) : 'UNKNOWN';
        var dbStatus = 'H2 (embedded)';
        if (data && data.componentes && data.componentes.db) {
            dbStatus = data.componentes.db.details ? escapeHtml(data.componentes.db.details.database || dbStatus) : dbStatus;
        }
        openModal('Status do Sistema',
            '<div style="padding:10px;">' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">' +
            '<div class="stat-card" style="text-align:center;padding:16px;"><div class="stat-card-value" style="color:var(--cyan);font-size:20px;">' + status + '</div><div class="stat-card-label">Status Geral</div></div>' +
            '<div class="stat-card" style="text-align:center;padding:16px;"><div class="stat-card-value" style="color:var(--green);font-size:20px;">' + dbStatus + '</div><div class="stat-card-label">Banco de Dados</div></div>' +
            '</div>' +
            '<div style="font-size:12px;color:var(--text-muted);">' +
            '<p><b>Servidor:</b> Spring Boot 3.2.5 + Java 21</p>' +
            '<p><b>Banco:</b> H2 Database (arquivo ./data/invent�rio_db)</p>' +
            '<p><b>Porta:</b> 3030</p>' +
            '<p><b>URL:</b> 192.168.0.186:3030</p>' +
            '</div></div>',
            '<button onclick="closeModal()" class="btn btn-ghost btn-sm">Fechar</button>'
        );
    }).catch(function() {
        openModal('Status do Sistema',
            '<div style="padding:10px;text-align:center;"><p style="color:var(--red);font-size:14px;">N�o foi poss�vel obter informa��es do sistema.</p></div>',
            '<button onclick="closeModal()" class="btn btn-ghost btn-sm">Fechar</button>'
        );
    });
}

function clearSystemCache() {
    try {
        localStorage.removeItem('authToken');
        localStorage.removeItem('userName');
        localStorage.removeItem('userPerfil');
        localStorage.removeItem('currentTab');
    } catch(e) { /* ignore */ }
    showToast('Cache limpo com sucesso!', 'success');
    setTimeout(function() { location.reload(); }, 800);
}

function showBackupInfo() {
    openModal('Backup do Banco de Dados',
        '<div style="padding:10px;font-size:13px;color:var(--text-secondary);line-height:1.8;">' +
        '<p>O banco de dados � armazenado em arquivo local no servidor:</p>' +
        '<div style="background:rgba(0,0,0,0.3);padding:12px;border-radius:8px;margin:10px 0;font-family:monospace;font-size:12px;color:var(--cyan);">./data/invent�rio_db.mv.db</div>' +
        '<p><b>Como fazer backup:</b></p>' +
        '<ol style="padding-left:18px;margin:6px 0;">' +
        '<li>Pare o servidor</li>' +
        '<li>Copie o arquivo <code style="color:var(--cyan);">invent�rio_db.mv.db</code> da pasta <code style="color:var(--cyan);">data/</code></li>' +
        '<li>Salve o arquivo em local seguro</li>' +
        '<li>Reinicie o servidor</li>' +
        '</ol>' +
        '<p style="color:var(--red);margin-top:10px;"><b>importante:</b> O arquivo de banco � o �nico necess�rio para restaurar todos os dados do sistema.</p>' +
        '</div>',
        '<button onclick="closeModal()" class="btn btn-ghost btn-sm">Fechar</button>'
    );
}

// ==========================================
// CSV EXPORT/IMPORT (processado no cliente)
// ==========================================
var CSV_PC_CAMPOS = ['nomePc', 'numeroSerie', 'modeloMarca', 'processador', 'memoriaRam', 'armazenamento', 'usuarioDesignado', 'fornecedor', 'status', 'departamento', 'localizacao', 'ipAddress', 'sistemaOperacional', 'softwareInstalado', 'notas', 'dataCadastro', 'proximaManutencao', 'dataAquisicao', 'dataGarantia'];
var CSV_PC_ROTULOS = { nomePc: 'Nome PC', numeroSerie: 'N�mero S�rie', modeloMarca: 'Modelo/Marca', processador: 'Processador', memoriaRam: 'Mem�ria RAM', armazenamento: 'Armazenamento', usuarioDesignado: 'Usu�rio Designado', fornecedor: 'Fornecedor', status: 'Status', departamento: 'Setor', localizacao: 'Localiza��o', ipAddress: 'IP', sistemaOperacional: 'Sistema Operacional', softwareInstalado: 'Software Instalado', notas: 'Notas', dataCadastro: 'Data de Cadastro', proximaManutencao: 'Pr�xima Manuten��o', dataAquisicao: 'Data de Aquisi��o', dataGarantia: 'Garantia at�' };
var CSV_PC_OBRIGATORIOS = ['nomePc', 'numeroSerie', 'processador', 'memoriaRam', 'armazenamento'];
var CSV_PC_DATAS = ['dataCadastro', 'proximaManutencao', 'dataAquisicao', 'dataGarantia'];
var CSV_PC_STATUS = ['ATIVO', 'MANUTENCAO_PREDITIVA', 'MANUTENCAO_PREVENTIVA', 'MANUTENCAO_EMERGENCIAL', 'CONCLUIDO'];

function csvEscape(v) {
    var s = (v === null || v === undefined) ? '' : String(v);
    if (s.indexOf(';') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1 || s.indexOf('\r') !== -1) return '"' + s.replace(/"/g, '""') + '"';
    return s;
}

function exportComputadoresCSV() {
    apiFetch('/api/computadores/paginado?page=0&size=1000&status=&termo=')
        .then(function(d) {
            var list = (d && d.content) || d || [];
            if (!list.length) throw new Error('nenhum computador para exportar.');
            var linhas = [CSV_PC_CAMPOS.map(function(f) { return csvEscape(CSV_PC_ROTULOS[f] || f); }).join(';')];
            list.forEach(function(pc) {
                linhas.push(CSV_PC_CAMPOS.map(function(f) { return csvEscape(pc[f]); }).join(';'));
            });
            var blob = new Blob(['\uFEFF' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'computadores_' + new Date().toISOString().slice(0, 10) + '.csv';
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(function() { URL.revokeObjectURL(url); }, 100);
            showToast('CSV exportado: ' + list.length + ' computador(es).', 'success');
        })
        .catch(function(e) { showToast('Erro na exporta��o: ' + e.message, 'error'); });
}

function parseCSVTexto(texto) {
    texto = String(texto || '').replace(/^\uFEFF/, '');
    var primeira = texto.split(/\r?\n/, 1)[0] || '';
    var sep = primeira.indexOf(';') !== -1 ? ';' : ',';
    var linhas = [], linha = [], campo = '', emAspas = false;
    for (var i = 0; i < texto.length; i++) {
        var ch = texto.charAt(i);
        if (emAspas) {
            if (ch === '"') {
                if (texto.charAt(i + 1) === '"') { campo += '"'; i++; } else emAspas = false;
            } else campo += ch;
        } else if (ch === '"') {
            emAspas = true;
        } else if (ch === sep) {
            linha.push(campo); campo = '';
        } else if (ch === '\n') {
            linha.push(campo); linhas.push(linha); linha = []; campo = '';
        } else if (ch !== '\r') {
            campo += ch;
        }
    }
    linha.push(campo); linhas.push(linha);
    return linhas.filter(function(l) { return l.some(function(c) { return String(c).trim() !== ''; }); });
}

function normalizarColunaCSV(t) {
    var s = String(t || '');
    if (s.normalize) s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function importComputadoresCSV(event) {
    var file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    var reader = new FileReader();
    reader.onerror = function() { showToast('Erro na importa��o: n�o foi poss�vel ler o arquivo.', 'error'); };
    reader.onload = function() {
        importarComputadoresDoCSV(String(reader.result || ''))
            .then(function(res) {
                var msg = 'Importa��o: ' + res.importados + ' importado(s), ' + res.duplicados + ' duplicado(s), ' + res.erros + ' erro(s).';
                showToast(msg, res.erros ? 'warning' : 'success');
                if (res.primeiroErro) showToast('Primeiro erro: ' + res.primeiroErro, 'error');
                if (res.importados) { loadComputadores(0); refreshAllData(); }
            })
            .catch(function(e) { showToast('Erro na importa��o: ' + e.message, 'error'); });
    };
    reader.readAsText(file, 'utf-8');
}

async function importarComputadoresDoCSV(texto) {
    var rows = parseCSVTexto(texto);
    if (rows.length < 2) throw new Error('arquivo sem dados (esperado cabe�alho + linhas).');
    var cab = rows[0].map(normalizarColunaCSV);
    var idx = {};
    CSV_PC_CAMPOS.forEach(function(f) {
        var alvos = [normalizarColunaCSV(f), normalizarColunaCSV(CSV_PC_ROTULOS[f] || '')];
        for (var a = 0; a < alvos.length; a++) {
            if (!alvos[a]) continue;
            var pos = cab.indexOf(alvos[a]);
            if (pos !== -1) { idx[f] = pos; break; }
        }
    });
    if (idx.nomePc === undefined) throw new Error('coluna "Nome PC" n�o encontrada no cabe�alho.');
    if (idx.numeroSerie === undefined) throw new Error('coluna "N�mero S�rie" n�o encontrada no cabe�alho.');
    var nomes = {}, series = {};
    MOCK_COMPUTADORES.forEach(function(c) {
        nomes[String(c.nomePc || '').trim().toUpperCase()] = true;
        series[String(c.numeroSerie || '').trim().toUpperCase()] = true;
    });
    var importados = 0, duplicados = 0, erros = 0, primeiroErro = '';
    for (var i = 1; i < rows.length; i++) {
        var r = rows[i];
        var pc = {};
        CSV_PC_CAMPOS.forEach(function(f) {
            var v = idx[f] === undefined ? '' : String(r[idx[f]] === undefined ? '' : r[idx[f]]).trim();
            if (v !== '') pc[f] = v;
        });
        var falta = CSV_PC_OBRIGATORIOS.filter(function(f) { return !pc[f]; });
        if (falta.length) { erros++; if (!primeiroErro) primeiroErro = 'linha ' + (i + 1) + ': obrigat�rio ' + falta.join(', '); continue; }
        CSV_PC_DATAS.forEach(function(f) { if (pc[f] && !parseDataISO(pc[f])) delete pc[f]; });
        if (pc.status) {
            pc.status = pc.status.toUpperCase();
            if (CSV_PC_STATUS.indexOf(pc.status) === -1) pc.status = 'ATIVO';
        }
        var nomeUp = pc.nomePc.toUpperCase(), serieUp = pc.numeroSerie.toUpperCase();
        if (nomes[nomeUp] || series[serieUp]) { duplicados++; continue; }
        try {
            await apiFetch('/api/computadores', { method: 'POST', body: JSON.stringify(pc) });
            nomes[nomeUp] = true; series[serieUp] = true;
            importados++;
        } catch (e) {
            erros++;
            if (!primeiroErro) primeiroErro = 'linha ' + (i + 1) + ': ' + e.message;
        }
    }
    return { importados: importados, duplicados: duplicados, erros: erros, primeiroErro: primeiroErro };
}

// ==========================================
// FILTERS & INIT
// ==========================================
function initFilters() {
    var b = document.getElementById('busca-input'), f = document.getElementById('filtro-status');
    if (b) b.addEventListener('input', debounce(function() { loadComputadores(0); }, 400));
    if (f) f.addEventListener('change', function() { loadComputadores(0); });
    var mf = document.getElementById('man-filtro-status'); if (mf) mf.addEventListener('change', function() { loadManutencoes(0); });
    var mb = document.getElementById('man-busca-input'); if (mb) mb.addEventListener('input', debounce(function() { loadManutencoes(0); }, 400));
    var osf = document.getElementById('os-filtro-status'), opf = document.getElementById('os-filtro-prioridade');
    if (osf) osf.addEventListener('change', function() { loadOrdensServico(0); });
    if (opf) opf.addEventListener('change', function() { loadOrdensServico(0); });
    var osb = document.getElementById('os-busca-input'); if (osb) osb.addEventListener('input', debounce(function() { loadOrdensServico(0); }, 400));
    var db = document.getElementById('depto-busca-input'); if (db) db.addEventListener('input', debounce(function() { loadDepartamentos(); }, 400));
    var ub = document.getElementById('user-busca-input'); if (ub) ub.addEventListener('input', debounce(function() { loadUsuarios(); }, 400));
    var lu = document.getElementById('log-busca-usuario'); if (lu) lu.addEventListener('input', debounce(function() { loadLogs(0); }, 400));
    var le = document.getElementById('log-filtro-entidade'); if (le) le.addEventListener('change', function() { loadLogs(0); });
    var lm = document.getElementById('log-filtro-mes'); if (lm) lm.addEventListener('change', function() { loadLogs(0); });
    var la = document.getElementById('log-filtro-ano'); if (la) la.addEventListener('change', function() { loadLogs(0); });
    var sb = document.getElementById('sw-busca-input'); if (sb) sb.addEventListener('input', debounce(function() { loadSoftwareLicencas(0); }, 400));
    var rb = document.getElementById('ramal-busca-input'); if (rb) rb.addEventListener('input', debounce(function() { loadRamais(0); }, 400));
    var rs = document.getElementById('ramal-filtro-status'); if (rs) rs.addEventListener('change', function() { loadRamais(0); });
    var rset = document.getElementById('ramal-filtro-setor'); if (rset) rset.addEventListener('change', function() { loadRamais(0); });
    var rper = document.getElementById('ramal-filtro-periodo'); if (rper) rper.addEventListener('change', function() { loadRamais(0); });
    var rpri = document.getElementById('ramal-filtro-prioridade'); if (rpri) rpri.addEventListener('change', function() { loadRamais(0); });
    var tb2 = document.getElementById('troca-busca-input'); if (tb2) tb2.addEventListener('input', debounce(function() { loadTrocas(); }, 400));
    var tt = document.getElementById('troca-filtro-tipo'); if (tt) tt.addEventListener('change', function() { loadTrocas(); });
}

// ==========================================
// SOFTWARE/LICENCAS
// ==========================================
async function loadSoftwareLicencas(page) {
    if (page !== undefined) currentPage.software = page;
    var t = (document.getElementById('sw-busca-input') || {}).value || '';
    try {
        var d = await apiFetch('/api/software-licencas?page=' + (currentPage.software || 0) + '&size=10&termo=' + encodeURIComponent(t));
        if (d && d.totalElements > 0 && (!d.content || d.content.length === 0) && (currentPage.software || 0) > 0) return loadSoftwareLicencas(0);
        renderSoftwareLicencas(d);
    } catch (e) {
        var tb = document.querySelector('#softwareTable tbody');
        if (tb) tb.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)"><i class="fas fa-inbox"></i> Erro ao carregar licen�as</td></tr>';
    }
}

function renderSoftwareLicencas(data) {
    var tb = document.querySelector('#softwareTable tbody');
    if (!tb) return;
    var items = data.content || data || [];
    if (items.length === 0) {
        tb.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:24px;"><i class="fas fa-inbox"></i> Nenhuma licenca encontrada</td></tr>';
        var sp = document.getElementById('software-pagination'); if (sp) sp.innerHTML = '';
        return;
    }
    tb.innerHTML = items.map(function(s) {
        var exp = s.dataExpiracao ? new Date(s.dataExpiracao + 'T00:00:00').toLocaleDateString('pt-BR') : '-';
        var expClass = '';
        if (s.dataExpiracao) {
            var d = new Date(s.dataExpiracao + 'T00:00:00');
            var diff = (d - new Date()) / (1000*60*60*24);
            if (diff < 0) expClass = 'color:var(--red);';
            else if (diff < 30) expClass = 'color:var(--yellow);';
        }
        var disp = (s.quantidadeTotal || 0) - (s.quantidadeUtilizada || 0);
        var badge = disp <= 0 ? 'badge-cancelada' : (disp <= 2 ? 'badge-pendente' : 'badge-concluida');
        return '<tr>' +
            '<td style="font-weight:600;color:var(--text-primary);"><i class="fas fa-key" style="color:var(--purple);margin-right:8px;"></i>' + escapeHtml(s.nomeSoftware) + '</td>' +
            '<td>' + escapeHtml(s.fabricante || '-') + '</td>' +
            '<td><span class="badge badge-em_andamento">' + escapeHtml(s.tipoLicenca || '-') + '</span></td>' +
            '<td><span class="badge ' + badge + '">' + (s.quantidadeUtilizada || 0) + '/' + (s.quantidadeTotal || 0) + '</span></td>' +
            '<td style="' + expClass + '">' + exp + '</td>' +
            '<td><button onclick="showSoftwareLicencaForm(' + s.id + ')" class="action-btn action-btn-edit"><i class="fas fa-edit"></i></button> ' +
            '<button onclick="confirmDelete(\'software\',' + s.id + ',\'' + escapeJsStr(s.nomeSoftware) + '\')" class="action-btn action-btn-delete"><i class="fas fa-trash"></i></button></td></tr>';
    }).join('');
    renderPagination('software-pagination', data.totalPages || 1, data.page !== undefined ? data.page : (data.number || 0), loadSoftwareLicencas);
}

async function showSoftwareLicencaForm(id) {
    var s = { nomeSoftware: '', fabricante: '', chaveLicenca: '', tipoLicenca: 'PRO', quantidadeTotal: 1, quantidadeUtilizada: 0, dataAquisicao: '', dataExpiracao: '', observacoes: '' };
    if (id) { try { s = await apiFetch('/api/software-licencas/' + id); } catch (e) { showToast('Erro ao carregar licenca: ' + e.message, 'error'); return; } }
    openModal(id ? 'Editar Licen�a' : 'Nova Licen�a',
        '<form id="swForm">' +
        '<div class="form-row"><div class="form-group"><label class="form-label">Software *</label><input id="swNome" value="' + escapeAttr(s.nomeSoftware || '') + '" required class="form-input" placeholder="Ex: Microsoft Office"></div>' +
        '<div class="form-group"><label class="form-label">Fabricante</label><input id="swFab" value="' + escapeAttr(s.fabricante || '') + '" class="form-input" placeholder="Ex: Microsoft"></div></div>' +
        '<div class="form-group"><label class="form-label">Chave de Licen�a</label><input id="swChave" value="' + escapeAttr(s.chaveLicenca || '') + '" class="form-input" placeholder="XXXXX-XXXXX-XXXXX"></div>' +
        '<div class="form-group"><label class="form-label">Tipo</label><select id="swTipo" class="form-input"><option value="PRO"' + (s.tipoLicenca === 'PRO' ? ' selected' : '') + '>PRO</option><option value="ENTERPRISE"' + (s.tipoLicenca === 'ENTERPRISE' ? ' selected' : '') + '>ENTERPRISE</option><option value="HOME"' + (s.tipoLicenca === 'HOME' ? ' selected' : '') + '>HOME</option><option value="EDUCACIONAL"' + (s.tipoLicenca === 'EDUCACIONAL' ? ' selected' : '') + '>EDUCACIONAL</option><option value="OEM"' + (s.tipoLicenca === 'OEM' ? ' selected' : '') + '>OEM</option><option value="VOLUME"' + (s.tipoLicenca === 'VOLUME' ? ' selected' : '') + '>VOLUME</option><option value="OUTRO"' + (s.tipoLicenca === 'OUTRO' ? ' selected' : '') + '>OUTRO</option></select></div>' +
        '<div class="form-row"><div class="form-group"><label class="form-label">Qtde Total</label><input id="swTotal" type="number" min="0" value="' + (s.quantidadeTotal || 1) + '" class="form-input"></div>' +
        '<div class="form-group"><label class="form-label">Qtde Utilizada</label><input id="swUtil" type="number" min="0" value="' + (s.quantidadeUtilizada || 0) + '" class="form-input"></div></div>' +
        '<div class="form-row"><div class="form-group"><label class="form-label">Data Aquisi��o</label><input id="swAq" type="date" value="' + (s.dataAquisicao || '') + '" class="form-input"></div>' +
        '<div class="form-group"><label class="form-label">Data Expira��o</label><input id="swExp" type="date" value="' + (s.dataExpiracao || '') + '" class="form-input"></div></div>' +
        '<div class="form-group"><label class="form-label">Observa��es</label><textarea id="swObs" class="form-input" rows="2" placeholder="Observa��es...">' + escapeHtml(s.observacoes || '') + '</textarea></div>' +
        '</form>',
        '<button onclick="closeModal()" class="btn btn-ghost btn-sm">Cancelar</button><button onclick="document.getElementById(\'swForm\').requestSubmit()" class="btn btn-primary btn-sm"><i class="fas fa-save"></i> ' + (id ? 'Salvar' : 'Criar') + '</button>'
    );
    document.getElementById('swForm').addEventListener('submit', async function(e) {
        e.preventDefault();
        var p = {
            nomeSoftware: document.getElementById('swNome').value,
            fabricante: document.getElementById('swFab').value || null,
            chaveLicenca: document.getElementById('swChave').value || null,
            tipoLicenca: document.getElementById('swTipo').value,
            quantidadeTotal: parseInt(document.getElementById('swTotal').value) || 1,
            quantidadeUtilizada: parseInt(document.getElementById('swUtil').value) || 0,
            dataAquisicao: document.getElementById('swAq').value || null,
            dataExpiracao: document.getElementById('swExp').value || null,
            observacoes: document.getElementById('swObs').value || null
        };
        try {
            if (id) await apiFetch('/api/software-licencas/' + id, { method: 'PUT', body: JSON.stringify(p) });
            else await apiFetch('/api/software-licencas', { method: 'POST', body: JSON.stringify(p) });
            showToast(id ? 'Licen�a atualizada!' : 'Licen�a criada!');
            closeModal(); loadSoftwareLicencas(currentPage.software || 0);
        } catch (e) { showToast(e.message, 'error'); }
    });
}

// ==========================================
// RAMAIS
// ==========================================
function refreshRamalSetorFilter() {
    var sel = document.getElementById('ramal-filtro-setor');
    if (!sel || typeof MOCK_DEPARTAMENTOS === 'undefined' || MOCK_DEPARTAMENTOS.length === 0) return;
    var cur = sel.value;
    var names = MOCK_DEPARTAMENTOS.map(function(d) { return d.nome; }).sort(function(a, b) { return (a || '').localeCompare(b || ''); });
    sel.innerHTML = '<option value="">Todos os Setores</option>' + names.map(function(n) { return '<option value="' + escapeAttr(n) + '">' + escapeHtml(n) + '</option>'; }).join('');
    sel.value = cur;
}

async function loadRamais(page) {
    if (page !== undefined) currentPage.ramais = page;
    refreshRamalSetorFilter();
    var termo = (document.getElementById('ramal-busca-input') || {}).value || '';
    var status = (document.getElementById('ramal-filtro-status') || {}).value || '';
    var setor = (document.getElementById('ramal-filtro-setor') || {}).value || '';
    var periodo = (document.getElementById('ramal-filtro-periodo') || {}).value || '';
    var prioridade = (document.getElementById('ramal-filtro-prioridade') || {}).value || '';
    try {
        var url = '/api/ramais?termo=' + encodeURIComponent(termo);
        if (status) url += '&status=' + status;
        if (setor) url += '&setor=' + encodeURIComponent(setor);
        if (periodo) url += '&periodo=' + periodo;
        if (prioridade) url += '&prioridade=' + prioridade;
        var d = await apiFetch(url);
        renderRamais(d);
        var navTotal = document.getElementById('nav-ramais-total');
        if (navTotal && !termo && !status && !setor && !periodo && !prioridade) navTotal.textContent = (d || []).length;
    } catch (e) {
        var grid = document.getElementById('ramal-cards-grid');
        if (grid) grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><i class="fas fa-inbox"></i><p>Nenhum ramal encontrado</p></div>';
    }
}

function renderRamais(ramais) {
    var grid = document.getElementById('ramal-cards-grid');
    if (!grid) return;
    if (!ramais || ramais.length === 0) {
        grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><i class="fas fa-inbox"></i><p>Nenhum ramal encontrado</p></div>';
        var cp = document.getElementById('ramal-pagination'); if (cp) cp.innerHTML = '';
        return;
    }
    var sm = { 'ATIVO': { c: 'badge-ativo', i: 'fa-check-circle', label: 'Ativo' }, 'INATIVO': { c: 'badge-cancelada', i: 'fa-times-circle', label: 'Inativo' }, 'EM_MANUTENCAO': { c: 'badge-emergencial', i: 'fa-wrench', label: 'Em Manutencao' }, 'CONFERIR': { c: 'badge-preditiva', i: 'fa-search', label: 'Conferir' } };
    grid.innerHTML = ramais.map(function(r) {
        var rst = r.status || 'ATIVO'; var s = sm[rst] || { c: 'badge-inativo', i: 'fa-circle', label: rst };
        var comp = MOCK_COMPUTADORES.find(function(c) { return c.id === r.computadorId; });
        var compName = comp ? comp.nomePc : 'Sem PC vinculado';
        var admin = getPerfil() === 'ADMIN' ? '<button onclick="event.stopPropagation();confirmDelete(\'ramal\',' + r.id + ',\'Ramal ' + escapeJsStr(r.numeroRamal) + '\')" class="action-btn action-btn-delete" title="Excluir"><i class="fas fa-trash"></i></button>' : '';
        var cicloHtml = '';
        if (r.diasDesdeInicioCiclo !== null && r.diasDesdeInicioCiclo !== undefined) {
            var pct = Math.min(100, Math.max(0, (r.diasDesdeInicioCiclo / 365) * 100));
            var corCiclo = pct < 50 ? 'var(--green)' : pct < 75 ? 'var(--yellow)' : 'var(--red)';
            var cicloTexto = r.diasRestantes > 0 ? r.diasRestantes + 'd restantes' : r.diasRestantes === 0 ? 'Vence hoje' : Math.abs(r.diasRestantes) + 'd atrasado';
            var faseLabel = { 'ATIVO': 'Ativo', 'PREDITIVO': 'Preditivo', 'PREVENTIVO': 'Preventivo', 'ATRASADO': 'Atrasado' };
            cicloHtml = '<div class="pc-card-ciclo">' +
                '<div class="ciclo-bar"><div class="ciclo-fill" style="width:' + pct + '%;background:' + corCiclo + ';"></div></div>' +
                '<div class="ciclo-info"><span class="ciclo-fase" style="color:' + corCiclo + ';">' + (faseLabel[r.faseCiclo] || r.faseCiclo) + '</span><span class="ciclo-dias">' + cicloTexto + '</span></div></div>';
        }
        var fotoArea = r.fotoUrl && r.fotoUrl.trim() ?
            '<div class="pc-card-foto" style="cursor:zoom-in;" onclick="event.stopPropagation();openLightbox(\'' + escapeJsStr(r.fotoUrl) + '\')"><img src="' + escapeHtml(r.fotoUrl) + '" alt="' + escapeHtml(r.numeroRamal) + '" style="width:100%;height:100%;object-fit:contain;" onload="this.style.display=\'block\';var fb=this.nextElementSibling;if(fb)fb.style.display=\'none\';" onerror="this.style.display=\'none\';var fb=this.nextElementSibling;if(fb)fb.style.display=\'flex\';"><div class="pc-photo-fallback" style="display:flex;width:100%;height:100%;align-items:center;justify-content:center;flex-direction:column;gap:8px;background:linear-gradient(135deg, rgba(0,229,199,0.08), rgba(0,229,199,0.02));"><i class="fas fa-phone-alt" style="font-size:42px;color:var(--cyan);opacity:0.7;"></i><span style="font-size:24px;font-weight:800;color:var(--cyan);font-family:\'JetBrains Mono\',monospace;">' + escapeHtml(r.numeroRamal) + '</span></div><div class="pc-card-status-bar"><span class="badge ' + s.c + '"><i class="fas ' + s.i + '" style="font-size:9px;"></i> ' + s.label + '</span></div></div>'
            : '<div class="pc-card-foto" style="background:linear-gradient(135deg, rgba(0,229,199,0.08), rgba(0,229,199,0.02));display:flex;align-items:center;justify-content:center;flex-direction:column;gap:8px;">' +
                '<i class="fas fa-phone-alt" style="font-size:42px;color:var(--cyan);opacity:0.7;"></i>' +
                '<span style="font-size:24px;font-weight:800;color:var(--cyan);font-family:\'JetBrains Mono\',monospace;">' + escapeHtml(r.numeroRamal) + '</span>' +
                '<div class="pc-card-status-bar"><span class="badge ' + s.c + '"><i class="fas ' + s.i + '" style="font-size:9px;"></i> ' + s.label + '</span></div>' +
            '</div>';
        return '<div class="pc-card' + (r.faseCiclo === 'ATRASADO' ? ' pc-card-atrasado' : '') + '" onclick="showRamalDetail(' + r.id + ')">' +
            fotoArea +
            '<div class="pc-card-body">' +
                '<div class="pc-card-name">' + escapeHtml(r.setor) + '</div>' +
                '<div class="pc-card-model">' + escapeHtml(r.descricao || '') + '</div>' +
                '<div class="pc-card-specs">' +
                    '<span class="pc-card-spec"><i class="fas fa-desktop" style="margin-right:4px;font-size:10px;"></i>' + escapeHtml(compName) + '</span>' +
                '</div>' +
                cicloHtml +
                '<div class="pc-card-footer">' +
                    '<span class="pc-card-user"><i class="fas fa-calendar"></i> ' + (r.dataCadastro ? new Date(r.dataCadastro).toLocaleDateString('pt-BR') : '-') + '</span>' +
                    '<div class="pc-card-actions" onclick="event.stopPropagation()">' +
                        '<button onclick="event.stopPropagation();showRamalForm(' + r.id + ')" class="action-btn action-btn-edit" title="Editar"><i class="fas fa-pen"></i></button>' +
                        admin +
                    '</div>' +
                '</div>' +
            '</div>' +
        '</div>';
    }).join('');
}

async function showRamalDetail(id) {
    try {
        var r = await apiFetch('/api/ramais/' + id);
        r.fotoUrl = r.fotoUrl || '';
        var comp = MOCK_COMPUTADORES.find(function(c) { return c.id === r.computadorId; });
        var sm = { 'ATIVO': { c: 'badge-ativo', label: 'Ativo' }, 'INATIVO': { c: 'badge-cancelada', label: 'Inativo' }, 'EM_MANUTENCAO': { c: 'badge-emergencial', label: 'Em Manutencao' }, 'CONFERIR': { c: 'badge-preditiva', label: 'Conferir' } };
        var rst = r.status || 'ATIVO'; var s = sm[rst] || { c: 'badge-inativo', i: 'fa-circle', label: rst };
        var compHtml = comp ?
            '<div style="padding:12px;background:rgba(0,229,199,0.05);border:1px solid rgba(0,229,199,0.1);border-radius:8px;margin-top:12px;cursor:pointer;" onclick="closeModal();showComputadorDetail(' + comp.id + ')">' +
                '<div style="display:flex;align-items:center;gap:10px;"><i class="fas fa-desktop" style="color:var(--cyan);"></i>' +
                '<div><div style="font-weight:600;color:var(--text-primary);">' + escapeHtml(comp.nomePc) + '</div>' +
                '<div style="font-size:11px;color:var(--text-muted);">' + escapeHtml(comp.modeloMarca) + '</div></div></div></div>'
            : '<div style="padding:12px;background:rgba(255,255,255,0.02);border:1px solid var(--border);border-radius:8px;margin-top:12px;text-align:center;color:var(--text-muted);font-size:12px;"><i class="fas fa-link" style="margin-right:4px;"></i>Nenhum computador vinculado</div>';

        var trocasHtml = '';
        try {
            var allTrocas = MOCK_TROCAS.filter(function(t) { return t.tipoEquipamento === 'RAMAL' && t.equipamentoId === r.id; });
            if (allTrocas.length > 0) {
                trocasHtml = '<div style="margin-top:20px;"><h4 style="font-size:13px;color:var(--text-secondary);margin-bottom:10px;"><i class="fas fa-exchange-alt" style="color:var(--primary-light);margin-right:6px;"></i>Historico de Trocas</h4>';
                allTrocas.forEach(function(t) {
                    var icon = t.tipoMovimento === 'ENTRADA' ? 'fa-arrow-down' : t.tipoMovimento === 'SAIDA' ? 'fa-arrow-up' : 'fa-exchange-alt';
                    var iconColor = t.tipoMovimento === 'ENTRADA' ? 'var(--green)' : t.tipoMovimento === 'SAIDA' ? 'var(--red)' : 'var(--yellow)';
                    trocasHtml += '<div style="padding:10px;background:rgba(255,255,255,0.02);border:1px solid var(--border);border-radius:8px;margin-bottom:8px;"><div style="display:flex;justify-content:space-between;align-items:center;"><span style="font-weight:600;color:var(--text-primary);"><i class="fas ' + icon + '" style="color:' + iconColor + ';margin-right:6px;"></i>' + escapeHtml(t.tipoMovimento) + '</span><span style="font-size:11px;color:var(--text-muted);">' + new Date(t.dataTroca).toLocaleDateString('pt-BR') + '</span></div><p style="font-size:12px;color:var(--text-secondary);margin-top:6px;">' + escapeHtml(t.descricao || '') + '</p>' + (t.responsavel ? '<p style="font-size:11px;color:var(--text-muted);margin-top:4px;"><i class="fas fa-user"></i> ' + escapeHtml(t.responsavel) + '</p>' : '') + '</div>';
                });
                trocasHtml += '</div>';
            }
        } catch (e) {}

        var fotoHtml = r.fotoUrl && r.fotoUrl.trim() ?
            '<div class="detail-foto" style="overflow:hidden;width:120px;height:120px;border-radius:12px;flex-shrink:0;cursor:zoom-in;" onclick="openLightbox(\'' + escapeJsStr(r.fotoUrl) + '\')"><img src="' + escapeHtml(r.fotoUrl) + '" alt="' + escapeHtml(r.numeroRamal) + '" style="width:100%;height:100%;object-fit:cover;" onload="this.style.display=\'block\';" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';"><div style="display:none;width:100%;height:100%;border-radius:16px;background:linear-gradient(135deg,rgba(0,229,199,0.12),rgba(0,229,199,0.04));align-items:center;justify-content:center;border:1px solid rgba(0,229,199,0.15);"><i class="fas fa-phone-alt" style="font-size:42px;color:var(--cyan);"></i></div></div>'
            : '<div class="detail-foto" style="width:120px;height:120px;border-radius:16px;background:linear-gradient(135deg,rgba(0,229,199,0.12),rgba(0,229,199,0.04));display:flex;align-items:center;justify-content:center;border:1px solid rgba(0,229,199,0.15);flex-shrink:0;"><i class="fas fa-phone-alt" style="font-size:42px;color:var(--cyan);"></i></div>';

        openModal('Detalhes do Ramal',
            '<div style="padding:10px;">' +
            '<div style="display:flex;align-items:center;gap:20px;">' +
                fotoHtml +
                '<div><h2 style="font-size:22px;font-weight:800;color:var(--cyan);font-family:\'JetBrains Mono\',monospace;">' + escapeHtml(r.numeroRamal) + '</h2>' +
                '<p style="font-size:13px;color:var(--text-secondary);">' + escapeHtml(r.setor) + ' &mdash; ' + escapeHtml(r.descricao || '') + '</p>' +
                '<span class="badge ' + s.c + '">' + s.label + '</span></div>' +
            '</div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:20px;">' +
                '<div><label style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">Setor</label><p style="font-size:13px;color:var(--text-primary);font-weight:500;margin-top:2px;">' + escapeHtml(r.setor) + '</p></div>' +
                '<div><label style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">Data Cadastro</label><p style="font-size:13px;color:var(--text-primary);font-weight:500;margin-top:2px;">' + (r.dataCadastro ? new Date(r.dataCadastro).toLocaleDateString('pt-BR') : '-') + '</p></div>' +
            '</div>' +
            '<div style="margin-top:16px;"><label style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">Computador Vinculado</label>' + compHtml + '</div>' +
            (function() {
                if (r.diasDesdeInicioCiclo === null || r.diasDesdeInicioCiclo === undefined) return '';
                var pct = Math.min(100, Math.max(0, (r.diasDesdeInicioCiclo / 365) * 100));
                var cor = pct < 50 ? 'var(--green)' : pct < 75 ? 'var(--yellow)' : 'var(--red)';
                var faseLabels = { 'ATIVO': 'Ativo (0-6m)', 'PREDITIVO': 'Preditivo (6-9m)', 'PREVENTIVO': 'Preventivo (9-12m)', 'ATRASADO': 'Atrasado (12m+)' };
                var diasTxt = r.diasRestantes > 0 ? r.diasRestantes + ' dias restantes' : r.diasRestantes === 0 ? 'Vence hoje' : 'Atrasado ha ' + Math.abs(r.diasRestantes) + ' dias';
                var dotsHtml = '';
                var fases = ['ATIVO', 'PREDITIVO', 'PREVENTIVO', 'ATRASADO'];
                var fasesCor = ['var(--green)', 'var(--yellow)', 'var(--yellow)', 'var(--red)'];
                var fasesPct = [0, 50, 75, 100];
                for (var fi = 0; fi < fases.length; fi++) {
                    var active = pct >= fasesPct[fi];
                    dotsHtml += '<div style="display:flex;align-items:center;gap:4px;font-size:10px;color:' + (active ? cor : 'var(--text-muted)') + ';opacity:' + (active ? '1' : '0.4') + ';"><span style="width:6px;height:6px;border-radius:50%;background:' + (active ? cor : 'var(--text-muted)') + ';flex-shrink:0;"></span>' + fases[fi].charAt(0) + fases[fi].slice(1).toLowerCase() + '</div>';
                }
                return '<div style="margin-top:16px;padding:14px;background:rgba(255,255,255,0.02);border:1px solid var(--border);border-radius:10px;">' +
                    '<label style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">Ciclo de Vida Util (12 meses)</label>' +
                    '<div style="height:10px;background:rgba(255,255,255,0.06);border-radius:5px;overflow:hidden;margin-top:8px;"><div style="height:100%;width:' + pct + '%;background:' + cor + ';border-radius:5px;transition:width 0.4s ease;"></div></div>' +
                    '<div style="display:flex;justify-content:space-between;margin-top:6px;font-size:11px;">' +
                        '<span style="color:' + cor + ';font-weight:700;">' + (faseLabels[r.faseCiclo] || r.faseCiclo) + '</span>' +
                        '<span style="color:var(--text-muted);font-family:\'JetBrains Mono\',monospace;">' + r.diasDesdeInicioCiclo + ' / 365 dias</span>' +
                    '</div>' +
                    '<div style="display:flex;justify-content:space-between;margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.04);">' +
                        '<div style="display:flex;gap:12px;">' + dotsHtml + '</div>' +
                        '<span style="font-size:11px;font-weight:600;color:' + (r.diasRestantes > 0 ? cor : 'var(--red)') + ';">' + diasTxt + '</span>' +
                    '</div>' +
                '</div>';
            })() +
            trocasHtml +
            '</div>',
            '<button onclick="closeModal()" class="btn btn-ghost btn-sm">Fechar</button><button onclick="showRamalForm(' + r.id + ')" class="btn btn-primary btn-sm"><i class="fas fa-pen"></i> Editar</button>'
        );
    } catch (e) { showToast(e.message, 'error'); }
}

async function showRamalForm(id) {
    var r = { numeroRamal: '', setor: '', descricao: '', computadorId: null, status: 'ATIVO', fotoUrl: '' };
    if (id) { try { r = await apiFetch('/api/ramais/' + id); r.fotoUrl = r.fotoUrl || ''; } catch (e) { showToast('Erro ao carregar ramal: ' + e.message, 'error'); return; } }
    try { allComputadores = await apiFetch('/api/computadores/paginado?page=0&size=1000&status=&termo='); } catch (e) { allComputadores = { content: [] }; }
    var compList = allComputadores.content || allComputadores;
    var compItems = compList.map(function(c) { return { value: String(c.id), label: c.nomePc, sub: c.numeroSerie }; });
    var compInit = compList.find(function(c) { return r.computadorId != null && c.id == r.computadorId; });
    var setorNames = (typeof MOCK_DEPARTAMENTOS !== 'undefined' && MOCK_DEPARTAMENTOS.length > 0) ? MOCK_DEPARTAMENTOS.map(function(d) { return d.nome; }).sort(function(a, b) { return (a || '').localeCompare(b || ''); }) : ['TI', 'Financeiro', 'RH', 'Operacoes', 'Marketing'];
    if (r.setor && setorNames.indexOf(r.setor) === -1) setorNames.unshift(r.setor);
    var setorItems = setorNames.map(function(sn) { return { value: sn, label: sn }; });

    openModal(id ? 'Editar Ramal' : 'Novo Ramal',
        '<form id="ramalForm">' +
        '<div class="form-tabs" id="ramalTabs">' +
        '<button type="button" class="form-tab active" data-tab="tabramalgeral"><i class="fas fa-phone-alt"></i> Geral</button>' +
        '<button type="button" class="form-tab" data-tab="tabramalfoto"><i class="fas fa-camera"></i> Foto</button>' +
        '</div>' +
        '<div id="tabramalgeral" class="form-tab-content active"><div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">' +
        '<div class="form-group"><label class="form-label">Numero do Ramal *</label><input id="ramalNumero" value="' + escapeAttr(r.numeroRamal) + '" required class="form-input" maxlength="10" placeholder="Ex: 1001"></div>' +
        '<div class="form-group"><label class="form-label">Setor *</label><div class="searchable-dropdown"><input type="text" id="ramalSetorSearch" required class="form-input" placeholder="Buscar setor..." autocomplete="off" value="' + escapeAttr(r.setor || '') + '"><input type="hidden" id="ramalSetor" value="' + escapeAttr(r.setor || '') + '"><div id="ramalSetorList" class="searchable-dropdown-list" style="display:none;"></div></div></div>' +
        '</div>' +
        '<div class="form-group" style="margin-top:14px;"><label class="form-label">Descricao</label><input id="ramalDesc" value="' + escapeAttr(r.descricao || '') + '" class="form-input" placeholder="Ex: Ramal sala TI - 1o andar" maxlength="150"></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px;">' +
        '<div class="form-group"><label class="form-label">Computador Vinculado</label><div class="searchable-dropdown"><input type="text" id="ramalCompSearch" class="form-input" placeholder="Buscar computador..." autocomplete="off" value="' + escapeAttr(compInit ? compInit.nomePc : '') + '"><input type="hidden" id="ramalComp" value="' + (r.computadorId != null ? r.computadorId : '') + '"><div id="ramalCompList" class="searchable-dropdown-list" style="display:none;"></div></div></div>' +
        '<div class="form-group"><label class="form-label">Status</label><select id="ramalStatus" class="form-input">' +
            '<option value="ATIVO"' + (r.status === 'ATIVO' ? ' selected' : '') + '>Ativo</option>' +
            '<option value="INATIVO"' + (r.status === 'INATIVO' ? ' selected' : '') + '>Inativo</option>' +
            '<option value="EM_MANUTENCAO"' + (r.status === 'EM_MANUTENCAO' ? ' selected' : '') + '>Em Manutencao</option>' +
            '<option value="CONFERIR"' + (r.status === 'CONFERIR' ? ' selected' : '') + '>Conferir</option>' +
        '</select></div>' +
        '</div></div>' +
        '<div id="tabramalfoto" class="form-tab-content" style="display:none;">' +
            '<div class="photo-upload-area" id="ramalPhotoUploadArea"><input type="file" id="ramalFotoFile" accept=".jpg,.jpeg,.jfif,.png,.gif,.webp,.bmp,.tiff,.tif,.heic,.heif,.avif,.svg,.ico,image/*" style="display:none;">' +
            '<div id="ramalFotoDropZone" class="foto-drop-zone"><div id="ramalFotoPreview" class="foto-preview">' +
            (r.fotoUrl && r.fotoUrl.trim() ? '<div style="position:relative;display:inline-block;"><img src="' + escapeHtml(r.fotoUrl) + '" style="max-height:240px;object-fit:contain;border-radius:8px;border:1px solid var(--border);" onload="this.style.display=\'block\';" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';"><div style="display:none;flex-direction:column;align-items:center;color:var(--red);padding:10px;"><i class="fas fa-exclamation-triangle" style="font-size:16px;"></i><p style="font-size:11px;margin-top:4px;">Imagem nao encontrada</p></div></div><div style="display:flex;gap:4px;margin-top:8px;"><button type="button" onclick="event.stopPropagation();document.getElementById(\'ramalFotoFile\').click();" class="btn btn-primary btn-sm"><i class="fas fa-upload"></i> Trocar Foto</button><button type="button" onclick="event.stopPropagation();removeRamalPhoto()" class="btn btn-ghost btn-sm"><i class="fas fa-trash"></i> Remover</button></div>' : '<i class="fas fa-image" style="font-size:36px;color:var(--text-muted);margin-bottom:12px;opacity:0.4;"></i><p style="font-size:14px;color:var(--text-secondary);margin-bottom:12px;">Arraste fotos ou clique para selecionar</p><button type="button" id="ramalFotoUploadBtn" onclick="event.stopPropagation();document.getElementById(\'ramalFotoFile\').click();" class="btn btn-primary btn-sm"><i class="fas fa-upload"></i> Importar Foto</button><p style="font-size:11px;color:var(--text-muted);margin-top:10px;">JPG, PNG, GIF, WebP, HEIC, AVIF, BMP, TIFF, SVG (max 50MB)</p>') +
            '</div></div><input type="hidden" id="ramalFotoUrlFinal" value="' + escapeAttr(r.fotoUrl || '') + '"></div>' +
        '</div>' +
        '</form>',
        '<button onclick="closeModal()" class="btn btn-ghost btn-sm">Cancelar</button><button onclick="document.getElementById(\'ramalForm\').requestSubmit()" class="btn btn-primary btn-sm"><i class="fas fa-save"></i> ' + (id ? 'Salvar' : 'Cadastrar') + '</button>'
    );
    setupFormTabs();
    setupRamalPhotoUpload();
    setupSearchableSelect('ramalSetorSearch', 'ramalSetor', 'ramalSetorList', setorItems, true);
    setupSearchableSelect('ramalCompSearch', 'ramalComp', 'ramalCompList', compItems, false);
    document.getElementById('ramalForm').addEventListener('submit', async function(e) {
        e.preventDefault();
        if (_ramalPhotoUploading) {
            showToast('Aguarde o envio da foto antes de salvar.', 'warning');
            return;
        }
        var p = {
            numeroRamal: document.getElementById('ramalNumero').value,
            setor: searchableValue('ramalSetorSearch', 'ramalSetor', 'ramalSetorList', true),
            descricao: document.getElementById('ramalDesc').value || null,
            computadorId: (function() { var v = searchableValue('ramalCompSearch', 'ramalComp', 'ramalCompList', false); return v ? parseInt(v) : null; })(),
            status: document.getElementById('ramalStatus').value,
            fotoUrl: document.getElementById('ramalFotoUrlFinal').value || null
        };
        try {
            if (id) {
                await apiFetch('/api/ramais/' + id, { method: 'PUT', body: JSON.stringify(p) });
                showToast('Ramal atualizado!');
            } else {
                await apiFetch('/api/ramais', { method: 'POST', body: JSON.stringify(p) });
                showToast('Ramal cadastrado!');
            }
            closeModal(); loadRamais(currentPage.ramais);
        } catch (e) { showToast(e.message, 'error'); }
    });
}

// ==========================================
// TROCA DE EQUIPAMENTO
// ==========================================
async function loadTrocas() {
    var termo = (document.getElementById('troca-busca-input') || {}).value || '';
    var tipo = (document.getElementById('troca-filtro-tipo') || {}).value || '';
    try {
        var url = '/api/trocas?termo=' + encodeURIComponent(termo);
        if (tipo) url += '&tipoEquipamento=' + tipo;
        var d = await apiFetch(url);
        renderTrocas(d);
    } catch (e) {
        var tb = document.querySelector('#trocasTable tbody');
        if (tb) tb.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted)"><i class="fas fa-inbox"></i> Nenhuma troca encontrada</td></tr>';
    }
}

function renderTrocas(trocas) {
    var tb = document.querySelector('#trocasTable tbody');
    if (!tb) return;
    if (!trocas || trocas.length === 0) {
        tb.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:24px;"><i class="fas fa-inbox"></i> Nenhuma troca encontrada</td></tr>';
        var tp = document.getElementById('troca-pagination'); if (tp) tp.innerHTML = '';
        return;
    }
    var typeIcons = { 'COMPUTADOR': 'fa-desktop', 'RAMAL': 'fa-phone-alt' };
    var typeColors = { 'COMPUTADOR': 'var(--cyan)', 'RAMAL': 'var(--purple)' };
    var movColors = { 'ENTRADA': 'var(--green)', 'SAIDA': 'var(--red)', 'TROCA': 'var(--yellow)' };
    var movIcons = { 'ENTRADA': 'fa-arrow-down', 'SAIDA': 'fa-arrow-up', 'TROCA': 'fa-exchange-alt' };
    tb.innerHTML = trocas.map(function(t) {
        var dt = t.dataTroca ? new Date(t.dataTroca).toLocaleDateString('pt-BR') + ' ' + new Date(t.dataTroca).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '-';
        var tIcon = typeIcons[t.tipoEquipamento] || 'fa-circle';
        var tColor = typeColors[t.tipoEquipamento] || 'var(--text-muted)';
        var mIcon = movIcons[t.tipoMovimento] || 'fa-circle';
        var mColor = movColors[t.tipoMovimento] || 'var(--text-muted)';
        return '<tr>' +
            '<td class="font-medium">' + t.id + '</td>' +
            '<td><span style="display:inline-flex;align-items:center;gap:6px;"><i class="fas ' + tIcon + '" style="color:' + tColor + ';"></i>' + escapeHtml(t.tipoEquipamento) + '</span></td>' +
            '<td style="font-weight:600;color:var(--text-primary);">' + escapeHtml(t.equipamentoNome) + '</td>' +
            '<td><span class="badge badge-' + escapeHtml((t.tipoMovimento || 'SAIDA').toLowerCase()) + '"><i class="fas ' + mIcon + '" style="font-size:8px;margin-right:3px;"></i>' + escapeHtml(t.tipoMovimento) + '</span></td>' +
            '<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeAttr(t.descricao || '') + '">' + escapeHtml(t.descricao || '-') + '</td>' +
            '<td>' + escapeHtml(t.responsavel || '-') + '</td>' +
            '<td style="white-space:nowrap;">' + dt + '</td>' +
            '<td onclick="event.stopPropagation()"><div style="display:flex;gap:4px;">' +
                '<button onclick="showTrocaForm(' + t.id + ')" class="action-btn action-btn-edit"><i class="fas fa-pen"></i></button>' +
                '<button onclick="confirmDelete(\'troca\',' + t.id + ',\'' + escapeJsStr(t.equipamentoNome) + '\')" class="action-btn action-btn-delete"><i class="fas fa-trash"></i></button>' +
            '</div></td></tr>';
    }).join('');
}

async function showTrocaForm(id) {
    var t = { tipoEquipamento: 'COMPUTADOR', equipamentoId: null, equipamentoNome: '', tipoMovimento: 'TROCA', descricao: '', responsavel: '', observacoes: '' };
    if (id) { try { t = await apiFetch('/api/trocas/' + id); } catch (e) { showToast('Erro ao carregar troca: ' + e.message, 'error'); return; } }

    try { allComputadores = await apiFetch('/api/computadores/paginado?page=0&size=1000&status=&termo='); } catch (e) { allComputadores = { content: [] }; }
    var compList = allComputadores.content || allComputadores;
    var trocaEquipItems = compList.map(function(c) {
        return { value: 'COMPUTADOR:' + c.id + ':' + c.nomePc, label: 'PC: ' + c.nomePc + ' (' + c.numeroSerie + ')' };
    });
    var ramais = [];
    try { ramais = await apiFetch('/api/ramais'); } catch (e) {}
    ramais.forEach(function(rm) {
        trocaEquipItems.push({ value: 'RAMAL:' + rm.id + ':Ramal ' + rm.numeroRamal, label: 'Ramal: ' + rm.numeroRamal + ' (' + rm.setor + ')' });
    });
    var trocaEquipInitVal = (t.tipoEquipamento && t.equipamentoId != null) ? (t.tipoEquipamento + ':' + t.equipamentoId + ':' + (t.equipamentoNome || '')) : '';
    var trocaEquipInitLabel = '';
    if (trocaEquipInitVal) {
        for (var tei = 0; tei < trocaEquipItems.length; tei++) {
            if (trocaEquipItems[tei].value === trocaEquipInitVal) { trocaEquipInitLabel = trocaEquipItems[tei].label; break; }
        }
        if (!trocaEquipInitLabel) trocaEquipInitLabel = t.equipamentoNome || '';
    }
    var usuarios = [];
    try { usuarios = await apiFetch('/api/usuarios'); } catch (e) {}
    var trocaRespItems = usuarios.map(function(u) { return { value: u.nomeCompleto, label: u.nomeCompleto, sub: u.perfil }; });

    openModal(id ? 'Editar Troca' : 'Nova Troca',
        '<form id="trocaForm">' +
        '<div class="form-group"><label class="form-label">Equipamento *</label><div class="searchable-dropdown"><input type="text" id="trocaEquipSearch" required class="form-input" placeholder="Buscar equipamento..." autocomplete="off" value="' + escapeAttr(trocaEquipInitLabel) + '"><input type="hidden" id="trocaEquipamento" value="' + escapeAttr(trocaEquipInitVal) + '"><div id="trocaEquipList" class="searchable-dropdown-list" style="display:none;"></div></div></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px;">' +
        '<div class="form-group"><label class="form-label">Tipo de Movimento *</label><select id="trocaMovimento" required class="form-input">' +
            '<option value="ENTRADA"' + (t.tipoMovimento === 'ENTRADA' ? ' selected' : '') + '>Entrada</option>' +
            '<option value="SAIDA"' + (t.tipoMovimento === 'SAIDA' ? ' selected' : '') + '>Saida</option>' +
            '<option value="TROCA"' + (t.tipoMovimento === 'TROCA' ? ' selected' : '') + '>Troca</option>' +
        '</select></div>' +
        '<div class="form-group"><label class="form-label">Responsavel</label><div class="searchable-dropdown"><input type="text" id="trocaRespSearch" class="form-input" placeholder="Buscar respons�vel..." autocomplete="off" value="' + escapeAttr(t.responsavel || '') + '"><input type="hidden" id="trocaResp" value="' + escapeAttr(t.responsavel || '') + '"><div id="trocaRespList" class="searchable-dropdown-list" style="display:none;"></div></div></div>' +
        '</div>' +
        '<div class="form-group" style="margin-top:14px;"><label class="form-label">Descricao *</label><textarea id="trocaDesc" required class="form-input" style="min-height:80px;resize:vertical;" placeholder="Descreva a movimentacao...">' + escapeHtml(t.descricao || '') + '</textarea></div>' +
        '<div class="form-group" style="margin-top:14px;"><label class="form-label">Observacoes</label><textarea id="trocaObs" class="form-input" style="min-height:60px;resize:vertical;">' + escapeHtml(t.observacoes || '') + '</textarea></div>' +
        '</form>',
        '<button onclick="closeModal()" class="btn btn-ghost btn-sm">Cancelar</button><button onclick="document.getElementById(\'trocaForm\').requestSubmit()" class="btn btn-primary btn-sm"><i class="fas fa-save"></i> ' + (id ? 'Salvar' : 'Registrar') + '</button>'
    );
    setupSearchableSelect('trocaEquipSearch', 'trocaEquipamento', 'trocaEquipList', trocaEquipItems, false);
    setupSearchableSelect('trocaRespSearch', 'trocaResp', 'trocaRespList', trocaRespItems, false);
    document.getElementById('trocaForm').addEventListener('submit', async function(e) {
        e.preventDefault();
        var eqVal = searchableValue('trocaEquipSearch', 'trocaEquipamento', 'trocaEquipList', false);
        if (!eqVal) { showToast('Selecione um equipamento', 'error'); return; }
        var parts = eqVal.split(':');
        var p = {
            tipoEquipamento: parts[0],
            equipamentoId: parseInt(parts[1]),
            equipamentoNome: parts[2] || '',
            tipoMovimento: document.getElementById('trocaMovimento').value,
            descricao: document.getElementById('trocaDesc').value,
            responsavel: searchableValue('trocaRespSearch', 'trocaResp', 'trocaRespList', false) || null,
            observacoes: document.getElementById('trocaObs').value || null
        };
        try {
            if (id) {
                await apiFetch('/api/trocas/' + id, { method: 'PUT', body: JSON.stringify(p) });
                showToast('Troca atualizada!');
            } else {
                await apiFetch('/api/trocas', { method: 'POST', body: JSON.stringify(p) });
                showToast('Troca registrada!');
            }
            closeModal(); loadTrocas(); refreshAllData();
        } catch (e) { showToast(e.message, 'error'); }
    });
}

// GLOBAL REFRESH HELPER
function refreshCurrentSection(tipo) {
    switch (_currentSection) {
        case 'painel': loadDashboard(); break;
        case 'computadores': loadComputadores(currentPage.computadores); break;
        case 'ramais': loadRamais(currentPage.ramais); break;
        case 'manutencoes': loadManutencoes(currentPage.manutencoes); break;
        case 'ordens-servico': loadOrdensServico(currentPage.ordensServico); break;
        case 'trocas': loadTrocas(); break;
        case 'departamentos': loadDepartamentos(); break;
        case 'software-licencas': loadSoftwareLicencas(currentPage.software || 0); break;
        case 'logs': loadLogs(currentPage.logs); break;
        case 'relatorios': loadRelatorios(); break;
        case 'usuarios': loadUsuarios(); break;
        case 'admin': loadAdmin(); break;
    }
}

function refreshAllData() {
    refreshCurrentSection();
}

// ==========================================
// LIGHTBOX - Click to expand images
// ==========================================
function openLightbox(src) {
    if (!src || src.indexOf('data:image/svg+xml') === 0) return;
    var lb = document.getElementById('lightbox-overlay');
    var img = document.getElementById('lightbox-img');
    if (lb && img) { img.src = src; lb.classList.add('active'); }
}
function closeLightbox() {
    var lb = document.getElementById('lightbox-overlay');
    if (lb) lb.classList.remove('active');
}

// ==========================================
// PROFESSIONAL PDF REPORT GENERATION (Client-Side jsPDF)
// ==========================================
var PDF_PRIMARY = [0, 229, 199];
var PDF_DARK = [15, 23, 42];
var PDF_GRAY = [100, 116, 139];
var PDF_LIGHT = [241, 245, 249];

function pdfCreateHeader(doc, title, subtitle) {
    doc.setFillColor(PDF_DARK[0], PDF_DARK[1], PDF_DARK[2]);
    doc.rect(0, 0, 210, 28, 'F');
    doc.setFillColor(PDF_PRIMARY[0], PDF_PRIMARY[1], PDF_PRIMARY[2]);
    doc.rect(0, 28, 210, 0.5, 'F');
    doc.setFillColor(PDF_PRIMARY[0], PDF_PRIMARY[1], PDF_PRIMARY[2]);
    doc.rect(0, 0, 4, 28, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('INVENTARIO DE TI', 10, 11);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(title, 10, 18);
    if (subtitle) {
        doc.setFontSize(7);
        doc.setTextColor(180, 200, 220);
        doc.text(subtitle, 10, 24);
    }
    doc.setFontSize(7);
    doc.setTextColor(180, 200, 220);
    doc.text(new Date().toLocaleDateString('pt-BR') + ' ' + new Date().toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'}), 200, 11, { align: 'right' });
    doc.setTextColor(PDF_DARK[0], PDF_DARK[1], PDF_DARK[2]);
}

function pdfAddFooter(doc, pageCount) {
    var h = doc.internal.pageSize.height;
    doc.setFillColor(PDF_PRIMARY[0], PDF_PRIMARY[1], PDF_PRIMARY[2]);
    doc.rect(0, h - 12, 210, 12, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(6);
    doc.setFont('helvetica', 'bold');
    doc.text('INVENTARIO DE TI', 12, h - 4);
    doc.setFont('helvetica', 'normal');
    doc.text('| Documento Confidencial', 52, h - 4);
    doc.text('Pag. ' + (pageCount || '1/1'), 200, h - 4, { align: 'right' });
}

function pdfSectionTitle(doc, title, y) {
    if (y > 258) { doc.addPage(); y = 20; }
    doc.setFillColor(PDF_PRIMARY[0], PDF_PRIMARY[1], PDF_PRIMARY[2]);
    doc.rect(12, y, 2, 6, 'F');
    doc.setFillColor(0, 229, 199);
    doc.rect(12, y + 6, 186, 0.3, 'F');
    doc.setTextColor(PDF_DARK[0], PDF_DARK[1], PDF_DARK[2]);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(title, 17, y + 4.5);
    doc.setFont('helvetica', 'normal');
    return y + 10;
}

function pdfKpiRow(doc, items, y) {
    var w = (186 / items.length) - 2;
    var x = 12;
    items.forEach(function(item) {
        doc.setFillColor(PDF_LIGHT[0], PDF_LIGHT[1], PDF_LIGHT[2]);
        doc.roundedRect(x, y, w, 14, 1.5, 1.5, 'F');
        doc.setFillColor(PDF_PRIMARY[0], PDF_PRIMARY[1], PDF_PRIMARY[2]);
        doc.rect(x, y, 2, 14, 'F');
        doc.setTextColor(PDF_DARK[0], PDF_DARK[1], PDF_DARK[2]);
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text(String(item.v), x + w / 2, y + 6.5, { align: 'center' });
        doc.setTextColor(PDF_GRAY[0], PDF_GRAY[1], PDF_GRAY[2]);
        doc.setFontSize(5.5);
        doc.setFont('helvetica', 'normal');
        doc.text(item.l, x + w / 2, y + 11, { align: 'center' });
        x += w + 2;
    });
    return y + 18;
}

function pdfDrawBarChart(doc, title, labels, values, colors, x, y, w, h) {
    if (y + h + 12 > 270) { doc.addPage(); y = 20; }
    doc.setTextColor(PDF_DARK[0], PDF_DARK[1], PDF_DARK[2]);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text(title, x, y);
    y += 4;
    var maxVal = Math.max.apply(null, values) || 1;
    var barW = (w - 10) / labels.length;
    var chartH = h - 8;
    doc.setFillColor(245, 248, 252);
    doc.rect(x, y, w, chartH, 'F');
    for (var i = 0; i < 4; i++) {
        var ly = y + (chartH * i / 4);
        doc.setDrawColor(220, 225, 235);
        doc.setLineWidth(0.1);
        doc.line(x, ly, x + w, ly);
        doc.setTextColor(160, 170, 180);
        doc.setFontSize(4.5);
        doc.text(String(Math.round(maxVal - maxVal * i / 4)), x - 1, ly + 1.5, { align: 'right' });
    }
    labels.forEach(function(label, i) {
        var barH = (values[i] / maxVal) * chartH;
        var bx = x + 6 + i * barW;
        var by = y + chartH - barH;
        var c = colors[i % colors.length];
        doc.setFillColor(c[0], c[1], c[2]);
        doc.roundedRect(bx, by, barW - 4, barH, 1, 1, 'F');
        doc.setTextColor(PDF_DARK[0], PDF_DARK[1], PDF_DARK[2]);
        doc.setFontSize(5);
        doc.setFont('helvetica', 'bold');
        doc.text(String(values[i]), bx + (barW - 4) / 2, by - 1.5, { align: 'center' });
        doc.setTextColor(PDF_GRAY[0], PDF_GRAY[1], PDF_GRAY[2]);
        doc.setFontSize(4.5);
        doc.setFont('helvetica', 'normal');
        var lbl = label.length > 8 ? label.substring(0, 7) + '.' : label;
        doc.text(lbl, bx + (barW - 4) / 2, y + chartH + 3, { align: 'center' });
    });
    return y + chartH + 8;
}

function pdfDrawComparisonBars(doc, title, labels, valA, valB, labelA, labelB, x, y, w, h) {
    if (y + h + 12 > 270) { doc.addPage(); y = 20; }
    doc.setTextColor(PDF_DARK[0], PDF_DARK[1], PDF_DARK[2]);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.text(title, x, y);
    doc.setFontSize(5);
    doc.setFont('helvetica', 'normal');
    doc.setFillColor(PDF_PRIMARY[0], PDF_PRIMARY[1], PDF_PRIMARY[2]);
    doc.circle(x + w - 30, y - 1, 1.5, 'F');
    doc.setTextColor(PDF_GRAY[0], PDF_GRAY[1], PDF_GRAY[2]);
    doc.text(labelA, x + w - 27, y - 0.5);
    doc.setFillColor(140, 160, 180);
    doc.circle(x + w - 14, y - 1, 1.5, 'F');
    doc.text(labelB, x + w - 11, y - 0.5);
    y += 4;
    var maxVal = Math.max(Math.max.apply(null, valA), Math.max.apply(null, valB)) || 1;
    var groupW = (w - 10) / labels.length;
    var chartH = h - 8;
    doc.setFillColor(245, 248, 252);
    doc.rect(x, y, w, chartH, 'F');
    for (var i = 0; i < 4; i++) {
        var ly = y + (chartH * i / 4);
        doc.setDrawColor(220, 225, 235);
        doc.setLineWidth(0.1);
        doc.line(x, ly, x + w, ly);
        doc.setTextColor(160, 170, 180);
        doc.setFontSize(4.5);
        doc.text(String(Math.round(maxVal - maxVal * i / 4)), x - 1, ly + 1.5, { align: 'right' });
    }
    labels.forEach(function(label, i) {
        var bx = x + 8 + i * groupW;
        var b1H = (valA[i] / maxVal) * chartH;
        var b2H = (valB[i] / maxVal) * chartH;
        doc.setFillColor(PDF_PRIMARY[0], PDF_PRIMARY[1], PDF_PRIMARY[2]);
        doc.roundedRect(bx, y + chartH - b1H, (groupW - 6) / 2, b1H, 1, 1, 'F');
        doc.setFillColor(140, 160, 180);
        doc.roundedRect(bx + (groupW - 6) / 2 + 1, y + chartH - b2H, (groupW - 6) / 2, b2H, 1, 1, 'F');
        if (valA[i] > 0) { doc.setTextColor(PDF_DARK[0], PDF_DARK[1], PDF_DARK[2]); doc.setFontSize(4.5); doc.setFont('helvetica', 'bold'); doc.text(String(valA[i]), bx + (groupW - 6) / 4, y + chartH - b1H - 1, { align: 'center' }); }
        if (valB[i] > 0) { doc.setTextColor(PDF_GRAY[0], PDF_GRAY[1], PDF_GRAY[2]); doc.setFontSize(4.5); doc.text(String(valB[i]), bx + (groupW - 6) / 2 + 1 + (groupW - 6) / 4, y + chartH - b2H - 1, { align: 'center' }); }
        doc.setTextColor(PDF_GRAY[0], PDF_GRAY[1], PDF_GRAY[2]);
        doc.setFontSize(4.5);
        doc.setFont('helvetica', 'normal');
        var lbl = label.length > 9 ? label.substring(0, 8) + '.' : label;
        doc.text(lbl, bx + (groupW - 6) / 2, y + chartH + 3, { align: 'center' });
    });
    return y + chartH + 8;
}

function pdfTable(doc, head, body, startY) {
    if (startY > 250) { doc.addPage(); startY = 20; }
    doc.autoTable({
        startY: startY,
        margin: { left: 12, right: 12 },
        head: [head],
        body: body,
        theme: 'striped',
        headStyles: { fillColor: [0, 229, 199], textColor: 255, fontSize: 6.5, fontStyle: 'bold', cellPadding: 1.5 },
        bodyStyles: { fontSize: 6, textColor: [15, 23, 42], cellPadding: 1.5 },
        alternateRowStyles: { fillColor: [245, 248, 252] },
        styles: { lineWidth: 0.1, lineColor: [203, 213, 225] }
    });
    return doc.lastAutoTable.finalY;
}

function pdfFinalize(doc, name) {
    var total = doc.internal.getNumberOfPages();
    for (var i = 1; i <= total; i++) {
        doc.setPage(i);
        pdfAddFooter(doc, i + ' / ' + total);
    }
    doc.save(name + '_' + new Date().toISOString().slice(0, 10) + '.pdf');
}

function getMonthData(date) {
    var d = date || new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
}

function isSameMonth(dateStr, year, month) {
    if (!dateStr) return false;
    var d = new Date(dateStr);
    return d.getFullYear() === year && d.getMonth() === month;
}

function filterByMonth(items, year, month) {
    return items.filter(function(item) {
        var date = item.dataCadastro || item.dataTroca || item.dataAbertura || item.dataAtividade;
        return isSameMonth(date, year, month);
    });
}

function generateRelatorioMensalPDF() {
    showToast('Gerando Relatorio Mensal...', 'info');
    var doc = new jspdf.jsPDF();
    var now = new Date();
    var curMonth = now.getMonth();
    var curYear = now.getFullYear();
    var prevDate = new Date(curYear, curMonth - 1, 1);
    var prevMonth = prevDate.getMonth();
    var prevYear = prevDate.getFullYear();
    var monthNames = ['Janeiro','Fevereiro','Marco','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    var curLabel = monthNames[curMonth] + ' ' + curYear;
    var prevLabel = monthNames[prevMonth] + ' ' + prevYear;
    var comps = MOCK_COMPUTADORES || [];
    var manutAll = MOCK_MANUTENCOES || [];
    var osAll = MOCK_ORDENS || [];
    var trocasAll = MOCK_TROCAS || [];
    var manutCur = filterByMonth(manutAll, curYear, curMonth);
    var manutPrev = filterByMonth(manutAll, prevYear, prevMonth);
    var osCur = filterByMonth(osAll, curYear, curMonth);
    var osPrev = filterByMonth(osAll, prevYear, prevMonth);
    var trocasCur = filterByMonth(trocasAll, curYear, curMonth);
    var trocasPrev = filterByMonth(trocasAll, prevYear, prevMonth);

    pdfCreateHeader(doc, 'Relatorio Mensal - ' + curLabel, 'Comparativo: ' + curLabel + ' vs ' + prevLabel);
    var y = 34;

    y = pdfSectionTitle(doc, 'Resumo Comparativo', y);
    y = pdfKpiRow(doc, [
        { l: 'Manut. ' + monthNames[curMonth].substring(0,3), v: manutCur.length },
        { l: 'Manut. ' + monthNames[prevMonth].substring(0,3), v: manutPrev.length },
        { l: 'OS ' + monthNames[curMonth].substring(0,3), v: osCur.length },
        { l: 'OS ' + monthNames[prevMonth].substring(0,3), v: osPrev.length },
        { l: 'Trocas ' + monthNames[curMonth].substring(0,3), v: trocasCur.length },
        { l: 'Trocas ' + monthNames[prevMonth].substring(0,3), v: trocasPrev.length }
    ], y);

    var manutTipos = ['CORRETIVA', 'PREVENTIVA', 'PREDITIVA', 'EMERGENCIAL'];
    var manutTipoLabels = ['Corretiva', 'Preventiva', 'Preditiva', 'Emergencial'];
    var manutCurByType = manutTipos.map(function(t) { return manutCur.filter(function(m) { return m.tipo === t; }).length; });
    var manutPrevByType = manutTipos.map(function(t) { return manutPrev.filter(function(m) { return m.tipo === t; }).length; });
    y = pdfDrawComparisonBars(doc, 'Manutencoes por Tipo (' + curLabel + ' vs ' + prevLabel + ')', manutTipoLabels, manutCurByType, manutPrevByType, monthNames[curMonth].substring(0,3), monthNames[prevMonth].substring(0,3), 12, y, 186, 35);

    var osPrioridades = ['CRITICA', 'ALTA', 'MEDIA', 'BAIXA'];
    var osPriorLabels = ['Critica', 'Alta', 'Media', 'Baixa'];
    var osCurByPri = osPrioridades.map(function(p) { return osCur.filter(function(o) { return o.prioridade === p; }).length; });
    var osPrevByPri = osPrioridades.map(function(p) { return osPrev.filter(function(o) { return o.prioridade === p; }).length; });
    y = pdfDrawComparisonBars(doc, 'OS por Prioridade (' + curLabel + ' vs ' + prevLabel + ')', osPriorLabels, osCurByPri, osPrevByPri, monthNames[curMonth].substring(0,3), monthNames[prevMonth].substring(0,3), 12, y, 186, 35);

    var trocaTipos = ['ENTRADA', 'SAIDA', 'TROCA'];
    var trocaTipoLabels = ['Entrada', 'Saida', 'Troca'];
    var trocasCurByType = trocaTipos.map(function(t) { return trocasCur.filter(function(tr) { return tr.tipoMovimento === t; }).length; });
    var trocasPrevByType = trocaTipos.map(function(t) { return trocasPrev.filter(function(tr) { return tr.tipoMovimento === t; }).length; });
    y = pdfDrawComparisonBars(doc, 'Trocas por Movimento (' + curLabel + ' vs ' + prevLabel + ')', trocaTipoLabels, trocasCurByType, trocasPrevByType, monthNames[curMonth].substring(0,3), monthNames[prevMonth].substring(0,3), 12, y, 186, 35);

    var manutStatusLabels = ['Pendente', 'Em Andamento', 'Concluida', 'Cancelada'];
    var manutStatuses = ['PENDENTE', 'EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA'];
    var manutCurByStatus = manutStatuses.map(function(s) { return manutCur.filter(function(m) { return m.status === s; }).length; });
    var manutPrevByStatus = manutStatuses.map(function(s) { return manutPrev.filter(function(m) { return m.status === s; }).length; });
    y = pdfDrawComparisonBars(doc, 'Status Manutencoes (' + curLabel + ' vs ' + prevLabel + ')', manutStatusLabels, manutCurByStatus, manutPrevByStatus, monthNames[curMonth].substring(0,3), monthNames[prevMonth].substring(0,3), 12, y, 186, 35);

    var osStatusLabels = ['Aberta', 'Analise', 'Execucao', 'Concluida', 'Cancelada'];
    var osStatuses = ['ABERTA', 'EM_ANALISE', 'EM_EXECUCAO', 'CONCLUIDA', 'CANCELADA'];
    var osCurByStatus = osStatuses.map(function(s) { return osCur.filter(function(o) { return o.status === s; }).length; });
    var osPrevByStatus = osStatuses.map(function(s) { return osPrev.filter(function(o) { return o.status === s; }).length; });
    y = pdfDrawComparisonBars(doc, 'Status Ordens de Servico (' + curLabel + ' vs ' + prevLabel + ')', osStatusLabels, osCurByStatus, osPrevByStatus, monthNames[curMonth].substring(0,3), monthNames[prevMonth].substring(0,3), 12, y, 186, 35);

    y += 3;
    if (y > 230) { doc.addPage(); y = 20; }
    y = pdfSectionTitle(doc, 'Detalhamento - Manutencoes ' + curLabel, y);
    if (manutCur.length > 0) {
        y = pdfTable(doc, ['PC', 'Tipo', 'Status', 'Tecnico', 'Descricao'], manutCur.map(function(m) {
            return [m.computadorNome || '-', m.tipo || '-', (m.status || '-').replace(/_/g, ' '), m.tecnicoResponsavel || '-', (m.descricao || '-').substring(0, 30)];
        }), y);
    } else {
        doc.setTextColor(PDF_GRAY[0], PDF_GRAY[1], PDF_GRAY[2]);
        doc.setFontSize(7);
        doc.text('Nenhuma manutencao registrada neste mes.', 12, y + 2);
        y += 6;
    }
    y += 3;
    if (y > 230) { doc.addPage(); y = 20; }
    y = pdfSectionTitle(doc, 'Detalhamento - Ordens de Servico ' + curLabel, y);
    if (osCur.length > 0) {
        y = pdfTable(doc, ['Titulo', 'Prioridade', 'Status', 'Solicitante', 'Tecnico'], osCur.map(function(o) {
            return [(o.titulo || '-').substring(0, 28), o.prioridade || '-', (o.status || '-').replace(/_/g, ' '), o.solicitante || '-', o.tecnicoResponsavel || '-'];
        }), y);
    } else {
        doc.setTextColor(PDF_GRAY[0], PDF_GRAY[1], PDF_GRAY[2]);
        doc.setFontSize(7);
        doc.text('Nenhuma OS registrada neste mes.', 12, y + 2);
        y += 6;
    }
    y += 3;
    if (y > 230) { doc.addPage(); y = 20; }
    y = pdfSectionTitle(doc, 'Detalhamento - Trocas ' + curLabel, y);
    if (trocasCur.length > 0) {
        y = pdfTable(doc, ['Data', 'Tipo', 'Movto', 'Equipamento', 'Responsavel'], trocasCur.map(function(t) {
            return [t.dataTroca ? new Date(t.dataTroca).toLocaleDateString('pt-BR') : '-', t.tipoEquipamento || '-', t.tipoMovimento || '-', t.equipamentoNome || '-', t.responsavel || '-'];
        }), y);
    } else {
        doc.setTextColor(PDF_GRAY[0], PDF_GRAY[1], PDF_GRAY[2]);
        doc.setFontSize(7);
        doc.text('Nenhuma troca registrada neste mes.', 12, y + 2);
        y += 6;
    }

    y += 6;
    if (y > 240) { doc.addPage(); y = 20; }
    y = pdfSectionTitle(doc, 'Resumo por Setor - Manutencoes ' + curLabel, y);
    var setores = {};
    manutCur.forEach(function(m) {
        var comp = comps.find(function(c) { return c.id === m.computadorId; });
        var setor = comp ? (comp.departamento || comp.usuarioDesignado || 'Nao atribuido') : 'Nao atribuido';
        setores[setor] = (setores[setor] || 0) + 1;
    });
    var setorKeys = Object.keys(setores);
    if (setorKeys.length > 0) {
        var setorVals = setorKeys.map(function(k) { return setores[k]; });
        var colors = [[0,229,199],[56,189,248],[251,191,36],[239,68,68],[168,85,247],[34,197,94]];
        y = pdfDrawBarChart(doc, 'Manutencoes por Setor/Responsavel', setorKeys.map(function(k) { return k.substring(0, 8); }), setorVals, colors, 12, y, 186, 30);
    } else {
        doc.setTextColor(PDF_GRAY[0], PDF_GRAY[1], PDF_GRAY[2]);
        doc.setFontSize(7);
        doc.text('Sem dados por setor neste mes.', 12, y + 2);
    }

    pdfFinalize(doc, 'Relatorio_Mensal_' + monthNames[curMonth] + '_' + curYear);
    showToast('Relatorio Mensal PDF gerado!', 'success');
}

function generateRelatorioComputadoresPDF() {
    showToast('Gerando PDF...', 'info');
    var doc = new jspdf.jsPDF();
    var c = MOCK_COMPUTADORES || [];
    pdfCreateHeader(doc, 'Relatorio de Computadores');
    var y = 28;
    y = pdfSectionTitle(doc, 'Resumo', y);
    var ativos = c.filter(function(x) { return (x.status || 'ATIVO') === 'ATIVO'; }).length;
    var manut = c.filter(function(x) { return (x.status || '').indexOf('MANUTENCAO') !== -1; }).length;
    var conc = c.filter(function(x) { return x.status === 'CONCLUIDO'; }).length;
    y = pdfKpiRow(doc, [{ l: 'Total', v: c.length }, { l: 'Ativos', v: ativos }, { l: 'Manutencao', v: manut }, { l: 'Concluidos', v: conc }], y);
    y = pdfSectionTitle(doc, 'Lista de Computadores (' + c.length + ')', y);
    y = pdfTable(doc, ['Nome PC', 'Modelo', 'Usuario', 'Status', 'Data'], c.map(function(x) {
        return [x.nomePc || '-', x.modeloMarca || '-', x.usuarioDesignado || '-', (x.status || '-').replace('MANUTENCAO_', 'MAN.'), x.dataCadastro ? new Date(x.dataCadastro).toLocaleDateString('pt-BR') : '-'];
    }), y);
    pdfFinalize(doc, 'Relatorio_Computadores');
    showToast('PDF gerado!', 'success');
}

function generateRelatorioRamaisPDF() {
    showToast('Gerando PDF...', 'info');
    var doc = new jspdf.jsPDF();
    var r = MOCK_RAMAIS || [];
    pdfCreateHeader(doc, 'Relatorio de Ramais');
    var y = 28;
    y = pdfSectionTitle(doc, 'Resumo', y);
    var ativos = r.filter(function(x) { return (x.status || 'ATIVO') === 'ATIVO'; }).length;
    var inat = r.filter(function(x) { return x.status === 'INATIVO'; }).length;
    var manut = r.filter(function(x) { return x.status === 'EM_MANUTENCAO'; }).length;
    y = pdfKpiRow(doc, [{ l: 'Total', v: r.length }, { l: 'Ativos', v: ativos }, { l: 'Inativos', v: inat }, { l: 'Manutencao', v: manut }], y);
    y = pdfSectionTitle(doc, 'Lista de Ramais (' + r.length + ')', y);
    y = pdfTable(doc, ['Numero', 'Setor', 'Descricao', 'Status', 'Cadastro'], r.map(function(x) {
        return [x.numeroRamal || '-', x.setor || '-', (x.descricao || '-').substring(0, 35), x.status || '-', x.dataCadastro ? new Date(x.dataCadastro).toLocaleDateString('pt-BR') : '-'];
    }), y);
    pdfFinalize(doc, 'Relatorio_Ramais');
    showToast('PDF gerado!', 'success');
}

function generateRelatorioTrocasPDF() {
    showToast('Gerando PDF...', 'info');
    var doc = new jspdf.jsPDF();
    var t = MOCK_TROCAS || [];
    pdfCreateHeader(doc, 'Relatorio de Trocas e Movimentacoes');
    var y = 28;
    y = pdfSectionTitle(doc, 'Resumo', y);
    var ent = t.filter(function(x) { return x.tipoMovimento === 'ENTRADA'; }).length;
    var sai = t.filter(function(x) { return x.tipoMovimento === 'SAIDA'; }).length;
    var tro = t.filter(function(x) { return x.tipoMovimento === 'TROCA'; }).length;
    y = pdfKpiRow(doc, [{ l: 'Total', v: t.length }, { l: 'Entradas', v: ent }, { l: 'Saidas', v: sai }, { l: 'Trocas', v: tro }], y);
    y = pdfSectionTitle(doc, 'Historico de Movimentacoes (' + t.length + ')', y);
    y = pdfTable(doc, ['Data', 'Tipo', 'Movto', 'Equipamento', 'Descricao', 'Responsavel'], t.map(function(x) {
        return [x.dataTroca ? new Date(x.dataTroca).toLocaleDateString('pt-BR') : '-', x.tipoEquipamento || '-', x.tipoMovimento || '-', x.equipamentoNome || '-', (x.descricao || '-').substring(0, 30), x.responsavel || '-'];
    }), y);
    pdfFinalize(doc, 'Relatorio_Trocas');
    showToast('PDF gerado!', 'success');
}

function generateRelatorioHistoricoPDF() {
    showToast('Gerando PDF do Hist�rico...', 'info');
    var usuario = ((document.getElementById('log-busca-usuario') || {}).value || '');
    var entidade = ((document.getElementById('log-filtro-entidade') || {}).value || '');
    var mesEl = document.getElementById('log-filtro-mes');
    var anoEl = document.getElementById('log-filtro-ano');
    var mes = mesEl ? mesEl.value : '';
    var ano = anoEl ? anoEl.value : '';
    if (mes === undefined || mes === null) mes = '';
    if (ano === undefined || ano === null) ano = '';
    var sl = usuario.toLowerCase();
    var periodLabel = 'Todos os per�odos';
    if (mes !== '' && ano !== '') periodLabel = LOG_MONTHS[parseInt(mes)] + ' ' + ano;
    else if (ano !== '') periodLabel = 'Ano ' + ano;
    else if (mes !== '') periodLabel = LOG_MONTHS[parseInt(mes)];
    var items = (MOCK_LOGS || []).filter(function(l) {
        if (usuario && (l.usuario || '').toLowerCase().indexOf(sl) === -1) return false;
        if (entidade && l.entidade !== entidade) return false;
        if (mes !== '' || ano !== '') {
            var d = new Date(l.dataAtividade);
            if (!l.dataAtividade || isNaN(d.getTime())) return false;
            if (mes !== '' && d.getMonth() !== parseInt(mes)) return false;
            if (ano !== '' && d.getFullYear() !== parseInt(ano)) return false;
        }
        return true;
    }).slice().sort(function(a, b) { return new Date(b.dataAtividade) - new Date(a.dataAtividade); });
    var doc = new jspdf.jsPDF();
    pdfCreateHeader(doc, 'Relat�rio de Hist�rico - ' + periodLabel);
    var y = 28;
    y = pdfSectionTitle(doc, 'Resumo', y);
    function countAcao(a) { return items.filter(function(x) { return x.acao === a; }).length; }
    y = pdfKpiRow(doc, [
        { l: 'Total', v: items.length },
        { l: 'Logins', v: countAcao('LOGIN') },
        { l: 'Cria��es', v: countAcao('CRIACAO') },
        { l: 'Altera��es', v: countAcao('ALTERACAO') },
        { l: 'Exclus�es', v: countAcao('EXCLUSAO') }
    ], y);
    y = pdfSectionTitle(doc, 'Registros (' + items.length + ') - ' + periodLabel, y);
    y = pdfTable(doc, ['Data', 'Usu�rio', 'A��o', 'Entidade', 'Descri��o'], items.map(function(x) {
        return [x.dataAtividade ? new Date(x.dataAtividade).toLocaleDateString('pt-BR') : '-', x.usuario || '-', x.acao || '-', x.entidade || '-', (x.descricao || '-').substring(0, 45)];
    }), y);
    var fileName = 'Relatorio_Historico' + (ano !== '' ? '_' + ano : '') + (mes !== '' ? '_' + String(parseInt(mes) + 1).padStart(2, '0') : '');
    pdfFinalize(doc, fileName);
    showToast('PDF gerado!', 'success');
}

function generateRelatorioGeralPDF() {
    showToast('Gerando Relatorio Geral...', 'info');
    var doc = new jspdf.jsPDF();
    var comps = MOCK_COMPUTADORES || [];
    var ramais = MOCK_RAMAIS || [];
    var trocas = MOCK_TROCAS || [];
    var manut = MOCK_MANUTENCOES || [];
    var os = MOCK_ORDENS || [];
    pdfCreateHeader(doc, 'Relatorio Geral do Inventario de TI');
    var y = 28;
    y = pdfSectionTitle(doc, 'Resumo Geral', y);
    y = pdfKpiRow(doc, [
        { l: 'Computadores', v: comps.length },
        { l: 'Ramais', v: ramais.length },
        { l: 'Manutencoes', v: manut.length },
        { l: 'Ordens Servico', v: os.length },
        { l: 'Trocas', v: trocas.length }
    ], y);
    y = pdfSectionTitle(doc, 'Computadores (' + comps.length + ')', y);
    y = pdfTable(doc, ['Nome', 'Modelo', 'Usuario', 'Status'], comps.map(function(x) {
        return [x.nomePc || '-', (x.modeloMarca || '-').substring(0, 28), x.usuarioDesignado || '-', (x.status || '-').replace('MANUTENCAO_', 'MAN.')];
    }), y);
    y += 4;
    if (y > 250) { doc.addPage(); y = 20; }
    y = pdfSectionTitle(doc, 'Ramais (' + ramais.length + ')', y);
    y = pdfTable(doc, ['Numero', 'Setor', 'Descricao', 'Status'], ramais.map(function(x) {
        return [x.numeroRamal || '-', x.setor || '-', (x.descricao || '-').substring(0, 30), x.status || '-'];
    }), y);
    y += 4;
    if (y > 250) { doc.addPage(); y = 20; }
    y = pdfSectionTitle(doc, 'Manutencoes (' + manut.length + ')', y);
    y = pdfTable(doc, ['PC', 'Tipo', 'Status', 'Tecnico', 'Descricao'], manut.map(function(x) {
        return [x.computadorNome || '-', x.tipo || '-', (x.status || '_').replace('EM_ANDAMENTO', 'ANDAMENTO'), x.tecnicoResponsavel || '-', (x.descricao || '-').substring(0, 28)];
    }), y);
    y += 4;
    if (y > 250) { doc.addPage(); y = 20; }
    y = pdfSectionTitle(doc, 'Ordens de Servico (' + os.length + ')', y);
    y = pdfTable(doc, ['Titulo', 'Prioridade', 'Status', 'Solicitante'], os.map(function(x) {
        return [(x.titulo || '-').substring(0, 30), x.prioridade || '-', (x.status || '-').replace(/_/g, ' '), x.solicitante || '-'];
    }), y);
    y += 4;
    if (y > 250) { doc.addPage(); y = 20; }
    y = pdfSectionTitle(doc, 'Trocas (' + trocas.length + ')', y);
    y = pdfTable(doc, ['Data', 'Tipo', 'Movto', 'Equipamento', 'Responsavel'], trocas.map(function(x) {
        return [x.dataTroca ? new Date(x.dataTroca).toLocaleDateString('pt-BR') : '-', x.tipoEquipamento || '-', x.tipoMovimento || '-', x.equipamentoNome || '-', x.responsavel || '-'];
    }), y);
    pdfFinalize(doc, 'Relatorio_Geral_Inventario_TI');
    showToast('Relatorio Geral PDF gerado!', 'success');
}

// ESCAPE KEY
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        var tag = (e.target || {}).tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (document.getElementById('lightbox-overlay')?.classList.contains('active')) { closeLightbox(); return; }
        var mo = document.getElementById('modal-overlay');
        var co = document.getElementById('confirm-overlay');
        if (co && co.classList.contains('active')) { closeConfirm(); return; }
        if (mo && mo.classList.contains('active')) { closeModal(); return; }
        if (_activeOsKpiKey) { closeOsKpiDetail(); return; }
        if (_activeManKpiKey) { closeManKpiDetail(); return; }
        if (_activeStatKey) { closeStatDetail(); return; }
        if (_activeKpiKey) { closeKpiDetail(); return; }
        if (typeof _activeMonKpiKey !== 'undefined' && _activeMonKpiKey) { monCloseKpiDetail(); return; }
    }
});

// INIT
function updateSidebarBadges() {
    apiFetch('/api/computadores/estatisticas').then(function(data) {
        var navTotal = document.getElementById('nav-total');
        if (navTotal) navTotal.textContent = (data && data.total) ? data.total : 0;
    }).catch(function() {});
    apiFetch('/api/ramais').then(function(data) {
        var navRamais = document.getElementById('nav-ramais-total');
        if (navRamais) navRamais.textContent = Array.isArray(data) ? data.length : 0;
    }).catch(function() {});
}

document.addEventListener('DOMContentLoaded', async function() { checkAuth(); initFilters(); try { await _dataReady; } catch(e) {} initLogDateFilters(); try { if (!localStorage.getItem('notifSeen')) localStorage.setItem('notifSeen', String(Date.now())); } catch(e) {} updateSidebarBadges(); applyAppBg(); updateNotifBadge(); document.addEventListener('click', hideHdrDropdowns); var lo = document.getElementById('lightbox-overlay'); if (lo) lo.addEventListener('click', function(e) { if (e.target === e.currentTarget || e.target.classList.contains('lightbox-close')) closeLightbox(); }); var saved = 'painel'; try { saved = localStorage.getItem('currentSection') || 'painel'; } catch (e) {} showSection(saved); });
