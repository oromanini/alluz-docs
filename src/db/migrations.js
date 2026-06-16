const bcrypt = require('bcrypt');
const pool = require('./connection');

async function runMigrations() {
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS clientes (
        id                    INT AUTO_INCREMENT PRIMARY KEY,
        tipo_pessoa           ENUM('PJ', 'PF') NOT NULL,
        razao_social          VARCHAR(255) NOT NULL,
        cnpj_cpf              VARCHAR(20) NOT NULL,
        endereco              TEXT NOT NULL,
        cep                   VARCHAR(10) NOT NULL,
        representante         VARCHAR(255),
        cpf_representante     VARCHAR(14),
        cargo                 VARCHAR(100),
        prazo_vigencia        VARCHAR(100) NOT NULL,
        valor_multa           DECIMAL(15,2) NOT NULL,
        prazo_nao_solicitacao VARCHAR(100) NOT NULL,
        plataforma_assinatura VARCHAR(100),
        testemunha1_nome      VARCHAR(255) NOT NULL,
        testemunha1_cpf       VARCHAR(14) NOT NULL,
        testemunha2_nome      VARCHAR(255) NOT NULL,
        testemunha2_cpf       VARCHAR(14) NOT NULL,
        data_assinatura       DATE NOT NULL,
        email                 VARCHAR(255) NOT NULL,
        created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        username      VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const [rows] = await conn.query('SELECT COUNT(*) as count FROM admin_users');
    if (rows[0].count === 0 && process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD_HASH) {
      await conn.query(
        'INSERT INTO admin_users (username, password_hash) VALUES (?, ?)',
        [process.env.ADMIN_USERNAME, process.env.ADMIN_PASSWORD_HASH]
      );
      console.log('Admin padrão criado:', process.env.ADMIN_USERNAME);
    }

    console.log('Migrations executadas com sucesso.');
  } finally {
    conn.release();
  }
}

module.exports = runMigrations;
