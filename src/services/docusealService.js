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

async function criarSubmission(dados) {
  const nomeCliente = dados.razao_social || dados.representante || 'Cliente';

  const submitters = await apiRequest('POST', '/submissions', {
    template_id: DOCUSEAL_TEMPLATE_ID,
    send_email: false,
    submitters: [
      { role: 'DIVULGANTE',   name: nomeCliente,            email: dados.email },
      { role: 'RECEPTORA',    name: 'Alluz Tech',           email: 'nda@alluz.tech' },
      { role: 'TESTEMUNHA 1', name: dados.testemunha1_nome, email: dados.testemunha1_email },
      { role: 'TESTEMUNHA 2', name: dados.testemunha2_nome, email: dados.testemunha2_email },
    ],
  });

  // POST /submissions retorna array de submitters, cada um com slug e submission_id
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
