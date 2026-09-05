'use strict';

/*
    ========================================================
    CONFIGURAÇÃO DO SUPABASE
    ========================================================

    Substitua somente os dois valores abaixo.

    Os dados estão em:

    Supabase
    → Project Settings
    → API

    Use:
    - Project URL
    - Publishable key ou anon public key

    Nunca use a service_role neste arquivo.
*/

const SUPABASE_URL =
    'COLE_AQUI_A_URL_DO_SUPABASE';

const SUPABASE_ANON_KEY =
    'COLE_AQUI_A_CHAVE_ANON_PUBLICA';

let supabaseClient = null;

let motoristas = [];
let escalas = {};
let indisponibilidades = {};
let historicoExecucoes = [];
let usuarioLogado = null;

let chartEvolucaoInstancia = null;
let chartVeiculosInstancia = null;

const MENSAGEM_CANCELAMENTO_AMAZON =
    'Olá! Sua rota de hoje foi cancelada pela Amazon. Em caso de falta de outro motorista ou necessidade de rota extra, entraremos em contato para acioná-lo(a). Obrigado pela compreensão!';

/* ========================================================
   INICIALIZAÇÃO
======================================================== */

window.addEventListener('DOMContentLoaded', async () => {
    try {
        if (!configuracaoSupabaseValida()) {
            esconderLoader();
            criarTelaLogin(
                'Configure a URL e a chave anon do Supabase no arquivo script.js.'
            );
            return;
        }

        supabaseClient = window.supabase.createClient(
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

        const autenticado = await verificarSessaoLogin();

        if (!autenticado) {
            esconderLoader();
            return;
        }

        configurarDatas();
        configurarEventos();

        await carregarMotoristas();
        await carregarEscalas();
        await carregarIndisponibilidades();

        renderizarMotoristas();
        renderizarDualListboxPrioridade();
        renderizarIndisponibilidades();
        carregarEscalaData();
        atualizarInfoBackup();

        esconderLoader();
    } catch (error) {
        console.error(error);
        esconderLoader();

        criarTelaLogin(
            `Erro ao iniciar o sistema: ${mensagemErro(error)}`
        );
    }
});

function configuracaoSupabaseValida() {
    return Boolean(
        window.supabase &&
        SUPABASE_URL &&
        SUPABASE_ANON_KEY &&
        !SUPABASE_URL.includes('COLE_AQUI') &&
        !SUPABASE_ANON_KEY.includes('COLE_AQUI') &&
        SUPABASE_URL.includes('supabase.co')
    );
}

function esconderLoader() {
    const loader = document.getElementById('appLoader');

    if (loader) {
        loader.hidden = true;
    }
}

function mensagemErro(error) {
    return error?.message || 'Erro desconhecido.';
}

function dataLocalISO(data = new Date()) {
    const ano = data.getFullYear();
    const mes = String(data.getMonth() + 1).padStart(2, '0');
    const dia = String(data.getDate()).padStart(2, '0');

    return `${ano}-${mes}-${dia}`;
}

function dataISOParaLocal(dataTexto) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataTexto || '')) {
        return null;
    }

    const [ano, mes, dia] = dataTexto.split('-').map(Number);

    return new Date(ano, mes - 1, dia);
}

function mostrarToast(texto, tipo = '') {
    const container = document.getElementById('toastContainer');

    if (!container) {
        alert(texto);
        return;
    }

    const toast = document.createElement('div');
    toast.className = `toast ${tipo}`;
    toast.textContent = texto;

    container.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 4500);
}

/* ========================================================
   LOGIN SUPABASE
======================================================== */

async function verificarSessaoLogin() {
    const {
        data: { session },
        error
    } = await supabaseClient.auth.getSession();

    if (error) {
        console.error(error);

        criarTelaLogin(
            `Erro ao consultar o Supabase: ${mensagemErro(error)}`
        );

        return false;
    }

    if (!session) {
        criarTelaLogin();
        return false;
    }

    const { data: perfil, error: erroPerfil } =
        await supabaseClient
            .from('profiles')
            .select('id, nome, role, ativo')
            .eq('id', session.user.id)
            .maybeSingle();

    if (erroPerfil) {
        console.error(erroPerfil);

        criarTelaLogin(
            'Não foi possível carregar o perfil do usuário.'
        );

        return false;
    }

    usuarioLogado = {
        id: session.user.id,
        email: session.user.email,
        nome: perfil?.nome || session.user.email,
        role: perfil?.role || 'operador',
        ativo: perfil?.ativo !== false
    };

    if (!usuarioLogado.ativo) {
        await supabaseClient.auth.signOut();

        criarTelaLogin(
            'Este usuário está desativado no sistema.'
        );

        return false;
    }

    removerTelaLogin();

    const usuarioAtual = document.getElementById('usuarioAtual');

    if (usuarioAtual) {
        usuarioAtual.textContent =
            `${usuarioLogado.nome} · ${usuarioLogado.role}`;
    }

    aplicarPermissoesDeAcesso();

    return true;
}

function criarTelaLogin(mensagem = '') {
    let overlay = document.getElementById('modalLoginOverlay');

    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'modalLoginOverlay';
        overlay.className = 'modal-overlay';

        overlay.innerHTML = `
            <div class="modal-content">
                <div class="brand">
                    <span class="brand-icon">🚛</span>
                    <h1>BETAXLOG</h1>
                </div>

                <p class="helper-text">
                    Acesso seguro pelo Supabase Authentication.
                </p>

                <div
                    id="loginMensagem"
                    class="toast error"
                    hidden>
                </div>

                <label for="loginEmail">
                    E-mail
                </label>

                <input
                    id="loginEmail"
                    type="email"
                    autocomplete="email"
                    placeholder="seu@email.com">

                <label for="loginSenha">
                    Senha
                </label>

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

    const mensagemElemento =
        document.getElementById('loginMensagem');

    if (mensagemElemento) {
        mensagemElemento.textContent = mensagem;
        mensagemElemento.hidden = !mensagem;
    }

    overlay.hidden = false;
}

function removerTelaLogin() {
    document
        .getElementById('modalLoginOverlay')
        ?.remove();
}

async function executarLogin() {
    const email = document
        .getElementById('loginEmail')
        ?.value
        .trim()
        .toLowerCase();

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

    const { error } =
        await supabaseClient.auth.signInWithPassword({
            email,
            password: senha
        });

    if (error) {
        console.error('Erro do Supabase:', error);

        if (botao) {
            botao.disabled = false;
            botao.textContent = 'Entrar';
        }

        let mensagem = 'E-mail ou senha inválidos.';

        if (
            error.message?.toLowerCase()
                .includes('email not confirmed')
        ) {
            mensagem =
                'Confirme o e-mail do usuário no Supabase antes de entrar.';
        }

        const aviso = document.getElementById('loginMensagem');

        if (aviso) {
            aviso.textContent = mensagem;
            aviso.hidden = false;
        }

        return;
    }

    window.location.reload();
}

async function fazerLogout() {
    if (!confirm('Deseja realmente sair do sistema?')) {
        return;
    }

    const { error } =
        await supabaseClient.auth.signOut();

    if (error) {
        mostrarToast('Erro ao sair do sistema.', 'error');
        return;
    }

    window.location.reload();
}

function aplicarPermissoesDeAcesso() {
    const botao = document.getElementById('btnPainelAdmin');

    if (botao) {
        botao.hidden = usuarioLogado?.role !== 'admin';
    }
}

/* ========================================================
   EVENTOS E DATAS
======================================================== */

function configurarDatas() {
    const hoje = dataLocalISO();
    const agora = new Date();

    const campoEscala =
        document.getElementById('dataEscala');

    if (campoEscala) {
        campoEscala.value = hoje;
    }

    const inicio =
        document.getElementById('relatorioDataInicio');

    const fim =
        document.getElementById('relatorioDataFim');

    if (inicio) {
        inicio.value = dataLocalISO(
            new Date(agora.getFullYear(), agora.getMonth(), 1)
        );
    }

    if (fim) {
        fim.value = hoje;
    }
}

function configurarEventos() {
    document
        .getElementById('dataEscala')
        ?.addEventListener('change', async () => {
            await carregarIndisponibilidades();
            renderizarIndisponibilidades();
            carregarEscalaData();
        });
}

/* ========================================================
   BANCO DE DADOS
======================================================== */

async function carregarMotoristas() {
    const { data, error } = await supabaseClient
        .from('motoristas')
        .select('*')
        .eq('ativo', true)
        .order('nome');

    if (error) throw error;

    motoristas = data || [];
}

async function carregarEscalas() {
    const { data, error } = await supabaseClient
        .from('escalas')
        .select(`
            *,
            escala_itens(*)
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
                itens: JSON.parse(JSON.stringify(itens))
            });
        }
    });
}

async function carregarIndisponibilidades() {
    const { data, error } = await supabaseClient
        .from('indisponibilidades')
        .select('data, motorista_id');

    if (error) throw error;

    indisponibilidades = {};

    (data || []).forEach(item => {
        if (!indisponibilidades[item.data]) {
            indisponibilidades[item.data] = [];
        }

        indisponibilidades[item.data]
            .push(item.motorista_id);
    });
}

async function salvarItensEscala(data) {
    const escala = escalas[data];

    if (!escala) return;

    const { error: erroExcluir } =
        await supabaseClient
            .from('escala_itens')
            .delete()
            .eq('escala_id', escala.id);

    if (erroExcluir) throw erroExcluir;

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

    const { error } =
        await supabaseClient
            .from('escala_itens')
            .insert(itens);

    if (error) throw error;
}

/* ========================================================
   NAVEGAÇÃO
======================================================== */

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
        document.getElementById(botao)
            ?.classList.remove('active');

        document.getElementById(view)
            ?.setAttribute('hidden', '');
    });

    if (!abas[aba]) return;

    const [botao, view] = abas[aba];

    document.getElementById(botao)
        ?.classList.add('active');

    document.getElementById(view)
        ?.removeAttribute('hidden');

    if (aba === 'motoristas') {
        renderizarMotoristas();
        renderizarDualListboxPrioridade();
    }

    if (aba === 'relatorios') {
        gerarRelatorioHistorico();
    }
}

/* ========================================================
   MOTORISTAS
======================================================== */

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
            mostrarToast(
                'Já existe um motorista com esse nome.',
                'error'
            );
        } else {
            console.error(error);
            mostrarToast(
                'Não foi possível cadastrar o motorista.',
                'error'
            );
        }

        return;
    }

    await carregarMotoristas();

    renderizarMotoristas();
    renderizarDualListboxPrioridade();

    document.getElementById('nomeMotorista').value = '';
    document.getElementById('telMotorista').value = '';

    mostrarToast('Motorista cadastrado.', 'success');
}

function renderizarMotoristas() {
    const container =
        document.getElementById('listaMotoristasCheck');

    const filtro =
        document.getElementById('filtroMotorista')
            ?.value
            .toLowerCase()
            .trim() || '';

    const contador =
        document.getElementById('contadorTotalMotoristas');

    if (contador) {
        contador.textContent =
            `Total: ${motoristas.length}`;
    }

    if (!container) return;

    container.replaceChildren();

    const lista = motoristas.filter(item =>
        item.nome.toLowerCase().includes(filtro)
    );

    lista.forEach(motorista => {
        const linha = document.createElement('div');
        linha.className = 'checkbox-item';

        const texto = document.createElement('span');
        texto.textContent =
            `${motorista.prioridade ? '⭐ ' : ''}` +
            `${motorista.nome} (${motorista.veiculo})`;

        const editar = document.createElement('button');
        editar.className = 'btn btn-secondary';
        editar.textContent = '✏️';
        editar.onclick = () =>
            abrirModalEdicao(motorista.id);

        const excluir = document.createElement('button');
        excluir.className = 'btn btn-danger';
        excluir.textContent = '🗑️';
        excluir.onclick = () =>
            excluirMotorista(motorista.id);

        const acoes = document.createElement('div');
        acoes.className = 'toolbar';
        acoes.append(editar, excluir);

        linha.append(texto, acoes);
        container.appendChild(linha);
    });

    if (!lista.length) {
        container.innerHTML =
            '<p class="helper-text">Nenhum motorista encontrado.</p>';
    }
}

async function excluirMotorista(id) {
    const motorista = motoristas.find(
        item => item.id === id
    );

    if (!motorista) return;

    if (!confirm(`Arquivar "${motorista.nome}"?`)) {
        return;
    }

    const { error } = await supabaseClient
        .from('motoristas')
        .update({ ativo: false })
        .eq('id', id);

    if (error) {
        mostrarToast(
            'Não foi possível arquivar o motorista.',
            'error'
        );

        return;
    }

    await carregarMotoristas();

    renderizarMotoristas();
    renderizarDualListboxPrioridade();

    mostrarToast('Motorista arquivado.', 'success');
}

function abrirModalEdicao(id) {
    const motorista = motoristas.find(
        item => item.id === id
    );

    if (!motorista) return;

    document.getElementById('editMotoristaId').value =
        motorista.id;

    document.getElementById('editNomeMotorista').value =
        motorista.nome;

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
    const id =
        document.getElementById('editMotoristaId').value;

    const nome =
        document.getElementById('editNomeMotorista')
            .value
            .trim();

    const telefone =
        document.getElementById('editTelMotorista')
            .value
            .trim();

    const veiculo =
        document.getElementById('editTipoVeiculo').value;

    if (!nome) {
        mostrarToast('Informe o nome.', 'error');
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
        mostrarToast(
            'Não foi possível atualizar o motorista.',
            'error'
        );

        return;
    }

    await carregarMotoristas();

    renderizarMotoristas();
    renderizarDualListboxPrioridade();
    fecharModalEdicao();

    mostrarToast('Motorista atualizado.', 'success');
}

/* ========================================================
   PRIORIDADE
======================================================== */

function renderizarDualListboxPrioridade() {
    const rodizio =
        document.getElementById('listaRodizio');

    const prioritarios =
        document.getElementById('listaPrioritarios');

    if (!rodizio || !prioritarios) return;

    rodizio.replaceChildren();
    prioritarios.replaceChildren();

    [...motoristas]
        .sort((a, b) =>
            a.nome.localeCompare(b.nome)
        )
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

    [...select.options].forEach(option => {
        option.selected = true;
    });
}

async function moverParaPrioridade() {
    await alterarPrioridade(true);
}

async function moverParaRodizio() {
    await alterarPrioridade(false);
}

async function alterarPrioridade(valor) {
    const ids = [
        ...document
            .getElementById('listaRodizio')
            .selectedOptions,

        ...document
            .getElementById('listaPrioritarios')
            .selectedOptions
    ].map(option => option.value);

    if (!ids.length) {
        mostrarToast(
            'Selecione ao menos um motorista.',
            'error'
        );

        return;
    }

    const { error } = await supabaseClient
        .from('motoristas')
        .update({ prioridade: valor })
        .in('id', ids);

    if (error) {
        mostrarToast(
            'Não foi possível atualizar a prioridade.',
            'error'
        );

        return;
    }

    await carregarMotoristas();

    renderizarMotoristas();
    renderizarDualListboxPrioridade();
}

function obterSelecionadoDual() {
    const selecionados = [
        ...document
            .getElementById('listaRodizio')
            .selectedOptions,

        ...document
            .getElementById('listaPrioritarios')
            .selectedOptions
    ];

    if (selecionados.length !== 1) {
        mostrarToast(
            'Selecione somente um motorista.',
            'error'
        );

        return null;
    }

    return selecionados[0].value;
}

function editarSelecionadoDualListbox() {
    const id = obterSelecionadoDual();

    if (id) {
        abrirModalEdicao(id);
    }
}

async function excluirSelecionadoDualListbox() {
    const id = obterSelecionadoDual();

    if (id) {
        await excluirMotorista(id);
    }
}

/* ========================================================
   INDISPONIBILIDADE
======================================================== */

function renderizarIndisponibilidades() {
    const container =
        document.getElementById(
            'listaMotoristasIndisponiveis'
        );

    const data =
        document.getElementById('dataEscala')?.value;

    if (!container || !data) return;

    const lista =
        indisponibilidades[data] || [];

    container.replaceChildren();

    motoristas.forEach(motorista => {
        const linha = document.createElement('div');
        linha.className = 'checkbox-item';

        const label = document.createElement('label');
        const checkbox = document.createElement('input');

        checkbox.type = 'checkbox';
        checkbox.checked =
            lista.includes(motorista.id);

        checkbox.addEventListener(
            'change',
            event => toggleIndisponibilidade(
                motorista.id,
                event.target.checked
            )
        );

        label.append(
            checkbox,
            document.createTextNode(
                `${motorista.nome} (${motorista.veiculo})`
            )
        );

        linha.appendChild(label);
        container.appendChild(linha);
    });
}

async function toggleIndisponibilidade(id, ativo) {
    const data =
        document.getElementById('dataEscala').value;

    if (ativo) {
        await supabaseClient
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
    } else {
        await supabaseClient
            .from('indisponibilidades')
            .delete()
            .eq('data', data)
            .eq('motorista_id', id);
    }

    await carregarIndisponibilidades();
}

/* ========================================================
   ESCALAS
======================================================== */

function carregarEscalaData() {
    const data =
        document.getElementById('dataEscala').value;

    const painel =
        document.getElementById('painelEscala');

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

    renderizarTabelaEscala(
        escala.itens,
        escala.status
    );

    painel.hidden = false;
}

function ordenarPorRodizio(lista) {
    return [...lista].sort((a, b) => {
        const dataA =
            a.ultima_escalado_em || '0000-00-00';

        const dataB =
            b.ultima_escalado_em || '0000-00-00';

        return dataA.localeCompare(dataB);
    });
}

async function gerarPrevia() {
    const data =
        document.getElementById('dataEscala').value;

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
        mostrarToast(
            'Informe quantidades válidas de vagas.',
            'error'
        );

        return;
    }

    const indisponiveis =
        indisponibilidades[data] || [];

    const disponiveis = motoristas.filter(motorista =>
        !indisponiveis.includes(motorista.id) &&
        !motorista.prioridade
    );

    const itens = [];
    const tipos = [
        ['utilitario', 'Utilitário'],
        ['van', 'Van'],
        ['passeio', 'Carro de Passeio']
    ];

    for (const [chave, veiculo] of tipos) {
        const quantidade = vagas[chave];

        const pool = ordenarPorRodizio(
            disponiveis.filter(
                motorista => motorista.veiculo === veiculo
            )
        );

        for (let i = 0; i < quantidade; i++) {
            const motorista = pool[i];

            itens.push({
                dsp: 'BETAXLOG',
                nome: motorista
                    ? motorista.nome
                    : 'VAGA SEM MOTORISTA',

                telefone: motorista
                    ? motorista.telefone || ''
                    : '',

                motoristaId: motorista
                    ? motorista.id
                    : null,

                veiculo,
                onda: '',
                status: motorista ? 'ativo' : 'vago'
            });
        }
    }

    const escalaExistente = escalas[data];

    let escalaId = escalaExistente?.id;

    if (escalaId) {
        const { error } =
            await supabaseClient
                .from('escalas')
                .update({
                    status: 'prévia',
                    vagas_utilitario: vagas.utilitario,
                    vagas_van: vagas.van,
                    vagas_passeio: vagas.passeio,
                    updated_at: new Date().toISOString()
                })
                .eq('id', escalaId);

        if (error) throw error;
    } else {
        const { data: novaEscala, error } =
            await supabaseClient
                .from('escalas')
                .insert({
                    data,
                    status: 'prévia',
                    vagas_utilitario: vagas.utilitario,
                    vagas_van: vagas.van,
                    vagas_passeio: vagas.passeio,
                    criado_por: usuarioLogado.id
                })
                .select()
                .single();

        if (error) throw error;

        escalaId = novaEscala.id;
    }

    escalas[data] = {
        id: escalaId,
        status: 'prévia',
        vagas,
        itens
    };

    await salvarItensEscala(data);
    await carregarEscalas();

    renderizarTabelaEscala(
        escalas[data].itens,
        escalas[data].status
    );

    document.getElementById('painelEscala').hidden = false;

    mostrarToast('Prévia gerada com sucesso.', 'success');
}

function renderizarTabelaEscala(itens, status) {
    const tbody =
        document.getElementById('tabelaEscalaBody');

    const tag =
        document.getElementById('tagStatus');

    const data =
        document.getElementById('dataEscala').value;

    if (!tbody) return;

    tag.textContent =
        status === 'definitiva'
            ? 'DEFINITIVA'
            : 'PRÉVIA';

    tag.className =
        `badge-status ${
            status === 'definitiva'
                ? 'badge-definitiva'
                : 'badge-previa'
        }`;

    const subtitulo =
        document.getElementById('dataSubtituloImagem');

    if (subtitulo) {
        subtitulo.textContent =
            `Data: ${data.split('-').reverse().join('/')}`;
    }

    tbody.replaceChildren();

    itens.forEach((item, index) => {
        const tr = document.createElement('tr');

        const cancelado =
            item.status === 'cancelado' ||
            item.status === 'cancelado_amazon';

        if (cancelado) {
            tr.className = 'row-cancelada';
        }

        const tdDsp = document.createElement('td');
        tdDsp.textContent = item.dsp;

        const tdNome = document.createElement('td');
        tdNome.textContent = item.nome;

        const tdVeiculo = document.createElement('td');
        tdVeiculo.textContent = item.veiculo;

        const tdOnda = document.createElement('td');
        const onda = document.createElement('input');

        onda.className = 'input-onda';
        onda.value = item.onda || '';
        onda.placeholder = 'HH:MM';

        onda.addEventListener('change', event => {
            atualizarOnda(index, event.target.value);
        });

        tdOnda.appendChild(onda);

        const tdAcao = document.createElement('td');

        const botao = document.createElement('button');
        botao.className = cancelado
            ? 'btn btn-success'
            : 'btn btn-danger';

        botao.textContent = cancelado
            ? '✅'
            : '❌';

        botao.onclick = () => cancelado
            ? ativarRota(index)
            : cancelarRota(index);

        tdAcao.appendChild(botao);

        tr.append(
            tdDsp,
            tdNome,
            tdVeiculo,
            tdOnda,
            tdAcao
        );

        tbody.appendChild(tr);
    });
}

async function atualizarOnda(index, valor) {
    const data =
        document.getElementById('dataEscala').value;

    if (!escalas[data]?.itens[index]) return;

    escalas[data].itens[index].onda =
        valor.trim();

    await salvarItensEscala(data);
}

async function cancelarRota(index) {
    const data =
        document.getElementById('dataEscala').value;

    const item =
        escalas[data]?.itens[index];

    if (!item || !item.motoristaId) {
        mostrarToast(
            'Não existe motorista nesta vaga.',
            'error'
        );

        return;
    }

    if (!confirm(`Cancelar a rota de ${item.nome}?`)) {
        return;
    }

    item.status = 'cancelado_amazon';

    await salvarItensEscala(data);
    renderizarTabelaEscala(
        escalas[data].itens,
        escalas[data].status
    );

    const telefone =
        String(item.telefone || '')
            .replace(/\D/g, '');

    if (telefone) {
        const texto = encodeURIComponent(
            MENSAGEM_CANCELAMENTO_AMAZON
        );

        window.open(
            `https://wa.me/${telefone}?text=${texto}`,
            '_blank',
            'noopener,noreferrer'
        );
    }
}

async function ativarRota(index) {
    const data =
        document.getElementById('dataEscala').value;

    const item =
        escalas[data]?.itens[index];

    if (!item) return;

    item.status = 'ativo';

    await salvarItensEscala(data);

    renderizarTabelaEscala(
        escalas[data].itens,
        escalas[data].status
    );
}

function salvarPrevia() {
    mostrarToast(
        'A prévia já está salva no Supabase.',
        'success'
    );
}

async function confirmarDefinitiva() {
    const data =
        document.getElementById('dataEscala').value;

    const escala = escalas[data];

    if (!escala) return;

    if (!confirm('Confirmar esta escala como definitiva?')) {
        return;
    }

    const { error } =
        await supabaseClient
            .from('escalas')
            .update({
                status: 'definitiva',
                updated_at: new Date().toISOString()
            })
            .eq('id', escala.id);

    if (error) {
        mostrarToast(
            'Não foi possível confirmar a escala.',
            'error'
        );

        return;
    }

    await carregarEscalas();

    renderizarTabelaEscala(
        escalas[data].itens,
        escalas[data].status
    );

    mostrarToast(
        'Escala confirmada com sucesso.',
        'success'
    );
}

async function excluirEscalaAtual() {
    const data =
        document.getElementById('dataEscala').value;

    const escala = escalas[data];

    if (!escala) return;

    if (!confirm('Excluir a escala desta data?')) {
        return;
    }

    const { error } =
        await supabaseClient
            .from('escalas')
            .delete()
            .eq('id', escala.id);

    if (error) {
        mostrarToast(
            'Não foi possível excluir a escala.',
            'error'
        );

        return;
    }

    delete escalas[data];

    document.getElementById('painelEscala').hidden = true;

    mostrarToast('Escala excluída.', 'success');
}

/* ========================================================
   EXPORTAÇÕES
======================================================== */

function exportarExcel() {
    const data =
        document.getElementById('dataEscala').value;

    const escala = escalas[data];

    if (!escala) return;

    const dados = escala.itens.map(item => ({
        DSP: item.dsp,
        Motorista: item.nome,
        Telefone: item.telefone,
        Veiculo: item.veiculo,
        Onda: item.onda,
        Status: item.status
    }));

    const worksheet =
        XLSX.utils.json_to_sheet(dados);

    const workbook =
        XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
        workbook,
        worksheet,
        'Escala'
    );

    XLSX.writeFile(
        workbook,
        `escala_${data}.xlsx`
    );
}

function exportarBackupMotoristas() {
    const dados = motoristas.map(item => ({
        Nome: item.nome,
        Telefone: item.telefone,
        Veiculo: item.veiculo,
        Prioridade: item.prioridade
            ? 'SIM'
            : 'NAO'
    }));

    const worksheet =
        XLSX.utils.json_to_sheet(dados);

    const workbook =
        XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
        workbook,
        worksheet,
        'Motoristas'
    );

    XLSX.writeFile(
        workbook,
        `motoristas_${dataLocalISO()}.xlsx`
    );
}

async function importarExcel(event) {
    const arquivo = event.target.files?.[0];

    if (!arquivo) return;

    try {
        const buffer = await arquivo.arrayBuffer();
        const workbook = XLSX.read(
            buffer,
            { type: 'array' }
        );

        const primeiraAba =
            workbook.Sheets[workbook.SheetNames[0]];

        const linhas =
            XLSX.utils.sheet_to_json(primeiraAba);

        for (const linha of linhas) {
            const nome = String(
                linha.Nome ||
                linha.nome ||
                ''
            ).trim();

            if (!nome) continue;

            await supabaseClient
                .from('motoristas')
                .insert({
                    nome,
                    telefone: String(
                        linha.Telefone ||
                        linha.telefone ||
                        ''
                    ).trim(),

                    veiculo: String(
                        linha.Veiculo ||
                        linha.veiculo ||
                        'Utilitário'
                    ).trim(),

                    prioridade:
                        String(
                            linha.Prioridade ||
                            ''
                        ).toUpperCase() === 'SIM'
                });
        }

        await carregarMotoristas();

        renderizarMotoristas();
        renderizarDualListboxPrioridade();

        mostrarToast(
            'Importação concluída.',
            'success'
        );
    } catch (error) {
        console.error(error);

        mostrarToast(
            'Erro ao importar o arquivo.',
            'error'
        );
    }

    event.target.value = '';
}

function gerarImagemEscalaECompartilhar() {
    const area =
        document.getElementById('areaCapturaImagem');

    if (!area) return;

    html2canvas(area, { scale: 2 })
        .then(canvas => {
            const link =
                document.createElement('a');

            const data =
                document.getElementById('dataEscala')
                    .value || 'escala';

            link.download =
                `escala_betaxlog_${data}.png`;

            link.href =
                canvas.toDataURL('image/png');

            link.click();
        });
}

function compartilharWhatsAppTexto() {
    const data =
        document.getElementById('dataEscala').value;

    const escala = escalas[data];

    if (!escala) {
        mostrarToast(
            'Não existe escala nesta data.',
            'error'
        );

        return;
    }

    let texto =
        `🚛 ESCALA BETAXLOG\n` +
        `📅 Data: ${data.split('-').reverse().join('/')}\n\n`;

    escala.itens
        .filter(item =>
            item.motoristaId &&
            item.status !== 'cancelado' &&
            item.status !== 'cancelado_amazon'
        )
        .forEach(item => {
            texto +=
                `• ${item.nome} - ${item.veiculo}` +
                ` - Onda: ${item.onda || 'não definida'}\n`;
        });

    navigator.clipboard.writeText(texto)
        .then(() => {
            mostrarToast(
                'Escala copiada. Cole no WhatsApp.',
                'success'
            );

            window.open(
                'https://web.whatsapp.com/',
                '_blank',
                'noopener,noreferrer'
            );
        })
        .catch(() => {
            prompt('Copie o texto:', texto);
        });
}

/* ========================================================
   RELATÓRIOS
======================================================== */

function aplicarAtalhoPeriodo() {
    const atalho =
        document.getElementById('filtroAtalhoPeriodo')
            .value;

    const hoje = new Date();
    let inicio = new Date();

    if (atalho === 'mes_atual') {
        inicio = new Date(
            hoje.getFullYear(),
            hoje.getMonth(),
            1
        );
    }

    if (atalho === 'semanal') {
        inicio.setDate(hoje.getDate() - 7);
    }

    if (atalho === 'semestral') {
        inicio.setMonth(hoje.getMonth() - 6);
    }

    if (atalho === 'anual') {
        inicio = new Date(
            hoje.getFullYear(),
            0,
            1
        );
    }

    document.getElementById(
        'relatorioDataInicio'
    ).value = dataLocalISO(inicio);

    document.getElementById(
        'relatorioDataFim'
    ).value = dataLocalISO(hoje);
}

function gerarRelatorioHistorico() {
    const inicioTexto =
        document.getElementById('relatorioDataInicio')
            .value;

    const fimTexto =
        document.getElementById('relatorioDataFim')
            .value;

    if (!inicioTexto || !fimTexto) return;

    const inicio =
        dataISOParaLocal(inicioTexto);

    const fim =
        dataISOParaLocal(fimTexto);

    fim.setHours(23, 59, 59, 999);

    const historico =
        historicoExecucoes.filter(item => {
            const data =
                dataISOParaLocal(item.data);

            return data >= inicio && data <= fim;
        });

    let total = 0;
    let ativas = 0;
    let canceladas = 0;

    const ranking = {};

    historico.forEach(execucao => {
        execucao.itens.forEach(item => {
            if (!item.motoristaId) return;

            total++;

            const cancelado =
                item.status === 'cancelado' ||
                item.status === 'cancelado_amazon';

            if (cancelado) {
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

            if (cancelado) {
                ranking[item.motoristaId].canceladas++;
            }
        });
    });

    document.getElementById('kpiTotalRotas')
        .textContent = total;

    document.getElementById('kpiRotasAtivas')
        .textContent = ativas;

    document.getElementById('kpiRotasCanceladas')
        .textContent = canceladas;

    document.getElementById('kpiTaxaSucesso')
        .textContent =
        `${total ? ((ativas / total) * 100).toFixed(1) : 0}%`;

    const tbody =
        document.getElementById('tabelaRankingBody');

    tbody.replaceChildren();

    Object.values(ranking)
        .sort((a, b) =>
            b.escaladas - a.escaladas
        )
        .forEach(item => {
            const presenca =
                item.escaladas
                    ? (
                        (
                            item.escaladas -
                            item.canceladas
                        ) /
                        item.escaladas *
                        100
                    ).toFixed(1)
                    : '0.0';

            const tr =
                document.createElement('tr');

            [
                item.nome,
                item.veiculo,
                item.escaladas,
                item.canceladas,
                `${presenca}%`
            ].forEach(valor => {
                const td =
                    document.createElement('td');

                td.textContent = valor;
                tr.appendChild(td);
            });

            tbody.appendChild(tr);
        });

    atualizarGraficos(historico);
}

function atualizarGraficos(historico) {
    const datas = {};
    const veiculos = {
        'Utilitário': 0,
        'Van': 0,
        'Carro de Passeio': 0
    };

    historico.forEach(execucao => {
        datas[execucao.data] =
            execucao.itens.filter(item =>
                item.motoristaId &&
                item.status !== 'cancelado' &&
                item.status !== 'cancelado_amazon'
            ).length;

        execucao.itens.forEach(item => {
            if (
                item.motoristaId &&
                item.status !== 'cancelado' &&
                item.status !== 'cancelado_amazon' &&
                veiculos[item.veiculo] !== undefined
            ) {
                veiculos[item.veiculo]++;
            }
        });
    });

    const canvasEvolucao =
        document.getElementById('chartEvolucao');

    if (canvasEvolucao && window.Chart) {
        chartEvolucaoInstancia?.destroy();

        chartEvolucaoInstancia = new Chart(
            canvasEvolucao,
            {
                type: 'line',
                data: {
                    labels: Object.keys(datas),
                    datasets: [{
                        label: 'Rotas ativas',
                        data: Object.values(datas),
                        borderColor: '#1e3a8a',
                        backgroundColor:
                            'rgba(30,58,138,.12)',
                        fill: true,
                        tension: .3
                    }]
                },
                options: {
                    responsive: true
                }
            }
        );
    }

    const canvasVeiculos =
        document.getElementById('chartVeiculos');

    if (canvasVeiculos && window.Chart) {
        chartVeiculosInstancia?.destroy();

        chartVeiculosInstancia = new Chart(
            canvasVeiculos,
            {
                type: 'doughnut',
                data: {
                    labels: Object.keys(veiculos),
                    datasets: [{
                        data: Object.values(veiculos),
                        backgroundColor: [
                            '#1e3a8a',
                            '#d97706',
                            '#059669'
                        ]
                    }]
                },
                options: {
                    responsive: true
                }
            }
        );
    }
}

function exportarRelatorioPDF() {
    if (!window.jspdf) {
        mostrarToast(
            'A biblioteca de PDF não foi carregada.',
            'error'
        );

        return;
    }

    const { jsPDF } = window.jspdf;
    const documento = new jsPDF();

    documento.text(
        'Relatório BETAXLOG',
        14,
        20
    );

    documento.autoTable({
        html: '#tabelaRankingBody',
        startY: 30
    });

    documento.save(
        `relatorio_betaxlog_${dataLocalISO()}.pdf`
    );
}

/* ========================================================
   ADMINISTRAÇÃO
======================================================== */

function abrirModalAdmin() {
    if (usuarioLogado?.role !== 'admin') {
        mostrarToast(
            'Acesso restrito ao administrador.',
            'error'
        );

        return;
    }

    renderizarListaUsuarios();

    document.getElementById('modalAdmin')
        .hidden = false;
}

function fecharModalAdmin() {
    document.getElementById('modalAdmin')
        .hidden = true;
}

function renderizarListaUsuarios() {
    const lista =
        document.getElementById(
            'listaUsuariosCadastrados'
        );

    if (!lista) return;

    lista.replaceChildren();

    const item =
        document.createElement('li');

    item.className = 'user-row';

    item.textContent =
        `${usuarioLogado.nome} · ` +
        `${usuarioLogado.email} · ` +
        `${usuarioLogado.role}`;

    lista.appendChild(item);
}

async function apagarTodoOSistema() {
    if (usuarioLogado?.role !== 'admin') {
        mostrarToast(
            'Acesso restrito ao administrador.',
            'error'
        );

        return;
    }

    if (!confirm(
        'Arquivar motoristas e excluir todas as escalas?'
    )) {
        return;
    }

    if (prompt(
        'Digite APAGAR para confirmar:'
    ) !== 'APAGAR') {
        return;
    }

    const { error: erroMotoristas } =
        await supabaseClient
            .from('motoristas')
            .update({ ativo: false })
            .eq('ativo', true);

    if (erroMotoristas) {
        mostrarToast(
            'Não foi possível arquivar os motoristas.',
            'error'
        );

        return;
    }

    const { error: erroEscalas } =
        await supabaseClient
            .from('escalas')
            .delete()
            .not('id', 'is', null);

    if (erroEscalas) {
        mostrarToast(
            'Não foi possível excluir as escalas.',
            'error'
        );

        return;
    }

    motoristas = [];
    escalas = {};
    indisponibilidades = {};
    historicoExecucoes = [];

    renderizarMotoristas();
    renderizarDualListboxPrioridade();

    document.getElementById('painelEscala')
        .hidden = true;

    mostrarToast(
        'Dados operacionais apagados.',
        'success'
    );
}

function atualizarInfoBackup() {
    const elemento =
        document.getElementById('infoUltimoBackup');

    if (elemento) {
        elemento.textContent =
            `☁️ Supabase sincronizado em ` +
            `${new Date().toLocaleString('pt-BR')}`;
    }
}
