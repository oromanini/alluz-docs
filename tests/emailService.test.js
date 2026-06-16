jest.mock('nodemailer');
jest.mock('fs');

const nodemailer = require('nodemailer');
const fs = require('fs');

const sendMailMock = jest.fn().mockResolvedValue({ messageId: 'test' });
nodemailer.createTransport.mockReturnValue({ sendMail: sendMailMock });

const { enviarNDA, notificarInterno, enviarLinkAssinatura } = require('../src/services/emailService');

beforeEach(() => {
  sendMailMock.mockClear();
  nodemailer.createTransport.mockClear();
});

const dados = {
  razao_social: 'Empresa Teste LTDA',
  email: 'cliente@empresa.com',
};

describe('enviarNDA', () => {
  it('envia email para o cliente com o PDF anexado', async () => {
    fs.readFileSync.mockReturnValue('<p>{{NOME_CLIENTE}} {{EMAIL_CLIENTE}}</p>');
    const pdfBuffer = Buffer.from('pdf');

    await enviarNDA(dados, pdfBuffer);

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const opts = sendMailMock.mock.calls[0][0];
    expect(opts.to).toBe('cliente@empresa.com');
    expect(opts.attachments[0].content).toBe(pdfBuffer);
    expect(opts.attachments[0].filename).toContain('EMPRESA_TESTE_LTDA');
  });

  it('substitui nome e email no template HTML', async () => {
    fs.readFileSync.mockReturnValue('Olá {{NOME_CLIENTE}}, seu email é {{EMAIL_CLIENTE}}');

    await enviarNDA(dados, Buffer.from('pdf'));

    const opts = sendMailMock.mock.calls[0][0];
    expect(opts.html).toContain('Empresa Teste LTDA');
    expect(opts.html).toContain('cliente@empresa.com');
  });

  it('usa assunto correto', async () => {
    fs.readFileSync.mockReturnValue('template');
    await enviarNDA(dados, Buffer.from('pdf'));
    expect(sendMailMock.mock.calls[0][0].subject).toBe('Seu NDA — Alluz Tech');
  });
});

describe('notificarInterno', () => {
  it('envia somente para EMAIL_CC (interno)', async () => {
    process.env.EMAIL_CC = 'interno@alluz.tech';
    fs.readFileSync.mockReturnValue('template');

    await notificarInterno(dados, Buffer.from('pdf'));

    const opts = sendMailMock.mock.calls[0][0];
    expect(opts.to).toBe('interno@alluz.tech');
    expect(opts.subject).toContain('Empresa Teste LTDA');
  });
});

describe('enviarLinkAssinatura', () => {
  beforeEach(() => {
    fs.readFileSync.mockReturnValue('{{NOME_SIGNATARIO}} {{MENSAGEM_INTRO}} {{LINK_ASSINATURA}}');
  });

  it('envia para o email informado', async () => {
    await enviarLinkAssinatura('João', 'joao@email.com', 'https://link', 'Empresa', 'cliente');
    expect(sendMailMock.mock.calls[0][0].to).toBe('joao@email.com');
  });

  it('substitui variáveis no template', async () => {
    await enviarLinkAssinatura('João', 'joao@email.com', 'https://link', 'Empresa', 'cliente');
    const opts = sendMailMock.mock.calls[0][0];
    expect(opts.html).toContain('João');
    expect(opts.html).toContain('https://link');
  });

  it('usa intro correta para papel cliente', async () => {
    await enviarLinkAssinatura('João', 'joao@email.com', 'https://link', 'Empresa', 'cliente');
    const opts = sendMailMock.mock.calls[0][0];
    expect(opts.html).toContain('Alluz Tech');
  });

  it('usa intro correta para papel alluz', async () => {
    await enviarLinkAssinatura('Ana', 'ana@alluz.tech', 'https://link', 'Empresa', 'alluz');
    const opts = sendMailMock.mock.calls[0][0];
    expect(opts.html).toContain('Empresa');
  });

  it('usa intro correta para papel testemunha', async () => {
    await enviarLinkAssinatura('Carlos', 'carlos@email.com', 'https://link', 'Empresa', 'testemunha');
    const opts = sendMailMock.mock.calls[0][0];
    expect(opts.html).toContain('testemunha');
  });

  it('usa intro de cliente para papel desconhecido', async () => {
    await enviarLinkAssinatura('X', 'x@x.com', 'https://link', 'Empresa', 'desconhecido');
    const opts = sendMailMock.mock.calls[0][0];
    // fallback para introsPorPapel.cliente
    expect(opts.html).toContain('Alluz Tech');
  });
});
