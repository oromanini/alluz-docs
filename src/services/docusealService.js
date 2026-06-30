const https = require('https');

const DOCUSEAL_TEMPLATE_ID = 4380107;

function apiRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: 'api.docuseal.com',
      path,
      method,
      headers: {
        'X-Auth-Token': process.env.DOCUSEAL_API_KEY,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };

    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(raw);
          if (res.statusCode >= 400) {
            reject(new Error(`DocuSeal ${res.statusCode}: ${JSON.stringify(json)}`));
          } else {
            resolve(json);
          }
        } catch (e) {
          reject(new Error(`DocuSeal parse error: ${raw}`));
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Busca os campos (fields) do template base para reutilizar as posições de assinatura
async function buscarCamposTemplate() {
  const template = await apiRequest('GET', `/templates/${DOCUSEAL_TEMPLATE_ID}`, {});
  return template.fields || [];
}

// Conta páginas no PDF gerado pelo Chromium/Puppeteer (0-indexed: retorna índice da última página)
function ultimaPaginaPDF(pdfBuffer) {
  const str = pdfBuffer.toString('binary');
  const matches = str.match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length - 1 : 0;
}

// Infere o role do DocuSeal a partir do nome do campo (a API não retorna role nos fields)
function inferirRole(nomeField) {
  if (nomeField.includes('DIVULGANTE')) return 'DIVULGANTE';
  if (nomeField.includes('RECEPTORA'))  return 'RECEPTORA';
  if (nomeField.includes('T1'))         return 'TESTEMUNHA 1';
  if (nomeField.includes('T2'))         return 'TESTEMUNHA 2';
  return null;
}

async function criarSubmission(dados, pdfBuffer) {
  const nomeCliente = dados.razao_social || dados.representante || 'Cliente';

  const submitters = [
    { role: 'DIVULGANTE',   name: nomeCliente,            email: dados.email },
    { role: 'RECEPTORA',    name: 'Alluz Tech',           email: 'nda@alluz.tech' },
    { role: 'TESTEMUNHA 1', name: dados.testemunha1_nome, email: dados.testemunha1_email },
    { role: 'TESTEMUNHA 2', name: dados.testemunha2_nome, email: dados.testemunha2_email },
  ];

  let resposta;

  if (pdfBuffer) {
    // POST /submissions/pdf — cria a submission diretamente do PDF preenchido,
    // reutilizando as posições de assinatura do template base
    const campos = await buscarCamposTemplate();
    const ultimaPaginaOriginal = Math.max(...campos.flatMap(f => f.areas?.map(a => a.page) ?? [0]));
    const novaUltimaPagina = ultimaPaginaPDF(pdfBuffer);

    const fields = campos.map(f => ({
      name: f.name,
      type: f.type,
      role: inferirRole(f.name),
      required: f.required !== false,
      areas: (f.areas || []).map(({ attachment_uuid, ...a }) => ({
        ...a,
        page: a.page === ultimaPaginaOriginal ? novaUltimaPagina : a.page,
      })),
    }));

    resposta = await apiRequest('POST', '/submissions/pdf', {
      send_email: false,
      documents: [{ name: 'nda.pdf', file: pdfBuffer.toString('base64'), fields }],
      submitters,
    });
  } else {
    // Fallback: usa o template estático (sem PDF preenchido)
    resposta = await apiRequest('POST', '/submissions', {
      template_id: DOCUSEAL_TEMPLATE_ID,
      send_email: false,
      submitters,
    });
  }

  const lista = Array.isArray(resposta) ? resposta : [resposta];

  return {
    submissionId: lista[0]?.submission_id ?? null,
    signatarios: lista.map(s => ({
      nome:  s.name,
      email: s.email,
      link:  `https://docuseal.com/s/${s.slug}`,
    })),
  };
}

module.exports = { criarSubmission };
