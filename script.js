'use strict';

/*
============================================================
BETAXLOG — SCRIPT PRINCIPAL
============================================================

Tabelas esperadas:

profiles
motoristas
escalas
escala_itens
indisponibilidades
audit_logs

Colunas principais:

profiles:
id, nome, email, role, ativo

motoristas:
id, nome, telefone, veiculo, prioridade, ativo,
deleted_at, deleted_by, deleted_reason, updated_at

escalas:
id, data, status, deleted_at, deleted_by,
deleted_reason, updated_at

escala_itens:
id, escala_id, motorista_id, nome,
veiculo, onda, status
*/

const SUPABASE_URL =
    'https://bnpfdkwjdtnpfmnjoftf.supabase.co';

const SUPABASE_ANON_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJucGZka3dqZHRucGZtbmpvZnRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1NzMxNzcsImV4cCI6MjEwNDE0OTE3N30.5ksgMBijxazAtCtse-Lb5MqmaxcL22dVqKBMrnjSYMA';

const supabaseClient =
    window.supabase.createClient(
        SUPABASE_URL,
        SUPABASE_ANON_KEY
    );

let usuarioLogado = null;
let motoristas = [];
let escalas = [];
let indisponibilidades = [];
let historicoExecucoes = [];
let escalaAtual = null;
let motoristasSelecionados = new Set();
let chartEvolucaoInstancia = null;
let chartVeiculosInstancia = null;

const TIPOS_VEICULO = [
    'Utilitário',
    'Van',
    'Carro de Passeio'
];

const MENSAGEM_CANCELAMENTO_AMAZON =
    'Olá! Sua rota de hoje foi cancelada pela Amazon. Em caso de falta de outro motorista ou necessidade de rota extra, entraremos em contato para acioná-lo(a). Obrigado pela compreensão!';

document.addEventListener(
    'DOMContentLoaded',
    iniciarAplicacao
);

async function iniciarAplicacao() {
    try {
        const sessaoValida =
            await verificarSessao();

        if (!sessaoValida) {
            esconderLoader();
            mostrarLogin();
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
        aplicarPermissoes();
        atualizarInfoBackup();

        document
            .getElementById('sistema')
            .hidden = false;

        esconderLoader();
    } catch (error) {
        console.error(error);
        esconderLoader();

        mostrarLogin(
            `Erro ao iniciar: ${obterMensagemErro(error)}`
        );
    }
}

async function verificarSessao() {
    const {
        data,
        error
    } = await supabaseClient.auth.getSession();

    if (error || !data.session) {
        return false;
    }

    const user =
        data.session.user;

    const {
        data: perfil,
        error: erroPerfil
    } = await supabaseClient
        .from('profiles')
        .select(
            'id, nome, email, role, ativo'
        )
        .eq('id', user.id)
        .maybeSingle();

    if (erroPerfil || !perfil) {
        return false;
    }

    if (perfil.ativo === false) {
        await supabaseClient.auth.signOut();
        return false;
    }

    usuarioLogado = {
        id: user.id,
        nome:
            perfil.nome ||
            user.email ||
            'Usuário',
        email:
            perfil.email ||
            user.email ||
            '',
        role:
            perfil.role ||
            'usuario',
        ativo:
            perfil.ativo !== false
    };

    return true;
}

function mostrarLogin(mensagem = '') {
    let overlay =
        document.getElementById(
            'loginOverlay'
        );

    if (!overlay) {
        overlay =
            document.createElement('div');

        overlay.id =
            'loginOverlay';

        overlay.className =
            'login-overlay';

        overlay.innerHTML = `
            <form id="loginForm" class="login-card">
                <div class="login-brand">
                    <span class="brand-icon">🚛</span>
                    <h1>BETAXLOG</h1>
                </div>

                <p class="login-subtitle">
                    Entre com seu usuário do Supabase.
                </p>

                <div
                    id="loginMessage"
                    class="login-message"
                    hidden>
                </div>

                <label for="loginEmail">
                    E-mail
                </label>

                <input
                    id="loginEmail"
                    type="email"
                    required
                    autocomplete="username">

                <label for="loginPassword">
                    Senha
                </label>

                <input
                    id="loginPassword"
                    type="password"
                    required
                    autocomplete="current-password">

                <button
                    class="btn btn-primary btn-block"
                    type="submit">
                    Entrar
                </button>
            </form>
        `;

        document.body.appendChild(overlay);

        document
            .getElementById('loginForm')
            .addEventListener(
                'submit',
                async event => {
                    event.preventDefault();
                    await realizarLogin();
                }
            );
    }

    const campo =
        document.getElementById(
            'loginMessage'
        );

    campo.textContent =
        mensagem;

    campo.hidden =
        !mensagem;
}

async function realizarLogin() {
    const email =
        document
            .getElementById('loginEmail')
            .value
            .trim();

    const password =
        document
            .getElementById('loginPassword')
            .value;

    const {
        error
    } = await supabaseClient.auth.signInWithPassword({
        email,
        password
    });

    if (error) {
        document
            .getElementById('loginMessage')
            .textContent =
            error.message;

        document
            .getElementById('loginMessage')
            .hidden = false;

        return;
    }

    window.location.reload();
}

async function fazerLogout() {
    await supabaseClient.auth.signOut();
    window.location.reload();
}

function configurarEventos() {
    document
        .getElementById('btnSair')
        .addEventListener(
            'click',
            fazerLogout
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
        .getElementById('btnPainelAdmin')
        .addEventListener(
            'click',
            abrirModalAdmin
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
        .getElementById('btnConfirmarDefinitiva')
        .addEventListener(
            'click',
            confirmarDefinitiva
        );

    document
        .getElementById('btnExcluirEscala')
        .addEventListener(
            'click',
            arquivarEscalaAtual
        );

    document
        .getElementById('btnBaixarImagem')
        .addEventListener(
            'click',
            baixarImagemEscala
        );

    document
        .getElementById('btnWhatsApp')
        .addEventListener(
            'click',
            compartilharWhatsApp
        );

    document
        .getElementById('btnExportarEscala')
        .addEventListener(
            'click',
            exportarEscalaExcel
        );

    document
        .getElementById('btnCadastrarMotorista')
        .addEventListener(
            'click',
            cadastrarMotorista
        );

    document
        .getElementById('arquivoExcel')
        .addEventListener(
            'change',
            importarExcel
        );

    document
        .getElementById('btnExportarMotoristas')
        .addEventListener(
            'click',
            exportarMotoristas
        );

    document
        .getElementById('filtroMotorista')
        .addEventListener(
            'input',
            renderizarMotoristas
        );

    document
        .getElementById('checkTodosMotoristas')
        .addEventListener(
            'change',
            selecionarTodosMotoristas
        );

    document
        .getElementById('btnExcluirSelecionados')
        .addEventListener(
            'click',
            arquivarMotoristasSelecionados
        );

    document
        .getElementById('btnSalvarEdicao')
        .addEventListener(
            'click',
            salvarEdicaoMotorista
        );

    document
        .getElementById('btnCancelarEdicao')
        .addEventListener(
            'click',
            fecharModalEdicao
        );

    document
        .getElementById('btnFecharEdicao')
        .addEventListener(
            'click',
            fecharModalEdicao
        );

    document
        .getElementById('buscaIndisponibilidade')
        .addEventListener(
            'input',
            renderizarIndisponibilidades
        );

    document
        .getElementById('btnMoverPrioridade')
        .addEventListener(
            'click',
            () => moverPrioridade(true)
        );

    document
        .getElementById('btnMoverRodizio')
        .addEventListener(
            'click',
            () => moverPrioridade(false)
        );

    document
        .getElementById('btnTodosRodizio')
        .addEventListener(
            'click',
            () => selecionarLista('listaNoRodizio')
        );

    document
        .getElementById('btnTodosPrioritarios')
        .addEventListener(
            'click',
            () => selecionarLista('listaPrioritarios')
        );

    document
        .getElementById('filtroAtalhoPeriodo')
        .addEventListener(
            'change',
            aplicarPeriodo
        );

    document
        .getElementById('btnGerarRelatorio')
        .addEventListener(
            'click',
            gerarRelatorio
        );

    document
        .getElementById('btnExportarPDF')
        .addEventListener(
            'click',
            exportarPDF
        );

    document
        .getElementById('btnFecharAdmin')
        .addEventListener(
            'click',
            fecharModalAdmin
        );

    document
        .getElementById('btnNovoUsuario')
        .addEventListener(
            'click',
            abrirNovoUsuario
        );

    document
        .getElementById('btnFecharNovoUsuario')
        .addEventListener(
            'click',
            fecharNovoUsuario
        );

    document
        .getElementById('btnCancelarNovoUsuario')
        .addEventListener(
            'click',
            fecharNovoUsuario
        );

    document
        .getElementById('btnSalvarNovoUsuario')
        .addEventListener(
            'click',
            salvarNovoUsuario
        );

    document
        .querySelectorAll('[data-admin-tab]')
        .forEach(botao => {
            botao.addEventListener(
                'click',
                () =>
                    abrirAbaAdmin(
                        botao.dataset.adminTab
                    )
            );
        });

    document
        .getElementById('dataEscala')
        .addEventListener(
            'change',
            carregarEscalaData
        );
}

function aplicarPermissoes() {
    const ehAdmin =
        usuarioLogado?.role === 'admin';

    document
        .getElementById('btnPainelAdmin')
        .hidden = !ehAdmin;

    document
        .getElementById('btnExcluirSelecionados')
        .disabled =
        !ehAdmin ||
        motoristasSelecionados.size === 0;
}

function alternarAba(nome) {
    const abas = {
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

    Object.entries(abas)
        .forEach(([chave, elemento]) => {
            elemento.hidden =
                chave !== nome;
        });

    document
        .querySelectorAll('.tab-btn')
        .forEach(botao => {
            botao.classList.remove('active');
        });

    const id =
        nome === 'operacional'
            ? 'btnAbaOperacional'
            : nome === 'motoristas'
                ? 'btnAbaMotoristas'
                : 'btnAbaRelatorios';

    document
        .getElementById(id)
        .classList.add('active');
}

async function carregarMotoristas() {
    const {
        data,
        error
    } = await supabaseClient
        .from('motoristas')
        .select('*')
        .eq('ativo', true)
        .is('deleted_at', null)
        .order('nome');

    if (error) {
        throw error;
    }

    motoristas =
        data || [];
}

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
        .is('deleted_at', null)
        .order('data', {
            ascending: false
        });

    if (error) {
        throw error;
    }

    escalas =
        data || [];

    historicoExecucoes =
        escalas.map(escala => ({
            data: escala.data,
            itens:
                escala.escala_itens || []
        }));
}

async function carregarIndisponibilidades() {
    const {
        data,
        error
    } = await supabaseClient
        .from('indisponibilidades')
        .select('*');

    if (error) {
        console.warn(error);
        indisponibilidades = [];
        return;
    }

    indisponibilidades =
        data || [];
}

function renderizarMotoristas() {
    const lista =
        document.getElementById(
            'listaMotoristasCheck'
        );

    const filtro =
        document
            .getElementById('filtroMotorista')
            .value
            .toLowerCase();

    lista.replaceChildren();

    const filtrados =
        motoristas.filter(motorista =>
            motorista.nome
                .toLowerCase()
                .includes(filtro)
        );

    document
        .getElementById(
            'contadorTotalMotoristas'
        )
        .textContent =
        `Total: ${motoristas.length}`;

    if (!filtrados.length) {
        lista.textContent =
            'Nenhum motorista encontrado.';
        atualizarContadorSelecionados();
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
            motoristasSelecionados.has(
                motorista.id
            );

        checkbox.addEventListener(
            'change',
            () => {
                if (checkbox.checked) {
                    motoristasSelecionados.add(
                        motorista.id
                    );
                } else {
                    motoristasSelecionados.delete(
                        motorista.id
                    );
                }

                atualizarContadorSelecionados();
            }
        );

        const nome =
            document.createElement('span');

        nome.textContent =
            `${motorista.nome} · ${
                motorista.veiculo || '-'
            }`;

        label.append(
            checkbox,
            nome
        );

        const acoes =
            document.createElement('div');

        const editar =
            document.createElement('button');

        editar.className =
            'btn btn-secondary btn-icon';

        editar.type =
            'button';

        editar.textContent =
            '✏️';

        editar.addEventListener(
            'click',
            () =>
                abrirModalEdicao(motorista)
        );

        const arquivar =
            document.createElement('button');

        arquivar.className =
            'btn btn-danger btn-icon';

        arquivar.type =
            'button';

        arquivar.textContent =
            '🗑️';

        arquivar.disabled =
            usuarioLogado?.role !== 'admin';

        arquivar.addEventListener(
            'click',
            () =>
                arquivarMotorista(motorista)
        );

        acoes.append(
            editar,
            arquivar
        );

        item.append(
            label,
            acoes
        );

        lista.appendChild(item);
    });

    atualizarContadorSelecionados();
}

function selecionarTodosMotoristas(event) {
    const filtro =
        document
            .getElementById('filtroMotorista')
            .value
            .toLowerCase();

    motoristas
        .filter(motorista =>
            motorista.nome
                .toLowerCase()
                .includes(filtro)
        )
        .forEach(motorista => {
            if (event.target.checked) {
                motoristasSelecionados.add(
                    motorista.id
                );
            } else {
                motoristasSelecionados.delete(
                    motorista.id
                );
            }
        });

    renderizarMotoristas();
}

function atualizarContadorSelecionados() {
    const quantidade =
        motoristasSelecionados.size;

    document
        .getElementById('contadorSelecionados')
        .textContent =
        `${quantidade} selecionado${
            quantidade === 1 ? '' : 's'
        }`;

    document
        .getElementById('btnExcluirSelecionados')
        .disabled =
        usuarioLogado?.role !== 'admin' ||
        quantidade === 0;
}

async function arquivarMotoristasSelecionados() {
    if (usuarioLogado?.role !== 'admin') {
        mostrarToast(
            'Somente administradores podem arquivar motoristas.',
            'error'
        );
        return;
    }

    const ids =
        [...motoristasSelecionados];

    if (!ids.length) {
        return;
    }

    if (!confirm(
        `Arquivar ${ids.length} motorista(s)?`
    )) {
        return;
    }

    const agora =
        new Date().toISOString();

    const {
        data,
        error
    } = await supabaseClient
        .from('motoristas')
        .update({
            ativo: false,
            deleted_at: agora,
            deleted_by:
                usuarioLogado.id,
            deleted_reason:
                'Arquivamento em massa',
            updated_at: agora
        })
        .in('id', ids)
        .select('id, nome');

    if (error) {
        mostrarToast(
            error.message,
            'error'
        );
        return;
    }

    for (const motorista of data || []) {
        await registrarAuditoria(
            'ARQUIVAR_MOTORISTA',
            'motorista',
            motorista.id,
            motorista.nome,
            {
                massa: true
            }
        );
    }

    motoristasSelecionados.clear();

    await carregarMotoristas();

    renderizarMotoristas();
    renderizarPrioridades();

    mostrarToast(
        'Motoristas arquivados.',
        'success'
    );
}

async function arquivarMotorista(motorista) {
    if (usuarioLogado?.role !== 'admin') {
        mostrarToast(
            'Somente administradores podem arquivar motoristas.',
            'error'
        );
        return;
    }

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
            deleted_at:
                new Date().toISOString(),
            deleted_by:
                usuarioLogado.id,
            deleted_reason:
                'Arquivamento individual',
            updated_at:
                new Date().toISOString()
        })
        .eq('id', motorista.id);

    if (error) {
        mostrarToast(
            error.message,
            'error'
        );
        return;
    }

    await registrarAuditoria(
        'ARQUIVAR_MOTORISTA',
        'motorista',
        motorista.id,
        motorista.nome,
        {
            massa: false
        }
    );

    await carregarMotoristas();

    renderizarMotoristas();
    renderizarPrioridades();

    mostrarToast(
        'Motorista arquivado.',
        'success'
    );
}

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

    const {
        data,
        error
    } = await supabaseClient
        .from('motoristas')
        .insert({
            nome,
            telefone,
            veiculo,
            prioridade: false,
            ativo: true,
            updated_at:
                new Date().toISOString()
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

    await registrarAuditoria(
        'CRIAR_MOTORISTA',
        'motorista',
        data.id,
        data.nome,
        {}
    );

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

function abrirModalEdicao(motorista) {
    document
        .getElementById('editarMotoristaId')
        .value =
        motorista.id;

    document
        .getElementById('editarNomeMotorista')
        .value =
        motorista.nome;

    document
        .getElementById('editarTelMotorista')
        .value =
        motorista.telefone || '';

    document
        .getElementById('editarTipoVeiculo')
        .value =
        motorista.veiculo || 'Utilitário';

    document
        .getElementById('modalEditarMotorista')
        .hidden = false;
}

function fecharModalEdicao() {
    document
        .getElementById('modalEditarMotorista')
        .hidden = true;
}

async function salvarEdicaoMotorista() {
    const id =
        document
            .getElementById('editarMotoristaId')
            .value;

    const nome =
        document
            .getElementById('editarNomeMotorista')
            .value
            .trim();

    const telefone =
        document
            .getElementById('editarTelMotorista')
            .value
            .trim();

    const veiculo =
        document
            .getElementById('editarTipoVeiculo')
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

    await registrarAuditoria(
        'EDITAR_MOTORISTA',
        'motorista',
        id,
        nome,
        {}
    );

    fecharModalEdicao();

    await carregarMotoristas();

    renderizarMotoristas();
    renderizarPrioridades();

    mostrarToast(
        'Motorista atualizado.',
        'success'
    );
}

async function importarExcel(event) {
    const arquivo =
        event.target.files[0];

    if (!arquivo || !window.XLSX) {
        return;
    }

    try {
        const buffer =
            await arquivo.arrayBuffer();

        const workbook =
            XLSX.read(buffer, {
                type: 'array'
            });

        const primeiraAba =
            workbook.Sheets[
                workbook.SheetNames[0]
            ];

        const linhas =
            XLSX.utils.sheet_to_json(
                primeiraAba,
                {
                    defval: ''
                }
            );

        let inseridos = 0;

        for (const linha of linhas) {
            const nome =
                linha.Nome ||
                linha.nome ||
                linha.Motorista ||
                linha.motorista;

            const telefone =
                linha.Telefone ||
                linha.telefone ||
                '';

            const veiculo =
                linha.Veiculo ||
                linha.veiculo ||
                'Utilitário';

            if (!nome) {
                continue;
            }

            const {
                data,
                error
            } = await supabaseClient
                .from('motoristas')
                .insert({
                    nome: String(nome).trim(),
                    telefone: String(
                        telefone
                    ).trim(),
                    veiculo:
                        TIPOS_VEICULO.includes(
                            veiculo
                        )
                            ? veiculo
                            : 'Utilitário',
                    prioridade: false,
                    ativo: true,
                    updated_at:
                        new Date().toISOString()
                })
                .select()
                .single();

            if (!error && data) {
                inseridos++;

                await registrarAuditoria(
                    'IMPORTAR_MOTORISTA',
                    'motorista',
                    data.id,
                    data.nome,
                    {}
                );
            }
        }

        await carregarMotoristas();

        renderizarMotoristas();
        renderizarPrioridades();

        mostrarToast(
            `${inseridos} motorista(s) importado(s).`,
            'success'
        );
    } catch (error) {
        mostrarToast(
            `Erro na importação: ${
                obterMensagemErro(error)
            }`,
            'error'
        );
    }

    event.target.value = '';
}

function exportarMotoristas() {
    if (!window.XLSX) {
        mostrarToast(
            'Biblioteca Excel não carregada.',
            'error'
        );
        return;
    }

    const linhas =
        motoristas.map(motorista => ({
            Nome: motorista.nome,
            Telefone:
                motorista.telefone || '',
            Veiculo:
                motorista.veiculo || '',
            Prioridade:
                motorista.prioridade
                    ? 'Sim'
                    : 'Não'
        }));

    const worksheet =
        XLSX.utils.json_to_sheet(linhas);

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

function renderizarPrioridades() {
    const rodizio =
        document.getElementById(
            'listaNoRodizio'
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

function selecionarLista(id) {
    document
        .getElementById(id)
        .querySelectorAll('option')
        .forEach(option => {
            option.selected = true;
        });
}

async function moverPrioridade(paraPrioridade) {
    const origem =
        document.getElementById(
            paraPrioridade
                ? 'listaNoRodizio'
                : 'listaPrioritarios'
        );

    const ids =
        [...origem.selectedOptions]
            .map(option => option.value);

    if (!ids.length) {
        return;
    }

    const {
        error
    } = await supabaseClient
        .from('motoristas')
        .update({
            prioridade:
                paraPrioridade,
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

    await registrarAuditoria(
        paraPrioridade
            ? 'DEFINIR_PRIORIDADE'
            : 'REMOVER_PRIORIDADE',
        'motorista',
        null,
        null,
        {
            ids
        }
    );

    await carregarMotoristas();
    renderizarPrioridades();

    mostrarToast(
        'Prioridade atualizada.',
        'success'
    );
}

function renderizarIndisponibilidades() {
    const lista =
        document.getElementById(
            'listaMotoristasIndisponiveis'
        );

    const filtro =
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

    lista.replaceChildren();

    motoristas
        .filter(motorista =>
            motorista.nome
                .toLowerCase()
                .includes(filtro)
        )
        .forEach(motorista => {
            const item =
                document.createElement(
                    'div'
                );

            item.className =
                'checkbox-item';

            const label =
                document.createElement(
                    'label'
                );

            const checkbox =
                document.createElement(
                    'input'
                );

            checkbox.type =
                'checkbox';

            checkbox.checked =
                indisponibilidades.some(
                    registro =>
                        registro.data === data &&
                        registro.motorista_id ===
                            motorista.id
                );

            checkbox.addEventListener(
                'change',
                () =>
                    alterarIndisponibilidade(
                        motorista,
                        data,
                        checkbox.checked
                    )
            );

            const nome =
                document.createElement(
                    'span'
                );

            nome.textContent =
                motorista.nome;

            label.append(
                checkbox,
                nome
            );

            item.appendChild(label);
            lista.appendChild(item);
        });
}

async function alterarIndisponibilidade(
    motorista,
    data,
    indisponivel
) {
    if (indisponivel) {
        const {
            data: registro,
            error
        } = await supabaseClient
            .from('indisponibilidades')
            .insert({
                data,
                motorista_id:
                    motorista.id
            })
            .select()
            .single();

        if (!error && registro) {
            indisponibilidades.push(registro);
        }
    } else {
        await supabaseClient
            .from('indisponibilidades')
            .delete()
            .eq('data', data)
            .eq(
                'motorista_id',
                motorista.id
            );

        indisponibilidades =
            indisponibilidades.filter(
                registro =>
                    !(
                        registro.data === data &&
                        registro.motorista_id ===
                            motorista.id
                    )
            );
    }
}

function gerarPrevia() {
    const data =
        document
            .getElementById('dataEscala')
            .value;

    if (!data) {
        mostrarToast(
            'Escolha a data da escala.',
            'error'
        );
        return;
    }

    const vagas = {
        'Utilitário':
            Number(
                document
                    .getElementById(
                        'vagasUtilitario'
                    )
                    .value
            ),
        'Van':
            Number(
                document
                    .getElementById(
                        'vagasVan'
                    )
                    .value
            ),
        'Carro de Passeio':
            Number(
                document
                    .getElementById(
                        'vagasPasseio'
                    )
                    .value
            )
    };

    const bloqueados =
        new Set(
            indisponibilidades
                .filter(
                    registro =>
                        registro.data === data
                )
                .map(
                    registro =>
                        registro.motorista_id
                )
        );

    const disponiveis =
        motoristas.filter(
            motorista =>
                !bloqueados.has(
                    motorista.id
                )
        );

    const usados = new Set();
    const itens = [];

    Object.entries(vagas)
        .forEach(
            ([veiculo, quantidade]) => {
                for (
                    let i = 0;
                    i < quantidade;
                    i++
                ) {
                    const motorista =
                        disponiveis.find(
                            item =>
                                item.veiculo ===
                                    veiculo &&
                                !usados.has(
                                    item.id
                                )
                        );

                    itens.push({
                        motoristaId:
                            motorista?.id ||
                            null,
                        nome:
                            motorista?.nome ||
                            'VAGA EM ABERTO',
                        veiculo,
                        onda: i + 1,
                        status: motorista
                            ? 'ativo'
                            : 'vaga_aberta'
                    });

                    if (motorista) {
                        usados.add(
                            motorista.id
                        );
                    }
                }
            }
        );

    escalaAtual = {
        id: null,
        data,
        status: 'previa',
        itens
    };

    renderizarEscala();

    document
        .getElementById('painelEscala')
        .hidden = false;

    document
        .getElementById('avisoPrevia')
        .hidden = false;

    document
        .getElementById(
            'btnConfirmarDefinitiva'
        )
        .disabled = true;
}

function renderizarEscala() {
    if (!escalaAtual) {
        return;
    }

    const corpo =
        document.getElementById(
            'tabelaEscalaBody'
        );

    corpo.replaceChildren();

    escalaAtual.itens.forEach(
        (item, index) => {
            const tr =
                document.createElement(
                    'tr'
                );

            if (
                item.status ===
                    'cancelado_amazon'
            ) {
                tr.classList.add(
                    'row-cancelada'
                );
            }

            const dados = [
                item.onda,
                item.nome,
                item.veiculo
            ];

            dados.forEach(valor => {
                const td =
                    document.createElement(
                        'td'
                    );

                td.textContent =
                    valor;

                tr.appendChild(td);
            });

            const onda =
                document.createElement(
                    'td'
                );

            const input =
                document.createElement(
                    'input'
                );

            input.className =
                'input-onda';

            input.type =
                'number';

            input.min = 1;

            input.value =
                item.onda;

            input.addEventListener(
                'change',
                () => {
                    item.onda =
                        Number(
                            input.value
                        ) || 1;
                }
            );

            onda.appendChild(input);

            const acoes =
                document.createElement(
                    'td'
                );

            const cancelar =
                document.createElement(
                    'button'
                );

            cancelar.className =
                'btn btn-danger btn-icon';

            cancelar.type =
                'button';

            cancelar.textContent =
                item.status ===
                    'cancelado_amazon'
                    ? '↩️'
                    : '✕';

            cancelar.title =
                item.status ===
                    'cancelado_amazon'
                    ? 'Reativar'
                    : 'Cancelar rota';

            cancelar.addEventListener(
                'click',
                () => {
                    item.status =
                        item.status ===
                            'cancelado_amazon'
                            ? 'ativo'
                            : 'cancelado_amazon';

                    renderizarEscala();
                }
            );

            acoes.appendChild(cancelar);

            tr.append(
                onda,
                acoes
            );

            corpo.appendChild(tr);
        }
    );

    document
        .getElementById(
            'dataSubtituloImagem'
        )
        .textContent =
        formatarData(
            escalaAtual.data
        );
}

async function salvarPrevia() {
    if (!escalaAtual) {
        mostrarToast(
            'Gere uma prévia primeiro.',
            'error'
        );
        return;
    }

    const {
        data: escala,
        error
    } = await supabaseClient
        .from('escalas')
        .upsert(
            {
                ...(escalaAtual.id
                    ? {
                        id: escalaAtual.id
                    }
                    : {}),
                data:
                    escalaAtual.data,
                status: 'previa',
                updated_at:
                    new Date().toISOString()
            },
            {
                onConflict: 'data'
            }
        )
        .select()
        .single();

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
            escala.id
        );

    const itens =
        escalaAtual.itens.map(item => ({
            escala_id: escala.id,
            motorista_id:
                item.motoristaId,
            nome: item.nome,
            veiculo: item.veiculo,
            onda: item.onda,
            status: item.status
        }));

    if (itens.length) {
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
    }

    escalaAtual.id =
        escala.id;

    escalaAtual.status =
        'previa';

    document
        .getElementById('avisoPrevia')
        .hidden = false;

    document
        .getElementById(
            'btnConfirmarDefinitiva'
        )
        .disabled = false;

    await carregarEscalas();

    await registrarAuditoria(
        'SALVAR_PREVIA',
        'escala',
        escala.id,
        escala.data,
        {}
    );

    mostrarToast(
        'Prévia salva.',
        'success'
    );
}

async function confirmarDefinitiva() {
    if (!escalaAtual?.id) {
        mostrarToast(
            'Salve a prévia antes de confirmar.',
            'error'
        );
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
        .eq(
            'id',
            escalaAtual.id
        );

    if (error) {
        mostrarToast(
            error.message,
            'error'
        );
        return;
    }

    escalaAtual.status =
        'definitiva';

    document
        .getElementById('avisoPrevia')
        .hidden = true;

    document
        .getElementById('tagStatus')
        .textContent =
        'DEFINITIVA';

    document
        .getElementById('tagStatus')
        .className =
        'badge-status badge-definitiva';

    await registrarAuditoria(
        'CONFIRMAR_ESCALA',
        'escala',
        escalaAtual.id,
        escalaAtual.data,
        {}
    );

    mostrarToast(
        'Escala confirmada.',
        'success'
    );
}

async function arquivarEscalaAtual() {
    if (
        usuarioLogado?.role !== 'admin'
    ) {
        mostrarToast(
            'Somente administrador pode arquivar escalas.',
            'error'
        );
        return;
    }

    if (!escalaAtual?.id) {
        mostrarToast(
            'Não existe uma escala salva.',
            'error'
        );
        return;
    }

    if (!confirm(
        `Arquivar a escala de ${
            formatarData(
                escalaAtual.data
            )
        }?`
    )) {
        return;
    }

    const {
        error
    } = await supabaseClient
        .from('escalas')
        .update({
            deleted_at:
                new Date().toISOString(),
            deleted_by:
                usuarioLogado.id,
            deleted_reason:
                'Arquivamento manual',
            updated_at:
                new Date().toISOString()
        })
        .eq(
            'id',
            escalaAtual.id
        );

    if (error) {
        mostrarToast(
            error.message,
            'error'
        );
        return;
    }

    await registrarAuditoria(
        'ARQUIVAR_ESCALA',
        'escala',
        escalaAtual.id,
        escalaAtual.data,
        {}
    );

    escalaAtual = null;

    document
        .getElementById('painelEscala')
        .hidden = true;

    await carregarEscalas();

    mostrarToast(
        'Escala arquivada.',
        'success'
    );
}

function carregarEscalaData() {
    const data =
        document
            .getElementById('dataEscala')
            .value;

    const escala =
        escalas.find(
            item =>
                item.data === data
        );

    if (!escala) {
        renderizarIndisponibilidades();
        return;
    }

    escalaAtual = {
        id: escala.id,
        data: escala.data,
        status: escala.status,
        itens:
            escala.escala_itens || []
    };

    renderizarEscala();

    document
        .getElementById('painelEscala')
        .hidden = false;

    document
        .getElementById('avisoPrevia')
        .hidden =
        escala.status === 'definitiva';

    document
        .getElementById(
            'btnConfirmarDefinitiva'
        )
        .disabled =
        escala.status === 'definitiva';

    renderizarIndisponibilidades();
}

async function baixarImagemEscala() {
    const area =
        document.getElementById(
            'areaCapturaImagem'
        );

    if (!window.html2canvas || !area) {
        mostrarToast(
            'Biblioteca de imagem não carregada.',
            'error'
        );
        return;
    }

    const canvas =
        await html2canvas(area);

    const link =
        document.createElement('a');

    link.download =
        `escala_${escalaAtual.data}.png`;

    link.href =
        canvas.toDataURL('image/png');

    link.click();
}

function compartilharWhatsApp() {
    if (!escalaAtual) {
        mostrarToast(
            'Gere uma escala primeiro.',
            'error'
        );
        return;
    }

    const linhas =
        escalaAtual.itens.map(item =>
            `${item.onda}. ${item.nome} - ${
                item.veiculo
            }`
        );

    const mensagem =
        `Escala BETAXLOG - ${
            formatarData(
                escalaAtual.data
            )
        }\n\n${linhas.join('\n')}`;

    window.open(
        `https://wa.me/?text=${
            encodeURIComponent(
                mensagem
            )
        }`,
        '_blank'
    );
}

function exportarEscalaExcel() {
    if (!window.XLSX || !escalaAtual) {
        mostrarToast(
            'Não há escala para exportar.',
            'error'
        );
        return;
    }

    const linhas =
        escalaAtual.itens.map(item => ({
            DSP: item.onda,
            Motorista: item.nome,
            Veiculo: item.veiculo,
            Status: item.status
        }));

    const worksheet =
        XLSX.utils.json_to_sheet(linhas);

    const workbook =
        XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
        workbook,
        worksheet,
        'Escala'
    );

    XLSX.writeFile(
        workbook,
        `escala_${escalaAtual.data}.xlsx`
    );
}

function gerarRelatorio() {
    const inicio =
        document
            .getElementById(
                'relatorioDataInicio'
            )
            .value;

    const fim =
        document
            .getElementById(
                'relatorioDataFim'
            )
            .value;

    const registros =
        historicoExecucoes.filter(
            registro =>
                registro.data >= inicio &&
                registro.data <= fim
        );

    let total = 0;
    let ativas = 0;
    let canceladas = 0;

    const ranking = {};
    const evolucao = {};
    const veiculos = {
        'Utilitário': 0,
        'Van': 0,
        'Carro de Passeio': 0
    };

    registros.forEach(registro => {
        evolucao[registro.data] = 0;

        registro.itens.forEach(item => {
            if (!item.motorista_id &&
                !item.motoristaId) {
                return;
            }

            total++;

            const cancelada =
                item.status ===
                    'cancelado_amazon' ||
                item.status === 'cancelado';

            if (cancelada) {
                canceladas++;
            } else {
                ativas++;
                evolucao[registro.data]++;
            }

            if (
                !cancelada &&
                veiculos[item.veiculo] !==
                    undefined
            ) {
                veiculos[item.veiculo]++;
            }

            const id =
                item.motorista_id ||
                item.motoristaId;

            if (!ranking[id]) {
                ranking[id] = {
                    nome:
                        item.nome ||
                        'Sem nome',
                    veiculo:
                        item.veiculo ||
                        '-',
                    escalas: 0,
                    cancelamentos: 0
                };
            }

            ranking[id].escalas++;

            if (cancelada) {
                ranking[id].cancelamentos++;
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
        `${total
            ? ((ativas / total) * 100)
                .toFixed(1)
            : 0}%`;

    const tbody =
        document.getElementById(
            'tabelaRankingBody'
        );

    tbody.replaceChildren();

    Object.values(ranking)
        .sort(
            (a, b) =>
                b.escalas - a.escalas
        )
        .forEach(item => {
            const tr =
                document.createElement('tr');

            const presenca =
                item.escalas
                    ? (
                        (
                            item.escalas -
                            item.cancelamentos
                        ) /
                        item.escalas *
                        100
                    ).toFixed(1)
                    : '0.0';

            [
                item.nome,
                item.veiculo,
                item.escalas,
                item.cancelamentos,
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

    atualizarGraficos(
        evolucao,
        veiculos
    );
}

function atualizarGraficos(
    evolucao,
    veiculos
) {
    if (!window.Chart) {
        return;
    }

    const canvasEvolucao =
        document.getElementById(
            'chartEvolucao'
        );

    if (canvasEvolucao) {
        chartEvolucaoInstancia?.destroy();

        chartEvolucaoInstancia =
            new Chart(
                canvasEvolucao,
                {
                    type: 'line',
                    data: {
                        labels:
                            Object.keys(
                                evolucao
                            ),
                        datasets: [{
                            label:
                                'Rotas ativas',
                            data:
                                Object.values(
                                    evolucao
                                ),
                            borderColor:
                                '#1e3a8a',
                            backgroundColor:
                                'rgba(30,58,138,.12)',
                            fill: true,
                            tension: .3
                        }]
                    }
                }
            );
    }

    const canvasVeiculos =
        document.getElementById(
            'chartVeiculos'
        );

    if (canvasVeiculos) {
        chartVeiculosInstancia?.destroy();

        chartVeiculosInstancia =
            new Chart(
                canvasVeiculos,
                {
                    type: 'doughnut',
                    data: {
                        labels:
                            Object.keys(
                                veiculos
                            ),
                        datasets: [{
                            data:
                                Object.values(
                                    veiculos
                                ),
                            backgroundColor: [
                                '#1e3a8a',
                                '#d97706',
                                '#059669'
                            ]
                        }]
                    }
                }
            );
    }
}

function aplicarPeriodo() {
    const valor =
        document
            .getElementById(
                'filtroAtalhoPeriodo'
            )
            .value;

    const hoje =
        new Date();

    let inicio =
        new Date(hoje);

    if (valor === 'mes_atual') {
        inicio =
            new Date(
                hoje.getFullYear(),
                hoje.getMonth(),
                1
            );
    }

    if (valor === 'sete_dias') {
        inicio.setDate(
            hoje.getDate() - 7
        );
    }

    if (valor === 'seis_meses') {
        inicio.setMonth(
            hoje.getMonth() - 6
        );
    }

    if (valor === 'ano_atual') {
        inicio =
            new Date(
                hoje.getFullYear(),
                0,
                1
            );
    }

    if (!valor) {
        return;
    }

    document
        .getElementById(
            'relatorioDataInicio'
        )
        .value =
        obterDataISO(inicio);

    document
        .getElementById(
            'relatorioDataFim'
        )
        .value =
        obterDataISO(hoje);
}

function exportarPDF() {
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

    const pdf =
        new jsPDF();

    pdf.text(
        'Relatório BETAXLOG',
        14,
        20
    );

    pdf.autoTable({
        html: '#tabelaRankingBody',
        startY: 30
    });

    pdf.save(
        `relatorio_${obterDataISO()}.pdf`
    );
}

function abrirModalAdmin() {
    if (usuarioLogado?.role !== 'admin') {
        mostrarToast(
            'Acesso restrito ao administrador.',
            'error'
        );
        return;
    }

    document
        .getElementById('modalAdmin')
        .hidden = false;

    abrirAbaAdmin('usuarios');
}

function fecharModalAdmin() {
    document
        .getElementById('modalAdmin')
        .hidden = true;
}

function abrirAbaAdmin(nome) {
    document
        .querySelectorAll('.admin-section')
        .forEach(secao => {
            secao.hidden =
                !secao.id.endsWith(
                    nome.charAt(0)
                        .toUpperCase() +
                    nome.slice(1)
                );
        });

    document
        .querySelectorAll('[data-admin-tab]')
        .forEach(botao => {
            botao.classList.toggle(
                'active',
                botao.dataset.adminTab ===
                    nome
            );
        });

    if (nome === 'usuarios') {
        carregarUsuariosAdmin();
    }

    if (nome === 'motoristas') {
        carregarMotoristasArquivados();
    }

    if (nome === 'escalas') {
        carregarEscalasArquivadas();
    }

    if (nome === 'auditoria') {
        carregarAuditoria();
    }
}

async function carregarUsuariosAdmin() {
    const lista =
        document.getElementById(
            'listaUsuariosCadastrados'
        );

    const {
        data,
        error
    } = await supabaseClient
        .from('profiles')
        .select(
            'id, nome, email, role, ativo'
        )
        .order('nome');

    lista.replaceChildren();

    if (error) {
        lista.textContent =
            error.message;
        return;
    }

    data.forEach(usuario => {
        const item =
            document.createElement('div');

        item.className =
            'admin-item';

        const info =
            document.createElement('span');

        info.textContent =
            `${usuario.nome || '-'} · ${
                usuario.email || '-'
            }`;

        const acoes =
            document.createElement('div');

        acoes.className =
            'admin-item-actions';

        const role =
            document.createElement('select');

        role.innerHTML = `
            <option value="admin">Administrador</option>
            <option value="operador">Operador</option>
            <option value="usuario">Usuário</option>
        `;

        role.value =
            usuario.role || 'usuario';

        const ativo =
            document.createElement('select');

        ativo.innerHTML = `
            <option value="true">Ativo</option>
            <option value="false">Inativo</option>
        `;

        ativo.value =
            String(usuario.ativo !== false);

        const salvar =
            document.createElement('button');

        salvar.className =
            'btn btn-primary';

        salvar.type =
            'button';

        salvar.textContent =
            'Salvar';

        salvar.addEventListener(
            'click',
            () =>
                atualizarUsuarioAdmin(
                    usuario,
                    role.value,
                    ativo.value === 'true'
                )
        );

        acoes.append(
            role,
            ativo,
            salvar
        );

        item.append(
            info,
            acoes
        );

        lista.appendChild(item);
    });
}

async function atualizarUsuarioAdmin(
    usuario,
    role,
    ativo
) {
    if (
        usuario.id === usuarioLogado.id &&
        (
            !ativo ||
            role !== 'admin'
        )
    ) {
        mostrarToast(
            'Você não pode remover seu próprio acesso.',
            'error'
        );
        return;
    }

    if (
        usuario.role === 'admin' &&
        role !== 'admin'
    ) {
        const {
            count
        } = await supabaseClient
            .from('profiles')
            .select(
                'id',
                {
                    count: 'exact',
                    head: true
                }
            )
            .eq(
                'role',
                'admin'
            )
            .eq(
                'ativo',
                true
            );

        if ((count || 0) <= 1) {
            mostrarToast(
                'O sistema precisa manter pelo menos um administrador ativo.',
                'error'
            );
            return;
        }
    }

    const {
        error
    } = await supabaseClient
        .from('profiles')
        .update({
            role,
            ativo,
            updated_at:
                new Date().toISOString()
        })
        .eq(
            'id',
            usuario.id
        );

    if (error) {
        mostrarToast(
            error.message,
            'error'
        );
        return;
    }

    await registrarAuditoria(
        'ATUALIZAR_USUARIO',
        'usuario',
        usuario.id,
        usuario.nome,
        {
            role,
            ativo
        }
    );

    await carregarUsuariosAdmin();

    mostrarToast(
        'Usuário atualizado.',
        'success'
    );
}

function abrirNovoUsuario() {
    document
        .getElementById('modalNovoUsuario')
        .hidden = false;
}

function fecharNovoUsuario() {
    document
        .getElementById('modalNovoUsuario')
        .hidden = true;
}

async function salvarNovoUsuario() {
    const id =
        document
            .getElementById('novoUsuarioId')
            .value
            .trim();

    const nome =
        document
            .getElementById('novoUsuarioNome')
            .value
            .trim();

    const email =
        document
            .getElementById('novoUsuarioEmail')
            .value
            .trim();

    const role =
        document
            .getElementById('novoUsuarioRole')
            .value;

    if (!id || !nome || !email) {
        mostrarToast(
            'Preencha nome, e-mail e UUID do Auth.',
            'error'
        );
        return;
    }

    const {
        data,
        error
    } = await supabaseClient
        .from('profiles')
        .insert({
            id,
            nome,
            email,
            role,
            ativo: true,
            updated_at:
                new Date().toISOString()
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

    await registrarAuditoria(
        'CRIAR_USUARIO',
        'usuario',
        data.id,
        data.nome,
        {
            role
        }
    );

    fecharNovoUsuario();

    document
        .getElementById('novoUsuarioId')
        .value = '';

    document
        .getElementById('novoUsuarioNome')
        .value = '';

    document
        .getElementById('novoUsuarioEmail')
        .value = '';

    await carregarUsuariosAdmin();

    mostrarToast(
        'Perfil de usuário criado.',
        'success'
    );
}

async function carregarMotoristasArquivados() {
    const lista =
        document.getElementById(
            'listaMotoristasExcluidos'
        );

    const {
        data,
        error
    } = await supabaseClient
        .from('motoristas')
        .select('*')
        .eq('ativo', false)
        .not(
            'deleted_at',
            'is',
            null
        )
        .order(
            'deleted_at',
            {
                ascending: false
            }
        );

    lista.replaceChildren();

    if (error) {
        lista.textContent =
            error.message;
        return;
    }

    data.forEach(motorista => {
        const item =
            document.createElement('div');

        item.className =
            'admin-item';

        const texto =
            document.createElement('span');

        texto.textContent =
            `${motorista.nome} · arquivado em ${
                formatarDataHora(
                    motorista.deleted_at
                )
            }`;

        const botao =
            document.createElement('button');

        botao.className =
            'btn btn-success';

        botao.textContent =
            'Restaurar';

        botao.addEventListener(
            'click',
            () =>
                restaurarMotorista(
                    motorista
                )
        );

        item.append(
            texto,
            botao
        );

        lista.appendChild(item);
    });
}

async function restaurarMotorista(
    motorista
) {
    const {
        error
    } = await supabaseClient
        .from('motoristas')
        .update({
            ativo: true,
            deleted_at: null,
            deleted_by: null,
            deleted_reason: null,
            updated_at:
                new Date().toISOString()
        })
        .eq(
            'id',
            motorista.id
        );

    if (error) {
        mostrarToast(
            error.message,
            'error'
        );
        return;
    }

    await registrarAuditoria(
        'RESTAURAR_MOTORISTA',
        'motorista',
        motorista.id,
        motorista.nome,
        {}
    );

    await carregarMotoristas();

    renderizarMotoristas();
    renderizarPrioridades();
    carregarMotoristasArquivados();

    mostrarToast(
        'Motorista restaurado.',
        'success'
    );
}

async function carregarEscalasArquivadas() {
    const lista =
        document.getElementById(
            'listaEscalasExcluidas'
        );

    const {
        data,
        error
    } = await supabaseClient
        .from('escalas')
        .select('*')
        .not(
            'deleted_at',
            'is',
            null
        )
        .order(
            'deleted_at',
            {
                ascending: false
            }
        );

    lista.replaceChildren();

    if (error) {
        lista.textContent =
            error.message;
        return;
    }

    data.forEach(escala => {
        const item =
            document.createElement('div');

        item.className =
            'admin-item';

        const texto =
            document.createElement('span');

        texto.textContent =
            `Escala de ${
                formatarData(
                    escala.data
                )
            }`;

        const botao =
            document.createElement('button');

        botao.className =
            'btn btn-success';

        botao.textContent =
            'Restaurar';

        botao.addEventListener(
            'click',
            () =>
                restaurarEscala(
                    escala
                )
        );

        item.append(
            texto,
            botao
        );

        lista.appendChild(item);
    });
}

async function restaurarEscala(escala) {
    const {
        error
    } = await supabaseClient
        .from('escalas')
        .update({
            deleted_at: null,
            deleted_by: null,
            deleted_reason: null,
            updated_at:
                new Date().toISOString()
        })
        .eq(
            'id',
            escala.id
        );

    if (error) {
        mostrarToast(
            error.message,
            'error'
        );
        return;
    }

    await registrarAuditoria(
        'RESTAURAR_ESCALA',
        'escala',
        escala.id,
        escala.data,
        {}
    );

    await carregarEscalas();
    carregarEscalasArquivadas();

    mostrarToast(
        'Escala restaurada.',
        'success'
    );
}

async function carregarAuditoria() {
    const tabela =
        document.getElementById(
            'tabelaAuditoriaBody'
        );

    const {
        data,
        error
    } = await supabaseClient
        .from('audit_logs')
        .select('*')
        .order(
            'created_at',
            {
                ascending: false
            }
        )
        .limit(300);

    tabela.replaceChildren();

    if (error) {
        const tr =
            document.createElement('tr');

        const td =
            document.createElement('td');

        td.colSpan = 4;
        td.textContent =
            error.message;

        tr.appendChild(td);
        tabela.appendChild(tr);
        return;
    }

    data.forEach(registro => {
        const tr =
            document.createElement('tr');

        [
            formatarDataHora(
                registro.created_at
            ),
            registro.user_name ||
                registro.user_id ||
                '-',
            registro.action ||
                '-',
            registro.entity_label ||
                registro.entity_type ||
                '-'
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

async function registrarAuditoria(
    action,
    entityType,
    entityId,
    entityLabel,
    details
) {
    if (!usuarioLogado) {
        return;
    }

    const {
        error
    } = await supabaseClient
        .from('audit_logs')
        .insert({
            user_id:
                usuarioLogado.id,
            user_name:
                usuarioLogado.nome,
            action,
            entity_type:
                entityType,
            entity_id:
                entityId,
            entity_label:
                entityLabel,
            details:
                details || {}
        });

    if (error) {
        console.error(
            'Erro de auditoria:',
            error
        );
    }
}

function configurarDatas() {
    const hoje =
        obterDataISO();

    document
        .getElementById('dataEscala')
        .value =
        hoje;

    document
        .getElementById('relatorioDataFim')
        .value =
        hoje;

    document
        .getElementById(
            'relatorioDataInicio'
        )
        .value =
        obterDataISO(
            new Date(
                new Date().getFullYear(),
                new Date().getMonth(),
                1
            )
        );
}

function atualizarInfoBackup() {
    document
        .getElementById(
            'infoUltimoBackup'
        )
        .textContent =
        `☁️ Supabase sincronizado em ${
            new Date().toLocaleString(
                'pt-BR'
            )
        }`;

    document
        .getElementById(
            'usuarioAtual'
        )
        .textContent =
        `${usuarioLogado.nome} · ${
            usuarioLogado.role
        }`;
}

function esconderLoader() {
    document
        .getElementById('appLoader')
        ?.remove();
}

function obterDataISO(
    data = new Date()
) {
    const ano =
        data.getFullYear();

    const mes =
        String(
            data.getMonth() + 1
        ).padStart(2, '0');

    const dia =
        String(
            data.getDate()
        ).padStart(2, '0');

    return `${ano}-${mes}-${dia}`;
}

function formatarData(valor) {
    if (!valor) {
        return '-';
    }

    const partes =
        String(valor).split('-');

    return partes.length === 3
        ? partes.reverse().join('/')
        : valor;
}

function formatarDataHora(valor) {
    if (!valor) {
        return '-';
    }

    return new Date(valor)
        .toLocaleString('pt-BR');
}

function obterMensagemErro(error) {
    return error?.message ||
        'Erro desconhecido.';
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
        5000
    );
}
