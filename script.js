'use strict';

/*
========================================================
CONFIGURAÇÃO DO SUPABASE
========================================================
*/

const SUPABASE_URL =
    'COLE_AQUI_A_PROJECT_URL_COMPLETA';

const SUPABASE_ANON_KEY =
    'COLE_AQUI_A_PUBLISHABLE_KEY_COMPLETA';

/*
A URL deve ter este formato:

https://xxxxxxxxxxxxxxxx.supabase.co

A chave deve ser copiada inteira do painel do Supabase.
Não use service_role no navegador.
*/

let supabaseClient = null;
let usuarioLogado = null;

let motoristas = [];
let escalas = {};
let indisponibilidades = {};
let historico = [];

let escalaAtual = null;
let previaSalva = false;

/*
========================================================
INICIALIZAÇÃO
========================================================
*/

window.addEventListener('DOMContentLoaded', iniciarSistema);

async function iniciarSistema() {
    try {
        if (!configuracaoValida()) {
            removerLoader();
            mostrarLogin(
                'Configure a URL e a chave anon do Supabase no arquivo script.js.'
            );
            return;
        }

        if (!window.supabase) {
            removerLoader();
            mostrarLogin(
                'A biblioteca do Supabase não foi carregada.'
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
                        autoRefreshToken: true
                    }
                }
            );

        const {
            data: { session }
        } = await supabaseClient.auth.getSession();

        removerLoader();

        if (!session) {
            mostrarLogin();
            return;
        }

        const perfil =
            await carregarPerfil(session.user.id);

        if (!perfil || perfil.ativo !== true) {
            await supabaseClient.auth.signOut();

            mostrarLogin(
                'Este usuário está inativo ou não possui perfil cadastrado.'
            );

            return;
        }

        usuarioLogado = {
            id: session.user.id,
            email: session.user.email,
            nome: perfil.nome,
            role: perfil.role,
            ativo: perfil.ativo
        };

        await carregarDados();

        mostrarSistema();
        configurarEventos();
        prepararInterface();
    } catch (error) {
        console.error(error);
        removerLoader();

        mostrarLogin(
            error?.message ||
            'Não foi possível iniciar o sistema.'
        );
    }
}

function configuracaoValida() {
    return (
        SUPABASE_URL.startsWith('https://') &&
        SUPABASE_URL.endsWith('.supabase.co') &&
        !SUPABASE_URL.includes('COLE_AQUI') &&
        SUPABASE_ANON_KEY.length > 40 &&
        !SUPABASE_ANON_KEY.includes('COLE_AQUI') &&
        !SUPABASE_ANON_KEY.includes('..')
    );
}

function removerLoader() {
    const loader =
        document.getElementById('appLoader');

    if (loader) {
        loader.remove();
    }
}

/*
========================================================
LOGIN
========================================================
*/

function mostrarLogin(mensagem = '') {
    const root =
        document.getElementById('loginRoot');

    if (!root) return;

    root.innerHTML = '';

    const tela =
        document.createElement('div');

    tela.className =
        'login-screen';

    const card =
        document.createElement('div');

    card.className =
        'login-card';

    card.innerHTML = `
        <h1>🚛 BETAXLOG</h1>
        <p>Acesso seguro pelo Supabase Authentication.</p>

        <div
            id="loginErro"
            class="login-error"
            ${mensagem ? '' : 'hidden'}>
            ${escaparHtml(mensagem)}
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
    `;

    tela.appendChild(card);
    root.appendChild(tela);

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

    const erro =
        document.getElementById('loginErro');

    const botao =
        document.getElementById('btnLogin');

    if (!email || !senha) {
        erro.hidden = false;
        erro.textContent =
            'Informe o e-mail e a senha.';
        return;
    }

    botao.disabled = true;
    botao.textContent = 'Entrando...';

    const {
        data,
        error
    } = await supabaseClient.auth.signInWithPassword({
        email,
        password: senha
    });

    if (error) {
        erro.hidden = false;
        erro.textContent =
            'E-mail ou senha inválidos.';
        botao.disabled = false;
        botao.textContent = 'Entrar';
        return;
    }

    const perfil =
        await carregarPerfil(data.user.id);

    if (!perfil || perfil.ativo !== true) {
        await supabaseClient.auth.signOut();

        erro.hidden = false;
        erro.textContent =
            'Usuário inativo ou sem perfil de acesso.';

        botao.disabled = false;
        botao.textContent = 'Entrar';
        return;
    }

    window.location.reload();
}

async function fazerLogout() {
    await supabaseClient.auth.signOut();
    window.location.reload();
}

async function carregarPerfil(id) {
    const {
        data,
        error
    } = await supabaseClient
        .from('profiles')
        .select('id, nome, role, ativo')
        .eq('id', id)
        .maybeSingle();

    if (error) {
        throw error;
    }

    return data;
}

/*
========================================================
INTERFACE
========================================================
*/

function mostrarSistema() {
    document
        .getElementById('sistema')
        .hidden = false;

    document
        .getElementById('loginRoot')
        .replaceChildren();

    document
        .getElementById('usuarioAtual')
        .textContent =
        `${usuarioLogado.nome} · ${usuarioLogado.role}`;

    const admin =
        document.getElementById('btnPainelAdmin');

    admin.hidden =
        usuarioLogado.role !== 'admin';

    document
        .getElementById('infoUltimoBackup')
        .textContent =
        `☁️ Supabase conectado · ` +
        `${new Date().toLocaleString('pt-BR')}`;
}

function prepararInterface() {
    const hoje =
        obterDataISO();

    document
        .getElementById('dataEscala')
        .value = hoje;

    const inicio =
        new Date(
            new Date().getFullYear(),
            new Date().getMonth(),
            1
        );

    document
        .getElementById('relatorioInicio')
        .value =
        obterDataISO(inicio);

    document
        .getElementById('relatorioFim')
        .value = hoje;

    renderizarMotoristas();
    renderizarPrioridades();
    renderizarIndisponibilidade();
    carregarEscalaData();
}

function configurarEventos() {
    document
        .getElementById('btnSair')
        .addEventListener(
            'click',
            fazerLogout
        );

    document
        .getElementById('btnPainelAdmin')
        .addEventListener(
            'click',
            abrirAdministracao
        );

    document
        .getElementById('btnAbaOperacional')
        .addEventListener(
            'click',
            () => alternarAba('operacional')
        );

    document
        .getElementById('btnAbaMotoristas')
        .addEventListener(
            'click',
            () => alternarAba('motoristas')
        );

    document
        .getElementById('btnAbaRelatorios')
        .addEventListener(
            'click',
            () => alternarAba('relatorios')
        );

    document
        .getElementById('dataEscala')
        .addEventListener(
            'change',
            async () => {
                await carregarIndisponibilidades();
                renderizarIndisponibilidade();
                carregarEscalaData();
            }
        );

    document
        .getElementById('buscaIndisponibilidade')
        .addEventListener(
            'input',
            renderizarIndisponibilidade
        );

    document
        .getElementById('buscaMotorista')
        .addEventListener(
            'input',
            renderizarMotoristas
        );

    document
        .getElementById('btnGerarPrevia')
        .addEventListener(
            'click',
            gerarPrevia
        );

    document
        .getElementById('btnSalvarPrevia')
        .addEventListener(
            'click',
            salvarPrevia
        );

    document
        .getElementById('btnBaixarImagem')
        .addEventListener(
            'click',
            baixarImagem
        );

    document
        .getElementById('btnDefinitiva')
        .addEventListener(
            'click',
            confirmarDefinitiva
        );

    document
        .getElementById('btnExcluirEscala')
        .addEventListener(
            'click',
            excluirEscala
        );

    document
        .getElementById('btnWhatsApp')
        .addEventListener(
            'click',
            compartilharWhatsApp
        );

    document
        .getElementById('btnExcel')
        .addEventListener(
            'click',
            exportarExcel
        );

    document
        .getElementById('btnCadastrarMotorista')
        .addEventListener(
            'click',
            cadastrarMotorista
        );

    document
        .getElementById('btnParaPrioridade')
        .addEventListener(
            'click',
            () =>
                alterarPrioridade(true)
        );

    document
        .getElementById('btnParaRodizio')
        .addEventListener(
            'click',
            () =>
                alterarPrioridade(false)
        );

    document
        .getElementById('btnFecharMotorista')
        .addEventListener(
            'click',
            fecharModalMotorista
        );

    document
        .getElementById('btnSalvarMotorista')
        .addEventListener(
            'click',
            salvarEdicaoMotorista
        );

    document
        .getElementById('btnFecharAdmin')
        .addEventListener(
            'click',
            fecharAdministracao
        );

    document
        .getElementById('btnGerarRelatorio')
        .addEventListener(
            'click',
            gerarRelatorio
        );
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
        view.hidden = true;
    });

    Object.values(botoes).forEach(botao => {
        botao.classList.remove('active');
    });

    views[aba].hidden = false;
    botoes[aba].classList.add('active');

    if (aba === 'relatorios') {
        gerarRelatorio();
    }
}

/*
========================================================
MOTORISTAS
========================================================
*/

async function carregarDados() {
    await Promise.all([
        carregarMotoristas(),
        carregarEscalas(),
        carregarIndisponibilidades()
    ]);
}

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
            'listaMotoristas'
        );

    const filtro =
        document
            .getElementById('buscaMotorista')
            .value
            .toLowerCase();

    lista.replaceChildren();

    document
        .getElementById('contadorMotoristas')
        .textContent =
        `Total: ${motoristas.length}`;

    motoristas
        .filter(item =>
            item.nome
                .toLowerCase()
                .includes(filtro)
        )
        .forEach(motorista => {
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

            editar.textContent = '✏️';

            editar.onclick =
                () =>
                    abrirEdicaoMotorista(
                        motorista
                    );

            const excluir =
                document.createElement('button');

            excluir.className =
                'btn btn-danger btn-icon';

            excluir.textContent = '🗑️';

            excluir.onclick =
                () =>
                    arquivarMotorista(
                        motorista.id
                    );

            acoes.append(editar, excluir);
            linha.append(nome, acoes);
            lista.appendChild(linha);
        });
}

async function cadastrarMotorista() {
    const nome =
        document
            .getElementById('nomeMotorista')
            .value
            .trim();

    const telefone =
        document
            .getElementById('telefoneMotorista')
            .value
            .trim();

    const veiculo =
        document
            .getElementById('veiculoMotorista')
            .value;

    if (!nome) {
        mostrarToast(
            'Informe o nome.',
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

    document
        .getElementById('nomeMotorista')
        .value = '';

    document
        .getElementById('telefoneMotorista')
        .value = '';

    await carregarMotoristas();

    renderizarMotoristas();
    renderizarPrioridades();

    mostrarToast(
        'Motorista cadastrado.',
        'success'
    );
}

function abrirEdicaoMotorista(motorista) {
    document
        .getElementById('editarMotoristaId')
        .value =
        motorista.id;

    document
        .getElementById('editarNome')
        .value =
        motorista.nome;

    document
        .getElementById('editarTelefone')
        .value =
        motorista.telefone || '';

    document
        .getElementById('editarVeiculo')
        .value =
        motorista.veiculo;

    document
        .getElementById('modalMotorista')
        .hidden = false;
}

function fecharModalMotorista() {
    document
        .getElementById('modalMotorista')
        .hidden = true;
}

async function salvarEdicaoMotorista() {
    const id =
        document
            .getElementById('editarMotoristaId')
            .value;

    const nome =
        document
            .getElementById('editarNome')
            .value
            .trim();

    const telefone =
        document
            .getElementById('editarTelefone')
            .value
            .trim();

    const veiculo =
        document
            .getElementById('editarVeiculo')
            .value;

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

    fecharModalMotorista();

    await carregarMotoristas();

    renderizarMotoristas();
    renderizarPrioridades();

    mostrarToast(
        'Motorista atualizado.',
        'success'
    );
}

async function arquivarMotorista(id) {
    if (!confirm(
        'Arquivar este motorista?'
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

    rodizio.replaceChildren();
    prioritarios.replaceChildren();

    motoristas.forEach(motorista => {
        const option =
            document.createElement('option');

        option.value =
            motorista.id;

        option.textContent =
            motorista.nome;

        if (motorista.prioridade) {
            prioritarios.appendChild(option);
        } else {
            rodizio.appendChild(option);
        }
    });
}

async function alterarPrioridade(valor) {
    const origem =
        valor
            ? 'listaRodizio'
            : 'listaPrioritarios';

    const ids =
        Array.from(
            document
                .getElementById(origem)
                .selectedOptions
        )
        .map(option => option.value);

    if (!ids.length) {
        return;
    }

    const {
        error
    } = await supabaseClient
        .from('motoristas')
        .update({
            prioridade: valor
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
========================================================
INDISPONIBILIDADE COM PESQUISA
========================================================
*/

async function carregarIndisponibilidades() {
    const data =
        document
            .getElementById('dataEscala')
            .value;

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

function renderizarIndisponibilidade() {
    const lista =
        document.getElementById(
            'listaIndisponibilidade'
        );

    const busca =
        document
            .getElementById(
                'buscaIndisponibilidade'
            )
            .value
            .toLowerCase();

    const data =
        document
            .getElementById('dataEscala')
            .value;

    const marcados =
        indisponibilidades[data] || [];

    lista.replaceChildren();

    motoristas
        .filter(item =>
            item.nome
                .toLowerCase()
                .includes(busca)
        )
        .forEach(motorista => {
            const linha =
                document.createElement('div');

            linha.className =
                'checkbox-item';

            const label =
                document.createElement('label');

            const checkbox =
                document.createElement('input');

            checkbox.type = 'checkbox';

            checkbox.checked =
                marcados.includes(
                    motorista.id
                );

            checkbox.onchange =
                event =>
                    alterarIndisponibilidade(
                        data,
                        motorista.id,
                        event.target.checked
                    );

            const nome =
                document.createElement('span');

            nome.textContent =
                motorista.nome;

            label.append(checkbox, nome);
            linha.appendChild(label);
            lista.appendChild(linha);
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
        }
    }

    await carregarIndisponibilidades();
}

/*
========================================================
ESCALAS
========================================================
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
    historico = [];

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
                    nome:
                        item.nome_snapshot,
                    telefone:
                        item.telefone_snapshot,
                    motoristaId:
                        item.motorista_id,
                    veiculo:
                        item.veiculo,
                    onda:
                        item.onda || '',
                    status:
                        item.status
                }));

        escalas[escala.data] = {
            id: escala.id,
            data: escala.data,
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
            historico.push({
                data: escala.data,
                itens
            });
        }
    });
}

function carregarEscalaData() {
    const data =
        document
            .getElementById('dataEscala')
            .value;

    const escala =
        escalas[data];

    const painel =
        document.getElementById(
            'painelEscala'
        );

    if (!escala) {
        painel.hidden = true;
        escalaAtual = null;
        previaSalva = false;
        return;
    }

    escalaAtual =
        JSON.parse(
            JSON.stringify(escala)
        );

    previaSalva = true;

    document
        .getElementById('vagasUtilitario')
        .value =
        escala.vagas.utilitario;

    document
        .getElementById('vagasVan')
        .value =
        escala.vagas.van;

    document
        .getElementById('vagasPasseio')
        .value =
        escala.vagas.passeio;

    painel.hidden = false;

    renderizarEscala();
    atualizarBotoesEscala();
}

function gerarPrevia() {
    const data =
        document
            .getElementById('dataEscala')
            .value;

    const vagas = {
        utilitario:
            Number(
                document
                    .getElementById(
                        'vagasUtilitario'
                    )
                    .value
            ),

        van:
            Number(
                document
                    .getElementById(
                        'vagasVan'
                    )
                    .value
            ),

        passeio:
            Number(
                document
                    .getElementById(
                        'vagasPasseio'
                    )
                    .value
            )
    };

    const indisponiveis =
        indisponibilidades[data] || [];

    const disponiveis =
        motoristas.filter(
            motorista =>
                !indisponiveis.includes(
                    motorista.id
                )
        );

    const tipos = [
        {
            nome: 'Utilitário',
            qtd: vagas.utilitario
        },
        {
            nome: 'Van',
            qtd: vagas.van
        },
        {
            nome: 'Carro de Passeio',
            qtd: vagas.passeio
        }
    ];

    const usados = new Set();
    const itens = [];

    tipos.forEach(tipo => {
        for (
            let i = 0;
            i < tipo.qtd;
            i++
        ) {
            const motorista =
                disponiveis.find(
                    item =>
                        item.veiculo === tipo.nome &&
                        !item.prioridade &&
                        !usados.has(item.id)
                ) ||
                disponiveis.find(
                    item =>
                        item.veiculo === tipo.nome &&
                        !usados.has(item.id)
                );

            if (motorista) {
                usados.add(motorista.id);

                itens.push({
                    dsp: 'BETAXLOG',
                    nome:
                        motorista.nome,
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
                    dsp: 'BETAXLOG',
                    nome:
                        'VAGA SEM MOTORISTA',
                    telefone: '',
                    motoristaId: null,
                    veiculo: tipo.nome,
                    onda: '',
                    status: 'vago'
                });
            }
        }
    });

    escalaAtual = {
        data,
        id: null,
        status: 'prévia',
        salva: false,
        vagas,
        itens
    };

    previaSalva = false;

    document
        .getElementById('painelEscala')
        .hidden = false;

    renderizarEscala();
    atualizarBotoesEscala();

    mostrarToast(
        'Prévia gerada. Clique em Salvar prévia.',
        'success'
    );
}

function renderizarEscala() {
    if (!escalaAtual) return;

    const tbody =
        document.getElementById(
            'tabelaEscala'
        );

    tbody.replaceChildren();

    document
        .getElementById('dataSubtitulo')
        .textContent =
        `Data: ${formatarData(
            escalaAtual.data
        )}`;

    const status =
        document.getElementById(
            'statusEscala'
        );

    status.textContent =
        previaSalva
            ? escalaAtual.status.toUpperCase()
            : 'PRÉVIA NÃO SALVA';

    status.className =
        `badge-status ${
            previaSalva &&
            escalaAtual.status === 'definitiva'
                ? 'badge-definitiva'
                : 'badge-previa'
        }`;

    escalaAtual.itens.forEach(
        (item, index) => {
            const tr =
                document.createElement('tr');

            if (
                item.status ===
                'cancelado_amazon'
            ) {
                tr.className =
                    'row-cancelada';
            }

            tr.innerHTML = `
                <td>${escaparHtml(item.dsp)}</td>
                <td>${escaparHtml(item.nome)}</td>
                <td>${escaparHtml(item.veiculo)}</td>
                <td>
                    <input
                        class="input-onda"
                        value="${escaparHtml(item.onda)}"
                        placeholder="HH:MM">
                </td>
                <td></td>
            `;

            const onda =
                tr.querySelector(
                    '.input-onda'
                );

            onda.addEventListener(
                'change',
                event => {
                    item.onda =
                        event.target.value;
                }
            );

            const acoes =
                tr.lastElementChild;

            const botao =
                document.createElement('button');

            botao.className =
                item.status ===
                'cancelado_amazon'
                    ? 'btn btn-success btn-icon'
                    : 'btn btn-danger btn-icon';

            botao.textContent =
                item.status ===
                'cancelado_amazon'
                    ? '✅'
                    : '❌';

            botao.onclick =
                () => {
                    if (
                        item.status ===
                        'cancelado_amazon'
                    ) {
                        item.status = 'ativo';
                    } else {
                        item.status =
                            'cancelado_amazon';
                    }

                    renderizarEscala();
                };

            acoes.appendChild(botao);
            tbody.appendChild(tr);
        }
    );
}

function atualizarBotoesEscala() {
    const aviso =
        document.getElementById(
            'avisoPrevia'
        );

    const imagem =
        document.getElementById(
            'btnBaixarImagem'
        );

    const definitiva =
        document.getElementById(
            'btnDefinitiva'
        );

    const salvar =
        document.getElementById(
            'btnSalvarPrevia'
        );

    aviso.hidden =
        previaSalva;

    imagem.disabled =
        !previaSalva;

    definitiva.disabled =
        !previaSalva ||
        escalaAtual?.status ===
            'definitiva';

    salvar.disabled =
        previaSalva &&
        escalaAtual?.status ===
            'definitiva';
}

async function salvarPrevia() {
    if (!escalaAtual) return;

    const data =
        escalaAtual.data;

    let escalaId =
        escalaAtual.id;

    if (escalaId) {
        const {
            error
        } = await supabaseClient
            .from('escalas')
            .update({
                status: 'prévia',
                vagas_utilitario:
                    escalaAtual.vagas.utilitario,
                vagas_van:
                    escalaAtual.vagas.van,
                vagas_passeio:
                    escalaAtual.vagas.passeio,
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
            .eq(
                'escala_id',
                escalaId
            );
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
                    escalaAtual.vagas.utilitario,
                vagas_van:
                    escalaAtual.vagas.van,
                vagas_passeio:
                    escalaAtual.vagas.passeio,
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

        escalaAtual.id =
            escalaId;
    }

    const itens =
        escalaAtual.itens.map(
            (item, index) => ({
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
            })
        );

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

    escalaAtual =
        JSON.parse(
            JSON.stringify(
                escalas[data]
            )
        );

    previaSalva = true;

    renderizarEscala();
    atualizarBotoesEscala();

    mostrarToast(
        'Prévia salva com sucesso.',
        'success'
    );
}

async function confirmarDefinitiva() {
    if (!previaSalva || !escalaAtual?.id) {
        mostrarToast(
            'Salve a prévia antes de confirmar.',
            'error'
        );

        return;
    }

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
        .eq('id', escalaAtual.id);

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
        'Escala definitiva confirmada.',
        'success'
    );
}

async function excluirEscala() {
    const data =
        document
            .getElementById('dataEscala')
            .value;

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
========================================================
IMAGEM, WHATSAPP E EXCEL
========================================================
*/

function baixarImagem() {
    if (!previaSalva) {
        mostrarToast(
            'Salve a prévia antes de baixar a imagem.',
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
            `escala_${escalaAtual.data}.png`;

        link.href =
            canvas.toDataURL('image/png');

        link.click();
    });
}

function compartilharWhatsApp() {
    if (!escalaAtual) return;

    let texto =
        `🚛 ESCALA BETAXLOG\n` +
        `📅 Data: ${formatarData(
            escalaAtual.data
        )}\n\n`;

    escalaAtual.itens
        .filter(item =>
            item.motoristaId &&
            item.status !== 'cancelado_amazon'
        )
        .forEach(item => {
            texto +=
                `• ${item.nome} - ` +
                `${item.veiculo} - ` +
                `${item.onda || 'Sem onda'}\n`;
        });

    navigator.clipboard
        .writeText(texto)
        .then(() => {
            mostrarToast(
                'Texto copiado para o WhatsApp.',
                'success'
            );
        });
}

function exportarExcel() {
    if (!escalaAtual) return;

    const dados =
        escalaAtual.itens.map(item => ({
            DSP: item.dsp,
            Motorista: item.nome,
            Telefone: item.telefone,
            Veiculo: item.veiculo,
            Onda: item.onda,
            Status: item.status
        }));

    const folha =
        XLSX.utils.json_to_sheet(dados);

    const arquivo =
        XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
        arquivo,
        folha,
        'Escala'
    );

    XLSX.writeFile(
        arquivo,
        `escala_${escalaAtual.data}.xlsx`
    );
}

/*
========================================================
ADMINISTRAÇÃO DE USUÁRIOS
========================================================
*/

async function abrirAdministracao() {
    if (usuarioLogado.role !== 'admin') {
        mostrarToast(
            'Acesso restrito ao administrador.',
            'error'
        );

        return;
    }

    document
        .getElementById('modalAdmin')
        .hidden = false;

    await carregarUsuarios();
}

function fecharAdministracao() {
    document
        .getElementById('modalAdmin')
        .hidden = true;
}

async function carregarUsuarios() {
    const lista =
        document.getElementById(
            'listaUsuarios'
        );

    lista.textContent =
        'Carregando usuários...';

    const {
        data,
        error
    } = await supabaseClient
        .from('profiles')
        .select('id, nome, role, ativo')
        .order('nome');

    if (error) {
        lista.textContent =
            error.message;

        return;
    }

    lista.replaceChildren();

    data.forEach(usuario => {
        const item =
            document.createElement('div');

        item.className =
            'usuario-item';

        const titulo =
            document.createElement('strong');

        titulo.textContent =
            usuario.nome;

        const nome =
            document.createElement('p');

        nome.textContent =
            `ID: ${usuario.id}`;

        const ativo =
            document.createElement('select');

        ativo.innerHTML = `
            <option value="true">🟢 ATIVO</option>
            <option value="false">🔴 INATIVO</option>
        `;

        ativo.value =
            String(usuario.ativo);

        const role =
            document.createElement('select');

        role.innerHTML = `
            <option value="operador">Operador</option>
            <option value="admin">Administrador</option>
        `;

        role.value =
            usuario.role;

        const salvar =
            document.createElement('button');

        salvar.className =
            'btn btn-primary';

        salvar.textContent =
            'Salvar alterações';

        salvar.onclick =
            () =>
                atualizarUsuario(
                    usuario.id,
                    ativo.value === 'true',
                    role.value,
                    titulo.textContent
                );

        const excluir =
            document.createElement('button');

        excluir.className =
            'btn btn-danger';

        excluir.textContent =
            'Excluir perfil';

        excluir.disabled =
            usuario.id ===
            usuarioLogado.id;

        excluir.onclick =
            () =>
                excluirPerfilUsuario(
                    usuario.id,
                    titulo.textContent
                );

        const acoes =
            document.createElement('div');

        acoes.className =
            'usuario-acoes';

        acoes.append(
            ativo,
            role,
            salvar,
            excluir
        );

        item.append(
            titulo,
            nome,
            acoes
        );

        lista.appendChild(item);
    });
}

async function atualizarUsuario(
    id,
    ativo,
    role,
    nomeAtual
) {
    if (
        !confirm(
            `Salvar alterações de ${nomeAtual}?`
        )
    ) {
        return;
    }

    const {
        error
    } = await supabaseClient
        .from('profiles')
        .update({
            ativo,
            role
        })
        .eq('id', id);

    if (error) {
        mostrarToast(
            error.message,
            'error'
        );

        return;
    }

    await carregarUsuarios();

    mostrarToast(
        'Usuário atualizado.',
        'success'
    );
}

async function excluirPerfilUsuario(
    id,
    nome
) {
    if (
        id === usuarioLogado.id
    ) {
        mostrarToast(
            'Você não pode excluir seu próprio perfil.',
            'error'
        );

        return;
    }

    if (
        !confirm(
            `Excluir o perfil de ${nome}?`
        )
    ) {
        return;
    }

    const {
        error
    } = await supabaseClient
        .from('profiles')
        .delete()
        .eq('id', id);

    if (error) {
        mostrarToast(
            error.message,
            'error'
        );

        return;
    }

    await carregarUsuarios();

    mostrarToast(
        'Perfil excluído.',
        'success'
    );
}

/*
========================================================
RELATÓRIOS
========================================================
*/

function gerarRelatorio() {
    const inicio =
        document
            .getElementById('relatorioInicio')
            .value;

    const fim =
        document
            .getElementById('relatorioFim')
            .value;

    const registros =
        historico.filter(item =>
            item.data >= inicio &&
            item.data <= fim
        );

    let total = 0;
    let ativas = 0;
    let canceladas = 0;

    const ranking = {};

    registros.forEach(registro => {
        registro.itens.forEach(item => {
            if (!item.motoristaId) return;

            total++;

            if (
                item.status ===
                'cancelado_amazon'
            ) {
                canceladas++;
            } else {
                ativas++;
            }

            if (!ranking[item.motoristaId]) {
                ranking[item.motoristaId] = {
                    nome: item.nome,
                    veiculo: item.veiculo,
                    total: 0,
                    canceladas: 0
                };
            }

            ranking[item.motoristaId].total++;

            if (
                item.status ===
                'cancelado_amazon'
            ) {
                ranking[item.motoristaId]
                    .canceladas++;
            }
        });
    });

    document
        .getElementById('kpiTotal')
        .textContent = total;

    document
        .getElementById('kpiAtivas')
        .textContent = ativas;

    document
        .getElementById('kpiCanceladas')
        .textContent = canceladas;

    document
        .getElementById('kpiSucesso')
        .textContent =
        `${total ? (ativas / total * 100).toFixed(1) : 0}%`;

    const tabela =
        document.getElementById(
            'tabelaRelatorio'
        );

    tabela.replaceChildren();

    Object.values(ranking)
        .sort(
            (a, b) =>
                b.total - a.total
        )
        .forEach(item => {
            const tr =
                document.createElement('tr');

            [
                item.nome,
                item.veiculo,
                item.total,
                item.canceladas
            ].forEach(valor => {
                const td =
                    document.createElement('td');

                td.textContent =
                    valor;

                tr.appendChild(td);
            });

            tabela.appendChild(tr);
        });
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

function formatarData(valor) {
    return valor
        .split('-')
        .reverse()
        .join('/');
}

function escaparHtml(valor) {
    return String(valor || '')
        .replaceAll('&', '&')
        .replaceAll('<', '<')
        .replaceAll('>', '>')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function mostrarToast(
    mensagem,
    tipo = ''
) {
    const container =
        document.getElementById(
            'toastContainer'
        );

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
