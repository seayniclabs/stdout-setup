import { execFile as execFileCallback } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

const execFile = promisify(execFileCallback);

const STEPS = [
  { id: 1, name: 'Generate Configuration', weight: 5 },
  { id: 2, name: 'Pull Docker Images', weight: 20 },
  { id: 3, name: 'Start Containers', weight: 10 },
  { id: 4, name: 'Wait for Health Checks', weight: 15 },
  { id: 5, name: 'Initialize Database', weight: 20 },
  { id: 6, name: 'Create Admin Account', weight: 10 },
  { id: 7, name: 'Configure Environment', weight: 10 },
  { id: 8, name: 'Finalize Installation', weight: 10 },
];

export async function runInstaller(config, events) {
  const workDir = '/tmp/stdout-install';
  const DEMO_MODE = process.env.DEMO_MODE === 'true';
  const OFFLINE_MODE = process.env.OFFLINE_MODE === 'true';
  let completedWeight = 0;
  const totalWeight = STEPS.reduce((sum, s) => sum + s.weight, 0);

  try {
    events.emit('progress', { type: 'start', totalSteps: STEPS.length });

    for (const step of STEPS) {
      events.emit('progress', {
        type: 'step_start',
        step: step.id,
        name: step.name,
        progress: Math.round((completedWeight / totalWeight) * 100),
      });

      // Execute step
      await executeStep(step.id, config, workDir, events, DEMO_MODE, OFFLINE_MODE);

      completedWeight += step.weight;

      events.emit('progress', {
        type: 'step_complete',
        step: step.id,
        name: step.name,
        progress: Math.round((completedWeight / totalWeight) * 100),
      });
    }

    // Installation complete
    events.emit('progress', {
      type: 'complete',
      url: 'http://stdout.local:8112',
      message: 'Installation complete! Redirecting to StdOut...',
    });

    // Self-destruct after delay (60s in demo mode, 10s in production)
    const destructDelay = DEMO_MODE ? 60000 : 10000;
    setTimeout(async () => {
      console.log('[Installer] Self-destructing setup container...');
      try {
        await execFile('docker', ['stop', 'stdout-setup']);
        await execFile('docker', ['rm', 'stdout-setup']);
      } catch (err) {
        console.error('[Installer] Self-destruct failed:', err.message);
      }
    }, destructDelay);

  } catch (error) {
    console.error('[Installer] Fatal error:', error);
    events.emit('progress', {
      type: 'error',
      error: error.message,
      step: error.step || 'unknown',
    });
  }
}

async function executeStep(stepId, config, workDir, events, demoMode = false, offlineMode = false) {
  // In demo mode, simulate delays instead of running real commands
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  switch (stepId) {
    case 1: // Generate Configuration
      await generateDockerCompose(config, workDir, events);
      if (demoMode) await delay(1500);
      break;

    case 2: // Pull Docker Images
      if (offlineMode) {
        // Offline mode: skip pull, images already loaded via docker load
        events.emit('progress', { type: 'output', message: 'Offline mode: using pre-loaded images' });
        events.emit('progress', { type: 'output', message: 'Images loaded from bundle' });
      } else if (demoMode) {
        events.emit('progress', { type: 'output', message: 'Checking for stdout:latest...' });
        await delay(3000);
        events.emit('progress', { type: 'output', message: 'Image ready' });
        events.emit('progress', { type: 'output', message: 'Checking for windlass:latest...' });
        await delay(3000);
        events.emit('progress', { type: 'output', message: 'Image ready' });
      } else {
        // Online mode: pull from GHCR
        events.emit('progress', { type: 'output', message: 'Checking for stdout:latest...' });
        // Try to pull, but if unauthorized, check if image exists locally
        try {
          await execFile('docker', ['pull', 'ghcr.io/seayniclabs/stdout:latest']);
          events.emit('progress', { type: 'output', message: 'Image pulled successfully' });
        } catch (err) {
          if (err.message.includes('unauthorized')) {
            // Check if image exists locally
            const { stdout } = await execFile('docker', ['images', '-q', 'ghcr.io/seayniclabs/stdout:latest']);
            if (stdout.trim()) {
              events.emit('progress', { type: 'output', message: 'Using local image' });
            } else {
              throw new Error('Image not available locally and pull failed');
            }
          } else {
            throw err;
          }
        }

        events.emit('progress', { type: 'output', message: 'Checking for windlass:latest...' });
        try {
          await execFile('docker', ['pull', 'ghcr.io/seayniclabs/windlass:latest']);
          events.emit('progress', { type: 'output', message: 'Image pulled successfully' });
        } catch (err) {
          if (err.message.includes('unauthorized')) {
            const { stdout } = await execFile('docker', ['images', '-q', 'ghcr.io/seayniclabs/windlass:latest']);
            if (stdout.trim()) {
              events.emit('progress', { type: 'output', message: 'Using local image' });
            } else {
              throw new Error('Image not available locally and pull failed');
            }
          } else {
            throw err;
          }
        }
      }
      break;

    case 3: // Start Containers
      events.emit('progress', { type: 'output', message: 'Starting containers...' });
      if (demoMode) {
        await delay(2500);
        events.emit('progress', { type: 'output', message: 'Containers started successfully' });
      } else {
        // Try docker compose first, fall back to docker-compose
        try {
          await execFile('docker', ['compose', '-f', join(workDir, 'docker-compose.yml'), 'up', '-d']);
        } catch (err) {
          if (err.message.includes('unknown shorthand flag')) {
            // Use legacy docker-compose command
            await execFile('docker-compose', ['-f', join(workDir, 'docker-compose.yml'), 'up', '-d']);
          } else {
            throw err;
          }
        }
      }
      break;

    case 4: // Wait for Health Checks
      events.emit('progress', { type: 'output', message: 'Waiting for health checks...' });
      if (demoMode) {
        await delay(4000);
        events.emit('progress', { type: 'output', message: 'stdout health: healthy' });
        events.emit('progress', { type: 'output', message: 'windlass health: healthy' });
      } else {
        await waitForHealthy('stdout', 60000, events);
      }
      break;

    case 5: // Initialize Database
      events.emit('progress', { type: 'output', message: 'Running database migrations...' });
      if (demoMode) {
        await delay(3000);
        events.emit('progress', { type: 'output', message: 'Database initialized' });
      } else {
        await execFile('docker', ['exec', 'stdout', 'npm', 'run', 'db:migrate']);
      }
      break;

    case 6: // Create Admin Account
      events.emit('progress', { type: 'output', message: `Creating admin user: ${config.adminEmail}` });
      if (demoMode) {
        await delay(2000);
        events.emit('progress', { type: 'output', message: 'Admin account created' });
      } else {
        await execFile('docker', ['exec', 'stdout', 'node', 'scripts/create-admin.js', config.adminEmail, config.adminPassword]);
      }
      break;

    case 7: // Configure Environment & License
      events.emit('progress', { type: 'output', message: `Setting environment name: ${config.environmentName}` });
      if (demoMode) {
        await delay(1500);
        events.emit('progress', { type: 'output', message: 'Environment configured' });
      } else {
        await execFile('docker', ['exec', 'stdout', 'node', 'scripts/set-env-name.js', config.environmentName]);
      }

      // Store license key if provided
      if (config.licenseKey && !demoMode) {
        events.emit('progress', { type: 'output', message: 'Activating license...' });
        await execFile('docker', ['exec', 'stdout', 'node', 'scripts/set-license.js', config.licenseKey, config.adminEmail]);
        events.emit('progress', { type: 'output', message: 'License activated' });
      }
      break;

    case 8: // Finalize Installation
      events.emit('progress', { type: 'output', message: 'Marking installation complete...' });
      if (demoMode) {
        await delay(2000);
        events.emit('progress', { type: 'output', message: 'Installation marked complete' });
        events.emit('progress', { type: 'output', message: 'Health check: {"status":"ok","version":"1.0.0"}' });
      } else {
        await execFile('docker', ['exec', 'stdout', 'node', 'scripts/mark-installation-complete.js']);
        events.emit('progress', { type: 'output', message: 'Running health check...' });
        const { stdout } = await execFile('docker', ['exec', 'stdout', 'curl', '-f', 'http://localhost:3000/healthz']);
        events.emit('progress', { type: 'output', message: `Health check: ${stdout}` });
      }
      break;

    default:
      throw new Error(`Unknown step: ${stepId}`);
  }
}

async function generateDockerCompose(config, workDir, events) {
  // Ensure work directory exists
  await mkdir(workDir, { recursive: true });

  const template = await readFile(join(import.meta.dirname, 'templates', 'docker-compose.yml.tpl'), 'utf8');

  // Replace placeholders
  const rendered = template
    .replace(/{{ADMIN_EMAIL}}/g, config.adminEmail)
    .replace(/{{ENVIRONMENT_NAME}}/g, config.environmentName);

  const outputPath = join(workDir, 'docker-compose.yml');
  await writeFile(outputPath, rendered);

  events.emit('progress', { type: 'output', message: `Generated: ${outputPath}` });
}

async function waitForHealthy(containerName, timeout, events) {
  const startTime = Date.now();
  const checkInterval = 2000;

  while (Date.now() - startTime < timeout) {
    try {
      const { stdout } = await execFile('docker', ['inspect', '--format={{.State.Health.Status}}', containerName]);
      const status = stdout.trim();

      events.emit('progress', { type: 'output', message: `${containerName} health: ${status}` });

      if (status === 'healthy') {
        return;
      }
    } catch (err) {
      // Container not ready yet
    }

    await new Promise(resolve => setTimeout(resolve, checkInterval));
  }

  throw new Error(`${containerName} failed to become healthy within ${timeout}ms`);
}
