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

    // Redirect to cinematic splash screen
    window.location.href = '/splash.html';
  } catch (error) {
    alert(error.message);
  }
});
