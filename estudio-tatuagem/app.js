const fs = require('fs');
const path = require('path');
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const Mustache = require('mustache');
const cron = require('node-cron');

require('dotenv').config({
  path: path.resolve(__dirname, '..', '.env'),
});

const app = express();
const paginas = path.join(__dirname, 'sistema', 'paginas');

app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

app.use((req, res, next) => {
  const metodo = String((req.body && req.body._method) || '').toUpperCase();
  if (req.method === 'POST' && ['PUT', 'DELETE'].includes(metodo)) {
    req.method = metodo;
  }
  next();
});

const db = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  dateStrings: true,
  waitForConnections: true,
  connectionLimit: 10,
});

function mostrar(nome, dados = {}) {
  const arquivo = path.join(paginas, `${nome}.html`);
  return Mustache.render(fs.readFileSync(arquivo, 'utf8'), dados);
}

function criptografar(texto) {
  const cifra = crypto.createCipheriv(
    'aes-256-cbc',
    process.env.CRIPTO_CHAVE,
    process.env.CRIPTO_IV
  );
  return cifra.update(String(texto), 'utf8', 'hex') + cifra.final('hex');
}

function descriptografar(texto) {
  const decifra = crypto.createDecipheriv(
    'aes-256-cbc',
    process.env.CRIPTO_CHAVE,
    process.env.CRIPTO_IV
  );
  return decifra.update(texto, 'hex', 'utf8') + decifra.final('utf8');
}

function rotaAsync(funcao) {
  return (req, res, next) => {
    Promise.resolve(funcao(req, res, next)).catch(next);
  };
}

function paginaErro(res, mensagem, status = 500) {
  const html = Mustache.render(
    '<!DOCTYPE html><html lang="pt-BR"><meta charset="UTF-8"><title>Erro</title><body><p>{{mensagem}}</p><p><a href="/">Voltar</a></p></body></html>',
    { mensagem }
  );
  return res.status(status).send(html);
}

function camposObrigatorios(...valores) {
  return valores.every((valor) => String(valor || '').trim());
}

function validarDataHora(valor) {
  const partes = String(valor || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!partes) return false;
  const [, ano, mes, dia, hora, minuto] = partes.map(Number);
  const data = new Date(ano, mes - 1, dia, hora, minuto);
  return data.getFullYear() === ano
    && data.getMonth() === mes - 1
    && data.getDate() === dia
    && data.getHours() === hora
    && data.getMinutes() === minuto;
}

async function excluirRegistro(res, tabela, colunaId, id, caminho, motivo) {
  try {
    await db.query(`DELETE FROM ${tabela} WHERE ${colunaId} = ?`, [id]);
    return res.redirect(caminho);
  } catch (erro) {
    if (
      erro.code === 'ER_ROW_IS_REFERENCED_2' ||
      erro.code === 'ER_ROW_IS_REFERENCED'
    ) {
      return paginaErro(res, motivo, 409);
    }
    throw erro;
  }
}

app.get('/', (req, res) => {
  res.send(mostrar('login'));
});

app.get('/health', (req, res) => res.status(200).send('ok'));

app.post('/login', rotaAsync(async (req, res) => {
  const { email, senha } = req.body;

  if (!camposObrigatorios(email, senha)) {
    return res.status(400).send(
      mostrar('login', { erro: 'Informe o e-mail e a senha.' })
    );
  }

  const [usuarios] = await db.query(
    'SELECT id_usuario, nome, email, senha FROM usuarios WHERE email = ?',
    [email]
  );
  const usuario = usuarios[0];

  if (!usuario || !(await bcrypt.compare(senha, usuario.senha))) {
    return res.status(401).send(
      mostrar('login', { erro: 'E-mail ou senha inválidos.' })
    );
  }

  const token = jwt.sign(
    { id_usuario: usuario.id_usuario, nome: usuario.nome },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 1000,
  });
  res.redirect('/principal');
}));

app.post('/sair', (req, res) => {
  res.clearCookie('token');
  res.redirect('/');
});

app.use((req, res, next) => {
  try {
    req.usuario = jwt.verify(req.cookies.token, process.env.JWT_SECRET);
    next();
  } catch (erro) {
    res.redirect('/');
  }
});

app.get('/principal', rotaAsync(async (req, res) => {
  const [sessoesHoje] = await db.query(
    `SELECT DATE_FORMAT(sessoes.data_hora, '%d/%m/%Y %H:%i') AS data_br,
            projetos.descricao AS projeto_descricao,
            clientes.nome AS cliente_nome
     FROM sessoes
     JOIN projetos ON projetos.id_projeto = sessoes.id_projeto
     JOIN clientes ON clientes.id_cliente = projetos.id_cliente
     WHERE DATE(sessoes.data_hora) = CURDATE()
     ORDER BY sessoes.data_hora`
  );
  res.send(mostrar('principal', {
    nome: req.usuario.nome,
    sessoesHoje,
    temSessoesHoje: sessoesHoje.length > 0,
  }));
}));

app.get('/clientes', rotaAsync(async (req, res) => {
  const busca = String(req.query.busca || '');
  const padrao = `%${busca}%`;
  const cpfBusca = busca.replace(/\D/g, '');
  const cpfCifrado = cpfBusca.length === 11 ? criptografar(cpfBusca) : null;
  const [lista] = await db.query(
    `SELECT id_cliente, nome, cpf, telefone, email
     FROM clientes
     WHERE nome LIKE ? OR telefone LIKE ? OR email LIKE ? OR cpf = ?
     ORDER BY nome`,
    [padrao, padrao, padrao, cpfCifrado]
  );

  const clientes = lista.map((cliente) => {
    try {
      return { ...cliente, cpf: descriptografar(cliente.cpf) };
    } catch (erro) {
      return { ...cliente, cpf: 'Não foi possível descriptografar' };
    }
  });

  const editar = clientes.find(
    (cliente) => String(cliente.id_cliente) === String(req.query.editar || '')
  );

  res.send(mostrar('clientes', {
    busca,
    clientes,
    editando: Boolean(editar),
    acao: editar ? `/clientes/${editar.id_cliente}` : '/clientes',
    form: editar || {},
  }));
}));

app.post('/clientes', rotaAsync(async (req, res) => {
  const { nome, cpf, telefone, email } = req.body;
  if (!camposObrigatorios(nome, cpf, telefone, email)) {
    return res.status(400).send(mostrar('clientes', {
      busca: '',
      clientes: [],
      erro: 'Preencha todos os dados do cliente.',
      editando: false,
      acao: '/clientes',
      form: req.body,
    }));
  }

  await db.query(
    `INSERT INTO clientes (nome, cpf, telefone, email)
     VALUES (?, ?, ?, ?)`,
    [nome, criptografar(cpf), telefone, email]
  );
  res.redirect('/clientes');
}));

app.put('/clientes/:id', rotaAsync(async (req, res) => {
  const { nome, cpf, telefone, email } = req.body;
  if (!camposObrigatorios(nome, cpf, telefone, email)) {
    return res.status(400).send(
      mostrar('clientes', {
        busca: '',
        clientes: [],
        erro: 'Preencha todos os dados do cliente.',
        editando: true,
        acao: `/clientes/${req.params.id}`,
        form: req.body,
      })
    );
  }

  await db.query(
    `UPDATE clientes
     SET nome = ?, cpf = ?, telefone = ?, email = ?
     WHERE id_cliente = ?`,
    [nome, criptografar(cpf), telefone, email, req.params.id]
  );
  res.redirect('/clientes');
}));

app.delete('/clientes/:id', rotaAsync(async (req, res) => {
  await excluirRegistro(
    res,
    'clientes',
    'id_cliente',
    req.params.id,
    '/clientes',
    'Não é possível excluir este cliente porque há projetos vinculados a ele.'
  );
}));

async function mostrarProjetos(req, res, erro = '', dadosFormulario = null, idEdicao = '') {
  const [projetos] = await db.query(
    `SELECT projetos.id_projeto, projetos.descricao, projetos.id_cliente,
            clientes.nome AS cliente_nome
     FROM projetos
     JOIN clientes ON clientes.id_cliente = projetos.id_cliente
     ORDER BY projetos.id_projeto`
  );
  const [listaClientes] = await db.query(
    'SELECT id_cliente, nome FROM clientes ORDER BY nome'
  );

  const idSelecionado = idEdicao || req.query.editar || '';
  const editar = projetos.find(
    (projeto) => String(projeto.id_projeto) === String(idSelecionado)
  );
  const form = dadosFormulario
    ? { ...(editar || {}), ...dadosFormulario }
    : editar || {};
  const clientes = listaClientes.map((cliente) => ({
    ...cliente,
    selecionado:
      String(cliente.id_cliente) === String(form.id_cliente || '')
        ? 'selected'
        : '',
  }));

  res.send(mostrar('projetos', {
    projetos,
    clientes,
    erro,
    editando: Boolean(editar),
    acao: editar ? `/projetos/${editar.id_projeto}` : '/projetos',
    form,
  }));
}

app.get('/projetos', rotaAsync(async (req, res) => {
  await mostrarProjetos(req, res);
}));

app.post('/projetos', rotaAsync(async (req, res) => {
  const { descricao, id_cliente } = req.body;
  if (!camposObrigatorios(descricao, id_cliente)) {
    return mostrarProjetos(
      req,
      res,
      'Informe a descrição e selecione um cliente.',
      req.body
    );
  }

  await db.query(
    'INSERT INTO projetos (descricao, id_cliente) VALUES (?, ?)',
    [descricao, id_cliente]
  );
  res.redirect('/projetos');
}));

app.put('/projetos/:id', rotaAsync(async (req, res) => {
  const { descricao, id_cliente } = req.body;
  if (!camposObrigatorios(descricao, id_cliente)) {
    return mostrarProjetos(
      req,
      res,
      'Informe a descrição e selecione um cliente.',
      req.body,
      req.params.id
    );
  }

  await db.query(
    `UPDATE projetos
     SET descricao = ?, id_cliente = ?
     WHERE id_projeto = ?`,
    [descricao, id_cliente, req.params.id]
  );
  res.redirect('/projetos');
}));

app.delete('/projetos/:id', rotaAsync(async (req, res) => {
  await excluirRegistro(
    res,
    'projetos',
    'id_projeto',
    req.params.id,
    '/projetos',
    'Não é possível excluir este projeto porque há sessões vinculadas a ele.'
  );
}));

async function mostrarSessoes(req, res, erro = '', dadosFormulario = null, idEdicao = '') {
  const [sessoes] = await db.query(
    `SELECT sessoes.id_sessao, sessoes.data_hora, sessoes.id_projeto,
            projetos.descricao AS projeto_descricao,
            clientes.nome AS cliente_nome
     FROM sessoes
     JOIN projetos ON projetos.id_projeto = sessoes.id_projeto
     JOIN clientes ON clientes.id_cliente = projetos.id_cliente
     ORDER BY sessoes.data_hora`
  );
  const [listaProjetos] = await db.query(
    `SELECT projetos.id_projeto, projetos.descricao,
            clientes.nome AS cliente_nome
     FROM projetos
     JOIN clientes ON clientes.id_cliente = projetos.id_cliente
     ORDER BY clientes.nome, projetos.id_projeto`
  );

  const idSelecionado = idEdicao || req.query.editar || '';
  const sessaoEditando = sessoes.find(
    (sessao) => String(sessao.id_sessao) === String(idSelecionado)
  );
  const form = dadosFormulario
    ? {
        ...(sessaoEditando || {}),
        ...dadosFormulario,
        data_input: String(dadosFormulario.data_hora || '').slice(0, 16).replace(' ', 'T'),
      }
    : sessaoEditando
      ? {
          ...sessaoEditando,
          data_input: String(sessaoEditando.data_hora).slice(0, 16).replace(' ', 'T'),
        }
      : {};

  const projetos = listaProjetos.map((projeto) => ({
    ...projeto,
    selecionado:
      String(projeto.id_projeto) === String(form.id_projeto || '')
        ? 'selected'
        : '',
  }));
  const sessoesFormatadas = sessoes.map((sessao) => ({
    ...sessao,
    data_exibicao: String(sessao.data_hora).replace('T', ' '),
  }));

  res.send(mostrar('sessoes', {
    sessoes: sessoesFormatadas,
    projetos,
    erro,
    editando: Boolean(sessaoEditando),
    acao: sessaoEditando ? `/sessoes/${sessaoEditando.id_sessao}` : '/sessoes',
    form,
  }));
}

app.get('/sessoes', rotaAsync(async (req, res) => {
  await mostrarSessoes(req, res);
}));

app.post('/sessoes', rotaAsync(async (req, res) => {
  const { data_hora, id_projeto } = req.body;
  if (!camposObrigatorios(data_hora, id_projeto) || !validarDataHora(data_hora)) {
    return mostrarSessoes(
      req,
      res,
      'Informe uma data e hora válidas e selecione um projeto.',
      req.body
    );
  }

  await db.query(
    'INSERT INTO sessoes (data_hora, id_projeto) VALUES (?, ?)',
    [data_hora.replace('T', ' '), id_projeto]
  );
  res.redirect('/sessoes');
}));

app.put('/sessoes/:id', rotaAsync(async (req, res) => {
  const { data_hora, id_projeto } = req.body;
  if (!camposObrigatorios(data_hora, id_projeto) || !validarDataHora(data_hora)) {
    return mostrarSessoes(
      req,
      res,
      'Informe uma data e hora válidas e selecione um projeto.',
      req.body,
      req.params.id
    );
  }

  await db.query(
    `UPDATE sessoes
     SET data_hora = ?, id_projeto = ?
     WHERE id_sessao = ?`,
    [data_hora.replace('T', ' '), id_projeto, req.params.id]
  );
  res.redirect('/sessoes');
}));

app.delete('/sessoes/:id', rotaAsync(async (req, res) => {
  await db.query('DELETE FROM sessoes WHERE id_sessao = ?', [req.params.id]);
  res.redirect('/sessoes');
}));

app.use((erro, req, res, next) => {
  console.error(erro);
  if (res.headersSent) {
    return next(erro);
  }

  if (erro.code === 'ER_ACCESS_DENIED_ERROR' || erro.code === 'ECONNREFUSED') {
    return paginaErro(
      res,
      'Não foi possível acessar o MySQL. Confira o serviço e as credenciais.',
      503
    );
  }
  if (
    erro.code === 'ER_ROW_IS_REFERENCED_2' ||
    erro.code === 'ER_ROW_IS_REFERENCED'
  ) {
    return paginaErro(
      res,
      'Não é possível excluir este registro porque ele possui vínculos.',
      409
    );
  }

  paginaErro(res, 'Ocorreu um erro ao processar a solicitação.');
});

cron.schedule('0 8 * * *', async () => {
  try {
    const [sessoes] = await db.query(
      `SELECT DATE_FORMAT(sessoes.data_hora, '%H:%i') AS hora,
              projetos.descricao AS projeto_descricao,
              clientes.nome AS cliente_nome
       FROM sessoes
       JOIN projetos ON projetos.id_projeto = sessoes.id_projeto
       JOIN clientes ON clientes.id_cliente = projetos.id_cliente
       WHERE DATE(sessoes.data_hora) = CURDATE()
       ORDER BY sessoes.data_hora`
    );
    console.log(`\nALERTA MATINAL — ${sessoes.length} sessão(ões) para hoje:`);
    if (sessoes.length === 0) console.log('Nenhuma sessão agendada para hoje.');
    for (const sessao of sessoes) {
      console.log(`${sessao.hora} — ${sessao.cliente_nome}: ${sessao.projeto_descricao}`);
    }
  } catch (erro) {
    console.error('Não foi possível carregar o alerta matinal:', erro.message);
  }
}, { timezone: 'America/Sao_Paulo' });

const porta = process.env.PORT || 3000;
app.listen(porta, () => {
  console.log(`Estúdio rodando em http://localhost:${porta}`);
  db.query('SELECT 1')
    .then(() => console.log('Conexão com o MySQL realizada.'))
    .catch((erro) => {
      console.error('Servidor iniciado, mas não foi possível conectar ao MySQL.');
      console.error(erro.message);
    });
});
