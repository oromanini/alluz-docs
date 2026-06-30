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

// Resposta do POST /submissions/pdf conforme documentação oficial:
// objeto único com id e submitters (sem name, com embed_src)
const respostaSubmissionPdf = {
  id: 'sub-1',
  status: 'pending',
  submitters: [
    { email: 'empresa@teste.com', slug: 'abc', embed_src: 'https://docuseal.com/s/abc' },
    { email: 'nda@alluz.tech',    slug: 'def', embed_src: 'https://docuseal.com/s/def' },
    { email: 'test1@email.com',   slug: 'ghi', embed_src: 'https://docuseal.com/s/ghi' },
    { email: 'test2@email.com',   slug: 'jkl', embed_src: 'https://docuseal.com/s/jkl' },
  ],
};

// Resposta do POST /submissions (fallback): array com submission_id, name, email, slug
const respostaSubmissionTemplate = [
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
    mockHttpsRequest(200, respostaSubmissionTemplate);

    const result = await criarSubmission(dadosBase);

    const bodyStr = https.request.mock.results[0].value.write.mock.calls[0][0];
    const body = JSON.parse(bodyStr);
    expect(https.request.mock.calls[0][0].path).toBe('/submissions');
    expect(body.template_id).toBe(4380107);
    expect(result.submissionId).toBe('sub-1');
    expect(result.signatarios).toHaveLength(4);
  });

  it('envia 4 submitters com os roles corretos', async () => {
    mockHttpsRequest(200, respostaSubmissionTemplate);

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
    mockHttpsRequest(200, respostaSubmissionTemplate);

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
  });
});

describe('criarSubmission — com pdfBuffer (POST /submissions/pdf)', () => {
  const fakePdf = Buffer.from('%PDF-1.4\n/Type /Page\n%%EOF');

  it('usa POST /submissions/pdf e retorna submissionId e signatarios', async () => {
    mockHttpsSequence([
      { statusCode: 200, body: { fields: [] } },       // GET /templates/:id
      { statusCode: 200, body: respostaSubmissionPdf }, // POST /submissions/pdf
    ]);

    const result = await criarSubmission(dadosBase, fakePdf);

    const calls = https.request.mock.calls;
    expect(calls.find(([o]) => o.path === '/submissions/pdf')).toBeDefined();
    expect(result.submissionId).toBe('sub-1');
    expect(result.signatarios).toHaveLength(4);
  });

  it('inclui o PDF em base64 e send_email: false no payload', async () => {
    mockHttpsSequence([
      { statusCode: 200, body: { fields: [] } },
      { statusCode: 200, body: respostaSubmissionPdf },
    ]);

    await criarSubmission(dadosBase, fakePdf);

    const calls = https.request.mock.calls;
    const idx = calls.findIndex(([o]) => o.path === '/submissions/pdf');
    const body = JSON.parse(https.request.mock.results[idx].value.write.mock.calls[0][0]);
    expect(body.documents[0].file).toBe(fakePdf.toString('base64'));
    expect(body.send_email).toBe(false);
  });

  it('envia 4 submitters com os roles corretos', async () => {
    mockHttpsSequence([
      { statusCode: 200, body: { fields: [] } },
      { statusCode: 200, body: respostaSubmissionPdf },
    ]);

    await criarSubmission(dadosBase, fakePdf);

    const calls = https.request.mock.calls;
    const idx = calls.findIndex(([o]) => o.path === '/submissions/pdf');
    const { submitters } = JSON.parse(https.request.mock.results[idx].value.write.mock.calls[0][0]);
    expect(submitters[0].role).toBe('DIVULGANTE');
    expect(submitters[1].role).toBe('RECEPTORA');
    expect(submitters[2].role).toBe('TESTEMUNHA 1');
    expect(submitters[3].role).toBe('TESTEMUNHA 2');
  });

  it('resolve links pelo embed_src da resposta, cruzando por email', async () => {
    mockHttpsSequence([
      { statusCode: 200, body: { fields: [] } },
      { statusCode: 200, body: respostaSubmissionPdf },
    ]);

    const result = await criarSubmission(dadosBase, fakePdf);

    expect(result.signatarios[0].link).toBe('https://docuseal.com/s/abc');
    expect(result.signatarios[0].nome).toBe('Empresa Teste');
    expect(result.signatarios[1].link).toBe('https://docuseal.com/s/def');
    expect(result.signatarios[2].link).toBe('https://docuseal.com/s/ghi');
    expect(result.signatarios[3].link).toBe('https://docuseal.com/s/jkl');
  });

  it('infere roles a partir dos nomes dos campos', async () => {
    const camposTemplate = [
      { name: 'ASSINATURA DIVULGANTE', type: 'signature', areas: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.05, page: 2, attachment_uuid: 'u' }] },
      { name: 'ASSINATURA RECEPTORA',  type: 'signature', areas: [{ x: 0.5, y: 0.2, w: 0.3, h: 0.05, page: 2, attachment_uuid: 'u' }] },
      { name: 'ASSINATURA T1',         type: 'signature', areas: [{ x: 0.1, y: 0.4, w: 0.3, h: 0.05, page: 2, attachment_uuid: 'u' }] },
      { name: 'ASSINATURA T2',         type: 'signature', areas: [{ x: 0.5, y: 0.4, w: 0.3, h: 0.05, page: 2, attachment_uuid: 'u' }] },
    ];
    mockHttpsSequence([
      { statusCode: 200, body: { fields: camposTemplate } },
      { statusCode: 200, body: respostaSubmissionPdf },
    ]);

    await criarSubmission(dadosBase, fakePdf);

    const calls = https.request.mock.calls;
    const idx = calls.findIndex(([o]) => o.path === '/submissions/pdf');
    const { documents } = JSON.parse(https.request.mock.results[idx].value.write.mock.calls[0][0]);
    const fields = documents[0].fields;

    expect(fields.find(f => f.name === 'ASSINATURA DIVULGANTE').role).toBe('DIVULGANTE');
    expect(fields.find(f => f.name === 'ASSINATURA RECEPTORA').role).toBe('RECEPTORA');
    expect(fields.find(f => f.name === 'ASSINATURA T1').role).toBe('TESTEMUNHA 1');
    expect(fields.find(f => f.name === 'ASSINATURA T2').role).toBe('TESTEMUNHA 2');
  });

  it('remove attachment_uuid e converte pages para 1-indexed', async () => {
    const camposTemplate = [
      { name: 'RUBRICA DIVULGANTE',    type: 'initials',  areas: [{ x: 0.1, y: 0.9, w: 0.1, h: 0.03, page: 0, attachment_uuid: 'u' }] },
      { name: 'ASSINATURA DIVULGANTE', type: 'signature', areas: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.05, page: 2, attachment_uuid: 'u' }] },
    ];
    // fakePdf tem 1 ocorrência de /Type /Page → última página = 0-indexed 0
    // Assinatura estava na página 2 (última do template 0-indexed) → mapeia para página 0 do novo PDF → +1 = página 1
    // Rubrica estava na página 0 (não última) → 0 + 1 = página 1
    mockHttpsSequence([
      { statusCode: 200, body: { fields: camposTemplate } },
      { statusCode: 200, body: respostaSubmissionPdf },
    ]);

    await criarSubmission(dadosBase, fakePdf);

    const calls = https.request.mock.calls;
    const idx = calls.findIndex(([o]) => o.path === '/submissions/pdf');
    const { documents } = JSON.parse(https.request.mock.results[idx].value.write.mock.calls[0][0]);
    const fields = documents[0].fields;

    const rubrica = fields.find(f => f.name === 'RUBRICA DIVULGANTE');
    expect(rubrica.areas[0].attachment_uuid).toBeUndefined();
    expect(rubrica.areas[0].page).toBe(1); // 0 + 1

    const assinatura = fields.find(f => f.name === 'ASSINATURA DIVULGANTE');
    expect(assinatura.areas[0].page).toBe(1); // remapeado para última (0) + 1
  });

  it('lança erro se o DocuSeal retornar 4xx', async () => {
    mockHttpsSequence([
      { statusCode: 200, body: { fields: [] } },
      { statusCode: 422, body: { error: 'invalid document' } },
    ]);

    await expect(criarSubmission(dadosBase, fakePdf)).rejects.toThrow('DocuSeal 422');
  });
});
