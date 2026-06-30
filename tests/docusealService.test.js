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

function mockHttpsSequence(responses) {
  let index = 0;
  https.request.mockImplementation((opts, cb) => {
    const { statusCode, body } = responses[index] || responses[responses.length - 1];
    index++;

    const resEmitter = new EventEmitter();
    resEmitter.statusCode = statusCode;

    const reqEmitter = new EventEmitter();
    reqEmitter.write = jest.fn();
    reqEmitter.end = jest.fn().mockImplementation(() => {
      resEmitter.emit('data', JSON.stringify(body));
      resEmitter.emit('end');
    });

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

const submissaoResposta = [
  { submission_id: 'sub-1', name: 'Empresa Teste', email: 'empresa@teste.com', slug: 'abc' },
  { submission_id: 'sub-1', name: 'Alluz Tech',    email: 'nda@alluz.tech',   slug: 'def' },
  { submission_id: 'sub-1', name: 'Testemunha 1',  email: 'test1@email.com',  slug: 'ghi' },
  { submission_id: 'sub-1', name: 'Testemunha 2',  email: 'test2@email.com',  slug: 'jkl' },
];

beforeEach(() => {
  process.env.DOCUSEAL_API_KEY = 'fake-key';
});

describe('criarSubmission — sem pdfBuffer (fallback template estático)', () => {
  it('usa POST /submissions com template_id fixo', async () => {
    mockHttpsRequest(200, submissaoResposta);

    const result = await criarSubmission(dadosBase);

    const bodyStr = https.request.mock.results[0].value.write.mock.calls[0][0];
    const body = JSON.parse(bodyStr);
    expect(body.template_id).toBe(4380107);
    expect(https.request.mock.calls[0][0].path).toBe('/submissions');
    expect(result.submissionId).toBe('sub-1');
    expect(result.signatarios).toHaveLength(4);
  });

  it('envia 4 submitters com os roles corretos', async () => {
    mockHttpsRequest(200, submissaoResposta);

    await criarSubmission(dadosBase);

    const bodyStr = https.request.mock.results[0].value.write.mock.calls[0][0];
    const body = JSON.parse(bodyStr);
    expect(body.submitters).toHaveLength(4);
    expect(body.submitters[0].role).toBe('DIVULGANTE');
    expect(body.submitters[1].role).toBe('RECEPTORA');
    expect(body.submitters[2].role).toBe('TESTEMUNHA 1');
    expect(body.submitters[3].role).toBe('TESTEMUNHA 2');
    expect(body.send_email).toBe(false);
  });

  it('usa representante como nome quando razao_social não existe', async () => {
    mockHttpsRequest(200, submissaoResposta);

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

describe('criarSubmission — com pdfBuffer (POST /submissions/pdf)', () => {
  const fakePdf = Buffer.from('%PDF-1.4\n/Type /Page\n%%EOF');

  it('usa POST /submissions/pdf com o PDF em base64', async () => {
    mockHttpsSequence([
      { statusCode: 200, body: { fields: [] } },   // GET /templates/:id
      { statusCode: 200, body: submissaoResposta }, // POST /submissions/pdf
    ]);

    const result = await criarSubmission(dadosBase, fakePdf);

    const calls = https.request.mock.calls;
    const submissionCall = calls.find(([opts]) => opts.path === '/submissions/pdf');
    expect(submissionCall).toBeDefined();

    const idx = calls.indexOf(submissionCall);
    const bodyStr = https.request.mock.results[idx].value.write.mock.calls[0][0];
    const body = JSON.parse(bodyStr);

    expect(body.documents[0].file).toBe(fakePdf.toString('base64'));
    expect(body.send_email).toBe(false);
    expect(result.submissionId).toBe('sub-1');
    expect(result.signatarios).toHaveLength(4);
  });

  it('inclui os 4 submitters no payload', async () => {
    mockHttpsSequence([
      { statusCode: 200, body: { fields: [] } },
      { statusCode: 200, body: submissaoResposta },
    ]);

    await criarSubmission(dadosBase, fakePdf);

    const calls = https.request.mock.calls;
    const submissionCall = calls.find(([opts]) => opts.path === '/submissions/pdf');
    const idx = calls.indexOf(submissionCall);
    const bodyStr = https.request.mock.results[idx].value.write.mock.calls[0][0];
    const { submitters } = JSON.parse(bodyStr);

    expect(submitters).toHaveLength(4);
    expect(submitters[0].role).toBe('DIVULGANTE');
    expect(submitters[1].role).toBe('RECEPTORA');
    expect(submitters[2].role).toBe('TESTEMUNHA 1');
    expect(submitters[3].role).toBe('TESTEMUNHA 2');
  });

  it('infere roles corretos a partir dos nomes dos campos', async () => {
    const camposTemplate = [
      { name: 'ASSINATURA DIVULGANTE', type: 'signature', areas: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.05, page: 2, attachment_uuid: 'u' }] },
      { name: 'ASSINATURA RECEPTORA',  type: 'signature', areas: [{ x: 0.5, y: 0.2, w: 0.3, h: 0.05, page: 2, attachment_uuid: 'u' }] },
      { name: 'ASSINATURA T1',         type: 'signature', areas: [{ x: 0.1, y: 0.4, w: 0.3, h: 0.05, page: 2, attachment_uuid: 'u' }] },
      { name: 'ASSINATURA T2',         type: 'signature', areas: [{ x: 0.5, y: 0.4, w: 0.3, h: 0.05, page: 2, attachment_uuid: 'u' }] },
    ];

    mockHttpsSequence([
      { statusCode: 200, body: { fields: camposTemplate } },
      { statusCode: 200, body: submissaoResposta },
    ]);

    await criarSubmission(dadosBase, fakePdf);

    const calls = https.request.mock.calls;
    const submissionCall = calls.find(([opts]) => opts.path === '/submissions/pdf');
    const idx = calls.indexOf(submissionCall);
    const bodyStr = https.request.mock.results[idx].value.write.mock.calls[0][0];
    const { documents } = JSON.parse(bodyStr);
    const fields = documents[0].fields;

    expect(fields.find(f => f.name === 'ASSINATURA DIVULGANTE').role).toBe('DIVULGANTE');
    expect(fields.find(f => f.name === 'ASSINATURA RECEPTORA').role).toBe('RECEPTORA');
    expect(fields.find(f => f.name === 'ASSINATURA T1').role).toBe('TESTEMUNHA 1');
    expect(fields.find(f => f.name === 'ASSINATURA T2').role).toBe('TESTEMUNHA 2');
  });

  it('remove attachment_uuid das areas', async () => {
    const camposTemplate = [
      { name: 'ASSINATURA DIVULGANTE', type: 'signature', areas: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.05, page: 0, attachment_uuid: 'uuid-original' }] },
    ];

    mockHttpsSequence([
      { statusCode: 200, body: { fields: camposTemplate } },
      { statusCode: 200, body: submissaoResposta },
    ]);

    await criarSubmission(dadosBase, fakePdf);

    const calls = https.request.mock.calls;
    const submissionCall = calls.find(([opts]) => opts.path === '/submissions/pdf');
    const idx = calls.indexOf(submissionCall);
    const bodyStr = https.request.mock.results[idx].value.write.mock.calls[0][0];
    const { documents } = JSON.parse(bodyStr);

    expect(documents[0].fields[0].areas[0].attachment_uuid).toBeUndefined();
    expect(documents[0].fields[0].areas[0].x).toBe(0.1);
  });

  it('remapeia campos da última página do template para a última do novo PDF', async () => {
    const camposTemplate = [
      { name: 'ASSINATURA DIVULGANTE', type: 'signature', areas: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.05, page: 2, attachment_uuid: 'u' }] },
      { name: 'RUBRICA DIVULGANTE',    type: 'initials',  areas: [{ x: 0.1, y: 0.9, w: 0.1, h: 0.03, page: 0, attachment_uuid: 'u' }, { x: 0.1, y: 0.9, w: 0.1, h: 0.03, page: 1, attachment_uuid: 'u' }] },
    ];

    // fakePdf tem 1 ocorrência de /Type /Page → última página = índice 0
    mockHttpsSequence([
      { statusCode: 200, body: { fields: camposTemplate } },
      { statusCode: 200, body: submissaoResposta },
    ]);

    await criarSubmission(dadosBase, fakePdf);

    const calls = https.request.mock.calls;
    const submissionCall = calls.find(([opts]) => opts.path === '/submissions/pdf');
    const idx = calls.indexOf(submissionCall);
    const bodyStr = https.request.mock.results[idx].value.write.mock.calls[0][0];
    const { documents } = JSON.parse(bodyStr);
    const fields = documents[0].fields;

    const assinatura = fields.find(f => f.name === 'ASSINATURA DIVULGANTE');
    expect(assinatura.areas[0].page).toBe(0); // última página do novo PDF

    const rubrica = fields.find(f => f.name === 'RUBRICA DIVULGANTE');
    expect(rubrica.areas[0].page).toBe(0);
    expect(rubrica.areas[1].page).toBe(1);
  });

  it('lança erro se o DocuSeal retornar 4xx no /submissions/pdf', async () => {
    mockHttpsSequence([
      { statusCode: 200, body: { fields: [] } },
      { statusCode: 422, body: { error: 'invalid document' } },
    ]);

    await expect(criarSubmission(dadosBase, fakePdf)).rejects.toThrow('DocuSeal 422');
  });
});
