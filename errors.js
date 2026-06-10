/**
 * Error Handling for stdout-setup
 *
 * Simplified version of the StdOut error framework for the installer.
 */

export const ERROR_CODES = {
  E1001: {
    code: 'E1001',
    userMessage: "The email address doesn't match this license key.",
    actions: [
      'Check your purchase confirmation email for the correct license key',
      'Verify you\'re using the same email address from your purchase',
      'Contact support@seayniclabs.com if you need help',
    ],
  },
  E1002: {
    code: 'E1002',
    userMessage: 'This license has expired.',
    actions: [
      'Contact support@seayniclabs.com to renew your license',
      'Check your account at https://store.seayniclabs.com for renewal options',
    ],
  },
  E1003: {
    code: 'E1003',
    userMessage: 'License server is unreachable. Check your internet connection.',
    actions: [
      'Verify your internet connection is working',
      'Check if stdout-licenses.fly.dev is accessible',
      'Wait a moment and try again',
    ],
  },
  E1004: {
    code: 'E1004',
    userMessage: 'License activation limit reached.',
    actions: [
      'You\'ve used all available activations for this license',
      'Deactivate StdOut on another machine to free up an activation slot',
      'Contact support@seayniclabs.com to increase your activation limit',
    ],
  },
  E2001: {
    code: 'E2001',
    userMessage: 'Docker is not running on this machine.',
    actions: [
      'Start Docker Desktop (macOS/Windows) or dockerd (Linux)',
      'Verify Docker is installed: docker --version',
      'Check Docker service status',
    ],
  },
  E2002: {
    code: 'E2002',
    userMessage: 'Failed to download container images. Check your internet connection.',
    actions: [
      'Verify your internet connection is working',
      'Check if ghcr.io is accessible',
      'Retry the installation',
    ],
  },
  E2003: {
    code: 'E2003',
    userMessage: 'Port 8112 is already in use by another application.',
    actions: [
      'Stop the application using port 8112',
      'Find what\'s using the port: lsof -i :8112 (macOS/Linux)',
      'Or, edit docker-compose.yml to use a different port',
    ],
  },
  E3001: {
    code: 'E3001',
    userMessage: 'Database initialization failed.',
    actions: [
      'Check disk space is available',
      'Verify the data directory is writable',
      'Retry the installation',
      'If persists, contact support@seayniclabs.com with error code E3001',
    ],
  },
  E4001: {
    code: 'E4001',
    userMessage: 'Invalid email address format.',
    actions: ['Enter a valid email address (e.g., user@example.com)'],
  },
  E4002: {
    code: 'E4002',
    userMessage: 'Password is too weak. Minimum 8 characters required.',
    actions: [
      'Use a password with at least 8 characters',
      'Include a mix of letters, numbers, and symbols for better security',
    ],
  },
};

export class InstallationError extends Error {
  constructor(code, context = {}) {
    const definition = ERROR_CODES[code];
    if (!definition) {
      super('An unexpected error occurred');
      this.code = 'E9999';
      this.actions = ['Contact support@seayniclabs.com with error code E9999'];
    } else {
      super(definition.userMessage);
      this.code = code;
      this.actions = definition.actions;
    }
    this.context = context;
    this.timestamp = new Date().toISOString();
  }

  toJSON() {
    return {
      type: 'error',
      code: this.code,
      error: this.message,
      actions: this.actions,
      context: this.context,
      timestamp: this.timestamp,
    };
  }
}

/**
 * Map raw API errors to error codes
 */
export function mapLicenseError(apiError) {
  if (apiError.includes('Email does not match')) {
    return new InstallationError('E1001');
  }
  if (apiError.includes('expired')) {
    return new InstallationError('E1002');
  }
  if (apiError.includes('activation limit')) {
    return new InstallationError('E1004');
  }
  if (apiError.includes('unreachable') || apiError.includes('timeout')) {
    return new InstallationError('E1003');
  }
  // Unknown license error
  return new InstallationError('E9999', { originalError: apiError });
}
