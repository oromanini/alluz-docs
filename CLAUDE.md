# CLAUDE.md — nda-form

## Regras obrigatórias de desenvolvimento

### Testes

**Toda nova funcionalidade ou alteração de comportamento deve ser acompanhada de testes.**

- Criar ou atualizar o arquivo de teste correspondente em `tests/` antes de abrir PR.
- Os testes devem passar (`npm test`) antes de qualquer merge. **Nunca subir PR com testes falhando.**
- Ao adicionar um novo serviço em `src/services/`, criar `tests/<nomeServico>.test.js`.
- Ao adicionar uma nova rota em `src/routes/`, criar ou expandir o arquivo de teste correspondente em `tests/`.
- Ao alterar middleware em `src/middlewares/`, atualizar `tests/middleware-auth.test.js` ou o arquivo equivalente.

### Padrões de mock nos testes

- Banco de dados: sempre usar `jest.mock('../src/db/connection')` (o mock automático fica em `src/db/__mocks__/connection.js`).
- Serviços externos (nodemailer, puppeteer, https): usar `jest.mock()` ou `jest.spyOn()`. Nunca chamar serviços reais nos testes.
- Nunca usar `jest.mock('fs')` — quebra o `cosmiconfig` do Puppeteer. Usar `jest.spyOn(fs, 'readFileSync')` com `.mockRestore()` no `afterEach`.

### Variáveis de ambiente nos testes

- Definir `process.env.JWT_SECRET` no topo do arquivo antes de importar o `app`.
- Remover `process.env.DOCUSEAL_API_KEY` no `beforeEach` quando testar o fluxo sem DocuSeal.

## Stack

- Runtime: Node.js ≥ 20
- Framework: Express 4
- Banco: MySQL 2 (pooled connection em `src/db/connection.js`)
- Auth: JWT (`jsonwebtoken`) + bcrypt
- PDF: Puppeteer (headless Chromium)
- Email: Nodemailer (SMTP Hostinger)
- Assinatura digital: DocuSeal (opcional, via `DOCUSEAL_API_KEY`)
- Testes: Jest + Supertest

## Estrutura do projeto

```
src/
  app.js              # Express app (sem listen)
  routes/             # Rotas: nda.js, auth.js, clientes.js
  middlewares/        # auth.js — verifica JWT
  services/           # pdfService, emailService, docusealService
  db/
    connection.js     # Pool MySQL
    __mocks__/        # Mock automático do pool para testes
tests/                # Um arquivo por módulo testado
```

## Valores fixos do NDA (não vêm do formulário)

| Campo               | Valor            |
|---------------------|------------------|
| `prazo_vigencia`    | 1 (um) ano       |
| `valor_multa`       | R$ 20.000,00     |
| `prazo_nao_solicitacao` | 1 (um) ano   |
