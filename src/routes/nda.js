const express = require('express');
const pool = require('../db/connection');
const { gerarPDF } = require('../services/pdfService');
const { enviarNDA } = require('../services/emailService');

const router = express.Router();

const PRAZO_VIGENCIA = '1 (um) ano';
const VALOR_MULTA = 20000;
const PRAZO_NAO_SOLICITACAO = '1 (um) ano';

const CAMPOS_OBRIGATORIOS = [
  'tipo_pessoa', 'razao_social', 'cnpj_cpf', 'endereco', 'cep',
  'testemunha1_nome', 'testemunha1_cpf',
  'testemunha2_nome', 'testemunha2_cpf',
  'email',
];

router.post('/gerar-nda', async (req, res) => {
  const dados = req.body;

  for (const campo of CAMPOS_OBRIGATORIOS) {
    if (!dados[campo] && dados[campo] !== 0) {
      return res.status(400).json({ error: `Campo obrigatório ausente: ${campo}` });
    }
  }

  if (dados.tipo_pessoa === 'PJ') {
    if (!dados.representante || !dados.cpf_representante || !dados.cargo) {
      return res.status(400).json({ error: 'Representante legal obrigatório para Pessoa Jurídica.' });
    }
  }

  // Valores fixos — não vêm do formulário
  dados.prazo_vigencia = PRAZO_VIGENCIA;
  dados.prazo_nao_solicitacao = PRAZO_NAO_SOLICITACAO;

  // Data atual automática
  const hoje = new Date();
  const meses = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  dados.data_dia = String(hoje.getDate());
  dados.data_mes = String(hoje.getMonth() + 1);
  dados.data_ano = String(hoje.getFullYear());
  const dataAssinatura = hoje.toISOString().slice(0, 10);

  try {
    await pool.query(
      `INSERT INTO clientes
        (tipo_pessoa, razao_social, cnpj_cpf, endereco, cep, representante, cpf_representante, cargo,
         prazo_vigencia, valor_multa, prazo_nao_solicitacao, plataforma_assinatura,
         testemunha1_nome, testemunha1_cpf, testemunha2_nome, testemunha2_cpf,
         data_assinatura, email)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        dados.tipo_pessoa, dados.razao_social, dados.cnpj_cpf, dados.endereco, dados.cep,
        dados.representante || null, dados.cpf_representante || null, dados.cargo || null,
        PRAZO_VIGENCIA, VALOR_MULTA, PRAZO_NAO_SOLICITACAO,
        dados.plataforma_assinatura || null,
        dados.testemunha1_nome, dados.testemunha1_cpf,
        dados.testemunha2_nome, dados.testemunha2_cpf,
        dataAssinatura, dados.email,
      ]
    );

    const dadosCompletos = { ...dados, valor_multa: VALOR_MULTA };
    const pdfBuffer = await gerarPDF(dadosCompletos);
    await enviarNDA(dadosCompletos, pdfBuffer);

    res.json({ success: true, message: 'NDA enviado com sucesso.' });
  } catch (err) {
    console.error('Erro ao gerar NDA:', err);
    res.status(500).json({ error: 'Erro ao processar o NDA. Tente novamente.' });
  }
});

module.exports = router;
