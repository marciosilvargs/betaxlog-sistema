'use strict';

/*
============================================================
CONFIGURAÇÃO DO SUPABASE
============================================================

A URL do seu projeto é esta:

https://bnpfdkwjdtnpfmnjoftf.supabase.co

Cole abaixo a chave pública COMPLETA do Supabase.

Localização:
Supabase
→ Project Settings
→ API
→ Publishable key

Nunca coloque aqui a chave service_role.
*/

const SUPABASE_URL =
    'https://bnpfdkwjdtnpfmnjoftf.supabase.co';

const SUPABASE_ANON_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJucGZka3dqZHRucGZtbmpvZnRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1NzMxNzcsImV4cCI6MjEwNDE0OTE3N30.5ksgMBijxazAtCtse-Lb5MqmaxcL22dVqKBMrnjSYMA';

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

const MENSAGEM_PREVIA_NAO_SALVA =
    'Esta prévia ainda não foi salva. Clique em "Salvar prévia" antes de continuar.';

/*
============================================================
INICIALIZAÇÃO
============================================================
*/

window.addEventListener(
    'DOMContentLoaded',
    iniciarAplicacao
);

async function iniciarAplicacao() {
    try {
        if (!configuracaoValida()) {
            esconderLoader();

            criarTelaLogin(
                'Configure a URL e a chave pública completa do Supabase no arquivo script.js.'
            );

            return;
        }

        if (!window.supabase) {
            esconderLoader();

            criarTelaLogin(
                'A biblioteca do Supabase não foi carregada. Verifique o index.html.'
            );

            return;
        }

        supabaseClient =
            window.supabase.createClient(
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
            await verificarSessaoLogin();

        if (!autenticado) {
            esconderLoader();
            return;
        }

        configurarEventos();
        configurarDatas();

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

        criarTelaLogin(
            `Erro ao iniciar o sistema: ${obterMensagemErro(error)}`
        );
    }
}

function configuracaoValida() {
    return (
        SUPABASE_URL.includes('supabase.co') &&
        SUPABASE_ANON_KEY &&
        !SUPABASE_ANON_KEY.includes('COLE_AQUI') &&
        !SUPABASE_ANON_KEY.includes('SUA_CHAVE')
    );
}

function esconderLoader() {
    const loader =
        document.getElementById('appLoader');

    if (loader) {
        loader.remove();
    }
}

/*
============================================================
LOGIN SUPABASE
============================================================
*/

async function verificarSessaoLogin() {
    const {
        data: { session },
        error
    } = await supabaseClient.auth.getSession();

    if (error) {
        criarTelaLogin(
            `Erro ao consultar o Supabase: ${obterMensagemErro(error)}`
        );

        return false;
    }

    if (!session) {
        criarTelaLogin();
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

        criarTelaLogin(
            'O usuário entrou, mas o perfil não foi encontrado na tabela profiles.'
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

    const campoUsuario =
        document.getElementById('usuarioAtual');

    if (campoUsuario) {
        campoUsuario.textContent =
            `${usuarioLogado.nome} · ${usuarioLogado.role}`;
    }

    aplicarPermissoesDeAcesso();

    return true;
}

function criarTelaLogin(mensagem = '') {
    let overlay =
        document.getElementById(
            'modalLoginOverlay'
        );

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

                <p>
                    Acesso seguro pelo Supabase Authentication.
                </p>

                <div
                    id="loginMensagem"
                    class="login-error"
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
                    id="btnEntrar"
                    class="btn btn-primary"
                    type="button">
                    Entrar
                </button>
            </div>
        `;

        document.body.appendChild(overlay);

        document
            .getElementById('btnEntrar')
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

    overlay.style.display =
        'flex';

    mostrarMensagemLogin(mensagem);
}

async function executarLogin() {
    const email =
        document.getElementById(
            'loginEmail'
        )?.value.trim();

    const senha =
        document.getElementById(
            'loginSenha'
        )?.value;

    if (!email || !senha) {
        mostrarMensagemLogin(
            'Informe o e-mail e a senha.'
        );

        return;
    }

    const botao =
        document.getElementById('btnEntrar');

    botao.disabled = true;
    botao.textContent = 'Entrando...';

    const {
        error
    } = await supabaseClient.auth.signInWithPassword({
        email,
        password: senha
    });

    botao.disabled = false;
    botao.textContent = 'Entrar';

    if (error) {
        mostrarMensagemLogin(
            'E-mail ou senha inválidos.'
        );

        console.error(error);
        return;
    }

    window.location.reload();
}

function mostrarMensagemLogin(mensagem) {
    const campo =
        document.getElementById(
            'loginMensagem'
        );

    if (!campo) return;

    campo.textContent =
        mensagem || '';

    campo.hidden =
        !mensagem;
}

function removerTelaLogin() {
    const overlay =
        document.getElementById(
            'modalLoginOverlay'
        );

    if (overlay) {
        overlay.remove();
    }
}

async function fazerLogout() {
    if (!confirm('Deseja realmente sair?')) {
        return;
    }

    await supabaseClient.auth.signOut();
    window.location.reload();
}

function aplicarPermissoesDeAcesso() {
    const botao =
        document.getElementById(
            'btnPainelAdmin'
        );

    if (!botao) return;

    botao.hidden =
        usuarioLogado?.role !== 'admin';
}

/*
============================================================
EVENTOS E DATAS
============================================================
*/

function configurarEventos() {
    const campoData =
        document.getElementById(
            'dataEscala'
        );

    campoData.addEventListener(
        'change',
        async () => {
            await carregarIndisponibilidades();
            renderizarIndisponibilidades();
            carregarEscalaData();
        }
    );
}

function configurarDatas() {
    const hoje =
        obterDataISO();

    const campoData =
        document.getElementById(
            'dataEscala'
        );

    if (campoData && !campoData.value) {
        campoData.value =
            hoje;
    }

    const inicio =
        document.getElementById(
            'relatorioDataInicio'
        );

    const fim =
        document.getElementById(
            'relatorioDataFim'
        );

    if (inicio && !inicio.value) {
        const data =
            new Date();

        data.setDate(1);

        inicio.value =
            obterDataISO(data);
    }

    if (fim && !fim.value) {
        fim.value =
            hoje;
    }
}

function alternarAba(aba) {
    const views = {
        operacional:
            document.getElementById(
                'viewOperacional'
            ),

        motoristas:
            document.getElementById(
                'viewMotoristas'
            ),

        relatorios:
            document.getElementById(
                'viewRelatorios'
            )
    };

    const botoes = {
        operacional:
            document.getElementById(
                'btnAbaOperacional'
            ),

        motoristas:
            document.getElementById(
                'btnAbaMotoristas'
            ),

        relatorios:
            document.getElementById(
                'btnAbaRelatorios'
            )
    };

    Object.values(views).forEach(view => {
        if (view) {
            view.hidden = true;
        }
    });

    Object.values(botoes).forEach(botao => {
        if (botao) {
            botao.classList.remove('active');
        }
    });

    if (!views[aba]) {
        return;
    }

    views[aba].hidden =
        false;

    botoes[aba].classList.add('active');

    if (aba === 'relatorios') {
        gerarRelatorioHistorico();
    }
}

/*
============================================================
MOTORISTAS
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

    motoristas =
        data || [];
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
        )?.value
            .trim()
            .toLowerCase() || '';

    lista.replaceChildren();

    const filtrados =
        motoristas.filter(motorista =>
            motorista.nome
                .toLowerCase()
                .includes(filtro)
        );

    document.getElementById(
        'contadorTotalMotoristas'
    ).textContent =
        `Total: ${motoristas.length}`;

    if (!filtrados.length) {
        const vazio =
            document.createElement('p');

        vazio.className =
            'helper-text';

        vazio.textContent =
            'Nenhum motorista encontrado.';

        lista.appendChild(vazio);
        return;
    }

    filtrados.forEach(motorista => {
        const linha =
            document.createElement('div');

        linha.className =
            'checkbox-item';

        const nome =
            document.createElement('span');

        nome.textContent =
            `${motorista.nome} · ${motorista.veiculo}`;

        const acoes =
            document.createElement('span');

        const editar =
            document.createElement('button');

        editar.className =
            'btn btn-secondary btn-icon';

        editar.type =
            'button';

        editar.textContent =
            '✏️';

        editar.title =
            'Editar motorista';

        editar.onclick =
            () =>
                abrirEdicaoMotorista(
                    motorista.id
                );

        const excluir =
            document.createElement('button');

        excluir.className =
            'btn btn-danger btn-icon';

        excluir.type =
            'button';

        excluir.textContent =
            '🗑️';

        excluir.title =
            'Arquivar motorista';

        excluir.onclick =
            () =>
                excluirMotorista(
                    motorista.id
                );

        acoes.append(
            editar,
            excluir
        );

        linha.append(
            nome,
            acoes
        );

        lista.appendChild(linha);
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

    const duplicado =
        motoristas.some(motorista =>
            motorista.nome.toLowerCase() ===
            nome.toLowerCase()
        );

    if (duplicado) {
        mostrarToast(
            'Já existe um motorista com esse nome.',
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
    ).value =
        motorista.id;

    document.getElementById(
        'editNomeMotorista'
    ).value =
        motorista.nome;

    document.getElementById(
        'editTelMotorista'
    ).value =
        motorista.telefone || '';

    document.getElementById(
        'editTipoVeiculo'
    ).value =
        motorista.veiculo;

    document.getElementById(
        'modalEdicao'
    ).hidden = false;
}

function fecharModalEdicao() {
    document.getElementById(
        'modalEdicao'
    ).hidden = true;
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
            'Preencha o nome do motorista.',
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
            updated_at:
                new Date().toISOString()
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
        `Arquivar ${motorista.nome}?`
    )) {
        return;
    }

    const {
        error
    } = await supabaseClient
        .from('motoristas')
        .update({
            ativo: false,
            updated_at:
                new Date().toISOString()
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

function renderizarPrioridades() {
    const rodizio =
        document.getElementById(
            'listaRodizio'
        );

    const prioritarios =
        document.getElementById(
            'listaPrioritarios'
        );

    if (!rodizio || !prioritarios) {
        return;
    }

    rodizio.replaceChildren();
    prioritarios.replaceChildren();

    motoristas.forEach(motorista => {
        const option =
            document.createElement('option');

        option.value =
            motorista.id;

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
    const select =
        document.getElementById(id);

    if (!select) return;

    Array.from(select.options)
        .forEach(option => {
            option.selected = true;
        });
}

async function moverParaPrioridade() {
    await alterarPrioridade(
        'listaRodizio',
        true
    );
}

async function moverParaRodizio() {
    await alterarPrioridade(
        'listaPrioritarios',
        false
    );
}

async function alterarPrioridade(
    origemId,
    prioridade
) {
    const select =
        document.getElementById(origemId);

    const ids =
        Array.from(select.selectedOptions)
            .map(option => option.value);

    if (!ids.length) {
        mostrarToast(
            'Selecione um motorista.',
            'error'
        );

        return;
    }

    const {
        error
    } = await supabaseClient
        .from('motoristas')
        .update({
            prioridade,
            updated_at:
                new Date().toISOString()
        })
        .in('id', ids);

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
INDISPONIBILIDADE COM PESQUISA
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
            .map(item =>
                item.motorista_id
            );
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

    if (!lista || !data) {
        return;
    }

    const filtro =
        document.getElementById(
            'buscaIndisponibilidade'
        )?.value
            .trim()
            .toLowerCase() || '';

    const selecionados =
        indisponibilidades[data] || [];

    const filtrados =
        motoristas.filter(motorista =>
            motorista.nome
                .toLowerCase()
                .includes(filtro)
        );

    lista.replaceChildren();

    if (!filtrados.length) {
        const vazio =
            document.createElement('p');

        vazio.className =
            'helper-text';

        vazio.textContent =
            filtro
                ? 'Nenhum motorista encontrado.'
                : 'Não há motoristas cadastrados.';

        lista.appendChild(vazio);
        return;
    }

    filtrados.forEach(motorista => {
        const item =
            document.createElement('div');

        item.className =
            'checkbox-item';

        const label =
            document.createElement('label');

        const checkbox =
            document.createElement('input');

        checkbox.type =
            'checkbox';

        checkbox.checked =
            selecionados.includes(
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
            `${motorista.nome} · ${motorista.veiculo}`;

        label.append(
            checkbox,
            texto
        );

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
                    motorista_id:
                        motoristaId
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
            .eq(
                'motorista_id',
                motoristaId
            );

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
ESCALAS E PRÉVIA
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
        .order('data', {
            ascending: false
        });

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
                    telefone:
                        item.telefone_snapshot || '',
                    motoristaId:
                        item.motorista_id,
                    veiculo: item.veiculo,
                    onda: item.onda || '',
                    status: item.status
                }));

        escalas[escala.data] = {
            id: escala.id,
            status: escala.status,
            salva: true,
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

    const escala =
        escalas[data];

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

    painel.hidden =
        false;

    renderizarTabelaEscala(
        escala.itens,
        escala.status,
        true
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

    if (
        vagas.utilitario +
        vagas.van +
        vagas.passeio <= 0
    ) {
        mostrarToast(
            'Informe pelo menos uma vaga.',
            'error'
        );

        return;
    }

    const indisponiveis =
        indisponibilidades[data] || [];

    const disponiveis =
        motoristas.filter(motorista =>
            !indisponiveis.includes(
                motorista.id
            )
        );

    const usados =
        new Set();

    const itens =
        [];

    const tipos = [
        {
            tipo: 'Utilitário',
            quantidade: vagas.utilitario
        },

        {
            tipo: 'Van',
            quantidade: vagas.van
        },

        {
            tipo: 'Carro de Passeio',
            quantidade: vagas.passeio
        }
    ];

    tipos.forEach(grupo => {
        for (
            let index = 0;
            index < grupo.quantidade;
            index++
        ) {
            const motorista =
                disponiveis.find(item =>
                    item.veiculo === grupo.tipo &&
                    !usados.has(item.id) &&
                    !item.prioridade
                ) ||
                disponiveis.find(item =>
                    item.veiculo === grupo.tipo &&
                    !usados.has(item.id)
                );

            if (motorista) {
                usados.add(motorista.id);

                itens.push({
                    ordem: itens.length,
                    dsp: 'BETAXLOG',
                    nome: motorista.nome,
                    telefone:
                        motorista.telefone || '',
                    motoristaId:
                        motorista.id,
                    veiculo:
                        motorista.veiculo,
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
                    veiculo: grupo.tipo,
                    onda: '',
                    status: 'vago'
                });
            }
        }
    });

    const antiga =
        escalas[data];

    escalas[data] = {
        id: antiga?.id || null,
        status: 'prévia',
        salva: false,
        vagas,
        itens
    };

    renderizarTabelaEscala(
        itens,
        'prévia',
        false
    );

    document.getElementById(
        'painelEscala'
    ).hidden = false;

    mostrarToast(
        'Prévia gerada. Salve antes de baixar a imagem.',
        'success'
    );
}

function renderizarTabelaEscala(
    itens,
    status,
    salva
) {
    const tbody =
        document.getElementById(
            'tabelaEscalaBody'
        );

    if (!tbody) return;

    tbody.replaceChildren();

    const data =
        document.getElementById(
            'dataEscala'
        ).value;

    document.getElementById(
        'dataSubtituloImagem'
    ).textContent =
        `Data: ${formatarData(data)}`;

    const tag =
        document.getElementById(
            'tagStatus'
        );

    if (status === 'definitiva') {
        tag.textContent =
            'DEFINITIVA';

        tag.className =
            'badge-status badge-definitiva';
    } else if (salva) {
        tag.textContent =
            'PRÉVIA SALVA';

        tag.className =
            'badge-status badge-previa';
    } else {
        tag.textContent =
            'PRÉVIA NÃO SALVA';

        tag.className =
            'badge-status badge-previa';
    }

    const aviso =
        document.getElementById(
            'avisoPreviaNaoSalva'
        );

    aviso.hidden =
        Boolean(salva) ||
        status === 'definitiva';

    document.getElementById(
        'btnSalvarPrevia'
    ).disabled =
        Boolean(salva) ||
        status === 'definitiva';

    document.getElementById(
        'btnBaixarImagem'
    ).disabled =
        !salva;

    document.getElementById(
        'btnConfirmarDefinitiva'
    ).disabled =
        !salva ||
        status === 'definitiva';

    itens.forEach((item, index) => {
        const tr =
            document.createElement('tr');

        if (
            item.status === 'cancelado' ||
            item.status === 'cancelado_amazon'
        ) {
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

        const inputOnda =
            document.createElement('input');

        inputOnda.className =
            'input-onda';

        inputOnda.placeholder =
            'HH:MM';

        inputOnda.value =
            item.onda || '';

        inputOnda.addEventListener(
            'blur',
            () =>
                atualizarOnda(
                    index,
                    inputOnda.value
                )
        );

        inputOnda.addEventListener(
            'keydown',
            event => {
                if (event.key === 'Enter') {
                    event.preventDefault();

                    atualizarOnda(
                        index,
                        inputOnda.value
                    );

                    const inputs =
                        Array.from(
                            document.querySelectorAll(
                                '.input-onda'
                            )
                        );

                    const proximo =
                        inputs[index + 1];

                    if (proximo) {
                        proximo.focus();
                        proximo.select();
                    }
                }
            }
        );

        tdOnda.appendChild(inputOnda);

        const tdAcoes =
            document.createElement('td');

        const botao =
            document.createElement('button');

        botao.className =
            item.status === 'cancelado_amazon'
                ? 'btn btn-success btn-icon'
                : 'btn btn-danger btn-icon';

        botao.textContent =
            item.status === 'cancelado_amazon'
                ? '✅'
                : '❌';

        botao.onclick =
            () =>
                item.status === 'cancelado_amazon'
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

    const escala =
        escalas[data];

    if (!escala?.itens[index]) {
        return;
    }

    const hora =
        normalizarHora(valor);

    if (valor.trim() && !hora) {
        mostrarToast(
            'Digite um horário válido entre 00:00 e 23:59.',
            'error'
        );

        return;
    }

    escala.itens[index].onda =
        hora;

    escala.salva =
        false;

    renderizarTabelaEscala(
        escala.itens,
        escala.status,
        false
    );
}

function normalizarHora(valor) {
    const texto =
        String(valor || '').trim();

    if (!texto) {
        return '';
    }

    const partes =
        texto.split(':');

    if (partes.length !== 2) {
        return null;
    }

    const horas =
        Number(partes[0]);

    const minutos =
        Number(partes[1]);

    if (
        !Number.isInteger(horas) ||
        !Number.isInteger(minutos) ||
        horas < 0 ||
        horas > 23 ||
        minutos < 0 ||
        minutos > 59
    ) {
        return null;
    }

    return (
        String(horas).padStart(2, '0') +
        ':' +
        String(minutos).padStart(2, '0')
    );
}

async function salvarPrevia() {
    const data =
        document.getElementById(
            'dataEscala'
        ).value;

    const escala =
        escalas[data];

    if (!escala) {
        mostrarToast(
            'Gere uma prévia primeiro.',
            'error'
        );

        return;
    }

    let escalaId =
        escala.id;

    if (escalaId) {
        const {
            error
        } = await supabaseClient
            .from('escalas')
            .update({
                status: 'prévia',
                vagas_utilitario:
                    escala.vagas.utilitario,
                vagas_van:
                    escala.vagas.van,
                vagas_passeio:
                    escala.vagas.passeio,
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
            data: nova,
            error
        } = await supabaseClient
            .from('escalas')
            .insert({
                data,
                status: 'prévia',
                vagas_utilitario:
                    escala.vagas.utilitario,
                vagas_van:
                    escala.vagas.van,
                vagas_passeio:
                    escala.vagas.passeio,
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
            nova.id;
    }

    const itens =
        escala.itens.map((item, index) => ({
            escala_id:
                escalaId,
            ordem:
                index,
            dsp:
                item.dsp,
            nome_snapshot:
                item.nome,
            telefone_snapshot:
                item.telefone || '',
            motorista_id:
                item.motoristaId,
            veiculo:
                item.veiculo,
            onda:
                item.onda || '',
            status:
                item.status
        }));

    const {
        error: erroItens
    } = await supabaseClient
        .from('escala_itens')
        .insert(itens);

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
        'Prévia salva com sucesso.',
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

    if (!escala || !escala.salva) {
        mostrarToast(
            MENSAGEM_PREVIA_NAO_SALVA,
            'error'
        );

        return;
    }

    if (!confirm(
        'Confirmar a escala como definitiva?'
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
        'Escala confirmada como definitiva.',
        'success'
    );
}

async function cancelarRota(index) {
    const data =
        document.getElementById(
            'dataEscala'
        ).value;

    const escala =
        escalas[data];

    const item =
        escala?.itens[index];

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
        escala.itens,
        escala.status,
        escala.salva
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

    const escala =
        escalas[data];

    if (!escala?.itens[index]) {
        return;
    }

    escala.itens[index].status =
        'ativo';

    await salvarItensEscala(data);

    renderizarTabelaEscala(
        escala.itens,
        escala.status,
        escala.salva
    );
}

async function salvarItensEscala(data) {
    const escala =
        escalas[data];

    if (!escala?.id) {
        return;
    }

    await supabaseClient
        .from('escala_itens')
        .delete()
        .eq('escala_id', escala.id);

    const itens =
        escala.itens.map((item, index) => ({
            escala_id:
                escala.id,
            ordem:
                index,
            dsp:
                item.dsp,
            nome_snapshot:
                item.nome,
            telefone_snapshot:
                item.telefone || '',
            motorista_id:
                item.motoristaId,
            veiculo:
                item.veiculo,
            onda:
                item.onda || '',
            status:
                item.status
        }));

    await supabaseClient
        .from('escala_itens')
        .insert(itens);
}

async function excluirEscalaAtual() {
    const data =
        document.getElementById(
            'dataEscala'
        ).value;

    const escala =
        escalas[data];

    if (!escala) {
        mostrarToast(
            'Não existe escala salva nesta data.',
            'error'
        );

        return;
    }

    if (!confirm(
        'Excluir a escala salva desta data?'
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

    document.getElementById(
        'painelEscala'
    ).hidden = true;

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

function baixarImagemEscala() {
    const data =
        document.getElementById(
            'dataEscala'
        ).value;

    const escala =
        escalas[data];

    if (!escala?.salva) {
        mostrarToast(
            MENSAGEM_PREVIA_NAO_SALVA,
            'error'
        );

        return;
    }

    const area =
        document.getElementById(
            'areaCapturaImagem'
        );

    html2canvas(
        area,
        {
            scale: 2
        }
    ).then(canvas => {
        const link =
            document.createElement('a');

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
            'Não existe escala nesta data.',
            'error'
        );

        return;
    }

    let texto =
        `🚛 ESCALA BETAXLOG\n` +
        `📅 Data: ${formatarData(data)}\n\n`;

    escala.itens
        .filter(item =>
            item.motoristaId &&
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
                'Escala copiada para a área de transferência.',
                'success'
            );
        })
        .catch(() => {
            prompt(
                'Copie o texto abaixo:',
                texto
            );
        });
}

function exportarExcel() {
    const data =
        document.getElementById(
            'dataEscala'
        ).value;

    const escala =
        escalas[data];

    if (!escala) {
        mostrarToast(
            'Não existe escala para exportar.',
            'error'
        );

        return;
    }

    const dados =
        escala.itens.map(item => ({
            DSP:
                item.dsp,
            Motorista:
                item.nome,
            Telefone:
                item.telefone,
            Veiculo:
                item.veiculo,
            Onda:
                item.onda,
            Status:
                item.status
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
            Nome:
                item.nome,
            Telefone:
                item.telefone || '',
            Veiculo:
                item.veiculo,
            Prioridade:
                item.prioridade
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

/*
============================================================
RELATÓRIOS
============================================================
*/

function aplicarAtalhoPeriodo() {
    const tipo =
        document.getElementById(
            'filtroAtalhoPeriodo'
        ).value;

    const hoje =
        new Date();

    let inicio =
        new Date();

    if (tipo === 'mes_atual') {
        inicio =
            new Date(
                hoje.getFullYear(),
                hoje.getMonth(),
                1
            );
    } else if (tipo === 'semanal') {
        inicio.setDate(
            hoje.getDate() - 7
        );
    } else if (tipo === 'semestral') {
        inicio.setMonth(
            hoje.getMonth() - 6
        );
    } else if (tipo === 'anual') {
        inicio =
            new Date(
                hoje.getFullYear(),
                0,
                1
            );
    } else {
        return;
    }

    document.getElementById(
        'relatorioDataInicio'
    ).value =
        obterDataISO(inicio);

    document.getElementById(
        'relatorioDataFim'
    ).value =
        obterDataISO(hoje);
}

function gerarRelatorioHistorico() {
    const inicioTexto =
        document.getElementById(
            'relatorioDataInicio'
        )?.value;

    const fimTexto =
        document.getElementById(
            'relatorioDataFim'
        )?.value;

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
        historicoExecucoes.filter(item => {
            const data =
                converterData(item.data);

            return data >= inicio &&
                data <= fim;
        });

    let total = 0;
    let ativas = 0;
    let canceladas = 0;

    const ranking = {};

    registros.forEach(registro => {
        registro.itens.forEach(item => {
            if (!item.motoristaId) {
                return;
            }

            total++;

            const cancelado =
                item.status === 'cancelado_amazon';

            if (cancelado) {
                canceladas++;
            } else {
                ativas++;
            }

            if (!ranking[item.motoristaId]) {
                ranking[item.motoristaId] = {
                    nome:
                        item.nome,
                    veiculo:
                        item.veiculo,
                    escaladas:
                        0,
                    canceladas:
                        0
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

    document.getElementById(
        'kpiTotalRotas'
    ).textContent =
        total;

    document.getElementById(
        'kpiRotasAtivas'
    ).textContent =
        ativas;

    document.getElementById(
        'kpiRotasCanceladas'
    ).textContent =
        canceladas;

    document.getElementById(
        'kpiTaxaSucesso'
    ).textContent =
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

    registros.forEach(registro => {
        datas[registro.data] =
            registro.itens.filter(item =>
                item.motoristaId &&
                item.status !== 'cancelado_amazon'
            ).length;

        registro.itens.forEach(item => {
            if (
                item.motoristaId &&
                item.status !== 'cancelado_amazon' &&
                veiculos[item.veiculo] !== undefined
            ) {
                veiculos[item.veiculo]++;
            }
        });
    });

    const canvasLinha =
        document.getElementById(
            'chartEvolucao'
        );

    if (canvasLinha && window.Chart) {
        chartEvolucaoInstancia?.destroy();

        chartEvolucaoInstancia =
            new Chart(
                canvasLinha,
                {
                    type: 'line',
                    data: {
                        labels:
                            Object.keys(datas),
                        datasets: [{
                            label:
                                'Rotas ativas',
                            data:
                                Object.values(datas),
                            borderColor:
                                '#1e3a8a',
                            backgroundColor:
                                'rgba(30,58,138,.12)',
                            fill:
                                true,
                            tension:
                                .3
                        }]
                    },
                    options: {
                        responsive:
                            true
                    }
                }
            );
    }

    const canvasPizza =
        document.getElementById(
            'chartVeiculos'
        );

    if (canvasPizza && window.Chart) {
        chartVeiculosInstancia?.destroy();

        chartVeiculosInstancia =
            new Chart(
                canvasPizza,
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
                        responsive:
                            true
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
        html:
            '#tabelaRankingBody',
        startY:
            30
    });

    documento.save(
        `relatorio_${obterDataISO()}.pdf`
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

    document.getElementById(
        'listaUsuariosCadastrados'
    ).textContent =
        `${usuarioLogado.nome} · ` +
        `${usuarioLogado.email} · ` +
        `${usuarioLogado.role}`;

    document.getElementById(
        'modalAdmin'
    ).hidden = false;
}

function fecharModalAdmin() {
    document.getElementById(
        'modalAdmin'
    ).hidden = true;
}

async function apagarTodoOSistema() {
    if (usuarioLogado?.role !== 'admin') {
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

    document.getElementById(
        'painelEscala'
    ).hidden = true;

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
    const partes =
        valor.split('-')
            .map(Number);

    return new Date(
        partes[0],
        partes[1] - 1,
        partes[2]
    );
}

function formatarData(valor) {
    if (!valor) return '';

    return valor
        .split('-')
        .reverse()
        .join('/');
}

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

function obterMensagemErro(error) {
    return error?.message ||
        'Erro desconhecido.';
}
