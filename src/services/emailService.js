const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const emailTemplatePath = path.join(__dirname, '../../templates/email.html');

function criarTransporte() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 465,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

function slugify(str) {
  return str
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .toUpperCase();
}

async function enviarNDA(dados, pdfBuffer) {
  const transporter = criarTransporte();

  let emailHtml = fs.readFileSync(emailTemplatePath, 'utf-8');
  emailHtml = emailHtml.split('{{NOME_CLIENTE}}').join(dados.razao_social);
  emailHtml = emailHtml.split('{{EMAIL_CLIENTE}}').join(dados.email);

  const nomeArquivo = `NDA_${slugify(dados.razao_social)}.pdf`;

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: dados.email,
    cc: process.env.EMAIL_CC,
    subject: 'Seu NDA — Alluz Tech',
    html: emailHtml,
    attachments: [
      {
        filename: nomeArquivo,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  });
}

module.exports = { enviarNDA };
