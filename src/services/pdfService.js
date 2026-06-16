const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const templatePath = path.join(__dirname, '../../templates/nda.html');

function numeroParaExtenso(valor) {
  if (valor === 0) return 'zero';
  const unidades = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove',
    'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
  const dezenas = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  const centenas = ['', 'cem', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos',
    'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

  function converter(n) {
    if (n < 20) return unidades[n];
    if (n < 100) {
      const d = Math.floor(n / 10);
      const u = n % 10;
      return dezenas[d] + (u ? ' e ' + unidades[u] : '');
    }
    if (n < 1000) {
      const c = Math.floor(n / 100);
      const resto = n % 100;
      if (c === 1 && resto > 0) return 'cento e ' + converter(resto);
      return centenas[c] + (resto ? ' e ' + converter(resto) : '');
    }
    if (n < 1000000) {
      const m = Math.floor(n / 1000);
      const resto = n % 1000;
      const milhar = m === 1 ? 'mil' : converter(m) + ' mil';
      return milhar + (resto ? ' e ' + converter(resto) : '');
    }
    return n.toString();
  }

  const inteiro = Math.floor(valor);
  const centavos = Math.round((valor - inteiro) * 100);
  let resultado = 'R$ ' + valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) + ' (' + converter(inteiro);
  resultado += inteiro === 1 ? ' real' : ' reais';
  if (centavos > 0) {
    resultado += ' e ' + converter(centavos) + (centavos === 1 ? ' centavo' : ' centavos');
  }
  resultado += ')';
  return resultado;
}

async function gerarPDF(dados) {
  let template = fs.readFileSync(templatePath, 'utf-8');

  const isPJ = dados.tipo_pessoa === 'PJ';
  const tipoPessoa = isPJ ? 'pessoa jurídica de direito privado' : 'pessoa física';
  const tipoDoc = isPJ ? 'CNPJ' : 'CPF';
  const valorMultaFormatado = numeroParaExtenso(parseFloat(dados.valor_multa));

  const meses = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  const mesStr = meses[parseInt(dados.data_mes) - 1] || dados.data_mes;

  const blocoRepresentante = isPJ && dados.representante
    ? `neste ato representada por ${dados.representante}, ${dados.cargo || ''}, inscrito(a) no CPF sob o nº ${dados.cpf_representante},`
    : '';

  const blocoPlataforma = dados.plataforma_assinatura
    ? `A assinatura do presente instrumento será realizada por meio da plataforma <strong>${dados.plataforma_assinatura}</strong>.`
    : '';

  const replacements = {
    '{{TIPO_PESSOA}}': tipoPessoa,
    '{{RAZAO_SOCIAL}}': dados.razao_social,
    '{{TIPO_DOCUMENTO}}': tipoDoc,
    '{{NUMERO_DOCUMENTO}}': dados.cnpj_cpf,
    '{{ENDERECO}}': dados.endereco,
    '{{CEP}}': dados.cep,
    '{{REPRESENTANTE}}': dados.representante || '',
    '{{CPF_REPRESENTANTE}}': dados.cpf_representante || '',
    '{{CARGO}}': dados.cargo || '',
    '{{BLOCO_REPRESENTANTE}}': blocoRepresentante,
    '{{PRAZO_VIGENCIA}}': dados.prazo_vigencia,
    '{{VALOR_MULTA}}': valorMultaFormatado,
    '{{PRAZO_NAO_SOLICITACAO}}': dados.prazo_nao_solicitacao,
    '{{PLATAFORMA_ASSINATURA}}': dados.plataforma_assinatura || '',
    '{{BLOCO_PLATAFORMA}}': blocoPlataforma,
    '{{TESTEMUNHA1_NOME}}': dados.testemunha1_nome,
    '{{TESTEMUNHA1_CPF}}': dados.testemunha1_cpf,
    '{{TESTEMUNHA2_NOME}}': dados.testemunha2_nome,
    '{{TESTEMUNHA2_CPF}}': dados.testemunha2_cpf,
    '{{DATA_DIA}}': dados.data_dia,
    '{{DATA_MES}}': mesStr,
    '{{DATA_ANO}}': dados.data_ano,
  };

  for (const [key, value] of Object.entries(replacements)) {
    template = template.split(key).join(value);
  }

  const launchOptions = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  };
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  const browser = await puppeteer.launch(launchOptions);

  try {
    const page = await browser.newPage();
    await page.setContent(template, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '2.5cm', bottom: '2.5cm', left: '2.5cm', right: '2.5cm' },
      displayHeaderFooter: true,
      footerTemplate: `<div style="font-size:9px;font-family:Arial,sans-serif;width:100%;text-align:center;color:#666;">
        Página <span class="pageNumber"></span> de <span class="totalPages"></span>
      </div>`,
      headerTemplate: '<div></div>',
    });
    return pdfBuffer;
  } finally {
    await browser.close();
  }
}

module.exports = { gerarPDF };
