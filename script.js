'use strict';

/*
============================================================
CONFIGURAÇÃO DO SUPABASE
============================================================

A URL já está configurada.

A chave abaixo precisa ser substituída pela chave COMPLETA
encontrada em:

Supabase
→ Project Settings
→ API
→ Publishable key

A chave enviada anteriormente estava incompleta porque continha "..".
Não utilize service_role no navegador.
*/

const SUPABASE_URL =
    'https://bnpfdkwjdtnpfmnjoftf.supabase.co';

const SUPABASE_ANON_KEY =
    'COLE_AQUI_A_CHAVE_PUBLICA_COMPLETA_DO_SUPABASE';

let supabaseClient = null;

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
============================================================
INICIALIZAÇÃO
============================================================
*/

window.addEventListener('DOMContentLoaded', iniciarAplicacao);

async function iniciarAplicacao() {
    try {
        if (!window.supabase) {
            esconderLoader();

            mostrarLogin(
                'A biblioteca do Supabase não foi carregada. Verifique o index.html.'
            );

            return;
        }

        if (!configuracaoValida()) {
            esconderLoader();

            mostrarLogin(
                'Cole no script.js a chave pública COMPLETA do Supabase.'
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

        const autenticado =
            await verificarSessao();

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
        renderizarPrioridades();
        renderizarIndisponibilidades();
        carregarEscalaData();
        atualizarInfoBackup();

        esconderLoader();
    } catch (error) {
        console.error(error);

        esconderLoader();

        mostrarLogin(
            `Erro ao iniciar o sistema: ${obterMensagemErro(error)}`
        );
    }
}

function configuracaoValida() {
    const chaveValida =
        SUPABASE_ANON_KEY &&
        !SUPABASE_ANON_KEY.includes('COLE_AQUI') &&
        !SUPABASE_ANON_KEY.includes('SUA_CHAVE') &&
        !SUPABASE_ANON_KEY.includes('..');

    const urlValida =
        SUPABASE_URL &&
        SUPABASE_URL.startsWith('https://') &&
        SUPABASE_URL.includes('.supabase.co');

    return Boolean(urlValida && chaveValida);
}

function esconderLoader() {
    const loader =
        document.getElementById('appLoader');

    if (loader) {
        loader.remove();
    }
}

function obterMensagemErro(error) {
    return error?.message || 'Erro desconhecido.';
}

/*
============================================================
LOGIN SUPABASE AUTH
============================================================
*/

async function verificarSessao() {
    const {
        data: { session },
        error
    } = await supabaseClient.auth.getSession();

    if (error) {
        mostrarLogin(
            `Erro ao consultar o Supabase: ${obterMensagemErro(error)}`
        );

        return false;
    }

    if (!session) {
        mostrarLogin();
        return false;
    }

    const {
        data: perfil,
        error: erroPerfil
    } = await supabaseClient
        .from('profiles')
        .select('id, nome, role, ativo')
        .eq('id', session.user.id)
        .maybeSingle();

    if (erroPerfil) {
        console.error(erroPerfil);

        mostrarLogin(
            'O usuário existe, mas não possui um perfil válido na tabela profiles.'
        );

        return false;
    }

    if (!perfil) {
        mostrarLogin(
            'Crie um registro para este usuário na tabela profiles do Supabase.'
        );

        return false;
    }

    if (perfil.ativo === false) {
        await supabaseClient.auth.signOut();

        mostrarLogin(
            'Este usuário está desativado no sistema.'
        );

        return false;
    }

    usuarioLogado = {
        id: session.user.id,
        email: session.user.email,
        nome: perfil.nome || session.user.email,
        role: perfil.role || 'operador',
        ativo: perfil.ativo
    };

    removerLogin();
    aplicarPermissoes();

    const campoUsuario =
        document.getElementById('usuarioAtual');

    if (campoUsuario) {
        campoUsuario.textContent =
            `${usuarioLogado.nome} · ${usuarioLogado.role}`;
    }

    return true;
}

function mostrarLogin(mensagem = '') {
    let overlay =
        document.getElementById('modalLoginOverlay');

    if (!overlay) {
        overlay =
            document.createElement('div');

        overlay.id =
            'modalLoginOverlay';

        overlay.className =
            'login-overlay';

        overlay.innerHTML = `
            <div class="login-card">
                <div class="login-brand">
                    <span class="brand-icon">🚛</span>
                    <h1>BETAXLOG</h1>
                </div>

                <p class="login-subtitle">
                    Acesso seguro pelo Supabase Authentication.
                </p>

                <div
                    id="loginMensagem"
                    class="login-message"
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
                    placeholder="Digite sua senha">

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
    }

    overlay.style.display = 'flex';

    const campoMensagem =
        document.getElementById('loginMensagem');

    if (campoMensagem) {
        campoMensagem.textContent = mensagem;
        campoMensagem.hidden = !mensagem;

        if (
            mensagem.includes('chave') ||
            mensagem.includes('Configure') ||
            mensagem.includes('configuração')
        ) {
            campoMensagem.classList.add('info');
        } else {
            campoMensagem.classList.remove('info');
        }
    }
}

function removerLogin() {
    const overlay =
        document.getElementById('modalLoginOverlay');

    if (overlay) {
        overlay.remove();
    }
}

async function executarLogin() {
    if (!supabaseClient) {
        mostrarLogin(
            'O Supabase ainda não foi configurado.'
        );

        return;
    }

    const campoEmail =
        document.getElementById('loginEmail');

    const campoSenha =
        document.getElementById('loginSenha');

    const botao =
        document.getElementById('btnLogin');

    const email =
        campoEmail?.value.trim().toLowerCase() || '';

    const senha =
        campoSenha?.value || '';

    if (!email || !senha) {
        mostrarMensagemLogin(
            'Informe o e-mail e a senha.'
        );

        return;
    }

    botao.disabled = true;
    botao.textContent = 'Entrando...';

    const {
        error
    } = await supabaseClient.auth.signInWithPassword({
        email,
        password: senha
    });

    if (error) {
        console.error(error);

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
    const campo =
        document.getElementById('loginMensagem');

    if (campo) {
        campo.textContent = mensagem;
        campo.hidden = false;
    }
}

function traduzirErroLogin(error) {
    const mensagem =
        String(error?.message || '').toLowerCase();

    if (
        mensagem.includes('invalid login credentials')
    ) {
        return 'E-mail ou senha inválidos.';
    }

    if (
        mensagem.includes('email not confirmed')
    ) {
        return 'O e-mail ainda não foi confirmado no Supabase.';
    }

    if (
        mensagem.includes('failed to fetch')
    ) {
        return 'Não foi possível conectar ao Supabase. Verifique a URL e a chave pública.';
    }

    return error?.message ||
        'Não foi possível realizar o login.';
}

async function fazerLogout() {
    if (!confirm('Deseja sair do sistema?')) {
        return;
    }

    await supabaseClient.auth.signOut();
    window.location.reload();
}

function aplicarPermissoes() {
    const botao =
        document.getElementById('btnPainelAdmin');

    if (!botao) return;

    botao.hidden =
        usuarioLogado?.role !== 'admin';
}

/*
============================================================
DATAS E ABAS
============================================================
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
    if (!valor) return null;

    const partes =
        valor.split('-').map(Number);

    return new Date(
        partes[0],
        partes[1] - 1,
        partes[2]
    );
}

function configurarDatas() {
    const hoje =
        obterDataISO();

    const campoData =
        document.getElementById('dataEscala');

    if (campoData) {
        campoData.value = hoje;
    }

    const inicio =
        document.getElementById(
            'relatorioDataInicio'
        );

    const fim =
        document.getElementById(
            'relatorioDataFim'
        );

    const agora =
        new Date();

    if (inicio) {
        inicio.value =
            obterDataISO(
                new Date(
                    agora.getFullYear(),
                    agora.getMonth(),
                    1
                )
            );
    }

    if (fim) {
        fim.value = hoje;
    }
}

function configurarEventos() {
    const campoData =
        document.getElementById('dataEscala');

    if (campoData) {
        campoData.addEventListener(
            'change',
            async () => {
                await carregarIndisponibilidades();
                renderizarIndisponibilidades();
                carregarEscalaData();
            }
        );
    }

    document.addEventListener(
        'keydown',
        event => {
            if (event.key === 'Escape') {
                fecharModalEdicao();
                fecharModalAdmin();
            }
        }
    );
}

function alternarAba(aba) {
    const views = {
        operacional:
            document.getElementById('viewOperacional'),

        motoristas:
            document.getElementById('viewMotoristas'),

        relatorios:
            document.getElementById('viewRelatorios')
    };

    const botoes = {
        operacional:
            document.getElementById('btnAbaOperacional'),

        motoristas:
            document.getElementById('btnAbaMotoristas'),

        relatorios:
            document.getElementById('btnAbaRelatorios')
    };

    Object.values(views).forEach(view => {
        if (view) view.hidden = true;
    });

    Object.values(botoes).forEach(botao => {
        if (botao) botao.classList.remove('active');
    });

    views[aba].hidden = false;
    botoes[aba].classList.add('active');

    if (aba === 'relatorios') {
        gerarRelatorioHistorico();
    }
}

/*
============================================================
MOTORISTAS - SUPABASE
============================================================
*/

async function carregarMotoristas() {
    const {
        data,
        error
    } = await supabaseClient
        .from('motoristas')
        .select('*')
        .eq('ativo', true)
        .order('nome');

    if (error) {
        throw error;
    }

    motoristas = data || [];
}

function renderizarMotoristas() {
    const lista =
        document.getElementById(
            'listaMotoristasCheck'
        );

    if (!lista) return;

    const filtro =
        document.getElementById(
            'filtroMotorista'
        )?.value.toLowerCase() || '';

    lista.replaceChildren();

    const filtrados =
        motoristas.filter(motorista =>
            motorista.nome
                .toLowerCase()
                .includes(filtro)
        );

    document
        .getElementById('contadorTotalMotoristas')
        .textContent =
        `Total: ${motoristas.length}`;

    if (!filtrados.length) {
        const vazio =
            document.createElement('p');

        vazio.className = 'helper-text';
        vazio.textContent =
            'Nenhum motorista encontrado.';

        lista.appendChild(vazio);
        return;
    }

    filtrados.forEach(motorista => {
        const item =
            document.createElement('div');

        item.className =
            'checkbox-item';

        const texto =
            document.createElement('span');

        texto.textContent =
            `${motorista.nome} · ${motorista.veiculo}`;

        const botoes =
            document.createElement('span');

        const editar =
            document.createElement('button');

        editar.className =
            'btn btn-secondary btn-icon';

        editar.type = 'button';
        editar.textContent = '✏️';

        editar.onclick = () =>
            abrirEdicaoMotorista(motorista.id);

        const excluir =
            document.createElement('button');

        excluir.className =
            'btn btn-danger btn-icon';

        excluir.type = 'button';
        excluir.textContent = '🗑️';

        excluir.onclick = () =>
            excluirMotorista(motorista.id);

        botoes.append(editar, excluir);
        item.append(texto, botoes);
        lista.appendChild(item);
    });
}

async function cadastrarMotorista() {
    const nome =
        document.getElementById(
            'nomeMotorista'
        ).value.trim();

    const telefone =
        document.getElementById(
            'telMotorista'
        ).value.trim();

    const veiculo =
        document.getElementById(
            'tipoVeiculo'
        ).value;

    if (!nome) {
        mostrarToast(
            'Informe o nome do motorista.',
            'error'
        );

        return;
    }

    const {
        error
    } = await supabaseClient
        .from('motoristas')
        .insert({
            nome,
            telefone,
            veiculo,
            prioridade: false,
            ativo: true
        });

    if (error) {
        mostrarToast(
            error.message,
            'error'
        );

        return;
    }

    document.getElementById(
        'nomeMotorista'
    ).value = '';

    document.getElementById(
        'telMotorista'
    ).value = '';

    await carregarMotoristas();

    renderizarMotoristas();
    renderizarPrioridades();

    mostrarToast(
        'Motorista cadastrado.',
        'success'
    );
}

function abrirEdicaoMotorista(id) {
    const motorista =
        motoristas.find(
            item => item.id === id
        );

    if (!motorista) return;

    document.getElementById(
        'editMotoristaId'
    ).value = motorista.id;

    document.getElementById(
        'editNomeMotorista'
    ).value = motorista.nome;

    document.getElementById(
        'editTelMotorista'
    ).value = motorista.telefone || '';

    document.getElementById(
        'editTipoVeiculo'
    ).value = motorista.veiculo;

    document.getElementById(
        'modalEdicao'
    ).hidden = false;
}

function fecharModalEdicao() {
    const modal =
        document.getElementById(
            'modalEdicao'
        );

    if (modal) {
        modal.hidden = true;
    }
}

async function salvarEdicaoMotorista() {
    const id =
        document.getElementById(
            'editMotoristaId'
        ).value;

    const nome =
        document.getElementById(
            'editNomeMotorista'
        ).value.trim();

    const telefone =
        document.getElementById(
            'editTelMotorista'
        ).value.trim();

    const veiculo =
        document.getElementById(
            'editTipoVeiculo'
        ).value;

    if (!id || !nome) {
        mostrarToast(
            'Preencha os dados obrigatórios.',
            'error'
        );

        return;
    }

    const {
        error
    } = await supabaseClient
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
            error.message,
            'error'
        );

        return;
    }

    fecharModalEdicao();

    await carregarMotoristas();

    renderizarMotoristas();
    renderizarPrioridades();

    mostrarToast(
        'Motorista atualizado.',
        'success'
    );
}

async function excluirMotorista(id) {
    const motorista =
        motoristas.find(
            item => item.id === id
        );

    if (!motorista) return;

    if (!confirm(
        `Arquivar o motorista ${motorista.nome}?`
    )) {
        return;
    }

    const {
        error
    } = await supabaseClient
        .from('motoristas')
        .update({
            ativo: false,
            updated_at: new Date().toISOString()
        })
        .eq('id', id);

    if (error) {
        mostrarToast(
            error.message,
            'error'
        );

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
============================================================
PRIORIDADE E RODÍZIO
============================================================
*/

function renderizarPrioridades() {
    const rodizio =
        document.getElementById(
            'listaRodizio'
        );

    const prioritarios =
        document.getElementById(
            'listaPrioritarios'
        );

    if (!rodizio || !prioritarios) return;

    rodizio.replaceChildren();
    prioritarios.replaceChildren();

    motoristas.forEach(motorista => {
        const option =
            document.createElement('option');

        option.value = motorista.id;
        option.textContent = motorista.nome;

        if (motorista.prioridade) {
            prioritarios.appendChild(option);
        } else {
            rodizio.appendChild(option);
        }
    });
}

function selecionarTodos(id) {
    const select =
        document.getElementById(id);

    if (!select) return;

    Array.from(select.options)
        .forEach(option => {
            option.selected = true;
        });
}

async function moverParaPrioridade() {
    await alterarPrioridadeSelecionados(
        'listaRodizio',
        true
    );
}

async function moverParaRodizio() {
    await alterarPrioridadeSelecionados(
        'listaPrioritarios',
        false
    );
}

async function alterarPrioridadeSelecionados(
    origemId,
    prioridade
) {
    const select =
        document.getElementById(origemId);

    const ids =
        Array.from(select.selectedOptions)
            .map(option => option.value);

    if (!ids.length) return;

    const {
        error
    } = await supabaseClient
        .from('motoristas')
        .update({
            prioridade,
            updated_at: new Date().toISOString()
        })
        .in(
            'id',
            ids
        );

    if (error) {
        mostrarToast(
            error.message,
            'error'
        );

        return;
    }

    await carregarMotoristas();
    renderizarMotoristas();
    renderizarPrioridades();
}

/*
============================================================
INDISPONIBILIDADE
============================================================
*/

async function carregarIndisponibilidades() {
    const data =
        document.getElementById(
            'dataEscala'
        )?.value;

    if (!data) return;

    const {
        data: registros,
        error
    } = await supabaseClient
        .from('indisponibilidades')
        .select('motorista_id')
        .eq('data', data);

    if (error) {
        console.error(error);
        return;
    }

    indisponibilidades[data] =
        (registros || [])
            .map(item => item.motorista_id);
}

function renderizarIndisponibilidades() {
    const lista =
        document.getElementById(
            'listaMotoristasIndisponiveis'
        );

    const data =
        document.getElementById(
            'dataEscala'
        )?.value;

    if (!lista || !data) return;

    lista.replaceChildren();

    const indisponiveis =
        indisponibilidades[data] || [];

    motoristas.forEach(motorista => {
        const item =
            document.createElement('div');

        item.className =
            'checkbox-item';

        const label =
            document.createElement('label');

        const checkbox =
            document.createElement('input');

        checkbox.type = 'checkbox';
        checkbox.checked =
            indisponiveis.includes(
                motorista.id
            );

        checkbox.addEventListener(
            'change',
            event =>
                alterarIndisponibilidade(
                    data,
                    motorista.id,
                    event.target.checked
                )
        );

        const texto =
            document.createElement('span');

        texto.textContent =
            motorista.nome;

        label.append(checkbox, texto);
        item.appendChild(label);
        lista.appendChild(item);
    });
}

async function alterarIndisponibilidade(
    data,
    motoristaId,
    indisponivel
) {
    if (indisponivel) {
        const {
            error
        } = await supabaseClient
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

            return;
        }
    } else {
        const {
            error
        } = await supabaseClient
            .from('indisponibilidades')
            .delete()
            .eq('data', data)
            .eq('motorista_id', motoristaId);

        if (error) {
            mostrarToast(
                error.message,
                'error'
            );

            return;
        }
    }

    await carregarIndisponibilidades();
}

/*
============================================================
ESCALAS
============================================================
*/

async function carregarEscalas() {
    const {
        data,
        error
    } = await supabaseClient
        .from('escalas')
        .select(`
            *,
            escala_itens(*)
        `)
        .order(
            'data',
            {
                ascending: false
            }
        );

    if (error) {
        throw error;
    }

    escalas = {};
    historicoExecucoes = [];

    (data || []).forEach(escala => {
        const itens =
            (escala.escala_itens || [])
                .sort(
                    (a, b) =>
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
                utilitario:
                    escala.vagas_utilitario,

                van:
                    escala.vagas_van,

                passeio:
                    escala.vagas_passeio
            },
            itens
        };

        if (escala.status === 'definitiva') {
            historicoExecucoes.push({
                data: escala.data,
                itens:
                    JSON.parse(
                        JSON.stringify(itens)
                    )
            });
        }
    });
}

function carregarEscalaData() {
    const data =
        document.getElementById(
            'dataEscala'
        )?.value;

    const escala = escalas[data];

    const painel =
        document.getElementById(
            'painelEscala'
        );

    if (!painel) return;

    if (!escala) {
        painel.hidden = true;
        return;
    }

    document.getElementById(
        'vagasUtilitario'
    ).value =
        escala.vagas.utilitario;

    document.getElementById(
        'vagasVan'
    ).value =
        escala.vagas.van;

    document.getElementById(
        'vagasPasseio'
    ).value =
        escala.vagas.passeio;

    painel.hidden = false;

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
            'Informe a data da escala.',
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

    const indisponiveis =
        indisponibilidades[data] || [];

    const disponiveis =
        motoristas.filter(motorista =>
            !indisponiveis.includes(
                motorista.id
            )
        );

    const tipos = [
        {
            nome: 'Utilitário',
            quantidade: vagas.utilitario
        },
        {
            nome: 'Van',
            quantidade: vagas.van
        },
        {
            nome: 'Carro de Passeio',
            quantidade: vagas.passeio
        }
    ];

    const itens = [];
    const usados = new Set();

    tipos.forEach(tipo => {
        for (
            let index = 0;
            index < tipo.quantidade;
            index++
        ) {
            const motorista =
                disponiveis.find(item =>
                    item.veiculo === tipo.nome &&
                    !item.prioridade &&
                    !usados.has(item.id)
                ) ||
                disponiveis.find(item =>
                    item.veiculo === tipo.nome &&
                    !usados.has(item.id)
                );

            if (motorista) {
                usados.add(motorista.id);

                itens.push({
                    ordem: itens.length,
                    dsp: 'BETAXLOG',
                    nome: motorista.nome,
                    telefone: motorista.telefone || '',
                    motoristaId: motorista.id,
                    veiculo: motorista.veiculo,
                    onda: '',
                    status: 'ativo'
                });
            } else {
                itens.push({
                    ordem: itens.length,
                    dsp: 'BETAXLOG',
                    nome: 'VAGA SEM MOTORISTA',
                    telefone: '',
                    motoristaId: null,
                    veiculo: tipo.nome,
                    onda: '',
                    status: 'vago'
                });
            }
        }
    });

    const existente =
        escalas[data];

    let escalaId =
        existente?.id;

    if (escalaId) {
        const {
            error
        } = await supabaseClient
            .from('escalas')
            .update({
                status: 'prévia',
                vagas_utilitario:
                    vagas.utilitario,
                vagas_van:
                    vagas.van,
                vagas_passeio:
                    vagas.passeio,
                updated_at:
                    new Date().toISOString()
            })
            .eq('id', escalaId);

        if (error) {
            mostrarToast(
                error.message,
                'error'
            );

            return;
        }

        await supabaseClient
            .from('escala_itens')
            .delete()
            .eq('escala_id', escalaId);
    } else {
        const {
            data: novaEscala,
            error
        } = await supabaseClient
            .from('escalas')
            .insert({
                data,
                status: 'prévia',
                vagas_utilitario:
                    vagas.utilitario,
                vagas_van:
                    vagas.van,
                vagas_passeio:
                    vagas.passeio,
                criado_por:
                    usuarioLogado.id
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

        escalaId =
            novaEscala.id;
    }

    const {
        error: erroItens
    } = await supabaseClient
        .from('escala_itens')
        .insert(
            itens.map(item => ({
                escala_id: escalaId,
                ordem: item.ordem,
                dsp: item.dsp,
                nome_snapshot: item.nome,
                telefone_snapshot:
                    item.telefone,
                motorista_id:
                    item.motoristaId,
                veiculo: item.veiculo,
                onda: item.onda,
                status: item.status
            }))
        );

    if (erroItens) {
        mostrarToast(
            erroItens.message,
            'error'
        );

        return;
    }

    await carregarEscalas();
    carregarEscalaData();

    mostrarToast(
        'Prévia gerada com sucesso.',
        'success'
    );
}

function renderizarTabelaEscala(
    itens,
    status
) {
    const tbody =
        document.getElementById(
            'tabelaEscalaBody'
        );

    if (!tbody) return;

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

    document.getElementById(
        'dataSubtituloImagem'
    ).textContent =
        `Data: ${data.split('-').reverse().join('/')}`;

    itens.forEach((item, index) => {
        const tr =
            document.createElement('tr');

        const cancelado =
            item.status === 'cancelado' ||
            item.status === 'cancelado_amazon';

        if (cancelado) {
            tr.className =
                'row-cancelada';
        }

        const tdDsp =
            document.createElement('td');

        tdDsp.textContent =
            item.dsp;

        const tdNome =
            document.createElement('td');

        tdNome.textContent =
            item.nome;

        const tdVeiculo =
            document.createElement('td');

        tdVeiculo.textContent =
            item.veiculo;

        const tdOnda =
            document.createElement('td');

        const onda =
            document.createElement('input');

        onda.className =
            'input-onda';

        onda.value =
            item.onda || '';

        onda.placeholder =
            'HH:MM';

        onda.addEventListener(
            'change',
            () =>
                atualizarOnda(
                    index,
                    onda.value
                )
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

        botao.onclick =
            () =>
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

async function salvarItensEscala(data) {
    const escala =
        escalas[data];

    if (!escala) return;

    await supabaseClient
        .from('escala_itens')
        .delete()
        .eq('escala_id', escala.id);

    const itens =
        escala.itens.map((item, index) => ({
            escala_id: escala.id,
            ordem: index,
            dsp: item.dsp,
            nome_snapshot: item.nome,
            telefone_snapshot: item.telefone || '',
            motorista_id: item.motoristaId,
            veiculo: item.veiculo,
            onda: item.onda || '',
            status: item.status
        }));

    const {
        error
    } = await supabaseClient
        .from('escala_itens')
        .insert(itens);

    if (error) {
        mostrarToast(
            error.message,
            'error'
        );
    }
}

async function atualizarOnda(index, valor) {
    const data =
        document.getElementById(
            'dataEscala'
        ).value;

    if (!escalas[data]?.itens[index]) {
        return;
    }

    escalas[data].itens[index].onda =
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

    item.status =
        'cancelado_amazon';

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

    item.status =
        'ativo';

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
        document.getElementById(
            'dataEscala'
        ).value;

    const escala =
        escalas[data];

    if (!escala) return;

    if (!confirm(
        'Confirmar esta escala como definitiva?'
    )) {
        return;
    }

    const {
        error
    } = await supabaseClient
        .from('escalas')
        .update({
            status: 'definitiva',
            updated_at:
                new Date().toISOString()
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
    carregarEscalaData();

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

    const escala =
        escalas[data];

    if (!escala) return;

    if (!confirm(
        'Excluir a escala desta data?'
    )) {
        return;
    }

    const {
        error
    } = await supabaseClient
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
============================================================
EXPORTAÇÕES
============================================================
*/

function exportarExcel() {
    const data =
        document.getElementById(
            'dataEscala'
        ).value;

    const escala =
        escalas[data];

    if (!escala) return;

    const dados =
        escala.itens.map(item => ({
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
    const dados =
        motoristas.map(item => ({
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
            XLSX.utils.sheet_to_json(
                planilha
            );

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
                    telefone:
                        String(
                            linha.Telefone ||
                            linha.telefone ||
                            ''
                        ).trim(),

                    veiculo:
                        linha.Veiculo ||
                        linha.Veículo ||
                        'Utilitário',

                    prioridade:
                        String(
                            linha.Prioridade ||
                            ''
                        ).toUpperCase() === 'SIM',

                    ativo: true
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
            obterMensagemErro(error),
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

    const escala =
        escalas[data];

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
                `• ${item.nome} - ` +
                `${item.veiculo} - ` +
                `Onda: ${item.onda || 'não definida'}\n`;
        });

    navigator.clipboard
        .writeText(texto)
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
            prompt(
                'Copie o texto abaixo:',
                texto
            );
        });
}

/*
============================================================
RELATÓRIOS
============================================================
*/

function aplicarAtalhoPeriodo() {
    const atalho =
        document.getElementById(
            'filtroAtalhoPeriodo'
        ).value;

    const hoje =
        new Date();

    let inicio =
        new Date();

    if (atalho === 'mes_atual') {
        inicio =
            new Date(
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
        inicio =
            new Date(
                hoje.getFullYear(),
                0,
                1
            );
    }

    if (!atalho) return;

    document
        .getElementById('relatorioDataInicio')
        .value =
        obterDataISO(inicio);

    document
        .getElementById('relatorioDataFim')
        .value =
        obterDataISO(hoje);
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

    if (!inicioTexto || !fimTexto) {
        return;
    }

    const inicio =
        converterData(inicioTexto);

    const fim =
        converterData(fimTexto);

    fim.setHours(
        23,
        59,
        59,
        999
    );

    const registros =
        historicoExecucoes.filter(
            execucao => {
                const data =
                    converterData(
                        execucao.data
                    );

                return data >= inicio &&
                    data <= fim;
            }
        );

    let total = 0;
    let ativas = 0;
    let canceladas = 0;

    const ranking = {};

    registros.forEach(execucao => {
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

            ranking[item.motoristaId]
                .escaladas++;

            if (cancelado) {
                ranking[item.motoristaId]
                    .canceladas++;
            }
        });
    });

    document
        .getElementById('kpiTotalRotas')
        .textContent =
        total;

    document
        .getElementById('kpiRotasAtivas')
        .textContent =
        ativas;

    document
        .getElementById('kpiRotasCanceladas')
        .textContent =
        canceladas;

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
        .sort(
            (a, b) =>
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

                td.textContent =
                    valor;

                tr.appendChild(td);
            });

            tbody.appendChild(tr);
        });

    atualizarGraficos(registros);
}

function atualizarGraficos(registros) {
    const datas = {};
    const veiculos = {
        'Utilitário': 0,
        'Van': 0,
        'Carro de Passeio': 0
    };

    registros.forEach(execucao => {
        datas[execucao.data] =
            execucao.itens.filter(
                item =>
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

    if (canvasEvolucao && window.Chart) {
        if (chartEvolucaoInstancia) {
            chartEvolucaoInstancia.destroy();
        }

        chartEvolucaoInstancia =
            new Chart(
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
        document.getElementById(
            'chartVeiculos'
        );

    if (canvasVeiculos && window.Chart) {
        if (chartVeiculosInstancia) {
            chartVeiculosInstancia.destroy();
        }

        chartVeiculosInstancia =
            new Chart(
                canvasVeiculos,
                {
                    type: 'doughnut',
                    data: {
                        labels:
                            Object.keys(veiculos),
                        datasets: [{
                            data:
                                Object.values(veiculos),
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
            'Biblioteca PDF não carregada.',
            'error'
        );

        return;
    }

    const {
        jsPDF
    } = window.jspdf;

    const documento =
        new jsPDF();

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
============================================================
ADMINISTRAÇÃO
============================================================
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
        .getElementById(
            'listaUsuariosCadastrados'
        )
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
        'Arquivar motoristas e excluir todas as escalas?'
    )) {
        return;
    }

    if (prompt(
        'Digite APAGAR para confirmar:'
    ) !== 'APAGAR') {
        return;
    }

    const {
        error: erroMotoristas
    } = await supabaseClient
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

    const {
        error: erroEscalas
    } = await supabaseClient
        .from('escalas')
        .delete()
        .not(
            'id',
            'is',
            null
        );

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
============================================================
UTILITÁRIOS
============================================================
*/

function atualizarInfoBackup() {
    const campo =
        document.getElementById(
            'infoUltimoBackup'
        );

    if (campo) {
        campo.textContent =
            `☁️ Supabase sincronizado em ` +
            `${new Date().toLocaleString('pt-BR')}`;
    }
}

function mostrarToast(
    mensagem,
    tipo = ''
) {
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

    toast.textContent =
        mensagem;

    container.appendChild(toast);

    setTimeout(
        () => toast.remove(),
        4500
    );
}
