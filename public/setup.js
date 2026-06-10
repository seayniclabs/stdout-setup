function showSplashScreen() {
  const splash = document.createElement('div');
  splash.id = 'splash-screen';
  splash.innerHTML = `
    <div class="installer-container">
      <div class="core-loader">
        <div class="ring ring-outer"></div>
        <div class="ring ring-inner"></div>
        <svg class="logo-center" width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="32" cy="32" r="28" fill="#0E0E18"/>
          <circle cx="32" cy="32" r="28" stroke="url(#stdout-ring)" stroke-width="2"/>
          <path d="M22 24L30 32L22 40" stroke="#FB923C" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M34 40H44" stroke="#FB923C" stroke-width="3" stroke-linecap="round"/>
          <defs>
            <linearGradient id="stdout-ring" x1="32" y1="4" x2="32" y2="60" gradientUnits="userSpaceOnUse">
              <stop stop-color="#FB923C"/>
              <stop offset="1" stop-color="#C2410C" stop-opacity="0.4"/>
            </linearGradient>
          </defs>
        </svg>
      </div>
      <h1>StdOut Installer</h1>
      <div class="status-text" id="status">Connecting to setup server...</div>
      <div class="progress-frame">
        <div class="progress-bar" id="progress"></div>
      </div>
      <div class="percentage" id="percent">0%</div>
      <div class="step-indicator" id="step">Step 0/8</div>
    </div>
  `;
  document.querySelector('.container').appendChild(splash);
}

function connectToInstallationStream() {
  const eventSource = new EventSource('/api/setup/stream');
  const progressBar = document.getElementById('progress');
  const percentText = document.getElementById('percent');
  const statusText = document.getElementById('status');
  const stepText = document.getElementById('step');

  eventSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log('[SSE]', data);

    switch (data.type) {
      case 'connected':
        statusText.textContent = 'Connected. Starting installation...';
        break;

      case 'step_start':
        statusText.textContent = data.name || 'Processing...';
        stepText.textContent = `Step ${data.step}/8: ${data.name}`;
        break;

      case 'step_complete':
        progressBar.style.width = `${data.progress}%`;
        percentText.textContent = `${data.progress}%`;
        break;

      case 'output':
        if (data.message) {
          statusText.textContent = data.message;
        }
        break;

      case 'error':
        renderError(data);
        eventSource.close();
        break;

      case 'complete':
        progressBar.style.width = '100%';
        percentText.textContent = '100%';
        statusText.style.color = '#00D4AA';
        statusText.textContent = 'Installation Complete! StdOut is ready.';
        stepText.textContent = 'Redirecting to your dashboard...';
        setTimeout(() => {
          window.location.href = data.url || 'http://stdout.local:8112';
        }, 2000);
        break;
    }
  };

  eventSource.onerror = (error) => {
    console.error('[SSE] Connection error:', error);
    statusText.style.color = '#ff4444';
    statusText.textContent = 'Connection lost. Please refresh the page.';
    eventSource.close();
  };
}

function renderError(errorData) {
  document.querySelector('.progress-frame').style.display = 'none';
  document.querySelector('.percentage').style.display = 'none';
  document.querySelector('.step-indicator').style.display = 'none';

  const container = document.querySelector('.installer-container');
  const errorPanel = document.createElement('div');
  errorPanel.className = 'error-panel';
  errorPanel.innerHTML = `
    <div class="error-icon">❌</div>
    <div class="error-content">
      <h2>Error ${errorData.code || 'Unknown'}</h2>
      <p class="error-message">${errorData.error || 'An unexpected error occurred'}</p>
      ${errorData.actions && errorData.actions.length > 0 ? `
        <div class="error-actions">
          <h3>What to try:</h3>
          <ol>
            ${errorData.actions.map(action => `<li>${action}</li>`).join('')}
          </ol>
        </div>
      ` : ''}
      <div class="error-support">
        <p>If you need help, contact support@seayniclabs.com with error code ${errorData.code || 'E9999'}</p>
      </div>
    </div>
  `;

  document.getElementById('status').remove();
  container.appendChild(errorPanel);
}

// Handle form submission
document.getElementById('setup-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const licenseKey = document.getElementById('license-key').value.trim();
  const adminEmail = document.getElementById('admin-email').value;
  const adminPassword = document.getElementById('admin-password').value;
  const environmentName = document.getElementById('environment-name').value;

  // Validate license key format
  if (!licenseKey.startsWith('SL-')) {
    alert('Invalid license key format. License keys must start with "SL-"');
    return;
  }

  // Validate password length
  if (adminPassword.length < 8) {
    alert('Password must be at least 8 characters');
    return;
  }

  // Hide form, show splash screen
  document.getElementById('setup-form').style.display = 'none';
  document.querySelector('.header').style.display = 'none';
  showSplashScreen();

  // Connect to SSE stream first
  connectToInstallationStream();

  // Start installation
  try {
    const response = await fetch('/api/setup/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey, adminEmail, adminPassword, environmentName }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to start installation');
    }
  } catch (error) {
    alert(error.message);
    // Show form again
    document.getElementById('setup-form').style.display = 'block';
    document.querySelector('.header').style.display = 'block';
    document.getElementById('splash-screen').remove();
  }
});
