CREATE DATABASE IF NOT EXISTS estudio_tatuagem
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

USE estudio_tatuagem;

CREATE TABLE IF NOT EXISTS clientes (
  id_cliente INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nome VARCHAR(100) NOT NULL,
  cpf VARCHAR(255) NOT NULL,
  telefone VARCHAR(20) NOT NULL,
  email VARCHAR(150) NOT NULL,
  PRIMARY KEY (id_cliente)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS usuarios (
  id_usuario INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nome VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL,
  senha VARCHAR(255) NOT NULL,
  PRIMARY KEY (id_usuario),
  UNIQUE KEY uq_usuarios_email (email)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS projetos (
  id_projeto INT UNSIGNED NOT NULL AUTO_INCREMENT,
  descricao TEXT NOT NULL,
  id_cliente INT UNSIGNED NOT NULL,
  PRIMARY KEY (id_projeto),
  KEY idx_projetos_id_cliente (id_cliente),
  CONSTRAINT fk_projetos_clientes
    FOREIGN KEY (id_cliente) REFERENCES clientes (id_cliente)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
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
    ON UPDATE CASCADE
    ON DELETE RESTRICT
) ENGINE=InnoDB;


INSERT INTO clientes (id_cliente, nome, cpf, telefone, email) VALUES
  (1, 'Ana Souza', '326f2d786fcb7c0a4ea221a8fc74f1fc', '(11) 99911-2233', 'ana.souza@example.com'),
  (2, 'Bruno Lima', '7a3752a6d090c4d347f4f4f880b976a2', '(11) 98822-3344', 'bruno.lima@example.com'),
  (3, 'Carla Mendes', 'a134b2c35e2f614c70ada0cc3f898ab5', '(11) 97733-4455', 'carla.mendes@example.com');

INSERT INTO usuarios (id_usuario, nome, email, senha) VALUES
  (1, 'Administrador', 'admin@tattoo.com', '$2b$10$4n6CM.4Bka3WlEq/6f50aeGr8aD0BuW.34cGN44xUbrSeM5cW6p.6'),
  (2, 'Marina Alves', 'marina@tattoo.com', '$2b$10$4n6CM.4Bka3WlEq/6f50aeGr8aD0BuW.34cGN44xUbrSeM5cW6p.6'),
  (3, 'Rafael Costa', 'rafael@tattoo.com', '$2b$10$4n6CM.4Bka3WlEq/6f50aeGr8aD0BuW.34cGN44xUbrSeM5cW6p.6');

-- Cada projeto pertence a um cliente.
INSERT INTO projetos (id_projeto, descricao, id_cliente) VALUES
  (1, 'Ramo de flores em traço fino, no antebraço', 1),
  (2, 'Dragão em estilo oriental, na panturrilha', 2),
  (3, 'Lua e estrelas em estilo minimalista, no pulso', 3);

-- Cada sessão está vinculada a um único projeto.
INSERT INTO sessoes (id_sessao, data_hora, id_projeto) VALUES
  (1, '2026-12-01 09:00:00', 1),
  (2, '2026-12-02 14:30:00', 2),
  (3, '2026-12-03 10:00:00', 3);
