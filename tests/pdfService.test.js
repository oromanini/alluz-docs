jest.mock('puppeteer');

const puppeteer = require('puppeteer');
const fs = require('fs');
const { gerarPDF } = require('../src/services/pdfService');

let readFileSyncSpy;

const dadosBase = {
  tipo_pessoa: 'PJ',
  razao_social: 'Empresa Teste LTDA',
  cnpj_cpf: '00.000.000/0001-00',
  endereco: 'Rua Teste, 123',
  cep: '01310-100',
  representante: 'João Silva',
  cpf_representante: '000.000.000-00',
  cargo: 'Diretor',
  prazo_vigencia: '1 (um) ano',
  valor_multa: 20000,
  prazo_nao_solicitacao: '1 (um) ano',
  plataforma_assinatura: '',
  testemunha1_nome: 'Testemunha 1',
  testemunha1_cpf: '111.111.111-11',
  testemunha2_nome: 'Testemunha 2',
  testemunha2_cpf: '222.222.222-22',
  data_dia: '15',
  data_mes: '6',
  data_ano: '2025',
};

function setupPuppeteerMock(htmlCapturado) {
  const pageMock = {
    setContent: jest.fn().mockImplementation((html) => { if (htmlCapturado) htmlCapturado.value = html; }),
    pdf: jest.fn().mockResolvedValue(Buffer.from('pdf-fake')),
  };
  const browserMock = {
    newPage: jest.fn().mockResolvedValue(pageMock),
    close: jest.fn().mockResolvedValue(),
  };
  puppeteer.launch.mockResolvedValue(browserMock);
  return { pageMock, browserMock };
}

beforeEach(() => {
  readFileSyncSpy = jest.spyOn(fs, 'readFileSync').mockReturnValue(
    '<html>{{RAZAO_SOCIAL}} {{VALOR_MULTA}} {{TIPO_PESSOA}} {{TIPO_DOCUMENTO}} {{BLOCO_REPRESENTANTE}} {{BLOCO_PLATAFORMA}} {{DATA_MES}}</html>'
  );
});

afterEach(() => {
  readFileSyncSpy.mockRestore();
});

describe('gerarPDF', () => {
  it('retorna um Buffer', async () => {
    setupPuppeteerMock();
    const result = await gerarPDF(dadosBase);
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it('substitui {{RAZAO_SOCIAL}} no template', async () => {
    const capturado = {};
    const { pageMock } = setupPuppeteerMock(capturado);
    pageMock.setContent.mockImplementation((html) => { capturado.value = html; });

    await gerarPDF(dadosBase);
    expect(capturado.value).toContain('Empresa Teste LTDA');
  });

  it('formata valor_multa em extenso no template', async () => {
    const capturado = {};
    const { pageMock } = setupPuppeteerMock();
    pageMock.setContent.mockImplementation((html) => { capturado.value = html; });

    await gerarPDF({ ...dadosBase, valor_multa: 20000 });
    expect(capturado.value).toContain('vinte mil reais');
  });

  it('usa tipo PJ corretamente', async () => {
    const capturado = {};
    const { pageMock } = setupPuppeteerMock();
    pageMock.setContent.mockImplementation((html) => { capturado.value = html; });

    await gerarPDF(dadosBase);
    expect(capturado.value).toContain('pessoa jurídica de direito privado');
    expect(capturado.value).toContain('CNPJ');
  });

  it('usa tipo PF corretamente', async () => {
    readFileSyncSpy.mockReturnValue('<html>{{TIPO_PESSOA}} {{TIPO_DOCUMENTO}} {{BLOCO_REPRESENTANTE}}</html>');
    const capturado = {};
    const { pageMock } = setupPuppeteerMock();
    pageMock.setContent.mockImplementation((html) => { capturado.value = html; });

    await gerarPDF({ ...dadosBase, tipo_pessoa: 'PF', representante: '' });
    expect(capturado.value).toContain('pessoa física');
    expect(capturado.value).toContain('CPF');
  });

  it('fecha o browser mesmo se pdf() lançar erro', async () => {
    const pageMock = {
      setContent: jest.fn().mockResolvedValue(),
      pdf: jest.fn().mockRejectedValue(new Error('falha puppeteer')),
    };
    const browserMock = {
      newPage: jest.fn().mockResolvedValue(pageMock),
      close: jest.fn().mockResolvedValue(),
    };
    puppeteer.launch.mockResolvedValue(browserMock);

    await expect(gerarPDF(dadosBase)).rejects.toThrow('falha puppeteer');
    expect(browserMock.close).toHaveBeenCalled();
  });

  it('converte mês numérico para nome em português', async () => {
    readFileSyncSpy.mockReturnValue('<html>{{DATA_MES}}</html>');
    const capturado = {};
    const { pageMock } = setupPuppeteerMock();
    pageMock.setContent.mockImplementation((html) => { capturado.value = html; });

    await gerarPDF({ ...dadosBase, data_mes: '1' });
    expect(capturado.value).toContain('janeiro');
  });
});

describe('numeroParaExtenso (via gerarPDF)', () => {
  async function extenso(valor) {
    readFileSyncSpy.mockReturnValue('{{VALOR_MULTA}}');
    const capturado = {};
    const { pageMock } = setupPuppeteerMock();
    pageMock.setContent.mockImplementation((html) => { capturado.value = html; });
    await gerarPDF({ ...dadosBase, valor_multa: valor });
    return capturado.value;
  }

  it('converte 0', async () => expect(await extenso(0)).toContain('zero'));
  it('converte valor unitário (1)', async () => expect(await extenso(1)).toContain('um real'));
  it('converte dezena (15)', async () => expect(await extenso(15)).toContain('quinze reais'));
  it('converte centena (100)', async () => expect(await extenso(100)).toContain('cem reais'));
  it('converte centena com resto (101)', async () => expect(await extenso(101)).toContain('cento e um reais'));
  it('converte milhar (1000)', async () => expect(await extenso(1000)).toContain('mil reais'));
  it('converte 20000', async () => expect(await extenso(20000)).toContain('vinte mil reais'));
});
