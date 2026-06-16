jest.mock('https');

const https = require('https');
const { EventEmitter } = require('events');

const { criarSubmission } = require('../src/services/docusealService');

function mockHttpsRequest(statusCode, responseBody) {
  const resEmitter = new EventEmitter();
  resEmitter.statusCode = statusCode;

  const reqEmitter = new EventEmitter();
  reqEmitter.write = jest.fn();
  reqEmitter.end = jest.fn().mockImplementation(() => {
    resEmitter.emit('data', JSON.stringify(responseBody));
    resEmitter.emit('end');
  });

  https.request.mockImplementation((opts, cb) => {
    cb(resEmitter);
    return reqEmitter;
  });
}

const dadosBase = {
  razao_social: 'Empresa Teste',
  email: 'empresa@teste.com',
  testemunha1_nome: 'Testemunha 1',
  testemunha1_email: 'test1@email.com',
  testemunha2_nome: 'Testemunha 2',
  testemunha2_email: 'test2@email.com',
};

beforeEach(() => {
  process.env.DOCUSEAL_API_KEY = 'fake-key';
});

describe('criarSubmission', () => {
  it('retorna submissionId e signatarios a partir da resposta da API', async () => {
    mockHttpsRequest(200, [
      { submission_id: 'sub-1', name: 'Empresa Teste', email: 'empresa@teste.com', slug: 'abc' },
      { submission_id: 'sub-1', name: 'Alluz Tech',    email: 'nda@alluz.tech',   slug: 'def' },
    ]);

    const result = await criarSubmission(dadosBase);

    expect(result.submissionId).toBe('sub-1');
    expect(result.signatarios).toHaveLength(2);
    expect(result.signatarios[0].link).toBe('https://docuseal.com/s/abc');
    expect(result.signatarios[1].email).toBe('nda@alluz.tech');
  });

  it('envia 4 submitters para a API (divulgante, receptora, 2 testemunhas)', async () => {
    mockHttpsRequest(200, [
      { submission_id: 'sub-2', name: 'X', email: 'x@x.com', slug: 'x1' },
    ]);

    await criarSubmission(dadosBase);

    const chamada = https.request.mock.calls[0];
    // O body é enviado via req.write — verificamos via reqEmitter.write
    const bodyStr = https.request.mock.results[0].value.write.mock.calls[0][0];
    const body = JSON.parse(bodyStr);
    expect(body.submitters).toHaveLength(4);
    expect(body.submitters[0].role).toBe('DIVULGANTE');
    expect(body.submitters[1].role).toBe('RECEPTORA');
    expect(body.send_email).toBe(false);
  });

  it('usa representante como nome quando razao_social não existe', async () => {
    mockHttpsRequest(200, [
      { submission_id: 's', name: 'Rep', email: 'rep@x.com', slug: 'x' },
    ]);

    await criarSubmission({ ...dadosBase, razao_social: '', representante: 'Rep Legal' });

    const bodyStr = https.request.mock.results[0].value.write.mock.calls[0][0];
    const body = JSON.parse(bodyStr);
    expect(body.submitters[0].name).toBe('Rep Legal');
  });

  it('lança erro se a API retornar status 4xx', async () => {
    mockHttpsRequest(401, { error: 'unauthorized' });
    await expect(criarSubmission(dadosBase)).rejects.toThrow('DocuSeal 401');
  });

  it('lança erro se a resposta não for JSON válido', async () => {
    const resEmitter = new EventEmitter();
    resEmitter.statusCode = 200;
    const reqEmitter = new EventEmitter();
    reqEmitter.write = jest.fn();
    reqEmitter.end = jest.fn().mockImplementation(() => {
      resEmitter.emit('data', 'resposta-invalida-nao-json');
      resEmitter.emit('end');
    });
    https.request.mockImplementation((opts, cb) => { cb(resEmitter); return reqEmitter; });

    await expect(criarSubmission(dadosBase)).rejects.toThrow('DocuSeal parse error');
  });

  it('retorna submissionId null se lista estiver vazia', async () => {
    mockHttpsRequest(200, []);
    const result = await criarSubmission(dadosBase);
    expect(result.submissionId).toBeNull();
    expect(result.signatarios).toHaveLength(0);
  });
});
