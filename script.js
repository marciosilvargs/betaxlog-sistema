'use strict';

/*
============================================================
BETAXLOG — SCRIPT PRINCIPAL
============================================================

Tabelas esperadas no Supabase:

- profiles
- motoristas
- escalas
- indisponibilidades
- audit_logs

Importante:
- Não utiliza localStorage.
- Não utiliza sessionStorage.
- Não utiliza service_role.
- Não possui exclusão geral de dados.
- Exclusões são lógicas usando ativo/deleted_at.
*/

/* =========================================================
   CONFIGURAÇÃO
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

let motoristasSelecionados = new Set();
let previaAtual = null;

let chartEvolucao = null;
let chartVeiculos = null;

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
                'A biblioteca do Supabase não foi carregada.'
            );

            return;
        }

        if (!configuracaoValida()) {
            esconderLoader();

            mostrarLogin(
                'Configure a chave pública do Supabase no script.js.'
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

        supabaseClient.auth.onAuthStateChange(
            async (evento, session) => {
                if (
                    evento === 'SIGNED_OUT' ||
                    !session
                ) {
                    usuarioLogado = null;
                    mostrarLogin();
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
        carregarEscalaDaData();

        mostrarSistema();
        atualizarInformacoesUsuario();
        aplicarPermissoes();
        esconderLoader();
    } catch (error) {
        console.error(error);

        esconderLoader();

        mostrarLogin(
            `Erro ao iniciar: ${obterMensagemErro(error)}`
        );
    }
}

function configuracaoValida() {
    const urlValida =
        SUPABASE_URL.startsWith('https://') &&
        SUPABASE_URL.includes('.supabase.co');

    const chaveValida =
        Boolean(
            SUPABASE_ANON_KEY &&
            !SUPABASE_ANON_KEY.includes(
                'COLE_SUA'
            ) &&
            !SUPABASE_ANON_KEY.includes(
                'service_role'
            )
        );

    return urlValida && chaveValida;
}

function esconderLoader() {
    document
        .getElementById('appLoader')
        ?.remove();
}

function mostrarSistema() {
    const sistema =
        document.getElementById('sistema');

    if (sistema) {
        sistema.hidden = false;
    }
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
            obterMensagemErro(error)
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
        .eq(
            'id',
            data.session.user.id
        )
        .maybeSingle();

    if (erroPerfil) {
        mostrarLogin(
            `Erro ao carregar perfil: ${
                obterMensagemErro(erroPerfil)
            }`
        );

        return false;
    }

    if (!perfil) {
        mostrarLogin(
            'O usuário não possui perfil cadastrado.'
        );

        await supabaseClient.auth.signOut();

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
        ativo: true
    };

    removerLogin();

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
                    Acesso seguro pelo Supabase.
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
                    required>

                <label for="loginSenha">
                    Senha
                </label>

                <input
                    id="loginSenha"
                    type="password"
                    autocomplete="current-password"
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
                efetuarLogin
            );
    }

    overlay.hidden = false;
    document.body.classList.add('login-open');

    const campoMensagem =
        document.getElementById(
            'loginMensagem'
        );

    if (mensagem) {
        campoMensagem.textContent =
            mensagem;

        campoMensagem.hidden = false;
    } else {
        campoMensagem.hidden = true;
    }
}

function removerLogin() {
    const overlay =
        document.getElementById(
            'modalLoginOverlay'
        );

    if (overlay) {
        overlay.hidden = true;
    }

    document.body.classList.remove(
        'login-open'
    );
}

async function efetuarLogin(event) {
    event.preventDefault();

    const email =
        document
            .getElementById('loginEmail')
            .value
            .trim();

    const senha =
        document
            .getElementById('loginSenha')
            .value;

    const botao =
        document.getElementById('btnLogin');

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
        mostrarLogin(
            `Não foi possível entrar: ${
                obterMensagemErro(error)
            }`
        );

        botao.disabled = false;
        botao.textContent = 'Entrar';

        return;
    }

    if (!data.session) {
        mostrarLogin(
            'Sessão não criada.'
        );

        botao.disabled = false;
        botao.textContent = 'Entrar';

        return;
    }

    const sucesso =
        await verificarSessao();

    if (sucesso) {
        location.reload();
    }
}

async function sair() {
    await supabaseClient.auth.signOut();
    location.reload();
}

/* =========================================================
   EVENTOS
========================================================= */

function configurarEventos() {
    document
        .getElementById('btnSair')
        ?.addEventListener(
            'click',
            sair
        );

    document
        .getElementById('btnAbaOperacional')
        ?.addEventListener(
            'click',
            () => mudarAba('operacional')
        );

    document
        .getElementById('btnAbaMotoristas')
        ?.addEventListener(
            'click',
            () => mudarAba('motoristas')
        );

    document
        .getElementById('btnAbaRelatorios')
        ?.addEventListener(
            'click',
            () => mudarAba('relatorios')
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
            confirmarEscala
        );

    document
        .getElementById('btnExcluirEscala')
        ?.addEventListener(
            'click',
            arquivarEscalaAtual
        );

    document
        .getElementById('btnBaixarImagem')
        ?.addEventListener(
            'click',
            baixarImagemEscala
        );

    document
        .getElementById('btnWhatsApp')
        ?.addEventListener(
            'click',
            compartilharWhatsApp
        );

    document
        .getElementById('btnExportarEscala')
        ?.addEventListener(
            'click',
            exportarEscalaExcel
        );

    document
        .getElementById('dataEscala')
        ?.addEventListener(
            'change',
            async () => {
                await carregarIndisponibilidades();
                renderizarIndisponibilidades();
                carregarEscalaDaData();
            }
        );

    document
        .getElementById('btnCadastrarMotorista')
        ?.addEventListener(
            'click',
            cadastrarMotorista
        );

    document
        .getElementById('filtroMotorista')
        ?.addEventListener(
            'input',
            renderizarMotoristas
        );

    document
        .getElementById('buscaIndisponibilidade')
        ?.addEventListener(
            'input',
            renderizarIndisponibilidades
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
            arquivarMotoristasSelecionados
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
            exportarMotoristas
        );

    document
        .getElementById('btnPainelAdmin')
        ?.addEventListener(
            'click',
            abrirPainelAdmin
        );

    document
        .getElementById('btnGerarRelatorio')
        ?.addEventListener(
            'click',
            gerarRelatorio
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
        .getElementById('btnFecharAdmin')
        ?.addEventListener(
            'click',
            fecharPainelAdmin
        );
}

/* =========================================================
   PERMISSÕES E ABAS
========================================================= */

function aplicarPermissoes() {
    const admin =
        usuarioLogado?.role === 'admin';

    const botaoAdmin =
        document.getElementById(
            'btnPainelAdmin'
        );

    if (botaoAdmin) {
        botaoAdmin.hidden = !admin;
    }

    const botoesExclusao =
        document.querySelectorAll(
            '[data-admin-only]'
        );

    botoesExclusao.forEach(
        botao => {
            botao.hidden = !admin;
        }
    );
}

function mudarAba(nome) {
    const abas = {
        operacional:
            'viewOperacional',
        motoristas:
            'viewMotoristas',
        relatorios:
            'viewRelatorios'
    };

    Object.values(abas).forEach(
        id => {
            const elemento =
                document.getElementById(id);

            if (elemento) {
                elemento.hidden =
                    id !== abas[nome];
            }
        }
    );

    document
        .querySelectorAll(
            '.tabs > .tab-btn'
        )
        .forEach(botao => {
            botao.classList.remove(
                'active'
            );
        });

    const botao =
        document.getElementById(
            `btnAba${
                nome.charAt(0).toUpperCase() +
                nome.slice(1)
            }`
        );

    botao?.classList.add('active');
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
        .order('prioridade', {
            ascending: false
        })
        .order('nome');

    if (error) {
        mostrarToast(
            `Erro ao carregar motoristas: ${
                obterMensagemErro(error)
            }`,
            'error'
        );

        return;
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
        document
            .getElementById(
                'filtroMotorista'
            )
            ?.value
            .toLowerCase()
            .trim() || '';

    const filtrados =
        motoristas.filter(
            motorista =>
                motorista.nome
                    .toLowerCase()
                    .includes(filtro) ||
                String(
                    motorista.telefone || ''
                ).includes(filtro)
        );

    lista.replaceChildren();

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
                motoristasSelecionados.has(
                    motorista.id
                );

            checkbox.dataset.id =
                motorista.id;

            checkbox.addEventListener(
                'change',
                () => {
                    if (checkbox.checked) {
                        motoristasSelecionados
                            .add(
                                motorista.id
                            );
                    } else {
                        motoristasSelecionados
                            .delete(
                                motorista.id
                            );
                    }

                    atualizarSelecaoMotoristas();
                }
            );

            const texto =
                document.createElement(
                    'span'
                );

            texto.textContent =
                `${motorista.nome} · ${
                    motorista.tipo_veiculo ||
                    motorista.veiculo ||
                    '-'
                }`;

            label.append(
                checkbox,
                texto
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
                'Editar';

            editar.addEventListener(
                'click',
                () =>
                    editarMotorista(
                        motorista
                    )
            );

            item.append(
                label,
                editar
            );

            lista.appendChild(item);
        }
    );

    definirTexto(
        'contadorTotalMotoristas',
        `Total: ${motoristas.length}`
    );

    atualizarSelecaoMotoristas();
}

function selecionarTodosMotoristas(event) {
    const marcado =
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
        .filter(
            motorista =>
                motorista.nome
                    .toLowerCase()
                    .includes(filtro)
        )
        .forEach(
            motorista => {
                if (marcado) {
                    motoristasSelecionados
                        .add(
                            motorista.id
                        );
                } else {
                    motoristasSelecionados
                        .delete(
                            motorista.id
                        );
                }
            }
        );

    renderizarMotoristas();
}

function atualizarSelecaoMotoristas() {
    const quantidade =
        motoristasSelecionados.size;

    definirTexto(
        'contadorSelecionados',
        `${quantidade} selecionado${
            quantidade === 1 ? '' : 's'
        }`
    );

    const botao =
        document.getElementById(
            'btnExcluirSelecionados'
        );

    if (botao) {
        botao.disabled =
            quantidade === 0 ||
            usuarioLogado?.role !== 'admin';
    }

    const todos =
        document.getElementById(
            'checkTodosMotoristas'
        );

    if (todos) {
        const visiveis =
            document.querySelectorAll(
                '#listaMotoristasCheck input[type="checkbox"]'
            );

        todos.checked =
            visiveis.length > 0 &&
            Array.from(visiveis)
                .every(
                    checkbox =>
                        checkbox.checked
                );
    }
}

async function cadastrarMotorista() {
    const nome =
        document
            .getElementById('nomeMotorista')
            ?.value
            .trim();

    const telefone =
        document
            .getElementById('telMotorista')
            ?.value
            .trim();

    const tipo =
        document
            .getElementById('tipoVeiculo')
            ?.value;

    if (!nome || !tipo) {
        mostrarToast(
            'Informe o nome e o tipo de veículo.',
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
            tipo_veiculo: tipo,
            ativo: true,
            prioridade: false,
            created_by:
                usuarioLogado.id
        })
        .select()
        .single();

    if (error) {
        mostrarToast(
            `Erro ao cadastrar: ${
                obterMensagemErro(error)
            }`,
            'error'
        );

        return;
    }

    await registrarAuditoria(
        'CRIAR_MOTORISTA',
        'motorista',
        data.id,
        data.nome,
        {
            tipo_veiculo: tipo
        }
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

async function editarMotorista(motorista) {
    const nome =
        prompt(
            'Nome do motorista:',
            motorista.nome
        );

    if (nome === null) return;

    const telefone =
        prompt(
            'Telefone:',
            motorista.telefone || ''
        );

    if (telefone === null) return;

    const tipo =
        prompt(
            'Tipo de veículo:',
            motorista.tipo_veiculo ||
            motorista.veiculo ||
            'Utilitário'
        );

    if (tipo === null) return;

    if (
        !nome.trim() ||
        !TIPOS_VEICULO.includes(tipo)
    ) {
        mostrarToast(
            'Nome ou tipo de veículo inválido.',
            'error'
        );

        return;
    }

    const {
        error
    } = await supabaseClient
        .from('motoristas')
        .update({
            nome: nome.trim(),
            telefone: telefone.trim(),
            tipo_veiculo: tipo,
            updated_at:
                new Date().toISOString()
        })
        .eq(
            'id',
            motorista.id
        );

    if (error) {
        mostrarToast(
            obterMensagemErro(error),
            'error'
        );

        return;
    }

    await registrarAuditoria(
        'EDITAR_MOTORISTA',
        'motorista',
        motorista.id,
        nome.trim(),
        {}
    );

    await carregarMotoristas();

    renderizarMotoristas();
    renderizarPrioridades();

    mostrarToast(
        'Motorista atualizado.',
        'success'
    );
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
        Array.from(
            motoristasSelecionados
        );

    if (!ids.length) return;

    const confirmacao =
        confirm(
            `Arquivar ${ids.length} motorista(s)?`
        );

    if (!confirmacao) return;

    const motivo =
        prompt(
            'Informe o motivo do arquivamento:'
        );

    if (!motivo?.trim()) {
        mostrarToast(
            'Informe um motivo.',
            'error'
        );

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
                motivo.trim(),
            updated_at:
                new Date().toISOString()
        })
        .in(
            'id',
            ids
        );

    if (error) {
        mostrarToast(
            obterMensagemErro(error),
            'error'
        );

        return;
    }

    for (const id of ids) {
        const motorista =
            motoristas.find(
                item => item.id === id
            );

        await registrarAuditoria(
            'ARQUIVAR_MOTORISTA',
            'motorista',
            id,
            motorista?.nome || id,
            {
                motivo: motivo.trim()
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

/* =========================================================
   PRIORIDADE E RODÍZIO
========================================================= */

function renderizarPrioridades() {
    const noRodizio =
        document.getElementById(
            'listaNoRodizio'
        );

    const prioritarios =
        document.getElementById(
            'listaPrioritarios'
        );

    if (!noRodizio || !prioritarios) {
        return;
    }

    noRodizio.replaceChildren();
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
                noRodizio.appendChild(
                    option
                );
            }
        }
    );
}

async function alterarPrioridade(
    ids,
    prioridade
) {
    if (!ids.length) return;

    const {
        error
    } = await supabaseClient
        .from('motoristas')
        .update({
            prioridade,
            updated_at:
                new Date().toISOString()
        })
        .in(
            'id',
            ids
        );

    if (error) {
        mostrarToast(
            obterMensagemErro(error),
            'error'
        );

        return;
    }

    await carregarMotoristas();
    renderizarPrioridades();
    renderizarMotoristas();
}

/* =========================================================
   INDISPONIBILIDADES
========================================================= */

async function carregarIndisponibilidades() {
    const data =
        obterDataEscala();

    if (!data) return;

    const {
        data: registros,
        error
    } = await supabaseClient
        .from('indisponibilidades')
        .select('*')
        .eq(
            'data',
            data
        );

    if (error) {
        console.warn(
            'Tabela de indisponibilidades:',
            error.message
        );

        indisponibilidades[data] =
            new Set();

        return;
    }

    indisponibilidades[data] =
        new Set(
            (registros || [])
                .map(
                    item =>
                        item.motorista_id
                )
        );
}

function renderizarIndisponibilidades() {
    const lista =
        document.getElementById(
            'listaMotoristasIndisponiveis'
        );

    if (!lista) return;

    const data =
        obterDataEscala();

    const busca =
        document
            .getElementById(
                'buscaIndisponibilidade'
            )
            ?.value
            .toLowerCase()
            .trim() || '';

    const indisponiveis =
        indisponibilidades[data] ||
        new Set();

    lista.replaceChildren();

    motoristas
        .filter(
            motorista =>
                motorista.nome
                    .toLowerCase()
                    .includes(busca)
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
                    indisponiveis.has(
                        motorista.id
                    );

                checkbox.addEventListener(
                    'change',
                    () =>
                        alterarIndisponibilidade(
                            motorista.id,
                            checkbox.checked
                        )
                );

                const texto =
                    document.createElement(
                        'span'
                    );

                texto.textContent =
                    motorista.nome;

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
    motoristaId,
    indisponivel
) {
    const data =
        obterDataEscala();

    if (!data) return;

    if (!indisponibilidades[data]) {
        indisponibilidades[data] =
            new Set();
    }

    if (indisponivel) {
        const {
            error
        } = await supabaseClient
            .from('indisponibilidades')
            .upsert(
                {
                    data,
                    motorista_id:
                        motoristaId,
                    motivo:
                        'Indisponível informado pelo operador'
                },
                {
                    onConflict:
                        'data,motorista_id'
                }
            );

        if (error) {
            mostrarToast(
                obterMensagemErro(error),
                'error'
            );

            return;
        }

        indisponibilidades[data].add(
            motoristaId
        );
    } else {
        const {
            error
        } = await supabaseClient
            .from('indisponibilidades')
            .delete()
            .eq(
                'data',
                data
            )
            .eq(
                'motorista_id',
                motoristaId
            );

        if (error) {
            mostrarToast(
                obterMensagemErro(error),
                'error'
            );

            return;
        }

        indisponibilidades[data].delete(
            motoristaId
        );
    }

    renderizarIndisponibilidades();
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
        .select('*')
        .is('deleted_at', null)
        .order(
            'data',
            {
                ascending: false
            }
        );

    if (error) {
        mostrarToast(
            `Erro ao carregar escalas: ${
                obterMensagemErro(error)
            }`,
            'error'
        );

        return;
    }

    escalas = {};

    (data || []).forEach(
        escala => {
            escalas[escala.data] =
                escala;
        }
    );
}

function obterDataEscala() {
    return document
        .getElementById(
            'dataEscala'
        )
        ?.value;
}

function carregarEscalaDaData() {
    const data =
        obterDataEscala();

    if (!data) return;

    const escala =
        escalas[data];

    if (!escala) {
        previaAtual = null;

        const painel =
            document.getElementById(
                'painelEscala'
            );

        if (painel) {
            painel.hidden = true;
        }

        return;
    }

    const itens =
        escala.itens ||
        escala.dados ||
        [];

    previaAtual = {
        ...escala,
        itens
    };

    renderizarEscala();
}

function gerarPrevia() {
    const data =
        obterDataEscala();

    if (!data) {
        mostrarToast(
            'Informe a data da escala.',
            'error'
        );

        return;
    }

    const vagas = [
        {
            tipo: 'Utilitário',
            quantidade:
                obterNumero(
                    'vagasUtilitario'
                )
        },
        {
            tipo: 'Van',
            quantidade:
                obterNumero(
                    'vagasVan'
                )
        },
        {
            tipo: 'Carro de Passeio',
            quantidade:
                obterNumero(
                    'vagasPasseio'
                )
        }
    ];

    const indisponiveis =
        indisponibilidades[data] ||
        new Set();

    const disponiveis =
        motoristas.filter(
            motorista =>
                !indisponiveis.has(
                    motorista.id
                )
        );

    const usados =
        new Set();

    const itens = [];

    vagas.forEach(
        vaga => {
            for (
                let i = 0;
                i < vaga.quantidade;
                i++
            ) {
                const motorista =
                    escolherMotorista(
                        disponiveis,
                        vaga.tipo,
                        usados
                    );

                itens.push({
                    motoristaId:
                        motorista?.id || null,
                    nome:
                        motorista?.nome ||
                        'Vaga em aberto',
                    veiculo:
                        vaga.tipo,
                    onda: '',
                    status: 'ativo'
                });

                if (motorista) {
                    usados.add(
                        motorista.id
                    );
                }
            }
        }
    );

    previaAtual = {
        id:
            escalas[data]?.id || null,
        data,
        status:
            escalas[data]?.status ||
            'previa',
        itens
    };

    renderizarEscala();
}

function escolherMotorista(
    disponiveis,
    tipo,
    usados
) {
    return disponiveis.find(
        motorista =>
            !usados.has(motorista.id) &&
            (
                motorista.tipo_veiculo === tipo ||
                motorista.veiculo === tipo
            )
    ) || null;
}

function renderizarEscala() {
    const painel =
        document.getElementById(
            'painelEscala'
        );

    const corpo =
        document.getElementById(
            'tabelaEscalaBody'
        );

    if (!painel || !corpo || !previaAtual) {
        return;
    }

    painel.hidden = false;
    corpo.replaceChildren();

    const definitiva =
        previaAtual.status ===
        'definitiva';

    definirTexto(
        'dataSubtituloImagem',
        `Data: ${
            formatarData(
                previaAtual.data
            )
        }`
    );

    const tag =
        document.getElementById(
            'tagStatus'
        );

    if (tag) {
        tag.textContent =
            definitiva ?
                'DEFINITIVA' :
                'PRÉVIA';

        tag.className =
            `badge-status ${
                definitiva ?
                    'badge-definitiva' :
                    'badge-previa'
            }`;
    }

    const aviso =
        document.getElementById(
            'avisoPrevia'
        );

    if (aviso) {
        aviso.hidden =
            definitiva;
    }

    previaAtual.itens.forEach(
        (item, index) => {
            const tr =
                document.createElement(
                    'tr'
                );

            if (
                item.status === 'cancelado' ||
                item.status ===
                    'cancelado_amazon'
            ) {
                tr.classList.add(
                    'row-cancelada'
                );
            }

            const dsp =
                document.createElement(
                    'td'
                );

            dsp.textContent =
                item.motoristaId ?
                    'SIM' :
                    'VAGA';

            const motorista =
                document.createElement(
                    'td'
                );

            motorista.textContent =
                item.nome ||
                'Vaga em aberto';

            const veiculo =
                document.createElement(
                    'td'
                );

            veiculo.textContent =
                item.veiculo || '-';

            const onda =
                document.createElement(
                    'td'
                );

            const inputOnda =
                document.createElement(
                    'input'
                );

            inputOnda.className =
                'input-onda';

            inputOnda.value =
                item.onda || '';

            inputOnda.placeholder =
                'Onda';

            inputOnda.addEventListener(
                'input',
                () => {
                    previaAtual
                        .itens[index]
                        .onda =
                        inputOnda.value;
                }
            );

            onda.appendChild(
                inputOnda
            );

            const acoes =
                document.createElement(
                    'td'
                );

            const cancelar =
                document.createElement(
                    'button'
                );

            cancelar.type =
                'button';

            cancelar.className =
                'btn btn-danger btn-icon';

            cancelar.textContent =
                item.status === 'cancelado' ||
                item.status ===
                    'cancelado_amazon'
                    ? 'Reativar'
                    : 'Cancelar';

            cancelar.addEventListener(
                'click',
                () =>
                    alternarCancelamento(
                        index
                    )
            );

            acoes.appendChild(
                cancelar
            );

            tr.append(
                dsp,
                motorista,
                veiculo,
                onda,
                acoes
            );

            corpo.appendChild(tr);
        }
    );

    const salvar =
        document.getElementById(
            'btnSalvarPrevia'
        );

    const confirmar =
        document.getElementById(
            'btnConfirmarDefinitiva'
        );

    const imagem =
        document.getElementById(
            'btnBaixarImagem'
        );

    if (salvar) {
        salvar.disabled =
            definitiva;
    }

    if (confirmar) {
        confirmar.disabled =
            definitiva ||
            usuarioLogado?.role ===
                'usuario';
    }

    if (imagem) {
        imagem.disabled = false;
    }
}

function alternarCancelamento(index) {
    const item =
        previaAtual?.itens[index];

    if (!item) return;

    if (
        item.status === 'cancelado' ||
        item.status ===
            'cancelado_amazon'
    ) {
        item.status = 'ativo';
    } else {
        item.status = 'cancelado_amazon';
        item.mensagem =
            MENSAGEM_CANCELAMENTO_AMAZON;
    }

    renderizarEscala();
}

async function salvarPrevia() {
    if (!previaAtual) {
        mostrarToast(
            'Gere uma prévia primeiro.',
            'error'
        );

        return;
    }

    const registro = {
        data:
            previaAtual.data,
        status:
            'previa',
        itens:
            previaAtual.itens,
        updated_at:
            new Date().toISOString()
    };

    let resultado;

    if (previaAtual.id) {
        resultado =
            await supabaseClient
                .from('escalas')
                .update(registro)
                .eq(
                    'id',
                    previaAtual.id
                )
                .select()
                .single();
    } else {
        resultado =
            await supabaseClient
                .from('escalas')
                .insert({
                    ...registro,
                    created_by:
                        usuarioLogado.id
                })
                .select()
                .single();
    }

    if (resultado.error) {
        mostrarToast(
            obterMensagemErro(
                resultado.error
            ),
            'error'
        );

        return;
    }

    previaAtual =
        resultado.data;

    escalas[previaAtual.data] =
        previaAtual;

    await registrarAuditoria(
        'SALVAR_ESCALA',
        'escala',
        previaAtual.id,
        previaAtual.data,
        {
            status: 'previa'
        }
    );

    renderizarEscala();

    mostrarToast(
        'Prévia salva.',
        'success'
    );
}

async function confirmarEscala() {
    if (
        !previaAtual ||
        !previaAtual.id
    ) {
        mostrarToast(
            'Salve a prévia antes de confirmar.',
            'error'
        );

        return;
    }

    if (usuarioLogado?.role === 'usuario') {
        mostrarToast(
            'Seu perfil não pode confirmar escalas.',
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
        data,
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
            previaAtual.id
        )
        .select()
        .single();

    if (error) {
        mostrarToast(
            obterMensagemErro(error),
            'error'
        );

        return;
    }

    previaAtual =
        data;

    escalas[data.data] =
        data;

    await registrarAuditoria(
        'CONFIRMAR_ESCALA',
        'escala',
        data.id,
        data.data,
        {}
    );

    renderizarEscala();

    mostrarToast(
        'Escala confirmada.',
        'success'
    );
}

async function arquivarEscalaAtual() {
    if (usuarioLogado?.role !== 'admin') {
        mostrarToast(
            'Somente administradores podem arquivar escalas.',
            'error'
        );

        return;
    }

    if (
        !previaAtual?.id
    ) {
        mostrarToast(
            'Nenhuma escala salva selecionada.',
            'error'
        );

        return;
    }

    if (!confirm(
        'Arquivar esta escala?'
    )) {
        return;
    }

    const motivo =
        prompt(
            'Motivo do arquivamento:'
        );

    if (!motivo?.trim()) {
        mostrarToast(
            'Informe um motivo.',
            'error'
        );

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
                motivo.trim(),
            updated_at:
                new Date().toISOString()
        })
        .eq(
            'id',
            previaAtual.id
        );

    if (error) {
        mostrarToast(
            obterMensagemErro(error),
            'error'
        );

        return;
    }

    await registrarAuditoria(
        'ARQUIVAR_ESCALA',
        'escala',
        previaAtual.id,
        previaAtual.data,
        {
            motivo: motivo.trim()
        }
    );

    delete escalas[previaAtual.data];

    previaAtual = null;

    document
        .getElementById(
            'painelEscala'
        )
        .hidden = true;

    mostrarToast(
        'Escala arquivada.',
        'success'
    );
}

/* =========================================================
   EXPORTAÇÕES
========================================================= */

function exportarEscalaExcel() {
    if (
        !previaAtual ||
        !window.XLSX
    ) {
        mostrarToast(
            'Não há escala para exportar.',
            'error'
        );

        return;
    }

    const linhas =
        previaAtual.itens.map(
            item => ({
                DSP:
                    item.motoristaId ?
                        'SIM' :
                        'VAGA',
                Motorista:
                    item.nome,
                Veículo:
                    item.veiculo,
                Onda:
                    item.onda || '',
                Status:
                    item.status
            })
        );

    const planilha =
        XLSX.utils.json_to_sheet(
            linhas
        );

    const livro =
        XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
        livro,
        planilha,
        'Escala'
    );

    XLSX.writeFile(
        livro,
        `escala_${previaAtual.data}.xlsx`
    );
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
        motoristas.map(
            motorista => ({
                Nome:
                    motorista.nome,
                Telefone:
                    motorista.telefone || '',
                Veículo:
                    motorista.tipo_veiculo ||
                    motorista.veiculo ||
                    '',
                Prioridade:
                    motorista.prioridade ?
                        'Sim' :
                        'Não'
            })
        );

    const planilha =
        XLSX.utils.json_to_sheet(
            linhas
        );

    const livro =
        XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
        livro,
        planilha,
        'Motoristas'
    );

    XLSX.writeFile(
        livro,
        `motoristas_${obterDataISO()}.xlsx`
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

        return;
    }

    const dados =
        await arquivo.arrayBuffer();

    const livro =
        XLSX.read(
            dados,
            {
                type: 'array'
            }
        );

    const primeiraAba =
        livro.Sheets[
            livro.SheetNames[0]
        ];

    const linhas =
        XLSX.utils.sheet_to_json(
            primeiraAba
        );

    let inseridos = 0;

    for (const linha of linhas) {
        const nome =
            String(
                linha.Nome ||
                linha.nome ||
                linha.Motorista ||
                ''
            ).trim();

        const telefone =
            String(
                linha.Telefone ||
                linha.telefone ||
                ''
            ).trim();

        const tipo =
            String(
                linha.Veículo ||
                linha.Veiculo ||
                linha.tipo_veiculo ||
                'Utilitário'
            ).trim();

        if (!nome) continue;

        const {
            data,
            error
        } = await supabaseClient
            .from('motoristas')
            .insert({
                nome,
                telefone,
                tipo_veiculo:
                    TIPOS_VEICULO.includes(tipo)
                        ? tipo
                        : 'Utilitário',
                prioridade: false,
                ativo: true,
                created_by:
                    usuarioLogado.id
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

    event.target.value = '';

    await carregarMotoristas();

    renderizarMotoristas();
    renderizarPrioridades();

    mostrarToast(
        `${inseridos} motorista(s) importado(s).`,
        'success'
    );
}

async function baixarImagemEscala() {
    const area =
        document.getElementById(
            'areaCapturaImagem'
        );

    if (
        !area ||
        !window.html2canvas
    ) {
        mostrarToast(
            'Não foi possível gerar a imagem.',
            'error'
        );

        return;
    }

    const canvas =
        await html2canvas(area);

    const link =
        document.createElement(
            'a'
        );

    link.download =
        `escala_${previaAtual?.data || obterDataISO()}.png`;

    link.href =
        canvas.toDataURL('image/png');

    link.click();
}

function compartilharWhatsApp() {
    if (!previaAtual) {
        mostrarToast(
            'Gere uma escala primeiro.',
            'error'
        );

        return;
    }

    const linhas =
        previaAtual.itens.map(
            item =>
                `• ${item.nome} — ${
                    item.veiculo
                } — Onda ${
                    item.onda || '-'
                }`
        );

    const texto =
        `*BETAXLOG — ESCALA*%0A` +
        `Data: ${
            formatarData(
                previaAtual.data
            )
        }%0A%0A` +
        linhas.join('%0A');

    window.open(
        `https://wa.me/?text=${texto}`,
        '_blank',
        'noopener'
    );
}

/* =========================================================
   RELATÓRIOS
========================================================= */

function gerarRelatorio() {
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
        mostrarToast(
            'Informe o período do relatório.',
            'error'
        );

        return;
    }

    const inicio =
        converterData(
            inicioTexto
        );

    const fim =
        converterData(
            fimTexto
        );

    fim.setHours(
        23,
        59,
        59,
        999
    );

    const registros =
        Object.values(
            escalas
        ).filter(
            escala => {
                const data =
                    converterData(
                        escala.data
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
        escala => {
            const itens =
                escala.itens ||
                escala.dados ||
                [];

            itens.forEach(
                item => {
                    if (!item.motoristaId) {
                        return;
                    }

                    total++;

                    const cancelado =
                        item.status ===
                            'cancelado' ||
                        item.status ===
                            'cancelado_amazon';

                    if (cancelado) {
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
                            nome:
                                item.nome,
                            veiculo:
                                item.veiculo,
                            escalas: 0,
                            cancelamentos: 0
                        };
                    }

                    ranking[
                        item.motoristaId
                    ].escalas++;

                    if (cancelado) {
                        ranking[
                            item.motoristaId
                        ].cancelamentos++;
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
        `${total ? (
            ativas / total * 100
        ).toFixed(1) : 0}%`
    );

    const corpo =
        document.getElementById(
            'tabelaRankingBody'
        );

    if (corpo) {
        corpo.replaceChildren();

        Object.values(ranking)
            .sort(
                (a, b) =>
                    b.escalas -
                    a.escalas
            )
            .forEach(
                item => {
                    const tr =
                        document.createElement(
                            'tr'
                        );

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
                    ].forEach(
                        valor => {
                            const td =
                                document.createElement(
                                    'td'
                                );

                            td.textContent =
                                valor;

                            tr.appendChild(
                                td
                            );
                        }
                    );

                    corpo.appendChild(
                        tr
                    );
                }
            );
    }

    atualizarGraficos(
        registros
    );
}

function atualizarGraficos(registros) {
    if (!window.Chart) return;

    const evolucao = {};
    const veiculos = {
        'Utilitário': 0,
        'Van': 0,
        'Carro de Passeio': 0
    };

    registros.forEach(
        escala => {
            const itens =
                escala.itens ||
                escala.dados ||
                [];

            evolucao[escala.data] =
                itens.filter(
                    item =>
                        item.motoristaId &&
                        item.status !==
                            'cancelado' &&
                        item.status !==
                            'cancelado_amazon'
                ).length;

            itens.forEach(
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
        chartEvolucao?.destroy();

        chartEvolucao =
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
        chartVeiculos?.destroy();

        chartVeiculos =
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

function aplicarAtalhoPeriodo() {
    const atalho =
        document
            .getElementById(
                'filtroAtalhoPeriodo'
            )
            ?.value;

    const hoje =
        new Date();

    const inicio =
        new Date();

    if (atalho === 'mes_atual') {
        inicio.setDate(1);
    }

    if (atalho === 'ultimos_7') {
        inicio.setDate(
            hoje.getDate() - 7
        );
    }

    if (atalho === 'ultimos_6_meses') {
        inicio.setMonth(
            hoje.getMonth() - 6
        );
    }

    if (atalho === 'este_ano') {
        inicio.setMonth(0, 1);
    }

    if (!atalho) return;

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

    const pdf =
        new jsPDF();

    pdf.text(
        'Relatório BETAXLOG',
        14,
        20
    );

    if (
        typeof pdf.autoTable ===
        'function'
    ) {
        pdf.autoTable({
            html:
                '#tabelaRankingBody',
            startY: 30
        });
    }

    pdf.save(
        `relatorio_${obterDataISO()}.pdf`
    );
}

/* =========================================================
   ADMINISTRAÇÃO
========================================================= */

function abrirPainelAdmin() {
    if (usuarioLogado?.role !== 'admin') {
        mostrarToast(
            'Acesso restrito ao administrador.',
            'error'
        );

        return;
    }

    let modal =
        document.getElementById(
            'modalAdmin'
        );

    if (!modal) {
        modal =
            criarModalAdmin();

        document.body.appendChild(
            modal
        );
    }

    modal.hidden = false;

    carregarUsuariosAdmin();
    carregarAuditoria();
}

function fecharPainelAdmin() {
    document
        .getElementById(
            'modalAdmin'
        )
        ?.setAttribute(
            'hidden',
            ''
        );
}

function criarModalAdmin() {
    const modal =
        document.createElement(
            'div'
        );

    modal.id =
        'modalAdmin';

    modal.className =
        'modal-overlay';

    modal.hidden = true;

    modal.innerHTML = `
        <div class="modal-content">
            <div class="card-title-flex">
                <h2>Painel administrativo</h2>

                <button
                    id="btnFecharAdmin"
                    class="btn btn-danger"
                    type="button">
                    Fechar
                </button>
            </div>

            <div class="toolbar">
                <button
                    id="btnNovoUsuarioAdmin"
                    class="btn btn-primary"
                    type="button">
                    Novo usuário
                </button>
            </div>

            <h3>Usuários</h3>

            <div
                id="listaUsuariosAdmin"
                class="admin-list">
            </div>

            <h3>Auditoria</h3>

            <div class="table-wrapper">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Data</th>
                            <th>Usuário</th>
                            <th>Ação</th>
                            <th>Registro</th>
                        </tr>
                    </thead>

                    <tbody
                        id="tabelaAuditoriaBody">
                    </tbody>
                </table>
            </div>
        </div>
    `;

    modal
        .querySelector(
            '#btnFecharAdmin'
        )
        .addEventListener(
            'click',
            fecharPainelAdmin
        );

    modal
        .querySelector(
            '#btnNovoUsuarioAdmin'
        )
        .addEventListener(
            'click',
            abrirCadastroUsuario
        );

    return modal;
}

async function carregarUsuariosAdmin() {
    const lista =
        document.getElementById(
            'listaUsuariosAdmin'
        ) ||
        document.getElementById(
            'listaUsuariosCadastrados'
        );

    if (!lista) return;

    const {
        data,
        error
    } = await supabaseClient
        .from('profiles')
        .select(
            'id, nome, email, role, ativo'
        )
        .order(
            'nome'
        );

    lista.replaceChildren();

    if (error) {
        lista.textContent =
            obterMensagemErro(error);

        return;
    }

    (data || []).forEach(
        usuario => {
            const item =
                document.createElement(
                    'div'
                );

            item.className =
                'checkbox-item';

            const texto =
                document.createElement(
                    'span'
                );

            texto.textContent =
                `${usuario.nome || '-'} · ${
                    usuario.email || '-'
                }`;

            const controles =
                document.createElement(
                    'div'
                );

            const role =
                document.createElement(
                    'select'
                );

            role.innerHTML = `
                <option value="admin">
                    Administrador
                </option>
                <option value="operador">
                    Operador
                </option>
                <option value="usuario">
                    Usuário
                </option>
            `;

            role.value =
                usuario.role || 'usuario';

            const status =
                document.createElement(
                    'select'
                );

            status.innerHTML = `
                <option value="true">
                    Ativo
                </option>
                <option value="false">
                    Inativo
                </option>
            `;

            status.value =
                String(
                    usuario.ativo !== false
                );

            const salvar =
                document.createElement(
                    'button'
                );

            salvar.className =
                'btn btn-primary btn-icon';

            salvar.type =
                'button';

            salvar.textContent =
                'Salvar';

            salvar.addEventListener(
                'click',
                () =>
                    atualizarUsuario(
                        usuario,
                        role.value,
                        status.value ===
                            'true'
                    )
            );

            controles.append(
                role,
                status,
                salvar
            );

            item.append(
                texto,
                controles
            );

            lista.appendChild(
                item
            );
        }
    );
}

async function atualizarUsuario(
    usuario,
    role,
    ativo
) {
    if (
        usuario.id ===
            usuarioLogado.id &&
        (
            role !== 'admin' ||
            !ativo
        )
    ) {
        mostrarToast(
            'Você não pode remover seu próprio acesso de administrador.',
            'error'
        );

        return;
    }

    if (
        usuario.role === 'admin' &&
        (
            role !== 'admin' ||
            !ativo
        )
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
                'É necessário manter um administrador ativo.',
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
            obterMensagemErro(error),
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

function abrirCadastroUsuario() {
    mostrarToast(
        'Crie o usuário em Supabase Authentication e depois cadastre o perfil em profiles.',
        'info'
    );
}

/* =========================================================
   AUDITORIA
========================================================= */

async function registrarAuditoria(
    action,
    entityType,
    entityId,
    entityLabel,
    details = {}
) {
    if (!usuarioLogado) return;

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
            details
        });

    if (error) {
        console.error(
            'Erro ao registrar auditoria:',
            error
        );
    }
}

async function carregarAuditoria() {
    const corpo =
        document.getElementById(
            'tabelaAuditoriaBody'
        );

    if (!corpo) return;

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

    corpo.replaceChildren();

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
            obterMensagemErro(error);

        tr.appendChild(td);
        corpo.appendChild(tr);

        return;
    }

    (data || []).forEach(
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
                    registro.user_id ||
                    '-',
                registro.action ||
                    '-',
                registro.entity_label ||
                    registro.entity_type ||
                    '-'
            ].forEach(
                valor => {
                    const td =
                        document.createElement(
                            'td'
                        );

                    td.textContent =
                        valor;

                    tr.appendChild(td);
                }
            );

            corpo.appendChild(tr);
        }
    );
}

/* =========================================================
   DATAS E FUNÇÕES AUXILIARES
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

function atualizarInformacoesUsuario() {
    definirTexto(
        'usuarioAtual',
        `${usuarioLogado.nome} · ${
            usuarioLogado.role
        }`
    );

    definirTexto(
        'infoUltimoBackup',
        `☁️ Supabase sincronizado em ${
            new Date().toLocaleString(
                'pt-BR'
            )
        }`
    );
}

function obterNumero(id) {
    return Number(
        document
            .getElementById(id)
            ?.value || 0
    );
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
    if (!valor) return '-';

    const partes =
        String(valor).split('-');

    return partes.length === 3
        ? partes.reverse().join('/')
        : valor;
}

function formatarDataHora(valor) {
    if (!valor) return '-';

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

    container.appendChild(
        toast
    );

    setTimeout(
        () => toast.remove(),
        5000
    );
}
