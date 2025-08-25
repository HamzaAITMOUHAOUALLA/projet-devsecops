const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

console.log('🚀 Starting backend server...');

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({
    message: 'DevSecOps Backend API is running!',
    version: '1.0.3',
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

app.get('/ready', (req, res) => {
  res.status(200).json({ status: 'Ready' });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('✅ Server running on http://0.0.0.0:' + PORT);
  console.log('📅 Started at:', new Date().toISOString());
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  server.close(() => process.exit(0));
});
