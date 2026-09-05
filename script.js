'use strict';

/*
    CONFIGURAÇÃO SUPABASE

    Use somente a chave anon/public.
    Nunca coloque a chave service_role neste arquivo.
*/

const SUPABASE_URL = 'https://SEU-PROJETO.supabase.co';

const SUPABASE_ANON_KEY =
    'COLE_AQUI_SUA_CHAVE_ANON';

const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
        }
    }
);

let motoristas = [];
let escalas = {};
let indisponibilidades = {};
let historicoExecucoes = [];
let usuarioLogado = null;

let chartEvolucaoInstancia = null;
let chartVeiculosInstancia = null;

const MENSAGEM_CANCELAMENTO_AMAZON =
    'Olá! Sua rota de hoje foi cancelada pela Amazon. Em caso de falta de outro motorista ou necessidade de rota extra, entraremos em contato para acioná-lo(a). Obrigado pela compreensão!';

/* =========================================================
   UTILITÁRIOS
========================================================= */

function obterDataLocalISO(data = new Date()) {
    const ano = data.getFullYear();
    const mes = String(data.getMonth() + 1).padStart(2, '0');
    const dia = String(data.getDate()).padStart(2, '0');

    return `${ano}-${mes}-${dia}`;
}

function converterDataLocal(dataISO) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataISO || '')) {
        return null;
    }

    const [ano, mes, dia] = dataISO.split('-').map(Number);

    return new Date(ano, mes - 1, dia);
}

function escaparHTML(valor) {
    return String(valor ?? '')
        .replace(/&/g, '&')
        .replace(/</g, '<')
        .replace(/>/g, '>')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function normalizarTelefoneWhatsApp(telefone) {
    let numero = String(telefone || '').replace(/\D/g, '');

    if (numero.length === 10 || numero.length === 11) {
        numero = `55${numero}`;
    }

    return numero;
}

function rotaCancelada(item) {
    return item?.status === 'cancelado' ||
        item?.status === 'cancelado_amazon';
}

function usuarioEhAdmin() {
    return usuarioLogado?.role === 'admin';
}

function exigirAdmin() {
    if (!usuarioEhAdmin()) {
        mostrarToast('Acesso restrito ao administrador.', 'error');
        return false;
    }

    return true;
}

function mostrarToast(mensagem, tipo = '') {
    const container = document.getElementById('toastContainer');

    if (!container) {
        alert(mensagem);
        return;
    }

    const toast = document.createElement('div');
    toast.className = `toast ${tipo}`;
    toast.textContent = mensagem;

    container.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 4500);
}

function definirCarregando(valor) {
    const loader = document.getElementById('appLoader');

    if (loader) {
        loader.hidden = !valor;
    }
}

function obterMensagemErro(error) {
    return error?.message || 'Ocorreu um erro inesperado.';
}

/* =========================================================
   INICIALIZAÇÃO
========================================================= */

window.addEventListener('DOMContentLoaded', async () => {
    try {
        const autenticado = await verificarSessaoLogin();

        if (!autenticado) {
            definirCarregando(false);
            return;
        }

        aplicarPermissoesDeAcesso();

        const hoje = obterDataLocalISO();

        const campoData = document.getElementById('dataEscala');

        if (campoData && !campoData.value) {
            campoData.value = hoje;
        }

        const agora = new Date();
        const primeiroDia = obterDataLocalISO(
            new Date(agora.getFullYear(), agora.getMonth(), 1)
        );

        const inicio = document.getElementById('relatorioDataInicio');
        const fim = document.getElementById('relatorioDataFim');

        if (inicio) inicio.value = primeiroDia;
        if (fim) fim.value = hoje;

        await carregarMotoristasSupabase();
        await carregarEscalasSupabase();
        await carregarIndisponibilidadesSupabase();

        configurarEventos();
        renderizarMotoristas();
        renderizarDualListboxPrioridade();
        renderizarIndisponibilidades();
        carregarEscalaData();
        atualizarInfoBackup();

        definirCarregando(false);
    } catch (error) {
        console.error(error);
        definirCarregando(false);
        mostrarToast(
            `Falha ao inicializar: ${obterMensagemErro(error)}`,
            'error'
        );
    }
});

function configurarEventos() {
    const dataEscala = document.getElementById('dataEscala');

    if (dataEscala) {
        dataEscala.addEventListener('change', async () => {
            await carregarIndisponibilidadesSupabase();
            renderizarIndisponibilidades();
            carregarEscalaData();
        });
    }

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            fecharModalEdicao();
            fecharModalAdmin();
        }
    });
}

/* =========================================================
   AUTENTICAÇÃO SUPABASE
========================================================= */

async function verificarSessaoLogin() {
    if (
        !SUPABASE_URL ||
        SUPABASE_URL.includes('SEU-PROJETO') ||
        !SUPABASE_ANON_KEY ||
        SUPABASE_ANON_KEY.includes('COLE_AQUI')
    ) {
        criarOuExibirTelaLogin(
            'Configure as credenciais do Supabase no script.js.'
        );

        return false;
    }

    const {
        data: { session },
        error
    } = await supabaseClient.auth.getSession();

    if (error || !session) {
        criarOuExibirTelaLogin();
        return false;
    }

    const { data: perfil, error: erroPerfil } =
        await supabaseClient
            .from('profiles')
            .select('id, nome, role, ativo')
            .eq('id', session.user.id)
            .single();

    if (erroPerfil || !perfil || !perfil.ativo) {
        await supabaseClient.auth.signOut();
        criarOuExibirTelaLogin(
            'Seu usuário não possui um perfil ativo.'
        );

        return false;
    }

    usuarioLogado = {
        ...session.user,
        nome: perfil.nome,
        role: perfil.role,
        ativo: perfil.ativo
    };

    removerTelaLoginSeExistir();

    const usuarioAtual = document.getElementById('usuarioAtual');

    if (usuarioAtual) {
        usuarioAtual.textContent =
            `${perfil.nome} · ${perfil.role}`;
    }

    return true;
}

function criarOuExibirTelaLogin(mensagem = '') {
    let overlay = document.getElementById('modalLoginOverlay');

    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'modalLoginOverlay';
        overlay.className = 'modal-overlay';

        overlay.innerHTML = `
            <div class="modal-content login-card">
                <div class="brand login-brand">
                    <span class="brand-icon">🚛</span>
                    <h1>BETAXLOG</h1>
                </div>

                <p class="helper-text">
                    Acesso seguro pelo Supabase Authentication.
                </p>

                <div
                    id="loginMensagem"
                    class="notice notice-warning"
                    hidden>
                </div>

                <label for="loginEmail">E-mail</label>
                <input
                    id="loginEmail"
                    type="email"
                    autocomplete="email"
                    placeholder="seu@email.com">

                <label for="loginSenha">Senha</label>
                <input
                    id="loginSenha"
                    type="password"
                    autocomplete="current-password"
                    placeholder="Sua senha">

                <button
                    id="btnLogin"
                    class="btn btn-primary btn-block"
                    type="button">
                    Entrar
                </button>
            </div>
        `;

        document.body.appendChild(overlay);

        document
            .getElementById('btnLogin')
            .addEventListener('click', executarLogin);

        document
            .getElementById('loginSenha')
            .addEventListener('keydown', event => {
                if (event.key === 'Enter') {
                    executarLogin();
                }
            });
    }

    const aviso = document.getElementById('loginMensagem');

    if (aviso) {
        aviso.textContent = mensagem;
        aviso.hidden = !mensagem;
    }

    overlay.hidden = false;
}

function removerTelaLoginSeExistir() {
    const overlay = document.getElementById('modalLoginOverlay');

    if (overlay) {
        overlay.remove();
    }
}

async function executarLogin() {
    const email = document
        .getElementById('loginEmail')
        ?.value
        .trim();

    const senha = document
        .getElementById('loginSenha')
        ?.value || '';

    const botao = document.getElementById('btnLogin');

    if (!email || !senha) {
        mostrarToast('Informe e-mail e senha.', 'error');
        return;
    }

    if (botao) {
        botao.disabled = true;
        botao.textContent = 'Entrando...';
    }

    const { error } = await supabaseClient.auth.signInWithPassword({
        email,
        password: senha
    });

    if (error) {
        if (botao) {
            botao.disabled = false;
            botao.textContent = 'Entrar';
        }

        mostrarToast('E-mail ou senha inválidos.', 'error');
        return;
    }

    window.location.reload();
}

async function fazerLogout() {
    if (!confirm('Deseja realmente sair do sistema?')) {
        return;
    }

    const { error } = await supabaseClient.auth.signOut();

    if (error) {
        mostrarToast('Não foi possível sair.', 'error');
        return;
    }

    window.location.reload();
}

function aplicarPermissoesDeAcesso() {
    const btnAdmin = document.getElementById('btnPainelAdmin');

    if (btnAdmin) {
        btnAdmin.hidden = !usuarioEhAdmin();
    }
}

/* =========================================================
   SUPABASE - LEITURA
========================================================= */

async function carregarMotoristasSupabase() {
    const { data, error } = await supabaseClient
        .from('motoristas')
        .select('*')
        .eq('ativo', true)
        .order('nome', { ascending: true });

    if (error) throw error;

    motoristas = (data || []).map(item => ({
        id: item.id,
        nome: item.nome,
        telefone: item.telefone || '',
        veiculo: item.veiculo,
        prioridade: Boolean(item.prioridade),
        ultimaEscaladoEm: item.ultima_escalado_em
    }));
}

async function carregarEscalasSupabase() {
    const { data, error } = await supabaseClient
        .from('escalas')
        .select(`
            *,
            escala_itens (*)
        `)
        .order('data', { ascending: false });

    if (error) throw error;

    escalas = {};
    historicoExecucoes = [];

    (data || []).forEach(escala => {
        const itens = (escala.escala_itens || [])
            .sort((a, b) => a.ordem - b.ordem)
            .map(item => ({
                id: item.id,
                dsp: item.dsp,
                nome: item.nome_snapshot,
                telefone: item.telefone_snapshot || '',
                motoristaId: item.motorista_id,
                veiculo: item.veiculo,
                onda: item.onda || '',
                status: item.status
            }));

        escalas[escala.data] = {
            id: escala.id,
            status: escala.status,
            vagas: {
                utilitario: escala.vagas_utilitario,
                van: escala.vagas_van,
                passeio: escala.vagas_passeio
            },
            itens
        };

        if (escala.status === 'definitiva') {
            historicoExecucoes.push({
                data: escala.data,
                status: escala.status,
                itens: structuredCloneSeguro(itens)
            });
        }
    });
}

async function carregarIndisponibilidadesSupabase() {
    const { data, error } = await supabaseClient
        .from('indisponibilidades')
        .select('data, motorista_id');

    if (error) throw error;

    indisponibilidades = {};

    (data || []).forEach(item => {
        if (!indisponibilidades[item.data]) {
            indisponibilidades[item.data] = [];
        }

        indisponibilidades[item.data].push(item.motorista_id);
    });
}

function structuredCloneSeguro(valor) {
    return JSON.parse(JSON.stringify(valor));
}

/* =========================================================
   NAVEGAÇÃO
========================================================= */

function alternarAba(aba) {
    const abas = {
        operacional: [
            'btnAbaOperacional',
            'viewOperacional'
        ],
        motoristas: [
            'btnAbaMotoristas',
            'viewMotoristas'
        ],
        relatorios: [
            'btnAbaRelatorios',
            'viewRelatorios'
        ]
    };

    Object.values(abas).forEach(([botao, view]) => {
        document.getElementById(botao)?.classList.remove('active');
        document.getElementById(view)?.setAttribute('hidden', '');
    });

    const selecionada = abas[aba];

    if (!selecionada) return;

    document
        .getElementById(selecionada[0])
        ?.classList.add('active');

    document
        .getElementById(selecionada[1])
        ?.removeAttribute('hidden');

    if (aba === 'motoristas') {
        renderizarMotoristas();
        renderizarDualListboxPrioridade();
    }

    if (aba === 'relatorios') {
        gerarRelatorioHistorico();
    }
}

/* =========================================================
   MOTORISTAS
========================================================= */

async function cadastrarMotorista() {
    const nome = document
        .getElementById('nomeMotorista')
        .value
        .trim();

    const telefone = document
        .getElementById('telMotorista')
        .value
        .trim();

    const veiculo = document
        .getElementById('tipoVeiculo')
        .value;

    if (!nome) {
        mostrarToast('Informe o nome do motorista.', 'error');
        return;
    }

    const { error } = await supabaseClient
        .from('motoristas')
        .insert({
            nome,
            telefone,
            veiculo,
            prioridade: false
        });

    if (error) {
        if (error.code === '23505') {
            mostrarToast('Já existe um motorista com este nome.', 'error');
        } else {
            console.error(error);
            mostrarToast('Não foi possível cadastrar.', 'error');
        }

        return;
    }

    await carregarMotoristasSupabase();

    renderizarMotoristas();
    renderizarDualListboxPrioridade();

    document.getElementById('nomeMotorista').value = '';
    document.getElementById('telMotorista').value = '';

    mostrarToast('Motorista cadastrado.', 'success');
}

function renderizarMotoristas() {
    const container = document.getElementById('listaMotoristasCheck');
    const filtro = document
        .getElementById('filtroMotorista')
        ?.value
        .toLowerCase()
        .trim() || '';

    const contador = document.getElementById('contadorTotalMotoristas');

    if (contador) {
        contador.textContent = `Total: ${motoristas.length}`;
    }

    if (!container) return;

    container.replaceChildren();

    const lista = motoristas.filter(item =>
        item.nome.toLowerCase().includes(filtro)
    );

    if (!lista.length) {
        container.innerHTML =
            '<p class="empty-state">Nenhum motorista encontrado.</p>';

        return;
    }

    lista.forEach(motorista => {
        const item = document.createElement('div');
        item.className = 'motorista-item';

        const info = document.createElement('div');
        info.className = 'motorista-info';

        const nome = document.createElement('strong');
        nome.className = 'motorista-nome';
        nome.textContent =
            `${motorista.prioridade ? '⭐ ' : ''}${motorista.nome}`;

        const veiculo = document.createElement('small');
        veiculo.textContent = ` (${motorista.veiculo})`;

        nome.appendChild(veiculo);
        info.appendChild(nome);

        const actions = document.createElement('div');
        actions.className = 'motorista-actions';

        const editar = document.createElement('button');
        editar.className = 'btn btn-secondary';
        editar.textContent = '✏️';
        editar.title = 'Editar motorista';
        editar.onclick = () => abrirModalEdicao(motorista.id);

        const excluir = document.createElement('button');
        excluir.className = 'btn btn-danger';
        excluir.textContent = '🗑️';
        excluir.title = 'Excluir motorista';
        excluir.onclick = () => excluirMotorista(motorista.id);

        actions.append(editar, excluir);
        item.append(info, actions);
        container.appendChild(item);
    });
}

async function excluirMotorista(id) {
    const motorista = motoristas.find(item => item.id === id);

    if (!motorista) return;

    if (!confirm(`Arquivar "${motorista.nome}"?`)) {
        return;
    }

    const { error } = await supabaseClient
        .from('motoristas')
        .update({ ativo: false })
        .eq('id', id);

    if (error) {
        mostrarToast('Não foi possível arquivar o motorista.', 'error');
        return;
    }

    await carregarMotoristasSupabase();

    renderizarMotoristas();
    renderizarDualListboxPrioridade();

    mostrarToast('Motorista arquivado.', 'success');
}

function abrirModalEdicao(id) {
    const motorista = motoristas.find(item => item.id === id);

    if (!motorista) return;

    document.getElementById('editMotoristaId').value = motorista.id;
    document.getElementById('editNomeMotorista').value = motorista.nome;
    document.getElementById('editTelMotorista').value =
        motorista.telefone || '';
    document.getElementById('editTipoVeiculo').value =
        motorista.veiculo;

    document.getElementById('modalEdicao').hidden = false;
}

function fecharModalEdicao() {
    document.getElementById('modalEdicao').hidden = true;
}

async function salvarEdicaoMotorista() {
    const id = document.getElementById('editMotoristaId').value;
    const nome = document.getElementById('editNomeMotorista').value.trim();
    const telefone = document.getElementById('editTelMotorista').value.trim();
    const veiculo = document.getElementById('editTipoVeiculo').value;

    if (!nome) {
        mostrarToast('Informe o nome.', 'error');
        return;
    }

    const duplicado = motoristas.some(item =>
        item.id !== id &&
        item.nome.toLowerCase() === nome.toLowerCase()
    );

    if (duplicado) {
        mostrarToast('Já existe outro motorista com esse nome.', 'error');
        return;
    }

    const { error } = await supabaseClient
        .from('motoristas')
        .update({
            nome,
            telefone,
            veiculo,
            updated_at: new Date().toISOString()
        })
        .eq('id', id);

    if (error) {
        mostrarToast('Não foi possível salvar a alteração.', 'error');
        return;
    }

    await carregarMotoristasSupabase();

    renderizarMotoristas();
    renderizarDualListboxPrioridade();
    fecharModalEdicao();

    mostrarToast('Motorista atualizado.', 'success');
}

/* =========================================================
   IMPORTAÇÃO E EXPORTAÇÃO DE MOTORISTAS
========================================================= */

function exportarBackupMotoristas() {
    if (!motoristas.length) {
        mostrarToast('Não há motoristas para exportar.', 'error');
        return;
    }

    const dados = motoristas.map(item => ({
        Nome: item.nome,
        Telefone: item.telefone || '',
        Veiculo: item.veiculo,
        Prioridade: item.prioridade ? 'SIM' : 'NAO'
    }));

    const worksheet = XLSX.utils.json_to_sheet(dados);
    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
        workbook,
        worksheet,
        'Motoristas'
    );

    XLSX.writeFile(
        workbook,
        `motoristas_betaxlog_${obterDataLocalISO()}.xlsx`
    );
}

async function importarExcel(event) {
    const arquivo = event.target.files?.[0];

    if (!arquivo) return;

    try {
        const buffer = await arquivo.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        const primeiraAba = workbook.Sheets[workbook.SheetNames[0]];
        const linhas = XLSX.utils.sheet_to_json(primeiraAba);

        let importados = 0;

        for (const linha of linhas) {
            const nome = String(
                linha.Nome || linha.nome || ''
            ).trim();

            if (!nome) continue;

            const telefone = String(
                linha.Telefone || linha.telefone || ''
            ).trim();

            const veiculo = String(
                linha.Veiculo || linha.veiculo || 'Utilitário'
            ).trim();

            const prioridade = String(
                linha.Prioridade ||
                linha.Prioridade_ForaDoRodizio ||
                ''
            ).toUpperCase() === 'SIM';

            const { error } = await supabaseClient
                .from('motoristas')
                .insert({
                    nome,
                    telefone,
                    veiculo,
                    prioridade
                });

            if (!error) {
                importados++;
            }
        }

        await carregarMotoristasSupabase();

        renderizarMotoristas();
        renderizarDualListboxPrioridade();

        mostrarToast(`${importados} motorista(s) importado(s).`, 'success');
    } catch (error) {
        console.error(error);
        mostrarToast('Erro ao processar o Excel.', 'error');
    } finally {
        event.target.value = '';
    }
}

/* =========================================================
   PRIORIDADE E RODÍZIO
========================================================= */

function renderizarDualListboxPrioridade() {
    const rodizio = document.getElementById('listaRodizio');
    const prioritarios = document.getElementById('listaPrioritarios');

    if (!rodizio || !prioritarios) return;

    rodizio.replaceChildren();
    prioritarios.replaceChildren();

    [...motoristas]
        .sort((a, b) => a.nome.localeCompare(b.nome))
        .forEach(motorista => {
            const option = document.createElement('option');

            option.value = motorista.id;
            option.textContent =
                `${motorista.nome} (${motorista.veiculo})`;

            if (motorista.prioridade) {
                prioritarios.appendChild(option);
            } else {
                rodizio.appendChild(option);
            }
        });
}

function selecionarTodos(id) {
    const select = document.getElementById(id);

    if (!select) return;

    Array.from(select.options).forEach(option => {
        option.selected = true;
    });
}

function moverParaPrioridade() {
    moverSelecionados(true);
}

function moverParaRodizio() {
    moverSelecionados(false);
}

async function moverSelecionados(novaPrioridade) {
    const ids = [
        ...Array.from(
            document.getElementById('listaRodizio').selectedOptions
        ),
        ...Array.from(
            document.getElementById('listaPrioritarios').selectedOptions
        )
    ].map(option => option.value);

    if (!ids.length) {
        mostrarToast('Selecione ao menos um motorista.', 'error');
        return;
    }

    const { error } = await supabaseClient
        .from('motoristas')
        .update({ prioridade: novaPrioridade })
        .in('id', ids);

    if (error) {
        mostrarToast('Não foi possível atualizar a prioridade.', 'error');
        return;
    }

    await carregarMotoristasSupabase();

    renderizarMotoristas();
    renderizarDualListboxPrioridade();
}

function obterSelecionadoUnicoDualListbox() {
    const selecionados = [
        ...Array.from(
            document.getElementById('listaRodizio').selectedOptions
        ),
        ...Array.from(
            document.getElementById('listaPrioritarios').selectedOptions
        )
    ];

    if (selecionados.length !== 1) {
        mostrarToast(
            selecionados.length
                ? 'Selecione somente um motorista.'
                : 'Selecione um motorista.',
            'error'
        );

        return null;
    }

    return selecionados[0].value;
}

function editarSelecionadoDualListbox() {
    const id = obterSelecionadoUnicoDualListbox();

    if (id) {
        abrirModalEdicao(id);
    }
}

async function excluirSelecionadoDualListbox() {
    const id = obterSelecionadoUnicoDualListbox();

    if (id) {
        await excluirMotorista(id);
    }
}

/* =========================================================
   INDISPONIBILIDADES
========================================================= */

function renderizarIndisponibilidades() {
    const container = document.getElementById(
        'listaMotoristasIndisponiveis'
    );

    const data = document.getElementById('dataEscala')?.value;

    if (!container || !data) return;

    const indisponiveis = indisponibilidades[data] || [];

    container.replaceChildren();

    if (!motoristas.length) {
        container.innerHTML =
            '<p class="empty-state">Cadastre motoristas primeiro.</p>';

        return;
    }

    motoristas.forEach(motorista => {
        const wrapper = document.createElement('div');
        wrapper.className = 'check-item';

        const label = document.createElement('label');
        const checkbox = document.createElement('input');

        checkbox.type = 'checkbox';
        checkbox.checked = indisponiveis.includes(motorista.id);
        checkbox.addEventListener('change', event => {
            toggleIndisponibilidade(
                motorista.id,
                event.target.checked
            );
        });

        label.append(
            checkbox,
            document.createTextNode(
                `${motorista.nome} (${motorista.veiculo})`
            )
        );

        wrapper.appendChild(label);
        container.appendChild(wrapper);
    });
}

async function toggleIndisponibilidade(id, status) {
    const data = document.getElementById('dataEscala')?.value;

    if (!data) return;

    if (status) {
        const { error } = await supabaseClient
            .from('indisponibilidades')
            .upsert(
                {
                    data,
                    motorista_id: id
                },
                {
                    onConflict: 'data,motorista_id'
                }
            );

        if (error) {
            mostrarToast(
                'Não foi possível registrar a indisponibilidade.',
                'error'
            );
        }
    } else {
        const { error } = await supabaseClient
            .from('indisponibilidades')
            .delete()
            .eq('data', data)
            .eq('motorista_id', id);

        if (error) {
            mostrarToast(
                'Não foi possível remover a indisponibilidade.',
                'error'
            );
        }
    }

    await carregarIndisponibilidadesSupabase();
}

/* =========================================================
   ESCALAS
========================================================= */

function carregarEscalaData() {
    const data = document.getElementById('dataEscala')?.value;
    const painel = document.getElementById('painelEscala');

    if (!data || !painel) return;

    const escala = escalas[data];

    if (!escala) {
        painel.hidden = true;
        return;
    }

    document.getElementById('vagasUtilitario').value =
        escala.vagas.utilitario;

    document.getElementById('vagasVan').value =
        escala.vagas.van;

    document.getElementById('vagasPasseio').value =
        escala.vagas.passeio;

    renderizarTabelaEscala(escala.itens, escala.status);
    painel.hidden = false;
}

function ordenarPorRodizioJusto(lista) {
    return [...lista].sort((a, b) => {
        const dataA = a.ultimaEscaladoEm || '0000-00-00';
        const dataB = b.ultimaEscaladoEm || '0000-00-00';

        return dataA.localeCompare(dataB);
    });
}

async function gerarPrevia() {
    const data = document.getElementById('dataEscala').value;

    const vagas = {
        utilitario: Number(
            document.getElementById('vagasUtilitario').value
        ),
        van: Number(
            document.getElementById('vagasVan').value
        ),
        passeio: Number(
            document.getElementById('vagasPasseio').value
        )
    };

    if (!data) {
        mostrarToast('Selecione a data.', 'error');
        return;
    }

    if (
        Object.values(vagas).some(
            valor => !Number.isInteger(valor) || valor < 0
        )
    ) {
        mostrarToast('Informe vagas inteiras e não negativas.', 'error');
        return;
    }

    if (Object.values(vagas).every(valor => valor === 0)) {
        mostrarToast('Informe ao menos uma vaga.', 'error');
        return;
    }

    const indisponiveis = indisponibilidades[data] || [];

    const disponiveis = motoristas.filter(item =>
        !indisponiveis.includes(item.id) &&
        !item.prioridade
    );

    const pools = {
        utilitario: ordenarPorRodizioJusto(
            disponiveis.filter(item => item.veiculo === 'Utilitário')
        ),
        van: ordenarPorRodizioJusto(
            disponiveis.filter(item => item.veiculo === 'Van')
        ),
        passeio: ordenarPorRodizioJusto(
            disponiveis.filter(
                item => item.veiculo === 'Carro de Passeio'
            )
        )
    };

    const itens = [];
    const idsEscalados = [];

    function preencher(pool, quantidade, veiculo) {
        for (let index = 0; index < quantidade; index++) {
            const motorista = pool[index];

            if (motorista) {
                itens.push({
                    dsp: 'BETAXLOG',
                    nome: motorista.nome,
                    telefone: motorista.telefone || '',
                    motoristaId: motorista.id,
                    veiculo,
                    onda: '',
                    status: 'ativo'
                });

                idsEscalados.push(motorista.id);
            } else {
                itens.push({
                    dsp: 'BETAXLOG',
                    nome: 'VAGA SEM MOTORISTA',
                    telefone: '',
                    motoristaId: null,
                    veiculo,
                    onda: '',
                    status: 'vago'
                });
            }
        }
    }

    preencher(pools.utilitario, vagas.utilitario, 'Utilitário');
    preencher(pools.van, vagas.van, 'Van');
    preencher(pools.passeio, vagas.passeio, 'Carro de Passeio');

    const payloadEscala = {
        data,
        status: 'prévia',
        vagas_utilitario: vagas.utilitario,
        vagas_van: vagas.van,
        vagas_passeio: vagas.passeio,
        criado_por: usuarioLogado.id
    };

    const { data: escalaSalva, error } = await supabaseClient
        .from('escalas')
        .upsert(payloadEscala, { onConflict: 'data' })
        .select()
        .single();

    if (error) {
        mostrarToast('Não foi possível salvar a escala.', 'error');
        console.error(error);
        return;
    }

    await supabaseClient
        .from('escala_itens')
        .delete()
        .eq('escala_id', escalaSalva.id);

    const itensBanco = itens.map((item, index) => ({
        escala_id: escalaSalva.id,
        motorista_id: item.motoristaId,
        dsp: item.dsp,
        nome_snapshot: item.nome,
        telefone_snapshot: item.telefone,
        veiculo: item.veiculo,
        onda: item.onda,
        status: item.status,
        ordem: index
    }));

    const { error: erroItens } = await supabaseClient
        .from('escala_itens')
        .insert(itensBanco);

    if (erroItens) {
        mostrarToast('Erro ao salvar os itens da escala.', 'error');
        return;
    }

    for (const id of idsEscalados) {
        await supabaseClient
            .from('motoristas')
            .update({ ultima_escalado_em: data })
            .eq('id', id);
    }

    await carregarMotoristasSupabase();
    await carregarEscalasSupabase();

    renderizarTabelaEscala(
        escalas[data].itens,
        escalas[data].status
    );

    document.getElementById('painelEscala').hidden = false;

    mostrarToast('Prévia gerada com sucesso.', 'success');
}

function renderizarTabelaEscala(itens, status) {
    const tbody = document.getElementById('tabelaEscalaBody');
    const data = document.getElementById('dataEscala').value;
    const tag = document.getElementById('tagStatus');
    const subtitulo = document.getElementById('dataSubtituloImagem');

    if (!tbody) return;

    tag.textContent =
        status === 'definitiva' ? 'DEFINITIVA' : 'PRÉVIA';

    tag.className =
        `status-badge ${
            status === 'definitiva'
                ? 'status-definitiva'
                : 'status-previa'
        }`;

    if (subtitulo) {
        const dataFormatada = converterDataLocal(data)
            ?.toLocaleDateString('pt-BR');

        subtitulo.textContent =
            `Escala operacional · ${dataFormatada || data}`;
    }

    tbody.replaceChildren();

    itens.forEach((item, index) => {
        const tr = document.createElement('tr');
        const cancelado = rotaCancelada(item);

        if (cancelado) {
            tr.className = 'row-cancelada';
        }

        const tdDsp = document.createElement('td');
        tdDsp.textContent = item.dsp;

        const tdNome = document.createElement('td');
        tdNome.textContent = item.nome;

        if (cancelado) {
            const badge = document.createElement('span');
            badge.className = 'status-badge status-cancelado';
            badge.style.marginLeft = '6px';
            badge.textContent =
                item.status === 'cancelado_amazon'
                    ? 'AMAZON'
                    : 'CANCELADO';

            tdNome.appendChild(badge);
        }

        const tdVeiculo = document.createElement('td');
        tdVeiculo.textContent = item.veiculo;

        const tdOnda = document.createElement('td');
        const input = document.createElement('input');

        input.className = 'input-onda';
        input.value = item.onda || '';
        input.placeholder = 'HH:MM';
        input.setAttribute('aria-label', 'Horário da onda');

        input.addEventListener('blur', event => {
            formatarETratarHora(event.target, index);
        });

        input.addEventListener('keydown', event => {
            tratarEnterOnda(event, index, event.target);
        });

        tdOnda.appendChild(input);

        const tdAcoes = document.createElement('td');
        tdAcoes.className = 'toolbar';

        const acao = document.createElement('button');
        acao.className = cancelado
            ? 'btn btn-success'
            : 'btn btn-danger';

        acao.textContent = cancelado ? '✅' : '❌';
        acao.title = cancelado
            ? 'Reativar rota'
            : 'Cancelar rota';

        acao.onclick = () => cancelado
            ? ativarRota(index)
            : cancelarRota(index);

        tdAcoes.appendChild(acao);

        if (status === 'prévia') {
            const excluir = document.createElement('button');
            excluir.className = 'btn btn-danger';
            excluir.textContent = '🗑️';
            excluir.title = 'Remover item da prévia';
            excluir.onclick = () => excluirItemDaPrevia(index);
            tdAcoes.appendChild(excluir);
        }

        tr.append(tdDsp, tdNome, tdVeiculo, tdOnda, tdAcoes);
        tbody.appendChild(tr);
    });
}

async function salvarItensEscala(data) {
    const escala = escalas[data];

    if (!escala) return;

    const itens = escala.itens.map((item, index) => ({
        escala_id: escala.id,
        motorista_id: item.motoristaId,
        dsp: item.dsp,
        nome_snapshot: item.nome,
        telefone_snapshot: item.telefone || '',
        veiculo: item.veiculo,
        onda: item.onda || '',
        status: item.status,
        ordem: index
    }));

    await supabaseClient
        .from('escala_itens')
        .delete()
        .eq('escala_id', escala.id);

    await supabaseClient
        .from('escala_itens')
        .insert(itens);
}

async function atualizarOnda(index, valor) {
    const data = document.getElementById('dataEscala').value;

    if (!escalas[data]?.itens[index]) return;

    escalas[data].itens[index].onda = valor;
    await salvarItensEscala(data);
}

function formatarETratarHora(input, index) {
    const valor = input.value.trim();

    if (!valor) {
        atualizarOnda(index, '');
        return;
    }

    let horas;
    let minutos = 0;

    if (valor.includes(':')) {
        const partes = valor.split(':');
        horas = Number(partes[0]);
        minutos = Number(partes[1]);
    } else if (/^\d{1,2}$/.test(valor)) {
        horas = Number(valor);
    } else if (/^\d{3,4}$/.test(valor)) {
        horas = Number(valor.slice(0, -2));
        minutos = Number(valor.slice(-2));
    }

    if (
        !Number.isInteger(horas) ||
        !Number.isInteger(minutos) ||
        horas < 0 ||
        horas > 23 ||
        minutos < 0 ||
        minutos > 59
    ) {
        input.value = '';
        mostrarToast('Informe um horário entre 00:00 e 23:59.', 'error');
        atualizarOnda(index, '');
        return;
    }

    const formatado =
        `${String(horas).padStart(2, '0')}:` +
        `${String(minutos).padStart(2, '0')}`;

    input.value = formatado;
    atualizarOnda(index, formatado);
}

function tratarEnterOnda(event, index, input) {
    if (event.key !== 'Enter') return;

    event.preventDefault();
    formatarETratarHora(input, index);

    const campos = [...document.querySelectorAll('.input-onda')];
    const proximo = campos[index + 1];

    if (proximo) {
        proximo.focus();
        proximo.select();
    }
}

async function excluirItemDaPrevia(index) {
    const data = document.getElementById('dataEscala').value;
    const escala = escalas[data];

    if (!escala || escala.status !== 'prévia') {
        mostrarToast(
            'Só é possível remover itens da prévia.',
            'error'
        );

        return;
    }

    if (!confirm('Remover este item da prévia?')) {
        return;
    }

    escala.itens.splice(index, 1);
    await salvarItensEscala(data);

    renderizarTabelaEscala(escala.itens, escala.status);
}

async function cancelarRota(index) {
    const data = document.getElementById('dataEscala').value;
    const item = escalas[data]?.itens[index];

    if (!item?.motoristaId) {
        mostrarToast('Esta vaga não possui motorista.', 'error');
        return;
    }

    if (!confirm(`Cancelar a rota de ${item.nome}?`)) {
        return;
    }

    item.status = 'cancelado_amazon';

    await salvarItensEscala(data);
    renderizarTabelaEscala(escalas[data].itens, escalas[data].status);

    const telefone = normalizarTelefoneWhatsApp(item.telefone);

    if (telefone.length >= 12) {
        const texto = encodeURIComponent(
            MENSAGEM_CANCELAMENTO_AMAZON
        );

        window.open(
            `https://wa.me/${telefone}?text=${texto}`,
            '_blank',
            'noopener,noreferrer'
        );
    } else {
        mostrarToast('Motorista sem telefone válido.', 'error');
    }
}

async function ativarRota(index) {
    const data = document.getElementById('dataEscala').value;
    const item = escalas[data]?.itens[index];

    if (!item) return;

    item.status = 'ativo';

    await salvarItensEscala(data);
    renderizarTabelaEscala(escalas[data].itens, escalas[data].status);
}

function salvarPrevia() {
    mostrarToast('A prévia já está sincronizada no Supabase.', 'success');
}

async function confirmarDefinitiva() {
    const data = document.getElementById('dataEscala').value;
    const escala = escalas[data];

    if (!escala) return;

    if (!confirm('Confirmar esta escala como definitiva?')) {
        return;
    }

    const { error } = await supabaseClient
        .from('escalas')
        .update({
            status: 'definitiva',
            updated_at: new Date().toISOString()
        })
        .eq('id', escala.id);

    if (error) {
        mostrarToast('Não foi possível confirmar a escala.', 'error');
        return;
    }

    escala.status = 'definitiva';

    await carregarEscalasSupabase();
    renderizarTabelaEscala(escala.itens, escala.status);

    mostrarToast('Escala confirmada.', 'success');
}

async function excluirEscalaAtual() {
    const data = document.getElementById('dataEscala').value;
    const escala = escalas[data];

    if (!escala) return;

    if (!confirm('Excluir a escala desta data?')) {
        return;
    }

    const { error } = await supabaseClient
        .from('escalas')
        .delete()
        .eq('id', escala.id);

    if (error) {
        mostrarToast('Não foi possível excluir a escala.', 'error');
        return;
    }

    delete escalas[data];

    document.getElementById('painelEscala').hidden = true;

    mostrarToast('Escala excluída.', 'success');
}

/* =========================================================
   WHATSAPP E EXPORTAÇÕES
========================================================= */

function compartilharWhatsAppTexto() {
    const data = document.getElementById('dataEscala').value;
    const escala = escalas[data];

    if (!escala) {
        mostrarToast('Não existe escala para esta data.', 'error');
        return;
    }

    const ativos = escala.itens.filter(item =>
        item.motoristaId && !rotaCancelada(item)
    );

    if (!ativos.length) {
        mostrarToast('Não há motoristas ativos para notificar.', 'error');
        return;
    }

    const dataFormatada = converterDataLocal(data)
        ?.toLocaleDateString('pt-BR');

    let texto =
        `🚛 ESCALA BETAXLOG\n📅 Data: ${dataFormatada}\n\n`;

    ativos.forEach(item => {
        texto +=
            `• ${item.nome} | ${item.veiculo}` +
            ` | Onda: ${item.onda || 'não definida'}\n`;
    });

    navigator.clipboard.writeText(texto)
        .then(() => {
            mostrarToast('Escala copiada. Abrindo WhatsApp...', 'success');
            window.open(
                'https://web.whatsapp.com/',
                '_blank',
                'noopener,noreferrer'
            );
        })
        .catch(() => {
            prompt('Copie o texto abaixo:', texto);
        });
}

function gerarImagemEscalaECompartilhar() {
    const area = document.getElementById('areaCapturaImagem');

    if (!area) return;

    html2canvas(area, { scale: 2 })
        .then(canvas => {
            const link = document.createElement('a');
            const data =
                document.getElementById('dataEscala').value || 'dia';

            link.download = `escala_betaxlog_${data}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();
        })
        .catch(error => {
            console.error(error);
            mostrarToast('Não foi possível gerar a imagem.', 'error');
        });
}

function exportarExcel() {
    const data = document.getElementById('dataEscala').value;
    const escala = escalas[data];

    if (!escala) return;

    const dados = escala.itens.map(item => ({
        DSP: item.dsp,
        Motorista: item.nome,
        Telefone: item.telefone || '',
        Veiculo: item.veiculo,
        Onda: item.onda || '',
        Status: item.status
    }));

    const worksheet = XLSX.utils.json_to_sheet(dados);
    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
        workbook,
        worksheet,
        'Escala'
    );

    XLSX.writeFile(workbook, `escala_${data}.xlsx`);
}

/* =========================================================
   RELATÓRIOS
========================================================= */

function aplicarAtalhoPeriodo() {
    const atalho =
        document.getElementById('filtroAtalhoPeriodo').value;

    const hoje = new Date();
    let inicio = new Date();

    if (atalho === 'mes_atual') {
        inicio = new Date(
            hoje.getFullYear(),
            hoje.getMonth(),
            1
        );
    } else if (atalho === 'semanal') {
        inicio.setDate(hoje.getDate() - 7);
    } else if (atalho === 'semestral') {
        inicio.setMonth(hoje.getMonth() - 6);
    } else if (atalho === 'anual') {
        inicio = new Date(hoje.getFullYear(), 0, 1);
    } else {
        return;
    }

    document.getElementById('relatorioDataInicio').value =
        obterDataLocalISO(inicio);

    document.getElementById('relatorioDataFim').value =
        obterDataLocalISO(hoje);
}

function gerarRelatorioHistorico() {
    const inicioTexto =
        document.getElementById('relatorioDataInicio').value;

    const fimTexto =
        document.getElementById('relatorioDataFim').value;

    const inicio = converterDataLocal(inicioTexto);
    const fim = converterDataLocal(fimTexto);

    if (!inicio || !fim) return;

    fim.setHours(23, 59, 59, 999);

    const historico = historicoExecucoes.filter(item => {
        const data = converterDataLocal(item.data);
        return data && data >= inicio && data <= fim;
    });

    let total = 0;
    let ativas = 0;
    let canceladas = 0;
    const ranking = {};

    historico.forEach(execucao => {
        execucao.itens.forEach(item => {
            if (!item.motoristaId) return;

            total++;

            if (rotaCancelada(item)) {
                canceladas++;
            } else {
                ativas++;
            }

            if (!ranking[item.motoristaId]) {
                ranking[item.motoristaId] = {
                    nome: item.nome,
                    veiculo: item.veiculo,
                    escaladas: 0,
                    canceladas: 0
                };
            }

            ranking[item.motoristaId].escaladas++;

            if (rotaCancelada(item)) {
                ranking[item.motoristaId].canceladas++;
            }
        });
    });

    document.getElementById('kpiTotalRotas').textContent = total;
    document.getElementById('kpiRotasAtivas').textContent = ativas;
    document.getElementById('kpiRotasCanceladas').textContent =
        canceladas;

    document.getElementById('kpiTaxaSucesso').textContent =
        `${total ? ((ativas / total) * 100).toFixed(1) : 0}%`;

    const tbody = document.getElementById('tabelaRankingBody');
    tbody.replaceChildren();

    const lista = Object.values(ranking)
        .sort((a, b) => b.escaladas - a.escaladas);

    if (!lista.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="empty-state">
                    Nenhum dado encontrado.
                </td>
            </tr>
        `;
    } else {
        lista.forEach(item => {
            const presenca = item.escaladas
                ? (
                    (item.escaladas - item.canceladas) /
                    item.escaladas *
                    100
                ).toFixed(1)
                : '0.0';

            const tr = document.createElement('tr');

            [
                item.nome,
                item.veiculo,
                item.escaladas,
                item.canceladas,
                `${presenca}%`
            ].forEach((valor, index) => {
                const td = document.createElement('td');
                td.textContent = valor;

                if (index === 3 && item.canceladas > 0) {
                    td.style.color = 'var(--danger)';
                }

                tr.appendChild(td);
            });

            tbody.appendChild(tr);
        });
    }

    atualizarGraficos(historico);
}

function atualizarGraficos(historico) {
    const datas = {};

    historico.forEach(execucao => {
        datas[execucao.data] =
            execucao.itens.filter(item =>
                item.motoristaId &&
                !rotaCancelada(item)
            ).length;
    });

    const labels = Object.keys(datas).sort();

    const canvasEvolucao =
        document.getElementById('chartEvolucao');

    if (canvasEvolucao && window.Chart) {
        chartEvolucaoInstancia?.destroy();

        chartEvolucaoInstancia = new Chart(canvasEvolucao, {
            type: 'line',
            data: {
                labels: labels.map(data =>
                    converterDataLocal(data)
                        ?.toLocaleDateString('pt-BR')
                ),
                datasets: [{
                    label: 'Rotas ativas',
                    data: labels.map(data => datas[data]),
                    borderColor: '#1e3a8a',
                    backgroundColor: 'rgba(30,58,138,.12)',
                    fill: true,
                    tension: .3
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false
            }
        });
    }

    const porVeiculo = {
        'Utilitário': 0,
        'Van': 0,
        'Carro de Passeio': 0
    };

    historico.forEach(execucao => {
        execucao.itens.forEach(item => {
            if (
                item.motoristaId &&
                !rotaCancelada(item) &&
                porVeiculo[item.veiculo] !== undefined
            ) {
                porVeiculo[item.veiculo]++;
            }
        });
    });

    const canvasVeiculos =
        document.getElementById('chartVeiculos');

    if (canvasVeiculos && window.Chart) {
        chartVeiculosInstancia?.destroy();

        chartVeiculosInstancia = new Chart(canvasVeiculos, {
            type: 'doughnut',
            data: {
                labels: Object.keys(porVeiculo),
                datasets: [{
                    data: Object.values(porVeiculo),
                    backgroundColor: [
                        '#1e3a8a',
                        '#d97706',
                        '#059669'
                    ]
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false
            }
        });
    }
}

function exportarRelatorioPDF() {
    if (!window.jspdf) {
        mostrarToast('Biblioteca PDF não carregada.', 'error');
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    doc.text(
        'Relatório de Desempenho - BETAXLOG',
        14,
        20
    );

    doc.autoTable({
        html: '#tabelaRankingBody',
        startY: 30
    });

    doc.save(`relatorio_betaxlog_${obterDataLocalISO()}.pdf`);
}

/* =========================================================
   ADMINISTRAÇÃO
========================================================= */

function abrirModalAdmin() {
    if (!exigirAdmin()) return;

    renderizarListaUsuarios();
    document.getElementById('modalAdmin').hidden = false;
}

function fecharModalAdmin() {
    document.getElementById('modalAdmin').hidden = true;
}

function renderizarListaUsuarios() {
    const lista = document.getElementById(
        'listaUsuariosCadastrados'
    );

    if (!lista) return;

    lista.replaceChildren();

    const item = document.createElement('li');
    item.className = 'user-row';

    const texto = document.createElement('span');
    texto.textContent =
        `${usuarioLogado.nome} · ${usuarioLogado.email || ''} · ${usuarioLogado.role}`;

    item.appendChild(texto);
    lista.appendChild(item);
}

async function cadastrarNovoUsuario() {
    mostrarToast(
        'Crie usuários pelo Authentication > Users do Supabase.',
        'error'
    );
}

async function excluirUsuario() {
    mostrarToast(
        'A exclusão de usuários deve ser feita no Supabase Authentication.',
        'error'
    );
}

async function apagarTodoOSistema() {
    if (!exigirAdmin()) return;

    if (!confirm(
        'Esta operação arquivará todos os motoristas e excluirá todas as escalas. Continuar?'
    )) {
        return;
    }

    if (prompt('Digite APAGAR para confirmar:') !== 'APAGAR') {
        return;
    }

    const { error: erroMotoristas } = await supabaseClient
        .from('motoristas')
        .update({ ativo: false })
        .eq('ativo', true);

    if (erroMotoristas) {
        mostrarToast('Não foi possível arquivar motoristas.', 'error');
        return;
    }

    const { error: erroEscalas } = await supabaseClient
        .from('escalas')
        .delete()
        .not('id', 'is', null);

    if (erroEscalas) {
        mostrarToast('Não foi possível excluir escalas.', 'error');
        return;
    }

    motoristas = [];
    escalas = {};
    indisponibilidades = {};
    historicoExecucoes = [];

    renderizarMotoristas();
    renderizarDualListboxPrioridade();

    document.getElementById('painelEscala').hidden = true;

    mostrarToast('Dados operacionais apagados.', 'success');
}

/* =========================================================
   INFORMAÇÕES DA APLICAÇÃO
========================================================= */

function atualizarInfoBackup() {
    const elemento = document.getElementById('infoUltimoBackup');

    if (!elemento) return;

    elemento.textContent =
        `☁️ Dados sincronizados · ${new Date().toLocaleString('pt-BR')}`;
}