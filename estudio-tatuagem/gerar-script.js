const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

require('dotenv').config({
  path: path.resolve(__dirname, '..', '..', '.env'),
});

function criptografarCpf(cpf) {
  const chave = process.env.CRIPTO_CHAVE || '';
  const iv = process.env.CRIPTO_IV || '';

  if (Buffer.byteLength(chave, 'utf8') !== 32 || Buffer.byteLength(iv, 'utf8') !== 16) {
    throw new Error(
      'Configure CRIPTO_CHAVE (32 bytes) e CRIPTO_IV (16 bytes) no .env da raiz.'
    );
  }

  const cifra = crypto.createCipheriv(
    'aes-256-cbc',
    Buffer.from(chave, 'utf8'),
    Buffer.from(iv, 'utf8')
  );
  return cifra.update(String(cpf), 'utf8', 'hex') + cifra.final('hex');
}

const senhaHash = bcrypt.hashSync('123456', 10);
const cpf1 = criptografarCpf('11122233344');
const cpf2 = criptografarCpf('22233344455');
const cpf3 = criptografarCpf('33344455566');

const sql = `-- Gerado por backend/gerar-script.js. Dados e CPFs são fictícios.
CREATE DATABASE IF NOT EXISTS estudio_tatuagem
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

USE estudio_tatuagem;

CREATE TABLE IF NOT EXISTS usuarios (
  id_usuario INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nome VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL,
  senha VARCHAR(255) NOT NULL,
  PRIMARY KEY (id_usuario),
  UNIQUE KEY uq_usuarios_email (email)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS clientes (
  id_cliente INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nome VARCHAR(100) NOT NULL,
  cpf VARCHAR(255) NOT NULL,
  telefone VARCHAR(20) NOT NULL,
  email VARCHAR(150) NOT NULL,
  PRIMARY KEY (id_cliente)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS projetos (
  id_projeto INT UNSIGNED NOT NULL AUTO_INCREMENT,
  descricao TEXT NOT NULL,
  id_cliente INT UNSIGNED NOT NULL,
  PRIMARY KEY (id_projeto),
  KEY idx_projetos_id_cliente (id_cliente),
  CONSTRAINT fk_projetos_clientes
    FOREIGN KEY (id_cliente) REFERENCES clientes (id_cliente)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sessoes (
  id_sessao INT UNSIGNED NOT NULL AUTO_INCREMENT,
  data_hora DATETIME NOT NULL,
  id_projeto INT UNSIGNED NOT NULL,
  PRIMARY KEY (id_sessao),
  KEY idx_sessoes_data_hora (data_hora),
  KEY idx_sessoes_id_projeto (id_projeto),
  CONSTRAINT fk_sessoes_projetos
    FOREIGN KEY (id_projeto) REFERENCES projetos (id_projeto)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

INSERT INTO usuarios (id_usuario, nome, email, senha) VALUES
  (1, 'Administrador', 'admin@tattoo.com', '${senhaHash}'),
  (2, 'Marina Alves', 'marina@tattoo.com', '${senhaHash}'),
  (3, 'Rafael Costa', 'rafael@tattoo.com', '${senhaHash}')
ON DUPLICATE KEY UPDATE nome = VALUES(nome), senha = VALUES(senha);

INSERT INTO clientes (id_cliente, nome, cpf, telefone, email) VALUES
  (1, 'Ana Souza', '${cpf1}', '(11) 99911-2233', 'ana.souza@example.com'),
  (2, 'Bruno Lima', '${cpf2}', '(11) 98822-3344', 'bruno.lima@example.com'),
  (3, 'Carla Mendes', '${cpf3}', '(11) 97733-4455', 'carla.mendes@example.com')
ON DUPLICATE KEY UPDATE
  nome = VALUES(nome), cpf = VALUES(cpf), telefone = VALUES(telefone), email = VALUES(email);

INSERT INTO projetos (id_projeto, descricao, id_cliente) VALUES
  (1, 'Ramo de flores em traço fino, no antebraço', 1),
  (2, 'Dragão em estilo oriental, na panturrilha', 2),
  (3, 'Lua e estrelas em estilo minimalista, no pulso', 3)
ON DUPLICATE KEY UPDATE descricao = VALUES(descricao), id_cliente = VALUES(id_cliente);

INSERT INTO sessoes (id_sessao, data_hora, id_projeto) VALUES
  (1, '2026-12-01 09:00:00', 1),
  (2, '2026-12-02 14:30:00', 2),
  (3, '2026-12-03 10:00:00', 3)
ON DUPLICATE KEY UPDATE data_hora = VALUES(data_hora), id_projeto = VALUES(id_projeto);
`;

const caminhoSaida = path.resolve(__dirname, '..', '..', 'database', 'script.sql');
fs.mkdirSync(path.dirname(caminhoSaida), { recursive: true });
fs.writeFileSync(caminhoSaida, sql, 'utf8');
console.log(`Script SQL gerado em: ${caminhoSaida}`);
