'use strict';

/*
============================================================
BETAXLOG — SCRIPT PRINCIPAL
============================================================

Este arquivo utiliza somente o Supabase.

Não utiliza:
- localStorage;
- sessionStorage;
- login fixo;
- senha fixa;
- service_role no navegador.

Tabelas esperadas no Supabase:
- profiles
- motoristas
- escalas
- escala_itens
- indisponibilidades
- audit_logs
*/

/* =========================================================
   CONFIGURAÇÃO DO SUPABASE
========================================================= */

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

let motoristasSelecionados =
    new Set();

let previaAtual = null;

let chartEvolucaoInstancia = null;

let chartVeiculosInstancia = null;

const TIPOS_VEICULO = [
    'Utilitário',
    'Van',
    'Carro de Passeio'
];

const MENSAGEM_CANCELAMENTO_AMAZON =
    'Olá! Sua rota de hoje foi cancelada pela Amazon. Em caso de falta de outro motorista ou necessidade de rota extra, entraremos em contato para acioná-lo(a). Obrigado pela compreensão!';

/* =========================================================
   INICIALIZAÇÃO
========================================================= */

window.addEventListener(
    'DOMContentLoaded',
    iniciarAplicacao
);

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
                'Cole no script.js a chave pública completa do Supabase.'
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

        mostrarSistema();
        aplicarPermissoes();
        atualizarInfoBackup();

        esconderLoader();
    } catch (error) {
        console.error(
            'Erro ao iniciar:',
            error
        );

        esconderLoader();

        mostrarLogin(
            `Erro ao iniciar o sistema: ${obterMensagemErro(error)}`
        );
    }
}

function configuracaoValida() {
    const urlValida =
        Boolean(
            SUPABASE_URL &&
            SUPABASE_URL.startsWith('https://') &&
            SUPABASE_URL.includes('.supabase.co')
        );

    const chaveValida =
        Boolean(
            SUPABASE_ANON_KEY &&
            !SUPABASE_ANON_KEY.includes(
                'COLE_AQUI'
            ) &&
            !SUPABASE_ANON_KEY.includes(
                'SUA_CHAVE'
            )
        );

    return urlValida && chaveValida;
}

function mostrarSistema() {
    const sistema =
        document.getElementById('sistema');

    if (sistema) {
        sistema.hidden = false;
    }
}

function esconderLoader() {
    document
        .getElementById('appLoader')
        ?.remove();
}

function obterMensagemErro(error) {
    return error?.message ||
        'Erro desconhecido.';
}

/* =========================================================
   LOGIN
========================================================= */

async function verificarSessao() {
    const {
        data,
        error
    } = await supabaseClient.auth.getSession();

    if (error) {
        mostrarLogin(
            `Erro ao consultar o Supabase: ${
                obterMensagemErro(error)
            }`
        );

        return false;
    }

    if (!data.session) {
        mostrarLogin();
        return false;
    }

    const {
        data: perfil,
        error: erroPerfil
    } = await supabaseClient
        .from('profiles')
        .select(
            'id, nome, email, role, ativo'
        )
        .eq('id', data.session.user.id)
        .maybeSingle();

    if (erroPerfil) {
        console.error(erroPerfil);

        mostrarLogin(
            'Não foi possível consultar o perfil do usuário.'
        );

        return false;
    }

    if (!perfil) {
        mostrarLogin(
            'O usuário existe no Auth, mas não possui registro na tabela profiles.'
        );

        return false;
    }

    if (perfil.ativo === false) {
        await supabaseClient.auth.signOut();

        mostrarLogin(
            'Este usuário está desativado.'
        );

        return false;
    }

    usuarioLogado = {
        id: data.session.user.id,
        email:
            perfil.email ||
            data.session.user.email ||
            '',
        nome:
            perfil.nome ||
            data.session.user.email ||
            'Usuário',
        role:
            perfil.role ||
            'usuario',
        ativo:
            perfil.ativo !== false
    };

    const campoUsuario =
        document.getElementById(
            'usuarioAtual'
        );

    if (campoUsuario) {
        campoUsuario.textContent =
            `${usuarioLogado.nome} · ` +
            `${usuarioLogado.role}`;
    }

    removerLogin();
    aplicarPermissoes();

    return true;
}

function mostrarLogin(mensagem = '') {
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
            <form
                id="formLogin"
                class="login-card">

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
                    autocomplete="username"
                    placeholder="seu@email.com"
                    required>

                <label for="loginSenha">
                    Senha
                </label>

                <input
                    id="loginSenha"
                    type="password"
                    autocomplete="current-password"
                    placeholder="Sua senha"
                    required>

                <button
                    id="btnLogin"
                    class="btn btn-primary btn-block"
                    type="submit">
                    Entrar
                </button>
            </form>
        `;

        document.body.appendChild(overlay);

        document
            .getElementById('formLogin')
            .addEventListener(
                'submit',
                event => {
                    event.preventDefault();
                    executarLogin();
                }
            );
    }

    overlay.hidden = false;
    overlay.style.display = 'flex';

    const campoMensagem =
        document.getElementById(
            'loginMensagem'
        );

    if (campoMensagem) {
        campoMensagem.textContent =
            mensagem;

        campoMensagem.hidden =
            !mensagem;

        campoMensagem.classList.toggle(
            'info',
            mensagem.toLowerCase().includes(
                'chave'
            )
        );
    }
}

function removerLogin() {
    const overlay =
        document.getElementById(
            'modalLoginOverlay'
        );

    if (overlay) {
        overlay.remove();
    }
}

async function executarLogin() {
    const email =
        document
            .getElementById('loginEmail')
            ?.value
            .trim()
            .toLowerCase();

    const senha =
        document
            .getElementById('loginSenha')
            ?.value || '';

    const botao =
        document.getElementById('btnLogin');

    if (!email || !senha) {
        mostrarMensagemLogin(
            'Informe o e-mail e a senha.'
        );

        return;
    }

    if (botao) {
        botao.disabled = true;
        botao.textContent = 'Entrando...';
    }

    const {
        error
    } = await supabaseClient.auth.signInWithPassword({
        email,
        password: senha
    });

    if (error) {
        if (botao) {
            botao.disabled = false;
            botao.textContent = 'Entrar';
        }

        mostrarMensagemLogin(
            traduzirErroLogin(error)
        );

        return;
    }

    window.location.reload();
}

function mostrarMensagemLogin(mensagem) {
    const campo =
        document.getElementById(
            'loginMensagem'
        );

    if (campo) {
        campo.textContent =
            mensagem;

        campo.hidden = false;
    }
}

function traduzirErroLogin(error) {
    const mensagem =
        String(
            error?.message || ''
        ).toLowerCase();

    if (
        mensagem.includes(
            'invalid login credentials'
        )
    ) {
        return 'E-mail ou senha inválidos.';
    }

    if (
        mensagem.includes(
            'email not confirmed'
        )
    ) {
        return 'O e-mail ainda não foi confirmado.';
    }

    if (
        mensagem.includes(
            'failed to fetch'
        )
    ) {
        return 'Não foi possível conectar ao Supabase.';
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

/* =========================================================
   EVENTOS
========================================================= */

function configurarEventos() {
    document
        .getElementById('btnSair')
        ?.addEventListener(
            'click',
            fazerLogout
        );

    document
        .getElementById('btnPainelAdmin')
        ?.addEventListener(
            'click',
            abrirModalAdmin
        );

    document
        .getElementById('btnAbaOperacional')
        ?.addEventListener(
            'click',
            () =>
                alternarAba('operacional')
        );

    document
        .getElementById('btnAbaMotoristas')
        ?.addEventListener(
            'click',
            () =>
                alternarAba('motoristas')
        );

    document
        .getElementById('btnAbaRelatorios')
        ?.addEventListener(
            'click',
            () =>
                alternarAba('relatorios')
        );

    document
        .getElementById('btnGerarPrevia')
        ?.addEventListener(
            'click',
            gerarPrevia
        );

    document
        .getElementById('btnSalvarPrevia')
        ?.addEventListener(
            'click',
            salvarPrevia
        );

    document
        .getElementById('btnConfirmarDefinitiva')
        ?.addEventListener(
            'click',
            confirmarDefinitiva
        );

    document
        .getElementById('btnExcluirEscala')
        ?.addEventListener(
            'click',
            excluirEscalaAtual
        );

    document
        .getElementById('btnBaixarImagem')
        ?.addEventListener(
            'click',
            gerarImagemEscalaECompartilhar
        );

    document
        .getElementById('btnWhatsApp')
        ?.addEventListener(
            'click',
            compartilharWhatsAppTexto
        );

    document
        .getElementById('btnExportarEscala')
        ?.addEventListener(
            'click',
            exportarExcel
        );

    document
        .getElementById('btnCadastrarMotorista')
        ?.addEventListener(
            'click',
            cadastrarMotorista
        );

    document
        .getElementById('arquivoExcel')
        ?.addEventListener(
            'change',
            importarExcel
        );

    document
        .getElementById('btnExportarMotoristas')
        ?.addEventListener(
            'click',
            exportarBackupMotoristas
        );

    document
        .getElementById('filtroMotorista')
        ?.addEventListener(
            'input',
            renderizarMotoristas
        );

    document
        .getElementById('checkTodosMotoristas')
        ?.addEventListener(
            'change',
            selecionarTodosMotoristas
        );

    document
        .getElementById('btnExcluirSelecionados')
        ?.addEventListener(
            'click',
            excluirMotoristasSelecionados
        );

    document
        .getElementById('buscaIndisponibilidade')
        ?.addEventListener(
            'input',
            renderizarIndisponibilidades
        );

    document
        .getElementById('dataEscala')
        ?.addEventListener(
            'change',
            async () => {
                await carregarIndisponibilidades();

                renderizarIndisponibilidades();
                carregarEscalaData();
            }
        );

    document
        .getElementById('btnTodosRodizio')
        ?.addEventListener(
            'click',
            () =>
                selecionarTodos(
                    'listaRodizio'
                )
        );

    document
        .getElementById('btnTodosPrioritarios')
        ?.addEventListener(
            'click',
            () =>
                selecionarTodos(
                    'listaPrioritarios'
                )
        );

    document
        .getElementById('btnMoverPrioridade')
        ?.addEventListener(
            'click',
            () =>
                alterarPrioridade(true)
        );

    document
        .getElementById('btnMoverRodizio')
        ?.addEventListener(
            'click',
            () =>
                alterarPrioridade(false)
        );

    document
        .getElementById('btnCancelarEdicao')
        ?.addEventListener(
            'click',
            fecharModalEdicao
        );

    document
        .getElementById('formEdicao')
        ?.addEventListener(
            'submit',
            event => {
                event.preventDefault();
                salvarEdicaoMotorista();
            }
        );

    document
        .getElementById('btnFecharAdmin')
        ?.addEventListener(
            'click',
            fecharModalAdmin
        );

    document
        .getElementById('btnGerarRelatorio')
        ?.addEventListener(
            'click',
            gerarRelatorioHistorico
        );

    document
        .getElementById('btnExportarPDF')
        ?.addEventListener(
            'click',
            exportarRelatorioPDF
        );

    document
        .getElementById('filtroAtalhoPeriodo')
        ?.addEventListener(
            'change',
            aplicarAtalhoPeriodo
        );

    document
        .querySelectorAll('.admin-tab')
        .forEach(botao => {
            botao.addEventListener(
                'click',
                () => {
                    document
                        .querySelectorAll(
                            '.admin-tab'
                        )
                        .forEach(item =>
                            item.classList.remove(
                                'active'
                            )
                        );

                    botao.classList.add('active');

                    alternarAbaAdmin(
                        botao.dataset.adminView
                    );
                }
            );
        });

    document.addEventListener(
        'keydown',
        event => {
            if (event.key === 'Escape') {
                fecharModalAdmin();
                fecharModalEdicao();
            }
        }
    );
}

/* =========================================================
   ABAS
========================================================= */

function alternarAba(nome) {
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

    Object.values(views).forEach(
        view => {
            if (view) {
                view.hidden = true;
            }
        }
    );

    Object.values(botoes).forEach(
        botao => {
            if (botao) {
                botao.classList.remove(
                    'active'
                );
            }
        }
    );

    if (views[nome]) {
        views[nome].hidden = false;
    }

    if (botoes[nome]) {
        botoes[nome].classList.add(
            'active'
        );
    }

    if (nome === 'relatorios') {
        gerarRelatorioHistorico();
    }
}

/* =========================================================
   MOTORISTAS
========================================================= */

async function carregarMotoristas() {
    const {
        data,
        error
    } = await supabaseClient
        .from('motoristas')
        .select('*')
        .eq('ativo', true)
        .is('deleted_at', null)
        .order('nome', {
            ascending: true
        });

    if (error) {
        throw error;
    }

    motoristas =
        data || [];

    const idsAtuais =
        new Set(
            motoristas.map(item => item.id)
        );

    motoristasSelecionados =
        new Set(
            Array.from(
                motoristasSelecionados
            ).filter(id =>
                idsAtuais.has(id)
            )
        );
}

function renderizarMotoristas() {
    const lista =
        document.getElementById(
            'listaMotoristasCheck'
        );

    if (!lista) return;

    const filtro =
        document
            .getElementById(
                'filtroMotorista'
            )
            ?.value
            .toLowerCase()
            .trim() || '';

    const filtrados =
        motoristas.filter(item =>
            String(item.nome || '')
                .toLowerCase()
                .includes(filtro)
        );

    lista.replaceChildren();

    const total =
        document.getElementById(
            'contadorTotalMotoristas'
        );

    if (total) {
        total.textContent =
            `Total: ${motoristas.length}`;
    }

    if (!filtrados.length) {
        const vazio =
            document.createElement('p');

        vazio.className =
            'helper-text';

        vazio.textContent =
            'Nenhum motorista encontrado.';

        lista.appendChild(vazio);

        atualizarContadorSelecionados();
        return;
    }

    filtrados.forEach(
        motorista => {
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
                motoristasSelecionados
                    .has(motorista.id);

            checkbox.addEventListener(
                'change',
                event =>
                    atualizarSelecaoMotorista(
                        motorista.id,
                        event.target.checked
                    )
            );

            const texto =
                document.createElement(
                    'span'
                );

            texto.textContent =
                `${motorista.nome} · ` +
                `${motorista.veiculo}`;

            label.append(
                checkbox,
                texto
            );

            const botoes =
                document.createElement(
                    'span'
                );

            const editar =
                document.createElement(
                    'button'
                );

            editar.type =
                'button';

            editar.className =
                'btn btn-secondary btn-icon';

            editar.textContent =
                '✏️';

            editar.title =
                'Editar motorista';

            editar.addEventListener(
                'click',
                () =>
                    abrirEdicaoMotorista(
                        motorista.id
                    )
            );

            botoes.appendChild(editar);

            if (
                usuarioLogado?.role ===
                'admin'
            ) {
                const excluir =
                    document.createElement(
                        'button'
                    );

                excluir.type =
                    'button';

                excluir.className =
                    'btn btn-danger btn-icon';

                excluir.textContent =
                    '🗑️';

                excluir.title =
                    'Excluir motorista';

                excluir.addEventListener(
                    'click',
                    () =>
                        arquivarMotorista(
                            motorista
                        )
                );

                botoes.appendChild(
                    excluir
                );
            }

            item.append(
                label,
                botoes
            );

            lista.appendChild(item);
        }
    );

    atualizarContadorSelecionados();
}

function atualizarSelecaoMotorista(
    id,
    selecionado
) {
    if (selecionado) {
        motoristasSelecionados.add(id);
    } else {
        motoristasSelecionados.delete(id);
    }

    atualizarContadorSelecionados();
}

function atualizarContadorSelecionados() {
    const contador =
        document.getElementById(
            'contadorSelecionados'
        );

    const botao =
        document.getElementById(
            'btnExcluirSelecionados'
        );

    const quantidade =
        motoristasSelecionados.size;

    if (contador) {
        contador.textContent =
            `${quantidade} motorista${
                quantidade === 1 ? '' : 's'
            } selecionado${
                quantidade === 1 ? '' : 's'
            }`;
    }

    if (botao) {
        botao.disabled =
            quantidade === 0 ||
            usuarioLogado?.role !== 'admin';
    }
}

function selecionarTodosMotoristas(event) {
    const selecionado =
        event.target.checked;

    const filtro =
        document
            .getElementById(
                'filtroMotorista'
            )
            ?.value
            .toLowerCase()
            .trim() || '';

    motoristas
        .filter(item =>
            String(item.nome || '')
                .toLowerCase()
                .includes(filtro)
        )
        .forEach(item => {
            if (selecionado) {
                motoristasSelecionados.add(
                    item.id
                );
            } else {
                motoristasSelecionados.delete(
                    item.id
                );
            }
        });

    renderizarMotoristas();
}

async function cadastrarMotorista() {
    const nome =
        document
            .getElementById(
                'nomeMotorista'
            )
            ?.value
            .trim();

    const telefone =
        document
            .getElementById(
                'telMotorista'
            )
            ?.value
            .trim();

    const veiculo =
        document
            .getElementById(
                'tipoVeiculo'
            )
            ?.value;

    if (!nome) {
        mostrarToast(
            'Informe o nome do motorista.',
            'error'
        );

        return;
    }

    if (
        !TIPOS_VEICULO.includes(veiculo)
    ) {
        mostrarToast(
            'Selecione um veículo válido.',
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
            telefone: telefone || '',
            veiculo,
            prioridade: false,
            ativo: true
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
        data?.id || null,
        nome,
        {
            telefone,
            veiculo
        }
    );

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

async function importarExcel(event) {
    const arquivo =
        event.target.files?.[0];

    if (!arquivo) return;

    if (!window.XLSX) {
        mostrarToast(
            'Biblioteca Excel não carregada.',
            'error'
        );

        event.target.value = '';
        return;
    }

    try {
        const buffer =
            await arquivo.arrayBuffer();

        const workbook =
            XLSX.read(
                buffer,
                {
                    type: 'array'
                }
            );

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

        if (!linhas.length) {
            throw new Error(
                'A planilha está vazia.'
            );
        }

        let inseridos = 0;
        let ignorados = 0;

        for (const linha of linhas) {
            const nome =
                obterValorColuna(
                    linha,
                    [
                        'Nome',
                        'nome',
                        'Motorista',
                        'motorista'
                    ]
                ).trim();

            const telefone =
                obterValorColuna(
                    linha,
                    [
                        'Telefone',
                        'telefone',
                        'Celular',
                        'celular'
                    ]
                ).trim();

            let veiculo =
                obterValorColuna(
                    linha,
                    [
                        'Veiculo',
                        'Veículo',
                        'veiculo',
                        'vehicle'
                    ]
                ).trim();

            veiculo =
                normalizarVeiculo(veiculo);

            if (
                !nome ||
                !TIPOS_VEICULO.includes(veiculo)
            ) {
                ignorados++;
                continue;
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
                console.error(
                    'Erro ao inserir linha:',
                    error
                );

                ignorados++;
                continue;
            }

            inseridos++;
        }

        await registrarAuditoria(
            'IMPORTAR_MOTORISTAS_EXCEL',
            'motorista',
            null,
            arquivo.name,
            {
                inseridos,
                ignorados,
                arquivo: arquivo.name
            }
        );

        await carregarMotoristas();

        renderizarMotoristas();
        renderizarPrioridades();

        mostrarToast(
            `Importação concluída: ${inseridos} inseridos e ${ignorados} ignorados.`,
            inseridos
                ? 'success'
                : 'error'
        );
    } catch (error) {
        mostrarToast(
            obterMensagemErro(error),
            'error'
        );
    }

    event.target.value = '';
}

function obterValorColuna(
    linha,
    nomes
) {
    for (const nome of nomes) {
        if (
            Object.prototype.hasOwnProperty
                .call(linha, nome)
        ) {
            return String(
                linha[nome] ?? ''
            );
        }
    }

    return '';
}

function normalizarVeiculo(valor) {
    const texto =
        String(valor || '')
            .trim()
            .toLowerCase();

    if (
        texto.includes('util')
    ) {
        return 'Utilitário';
    }

    if (
        texto.includes('van')
    ) {
        return 'Van';
    }

    if (
        texto.includes('passeio') ||
        texto.includes('carro')
    ) {
        return 'Carro de Passeio';
    }

    return valor;
}

async function arquivarMotorista(motorista) {
    if (usuarioLogado?.role !== 'admin') {
        mostrarToast(
            'Somente administradores podem excluir motoristas.',
            'error'
        );

        return;
    }

    if (!confirm(
        `Você está prestes a excluir o motorista ${motorista.nome}.\n\nEsta operação será registrada na auditoria.`
    )) {
        return;
    }

    const motivo =
        prompt(
            'Informe o motivo da exclusão:'
        );

    if (motivo === null) {
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
                motivo.trim() || null,
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

    motoristasSelecionados.delete(
        motorista.id
    );

    await registrarAuditoria(
        'ARQUIVAR_MOTORISTA',
        'motorista',
        motorista.id,
        motorista.nome,
        {
            motivo:
                motivo.trim() || null
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

async function excluirMotoristasSelecionados() {
    if (usuarioLogado?.role !== 'admin') {
        mostrarToast(
            'Somente administradores podem excluir motoristas.',
            'error'
        );

        return;
    }

    const ids =
        Array.from(
            motoristasSelecionados
        );

    if (!ids.length) {
        mostrarToast(
            'Selecione pelo menos um motorista.',
            'error'
        );

        return;
    }

    const quantidade =
        ids.length;

    const confirmacao =
        `Você está prestes a excluir ${quantidade} motorista${
            quantidade === 1 ? '' : 's'
        }.\n\n` +
        'Esta operação será registrada no histórico de auditoria.\n\n' +
        'Deseja continuar?';

    if (!confirm(confirmacao)) {
        return;
    }

    const motivo =
        prompt(
            'Informe o motivo da exclusão em massa:'
        );

    if (motivo === null) {
        return;
    }

    const agora =
        new Date().toISOString();

    const {
        error
    } = await supabaseClient
        .from('motoristas')
        .update({
            ativo: false,
            deleted_at: agora,
            deleted_by:
                usuarioLogado.id,
            deleted_reason:
                motivo.trim() || null,
            updated_at: agora
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

    await registrarAuditoria(
        'ARQUIVAR_MOTORISTAS_EM_MASSA',
        'motorista',
        null,
        `${quantidade} motoristas`,
        {
            ids,
            quantidade,
            motivo:
                motivo.trim() || null
        }
    );

    motoristasSelecionados.clear();

    const todos =
        document.getElementById(
            'checkTodosMotoristas'
        );

    if (todos) {
        todos.checked = false;
    }

    await carregarMotoristas();

    renderizarMotoristas();
    renderizarPrioridades();

    mostrarToast(
        `${quantidade} motorista${
            quantidade === 1 ? '' : 's'
        } arquivado${
            quantidade === 1 ? '' : 's'
        }.`,
        'success'
    );
}

/* =========================================================
   EDIÇÃO DE MOTORISTAS
========================================================= */

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
    ).value = motorista.nome || '';

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
            'Informe o nome do motorista.',
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
        {
            telefone,
            veiculo
        }
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

/* =========================================================
   PRIORIDADE E RODÍZIO
========================================================= */

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

    motoristas.forEach(
        motorista => {
            const option =
                document.createElement(
                    'option'
                );

            option.value =
                motorista.id;

            option.textContent =
                motorista.nome;

            if (motorista.prioridade) {
                prioritarios.appendChild(
                    option
                );
            } else {
                rodizio.appendChild(
                    option
                );
            }
        }
    );
}

function selecionarTodos(id) {
    const select =
        document.getElementById(id);

    if (!select) return;

    Array
        .from(select.options)
        .forEach(option => {
            option.selected = true;
        });
}

async function alterarPrioridade(valor) {
    const origem =
        valor
            ? 'listaRodizio'
            : 'listaPrioritarios';

    const select =
        document.getElementById(origem);

    if (!select) return;

    const ids =
        Array
            .from(select.selectedOptions)
            .map(option =>
                option.value
            );

    if (!ids.length) {
        mostrarToast(
            'Selecione pelo menos um motorista.',
            'error'
        );

        return;
    }

    const {
        error
    } = await supabaseClient
        .from('motoristas')
        .update({
            prioridade: valor,
            updated_at:
                new Date().toISOString()
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

    await registrarAuditoria(
        valor
            ? 'DEFINIR_PRIORIDADE'
            : 'RETIRAR_PRIORIDADE',
        'motorista',
        null,
        null,
        {
            ids
        }
    );

    await carregarMotoristas();

    renderizarMotoristas();
    renderizarPrioridades();

    mostrarToast(
        'Prioridade atualizada.',
        'success'
    );
}

/* =========================================================
   INDISPONIBILIDADE
========================================================= */

async function carregarIndisponibilidades() {
    const data =
        document
            .getElementById(
                'dataEscala'
            )
            ?.value;

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
        document
            .getElementById(
                'listaMotoristasIndisponiveis'
            );

    const data =
        document
            .getElementById(
                'dataEscala'
            )
            ?.value;

    if (!lista || !data) {
        return;
    }

    const filtro =
        document
            .getElementById(
                'buscaIndisponibilidade'
            )
            ?.value
            .toLowerCase()
            .trim() || '';

    const marcados =
        indisponibilidades[data] || [];

    lista.replaceChildren();

    motoristas
        .filter(item =>
            String(item.nome || '')
                .toLowerCase()
                .includes(filtro)
        )
        .forEach(
            motorista => {
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
                    marcados.includes(
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
                    document.createElement(
                        'span'
                    );

                texto.textContent =
                    `${motorista.nome} · ` +
                    `${motorista.veiculo}`;

                label.append(
                    checkbox,
                    texto
                );

                item.appendChild(label);
                lista.appendChild(item);
            }
        );
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
    renderizarIndisponibilidades();

    await registrarAuditoria(
        indisponivel
            ? 'MARCAR_INDISPONIBILIDADE'
            : 'REMOVER_INDISPONIBILIDADE',
        'indisponibilidade',
        motoristaId,
        data
    );
}

/* =========================================================
   ESCALAS
========================================================= */

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

    escalas = {};
    historicoExecucoes = [];

    (data || []).forEach(
        escala => {
            const itens =
                (escala.escala_itens || [])
                    .sort(
                        (a, b) =>
                            (a.ordem || 0) -
                            (b.ordem || 0)
                    )
                    .map(item => ({
                        id: item.id,
                        dsp:
                            item.dsp ||
                            'BETAXLOG',
                        nome:
                            item.nome_snapshot ||
                            '',
                        telefone:
                            item.telefone_snapshot ||
                            '',
                        motoristaId:
                            item.motorista_id,
                        veiculo:
                            item.veiculo ||
                            '',
                        onda:
                            item.onda ||
                            '',
                        status:
                            item.status ||
                            'ativo'
                    }));

            escalas[escala.data] = {
                id: escala.id,
                data: escala.data,
                status: escala.status,
                vagas: {
                    utilitario:
                        escala.vagas_utilitario ||
                        0,
                    van:
                        escala.vagas_van ||
                        0,
                    passeio:
                        escala.vagas_passeio ||
                        0
                },
                itens
            };

            if (
                escala.status ===
                'definitiva'
            ) {
                historicoExecucoes.push({
                    data: escala.data,
                    itens: JSON.parse(
                        JSON.stringify(itens)
                    )
                });
            }
        }
    );
}

function carregarEscalaData() {
    const data =
        document
            .getElementById(
                'dataEscala'
            )
            ?.value;

    const painel =
        document.getElementById(
            'painelEscala'
        );

    if (!painel) return;

    const escala =
        escalas[data];

    if (!escala) {
        painel.hidden = true;
        previaAtual = null;
        return;
    }

    painel.hidden = false;
    previaAtual = null;

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

    renderizarTabelaEscala(
        escala.itens,
        escala.status
    );

    const definitiva =
        escala.status ===
        'definitiva';

    document.getElementById(
        'btnConfirmarDefinitiva'
    ).disabled =
        definitiva;

    document.getElementById(
        'btnBaixarImagem'
    ).disabled =
        false;

    document.getElementById(
        'avisoEscala'
    ).hidden =
        definitiva;

    document.getElementById(
        'dataSubtituloImagem'
    ).textContent =
        `Data: ${formatarData(data)}`;
}

async function gerarPrevia() {
    const data =
        document
            .getElementById(
                'dataEscala'
            )
            .value;

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

    if (!data) {
        mostrarToast(
            'Informe a data da escala.',
            'error'
        );

        return;
    }

    const indisponiveis =
        indisponibilidades[data] || [];

    const disponiveis =
        motoristas.filter(item =>
            !indisponiveis.includes(
                item.id
            )
        );

    const grupos = [
        [
            'Utilitário',
            vagas.utilitario
        ],
        [
            'Van',
            vagas.van
        ],
        [
            'Carro de Passeio',
            vagas.passeio
        ]
    ];

    const itens = [];
    const usados = new Set();

    grupos.forEach(
        ([veiculo, quantidade]) => {
            for (
                let index = 0;
                index < quantidade;
                index++
            ) {
                const motorista =
                    disponiveis.find(item =>
                        item.veiculo === veiculo &&
                        !item.prioridade &&
                        !usados.has(item.id)
                    ) ||
                    disponiveis.find(item =>
                        item.veiculo === veiculo &&
                        !usados.has(item.id)
                    );

                if (motorista) {
                    usados.add(
                        motorista.id
                    );

                    itens.push({
                        ordem: itens.length,
                        dsp: 'BETAXLOG',
                        nome:
                            motorista.nome,
                        telefone:
                            motorista.telefone ||
                            '',
                        motoristaId:
                            motorista.id,
                        veiculo,
                        onda: '',
                        status: 'ativo'
                    });
                } else {
                    itens.push({
                        ordem: itens.length,
                        dsp: 'BETAXLOG',
                        nome:
                            'VAGA SEM MOTORISTA',
                        telefone: '',
                        motoristaId: null,
                        veiculo,
                        onda: '',
                        status: 'vago'
                    });
                }
            }
        }
    );

    previaAtual = {
        data,
        vagas,
        itens,
        status: 'prévia'
    };

    document.getElementById(
        'painelEscala'
    ).hidden = false;

    renderizarTabelaEscala(
        itens,
        'prévia'
    );

    document.getElementById(
        'avisoEscala'
    ).hidden = false;

    document.getElementById(
        'btnSalvarPrevia'
    ).disabled = false;

    document.getElementById(
        'btnConfirmarDefinitiva'
    ).disabled = true;

    document.getElementById(
        'btnBaixarImagem'
    ).disabled = true;

    mostrarToast(
        'Prévia gerada. Salve antes de confirmar.',
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

    if (tag) {
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
    }

    itens.forEach(
        (item, index) => {
            const tr =
                document.createElement(
                    'tr'
                );

            const cancelada =
                item.status ===
                    'cancelado' ||
                item.status ===
                    'cancelado_amazon';

            if (cancelada) {
                tr.className =
                    'row-cancelada';
            }

            const tdDsp =
                document.createElement(
                    'td'
                );

            tdDsp.textContent =
                item.dsp;

            const tdNome =
                document.createElement(
                    'td'
                );

            tdNome.textContent =
                item.nome;

            const tdVeiculo =
                document.createElement(
                    'td'
                );

            tdVeiculo.textContent =
                item.veiculo;

            const tdOnda =
                document.createElement(
                    'td'
                );

            const onda =
                document.createElement(
                    'input'
                );

            onda.className =
                'input-onda';

            onda.value =
                item.onda || '';

            onda.placeholder =
                'HH:MM';

            onda.disabled =
                status === 'definitiva';

            onda.addEventListener(
                'change',
                async event => {
                    item.onda =
                        event.target.value
                            .trim();

                    if (
                        status !==
                        'definitiva'
                    ) {
                        await salvarItensEscalaAtual(
                            itens
                        );
                    }
                }
            );

            tdOnda.appendChild(onda);

            const tdAcoes =
                document.createElement(
                    'td'
                );

            const botao =
                document.createElement(
                    'button'
                );

            botao.type =
                'button';

            botao.className =
                cancelada
                    ? 'btn btn-success btn-icon'
                    : 'btn btn-danger btn-icon';

            botao.textContent =
                cancelada ? '✅' : '❌';

            botao.disabled =
                !item.motoristaId ||
                status === 'definitiva';

            botao.addEventListener(
                'click',
                async () => {
                    item.status =
                        cancelada
                            ? 'ativo'
                            : 'cancelado_amazon';

                    await salvarItensEscalaAtual(
                        itens
                    );

                    renderizarTabelaEscala(
                        itens,
                        status
                    );
                }
            );

            tdAcoes.appendChild(botao);

            tr.append(
                tdDsp,
                tdNome,
                tdVeiculo,
                tdOnda,
                tdAcoes
            );

            tbody.appendChild(tr);
        }
    );

    const data =
        document
            .getElementById(
                'dataEscala'
            )
            ?.value;

    const subtitulo =
        document.getElementById(
            'dataSubtituloImagem'
        );

    if (subtitulo && data) {
        subtitulo.textContent =
            `Data: ${formatarData(data)}`;
    }
}

async function salvarPrevia() {
    if (!previaAtual) {
        mostrarToast(
            'Gere uma prévia antes de salvar.',
            'error'
        );

        return;
    }

    const existente =
        escalas[previaAtual.data];

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
                    previaAtual.vagas
                        .utilitario,
                vagas_van:
                    previaAtual.vagas.van,
                vagas_passeio:
                    previaAtual.vagas.passeio,
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
            data,
            error
        } = await supabaseClient
            .from('escalas')
            .insert({
                data:
                    previaAtual.data,
                status: 'prévia',
                vagas_utilitario:
                    previaAtual.vagas
                        .utilitario,
                vagas_van:
                    previaAtual.vagas.van,
                vagas_passeio:
                    previaAtual.vagas.passeio,
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
            data.id;
    }

    const itens =
        previaAtual.itens.map(
            (item, index) => ({
                escala_id: escalaId,
                ordem: index,
                dsp: item.dsp,
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

    await registrarAuditoria(
        'SALVAR_PREVIA_ESCALA',
        'escala',
        escalaId,
        previaAtual.data,
        {}
    );

    await carregarEscalas();

    previaAtual = null;

    carregarEscalaData();

    mostrarToast(
        'Prévia salva com sucesso.',
        'success'
    );
}

async function salvarItensEscalaAtual(
    itens
) {
    const data =
        document
            .getElementById(
                'dataEscala'
            )
            ?.value;

    const escala =
        escalas[data];

    if (!escala) {
        return;
    }

    const novosItens =
        itens.map(
            (item, index) => ({
                escala_id: escala.id,
                ordem: index,
                dsp: item.dsp,
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
        error: erroDelete
    } = await supabaseClient
        .from('escala_itens')
        .delete()
        .eq(
            'escala_id',
            escala.id
        );

    if (erroDelete) {
        mostrarToast(
            erroDelete.message,
            'error'
        );

        return;
    }

    const {
        error
    } = await supabaseClient
        .from('escala_itens')
        .insert(novosItens);

    if (error) {
        mostrarToast(
            error.message,
            'error'
        );
    }
}

async function confirmarDefinitiva() {
    const data =
        document
            .getElementById(
                'dataEscala'
            )
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
        'CONFIRMAR_ESCALA_DEFINITIVA',
        'escala',
        escala.id,
        data,
        {}
    );

    await carregarEscalas();

    carregarEscalaData();

    mostrarToast(
        'Escala definitiva confirmada.',
        'success'
    );
}

async function excluirEscalaAtual() {
    if (usuarioLogado?.role !== 'admin') {
        mostrarToast(
            'Somente administradores podem arquivar escalas.',
            'error'
        );

        return;
    }

    const data =
        document
            .getElementById(
                'dataEscala'
            )
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
        `Arquivar a escala de ${formatarData(data)}?`
    )) {
        return;
    }

    const motivo =
        prompt(
            'Informe o motivo do arquivamento:'
        );

    if (motivo === null) {
        return;
    }

    const agora =
        new Date().toISOString();

    const {
        error
    } = await supabaseClient
        .from('escalas')
        .update({
            deleted_at: agora,
            deleted_by:
                usuarioLogado.id,
            deleted_reason:
                motivo.trim() || null,
            updated_at: agora
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
        'ARQUIVAR_ESCALA',
        'escala',
        escala.id,
        data,
        {
            motivo:
                motivo.trim() || null
        }
    );

    await carregarEscalas();

    carregarEscalaData();

    mostrarToast(
        'Escala arquivada.',
        'success'
    );
}

/* =========================================================
   EXPORTAÇÕES
========================================================= */

function exportarExcel() {
    const data =
        document
            .getElementById(
                'dataEscala'
            )
            ?.value;

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
            DSP: item.dsp,
            Motorista: item.nome,
            Telefone: item.telefone,
            Veiculo: item.veiculo,
            Onda: item.onda,
            Status: item.status
        }));

    const folha =
        XLSX.utils.json_to_sheet(dados);

    const livro =
        XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
        livro,
        folha,
        'Escala'
    );

    XLSX.writeFile(
        livro,
        `escala_${data}.xlsx`
    );
}

function exportarBackupMotoristas() {
    const dados =
        motoristas.map(item => ({
            Nome: item.nome,
            Telefone:
                item.telefone || '',
            Veiculo: item.veiculo,
            Prioridade:
                item.prioridade
                    ? 'SIM'
                    : 'NAO'
        }));

    const folha =
        XLSX.utils.json_to_sheet(dados);

    const livro =
        XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
        livro,
        folha,
        'Motoristas'
    );

    XLSX.writeFile(
        livro,
        `motoristas_${obterDataISO()}.xlsx`
    );
}

async function gerarImagemEscalaECompartilhar() {
    const area =
        document.getElementById(
            'areaCapturaImagem'
        );

    if (!area) return;

    if (!window.html2canvas) {
        mostrarToast(
            'Biblioteca de imagem não carregada.',
            'error'
        );

        return;
    }

    const canvas =
        await html2canvas(
            area,
            {
                scale: 2
            }
        );

    const link =
        document.createElement('a');

    const data =
        document
            .getElementById(
                'dataEscala'
            )
            .value;

    link.download =
        `escala_betaxlog_${data}.png`;

    link.href =
        canvas.toDataURL('image/png');

    link.click();
}

function compartilharWhatsAppTexto() {
    const data =
        document
            .getElementById(
                'dataEscala'
            )
            ?.value;

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
        `📅 Data: ${formatarData(data)}\n\n`;

    escala.itens
        .filter(item =>
            item.motoristaId &&
            item.status !==
                'cancelado' &&
            item.status !==
                'cancelado_amazon'
        )
        .forEach(item => {
            texto +=
                `• ${item.nome} - ` +
                `${item.veiculo} - ` +
                `Onda: ${
                    item.onda ||
                    'não definida'
                }\n`;
        });

    if (
        navigator.clipboard &&
        navigator.clipboard.writeText
    ) {
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
            .catch(() =>
                prompt(
                    'Copie o texto:',
                    texto
                )
            );
    } else {
        prompt(
            'Copie o texto:',
            texto
        );
    }
}

/* =========================================================
   RELATÓRIOS
========================================================= */

function aplicarAtalhoPeriodo() {
    const valor =
        document
            .getElementById(
                'filtroAtalhoPeriodo'
            )
            ?.value;

    if (!valor) return;

    const hoje =
        new Date();

    let inicio =
        new Date();

    if (valor === 'mes_atual') {
        inicio =
            new Date(
                hoje.getFullYear(),
                hoje.getMonth(),
                1
            );
    }

    if (valor === 'semanal') {
        inicio.setDate(
            hoje.getDate() - 7
        );
    }

    if (valor === 'semestral') {
        inicio.setMonth(
            hoje.getMonth() - 6
        );
    }

    if (valor === 'anual') {
        inicio =
            new Date(
                hoje.getFullYear(),
                0,
                1
            );
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

function gerarRelatorioHistorico() {
    const inicioTexto =
        document
            .getElementById(
                'relatorioDataInicio'
            )
            ?.value;

    const fimTexto =
        document
            .getElementById(
                'relatorioDataFim'
            )
            ?.value;

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
            registro => {
                const data =
                    converterData(
                        registro.data
                    );

                return data >= inicio &&
                    data <= fim;
            }
        );

    let total = 0;
    let ativas = 0;
    let canceladas = 0;

    const ranking = {};

    registros.forEach(
        registro => {
            registro.itens.forEach(
                item => {
                    if (!item.motoristaId) {
                        return;
                    }

                    total++;

                    const cancelada =
                        item.status ===
                            'cancelado' ||
                        item.status ===
                            'cancelado_amazon';

                    if (cancelada) {
                        canceladas++;
                    } else {
                        ativas++;
                    }

                    if (
                        !ranking[
                            item.motoristaId
                        ]
                    ) {
                        ranking[
                            item.motoristaId
                        ] = {
                            nome: item.nome,
                            veiculo:
                                item.veiculo,
                            escaladas: 0,
                            canceladas: 0
                        };
                    }

                    ranking[
                        item.motoristaId
                    ].escaladas++;

                    if (cancelada) {
                        ranking[
                            item.motoristaId
                        ].canceladas++;
                    }
                }
            );
        }
    );

    definirTexto(
        'kpiTotalRotas',
        total
    );

    definirTexto(
        'kpiRotasAtivas',
        ativas
    );

    definirTexto(
        'kpiRotasCanceladas',
        canceladas
    );

    definirTexto(
        'kpiTaxaSucesso',
        `${total
            ? ((ativas / total) * 100)
                .toFixed(1)
            : 0}%`
    );

    const tbody =
        document
            .getElementById(
                'tabelaRankingBody'
            );

    if (tbody) {
        tbody.replaceChildren();

        const itensRanking =
            Object.values(ranking)
                .sort(
                    (a, b) =>
                        b.escaladas -
                        a.escaladas
                );

        if (!itensRanking.length) {
            const tr =
                document.createElement(
                    'tr'
                );

            const td =
                document.createElement(
                    'td'
                );

            td.colSpan = 5;
            td.textContent =
                'Nenhum registro no período.';

            tr.appendChild(td);
            tbody.appendChild(tr);
        }

        itensRanking.forEach(item => {
            const tr =
                document.createElement(
                    'tr'
                );

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
                    document.createElement(
                        'td'
                    );

                td.textContent =
                    valor;

                tr.appendChild(td);
            });

            tbody.appendChild(tr);
        });
    }

    atualizarGraficos(registros);
}

function atualizarGraficos(registros) {
    if (!window.Chart) {
        return;
    }

    const datas = {};

    const veiculos = {
        'Utilitário': 0,
        'Van': 0,
        'Carro de Passeio': 0
    };

    registros.forEach(
        registro => {
            datas[registro.data] =
                registro.itens.filter(
                    item =>
                        item.motoristaId &&
                        item.status !==
                            'cancelado' &&
                        item.status !==
                            'cancelado_amazon'
                ).length;

            registro.itens.forEach(
                item => {
                    if (
                        item.motoristaId &&
                        item.status !==
                            'cancelado' &&
                        item.status !==
                            'cancelado_amazon' &&
                        veiculos[
                            item.veiculo
                        ] !== undefined
                    ) {
                        veiculos[
                            item.veiculo
                        ]++;
                    }
                }
            );
        }
    );

    const canvasEvolucao =
        document.getElementById(
            'chartEvolucao'
        );

    if (canvasEvolucao) {
        chartEvolucaoInstancia
            ?.destroy();

        chartEvolucaoInstancia =
            new Chart(
                canvasEvolucao,
                {
                    type: 'line',
                    data: {
                        labels:
                            Object.keys(
                                datas
                            ),
                        datasets: [{
                            label:
                                'Rotas ativas',
                            data:
                                Object.values(
                                    datas
                                ),
                            borderColor:
                                '#1e3a8a',
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

    if (canvasVeiculos) {
        chartVeiculosInstancia
            ?.destroy();

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
                    },
                    options: {
                        responsive: true
                    }
                }
            );
    }
}

function exportarRelatorioPDF() {
    if (
        !window.jspdf ||
        !window.jspdf.jsPDF
    ) {
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

    if (
        typeof documento.autoTable ===
        'function'
    ) {
        documento.autoTable({
            html: '#tabelaRankingBody',
            startY: 30
        });
    }

    documento.save(
        `relatorio_betaxlog_${obterDataISO()}.pdf`
    );
}

/* =========================================================
   PAINEL ADMINISTRATIVO
========================================================= */

function aplicarPermissoes() {
    const botao =
        document.getElementById(
            'btnPainelAdmin'
        );

    if (!botao) return;

    botao.hidden =
        usuarioLogado?.role !== 'admin';
}

async function abrirModalAdmin() {
    if (usuarioLogado?.role !== 'admin') {
        mostrarToast(
            'Acesso restrito ao administrador.',
            'error'
        );

        return;
    }

    const modal =
        document.getElementById(
            'modalAdmin'
        );

    if (!modal) return;

    modal.hidden = false;

    await carregarUsuariosAdmin();
}

function fecharModalAdmin() {
    const modal =
        document.getElementById(
            'modalAdmin'
        );

    if (modal) {
        modal.hidden = true;
    }
}

function alternarAbaAdmin(nome) {
    const mapa = {
        usuarios:
            'adminViewUsuarios',

        motoristasExcluidos:
            'adminViewMotoristasExcluidos',

        escalasExcluidas:
            'adminViewEscalasExcluidas',

        auditoria:
            'adminViewAuditoria'
    };

    document
        .querySelectorAll('.admin-view')
        .forEach(view => {
            view.hidden = true;
        });

    const id =
        mapa[nome];

    if (id) {
        document
            .getElementById(id)
            ?.removeAttribute('hidden');
    }

    if (
        nome ===
        'motoristasExcluidos'
    ) {
        carregarMotoristasExcluidos();
    }

    if (
        nome ===
        'escalasExcluidas'
    ) {
        carregarEscalasExcluidas();
    }

    if (
        nome ===
        'auditoria'
    ) {
        carregarAuditoria();
    }
}

async function carregarUsuariosAdmin() {
    const lista =
        document.getElementById(
            'listaUsuariosCadastrados'
        );

    if (!lista) return;

    lista.textContent =
        'Carregando usuários...';

    const {
        data,
        error
    } = await supabaseClient
        .from('profiles')
        .select(
            'id, nome, email, role, ativo'
        )
        .order('nome');

    if (error) {
        lista.textContent =
            error.message;

        return;
    }

    lista.replaceChildren();

    (data || []).forEach(
        usuario => {
            const item =
                document.createElement(
                    'div'
                );

            item.className =
                'admin-item';

            const informacoes =
                document.createElement(
                    'div'
                );

            const nome =
                document.createElement(
                    'strong'
                );

            nome.textContent =
                usuario.nome ||
                'Sem nome';

            const email =
                document.createElement(
                    'small'
                );

            email.textContent =
                usuario.email ||
                usuario.id;

            informacoes.append(
                nome,
                document.createElement(
                    'br'
                ),
                email
            );

            const acoes =
                document.createElement(
                    'div'
                );

            acoes.className =
                'admin-item-actions';

            const role =
                document.createElement(
                    'select'
                );

            role.innerHTML =
                '<option value="admin">Administrador</option>' +
                '<option value="operador">Operador</option>' +
                '<option value="usuario">Usuário</option>';

            role.value =
                usuario.role ||
                'usuario';

            const ativo =
                document.createElement(
                    'select'
                );

            ativo.innerHTML =
                '<option value="true">Ativo</option>' +
                '<option value="false">Inativo</option>';

            ativo.value =
                String(
                    usuario.ativo !== false
                );

            const salvar =
                document.createElement(
                    'button'
                );

            salvar.type =
                'button';

            salvar.className =
                'btn btn-primary';

            salvar.textContent =
                'Salvar';

            salvar.addEventListener(
                'click',
                () =>
                    atualizarUsuarioAdmin(
                        usuario,
                        role.value,
                        ativo.value ===
                            'true'
                    )
            );

            acoes.append(
                role,
                ativo,
                salvar
            );

            item.append(
                informacoes,
                acoes
            );

            lista.appendChild(item);
        }
    );
}

async function atualizarUsuarioAdmin(
    usuario,
    role,
    ativo
) {
    if (
        usuario.id ===
            usuarioLogado.id &&
        !ativo
    ) {
        mostrarToast(
            'Você não pode desativar seu próprio usuário.',
            'error'
        );

        return;
    }

    if (
        usuario.id ===
            usuarioLogado.id &&
        role !== 'admin'
    ) {
        mostrarToast(
            'Você não pode remover seu próprio acesso de administrador.',
            'error'
        );

        return;
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

async function carregarMotoristasExcluidos() {
    const lista =
        document.getElementById(
            'listaMotoristasExcluidos'
        );

    if (!lista) return;

    lista.textContent =
        'Carregando motoristas arquivados...';

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

    if (error) {
        lista.textContent =
            error.message;

        return;
    }

    lista.replaceChildren();

    if (!data?.length) {
        lista.textContent =
            'Nenhum motorista arquivado.';

        return;
    }

    data.forEach(
        motorista => {
            const item =
                document.createElement(
                    'div'
                );

            item.className =
                'admin-item';

            const texto =
                document.createElement(
                    'span'
                );

            texto.textContent =
                `${motorista.nome} · ` +
                `arquivado em ` +
                `${formatarDataHora(
                    motorista.deleted_at
                )}`;

            const restaurar =
                document.createElement(
                    'button'
                );

            restaurar.type =
                'button';

            restaurar.className =
                'btn btn-success';

            restaurar.textContent =
                'Restaurar';

            restaurar.addEventListener(
                'click',
                () =>
                    restaurarMotorista(
                        motorista
                    )
            );

            item.append(
                texto,
                restaurar
            );

            lista.appendChild(item);
        }
    );
}

async function restaurarMotorista(
    motorista
) {
    if (!confirm(
        `Restaurar ${motorista.nome}?`
    )) {
        return;
    }

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
    carregarMotoristasExcluidos();

    mostrarToast(
        'Motorista restaurado.',
        'success'
    );
}

async function carregarEscalasExcluidas() {
    const lista =
        document.getElementById(
            'listaEscalasExcluidas'
        );

    if (!lista) return;

    lista.textContent =
        'Carregando escalas arquivadas...';

    const {
        data,
        error
    } = await supabaseClient
        .from('escalas')
        .select(
            'id, data, status, deleted_at, deleted_reason'
        )
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

    if (error) {
        lista.textContent =
            error.message;

        return;
    }

    lista.replaceChildren();

    if (!data?.length) {
        lista.textContent =
            'Nenhuma escala arquivada.';

        return;
    }

    data.forEach(
        escala => {
            const item =
                document.createElement(
                    'div'
                );

            item.className =
                'admin-item';

            const texto =
                document.createElement(
                    'span'
                );

            texto.textContent =
                `Escala de ${
                    formatarData(
                        escala.data
                    )
                } · ${
                    escala.deleted_reason ||
                    'Sem motivo'
                }`;

            const restaurar =
                document.createElement(
                    'button'
                );

            restaurar.type =
                'button';

            restaurar.className =
                'btn btn-success';

            restaurar.textContent =
                'Restaurar';

            restaurar.addEventListener(
                'click',
                () =>
                    restaurarEscala(
                        escala
                    )
            );

            item.append(
                texto,
                restaurar
            );

            lista.appendChild(item);
        }
    );
}

async function restaurarEscala(escala) {
    if (!confirm(
        `Restaurar a escala de ${
            formatarData(
                escala.data
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

    carregarEscalaData();
    carregarEscalasExcluidas();

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

    if (!tabela) return;

    tabela.replaceChildren();

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

    if (error) {
        const tr =
            document.createElement(
                'tr'
            );

        const td =
            document.createElement(
                'td'
            );

        td.colSpan = 4;
        td.textContent =
            error.message;

        tr.appendChild(td);
        tabela.appendChild(tr);

        return;
    }

    if (!data?.length) {
        const tr =
            document.createElement(
                'tr'
            );

        const td =
            document.createElement(
                'td'
            );

        td.colSpan = 4;
        td.textContent =
            'Nenhum registro de auditoria.';

        tr.appendChild(td);
        tabela.appendChild(tr);

        return;
    }

    data.forEach(
        registro => {
            const tr =
                document.createElement(
                    'tr'
                );

            [
                formatarDataHora(
                    registro.created_at
                ),
                registro.user_name ||
                    registro.actor_name ||
                    registro.user_id ||
                    '-',
                registro.action ||
                    '-',
                registro.entity_label ||
                    registro.entity_type ||
                    '-'
            ].forEach(valor => {
                const td =
                    document.createElement(
                        'td'
                    );

                td.textContent =
                    valor;

                tr.appendChild(td);
            });

            tabela.appendChild(tr);
        }
    );
}

/* =========================================================
   AUDITORIA
========================================================= */

async function registrarAuditoria(
    action,
    entityType,
    entityId = null,
    entityLabel = null,
    details = {}
) {
    if (!usuarioLogado) {
        return;
    }

    const registro = {
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
        details
    };

    const {
        error
    } = await supabaseClient
        .from('audit_logs')
        .insert(registro);

    if (error) {
        console.error(
            'Erro ao registrar auditoria:',
            error
        );
    }
}

/* =========================================================
   DATAS E UTILITÁRIOS
========================================================= */

function configurarDatas() {
    const hoje =
        obterDataISO();

    const dataEscala =
        document.getElementById(
            'dataEscala'
        );

    if (dataEscala) {
        dataEscala.value =
            hoje;
    }

    const fim =
        document.getElementById(
            'relatorioDataFim'
        );

    if (fim) {
        fim.value =
            hoje;
    }

    const inicio =
        document.getElementById(
            'relatorioDataInicio'
        );

    if (inicio) {
        inicio.value =
            obterDataISO(
                new Date(
                    new Date().getFullYear(),
                    new Date().getMonth(),
                    1
                )
            );
    }
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

function converterData(valor) {
    if (!valor) {
        return null;
    }

    const [
        ano,
        mes,
        dia
    ] =
        valor
            .split('-')
            .map(Number);

    return new Date(
        ano,
        mes - 1,
        dia
    );
}

function formatarData(valor) {
    if (!valor) {
        return '-';
    }

    const partes =
        String(valor).split('-');

    if (partes.length !== 3) {
        return valor;
    }

    return partes
        .reverse()
        .join('/');
}

function formatarDataHora(valor) {
    if (!valor) {
        return '-';
    }

    return new Date(valor)
        .toLocaleString('pt-BR');
}

function definirTexto(id, valor) {
    const elemento =
        document.getElementById(id);

    if (elemento) {
        elemento.textContent =
            valor;
    }
}

function atualizarInfoBackup() {
    const campo =
        document.getElementById(
            'infoUltimoBackup'
        );

    if (campo) {
        campo.textContent =
            `☁️ Supabase sincronizado em ` +
            `${new Date().toLocaleString(
                'pt-BR'
            )}`;
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
        document.createElement(
            'div'
        );

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
