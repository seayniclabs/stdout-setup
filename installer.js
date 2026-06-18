import { execFile as execFileCallback } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { InstallationError, mapLicenseError } from './errors.js';
import crypto from 'crypto';

const execFile = promisify(execFileCallback);

// Ed25519 public key — verifies all SL- keys issued from 2026-06-11 onward
const ED25519_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEActdpqlMQUnc3ObmJXZTVhrJdIXwjsZVzjLl33HxMOwY=
-----END PUBLIC KEY-----`;

// RSA-4096 public key — kept for backward compat with any pre-Ed25519 keys
const RSA_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAqml6Jvswz/YQOxsw+ipo
YP60nMaqAMJZJbbbjmq7qKZPkkWOuC1NIfTx5y9MM9ULjeVXGmcL19d/AZ0T2mvC
+977g1KBP6cf4cj+xSmSGvpELAO+wpFZOmnnYEsIrNE8xMnk9SftMtYkbuFgFUJh
0Ze8StslLstlbJZUCAOrTOcwGn3DPZDHRZSDFQ+PlSgFOoCxau2LotWMxTpyIcWm
CtV/HTjkIcftunSF9o3scqEilwD9Z/yxuDVUXtfTsHHyj5JysdbR68KpDQQ7ETsl
PjnDE6dSUcJpSxyJo7WlgBeQlXQE5E8hMTN5rJ2d2hbb+Znn+tA0KQKT27tGwrQm
OMGrZiPvthrgpfpQy+Gzj8Zl8GxNxZBZqmwYvtAYY6+mwH32DEutA8+ffQLT5lrq
TR32lMbjyr7xpLmwkut2JX4r38FLD0aav9t3vvHGZNQp/4PFowsO8GSRpyu2WHjC
nZu3hGhf3MUH3V5B3GMH/P18PdVzfuzxry++M+OUFwpB8AFFZCHH1IeGl3k3pBls
EYtOdTfUKXgO1mzUn/xzXLkgVRwTcD8177qc+TjgiuH4vjZ7Mznd6AYxLnZsU/1t
mUsSL37+laA0Ats3L/B3GepcraOuXluV/0YbkAEIFzNkuA64apLeDoH4FmKvfisD
v0orsvF3/0gETuC17zRFFB0CAwEAAQ==
-----END PUBLIC KEY-----`;

/**
 * Verify a signed license offline — no network call needed.
 * Tries Ed25519 first (short keys), falls back to RSA for legacy keys.
 */
function verifyLicenseSignature(signedKey) {
  if (!signedKey.startsWith('SL-')) {
    return { valid: false, reason: 'Invalid license format' };
  }

  const parts = signedKey.slice(3).split('.');
  if (parts.length !== 2) {
    const dashCount = (signedKey.match(/-/g) || []).length;
    if (dashCount === 2) {
      return { valid: false, reason: 'Legacy license format - requires online validation' };
    }
    return { valid: false, reason: 'Invalid license format' };
  }

  const [payloadB64, signatureB64] = parts;
  const sigBytes = Buffer.from(signatureB64, 'base64url');

  try {
    // Ed25519 signatures are exactly 64 bytes — try that first
    let isValid = false;
    if (sigBytes.length === 64) {
      isValid = crypto.verify(null, Buffer.from(payloadB64), ED25519_PUBLIC_KEY_PEM, sigBytes);
    }

    // Fall back to RSA-SHA256 for longer signatures (legacy keys)
    if (!isValid && sigBytes.length > 64) {
      const verify = crypto.createVerify('RSA-SHA256');
      verify.update(payloadB64);
      verify.end();
      isValid = verify.verify(RSA_PUBLIC_KEY_PEM, signatureB64, 'base64url');
    }

    if (!isValid) {
      return { valid: false, reason: 'Invalid signature - license may be tampered or fake' };
    }

    const raw = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    const payload = {
      product: raw.product ?? 'stdout-self-host',
      email: raw.e ?? raw.email ?? '',
      issued: raw.i ?? raw.issued ?? 0,
      expires: raw.x ?? raw.expires ?? null,
      maxActivations: raw.m ?? raw.maxActivations ?? 1,
    };

    if (!payload.email || !payload.issued) {
      return { valid: false, reason: 'Invalid license payload' };
    }

    const now = Math.floor(Date.now() / 1000);
    if (payload.expires && now > payload.expires) {
      return { valid: false, reason: `License expired on ${new Date(payload.expires * 1000).toLocaleDateString()}` };
    }

    return { valid: true, payload };
  } catch (err) {
    return { valid: false, reason: 'License verification failed: ' + err.message };
  }
}

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

    // Installation complete - detect host IP for redirect
    const hostIP = await getHostIP();
    events.emit('progress', {
      type: 'complete',
      url: `http://${hostIP}:8112`,
      message: 'Installation complete! Redirecting to StdOut...',
    });

    // Self-destruct + clean eject after a delay (give the browser time to receive
    // 'complete' and redirect to stdout.local:8112).
    //
    // A container cannot reliably `stop` then `rm` itself: `docker stop` kills this very
    // process, so the following `rm` never runs and a stopped husk is left behind. Instead we
    // spawn a DETACHED helper container that waits, then removes us from the outside. install.sh
    // also performs a belt-and-suspenders cleanup when it sees the 'complete' marker.
    const destructDelay = DEMO_MODE ? 60 : 10; // seconds
    console.log(`[Installer] Scheduling clean eject in ${destructDelay}s...`);
    try {
      // Detached docker:cli sidecar (shares the host socket) removes the setup container after
      // the delay. --rm so the sidecar cleans itself up too. No leftover artifacts.
      await execFile('docker', [
        'run', '-d', '--rm',
        '-v', '/var/run/docker.sock:/var/run/docker.sock',
        'docker:cli',
        'sh', '-c',
        `sleep ${destructDelay}; docker rm -f stdout-setup >/dev/null 2>&1 || true`,
      ]);
      console.log('[Installer] Clean-eject sidecar scheduled.');
    } catch (err) {
      console.error('[Installer] Could not schedule clean-eject sidecar:', err.message);
    }

  } catch (error) {
    console.error('[Installer] Fatal error:', error);

    // If it's already an InstallationError, emit its structured format
    if (error instanceof InstallationError) {
      events.emit('progress', error.toJSON());
    } else {
      // Wrap unknown errors
      const wrappedError = new InstallationError('E9999', {
        originalError: error.message,
        step: error.step || 'unknown',
      });
      events.emit('progress', wrappedError.toJSON());
    }
  }
}

/**
 * Validates license key via the license API and returns GHCR token.
 */
async function validateLicenseWithAPI(licenseKey, email) {
  try {
    const response = await fetch('https://stdout-licenses.fly.dev/api/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: licenseKey, email }),
      signal: AbortSignal.timeout(10000), // 10s timeout
    });

    if (!response.ok) {
      const error = await response.json();
      return {
        valid: false,
        error: error.error || `License validation failed: ${response.status}`
      };
    }

    const data = await response.json();
    // Images are pulled from Docker Hub (public, license-gated at runtime) — the
    // registry of record. The license API still returns a ghcrToken for legacy
    // reasons but the install flow does NOT use it; do not depend on it here.
    return {
      valid: true,
      offlineLicense: data.offlineLicense,
    };
  } catch (err) {
    return {
      valid: false,
      error: `License API unreachable: ${err.message}`
    };
  }
}

async function executeStep(stepId, config, workDir, events, demoMode = false, offlineMode = false) {
  // In demo mode, simulate delays instead of running real commands
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  switch (stepId) {
    case 1: // Generate Configuration
      // Validate license key if provided
      if (config.licenseKey && !demoMode) {
        events.emit('progress', { type: 'output', message: 'Validating license key...' });

        // Try offline validation first (signed licenses)
        const offlineValidation = verifyLicenseSignature(config.licenseKey);

        if (offlineValidation.valid) {
          events.emit('progress', { type: 'output', message: 'License validated (offline)' });
          // Store license for installation
          config._offlineLicense = config.licenseKey;
        } else if (!offlineMode) {
          // Fall back to online validation for legacy keys
          events.emit('progress', { type: 'output', message: 'Trying online validation...' });
          const validation = await validateLicenseWithAPI(config.licenseKey, config.adminEmail);

          if (!validation.valid) {
            throw mapLicenseError(validation.error);
          }

          events.emit('progress', { type: 'output', message: 'License validated (online)' });
          config._offlineLicense = validation.offlineLicense;
        } else {
          // Offline mode but offline validation failed
          throw mapLicenseError(offlineValidation.reason || 'Invalid license');
        }
      }

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
        // Online mode: pull from Docker Hub (public images, license-gated at runtime)
        // Pull StdOut image
        events.emit('progress', { type: 'output', message: 'Pulling stdout:latest...' });
        try {
          await execFile('docker', ['pull', 'charlieseay/stdout:latest']);
          events.emit('progress', { type: 'output', message: 'StdOut image pulled successfully' });
        } catch (err) {
          // Check if image exists locally
          const { stdout } = await execFile('docker', ['images', '-q', 'charlieseay/stdout:latest']);
          if (stdout.trim()) {
            events.emit('progress', { type: 'output', message: 'Using local StdOut image' });
          } else {
            throw new Error(`Failed to pull StdOut image: ${err.message}`);
          }
        }

        // Pull Windlass image
        events.emit('progress', { type: 'output', message: 'Pulling windlass:latest...' });
        try {
          await execFile('docker', ['pull', 'charlieseay/windlass:latest']);
          events.emit('progress', { type: 'output', message: 'Windlass image pulled successfully' });
        } catch (err) {
          const { stdout } = await execFile('docker', ['images', '-q', 'charlieseay/windlass:latest']);
          if (stdout.trim()) {
            events.emit('progress', { type: 'output', message: 'Using local Windlass image' });
          } else {
            throw new Error(`Failed to pull Windlass image: ${err.message}`);
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
        await waitForHealthy('stdout', 120000, events);
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
        // Admin account is created automatically by init-setup.sh using ADMIN_EMAIL and ADMIN_PASSWORD env vars
        events.emit('progress', { type: 'output', message: 'Admin account created by init script' });
      }
      break;

    case 7: // Configure Environment & License
      events.emit('progress', { type: 'output', message: `Setting environment name: ${config.environmentName}` });
      if (demoMode) {
        await delay(1500);
        events.emit('progress', { type: 'output', message: 'Environment configured' });
      } else {
        // Environment name and license are already configured via environment variables
        // The container's init-setup.sh handles this on first run
        events.emit('progress', { type: 'output', message: 'Environment configured via startup' });
      }

      if (config.licenseKey && !demoMode) {
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
    .replace(/{{ADMIN_PASSWORD}}/g, config.adminPassword)
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

async function getHostIP() {
  try {
    // Get the gateway IP of the stdout container's network
    const { stdout } = await execFile('docker', [
      'inspect',
      '--format={{range .NetworkSettings.Networks}}{{.Gateway}}{{end}}',
      'stdout'
    ]);
    const gatewayIP = stdout.trim();
    if (gatewayIP && gatewayIP !== '') {
      return gatewayIP;
    }
  } catch (err) {
    // Fallback: try to get host.docker.internal IP
  }

  // Default fallback
  return 'localhost';
}
