const STEPS = [
  'Generate Configuration',
  'Pull Docker Images',
  'Start Containers',
  'Wait for Health Checks',
  'Initialize Database',
  'Create Admin Account',
  'Configure Environment',
  'Finalize Installation',
];

let eventSource = null;

// Handle form submission
document.getElementById('setup-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const adminEmail = document.getElementById('admin-email').value;
  const adminPassword = document.getElementById('admin-password').value;
  const environmentName = document.getElementById('environment-name').value;

  // Validate password length
  if (adminPassword.length < 8) {
    alert('Password must be at least 8 characters');
    return;
  }

  // Hide form, show progress
  document.getElementById('setup-form').style.display = 'none';
  document.getElementById('progress-view').style.display = 'block';

  // Start installation
  try {
    const response = await fetch('/api/setup/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminEmail, adminPassword, environmentName }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to start installation');
    }

    // Connect to SSE stream
    connectToStream();
  } catch (error) {
    showError(error.message);
  }
});

function connectToStream() {
  eventSource = new EventSource('/api/setup/stream');

  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log('[SSE]', data);

    switch (data.type) {
      case 'connected':
        console.log('SSE connection established');
        break;

      case 'step_start':
        updateStepStatus(data.step, 'active', data.name);
        updateProgress(data.progress);
        break;

      case 'step_complete':
        updateStepStatus(data.step, 'complete', data.name);
        updateProgress(data.progress);
        break;

      case 'output':
        appendConsoleOutput(data.message);
        break;

      case 'error':
        showError(data.error);
        break;

      case 'complete':
        showCompletion(data.url);
        break;
    }
  };

  eventSource.onerror = (error) => {
    console.error('[SSE] Connection error:', error);
    eventSource.close();
  };
}

function updateProgress(percent) {
  document.getElementById('progress').style.width = `${percent}%`;
  document.getElementById('progress-text').textContent = `${percent}%`;
}

function updateStepStatus(stepNumber, status, name) {
  const stepsContainer = document.getElementById('steps');

  // Initialize steps if empty
  if (!stepsContainer.children.length) {
    STEPS.forEach((stepName, i) => {
      const stepDiv = document.createElement('div');
      stepDiv.className = 'step';
      stepDiv.setAttribute('data-step', i + 1);

      const icon = document.createElement('span');
      icon.className = 'step-icon';
      icon.textContent = '⏸';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'step-name';
      nameSpan.textContent = stepName;

      stepDiv.appendChild(icon);
      stepDiv.appendChild(nameSpan);
      stepsContainer.appendChild(stepDiv);
    });
  }

  // Update specific step
  const stepEl = stepsContainer.querySelector(`[data-step="${stepNumber}"]`);
  if (!stepEl) return;

  stepEl.className = `step ${status}`;
  stepEl.querySelector('.step-icon').textContent = status === 'complete' ? '✓' : '⏳';
}

function appendConsoleOutput(message) {
  const consoleEl = document.getElementById('console');
  const line = document.createElement('div');
  line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  consoleEl.appendChild(line);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

function showCompletion(url) {
  document.getElementById('progress-view').style.display = 'none';
  document.getElementById('complete-view').style.display = 'block';

  // Update completion URL in case stdout.local doesn't resolve
  document.getElementById('completion-url').href = url;
  document.getElementById('completion-url').textContent = url;

  // Countdown redirect
  let countdown = 5;
  const countdownEl = document.getElementById('countdown');
  const interval = setInterval(() => {
    countdown--;
    countdownEl.textContent = countdown;
    if (countdown === 0) {
      clearInterval(interval);
      window.location.href = url;
    }
  }, 1000);
}

function showError(message) {
  document.getElementById('progress-view').style.display = 'none';
  document.getElementById('error-view').style.display = 'block';
  document.getElementById('error-message').textContent = message;
  if (eventSource) eventSource.close();
}
