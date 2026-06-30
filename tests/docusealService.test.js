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

// Encadeia múltiplas respostas para sequências de chamadas HTTP
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

describe('criarSubmission — sem pdfBuffer (caminho legado)', () => {
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

describe('criarSubmission — com pdfBuffer (PDF preenchido)', () => {
  // PDF mínimo válido para Chromium: contém /Type /Page para contagem de páginas
  const fakePdf = Buffer.from('%PDF-1.4\n/Type /Page\n%%EOF');

  it('cria template temporário, submission e deleta o template', async () => {
    mockHttpsSequence([
      { statusCode: 200, body: { fields: [] } },               // GET /templates/:id
      { statusCode: 200, body: { id: 99999 } },                // POST /templates/pdf
      { statusCode: 200, body: submissaoResposta },             // POST /submissions
      { statusCode: 200, body: {} },                           // DELETE /templates/99999
    ]);

    const result = await criarSubmission(dadosBase, fakePdf);

    expect(result.submissionId).toBe('sub-1');
    expect(result.signatarios).toHaveLength(4);

    // Verifica que criou a submission com o template temporário (id 99999)
    const calls = https.request.mock.calls;
    const submissionCall = calls.find(([opts]) => opts.method === 'POST' && opts.path === '/submissions');
    expect(submissionCall).toBeDefined();
    const bodyStr = https.request.mock.results[calls.indexOf(submissionCall)].value.write.mock.calls[0][0];
    const body = JSON.parse(bodyStr);
    expect(body.template_id).toBe(99999);

    // Verifica que o template temporário foi deletado
    const deleteCall = calls.find(([opts]) => opts.method === 'DELETE');
    expect(deleteCall).toBeDefined();
    expect(deleteCall[0].path).toContain('99999');
  });

  it('inclui o PDF em base64 no POST /templates/pdf', async () => {
    mockHttpsSequence([
      { statusCode: 200, body: { fields: [] } },
      { statusCode: 200, body: { id: 99999 } },
      { statusCode: 200, body: submissaoResposta },
      { statusCode: 200, body: {} },
    ]);

    await criarSubmission(dadosBase, fakePdf);

    const calls = https.request.mock.calls;
    const templateCall = calls.find(([opts]) => opts.path === '/templates/pdf');
    expect(templateCall).toBeDefined();
    const idx = calls.indexOf(templateCall);
    const bodyStr = https.request.mock.results[idx].value.write.mock.calls[0][0];
    const body = JSON.parse(bodyStr);
    expect(body.documents).toHaveLength(1);
    expect(body.documents[0].file).toBe(fakePdf.toString('base64'));
  });

  it('infere roles corretos a partir dos nomes dos campos', async () => {
    const camposTemplate = [
      { name: 'ASSINATURA DIVULGANTE', type: 'signature', areas: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.05, page: 2, attachment_uuid: 'uuid-1' }] },
      { name: 'ASSINATURA RECEPTORA',  type: 'signature', areas: [{ x: 0.5, y: 0.2, w: 0.3, h: 0.05, page: 2, attachment_uuid: 'uuid-1' }] },
      { name: 'ASSINATURA T1',         type: 'signature', areas: [{ x: 0.1, y: 0.4, w: 0.3, h: 0.05, page: 2, attachment_uuid: 'uuid-1' }] },
      { name: 'ASSINATURA T2',         type: 'signature', areas: [{ x: 0.5, y: 0.4, w: 0.3, h: 0.05, page: 2, attachment_uuid: 'uuid-1' }] },
    ];

    mockHttpsSequence([
      { statusCode: 200, body: { fields: camposTemplate } },
      { statusCode: 200, body: { id: 99999 } },
      { statusCode: 200, body: submissaoResposta },
      { statusCode: 200, body: {} },
    ]);

    await criarSubmission(dadosBase, fakePdf);

    const calls = https.request.mock.calls;
    const templateCall = calls.find(([opts]) => opts.path === '/templates/pdf');
    const idx = calls.indexOf(templateCall);
    const bodyStr = https.request.mock.results[idx].value.write.mock.calls[0][0];
    const { fields } = JSON.parse(bodyStr);

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
      { statusCode: 200, body: { id: 99999 } },
      { statusCode: 200, body: submissaoResposta },
      { statusCode: 200, body: {} },
    ]);

    await criarSubmission(dadosBase, fakePdf);

    const calls = https.request.mock.calls;
    const templateCall = calls.find(([opts]) => opts.path === '/templates/pdf');
    const idx = calls.indexOf(templateCall);
    const bodyStr = https.request.mock.results[idx].value.write.mock.calls[0][0];
    const { fields } = JSON.parse(bodyStr);

    expect(fields[0].areas[0].attachment_uuid).toBeUndefined();
    expect(fields[0].areas[0].x).toBe(0.1);
  });

  it('remapeia campos da última página do template para a última do novo PDF', async () => {
    // Template com 3 páginas (0,1,2) — assinatura na página 2 (última)
    const camposTemplate = [
      { name: 'ASSINATURA DIVULGANTE', type: 'signature', areas: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.05, page: 2, attachment_uuid: 'u' }] },
      { name: 'RUBRICA DIVULGANTE',    type: 'initials',  areas: [{ x: 0.1, y: 0.9, w: 0.1, h: 0.03, page: 0, attachment_uuid: 'u' }, { x: 0.1, y: 0.9, w: 0.1, h: 0.03, page: 1, attachment_uuid: 'u' }] },
    ];

    // fakePdf tem 1 ocorrência de /Type /Page → última página = índice 0
    // A assinatura estava na página 2 (última do template) → deve ir para página 0 (última do novo PDF)
    mockHttpsSequence([
      { statusCode: 200, body: { fields: camposTemplate } },
      { statusCode: 200, body: { id: 99999 } },
      { statusCode: 200, body: submissaoResposta },
      { statusCode: 200, body: {} },
    ]);

    await criarSubmission(dadosBase, fakePdf);

    const calls = https.request.mock.calls;
    const templateCall = calls.find(([opts]) => opts.path === '/templates/pdf');
    const idx = calls.indexOf(templateCall);
    const bodyStr = https.request.mock.results[idx].value.write.mock.calls[0][0];
    const { fields } = JSON.parse(bodyStr);

    const assinatura = fields.find(f => f.name === 'ASSINATURA DIVULGANTE');
    expect(assinatura.areas[0].page).toBe(0); // última página do novo PDF

    const rubrica = fields.find(f => f.name === 'RUBRICA DIVULGANTE');
    expect(rubrica.areas[0].page).toBe(0); // não era última página, mantém
    expect(rubrica.areas[1].page).toBe(1); // não era última página, mantém
  });

  it('faz fallback para template base se a criação do template falhar', async () => {
    mockHttpsSequence([
      { statusCode: 500, body: { error: 'server error' } },    // GET /templates/:id falha
      { statusCode: 200, body: submissaoResposta },             // POST /submissions com template base
    ]);

    const result = await criarSubmission(dadosBase, fakePdf);

    expect(result.submissionId).toBe('sub-1');
    const calls = https.request.mock.calls;
    const submissionCall = calls.find(([opts]) => opts.method === 'POST' && opts.path === '/submissions');
    const idx = calls.indexOf(submissionCall);
    const bodyStr = https.request.mock.results[idx].value.write.mock.calls[0][0];
    const body = JSON.parse(bodyStr);
    expect(body.template_id).toBe(4380107); // template base
  });

  it('deleta o template temporário mesmo se a criação da submission falhar', async () => {
    mockHttpsSequence([
      { statusCode: 200, body: { fields: [] } },
      { statusCode: 200, body: { id: 99999 } },
      { statusCode: 500, body: { error: 'submissions failed' } }, // POST /submissions falha
      { statusCode: 200, body: {} },                              // DELETE deve ocorrer mesmo assim
    ]);

    await expect(criarSubmission(dadosBase, fakePdf)).rejects.toThrow('DocuSeal 500');

    const deleteCall = https.request.mock.calls.find(([opts]) => opts.method === 'DELETE');
    expect(deleteCall).toBeDefined();
  });
});
