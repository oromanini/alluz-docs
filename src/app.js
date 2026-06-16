require('dotenv').config();
const express = require('express');
const rateLimit = require('express-rate-limit');
const path = require('path');

const ndaRoutes = require('./routes/nda');
const authRoutes = require('./routes/auth');
const clientesRoutes = require('./routes/clientes');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const ndaLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Tente novamente em 1 hora.' },
});

app.use('/api/gerar-nda', ndaLimiter);
app.use('/api', ndaRoutes);
app.use('/api/admin', authRoutes);
app.use('/api/admin/clientes', clientesRoutes);

app.get('/admin/login', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'admin', 'login.html'));
});
app.get('/admin/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'admin', 'dashboard.html'));
});

module.exports = app;
