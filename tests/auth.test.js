const request = require('supertest');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

jest.mock('../src/db/connection');
const pool = require('../src/db/connection');

process.env.JWT_SECRET = 'test-secret';
process.env.JWT_EXPIRES_IN = '1h';

const app = require('../src/app');

describe('POST /api/admin/login', () => {
  it('retorna 400 se faltar username ou password', async () => {
    const res = await request(app).post('/api/admin/login').send({ username: 'admin' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('retorna 401 se usuário não encontrado', async () => {
    pool.query.mockResolvedValueOnce([[]]);
    const res = await request(app).post('/api/admin/login').send({ username: 'x', password: 'y' });
    expect(res.status).toBe(401);
  });

  it('retorna 401 se senha incorreta', async () => {
    const hash = await bcrypt.hash('correct', 10);
    pool.query.mockResolvedValueOnce([[{ id: 1, username: 'admin', password_hash: hash }]]);
    const res = await request(app).post('/api/admin/login').send({ username: 'admin', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('retorna token JWT com credenciais válidas', async () => {
    const hash = await bcrypt.hash('secret', 10);
    pool.query.mockResolvedValueOnce([[{ id: 1, username: 'admin', password_hash: hash }]]);
    const res = await request(app).post('/api/admin/login').send({ username: 'admin', password: 'secret' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    const payload = jwt.verify(res.body.token, 'test-secret');
    expect(payload.username).toBe('admin');
  });
});
