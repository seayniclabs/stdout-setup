import { execFile as execFileCallback } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile } from 'fs/promises';
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
  const workDir = '/workspace';
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
      await executeStep(step.id, config, workDir, events);

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

    // Self-destruct after 10 seconds
    setTimeout(async () => {
      console.log('[Installer] Self-destructing setup container...');
      try {
        await execFile('docker', ['stop', 'stdout-setup']);
        await execFile('docker', ['rm', 'stdout-setup']);
      } catch (err) {
        console.error('[Installer] Self-destruct failed:', err.message);
      }
    }, 10000);

  } catch (error) {
    console.error('[Installer] Fatal error:', error);
    events.emit('progress', {
      type: 'error',
      error: error.message,
      step: error.step || 'unknown',
    });
  }
}

async function executeStep(stepId, config, workDir, events) {
  switch (stepId) {
    case 1: // Generate Configuration
      await generateDockerCompose(config, workDir, events);
      break;

    case 2: // Pull Docker Images
      events.emit('progress', { type: 'output', message: 'Pulling stdout:latest...' });
      await execFile('docker', ['pull', 'ghcr.io/seayniclabs/stdout:latest']);
      events.emit('progress', { type: 'output', message: 'Pulling windlass:latest...' });
      await execFile('docker', ['pull', 'ghcr.io/seayniclabs/windlass:latest']);
      break;

    case 3: // Start Containers
      events.emit('progress', { type: 'output', message: 'Starting containers...' });
      await execFile('docker', ['compose', '-f', join(workDir, 'docker-compose.yml'), 'up', '-d']);
      break;

    case 4: // Wait for Health Checks
      events.emit('progress', { type: 'output', message: 'Waiting for health checks...' });
      await waitForHealthy('stdout', 60000, events);
      break;

    case 5: // Initialize Database
      events.emit('progress', { type: 'output', message: 'Running database migrations...' });
      await execFile('docker', ['exec', 'stdout', 'npm', 'run', 'db:migrate']);
      break;

    case 6: // Create Admin Account
      events.emit('progress', { type: 'output', message: `Creating admin user: ${config.adminEmail}` });
      await execFile('docker', ['exec', 'stdout', 'node', 'scripts/create-admin.js', config.adminEmail, config.adminPassword]);
      break;

    case 7: // Configure Environment
      events.emit('progress', { type: 'output', message: `Setting environment name: ${config.environmentName}` });
      await execFile('docker', ['exec', 'stdout', 'node', 'scripts/set-env-name.js', config.environmentName]);
      break;

    case 8: // Finalize Installation
      events.emit('progress', { type: 'output', message: 'Marking installation complete...' });
      await execFile('docker', ['exec', 'stdout', 'node', 'scripts/mark-installation-complete.js']);
      events.emit('progress', { type: 'output', message: 'Running health check...' });
      const { stdout } = await execFile('docker', ['exec', 'stdout', 'curl', '-f', 'http://localhost:3000/healthz']);
      events.emit('progress', { type: 'output', message: `Health check: ${stdout}` });
      break;

    default:
      throw new Error(`Unknown step: ${stepId}`);
  }
}

async function generateDockerCompose(config, workDir, events) {
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
