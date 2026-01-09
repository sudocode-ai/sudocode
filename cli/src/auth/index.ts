/**
 * Auth module index - exports all authentication functionality
 * 
 * This module provides centralized exports for:
 * - Credential storage and retrieval
 * - Command handlers (interactive/non-interactive auth, status, clear)
 * - Utility functions (token validation, masking)
 */

// ============================================================================
// CORE CREDENTIALS MODULE
// ============================================================================

export {
  getAllCredentials,
  hasAnyCredential,
  getConfiguredCredentialCount,
  getConfiguredCredentialTypes,
  getClaudeToken,
  hasClaudeToken,
  setClaudeToken,
  clearAllCredentials,
  CONFIG_DIR,
  CREDENTIALS_FILE,
  getCredentialsFilePath,
  type Credentials,
} from './credentials.js';

// ============================================================================
// COMMAND HANDLERS
// ============================================================================

export { 
  handleClaudeAuth,
  type ClaudeAuthOptions 
} from './claude.js';

export { 
  showAuthStatus,
  type StatusOptions 
} from './status.js';

export { 
  handleAuthClear,
  type ClearOptions 
} from './clear.js';
