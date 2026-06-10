import express from 'express';
import { EventEmitter } from 'events';
import { runInstaller } from './installer.js';

const app = express();
const setupEvents = new EventEmitter();

// Buffer last error for late-connecting SSE clients
let lastError = null;
let installationComplete = false;

app.use(express.json());
app.use(express.static('public'));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ready' });
});

// SSE endpoint for real-time progress
app.get('/api/setup/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send initial connection confirmation
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  // If there's a buffered error, send it immediately
  if (lastError) {
    console.log('[SSE] Sending buffered error:', lastError);
    res.write(`data: ${JSON.stringify(lastError)}\n\n`);
    res.end();
    return;
  }

  // If installation already completed, send completion immediately
  if (installationComplete) {
    res.write(`data: ${JSON.stringify({ type: 'complete', url: 'http://stdout.local:8112' })}\n\n`);
    res.end();
    return;
  }

  const onProgress = (data) => {
    console.log('[SSE] Sending:', data);
    res.write(`data: ${JSON.stringify(data)}\n\n`);

    // Buffer errors and completion for late-connecting clients
    if (data.type === 'error') {
      lastError = data;
    }
    if (data.type === 'complete') {
      installationComplete = true;
    }
  };

  setupEvents.on('progress', onProgress);

  req.on('close', () => {
    console.log('[SSE] Client disconnected');
    setupEvents.off('progress', onProgress);
  });
});

// Start installation
app.post('/api/setup/start', async (req, res) => {
  const { licenseKey, adminEmail, adminPassword, environmentName } = req.body;

  // Validate inputs
  if (!adminEmail || !adminPassword) {
    return res.status(400).json({ error: 'Admin email and password required' });
  }

  if (!licenseKey) {
    return res.status(400).json({ error: 'License key required' });
  }

  res.json({ status: 'started' });

  // Run installer in background
  runInstaller({
    licenseKey,
    adminEmail,
    adminPassword,
    environmentName: environmentName || 'Production',
  }, setupEvents).catch(err => {
    setupEvents.emit('progress', { type: 'error', error: err.message });
  });
});

const PORT = 8888;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Setup server running on http://0.0.0.0:${PORT}`);
  console.log('Waiting for browser connection...');
});
