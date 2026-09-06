'use strict';

/* =========================================================
   CONFIGURAÇÃO
========================================================= */

const SUPABASE_URL =
    'https://bnpfdkwjdtnpfmnjoftf.supabase.co';

/*
Cole abaixo a chave pública completa do Supabase.

Não use service_role no navegador.
*/
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

let chartEvolucaoInstancia = null;
let chartVeiculosInstancia = null;

const TIPOS_VEICULO = [
    'Utilitário',
    'Van',
    'Carro de Passeio'
];

const MENSAGEM_CANCELAMENTO =
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
            throw new Error(
                'A biblioteca do Supabase não foi carregada.'
            );
        }

        if (
            !SUPABASE_URL ||
            !SUPABASE_ANON_KEY ||
            SUPABASE_ANON_KEY.includes(
                'COLE_AQUI'
            ) ||
            SUPABASE_ANON_KEY.includes('..')
        ) {
            esconderLoader();

            mostrarLogin(
                'Configure a chave pública completa do Supabase no script.js.'
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

        const sessao =
            await obterSessao();

        if (!sessao) {
            esconderLoader();
            mostrarLogin();
            return;
        }

        const perfil =
            await carregarPerfil(
                sessao.user.id
            );

        if (!perfil || perfil.ativo === false) {
            await supabaseClient.auth.signOut();

            esconderLoader();

            mostrarLogin(
                'Usuário inativo ou sem perfil autorizado.'
            );

            return;
        }

        usuarioLogado = {
            id: sessao.user.id,
            email: sessao.user.email,
            nome: perfil.nome || sessao.user.email,
            role: perfil.role || 'operador',
            ativo: perfil.ativo
        };

        removerLogin();
        mostrarSistema();
        configurarEventos();
        configurarDatas();

        await carregarDados();

        esconderLoader();
    } catch (erro) {
        console.error(erro);

        esconderLoader();

        mostrarLogin(
            obterMensagemErro(erro)
        );
    }
}

async function obterSessao() {
    const {
        data,
        error
    } = await supabaseClient.auth.getSession();

    if (error) throw error;

    return data.session;
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

    if (error) throw error;

    return data;
}

async function carregarDados() {
    await Promise.all([
        carregarMotoristas(),
        carregarEscalas(),
        carregarIndisponibilidades()
    ]);

    atualizarInterface();
}

function mostrarSistema() {
    const sistema =
        document.getElementById('sistema');

    if (sistema) {
        sistema.hidden = false;
    }

    const usuario =
        document.getElementById('usuarioAtual');

    if (usuario && usuarioLogado) {
        usuario.textContent =
            `${usuarioLogado.nome} · ${usuarioLogado.role}`;
    }

    const admin =
        document.getElementById('btnPainelAdmin');

    if (admin) {
        admin.hidden =
            usuarioLogado?.role !== 'admin';
    }
}

function esconderLoader() {
    document
        .getElementById('appLoader')
        ?.remove();
}

/* =========================================================
   LOGIN
========================================================= */

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
            <form class="login-card" id="formLogin">
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
                executarLogin
            );
    }

    const mensagemElemento =
        document.getElementById(
            'loginMensagem'
        );

    if (mensagemElemento) {
        mensagemElemento.textContent = mensagem;
        mensagemElemento.hidden = !mensagem;
    }
}

function removerLogin() {
    document
        .getElementById('modalLoginOverlay')
        ?.remove();
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
        document.querySelector(
            '#formLogin button'
        );

    botao.disabled = true;
    botao.textContent = 'Entrando...';

    const {
        error
    } = await supabaseClient.auth.signInWithPassword({
        email,
        password: senha
    });

    if (error) {
        botao.disabled = false;
        botao.textContent = 'Entrar';

        mostrarLogin(
            traduzirErroLogin(error)
        );

        return;
    }

    window.location.reload();
}

async function fazerLogout() {
    if (!confirm('Deseja sair do sistema?')) {
        return;
    }

    await supabaseClient.auth.signOut();
    window.location.reload();
}

function traduzirErroLogin(erro) {
    const mensagem =
        String(erro?.message || '')
            .toLowerCase();

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

    return erro.message ||
        'Não foi possível realizar o login.';
}

/* =========================================================
   EVENTOS E ABAS
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
            () => alternarAba('operacional')
        );

    document
        .getElementById('btnAbaMotoristas')
        ?.addEventListener(
            'click',
            () => alternarAba('motoristas')
        );

    document
        .getElementById('btnAbaRelatorios')
        ?.addEventListener(
            'click',
            () => alternarAba('relatorios')
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
        .getElementById('buscaIndisponibilidade')
        ?.addEventListener(
            'input',
            renderizarIndisponibilidades
        );

    document
        .getElementById('filtroMotorista')
        ?.addEventListener(
            'input',
            renderizarMotoristas
        );

    document
        .getElementById('btnGerarPrevia')
        ?.addEventListener(
            'click',
            gerarPrevia
        );

    document
        .getElementById('btnExcluirEscala')
        ?.addEventListener(
            'click',
            excluirEscalaAtual
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
        .getElementById('btnBaixarImagem')
        ?.addEventListener(
            'click',
            baixarImagem
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
            exportarExcelEscala
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
            exportarMotoristas
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
            excluirSelecionados
        );

    document
        .getElementById('btnSalvarEdicao')
        ?.addEventListener(
            'click',
            salvarEdicaoMotorista
        );

    document
        .getElementById('btnCancelarEdicao')
        ?.addEventListener(
            'click',
            fecharModalEdicao
        );

    document
        .getElementById('btnTodosRodizio')
        ?.addEventListener(
            'click',
            () => selecionarTodos('listaRodizio')
        );

    document
        .getElementById('btnTodosPrioritarios')
        ?.addEventListener(
            'click',
            () => selecionarTodos('listaPrioritarios')
        );

    document
        .getElementById('btnMoverPrioridade')
        ?.addEventListener(
            'click',
            () => alterarPrioridade(true)
        );

    document
        .getElementById('btnMoverRodizio')
        ?.addEventListener(
            'click',
            () => alterarPrioridade(false)
        );

    document
        .getElementById('filtroAtalhoPeriodo')
        ?.addEventListener(
            'change',
            aplicarAtalhoPeriodo
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
        .getElementById('btnFecharAdmin')
        ?.addEventListener(
            'click',
            fecharModalAdmin
        );

    document
        .getElementById('btnApagarDados')
        ?.addEventListener(
            'click',
            apagarTodoOSistema
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
        .order('nome');

    if (error) throw error;

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
            .getElementById('filtroMotorista')
            ?.value
            .toLowerCase() || '';

    const filtrados =
        motoristas.filter(item =>
            item.nome
                .toLowerCase()
                .includes(filtro)
        );

    lista.replaceChildren();

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
        atualizarContadorSelecionados();

        return;
    }

    filtrados.forEach(motorista => {
        const linha =
            document.createElement('div');

        linha.className =
            'checkbox-item';

        const esquerda =
            document.createElement('label');

        const checkbox =
            document.createElement('input');

        checkbox.type = 'checkbox';
        checkbox.checked =
            motoristasSelecionados.has(
                motorista.id
            );

        checkbox.addEventListener(
            'change',
            event => {
                if (event.target.checked) {
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

        const texto =
            document.createElement('span');

        texto.textContent =
            `${motorista.nome} · ${motorista.veiculo}`;

        esquerda.append(checkbox, texto);

        const acoes =
            document.createElement('span');

        const editar =
            document.createElement('button');

        editar.className =
            'btn btn-secondary btn-icon';

        editar.type = 'button';
        editar.textContent = '✏️';

        editar.addEventListener(
            'click',
            () => abrirEdicaoMotorista(motorista.id)
        );

        const arquivar =
            document.createElement('button');

        arquivar.className =
            'btn btn-danger btn-icon';

        arquivar.type = 'button';
        arquivar.textContent = '🗑️';

        arquivar.addEventListener(
            'click',
            () => excluirMotorista(motorista.id)
        );

        acoes.append(editar, arquivar);
        linha.append(esquerda, acoes);
        lista.appendChild(linha);
    });

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

    if (contador) {
        contador.textContent =
            `${motoristasSelecionados.size} selecionados`;
    }

    if (botao) {
        botao.disabled =
            motoristasSelecionados.size === 0;
    }
}

function selecionarTodosMotoristas(event) {
    const marcar =
        event.target.checked;

    motoristas.forEach(motorista => {
        if (marcar) {
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
        mostrarToast(error.message, 'error');
        return;
    }

    document
        .getElementById('nomeMotorista')
        .value = '';

    document
        .getElementById('telMotorista')
        .value = '';

    await carregarMotoristas();
    atualizarInterface();

    mostrarToast(
        'Motorista cadastrado.',
        'success'
    );
}

async function excluirMotorista(id) {
    const motorista =
        motoristas.find(item => item.id === id);

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
        mostrarToast(error.message, 'error');
        return;
    }

    motoristasSelecionados.delete(id);

    await carregarMotoristas();
    atualizarInterface();

    mostrarToast(
        'Motorista arquivado.',
        'success'
    );
}

async function excluirSelecionados() {
    const ids =
        Array.from(motoristasSelecionados);

    if (!ids.length) return;

    if (!confirm(
        `Arquivar ${ids.length} motorista(s) selecionado(s)?`
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
        .in('id', ids);

    if (error) {
        mostrarToast(error.message, 'error');
        return;
    }

    motoristasSelecionados.clear();

    await carregarMotoristas();
    atualizarInterface();

    document
        .getElementById('checkTodosMotoristas')
        .checked = false;

    mostrarToast(
        `${ids.length} motorista(s) arquivado(s).`,
        'success'
    );
}

/* =========================================================
   IMPORTAÇÃO EXCEL
========================================================= */

async function importarExcel(event) {
    const arquivo =
        event.target.files?.[0];

    if (!arquivo) return;

    try {
        if (!window.XLSX) {
            throw new Error(
                'A biblioteca Excel não foi carregada.'
            );
        }

        const buffer =
            await arquivo.arrayBuffer();

        const workbook =
            XLSX.read(buffer, {
                type: 'array'
            });

        const folha =
            workbook.Sheets[
                workbook.SheetNames[0]
            ];

        const linhas =
            XLSX.utils.sheet_to_json(
                folha,
                {
                    defval: ''
                }
            );

        if (!linhas.length) {
            throw new Error(
                'A planilha está vazia.'
            );
        }

        const registros = [];
        const erros = [];

        linhas.forEach((linha, indice) => {
            const nome =
                obterCampo(
                    linha,
                    [
                        'Nome',
                        'nome',
                        'Motorista',
                        'motorista'
                    ]
                ).trim();

            const telefone =
                obterCampo(
                    linha,
                    [
                        'Telefone',
                        'telefone',
                        'Celular',
                        'celular'
                    ]
                ).trim();

            const veiculoOriginal =
                obterCampo(
                    linha,
                    [
                        'Veiculo',
                        'veiculo',
                        'Veículo',
                        'Tipo',
                        'tipo'
                    ]
                ).trim();

            const veiculo =
                normalizarVeiculo(
                    veiculoOriginal
                );

            if (!nome) {
                erros.push(
                    `Linha ${indice + 2}: nome ausente.`
                );

                return;
            }

            if (!veiculo) {
                erros.push(
                    `Linha ${indice + 2}: veículo inválido.`
                );

                return;
            }

            registros.push({
                nome,
                telefone,
                veiculo,
                prioridade: false,
                ativo: true
            });
        });

        if (!registros.length) {
            throw new Error(
                erros.join(' ')
            );
        }

        const {
            error
        } = await supabaseClient
            .from('motoristas')
            .insert(registros);

        if (error) throw error;

        await carregarMotoristas();
        atualizarInterface();

        let mensagem =
            `${registros.length} motorista(s) importado(s).`;

        if (erros.length) {
            mensagem +=
                ` ${erros.length} linha(s) ignorada(s).`;
        }

        mostrarToast(
            mensagem,
            erros.length ? '' : 'success'
        );
    } catch (erro) {
        mostrarToast(
            obterMensagemErro(erro),
            'error'
        );
    }

    event.target.value = '';
}

function obterCampo(objeto, nomes) {
    for (const nome of nomes) {
        if (
            objeto[nome] !== undefined &&
            objeto[nome] !== null
        ) {
            return String(objeto[nome]);
        }
    }

    return '';
}

function normalizarVeiculo(valor) {
    const texto =
        String(valor)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .trim();

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

    return null;
}

function exportarMotoristas() {
    const dados =
        motoristas.map(item => ({
            Nome: item.nome,
            Telefone: item.telefone || '',
            Veiculo: item.veiculo,
            Prioridade:
                item.prioridade ? 'SIM' : 'NAO'
        }));

    const folha =
        XLSX.utils.json_to_sheet(dados);

    const arquivo =
        XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
        arquivo,
        folha,
        'Motoristas'
    );

    XLSX.writeFile(
        arquivo,
        `motoristas_${obterDataISO()}.xlsx`
    );
}

/* =========================================================
   EDIÇÃO E PRIORIDADE
========================================================= */

function abrirEdicaoMotorista(id) {
    const motorista =
        motoristas.find(item => item.id === id);

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
        mostrarToast(error.message, 'error');
        return;
    }

    fecharModalEdicao();
    await carregarMotoristas();
    atualizarInterface();

    mostrarToast(
        'Motorista atualizado.',
        'success'
    );
}

function renderizarPrioridades() {
    const rodizio =
        document.getElementById('listaRodizio');

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

    Array.from(select.options).forEach(
        option => {
            option.selected = true;
        }
    );
}

async function alterarPrioridade(prioridade) {
    const id =
        prioridade
            ? 'listaRodizio'
            : 'listaPrioritarios';

    const select =
        document.getElementById(id);

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
        .in('id', ids);

    if (error) {
        mostrarToast(error.message, 'error');
        return;
    }

    await carregarMotoristas();
    atualizarInterface();
}

/* =========================================================
   INDISPONIBILIDADE
========================================================= */

async function carregarIndisponibilidades() {
    const {
        data,
        error
    } = await supabaseClient
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

function renderizarIndisponibilidades() {
    const lista =
        document.getElementById(
            'listaMotoristasIndisponiveis'
        );

    const data =
        document.getElementById('dataEscala')
            ?.value;

    if (!lista || !data) return;

    const filtro =
        document
            .getElementById(
                'buscaIndisponibilidade'
            )
            ?.value
            .toLowerCase() || '';

    const marcados =
        indisponibilidades[data] || [];

    lista.replaceChildren();

    motoristas
        .filter(item =>
            item.nome
                .toLowerCase()
                .includes(filtro)
        )
        .forEach(motorista => {
            const linha =
                document.createElement('label');

            linha.className =
                'checkbox-item';

            const checkbox =
                document.createElement('input');

            checkbox.type = 'checkbox';
            checkbox.checked =
                marcados.includes(motorista.id);

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

            linha.append(checkbox, texto);
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
                    motorista_id: motoristaId
                },
                {
                    onConflict:
                        'data,motorista_id'
                }
            );

        if (error) {
            mostrarToast(error.message, 'error');
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
            mostrarToast(error.message, 'error');
            return;
        }
    }

    await carregarIndisponibilidades();
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
        .select('*, escala_itens(*)')
        .order('data', {
            ascending: false
        });

    if (error) throw error;

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
            vagas: {
                utilitario:
                    escala.vagas_utilitario || 0,
                van:
                    escala.vagas_van || 0,
                passeio:
                    escala.vagas_passeio || 0
            },
            itens
        };

        if (escala.status === 'definitiva') {
            historicoExecucoes.push({
                data: escala.data,
                itens: structuredClone
                    ? structuredClone(itens)
                    : JSON.parse(
                        JSON.stringify(itens)
                    )
            });
        }
    });
}

function carregarEscalaData() {
    const data =
        document.getElementById('dataEscala')
            ?.value;

    const escala =
        escalas[data];

    const painel =
        document.getElementById('painelEscala');

    if (!painel) return;

    if (!escala) {
        previaAtual = null;
        painel.hidden = true;
        return;
    }

    previaAtual = null;

    document.getElementById(
        'vagasUtilitario'
    ).value = escala.vagas.utilitario;

    document.getElementById(
        'vagasVan'
    ).value = escala.vagas.van;

    document.getElementById(
        'vagasPasseio'
    ).value = escala.vagas.passeio;

    painel.hidden = false;

    renderizarTabelaEscala(
        escala.itens,
        escala.status,
        true
    );

    atualizarBotoesEscala(
        escala.status === 'definitiva' ||
        escala.status === 'prévia'
    );
}

async function gerarPrevia() {
    const data =
        document.getElementById('dataEscala')
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
            !indisponiveis.includes(item.id)
        );

    const itens = [];
    const usados = new Set();

    const grupos = [
        ['Utilitário', vagas.utilitario],
        ['Van', vagas.van],
        ['Carro de Passeio', vagas.passeio]
    ];

    grupos.forEach(([veiculo, quantidade]) => {
        for (
            let i = 0;
            i < quantidade;
            i++
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
                usados.add(motorista.id);

                itens.push({
                    ordem: itens.length,
                    dsp: 'BETAXLOG',
                    nome: motorista.nome,
                    telefone:
                        motorista.telefone || '',
                    motoristaId: motorista.id,
                    veiculo,
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
                    veiculo,
                    onda: '',
                    status: 'vago'
                });
            }
        }
    });

    previaAtual = {
        data,
        vagas,
        status: 'prévia',
        itens
    };

    const painel =
        document.getElementById('painelEscala');

    painel.hidden = false;

    renderizarTabelaEscala(
        itens,
        'prévia',
        false
    );

    atualizarBotoesEscala(false);

    mostrarToast(
        'Prévia gerada. Salve antes de confirmar ou baixar.',
        'success'
    );
}

function renderizarTabelaEscala(
    itens,
    status,
    salvo
) {
    const tbody =
        document.getElementById(
            'tabelaEscalaBody'
        );

    tbody.replaceChildren();

    const tag =
        document.getElementById('tagStatus');

    tag.textContent =
        salvo
            ? status === 'definitiva'
                ? 'DEFINITIVA'
                : 'PRÉVIA SALVA'
            : 'PRÉVIA NÃO SALVA';

    tag.className =
        `badge-status ${
            salvo && status === 'definitiva'
                ? 'badge-definitiva'
                : 'badge-previa'
        }`;

    const data =
        document.getElementById('dataEscala')
            .value;

    document.getElementById(
        'dataSubtituloImagem'
    ).textContent =
        `Data: ${data.split('-').reverse().join('/')}`;

    itens.forEach((item, index) => {
        const tr =
            document.createElement('tr');

        if (
            item.status === 'cancelado_amazon'
        ) {
            tr.className = 'row-cancelada';
        }

        const valores = [
            item.dsp,
            item.nome,
            item.veiculo
        ];

        valores.forEach(valor => {
            const td =
                document.createElement('td');

            td.textContent = valor;
            tr.appendChild(td);
        });

        const tdOnda =
            document.createElement('td');

        const onda =
            document.createElement('input');

        onda.className = 'input-onda';
        onda.value = item.onda || '';
        onda.placeholder = 'HH:MM';

        onda.disabled = salvo &&
            status === 'definitiva';

        onda.addEventListener(
            'change',
            event => {
                item.onda =
                    event.target.value.trim();
            }
        );

        tdOnda.appendChild(onda);

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

        botao.disabled =
            !item.motoristaId ||
            (salvo && status === 'definitiva');

        botao.addEventListener(
            'click',
            () => {
                item.status =
                    item.status === 'cancelado_amazon'
                        ? 'ativo'
                        : 'cancelado_amazon';

                renderizarTabelaEscala(
                    itens,
                    status,
                    salvo
                );
            }
        );

        tdAcoes.appendChild(botao);

        tr.append(
            tdOnda,
            tdAcoes
        );

        tbody.appendChild(tr);
    });
}

function atualizarBotoesEscala(salvo) {
    document.getElementById(
        'avisoPrevia'
    ).hidden = salvo;

    document.getElementById(
        'btnConfirmarDefinitiva'
    ).disabled = !salvo;

    document.getElementById(
        'btnBaixarImagem'
    ).disabled = !salvo;

    document.getElementById(
        'btnSalvarPrevia'
    ).disabled = salvo;
}

async function salvarPrevia() {
    if (!previaAtual) {
        mostrarToast(
            'Gere uma prévia primeiro.',
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
                    previaAtual.vagas.utilitario,
                vagas_van:
                    previaAtual.vagas.van,
                vagas_passeio:
                    previaAtual.vagas.passeio,
                updated_at:
                    new Date().toISOString()
            })
            .eq('id', escalaId);

        if (error) {
            mostrarToast(error.message, 'error');
            return;
        }

        await supabaseClient
            .from('escala_itens')
            .delete()
            .eq('escala_id', escalaId);
    } else {
        const {
            data,
            error
        } = await supabaseClient
            .from('escalas')
            .insert({
                data: previaAtual.data,
                status: 'prévia',
                vagas_utilitario:
                    previaAtual.vagas.utilitario,
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
            mostrarToast(error.message, 'error');
            return;
        }

        escalaId = data.id;
    }

    const {
        error: erroItens
    } = await supabaseClient
        .from('escala_itens')
        .insert(
            previaAtual.itens.map((item, index) => ({
                escala_id: escalaId,
                ordem: index,
                dsp: item.dsp,
                nome_snapshot: item.nome,
                telefone_snapshot:
                    item.telefone || '',
                motorista_id:
                    item.motoristaId,
                veiculo: item.veiculo,
                onda: item.onda || '',
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

    previaAtual = null;

    carregarEscalaData();

    mostrarToast(
        'Prévia salva com sucesso.',
        'success'
    );
}

async function confirmarDefinitiva() {
    const data =
        document.getElementById('dataEscala')
            .value;

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
        mostrarToast(error.message, 'error');
        return;
    }

    await carregarEscalas();
    carregarEscalaData();

    mostrarToast(
        'Escala definitiva confirmada.',
        'success'
    );
}

async function excluirEscalaAtual() {
    const data =
        document.getElementById('dataEscala')
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
        mostrarToast(error.message, 'error');
        return;
    }

    delete escalas[data];

    carregarEscalaData();

    mostrarToast(
        'Escala excluída.',
        'success'
    );
}

/* =========================================================
   EXPORTAÇÕES DA ESCALA
========================================================= */

function baixarImagem() {
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
            `escala_${data}.png`;

        link.href =
            canvas.toDataURL('image/png');

        link.click();
    });
}

function compartilharWhatsApp() {
    const data =
        document.getElementById(
            'dataEscala'
        ).value;

    const escala =
        escalas[data];

    if (!escala) return;

    let texto =
        `🚛 ESCALA BETAXLOG\n` +
        `📅 ${data.split('-').reverse().join('/')}\n\n`;

    escala.itens
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
                'Escala copiada para a área de transferência.',
                'success'
            );
        });
}

function exportarExcelEscala() {
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
        `escala_${data}.xlsx`
    );
}

/* =========================================================
   RELATÓRIOS
========================================================= */

function gerarRelatorioHistorico() {
    const inicio =
        document.getElementById(
            'relatorioDataInicio'
        ).value;

    const fim =
        document.getElementById(
            'relatorioDataFim'
        ).value;

    const registros =
        historicoExecucoes.filter(item =>
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

            const cancelado =
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

    document.getElementById(
        'kpiTotalRotas'
    ).textContent = total;

    document.getElementById(
        'kpiRotasAtivas'
    ).textContent = ativas;

    document.getElementById(
        'kpiRotasCanceladas'
    ).textContent = canceladas;

    document.getElementById(
        'kpiTaxaSucesso'
    ).textContent =
        `${total ? (ativas / total * 100).toFixed(1) : 0}%`;

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

                td.textContent = valor;
                tr.appendChild(td);
            });

            tbody.appendChild(tr);
        });

    atualizarGraficos(registros);
}

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
    }

    if (tipo === 'semanal') {
        inicio.setDate(
            hoje.getDate() - 7
        );
    }

    if (tipo === 'semestral') {
        inicio.setMonth(
            hoje.getMonth() - 6
        );
    }

    if (tipo === 'anual') {
        inicio =
            new Date(
                hoje.getFullYear(),
                0,
                1
            );
    }

    if (!tipo) return;

    document.getElementById(
        'relatorioDataInicio'
    ).value = obterDataISO(inicio);

    document.getElementById(
        'relatorioDataFim'
    ).value = obterDataISO(hoje);
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

    if (window.Chart) {
        const canvas =
            document.getElementById(
                'chartEvolucao'
            );

        chartEvolucaoInstancia?.destroy();

        chartEvolucaoInstancia =
            new Chart(canvas, {
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
                }
            });

        const canvasVeiculos =
            document.getElementById(
                'chartVeiculos'
            );

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
                }
            });
    }
}

function exportarRelatorioPDF() {
    if (!window.jspdf) return;

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
        `relatorio_${obterDataISO()}.pdf`
    );
}

/* =========================================================
   ADMINISTRAÇÃO
========================================================= */

async function abrirModalAdmin() {
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

    await carregarUsuarios();
}

function fecharModalAdmin() {
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
        lista.textContent = error.message;
        return;
    }

    lista.replaceChildren();

    data.forEach(usuario => {
        const item =
            document.createElement('div');

        item.className =
            'usuario-item';

        const nome =
            document.createElement('strong');

        nome.textContent =
            usuario.nome || usuario.id;

        const acoes =
            document.createElement('div');

        acoes.className =
            'usuario-acoes';

        const status =
            document.createElement('select');

        status.innerHTML = `
            <option value="true">🟢 ATIVO</option>
            <option value="false">🔴 INATIVO</option>
        `;

        status.value =
            String(usuario.ativo);

        const role =
            document.createElement('select');

        role.innerHTML = `
            <option value="operador">Operador</option>
            <option value="admin">Administrador</option>
        `;

        role.value =
            usuario.role || 'operador';

        const salvar =
            document.createElement('button');

        salvar.className =
            'btn btn-primary';

        salvar.textContent =
            'Salvar';

        salvar.addEventListener(
            'click',
            () =>
                atualizarUsuario(
                    usuario.id,
                    status.value === 'true',
                    role.value
                )
        );

        const excluir =
            document.createElement('button');

        excluir.className =
            'btn btn-danger';

        excluir.textContent =
            'Excluir';

        excluir.disabled =
            usuario.id === usuarioLogado.id;

        excluir.addEventListener(
            'click',
            () =>
                excluirPerfil(
                    usuario.id,
                    usuario.nome
                )
        );

        acoes.append(
            status,
            role,
            salvar,
            excluir
        );

        item.append(nome, acoes);
        lista.appendChild(item);
    });
}

async function atualizarUsuario(
    id,
    ativo,
    role
) {
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
        mostrarToast(error.message, 'error');
        return;
    }

    await carregarUsuarios();

    mostrarToast(
        'Usuário atualizado.',
        'success'
    );
}

async function excluirPerfil(id, nome) {
    if (id === usuarioLogado.id) {
        mostrarToast(
            'Você não pode excluir seu próprio perfil.',
            'error'
        );

        return;
    }

    if (!confirm(
        `Excluir o perfil de ${nome || id}?`
    )) {
        return;
    }

    const {
        error
    } = await supabaseClient
        .from('profiles')
        .delete()
        .eq('id', id);

    if (error) {
        mostrarToast(error.message, 'error');
        return;
    }

    await carregarUsuarios();

    mostrarToast(
        'Perfil excluído.',
        'success'
    );
}

async function apagarTodoOSistema() {
    if (usuarioLogado?.role !== 'admin') {
        return;
    }

    if (!confirm(
        'Arquivar todos os motoristas e excluir as escalas?'
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

    atualizarInterface();

    document
        .getElementById('modalAdmin')
        .hidden = true;

    mostrarToast(
        'Dados operacionais apagados.',
        'success'
    );
}

/* =========================================================
   INTERFACE E UTILITÁRIOS
========================================================= */

function configurarDatas() {
    const hoje =
        obterDataISO();

    document
        .getElementById('dataEscala')
        .value = hoje;

    document
        .getElementById('relatorioDataFim')
        .value = hoje;

    const primeiroDia =
        new Date();

    primeiroDia.setDate(1);

    document
        .getElementById('relatorioDataInicio')
        .value =
        obterDataISO(primeiroDia);
}

function atualizarInterface() {
    mostrarSistema();
    renderizarMotoristas();
    renderizarPrioridades();
    renderizarIndisponibilidades();
    carregarEscalaData();

    atualizarInfoBackup();
}

function atualizarInfoBackup() {
    document
        .getElementById('infoUltimoBackup')
        .textContent =
        `☁️ Supabase sincronizado em ` +
        `${new Date().toLocaleString('pt-BR')}`;
}

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

function obterMensagemErro(erro) {
    return erro?.message ||
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
        4500
    );
}
‹
