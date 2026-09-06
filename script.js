'use strict';

/*
    BETAXLOG
    Script completo e seguro para o frontend.

    Importante:
    - Não utiliza actor_id.
    - Não utiliza service_role.
    - Não possui apagarTodoOSistema().
    - Não exclui todos os dados.
    - O arquivamento de motoristas é lógico.
*/

const SUPABASE_URL =
    'https://bnpfdkwjdtnpfmnjoftf.supabase.co';

const SUPABASE_ANON_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJucGZka3dqZHRucGZtbmpvZnRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1NzMxNzcsImV4cCI6MjEwNDE0OTE3N30.5ksgMBijxazAtCtse-Lb5MqmaxcL22dVqKBMrnjSYMA';

let supabaseClient = null;
let usuarioLogado = null;

let motoristas = [];
let escalas = [];
let indisponibilidades = [];
let escalaAtual = null;

let chartEvolucaoInstancia = null;
let chartVeiculosInstancia = null;

const TIPOS_VEICULO = [
    'Utilitário',
    'Van',
    'Carro de Passeio'
];

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
        await carregarIndisponibilidades();
        await carregarEscalas();

        renderizarMotoristas();
        renderizarPrioridades();
        renderizarIndisponibilidades();
        carregarEscalaDaData();

        mostrarSistema();
        atualizarInformacoes();
        esconderLoader();
    } catch (error) {
        console.error(error);

        esconderLoader();

        mostrarLogin(
            `Erro ao iniciar: ${obterMensagemErro(error)}`
        );
    }
}

function esconderLoader() {
    const loader =
        document.getElementById('appLoader');

    if (loader) {
        loader.remove();
    }
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
    const resultado =
        await supabaseClient.auth.getSession();

    if (resultado.error) {
        mostrarLogin(
            obterMensagemErro(resultado.error)
        );

        return false;
    }

    const session =
        resultado.data.session;

    if (!session) {
        mostrarLogin();
        return false;
    }

    const perfilResultado =
        await supabaseClient
            .from('profiles')
            .select(
                'id, nome, email, role, ativo'
            )
            .eq(
                'id',
                session.user.id
            )
            .maybeSingle();

    if (perfilResultado.error) {
        mostrarLogin(
            `Erro ao carregar perfil: ${
                obterMensagemErro(
                    perfilResultado.error
                )
            }`
        );

        return false;
    }

    if (!perfilResultado.data) {
        mostrarLogin(
            'Este usuário não possui registro na tabela profiles.'
        );

        return false;
    }

    if (perfilResultado.data.ativo === false) {
        await supabaseClient.auth.signOut();

        mostrarLogin(
            'Este usuário está desativado.'
        );

        return false;
    }

    usuarioLogado = {
        id: session.user.id,
        email:
            perfilResultado.data.email ||
            session.user.email ||
            '',
        nome:
            perfilResultado.data.nome ||
            session.user.email ||
            'Usuário',
        role:
            perfilResultado.data.role ||
            'operador',
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
                    Entre com seu usuário do Supabase.
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

        const formLogin =
            document.getElementById(
                'formLogin'
            );

        if (formLogin) {
            formLogin.addEventListener(
                'submit',
                efetuarLogin
            );
        }
    }

    overlay.hidden = false;
    document.body.classList.add(
        'login-open'
    );

    const campoMensagem =
        document.getElementById(
            'loginMensagem'
        );

    if (campoMensagem) {
        campoMensagem.textContent =
            mensagem;

        campoMensagem.hidden =
            mensagem.length === 0;
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
        document.getElementById(
            'btnLogin'
        );

    botao.disabled = true;
    botao.textContent = 'Entrando...';

    const resultado =
        await supabaseClient.auth.signInWithPassword({
            email,
            password: senha
        });

    if (resultado.error) {
        mostrarLogin(
            obterMensagemErro(
                resultado.error
            )
        );

        botao.disabled = false;
        botao.textContent = 'Entrar';

        return;
    }

    window.location.reload();
}

async function sair() {
    await supabaseClient.auth.signOut();
    window.location.reload();
}

/* =========================================================
   EVENTOS
========================================================= */

function configurarEventos() {
    adicionarEvento(
        'btnSair',
        'click',
        sair
    );

    adicionarEvento(
        'btnPainelAdmin',
        'click',
        abrirPainelAdmin
    );

    adicionarEvento(
        'btnAbaOperacional',
        'click',
        () => mudarAba('operacional')
    );

    adicionarEvento(
        'btnAbaMotoristas',
        'click',
        () => mudarAba('motoristas')
    );

    adicionarEvento(
        'btnAbaRelatorios',
        'click',
        () => mudarAba('relatorios')
    );

    adicionarEvento(
        'btnGerarPrevia',
        'click',
        gerarPrevia
    );

    adicionarEvento(
        'btnSalvarPrevia',
        'click',
        salvarPrevia
    );

    adicionarEvento(
        'btnConfirmarDefinitiva',
        'click',
        confirmarDefinitiva
    );

    adicionarEvento(
        'btnExcluirEscala',
        'click',
        arquivarEscala
    );

    adicionarEvento(
        'btnBaixarImagem',
        'click',
        baixarImagem
    );

    adicionarEvento(
        'btnWhatsApp',
        'click',
        compartilharWhatsApp
    );

    adicionarEvento(
        'btnExportarEscala',
        'click',
        exportarEscalaExcel
    );

    adicionarEvento(
        'dataEscala',
        'change',
        async () => {
            renderizarIndisponibilidades();
            carregarEscalaDaData();
        }
    );

    adicionarEvento(
        'btnCadastrarMotorista',
        'click',
        cadastrarMotorista
    );

    adicionarEvento(
        'filtroMotorista',
        'input',
        renderizarMotoristas
    );

    adicionarEvento(
        'buscaIndisponibilidade',
        'input',
        renderizarIndisponibilidades
    );

    adicionarEvento(
        'checkTodosMotoristas',
        'change',
        selecionarTodosMotoristas
    );

    adicionarEvento(
        'btnArquivarSelecionados',
        'click',
        arquivarSelecionados
    );

    adicionarEvento(
        'arquivoExcel',
        'change',
        importarExcel
    );

    adicionarEvento(
        'btnExportarMotoristas',
        'click',
        exportarMotoristas
    );

    adicionarEvento(
        'btnTodosRodizio',
        'click',
        selecionarTodosRodizio
    );

    adicionarEvento(
        'btnTodosPrioritarios',
        'click',
        selecionarTodosPrioritarios
    );

    adicionarEvento(
        'btnMoverParaPrioridade',
        'click',
        moverParaPrioridade
    );

    adicionarEvento(
        'btnMoverParaRodizio',
        'click',
        moverParaRodizio
    );

    adicionarEvento(
        'btnGerarRelatorio',
        'click',
        gerarRelatorio
    );

    adicionarEvento(
        'btnExportarPDF',
        'click',
        exportarPDF
    );

    adicionarEvento(
        'filtroAtalhoPeriodo',
        'change',
        aplicarAtalhoPeriodo
    );

    adicionarEvento(
        'formEditarMotorista',
        'submit',
        salvarEdicaoMotorista
    );

    adicionarEvento(
        'btnCancelarEdicao',
        'click',
        fecharModalEdicao
    );

    adicionarEvento(
        'btnFecharAdmin',
        'click',
        fecharPainelAdmin
    );
}

function adicionarEvento(
    id,
    tipo,
    funcao
) {
    const elemento =
        document.getElementById(id);

    if (!elemento) {
        return;
    }

    elemento.addEventListener(
        tipo,
        funcao
    );
}

/* =========================================================
   ABAS E PERMISSÕES
========================================================= */

function mudarAba(nome) {
    const views = {
        operacional:
            'viewOperacional',
        motoristas:
            'viewMotoristas',
        relatorios:
            'viewRelatorios'
    };

    Object.entries(views).forEach(
        ([chave, id]) => {
            const view =
                document.getElementById(id);

            if (view) {
                view.hidden =
                    chave !== nome;
            }

            const botao =
                document.getElementById(
                    `btnAba${
                        chave
                            .charAt(0)
                            .toUpperCase() +
                        chave.slice(1)
                    }`
                );

            if (botao) {
                botao.classList.toggle(
                    'active',
                    chave === nome
                );
            }
        }
    );
}

function aplicarPermissoes() {
    const botao =
        document.getElementById(
            'btnPainelAdmin'
        );

    if (botao) {
        botao.hidden =
            usuarioLogado?.role !== 'admin';
    }
}

/* =========================================================
   MOTORISTAS
========================================================= */

async function carregarMotoristas() {
    const resultado =
        await supabaseClient
            .from('motoristas')
            .select('*')
            .eq('ativo', true)
            .order('nome');

    if (resultado.error) {
        mostrarToast(
            `Motoristas: ${
                obterMensagemErro(
                    resultado.error
                )
            }`,
            'error'
        );

        motoristas = [];
        return;
    }

    motoristas =
        resultado.data || [];
}

function renderizarMotoristas() {
    const lista =
        document.getElementById(
            'listaMotoristas'
        );

    if (!lista) {
        return;
    }

    const filtro =
        document
            .getElementById(
                'filtroMotorista'
            )
            ?.value
            .toLowerCase()
            .trim() || '';

    lista.replaceChildren();

    const filtrados =
        motoristas.filter(
            motorista =>
                String(
                    motorista.nome || ''
                )
                    .toLowerCase()
                    .includes(filtro)
        );

    if (filtrados.length === 0) {
        lista.textContent =
            'Nenhum motorista encontrado.';
    }

    filtrados.forEach(
        motorista => {
            const item =
                document.createElement(
                    'div'
                );

            item.className =
                'motorista-item';

            const info =
                document.createElement(
                    'div'
                );

            info.className =
                'motorista-info';

            const nome =
                document.createElement(
                    'div'
                );

            nome.className =
                'motorista-nome';

            nome.textContent =
                motorista.nome || '-';

            const detalhes =
                document.createElement(
                    'div'
                );

            detalhes.className =
                'motorista-detalhes';

            detalhes.textContent =
                `${motorista.telefone || '-'} · ${
                    motorista.veiculo || 'Utilitário'
                }${
                    motorista.prioridade
                        ? ' · Prioritário'
                        : ''
                }`;

            info.append(
                nome,
                detalhes
            );

            const acoes =
                document.createElement(
                    'div'
                );

            acoes.className =
                'motorista-acoes';

            const editar =
                document.createElement(
                    'button'
                );

            editar.className =
                'btn btn-secondary btn-small';

            editar.type =
                'button';

            editar.textContent =
                'Editar';

            editar.addEventListener(
                'click',
                () =>
                    abrirModalEdicao(
                        motorista
                    )
            );

            const arquivar =
                document.createElement(
                    'button'
                );

            arquivar.className =
                'btn btn-danger btn-small';

            arquivar.type =
                'button';

            arquivar.textContent =
                'Arquivar';

            arquivar.addEventListener(
                'click',
                () =>
                    arquivarMotorista(
                        motorista
                    )
            );

            acoes.append(
                editar,
                arquivar
            );

            item.append(
                info,
                acoes
            );

            lista.appendChild(item);
        }
    );

    definirTexto(
        'contadorTotalMotoristas',
        `Total: ${motoristas.length}`
    );
}

async function cadastrarMotorista() {
    const nome =
        document
            .getElementById(
                'nomeMotorista'
            )
            .value
            .trim();

    const telefone =
        document
            .getElementById(
                'telMotorista'
            )
            .value
            .trim();

    const veiculo =
        document
            .getElementById(
                'tipoVeiculo'
            )
            .value;

    const prioridade =
        document
            .getElementById(
                'motoristaPrioridade'
            )
            .checked;

    if (!nome) {
        mostrarToast(
            'Informe o nome do motorista.',
            'error'
        );

        return;
    }

    const resultado =
        await supabaseClient
            .from('motoristas')
            .insert({
                nome,
                telefone,
                veiculo,
                prioridade,
                ativo: true
            })
            .select()
            .single();

    if (resultado.error) {
        mostrarToast(
            obterMensagemErro(
                resultado.error
            ),
            'error'
        );

        return;
    }

    await registrarAuditoria(
        'CRIAR_MOTORISTA',
        'motorista',
        resultado.data.id,
        nome,
        {
            veiculo,
            prioridade
        }
    );

    document
        .getElementById(
            'nomeMotorista'
        )
        .value = '';

    document
        .getElementById(
            'telMotorista'
        )
        .value = '';

    document
        .getElementById(
            'motoristaPrioridade'
        )
        .checked = false;

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
        .getElementById(
            'editarMotoristaId'
        )
        .value =
        motorista.id;

    document
        .getElementById(
            'editarMotoristaNome'
        )
        .value =
        motorista.nome || '';

    document
        .getElementById(
            'editarMotoristaTelefone'
        )
        .value =
        motorista.telefone || '';

    document
        .getElementById(
            'editarMotoristaVeiculo'
        )
        .value =
        motorista.veiculo || 'Utilitário';

    document
        .getElementById(
            'editarMotoristaPrioridade'
        )
        .checked =
        motorista.prioridade === true;

    document
        .getElementById(
            'modalEditarMotorista'
        )
        .hidden = false;
}

function fecharModalEdicao() {
    document
        .getElementById(
            'modalEditarMotorista'
        )
        .hidden = true;
}

async function salvarEdicaoMotorista(event) {
    event.preventDefault();

    const id =
        document
            .getElementById(
                'editarMotoristaId'
            )
            .value;

    const nome =
        document
            .getElementById(
                'editarMotoristaNome'
            )
            .value
            .trim();

    const telefone =
        document
            .getElementById(
                'editarMotoristaTelefone'
            )
            .value
            .trim();

    const veiculo =
        document
            .getElementById(
                'editarMotoristaVeiculo'
            )
            .value;

    const prioridade =
        document
            .getElementById(
                'editarMotoristaPrioridade'
            )
            .checked;

    const resultado =
        await supabaseClient
            .from('motoristas')
            .update({
                nome,
                telefone,
                veiculo,
                prioridade,
                updated_at:
                    new Date().toISOString()
            })
            .eq(
                'id',
                id
            );

    if (resultado.error) {
        mostrarToast(
            obterMensagemErro(
                resultado.error
            ),
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
            veiculo,
            prioridade
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

async function arquivarMotorista(motorista) {
    const confirmar =
        window.confirm(
            `Arquivar o motorista "${motorista.nome}"?`
        );

    if (!confirmar) {
        return;
    }

    const resultado =
        await supabaseClient
            .from('motoristas')
            .update({
                ativo: false,
                deleted_at:
                    new Date().toISOString(),
                deleted_by:
                    usuarioLogado.id,
                deleted_reason:
                    'Arquivamento pelo sistema'
            })
            .eq(
                'id',
                motorista.id
            );

    if (resultado.error) {
        mostrarToast(
            obterMensagemErro(
                resultado.error
            ),
            'error'
        );

        return;
    }

    await registrarAuditoria(
        'ARQUIVAR_MOTORISTA',
        'motorista',
        motorista.id,
        motorista.nome,
        {}
    );

    await carregarMotoristas();

    renderizarMotoristas();
    renderizarPrioridades();

    mostrarToast(
        'Motorista arquivado.',
        'success'
    );
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
                String(
                    motorista.nome || ''
                )
                    .toLowerCase()
                    .includes(filtro)
        )
        .forEach(
            motorista => {
                motorista._selecionado =
                    marcado;
            }
        );
}

async function arquivarSelecionados() {
    const selecionados =
        motoristas.filter(
            motorista =>
                motorista._selecionado === true
        );

    if (selecionados.length === 0) {
        mostrarToast(
            'Selecione pelo menos um motorista.',
            'warning'
        );

        return;
    }

    const confirmar =
        window.confirm(
            `Arquivar ${selecionados.length} motorista(s)?`
        );

    if (!confirmar) {
        return;
    }

    for (const motorista of selecionados) {
        await supabaseClient
            .from('motoristas')
            .update({
                ativo: false,
                deleted_at:
                    new Date().toISOString(),
                deleted_by:
                    usuarioLogado.id,
                deleted_reason:
                    'Arquivamento em lote'
            })
            .eq(
                'id',
                motorista.id
            );

        await registrarAuditoria(
            'ARQUIVAR_MOTORISTA',
            'motorista',
            motorista.id,
            motorista.nome,
            {
                lote: true
            }
        );
    }

    await carregarMotoristas();

    renderizarMotoristas();
    renderizarPrioridades();

    mostrarToast(
        'Motoristas arquivados.',
        'success'
    );
}

/* =========================================================
   PRIORIDADES
========================================================= */

function renderizarPrioridades() {
    const rodizio =
        document.getElementById(
            'listaNoRodizio'
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

function selecionarTodosRodizio() {
    marcarTodasOpcoes(
        'listaNoRodizio'
    );
}

function selecionarTodosPrioritarios() {
    marcarTodasOpcoes(
        'listaPrioritarios'
    );
}

function marcarTodasOpcoes(id) {
    const select =
        document.getElementById(id);

    if (!select) {
        return;
    }

    Array.from(
        select.options
    ).forEach(
        option => {
            option.selected = true;
        }
    );
}

async function moverParaPrioridade() {
    await atualizarPrioridadeSelecionados(
        'listaNoRodizio',
        true
    );
}

async function moverParaRodizio() {
    await atualizarPrioridadeSelecionados(
        'listaPrioritarios',
        false
    );
}

async function atualizarPrioridadeSelecionados(
    id,
    valor
) {
    const select =
        document.getElementById(id);

    if (!select) {
        return;
    }

    const ids =
        Array.from(
            select.selectedOptions
        ).map(
            option => option.value
        );

    if (ids.length === 0) {
        return;
    }

    const resultado =
        await supabaseClient
            .from('motoristas')
            .update({
                prioridade: valor
            })
            .in(
                'id',
                ids
            );

    if (resultado.error) {
        mostrarToast(
            obterMensagemErro(
                resultado.error
            ),
            'error'
        );

        return;
    }

    await carregarMotoristas();
    renderizarPrioridades();
    renderizarMotoristas();

    mostrarToast(
        'Prioridade atualizada.',
        'success'
    );
}

/* =========================================================
   INDISPONIBILIDADES
========================================================= */

async function carregarIndisponibilidades() {
    const data =
        obterDataEscala();

    const resultado =
        await supabaseClient
            .from('indisponibilidades')
            .select('*')
            .eq(
                'data',
                data
            );

    if (resultado.error) {
        indisponibilidades = [];
        return;
    }

    indisponibilidades =
        resultado.data || [];
}

function renderizarIndisponibilidades() {
    const lista =
        document.getElementById(
            'listaMotoristasIndisponiveis'
        );

    if (!lista) {
        return;
    }

    const busca =
        document
            .getElementById(
                'buscaIndisponibilidade'
            )
            ?.value
            .toLowerCase()
            .trim() || '';

    lista.replaceChildren();

    motoristas
        .filter(
            motorista =>
                String(
                    motorista.nome || ''
                )
                    .toLowerCase()
                    .includes(busca)
        )
        .forEach(
            motorista => {
                const item =
                    document.createElement(
                        'label'
                    );

                item.className =
                    'check-line';

                const checkbox =
                    document.createElement(
                        'input'
                    );

                checkbox.type =
                    'checkbox';

                checkbox.checked =
                    indisponibilidades.some(
                        registro =>
                            registro.motorista_id ===
                            motorista.id
                    );

                checkbox.addEventListener(
                    'change',
                    event =>
                        alterarIndisponibilidade(
                            motorista,
                            event.target.checked
                        )
                );

                const texto =
                    document.createElement(
                        'span'
                    );

                texto.textContent =
                    motorista.nome;

                item.append(
                    checkbox,
                    texto
                );

                lista.appendChild(item);
            }
        );
}

async function alterarIndisponibilidade(
    motorista,
    indisponivel
) {
    const data =
        obterDataEscala();

    if (indisponivel) {
        const resultado =
            await supabaseClient
                .from('indisponibilidades')
                .upsert(
                    {
                        data,
                        motorista_id:
                            motorista.id
                    },
                    {
                        onConflict:
                            'data,motorista_id'
                    }
                );

        if (resultado.error) {
            mostrarToast(
                obterMensagemErro(
                    resultado.error
                ),
                'error'
            );

            return;
        }
    } else {
        const resultado =
            await supabaseClient
                .from('indisponibilidades')
                .delete()
                .eq(
                    'data',
                    data
                )
                .eq(
                    'motorista_id',
                    motorista.id
                );

        if (resultado.error) {
            mostrarToast(
                obterMensagemErro(
                    resultado.error
                ),
                'error'
            );

            return;
        }
    }

    await carregarIndisponibilidades();
}

/* =========================================================
   ESCALAS
========================================================= */

async function carregarEscalas() {
    const resultado =
        await supabaseClient
            .from('escalas')
            .select('*')
            .is(
                'deleted_at',
                null
            )
            .order(
                'data',
                {
                    ascending: false
                }
            );

    if (resultado.error) {
        escalas = [];
        return;
    }

    escalas =
        resultado.data || [];
}

function obterDataEscala() {
    return document
        .getElementById(
            'dataEscala'
        )
        .value;
}

function obterMotoristasDisponiveis() {
    const indisponiveis =
        indisponibilidades.map(
            registro =>
                registro.motorista_id
        );

    return motoristas.filter(
        motorista =>
            !indisponiveis.includes(
                motorista.id
            )
    );
}

function gerarPrevia() {
    const data =
        obterDataEscala();

    if (!data) {
        mostrarToast(
            'Selecione a data da escala.',
            'error'
        );

        return;
    }

    const quantidade = {
        'Utilitário':
            obterNumero(
                'vagasUtilitario'
            ),
        'Van':
            obterNumero(
                'vagasVan'
            ),
        'Carro de Passeio':
            obterNumero(
                'vagasPasseio'
            )
    };

    const disponiveis =
        obterMotoristasDisponiveis();

    const itens = [];

    TIPOS_VEICULO.forEach(
        veiculo => {
            const candidatos =
                disponiveis.filter(
                    motorista =>
                        motorista.veiculo ===
                        veiculo
                );

            for (
                let indice = 0;
                indice < quantidade[veiculo];
                indice++
            ) {
                const motorista =
                    candidatos[indice];

                itens.push({
                    dsp:
                        itens.length + 1,
                    motoristaId:
                        motorista?.id || null,
                    nome:
                        motorista?.nome ||
                        'Vaga não preenchida',
                    veiculo,
                    onda: '',
                    status:
                        motorista
                            ? 'ativo'
                            : 'vazio'
                });
            }
        }
    );

    escalaAtual = {
        id: null,
        data,
        status: 'previa',
        itens
    };

    renderizarEscalaAtual();

    mostrarToast(
        'Prévia gerada.',
        'success'
    );
}

function carregarEscalaDaData() {
    const data =
        obterDataEscala();

    const encontrada =
        escalas.find(
            escala =>
                escala.data === data
        );

    if (encontrada) {
        escalaAtual = normalizarEscala(
            encontrada
        );

        renderizarEscalaAtual();
    } else {
        escalaAtual = null;

        const painel =
            document.getElementById(
                'painelEscala'
            );

        if (painel) {
            painel.hidden = true;
        }
    }
}

function normalizarEscala(escala) {
    return {
        id: escala.id,
        data: escala.data,
        status:
            escala.status || 'previa',
        itens:
            Array.isArray(escala.itens)
                ? escala.itens
                : []
    };
}

function renderizarEscalaAtual() {
    const painel =
        document.getElementById(
            'painelEscala'
        );

    const tabela =
        document.getElementById(
            'tabelaEscalaBody'
        );

    if (!painel || !tabela) {
        return;
    }

    if (!escalaAtual) {
        painel.hidden = true;
        return;
    }

    painel.hidden = false;
    tabela.replaceChildren();

    const definitiva =
        escalaAtual.status ===
        'definitiva';

    const aviso =
        document.getElementById(
            'avisoPrevia'
        );

    if (aviso) {
        aviso.hidden = definitiva;
    }

    const tag =
        document.getElementById(
            'tagStatus'
        );

    if (tag) {
        tag.textContent =
            definitiva
                ? 'DEFINITIVA'
                : 'PRÉVIA';

        tag.className =
            definitiva
                ? 'badge-status badge-definitiva'
                : 'badge-status badge-previa';
    }

    definirTexto(
        'dataSubtituloImagem',
        `Data: ${formatarData(escalaAtual.data)}`
    );

    escalaAtual.itens.forEach(
        (item, indice) => {
            const linha =
                document.createElement(
                    'tr'
                );

            const dsp =
                document.createElement(
                    'td'
                );

            dsp.textContent =
                item.dsp || indice + 1;

            const motorista =
                document.createElement(
                    'td'
                );

            motorista.textContent =
                item.nome || '-';

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

            inputOnda.type =
                'text';

            inputOnda.value =
                item.onda || '';

            inputOnda.addEventListener(
                'input',
                event => {
                    item.onda =
                        event.target.value;
                }
            );

            onda.appendChild(
                inputOnda
            );

            const acoes =
                document.createElement(
                    'td'
                );

            if (item.motoristaId) {
                const cancelar =
                    document.createElement(
                        'button'
                    );

                cancelar.className =
                    'btn btn-danger btn-small';

                cancelar.type =
                    'button';

                cancelar.textContent =
                    'Cancelar';

                cancelar.addEventListener(
                    'click',
                    () => {
                        item.status =
                            item.status ===
                            'cancelado'
                                ? 'ativo'
                                : 'cancelado';

                        renderizarEscalaAtual();
                    }
                );

                acoes.appendChild(
                    cancelar
                );
            }

            linha.append(
                dsp,
                motorista,
                veiculo,
                onda,
                acoes
            );

            tabela.appendChild(
                linha
            );
        }
    );

    const confirmar =
        document.getElementById(
            'btnConfirmarDefinitiva'
        );

    if (confirmar) {
        confirmar.disabled =
            !escalaAtual.id ||
            definitiva;
    }
}

async function salvarPrevia() {
    if (!escalaAtual) {
        mostrarToast(
            'Gere uma prévia antes de salvar.',
            'error'
        );

        return;
    }

    const payload = {
        data:
            escalaAtual.data,
        status:
            'previa',
        itens:
            escalaAtual.itens,
        updated_at:
            new Date().toISOString()
    };

    let resultado;

    if (escalaAtual.id) {
        resultado =
            await supabaseClient
                .from('escalas')
                .update(payload)
                .eq(
                    'id',
                    escalaAtual.id
                )
                .select()
                .single();
    } else {
        resultado =
            await supabaseClient
                .from('escalas')
                .insert(payload)
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

    escalaAtual =
        normalizarEscala(
            resultado.data
        );

    await carregarEscalas();
    renderizarEscalaAtual();

    await registrarAuditoria(
        'SALVAR_ESCALA',
        'escala',
        escalaAtual.id,
        escalaAtual.data,
        {
            status: 'previa'
        }
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

    const resultado =
        await supabaseClient
            .from('escalas')
            .update({
                status: 'definitiva',
                itens:
                    escalaAtual.itens,
                updated_at:
                    new Date().toISOString()
            })
            .eq(
                'id',
                escalaAtual.id
            )
            .select()
            .single();

    if (resultado.error) {
        mostrarToast(
            obterMensagemErro(
                resultado.error
            ),
            'error'
        );

        return;
    }

    escalaAtual =
        normalizarEscala(
            resultado.data
        );

    await carregarEscalas();
    renderizarEscalaAtual();

    await registrarAuditoria(
        'CONFIRMAR_ESCALA',
        'escala',
        escalaAtual.id,
        escalaAtual.data,
        {
            status: 'definitiva'
        }
    );

    mostrarToast(
        'Escala confirmada.',
        'success'
    );
}

async function arquivarEscala() {
    if (!escalaAtual?.id) {
        mostrarToast(
            'Não existe escala salva nesta data.',
            'error'
        );

        return;
    }

    const confirmar =
        window.confirm(
            'Arquivar a escala desta data?'
        );

    if (!confirmar) {
        return;
    }

    const resultado =
        await supabaseClient
            .from('escalas')
            .update({
                deleted_at:
                    new Date().toISOString(),
                deleted_by:
                    usuarioLogado.id,
                deleted_reason:
                    'Arquivamento pelo sistema'
            })
            .eq(
                'id',
                escalaAtual.id
            );

    if (resultado.error) {
        mostrarToast(
            obterMensagemErro(
                resultado.error
            ),
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

    await carregarEscalas();
    carregarEscalaDaData();

    mostrarToast(
        'Escala arquivada.',
        'success'
    );
}

/* =========================================================
   EXPORTAÇÕES
========================================================= */

async function baixarImagem() {
    mostrarToast(
        'Para baixar imagem, adicione a biblioteca html2canvas ao index.html.',
        'warning'
    );
}

function compartilharWhatsApp() {
    if (!escalaAtual) {
        mostrarToast(
            'Não existe escala para compartilhar.',
            'error'
        );

        return;
    }

    let texto =
        `ESCALA BETAXLOG\n` +
        `Data: ${formatarData(
            escalaAtual.data
        )}\n\n`;

    escalaAtual.itens.forEach(
        item => {
            texto +=
                `${item.nome} - ` +
                `${item.veiculo} - ` +
                `Onda: ${item.onda || '-'}\n`;
        }
    );

    const url =
        `https://wa.me/?text=${
            encodeURIComponent(texto)
        }`;

    window.open(
        url,
        '_blank',
        'noopener,noreferrer'
    );
}

function exportarEscalaExcel() {
    if (!window.XLSX) {
        mostrarToast(
            'Biblioteca Excel não carregada.',
            'error'
        );

        return;
    }

    if (!escalaAtual) {
        mostrarToast(
            'Não existe escala para exportar.',
            'error'
        );

        return;
    }

    const linhas =
        escalaAtual.itens.map(
            item => ({
                DSP: item.dsp,
                Motorista: item.nome,
                Veículo: item.veiculo,
                Onda: item.onda || '',
                Status: item.status
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
        `escala_${escalaAtual.data}.xlsx`
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
                Nome: motorista.nome,
                Telefone:
                    motorista.telefone || '',
                Veículo:
                    motorista.veiculo || '',
                Prioridade:
                    motorista.prioridade
                        ? 'SIM'
                        : 'NÃO'
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
        event.target.files[0];

    if (!arquivo || !window.XLSX) {
        return;
    }

    try {
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

        let cadastrados = 0;

        for (const linha of linhas) {
            const nome =
                linha.Nome ||
                linha.nome ||
                linha.Motorista ||
                linha.motorista;

            if (!nome) {
                continue;
            }

            const resultado =
                await supabaseClient
                    .from('motoristas')
                    .insert({
                        nome: String(nome),
                        telefone:
                            String(
                                linha.Telefone ||
                                linha.telefone ||
                                ''
                            ),
                        veiculo:
                            linha.Veículo ||
                            linha.Veiculo ||
                            'Utilitário',
                        prioridade:
                            String(
                                linha.Prioridade ||
                                ''
                            ).toUpperCase() ===
                            'SIM',
                        ativo: true
                    });

            if (!resultado.error) {
                cadastrados++;
            }
        }

        await carregarMotoristas();

        renderizarMotoristas();
        renderizarPrioridades();

        mostrarToast(
            `${cadastrados} motorista(s) importado(s).`,
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

/* =========================================================
   RELATÓRIOS
========================================================= */

function aplicarAtalhoPeriodo() {
    const valor =
        document
            .getElementById(
                'filtroAtalhoPeriodo'
            )
            .value;

    if (!valor) {
        return;
    }

    const fim =
        new Date();

    const inicio =
        new Date();

    if (valor === 'mes_atual') {
        inicio.setDate(1);
    }

    if (valor === 'ultimos_7') {
        inicio.setDate(
            inicio.getDate() - 7
        );
    }

    if (valor === 'ultimos_6_meses') {
        inicio.setMonth(
            inicio.getMonth() - 6
        );
    }

    if (valor === 'este_ano') {
        inicio.setMonth(0, 1);
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
        obterDataISO(fim);
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

    const filtradas =
        escalas.filter(
            escala =>
                escala.data >= inicio &&
                escala.data <= fim
        );

    let total = 0;
    let ativas = 0;
    let canceladas = 0;

    const ranking = {};
    const veiculos = {
        'Utilitário': 0,
        'Van': 0,
        'Carro de Passeio': 0
    };

    filtradas.forEach(
        escala => {
            const itens =
                Array.isArray(
                    escala.itens
                )
                    ? escala.itens
                    : [];

            itens.forEach(
                item => {
                    if (!item.motoristaId) {
                        return;
                    }

                    total++;

                    const cancelado =
                        item.status ===
                        'cancelado';

                    if (cancelado) {
                        canceladas++;
                    } else {
                        ativas++;
                    }

                    if (
                        veiculos[
                            item.veiculo
                        ] !== undefined &&
                        !cancelado
                    ) {
                        veiculos[
                            item.veiculo
                        ]++;
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
                            veiculo: item.veiculo,
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
        total
            ? `${(
                ativas / total * 100
            ).toFixed(1)}%`
            : '0%'
    );

    const tabela =
        document.getElementById(
            'tabelaRankingBody'
        );

    tabela.replaceChildren();

    Object.values(ranking)
        .sort(
            (a, b) =>
                b.escalas - a.escalas
        )
        .forEach(
            item => {
                const linha =
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
                        const celula =
                            document.createElement(
                                'td'
                            );

                        celula.textContent =
                            valor;

                        linha.appendChild(
                            celula
                        );
                    }
                );

                tabela.appendChild(
                    linha
                );
            }
        );

    atualizarGraficos(
        filtradas,
        veiculos
    );
}

function atualizarGraficos(
    escalasFiltradas,
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
        const valores =
            escalasFiltradas.map(
                escala =>
                    Array.isArray(
                        escala.itens
                    )
                        ? escala.itens.length
                        : 0
            );

        if (chartEvolucaoInstancia) {
            chartEvolucaoInstancia.destroy();
        }

        chartEvolucaoInstancia =
            new Chart(
                canvasEvolucao,
                {
                    type: 'line',
                    data: {
                        labels:
                            escalasFiltradas.map(
                                escala =>
                                    formatarData(
                                        escala.data
                                    )
                            ),
                        datasets: [{
                            label:
                                'Itens da escala',
                            data: valores,
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

function exportarPDF() {
    mostrarToast(
        'Para gerar PDF, adicione jsPDF ao index.html.',
        'warning'
    );
}

/* =========================================================
   ADMINISTRAÇÃO E AUDITORIA
========================================================= */

async function abrirPainelAdmin() {
    if (usuarioLogado?.role !== 'admin') {
        mostrarToast(
            'Acesso restrito ao administrador.',
            'error'
        );

        return;
    }

    document
        .getElementById(
            'modalAdmin'
        )
        .hidden = false;

    const lista =
        document.getElementById(
            'listaUsuariosCadastrados'
        );

    lista.replaceChildren();

    const perfil =
        document.createElement(
            'div'
        );

    perfil.className =
        'admin-item';

    perfil.textContent =
        `${usuarioLogado.nome} · ${
            usuarioLogado.email
        } · Perfil: ${
            usuarioLogado.role
        }`;

    lista.appendChild(
        perfil
    );

    await carregarAuditoria();
}

function fecharPainelAdmin() {
    document
        .getElementById(
            'modalAdmin'
        )
        .hidden = true;
}

async function carregarAuditoria() {
    const tabela =
        document.getElementById(
            'tabelaAuditoriaBody'
        );

    tabela.replaceChildren();

    const resultado =
        await supabaseClient
            .from('audit_logs')
            .select('*')
            .order(
                'created_at',
                {
                    ascending: false
                }
            )
            .limit(100);

    if (resultado.error) {
        const linha =
            document.createElement(
                'tr'
            );

        const celula =
            document.createElement(
                'td'
            );

        celula.colSpan = 4;
        celula.textContent =
            obterMensagemErro(
                resultado.error
            );

        linha.appendChild(
            celula
        );

        tabela.appendChild(
            linha
        );

        return;
    }

    (resultado.data || []).forEach(
        registro => {
            const linha =
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
                    const celula =
                        document.createElement(
                            'td'
                        );

                    celula.textContent =
                        valor;

                    linha.appendChild(
                        celula
                    );
                }
            );

            tabela.appendChild(
                linha
            );
        }
    );
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

    const resultado =
        await supabaseClient
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

    if (resultado.error) {
        console.error(
            'Erro de auditoria:',
            resultado.error
        );
    }
}

/* =========================================================
   FUNÇÕES AUXILIARES
========================================================= */

function configurarDatas() {
    const hoje =
        obterDataISO();

    definirValor(
        'dataEscala',
        hoje
    );

    definirValor(
        'relatorioDataFim',
        hoje
    );

    const primeiroDia =
        new Date(
            new Date().getFullYear(),
            new Date().getMonth(),
            1
        );

    definirValor(
        'relatorioDataInicio',
        obterDataISO(
            primeiroDia
        )
    );
}

function atualizarInformacoes() {
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

    aplicarPermissoes();
}

function obterNumero(id) {
    return Number(
        document
            .getElementById(id)
            ?.value || 0
    );
}

function definirTexto(id, valor) {
    const elemento =
        document.getElementById(id);

    if (elemento) {
        elemento.textContent =
            String(valor);
    }
}

function definirValor(id, valor) {
    const elemento =
        document.getElementById(id);

    if (elemento) {
        elemento.value =
            valor;
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

function formatarData(valor) {
    if (!valor) {
        return '-';
    }

    const partes =
        String(valor).split('-');

    if (partes.length !== 3) {
        return valor;
    }

    return partes.reverse().join('/');
}

function formatarDataHora(valor) {
    if (!valor) {
        return '-';
    }

    return new Date(valor)
        .toLocaleString('pt-BR');
}

function converterData(valor) {
    const partes =
        String(valor)
            .split('-')
            .map(Number);

    return new Date(
        partes[0],
        partes[1] - 1,
        partes[2]
    );
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
        window.alert(mensagem);
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

    window.setTimeout(
        () => toast.remove(),
        5000
    );
}
