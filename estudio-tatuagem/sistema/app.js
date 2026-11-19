const fs = require('fs');
const path = require('path');
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const Mustache = require('mustache');

require('dotenv').config({
  path: path.join(__dirname, '..', '..', '.env'),
});

const app = express();
const paginas = path.join(__dirname, 'paginas');

app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

app.use((req, res, next) => {
  const metodo = String(req.body?._method || '').toUpperCase();

  if (req.method === 'POST' && ['PUT', 'DELETE'].includes(metodo)) {
    req.method = metodo;
  }

  next();
});

const db = mysql.createPool({
  host: process.env.DB_HOST,
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
  return res.status(status).send(
    `<p>${mensagem}</p><p><a href="/principal">Voltar</a></p>`
  );
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

app.post('/login', rotaAsync(async (req, res) => {
  const { email, senha } = req.body;

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
    {
      id_usuario: usuario.id_usuario,
      nome: usuario.nome,
    },
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

app.get('/principal', (req, res) => {
  res.send(mostrar('principal', { nome: req.usuario.nome }));
});

app.get('/clientes', rotaAsync(async (req, res) => {
  const busca = String(req.query.busca || '');

  const [lista] = await db.query(
    `SELECT id_cliente, nome, cpf, telefone, email
     FROM clientes
     WHERE nome LIKE ? OR telefone LIKE ? OR email LIKE ?
     ORDER BY nome`,
    [`%${busca}%`, `%${busca}%`, `%${busca}%`]
  );

  const clientes = lista.map((cliente) => {
    let cpf = '';

    try {
      cpf = descriptografar(cliente.cpf);
    } catch (erro) {
      cpf = 'Não foi possível descriptografar';
    }

    return { ...cliente, cpf };
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

  await db.query(
    `INSERT INTO clientes (nome, cpf, telefone, email)
     VALUES (?, ?, ?, ?)`,
    [nome, criptografar(cpf), telefone, email]
  );

  res.redirect('/clientes');
}));

app.put('/clientes/:id', rotaAsync(async (req, res) => {
  const { nome, cpf, telefone, email } = req.body;

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

async function mostrarProjetos(req, res, erro = '') {
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

  const editar = projetos.find(
    (projeto) => String(projeto.id_projeto) === String(req.query.editar || '')
  );

  const clientes = listaClientes.map((cliente) => ({
    ...cliente,
    selecionado:
      editar && cliente.id_cliente === editar.id_cliente ? 'selected' : '',
  }));

  res.send(mostrar('projetos', {
    projetos,
    clientes,
    erro,
    editando: Boolean(editar),
    acao: editar ? `/projetos/${editar.id_projeto}` : '/projetos',
    form: editar || {},
  }));
}

app.get('/projetos', rotaAsync(async (req, res) => {
  await mostrarProjetos(req, res);
}));

app.post('/projetos', rotaAsync(async (req, res) => {
  const { descricao, id_cliente } = req.body;

  if (!descricao || !id_cliente) {
    return mostrarProjetos(
      req,
      res,
      'Informe a descrição e selecione um cliente.'
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

  if (!descricao || !id_cliente) {
    return mostrarProjetos(
      req,
      res,
      'Informe a descrição e selecione um cliente.'
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

async function mostrarSessoes(req, res, erro = '') {
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

  const sessaoEmEdicao = sessoes.find(
    (sessao) => String(sessao.id_sessao) === String(req.query.editar || '')
  );

  const listaFormatada = sessoes.map((sessao) => ({
    ...sessao,
    data_exibicao: sessao.data_hora.replace('T', ' '),
    data_input: sessao.data_hora.slice(0, 16).replace(' ', 'T'),
  }));

  const projetos = listaProjetos.map((projeto) => ({
    ...projeto,
    selecionado:
      sessaoEmEdicao && projeto.id_projeto === sessaoEmEdicao.id_projeto
        ? 'selected'
        : '',
  }));

  res.send(mostrar('sessoes', {
    sessoes: listaFormatada,
    projetos,
    erro,
    editando: Boolean(sessaoEmEdicao),
    acao: sessaoEmEdicao
      ? `/sessoes/${sessaoEmEdicao.id_sessao}`
      : '/sessoes',
    form: sessaoEmEdicao
      ? {
          ...sessaoEmEdicao,
          data_input: sessaoEmEdicao.data_hora.slice(0, 16).replace(' ', 'T'),
        }
      : {},
  }));
}

app.get('/sessoes', rotaAsync(async (req, res) => {
  await mostrarSessoes(req, res);
}));

app.post('/sessoes', rotaAsync(async (req, res) => {
  const { data_hora, id_projeto } = req.body;

  if (!data_hora || !id_projeto) {
    return mostrarSessoes(
      req,
      res,
      'Informe a data, o horário e o projeto.'
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

  if (!data_hora || !id_projeto) {
    return mostrarSessoes(
      req,
      res,
      'Informe a data, o horário e o projeto.'
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
  await db.query(
    'DELETE FROM sessoes WHERE id_sessao = ?',
    [req.params.id]
  );

  res.redirect('/sessoes');
}));

app.use((erro, req, res, next) => {
  console.error(erro);
  paginaErro(res, 'Ocorreu um erro ao processar a solicitação.');
});

async function iniciar() {
  try {
    await db.query('SELECT 1');

    const porta = process.env.PORT || 3000;

    app.listen(porta, () => {
      console.log(`Estúdio rodando em http://localhost:${porta}` );
      console.log('Conexão com o banco estudio_tatuagem realizada.');
    });
  } catch (erro) {
    console.error('Não foi possível conectar ao MySQL.');
    console.error(erro.message);
  }
}

iniciar()