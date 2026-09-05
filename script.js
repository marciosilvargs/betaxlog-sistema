'use strict';

/*
========================================================
CONFIGURAÇÃO DO SUPABASE
========================================================
*/

const SUPABASE_URL =
    'https://bnpfdkwjdtnpfmnjoftf.supabase.co';

const SUPABASE_ANON_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJucGZka3dqZHRucGZtbmpvZnRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1NzMxNzcsImV4cCI6MjEwNDE0OTE3N30.5ksgMBijxazAtCtse-Lb5MqmaxcL22dVqKBMrnjSYMA';

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

/*
========================================================
ESTADO
========================================================
*/

let usuarioLogado = null;
let motoristas = [];
let escalas = {};
let indisponibilidades = {};
let historicoExecucoes = [];

let chartEvolucaoInstancia = null;
let chartVeiculosInstancia = null;

const MENSAGEM_CANCELAMENTO_AMAZON =
    'Olá! Sua rota de hoje foi cancelada pela Amazon. Em caso de falta de outro motorista ou necessidade de rota extra, entraremos em contato para acioná-lo(a). Obrigado pela compreensão!';

/*
========================================================
INICIALIZAÇÃO
========================================================
*/

window.addEventListener('DOMContentLoaded', iniciarAplicacao);

async function iniciarAplicacao() {
    try {
        const autenticado =
            await verificarSessaoLogin();

        if (!autenticado) {
            esconderCarregamento();
            return;
        }

        configurarDatas();
        configurarEventos();

        await carregarMotoristas();
        await carregarEscalas();
        await carregarIndisponibilidades();

        renderizarMotoristas();
        renderizarPrioridades();
        renderizarIndisponibilidades();
        carregarEscalaData();
        atualizarInfoBackup();

        esconderCarregamento();
    } catch (error) {
        console.error(error);

        esconderCarregamento();

        mostrarToast(
            error.message ||
            'Erro ao iniciar o sistema.',
            'error'
        );
    }
}

function esconderCarregamento() {
    document
        .getElementById('appLoader')
        ?.remove();
}

function configurarDatas() {
    const hoje = obterDataISO();

    document
        .getElementById('dataEscala')
        .value = hoje;

    const primeiroDia =
        obterDataISO(
            new Date(
                new Date().getFullYear(),
                new Date().getMonth(),
                1
            )
        );

    document
        .getElementById('relatorioDataInicio')
        .value = primeiroDia;

    document
        .getElementById('relatorioDataFim')
        .value = hoje;
}

function configurarEventos() {
    document
        .getElementById('dataEscala')
        .addEventListener(
            'change',
            async () => {
                await carregarIndisponibilidades();

                renderizarIndisponibilidades();
                carregarEscalaData();
            }
        );
}

/*
========================================================
AUTENTICAÇÃO
========================================================
*/

async function verificarSessaoLogin() {
    const {
        data: { session },
        error
    } = await supabaseClient.auth.getSession();

    if (error) {
        throw error;
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
        throw erroPerfil;
    }

    if (!perfil) {
        criarTelaLogin(
            'Usuário autenticado, mas sem registro na tabela profiles.'
        );

        return false;
    }

    if (perfil.ativo === false) {
        await supabaseClient.auth.signOut();

        criarTelaLogin(
            'Este usuário está desativado.'
        );

        return false;
    }

    usuarioLogado = {
        id: session.user.id,
        email: session.user.email,
        nome: perfil.nome,
        role: perfil.role
    };

    document
        .getElementById('usuarioAtual')
        .textContent =
        `${usuarioLogado.nome} · ${usuarioLogado.role}`;

    document
        .getElementById('btnPainelAdmin')
        .hidden =
        usuarioLogado.role !== 'admin';

    removerTelaLogin();

    return true;
}

function criarTelaLogin(mensagem = '') {
    let overlay =
        document.getElementById('modalLoginOverlay');

    if (!overlay) {
        overlay =
            document.createElement('div');

        overlay.id = 'modalLoginOverlay';
        overlay.className = 'login-overlay';

        overlay.innerHTML = `
            <div class="login-card">
                <h1>🚛 BETAXLOG</h1>

                <p>
                    Acesso pelo Supabase Authentication
                </p>

                <div
                    id="loginMensagem"
                    class="login-message">
                    ${escapeHtml(mensagem)}
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
                    class="btn btn-primary"
                    type="button">
                    Entrar
                </button>
            </div>
        `;

        document.body.appendChild(overlay);

        document
            .getElementById('btnLogin')
            .addEventListener(
                'click',
                executarLogin
            );

        document
            .getElementById('loginSenha')
            .addEventListener(
                'keydown',
                event => {
                    if (event.key === 'Enter') {
                        executarLogin();
                    }
                }
            );
    } else {
        overlay.style.display = 'flex';
    }
}

function removerTelaLogin() {
    document
        .getElementById('modalLoginOverlay')
        ?.remove();
}

async function executarLogin() {
    const email =
        document
            .getElementById('loginEmail')
            .value
            .trim()
            .toLowerCase();

    const senha =
        document
            .getElementById('loginSenha')
            .value;

    const botao =
        document.getElementById('btnLogin');

    if (!email || !senha) {
        mostrarMensagemLogin(
            'Informe o e-mail e a senha.'
        );

        return;
    }

    botao.disabled = true;
    botao.textContent = 'Entrando...';

    const { error } =
        await supabaseClient.auth.signInWithPassword({
            email,
            password: senha
        });

    if (error) {
        botao.disabled = false;
        botao.textContent = 'Entrar';

        mostrarMensagemLogin(
            traduzirErroLogin(error)
        );

        return;
    }

    window.location.reload();
}

function mostrarMensagemLogin(mensagem) {
    const elemento =
        document.getElementById('loginMensagem');

    if (elemento) {
        elemento.textContent = mensagem;
    }
}

function traduzirErroLogin(error) {
    const mensagem =
        String(error.message || '').toLowerCase();

    if (mensagem.includes('email not confirmed')) {
        return 'Confirme o e-mail no Supabase antes de entrar.';
    }

    if (mensagem.includes('invalid login credentials')) {
        return 'E-mail ou senha inválidos.';
    }

    if (mensagem.includes('failed to fetch')) {
        return 'Não foi possível conectar ao Supabase.';
    }

    return error.message;
}

async function fazerLogout() {
    await supabaseClient.auth.signOut();
    window.location.reload();
}

/*
========================================================
NAVEGAÇÃO
========================================================
*/

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

    Object.values(abas).forEach(
        ([botao, tela]) => {
            document
                .getElementById(botao)
                .classList.remove('active');

            document
                .getElementById(tela)
                .hidden = true;
        }
    );

    const [botao, tela] = abas[aba];

    document
        .getElementById(botao)
        .classList.add('active');

    document
        .getElementById(tela)
        .hidden = false;

    if (aba === 'relatorios') {
        gerarRelatorioHistorico();
    }
}

/*
========================================================
LEITURA DO SUPABASE
========================================================
*/

async function carregarMotoristas() {
    const { data, error } =
        await supabaseClient
            .from('motoristas')
            .select('*')
            .eq('ativo', true)
            .order('nome');

    if (error) throw error;

    motoristas = data || [];
}

async function carregarIndisponibilidades() {
    const { data, error } =
        await supabaseClient
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

async function carregarEscalas() {
    const { data, error } =
        await supabaseClient
            .from('escalas')
            .select(`
                *,
                escala_itens(*)
            `)
            .order('data', {
                ascending: false
            });

    if (error) throw error;

    escalas = {};
    historicoExecucoes = [];

    (data || []).forEach(escala => {
        const itens =
            (escala.escala_itens || [])
                .sort((a, b) =>
                    a.ordem - b.ordem
                )
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
                itens: structuredCloneSafe(itens)
            });
        }
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

    const itens = escala.itens.map(
        (item, index) => ({
            escala_id: escala.id,
            ordem: index,
            dsp: item.dsp,
            nome_snapshot: item.nome,
            telefone_snapshot: item.telefone || '',
            motorista_id: item.motoristaId || null,
            veiculo: item.veiculo,
            onda: item.onda || '',
            status: item.status
        })
    );

    if (!itens.length) return;

    const { error } =
        await supabaseClient
            .from('escala_itens')
            .insert(itens);

    if (error) throw error;
}

/*
========================================================
MOTORISTAS
========================================================
*/

async function cadastrarMotorista() {
    const nome =
        document
            .getElementById('nomeMotorista')
            .value
            .trim();

    const telefone =
        document
            .getElementById('telMotorista')
            .value
            .trim();

    const veiculo =
        document
            .getElementById('tipoVeiculo')
            .value;

    if (!nome) {
        mostrarToast(
            'Informe o nome do motorista.',
            'error'
        );

        return;
    }

    const { error } =
        await supabaseClient
            .from('motoristas')
            .insert({
                nome,
                telefone,
                veiculo,
                prioridade: false
            });

    if (error) {
        mostrarToast(
            error.code === '23505'
                ? 'Já existe um motorista com esse nome.'
                : error.message,
            'error'
        );

        return;
    }

    document
        .getElementById('nomeMotorista')
        .value = '';

    document
        .getElementById('telMotorista')
        .value = '';

    await carregarMotoristas();

    renderizarMotoristas();
    renderizarPrioridades();

    mostrarToast(
        'Motorista cadastrado.',
        'success'
    );
}

function renderizarMotoristas() {
    const container =
        document.getElementById(
            'listaMotoristasCheck'
        );

    const filtro =
        document
            .getElementById('filtroMotorista')
            .value
            .trim()
            .toLowerCase();

    document
        .getElementById('contadorTotalMotoristas')
        .textContent =
        `Total: ${motoristas.length}`;

    container.replaceChildren();

    motoristas
        .filter(item =>
            item.nome.toLowerCase().includes(filtro)
        )
        .forEach(motorista => {
            const linha =
                document.createElement('div');

            linha.className = 'checkbox-item';

            const texto =
                document.createElement('span');

            texto.textContent =
                `${motorista.prioridade ? '⭐ ' : ''}` +
                `${motorista.nome} (${motorista.veiculo})`;

            const botoes =
                document.createElement('div');

            const editar =
                document.createElement('button');

            editar.className =
                'btn btn-secondary btn-icon';

            editar.textContent = '✏️';

            editar.onclick = () =>
                abrirModalEdicao(motorista.id);

            const excluir =
                document.createElement('button');

            excluir.className =
                'btn btn-danger btn-icon';

            excluir.textContent = '🗑️';

            excluir.onclick = () =>
                excluirMotorista(motorista.id);

            botoes.append(editar, excluir);
            linha.append(texto, botoes);
            container.appendChild(linha);
        });
}

function abrirModalEdicao(id) {
    const motorista =
        motoristas.find(item =>
            item.id === id
        );

    if (!motorista) return;

    document
        .getElementById('editMotoristaId')
        .value = motorista.id;

    document
        .getElementById('editNomeMotorista')
        .value = motorista.nome;

    document
        .getElementById('editTelMotorista')
        .value = motorista.telefone || '';

    document
        .getElementById('editTipoVeiculo')
        .value = motorista.veiculo;

    document
        .getElementById('modalEdicao')
        .hidden = false;
}

function fecharModalEdicao() {
    document
        .getElementById('modalEdicao')
        .hidden = true;
}

async function salvarEdicaoMotorista() {
    const id =
        document
            .getElementById('editMotoristaId')
            .value;

    const nome =
        document
            .getElementById('editNomeMotorista')
            .value
            .trim();

    const telefone =
        document
            .getElementById('editTelMotorista')
            .value
            .trim();

    const veiculo =
        document
            .getElementById('editTipoVeiculo')
            .value;

    if (!nome) {
        mostrarToast(
            'Informe o nome.',
            'error'
        );

        return;
    }

    const { error } =
        await supabaseClient
            .from('motoristas')
            .update({
                nome,
                telefone,
                veiculo,
                updated_at: new Date().toISOString()
            })
            .eq('id', id);

    if (error) {
        mostrarToast(error.message, 'error');
        return;
    }

    await carregarMotoristas();

    renderizarMotoristas();
    renderizarPrioridades();
    fecharModalEdicao();

    mostrarToast(
        'Motorista atualizado.',
        'success'
    );
}

async function excluirMotorista(id) {
    const motorista =
        motoristas.find(item =>
            item.id === id
        );

    if (!motorista) return;

    if (!confirm(
        `Excluir ${motorista.nome}?`
    )) {
        return;
    }

    const { error } =
        await supabaseClient
            .from('motoristas')
            .update({
                ativo: false,
                updated_at: new Date().toISOString()
            })
            .eq('id', id);

    if (error) {
        mostrarToast(error.message, 'error');
        return;
    }

    await carregarMotoristas();

    renderizarMotoristas();
    renderizarPrioridades();

    mostrarToast(
        'Motorista arquivado.',
        'success'
    );
}

/*
========================================================
PRIORIDADE
========================================================
*/

function renderizarPrioridades() {
    const rodizio =
        document.getElementById('listaRodizio');

    const prioritarios =
        document.getElementById(
            'listaPrioritarios'
        );

    rodizio.replaceChildren();
    prioritarios.replaceChildren();

    [...motoristas]
        .sort((a, b) =>
            a.nome.localeCompare(b.nome)
        )
        .forEach(motorista => {
            const option =
                document.createElement('option');

            option.value = motorista.id;
            option.textContent =
                `${motorista.nome} (${motorista.veiculo})`;

            (
                motorista.prioridade
                    ? prioritarios
                    : rodizio
            ).appendChild(option);
        });
}

function selecionarTodos(id) {
    const select =
        document.getElementById(id);

    [...select.options].forEach(option => {
        option.selected = true;
    });
}

async function atualizarPrioridade(valor) {
    const selecionados = [
        ...document
            .getElementById('listaRodizio')
            .selectedOptions,

        ...document
            .getElementById('listaPrioritarios')
            .selectedOptions
    ];

    const ids =
        selecionados.map(item => item.value);

    if (!ids.length) {
        mostrarToast(
            'Selecione um motorista.',
            'error'
        );

        return;
    }

    const { error } =
        await supabaseClient
            .from('motoristas')
            .update({
                prioridade: valor,
                updated_at: new Date().toISOString()
            })
            .in('id', ids);

    if (error) {
        mostrarToast(error.message, 'error');
        return;
    }

    await carregarMotoristas();

    renderizarMotoristas();
    renderizarPrioridades();
}

function moverParaPrioridade() {
    atualizarPrioridade(true);
}

function moverParaRodizio() {
    atualizarPrioridade(false);
}

/*
========================================================
INDISPONIBILIDADES
========================================================
*/

function renderizarIndisponibilidades() {
    const container =
        document.getElementById(
            'listaMotoristasIndisponiveis'
        );

    const data =
        document.getElementById(
            'dataEscala'
        ).value;

    container.replaceChildren();

    motoristas.forEach(motorista => {
        const linha =
            document.createElement('div');

        linha.className = 'checkbox-item';

        const label =
            document.createElement('label');

        const checkbox =
            document.createElement('input');

        checkbox.type = 'checkbox';

        checkbox.checked =
            (indisponibilidades[data] || [])
                .includes(motorista.id);

        checkbox.onchange = () =>
            alterarIndisponibilidade(
                data,
                motorista.id,
                checkbox.checked
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

async function alterarIndisponibilidade(
    data,
    motoristaId,
    indisponivel
) {
    if (indisponivel) {
        const { error } =
            await supabaseClient
                .from('indisponibilidades')
                .upsert(
                    {
                        data,
                        motorista_id: motoristaId
                    },
                    {
                        onConflict:
                            'data,motorista_id'
                    }
                );

        if (error) {
            mostrarToast(
                error.message,
                'error'
            );
        }
    } else {
        const { error } =
            await supabaseClient
                .from('indisponibilidades')
                .delete()
                .eq('data', data)
                .eq('motorista_id', motoristaId);

        if (error) {
            mostrarToast(
                error.message,
                'error'
            );
        }
    }

    await carregarIndisponibilidades();
}

/*
========================================================
ESCALAS
========================================================
*/

function carregarEscalaData() {
    const data =
        document.getElementById(
            'dataEscala'
        ).value;

    const escala = escalas[data];

    document
        .getElementById('painelEscala')
        .hidden = !escala;

    if (!escala) return;

    document
        .getElementById('vagasUtilitario')
        .value = escala.vagas.utilitario;

    document
        .getElementById('vagasVan')
        .value = escala.vagas.van;

    document
        .getElementById('vagasPasseio')
        .value = escala.vagas.passeio;

    renderizarTabelaEscala(
        escala.itens,
        escala.status
    );
}

async function gerarPrevia() {
    const data =
        document.getElementById(
            'dataEscala'
        ).value;

    if (!data) {
        mostrarToast(
            'Selecione uma data.',
            'error'
        );

        return;
    }

    const vagas = {
        utilitario: Number(
            document.getElementById(
                'vagasUtilitario'
            ).value
        ),

        van: Number(
            document.getElementById(
                'vagasVan'
            ).value
        ),

        passeio: Number(
            document.getElementById(
                'vagasPasseio'
            ).value
        )
    };

    if (
        Object.values(vagas).some(item =>
            !Number.isInteger(item) ||
            item < 0
        )
    ) {
        mostrarToast(
            'Informe quantidades válidas.',
            'error'
        );

        return;
    }

    const indisponiveis =
        indisponibilidades[data] || [];

    const disponiveis =
        motoristas
            .filter(motorista =>
                !motorista.prioridade &&
                !indisponiveis.includes(motorista.id)
            );

    const usados = new Set();
    const itens = [];

    const tipos = [
        ['utilitario', 'Utilitário'],
        ['van', 'Van'],
        ['passeio', 'Carro de Passeio']
    ];

    tipos.forEach(([campo, veiculo]) => {
        const quantidade = vagas[campo];

        for (let i = 0; i < quantidade; i++) {
            const motorista =
                disponiveis.find(item =>
                    item.veiculo === veiculo &&
                    !usados.has(item.id)
                );

            if (motorista) {
                usados.add(motorista.id);
            }

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
                status: motorista
                    ? 'ativo'
                    : 'vago'
            });
        }
    });

    let escalaId = escalas[data]?.id;

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

        if (error) {
            mostrarToast(
                error.message,
                'error'
            );

            return;
        }
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

        if (error) {
            mostrarToast(
                error.message,
                'error'
            );

            return;
        }

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
        'prévia'
    );

    document
        .getElementById('painelEscala')
        .hidden = false;

    mostrarToast(
        'Prévia gerada com sucesso.',
        'success'
    );
}

function renderizarTabelaEscala(itens, status) {
    const tbody =
        document.getElementById(
            'tabelaEscalaBody'
        );

    tbody.replaceChildren();

    const tag =
        document.getElementById(
            'tagStatus'
        );

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

    const data =
        document.getElementById(
            'dataEscala'
        ).value;

    document
        .getElementById('dataSubtituloImagem')
        .textContent =
        `Data: ${data.split('-').reverse().join('/')}`;

    itens.forEach((item, index) => {
        const tr =
            document.createElement('tr');

        const cancelado =
            item.status === 'cancelado' ||
            item.status === 'cancelado_amazon';

        if (cancelado) {
            tr.className = 'row-cancelada';
        }

        const tdDsp =
            document.createElement('td');

        tdDsp.textContent = item.dsp;

        const tdNome =
            document.createElement('td');

        tdNome.textContent = item.nome;

        const tdVeiculo =
            document.createElement('td');

        tdVeiculo.textContent = item.veiculo;

        const tdOnda =
            document.createElement('td');

        const onda =
            document.createElement('input');

        onda.className = 'input-onda';
        onda.value = item.onda || '';
        onda.placeholder = 'HH:MM';

        onda.onchange = () =>
            atualizarOnda(
                index,
                onda.value
            );

        tdOnda.appendChild(onda);

        const tdAcoes =
            document.createElement('td');

        const botao =
            document.createElement('button');

        botao.className =
            cancelado
                ? 'btn btn-success btn-icon'
                : 'btn btn-danger btn-icon';

        botao.textContent =
            cancelado ? '✅' : '❌';

        botao.onclick = () =>
            cancelado
                ? ativarRota(index)
                : cancelarRota(index);

        tdAcoes.appendChild(botao);

        tr.append(
            tdDsp,
            tdNome,
            tdVeiculo,
            tdOnda,
            tdAcoes
        );

        tbody.appendChild(tr);
    });
}

async function atualizarOnda(index, valor) {
    const data =
        document.getElementById(
            'dataEscala'
        ).value;

    const escala = escalas[data];

    if (!escala?.itens[index]) return;

    escala.itens[index].onda =
        valor.trim();

    await salvarItensEscala(data);
}

async function cancelarRota(index) {
    const data =
        document.getElementById(
            'dataEscala'
        ).value;

    const item =
        escalas[data]?.itens[index];

    if (!item?.motoristaId) {
        mostrarToast(
            'Esta vaga não possui motorista.',
            'error'
        );

        return;
    }

    if (!confirm(
        `Cancelar a rota de ${item.nome}?`
    )) {
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

    if (telefone.length >= 10) {
        const mensagem =
            encodeURIComponent(
                MENSAGEM_CANCELAMENTO_AMAZON
            );

        window.open(
            `https://wa.me/${telefone}?text=${mensagem}`,
            '_blank',
            'noopener,noreferrer'
        );
    }
}

async function ativarRota(index) {
    const data =
        document.getElementById(
            'dataEscala'
        ).value;

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
        'A prévia já está salva.',
        'success'
    );
}

async function confirmarDefinitiva() {
    const data =
        document.getElementById(
            'dataEscala'
        ).value;

    const escala = escalas[data];

    if (!escala) return;

    if (!confirm(
        'Confirmar esta escala como definitiva?'
    )) {
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
            error.message,
            'error'
        );

        return;
    }

    await carregarEscalas();

    renderizarTabelaEscala(
        escalas[data].itens,
        'definitiva'
    );

    mostrarToast(
        'Escala confirmada.',
        'success'
    );
}

async function excluirEscalaAtual() {
    const data =
        document.getElementById(
            'dataEscala'
        ).value;

    const escala = escalas[data];

    if (!escala) return;

    if (!confirm(
        'Excluir a escala desta data?'
    )) {
        return;
    }

    const { error } =
        await supabaseClient
            .from('escalas')
            .delete()
            .eq('id', escala.id);

    if (error) {
        mostrarToast(
            error.message,
            'error'
        );

        return;
    }

    delete escalas[data];

    document
        .getElementById('painelEscala')
        .hidden = true;

    mostrarToast(
        'Escala excluída.',
        'success'
    );
}

/*
========================================================
EXPORTAÇÃO
========================================================
*/

function exportarExcel() {
    const data =
        document.getElementById(
            'dataEscala'
        ).value;

    const escala = escalas[data];

    if (!escala) return;

    const dados =
        escala.itens.map(item => ({
            DSP: item.dsp,
            Motorista: item.nome,
            Telefone: item.telefone,
            Veículo: item.veiculo,
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
    const dados =
        motoristas.map(item => ({
            Nome: item.nome,
            Telefone: item.telefone,
            Veículo: item.veiculo,
            Prioridade: item.prioridade
                ? 'SIM'
                : 'NÃO'
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
        `motoristas_${obterDataISO()}.xlsx`
    );
}

async function importarExcel(event) {
    const arquivo =
        event.target.files?.[0];

    if (!arquivo) return;

    try {
        const buffer =
            await arquivo.arrayBuffer();

        const workbook =
            XLSX.read(buffer, {
                type: 'array'
            });

        const planilha =
            workbook.Sheets[
                workbook.SheetNames[0]
            ];

        const linhas =
            XLSX.utils.sheet_to_json(planilha);

        for (const linha of linhas) {
            const nome =
                String(
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

                    veiculo:
                        linha.Veículo ||
                        linha.Veiculo ||
                        'Utilitário',

                    prioridade:
                        String(
                            linha.Prioridade ||
                            ''
                        ).toUpperCase() === 'SIM'
                });
        }

        await carregarMotoristas();

        renderizarMotoristas();
        renderizarPrioridades();

        mostrarToast(
            'Importação concluída.',
            'success'
        );
    } catch (error) {
        mostrarToast(
            error.message,
            'error'
        );
    }

    event.target.value = '';
}

function gerarImagemEscalaECompartilhar() {
    const area =
        document.getElementById(
            'areaCapturaImagem'
        );

    if (!area) return;

    html2canvas(area, {
        scale: 2
    }).then(canvas => {
        const link =
            document.createElement('a');

        const data =
            document.getElementById(
                'dataEscala'
            ).value;

        link.download =
            `escala_betaxlog_${data}.png`;

        link.href =
            canvas.toDataURL('image/png');

        link.click();
    });
}

function compartilharWhatsAppTexto() {
    const data =
        document.getElementById(
            'dataEscala'
        ).value;

    const escala = escalas[data];

    if (!escala) {
        mostrarToast(
            'Não existe escala para esta data.',
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
                'Escala copiada para a área de transferência.',
                'success'
            );

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

/*
========================================================
RELATÓRIOS
========================================================
*/

function aplicarAtalhoPeriodo() {
    const atalho =
        document.getElementById(
            'filtroAtalhoPeriodo'
        ).value;

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
        inicio.setDate(
            hoje.getDate() - 7
        );
    }

    if (atalho === 'semestral') {
        inicio.setMonth(
            hoje.getMonth() - 6
        );
    }

    if (atalho === 'anual') {
        inicio = new Date(
            hoje.getFullYear(),
            0,
            1
        );
    }

    if (!atalho) return;

    document
        .getElementById('relatorioDataInicio')
        .value = obterDataISO(inicio);

    document
        .getElementById('relatorioDataFim')
        .value = obterDataISO(hoje);
}

function gerarRelatorioHistorico() {
    const inicioTexto =
        document.getElementById(
            'relatorioDataInicio'
        ).value;

    const fimTexto =
        document.getElementById(
            'relatorioDataFim'
        ).value;

    if (!inicioTexto || !fimTexto) return;

    const inicio =
        converterData(inicioTexto);

    const fim =
        converterData(fimTexto);

    fim.setHours(23, 59, 59, 999);

    const historico =
        historicoExecucoes.filter(item => {
            const data =
                converterData(item.data);

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

    document
        .getElementById('kpiTotalRotas')
        .textContent = total;

    document
        .getElementById('kpiRotasAtivas')
        .textContent = ativas;

    document
        .getElementById('kpiRotasCanceladas')
        .textContent = canceladas;

    document
        .getElementById('kpiTaxaSucesso')
        .textContent =
        `${total ? ((ativas / total) * 100).toFixed(1) : 0}%`;

    const tbody =
        document.getElementById(
            'tabelaRankingBody'
        );

    tbody.replaceChildren();

    Object.values(ranking)
        .sort((a, b) =>
            b.escaladas - a.escaladas
        )
        .forEach(item => {
            const tr =
                document.createElement('tr');

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
        document.getElementById(
            'chartEvolucao'
        );

    if (canvasEvolucao) {
        chartEvolucaoInstancia?.destroy();

        chartEvolucaoInstancia =
            new Chart(canvasEvolucao, {
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
            });
    }

    const canvasVeiculos =
        document.getElementById(
            'chartVeiculos'
        );

    if (canvasVeiculos) {
        chartVeiculosInstancia?.destroy();

        chartVeiculosInstancia =
            new Chart(canvasVeiculos, {
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
            });
    }
}

function exportarRelatorioPDF() {
    if (!window.jspdf) {
        mostrarToast(
            'Biblioteca PDF não carregada.',
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
        `relatorio_betaxlog_${obterDataISO()}.pdf`
    );
}

/*
========================================================
ADMINISTRAÇÃO
========================================================
*/

function abrirModalAdmin() {
    if (usuarioLogado?.role !== 'admin') {
        mostrarToast(
            'Acesso restrito ao administrador.',
            'error'
        );

        return;
    }

    document
        .getElementById('listaUsuariosCadastrados')
        .textContent =
        `${usuarioLogado.nome} · ` +
        `${usuarioLogado.email} · ` +
        `${usuarioLogado.role}`;

    document
        .getElementById('modalAdmin')
        .hidden = false;
}

function fecharModalAdmin() {
    document
        .getElementById('modalAdmin')
        .hidden = true;
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
        'Excluir todas as escalas e arquivar motoristas?'
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
            .update({
                ativo: false
            })
            .eq('ativo', true);

    if (erroMotoristas) {
        mostrarToast(
            erroMotoristas.message,
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
            erroEscalas.message,
            'error'
        );

        return;
    }

    motoristas = [];
    escalas = {};
    indisponibilidades = {};
    historicoExecucoes = [];

    renderizarMotoristas();
    renderizarPrioridades();

    document
        .getElementById('painelEscala')
        .hidden = true;

    mostrarToast(
        'Dados operacionais apagados.',
        'success'
    );
}

/*
========================================================
UTILITÁRIOS
========================================================
*/

function obterDataISO(data = new Date()) {
    const ano =
        data.getFullYear();

    const mes =
        String(data.getMonth() + 1)
            .padStart(2, '0');

    const dia =
        String(data.getDate())
            .padStart(2, '0');

    return `${ano}-${mes}-${dia}`;
}

function converterData(valor) {
    const [ano, mes, dia] =
        valor.split('-').map(Number);

    return new Date(
        ano,
        mes - 1,
        dia
    );
}

function structuredCloneSafe(valor) {
    return JSON.parse(
        JSON.stringify(valor)
    );
}

function escapeHtml(valor) {
    return String(valor || '')
        .replaceAll('&', '&')
        .replaceAll('<', '<')
        .replaceAll('>', '>')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function atualizarInfoBackup() {
    document
        .getElementById('infoUltimoBackup')
        .textContent =
        `☁️ Supabase sincronizado em ` +
        `${new Date().toLocaleString('pt-BR')}`;
}

function mostrarToast(mensagem, tipo = '') {
    const container =
        document.getElementById(
            'toastContainer'
        );

    if (!container) {
        alert(mensagem);
        return;
    }

    const toast =
        document.createElement('div');

    toast.className =
        `toast ${tipo}`;

    toast.textContent = mensagem;
    container.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 4000);
}
