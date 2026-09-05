'use strict';

/*
============================================================
CONFIGURAÇÃO SUPABASE
============================================================
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

let motoristasSelecionados = new Set();

const MENSAGEM_CANCELAMENTO_AMAZON =
    'Olá! Sua rota de hoje foi cancelada pela Amazon. Em caso de falta de outro motorista ou necessidade de rota extra, entraremos em contato para acioná-lo(a). Obrigado pela compreensão!';

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
        if (!configuracaoSupabaseValida()) {
            mostrarTelaLogin(
                'Configure a URL e a chave pública do Supabase no arquivo script.js.'
            );

            esconderLoader();
            return;
        }

        if (!window.supabase) {
            mostrarTelaLogin(
                'A biblioteca do Supabase não foi carregada. Verifique o index.html.'
            );

            esconderLoader();
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
            mostrarTelaLogin();
            esconderLoader();
            return;
        }

        const perfil =
            await carregarPerfil(sessao.user.id);

        if (!perfil || perfil.ativo !== true) {
            await supabaseClient.auth.signOut();

            mostrarTelaLogin(
                'Este usuário está inativo ou não possui um perfil autorizado.'
            );

            esconderLoader();
            return;
        }

        usuarioLogado = {
            id: sessao.user.id,
            email: sessao.user.email,
            nome: perfil.nome,
            role: perfil.role,
            ativo: perfil.ativo
        };

        removerTelaLogin();
        mostrarSistema();

        configurarEventos();
        configurarDatas();

        await carregarMotoristas();
        await carregarEscalas();
        await carregarIndisponibilidades();

        renderizarMotoristas();
        renderizarPrioridades();
        renderizarIndisponibilidades();
        carregarEscalaData();

        aplicarPermissoes();
        atualizarInfoBackup();

        esconderLoader();
    } catch (error) {
        console.error(error);

        mostrarTelaLogin(
            `Erro ao iniciar o sistema: ${obterMensagemErro(error)}`
        );

        esconderLoader();
    }
}

function configuracaoSupabaseValida() {
    return Boolean(
        SUPABASE_URL &&
        SUPABASE_ANON_KEY &&
        SUPABASE_URL.startsWith('https://') &&
        SUPABASE_URL.endsWith('.supabase.co') &&
        !SUPABASE_ANON_KEY.includes('COLE_AQUI') &&
        !SUPABASE_ANON_KEY.includes('..')
    );
}

async function obterSessao() {
    const {
        data,
        error
    } = await supabaseClient.auth.getSession();

    if (error) {
        throw error;
    }

    return data.session;
}

async function carregarPerfil(userId) {
    const {
        data,
        error
    } = await supabaseClient
        .from('profiles')
        .select('id, nome, role, ativo')
        .eq('id', userId)
        .maybeSingle();

    if (error) {
        throw error;
    }

    return data;
}

/*
============================================================
LOGIN E LOGOUT
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
                    placeholder="seu@email.com"
                    autocomplete="username"
                    required>

                <label for="loginSenha">
                    Senha
                </label>

                <input
                    id="loginSenha"
                    type="password"
                    placeholder="Digite sua senha"
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
        mensagemElemento.textContent =
            mensagem;

        mensagemElemento.hidden =
            !mensagem;
    }

    overlay.style.display =
        'flex';
}

async function executarLogin(event) {
    event.preventDefault();

    const email =
        document.getElementById(
            'loginEmail'
        ).value.trim();

    const senha =
        document.getElementById(
            'loginSenha'
        ).value;

    const botao =
        document.querySelector(
            '#formLogin button[type="submit"]'
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
        mostrarMensagemLogin(
            'E-mail ou senha inválidos.'
        );

        botao.disabled = false;
        botao.textContent = 'Entrar';

        return;
    }

    window.location.reload();
}

function mostrarMensagemLogin(mensagem) {
    const elemento =
        document.getElementById(
            'loginMensagem'
        );

    if (!elemento) return;

    elemento.textContent =
        mensagem;

    elemento.hidden =
        false;
}

async function fazerLogout() {
    if (!confirm('Deseja sair do sistema?')) {
        return;
    }

    await supabaseClient.auth.signOut();

    window.location.reload();
}

function removerTelaLogin() {
    const elemento =
        document.getElementById(
            'modalLoginOverlay'
        );

    if (elemento) {
        elemento.remove();
    }
}

function mostrarSistema() {
    const sistema =
        document.getElementById('sistema');

    if (sistema) {
        sistema.hidden = false;
    }
}

/*
============================================================
PERMISSÕES
============================================================
*/

function aplicarPermissoes() {
    const botaoAdmin =
        document.getElementById(
            'btnPainelAdmin'
        );

    if (!botaoAdmin) return;

    botaoAdmin.hidden =
        usuarioLogado.role !== 'admin';
}

function usuarioEhAdmin() {
    return usuarioLogado?.role === 'admin';
}

/*
============================================================
EVENTOS
============================================================
*/

function configurarEventos() {
    document
        .getElementById('btnSair')
        ?.addEventListener(
            'click',
            fazerLogout
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
        .getElementById('btnWhatsApp')
        ?.addEventListener(
            'click',
            compartilharWhatsAppTexto
        );

    document
        .getElementById('btnExcel')
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
        .getElementById('btnImportarExcel')
        ?.addEventListener(
            'change',
            importarMotoristasExcel
        );

    document
        .getElementById('btnExcluirSelecionados')
        ?.addEventListener(
            'click',
            excluirMotoristasSelecionados
        );

    document
        .getElementById('checkTodosMotoristas')
        ?.addEventListener(
            'change',
            selecionarTodosMotoristas
        );

    document
        .getElementById('buscaMotorista')
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
        .getElementById('btnPainelAdmin')
        ?.addEventListener(
            'click',
            abrirModalAdmin
        );
}

function configurarDatas() {
    const hoje =
        obterDataISO();

    const dataEscala =
        document.getElementById(
            'dataEscala'
        );

    if (dataEscala && !dataEscala.value) {
        dataEscala.value =
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

    if (inicio && fim) {
        const agora =
            new Date();

        inicio.value =
            obterDataISO(
                new Date(
                    agora.getFullYear(),
                    agora.getMonth(),
                    1
                )
            );

        fim.value =
            hoje;
    }
}

function alternarAba(aba) {
    const views = [
        'viewOperacional',
        'viewMotoristas',
        'viewRelatorios'
    ];

    views.forEach(id => {
        const view =
            document.getElementById(id);

        if (view) {
            view.hidden =
                id !== `view${capitalizar(aba)}`;
        }
    });

    const botoes = [
        'btnAbaOperacional',
        'btnAbaMotoristas',
        'btnAbaRelatorios'
    ];

    botoes.forEach(id => {
        document
            .getElementById(id)
            ?.classList.remove('active');
    });

    document
        .getElementById(
            `btnAba${capitalizar(aba)}`
        )
        ?.classList.add('active');

    if (aba === 'motoristas') {
        renderizarMotoristas();
    }

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

    motoristasSelecionados =
        new Set(
            [...motoristasSelecionados]
                .filter(id =>
                    motoristas.some(
                        motorista =>
                            motorista.id === id
                    )
                )
        );
}

function renderizarMotoristas() {
    const lista =
        document.getElementById(
            'listaMotoristas'
        ) ||
        document.getElementById(
            'listaMotoristasCheck'
        );

    if (!lista) return;

    const filtro =
        document.getElementById(
            'buscaMotorista'
        )?.value.toLowerCase() ||
        document.getElementById(
            'filtroMotorista'
        )?.value.toLowerCase() ||
        '';

    lista.replaceChildren();

    const filtrados =
        motoristas.filter(motorista =>
            motorista.nome
                .toLowerCase()
                .includes(filtro)
        );

    atualizarContadorMotoristas();

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

        const ladoEsquerdo =
            document.createElement('label');

        ladoEsquerdo.className =
            'motorista-selecao';

        const checkbox =
            document.createElement('input');

        checkbox.type =
            'checkbox';

        checkbox.className =
            'check-motorista';

        checkbox.dataset.id =
            motorista.id;

        checkbox.checked =
            motoristasSelecionados.has(
                motorista.id
            );

        checkbox.addEventListener(
            'change',
            event => {
                atualizarSelecaoMotorista(
                    motorista.id,
                    event.target.checked
                );
            }
        );

        const texto =
            document.createElement('span');

        texto.textContent =
            `${motorista.nome} · ${motorista.veiculo}`;

        ladoEsquerdo.append(
            checkbox,
            texto
        );

        const acoes =
            document.createElement('span');

        const editar =
            document.createElement('button');

        editar.type =
            'button';

        editar.className =
            'btn btn-secondary btn-icon';

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

        excluir.type =
            'button';

        excluir.className =
            'btn btn-danger btn-icon';

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

        item.append(
            ladoEsquerdo,
            acoes
        );

        lista.appendChild(item);
    });

    atualizarCheckboxPrincipal();
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
    atualizarCheckboxPrincipal();
}

function selecionarTodosMotoristas(event) {
    const selecionado =
        event.target.checked;

    const filtro =
        document.getElementById(
            'buscaMotorista'
        )?.value.toLowerCase() || '';

    motoristas
        .filter(motorista =>
            motorista.nome
                .toLowerCase()
                .includes(filtro)
        )
        .forEach(motorista => {
            if (selecionado) {
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
    atualizarContadorSelecionados();
}

function atualizarCheckboxPrincipal() {
    const principal =
        document.getElementById(
            'checkTodosMotoristas'
        );

    if (!principal) return;

    const filtro =
        document.getElementById(
            'buscaMotorista'
        )?.value.toLowerCase() || '';

    const visiveis =
        motoristas.filter(motorista =>
            motorista.nome
                .toLowerCase()
                .includes(filtro)
        );

    const selecionados =
        visiveis.filter(motorista =>
            motoristasSelecionados.has(
                motorista.id
            )
        );

    principal.checked =
        visiveis.length > 0 &&
        selecionados.length === visiveis.length;

    principal.indeterminate =
        selecionados.length > 0 &&
        selecionados.length < visiveis.length;
}

function atualizarContadorSelecionados() {
    const quantidade =
        motoristasSelecionados.size;

    const elementos =
        document.querySelectorAll(
            '[data-contador-selecionados]'
        );

    elementos.forEach(elemento => {
        elemento.textContent =
            `${quantidade} motorista${
                quantidade === 1
                    ? ''
                    : 's'
            } selecionado${
                quantidade === 1
                    ? ''
                    : 's'
            }`;
    });

    const contador =
        document.getElementById(
            'contadorSelecionados'
        );

    if (contador) {
        contador.textContent =
            `${quantidade} motorista${
                quantidade === 1
                    ? ''
                    : 's'
            } selecionado${
                quantidade === 1
                    ? ''
                    : 's'
            }`;
    }

    const botao =
        document.getElementById(
            'btnExcluirSelecionados'
        );

    if (botao) {
        botao.disabled =
            quantidade === 0;
    }
}

function atualizarContadorMotoristas() {
    const contador =
        document.getElementById(
            'contadorTotalMotoristas'
        );

    if (contador) {
        contador.textContent =
            `Total: ${motoristas.length}`;
    }
}

async function cadastrarMotorista() {
    const nome =
        (
            document.getElementById(
                'nomeMotorista'
            )?.value || ''
        ).trim();

    const telefone =
        (
            document.getElementById(
                'telMotorista'
            )?.value || ''
        ).trim();

    const veiculo =
        document.getElementById(
            'tipoVeiculo'
        )?.value || 'Utilitário';

    if (!nome) {
        mostrarToast(
            'Informe o nome do motorista.',
            'error'
        );

        return;
    }

    const duplicado =
        motoristas.some(motorista =>
            motorista.nome
                .trim()
                .toLowerCase() ===
            nome.toLowerCase()
        );

    if (duplicado) {
        mostrarToast(
            'Já existe um motorista com este nome.',
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

/*
============================================================
IMPORTAÇÃO EXCEL COM VALIDAÇÃO
============================================================
*/

async function importarMotoristasExcel(event) {
    const arquivo =
        event.target.files?.[0];

    if (!arquivo) return;

    const resultado = {
        importados: 0,
        duplicados: [],
        invalidos: []
    };

    try {
        const buffer =
            await arquivo.arrayBuffer();

        const workbook =
            XLSX.read(buffer, {
                type: 'array'
            });

        const primeiraPlanilha =
            workbook.Sheets[
                workbook.SheetNames[0]
            ];

        const linhas =
            XLSX.utils.sheet_to_json(
                primeiraPlanilha,
                {
                    defval: ''
                }
            );

        const nomesExistentes =
            new Set(
                motoristas.map(motorista =>
                    motorista.nome
                        .trim()
                        .toLowerCase()
                )
            );

        const nomesNestaImportacao =
            new Set();

        for (
            let indice = 0;
            indice < linhas.length;
            indice++
        ) {
            const linha =
                linhas[indice];

            const numeroLinha =
                indice + 2;

            const nome =
                String(
                    linha.Nome ??
                    linha.nome ??
                    ''
                ).trim();

            const telefone =
                String(
                    linha.Telefone ??
                    linha.telefone ??
                    ''
                ).trim();

            const veiculoOriginal =
                String(
                    linha.Veiculo ??
                    linha.Veículo ??
                    linha.veiculo ??
                    ''
                ).trim();

            const veiculo =
                normalizarVeiculo(
                    veiculoOriginal
                );

            if (!nome) {
                resultado.invalidos.push(
                    `Linha ${numeroLinha}: nome vazio.`
                );

                continue;
            }

            if (!veiculo) {
                resultado.invalidos.push(
                    `Linha ${numeroLinha}: veículo inválido.`
                );

                continue;
            }

            const chaveNome =
                nome.toLowerCase();

            if (
                nomesExistentes.has(
                    chaveNome
                ) ||
                nomesNestaImportacao.has(
                    chaveNome
                )
            ) {
                resultado.duplicados.push(
                    `Linha ${numeroLinha}: ${nome}`
                );

                continue;
            }

            nomesNestaImportacao.add(
                chaveNome
            );

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
                if (
                    error.code ===
                    '23505'
                ) {
                    resultado.duplicados.push(
                        `Linha ${numeroLinha}: ${nome}`
                    );
                } else {
                    resultado.invalidos.push(
                        `Linha ${numeroLinha}: ${error.message}`
                    );
                }

                continue;
            }

            resultado.importados++;
        }

        await carregarMotoristas();

        renderizarMotoristas();
        renderizarPrioridades();

        mostrarResultadoImportacao(
            resultado
        );
    } catch (error) {
        mostrarToast(
            `Erro ao ler a planilha: ${obterMensagemErro(error)}`,
            'error'
        );
    } finally {
        event.target.value = '';
    }
}

function normalizarVeiculo(valor) {
    const texto =
        String(valor || '')
            .trim()
            .toLowerCase();

    if (
        texto === 'utilitário' ||
        texto === 'utilitario'
    ) {
        return 'Utilitário';
    }

    if (texto === 'van') {
        return 'Van';
    }

    if (
        texto === 'carro de passeio' ||
        texto === 'passeio' ||
        texto === 'carro'
    ) {
        return 'Carro de Passeio';
    }

    return null;
}

function mostrarResultadoImportacao(resultado) {
    let mensagem =
        `Importados: ${resultado.importados}`;

    if (resultado.duplicados.length) {
        mensagem +=
            `\nDuplicados: ${resultado.duplicados.length}` +
            `\n${resultado.duplicados.join('\n')}`;
    }

    if (resultado.invalidos.length) {
        mensagem +=
            `\nInválidos: ${resultado.invalidos.length}` +
            `\n${resultado.invalidos.join('\n')}`;
    }

    alert(mensagem);
}

/*
============================================================
EXCLUSÃO EM MASSA
============================================================
*/

async function excluirMotoristasSelecionados() {
    const ids =
        [...motoristasSelecionados];

    if (!ids.length) {
        mostrarToast(
            'Selecione pelo menos um motorista.',
            'error'
        );

        return;
    }

    const confirmacao =
        confirm(
            `Deseja arquivar ${ids.length} motorista(s) selecionado(s)?`
        );

    if (!confirmacao) {
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

    motoristasSelecionados.clear();

    await carregarMotoristas();

    renderizarMotoristas();
    renderizarPrioridades();

    mostrarToast(
        `${ids.length} motorista(s) arquivado(s).`,
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

    if (!lista) return;

    const data =
        document.getElementById(
            'dataEscala'
        )?.value;

    if (!data) {
        lista.innerHTML =
            '<p class="helper-text">Selecione uma data.</p>';

        return;
    }

    const filtro =
        document.getElementById(
            'buscaIndisponibilidade'
        )?.value.toLowerCase() || '';

    const idsIndisponiveis =
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
                idsIndisponiveis.includes(
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
                `${motorista.nome} · ${motorista.veiculo}`;

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
FUNÇÕES DE COMPATIBILIDADE
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
            motorista.nome;

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

    if (!select) return;

    const ids =
        Array.from(select.selectedOptions)
            .map(option => option.value);

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
UTILITÁRIOS
============================================================
*/

function capitalizar(valor) {
    return valor
        .charAt(0)
        .toUpperCase() +
        valor.slice(1);
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

function esconderLoader() {
    document
        .getElementById('appLoader')
        ?.remove();
}

function obterMensagemErro(error) {
    return error?.message ||
        'Erro desconhecido.';
}

function atualizarInfoBackup() {
    const elemento =
        document.getElementById(
            'infoUltimoBackup'
        );

    if (elemento) {
        elemento.textContent =
            `☁️ Supabase sincronizado em ` +
            `${new Date().toLocaleString('pt-BR')}`;
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
        5000
    );
}
