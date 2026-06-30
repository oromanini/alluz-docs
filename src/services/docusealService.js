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

// Cria um template temporário no DocuSeal a partir do PDF preenchido com os dados do cliente
async function criarTemplatePDF(pdfBuffer, nomeCliente, campos) {
  const base64 = pdfBuffer.toString('base64');
  const novaUltimaPagina = ultimaPaginaPDF(pdfBuffer);

  // Última página do template original (0-indexed): assinaturas ficam sempre na última página
  const ultimaPaginaOriginal = Math.max(...campos.flatMap(f => f.areas?.map(a => a.page) ?? [0]));

  const fields = campos.map(f => ({
    name: f.name,
    type: f.type,
    role: inferirRole(f.name),
    required: f.required !== false,
    areas: (f.areas || []).map(({ attachment_uuid, ...a }) => ({
      ...a,
      // Se o campo estava na última página do template original, mapeia para a última do novo PDF
      page: a.page === ultimaPaginaOriginal ? novaUltimaPagina : a.page,
    })),
  }));

  const payload = {
    name: `NDA - ${nomeCliente} - ${Date.now()}`,
    documents: [{ name: 'nda.pdf', file: base64, fields }],
  };

  const result = await apiRequest('POST', '/templates/pdf', payload);
  return result.id;
}

async function deletarTemplate(templateId) {
  try {
    await apiRequest('DELETE', `/templates/${templateId}`, {});
  } catch (err) {
    // Falha silenciosa — template temporário, não é crítico
    console.warn(`Não foi possível deletar o template temporário ${templateId}:`, err.message);
  }
}

async function criarSubmission(dados, pdfBuffer) {
  const nomeCliente = dados.razao_social || dados.representante || 'Cliente';

  let templateId = DOCUSEAL_TEMPLATE_ID;
  let templateTemporario = null;

  if (pdfBuffer) {
    try {
      const campos = await buscarCamposTemplate();
      templateId = await criarTemplatePDF(pdfBuffer, nomeCliente, campos);
      templateTemporario = templateId;
    } catch (err) {
      console.error('Erro ao criar template com PDF preenchido, usando template base:', err.message);
      // Fallback para o template original em caso de falha
      templateId = DOCUSEAL_TEMPLATE_ID;
    }
  }

  let submitters;
  try {
    submitters = await apiRequest('POST', '/submissions', {
      template_id: templateId,
      send_email: false,
      submitters: [
        { role: 'DIVULGANTE',   name: nomeCliente,            email: dados.email },
        { role: 'RECEPTORA',    name: 'Alluz Tech',           email: 'nda@alluz.tech' },
        { role: 'TESTEMUNHA 1', name: dados.testemunha1_nome, email: dados.testemunha1_email },
        { role: 'TESTEMUNHA 2', name: dados.testemunha2_nome, email: dados.testemunha2_email },
      ],
    });
  } finally {
    if (templateTemporario) {
      await deletarTemplate(templateTemporario);
    }
  }

  const lista = Array.isArray(submitters) ? submitters : [submitters];

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
