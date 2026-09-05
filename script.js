'use strict';

/*
============================================================
CONFIGURAÇÃO SUPABASE
============================================================
*/

const SUPABASE_URL =
    'https://bnpfdkwjdtnpfmnjoft.supabase.co';

/*
Não publique a chave service_role.

Cole aqui somente a chave pública Publishable/anon
copiada em:

Supabase
→ Project Settings
→ API
*/
const SUPABASE_ANON_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJucGZka3dqZHRucGZtbmpvZnRmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1NzMxNzcsImV4cCI6MjEwNDE0OTE3N30.5ksgMBijxazAtCtse-Lb5MqmaxcL22dVqKBMrnjSYMA';

let supabaseClient = null;

let usuarioLogado = null;
let motoristas = [];
let escalas = {};
let indisponibilidades = {};
let historicoExecucoes = [];

let previaSalva = false;
let escalaAtual = null;

const TIPOS_VEICULO_VALIDOS = [
    'Utilitário',
    'Van',
    'Carro de Passeio'
];

/*
============================================================
INICIALIZAÇÃO
============================================================
*/

window.addEventListener(
    'DOMContentLoaded',
    iniciarSistema
);

async function iniciarSistema() {
    try {
        esconderLoader();

        if (
            !SUPABASE_URL ||
            !SUPABASE_ANON_KEY ||
            SUPABASE_ANON_KEY.includes(
                'COLE_AQUI'
            )
        ) {
            mostrarTelaLogin(
                'Configure a URL e a chave pública do Supabase no arquivo script.js.'
            );

            return;
        }

        if (!window.supabase) {
            mostrarTelaLogin(
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

        const {
            data,
            error
        } = await supabaseClient.auth.getSession();

        if (error) {
            throw error;
        }

        if (!data.session) {
            mostrarTelaLogin();
            return;
        }

        await carregarUsuarioAtual(
            data.session.user
        );

        if (
            !usuarioLogado ||
            usuarioLogado.ativo !== true
        ) {
            await supabaseClient.auth.signOut();

            mostrarTelaLogin(
                'Usuário inativo ou sem perfil autorizado.'
            );

            return;
        }

        removerTelaLogin();
        mostrarSistema();
        configurarSistema();

        await carregarDadosSupabase();

        atualizarInterface();
    } catch (erro) {
        console.error(
            'Erro ao iniciar o sistema:',
            erro
        );

        mostrarTelaLogin(
            obterMensagemErro(erro)
        );
    }
}

async function carregarUsuarioAtual(user) {
    const {
        data,
        error
    } = await supabaseClient
        .from('profiles')
        .select(
            'id, nome, role, ativo'
        )
        .eq('id', user.id)
        .maybeSingle();

    if (error) {
        throw error;
    }

    if (!data) {
        usuarioLogado = null;
        return;
    }

    usuarioLogado = {
        id: user.id,
        email: user.email,
        nome: data.nome,
        role: data.role,
        ativo: data.ativo
    };
}

async function carregarDadosSupabase() {
    await Promise.all([
        carregarMotoristas(),
        carregarEscalas(),
        carregarIndisponibilidades()
    ]);

    renderizarMotoristas();
    renderizarPrioridades();
    renderizarIndisponibilidades();
    carregarEscalaData();
}

/*
============================================================
LOGIN
============================================================
*/

function mostrarTelaLogin(mensagem = '') {
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
                    <span>🚛</span>
                    <strong>BETAXLOG</strong>
                </div>

                <p class="login-subtitle">
                    Acesso seguro pelo Supabase Authentication.
                </p>

                <div
                    id="loginMensagem"
                    class="login-mensagem"
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
                    placeholder="Digite sua senha"
                    required>

                <button
                    id="btnLogin"
                    class="btn btn-primary btn-block"
                    type="submit">
                    Entrar
                </button>
            </form>
        `;

        document.body.appendChild(
            overlay
        );

        document
            .getElementById('formLogin')
            .addEventListener(
                'submit',
                executarLogin
            );
    }

    const campoMensagem =
        document.getElementById(
            'loginMensagem'
        );

    if (campoMensagem) {
        campoMensagem.textContent =
            mensagem;

        campoMensagem.hidden =
            !mensagem;
    }

    overlay.style.display =
        'flex';
}

async function executarLogin(event) {
    event.preventDefault();

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

    const {
        error
    } = await supabaseClient.auth
        .signInWithPassword({
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
    const campo =
        document.getElementById(
            'loginMensagem'
        );

    if (!campo) return;

    campo.textContent =
        mensagem;

    campo.hidden = false;
}

function traduzirErroLogin(erro) {
    const mensagem =
        String(
            erro?.message || ''
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
        return 'Confirme o e-mail do usuário no Supabase.';
    }

    if (
        mensagem.includes(
            'failed to fetch'
        )
    ) {
        return 'Não foi possível conectar ao Supabase. Verifique a URL e a chave pública.';
    }

    return erro?.message ||
        'Não foi possível realizar o login.';
}

async function fazerLogout() {
    if (!confirm('Deseja sair do sistema?')) {
        return;
    }

    await supabaseClient.auth.signOut();
    window.location.reload();
}

function removerTelaLogin() {
    document
        .getElementById(
            'modalLoginOverlay'
        )
        ?.remove();
}

function mostrarSistema() {
    const sistema =
        document.getElementById(
            'sistema'
        );

    if (sistema) {
        sistema.hidden = false;
    }

    const usuario =
        document.getElementById(
            'usuarioAtual'
        );

    if (usuario && usuarioLogado) {
        usuario.textContent =
            `${usuarioLogado.nome} · ` +
            `${usuarioLogado.role}`;
    }

    const botaoAdmin =
        document.getElementById(
            'btnPainelAdmin'
        );

    if (botaoAdmin) {
        botaoAdmin.hidden =
            usuarioLogado?.role !== 'admin';
    }
}

/*
============================================================
CONFIGURAÇÃO DA INTERFACE
============================================================
*/

function configurarSistema() {
    const data =
        document.getElementById(
            'dataEscala'
        );

    if (data) {
        data.value =
            obterDataISO();

        data.addEventListener(
            'change',
            async () => {
                await carregarIndisponibilidades();
                renderizarIndisponibilidades();
                carregarEscalaData();
            }
        );
    }

    document
        .getElementById('btnSair')
        ?.addEventListener(
            'click',
            fazerLogout
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
        .getElementById('btnBaixarImagem')
        ?.addEventListener(
            'click',
            gerarImagemEscalaECompartilhar
        );

    document
        .getElementById('btnDefinitiva')
        ?.addEventListener(
            'click',
            confirmarDefinitiva
        );

    document
        .getElementById('btnExcel')
        ?.addEventListener(
            'click',
            exportarExcel
        );

    document
        .getElementById('btnWhatsApp')
        ?.addEventListener(
            'click',
            compartilharWhatsAppTexto
        );

    document
        .getElementById('btnCadastrarMotorista')
        ?.addEventListener(
            'click',
            cadastrarMotorista
        );

    document
        .getElementById('btnImportarExcel')
        ?.addEventListener(
            'change',
            importarExcel
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
        .getElementById('btnPainelAdmin')
        ?.addEventListener(
            'click',
            abrirModalAdmin
        );
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
        ) ||
        document.getElementById(
            'listaMotoristas'
        );

    if (!lista) return;

    const filtro =
        document
            .getElementById(
                'filtroMotorista'
            )
            ?.value
            .toLowerCase() || '';

    const filtrados =
        motoristas.filter(motorista =>
            motorista.nome
                .toLowerCase()
                .includes(filtro)
        );

    lista.replaceChildren();

    const contador =
        document.getElementById(
            'contadorTotalMotoristas'
        );

    if (contador) {
        contador.textContent =
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
            `${motorista.nome} · ` +
            `${motorista.veiculo}`;

        const botoes =
            document.createElement('span');

        const editar =
            document.createElement('button');

        editar.className =
            'btn btn-secondary btn-icon';

        editar.type =
            'button';

        editar.textContent =
            '✏️';

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

        excluir.onclick =
            () =>
                excluirMotorista(
                    motorista.id
                );

        botoes.append(
            editar,
            excluir
        );

        item.append(
            texto,
            botoes
        );

        lista.appendChild(item);
    });
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

    await carregarMotoristas();

    renderizarMotoristas();
    renderizarPrioridades();

    mostrarToast(
        'Motorista cadastrado.',
        'success'
    );
}

/*
============================================================
INDISPONIBILIDADE
============================================================
*/

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
        document.getElementById(
            'listaMotoristasIndisponiveis'
        );

    const data =
        document
            .getElementById(
                'dataEscala'
            )
            ?.value;

    if (!lista || !data) return;

    const filtro =
        document
            .getElementById(
                'buscaIndisponibilidade'
            )
            ?.value
            .toLowerCase() || '';

    const selecionados =
        indisponibilidades[data] || [];

    lista.replaceChildren();

    motoristas
        .filter(motorista =>
            motorista.nome
                .toLowerCase()
                .includes(filtro)
        )
        .forEach(motorista => {
            const item =
                document.createElement('label');

            item.className =
                'checkbox-item';

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

            const nome =
                document.createElement('span');

            nome.textContent =
                `${motorista.nome} · ` +
                `${motorista.veiculo}`;

            item.append(
                checkbox,
                nome
            );

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
UTILITÁRIOS
============================================================
*/

function obterDataISO(data = new Date()) {
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

function esconderLoader() {
    document
        .getElementById(
            'appLoader'
        )
        ?.remove();
}

function obterMensagemErro(erro) {
    return erro?.message ||
        'Erro desconhecido.';
}

function atualizarInterface() {
    mostrarSistema();
    aplicarPermissoes();
    atualizarInfoBackup();
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

function mostrarToast(
    mensagem,
    tipo = ''
) {
    let container =
        document.getElementById(
            'toastContainer'
        );

    if (!container) {
        container =
            document.createElement('div');

        container.id =
            'toastContainer';

        document.body.appendChild(
            container
        );
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
