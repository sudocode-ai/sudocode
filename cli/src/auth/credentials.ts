/**
 * Shared credentials module for extensible auth storage
 * 
 * Stores and retrieves authentication credentials for multiple AI services
 * in a secure, extensible manner.
 */

import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import * as os from "os";

/**
 * Get configuration directory path
 * Uses XDG_CONFIG_HOME if set, otherwise ~/.config/sudocode
 */
function getConfigDir(): string {
  return process.env.XDG_CONFIG_HOME
    ? path.join(process.env.XDG_CONFIG_HOME, "sudocode")
    : path.join(os.homedir(), ".config", "sudocode");
}

/**
 * Get credentials file path
 */
function getCredentialsFile(): string {
  return path.join(getConfigDir(), "user_credentials.json");
}

/**
 * Configuration directory path (exported for testing compatibility)
 * Note: This is evaluated at module load time. For tests that modify XDG_CONFIG_HOME,
 * use getCredentialsFilePath() instead which evaluates dynamically.
 */
export const CONFIG_DIR = getConfigDir();

/**
 * Credentials file path (exported for testing compatibility)
 * Note: This is evaluated at module load time. For tests that modify XDG_CONFIG_HOME,
 * use getCredentialsFilePath() instead which evaluates dynamically.
 */
export const CREDENTIALS_FILE = getCredentialsFile();

/**
 * Get credentials file path dynamically (for testing)
 * This evaluates the path each time it's called, respecting environment changes
 */
export function getCredentialsFilePath(): string {
  return getCredentialsFile();
}

/**
 * Credentials interface representing all supported credential types
 */
export interface Credentials {
  claudeToken: string | null;
  llmKey: string | null;
  litellmCredentials: any | null;
}

/**
 * Raw credentials storage format
 */
interface CredentialsStorage {
  claudeCodeOAuthToken?: string;
  llmKey?: string;
  litellmCredentials?: any;
}

/**
 * Ensure config directory exists with correct permissions (700)
 */
async function ensureConfigDir(): Promise<void> {
  const configDir = getConfigDir();
  try {
    await fs.mkdir(configDir, { recursive: true, mode: 0o700 });
    
    // Always check and fix permissions (mkdir with recursive doesn't throw if dir exists)
    const stats = await fs.stat(configDir);
    const mode = stats.mode & 0o777;
    if (mode !== 0o700) {
      console.warn(`Warning: Config directory has incorrect permissions (${mode.toString(8)}), fixing to 700`);
      await fs.chmod(configDir, 0o700);
    }
  } catch (error: any) {
    throw new Error(`Failed to create config directory: ${error.message}`);
  }
}

/**
 * Validate and auto-correct file permissions
 * @param filePath Path to the credentials file
 */
async function validateFilePermissions(filePath: string): Promise<void> {
  try {
    const stats = await fs.stat(filePath);
    const mode = stats.mode & 0o777;
    
    if (mode !== 0o600) {
      console.warn(`Warning: Credentials file has incorrect permissions (${mode.toString(8)}), fixing to 600`);
      await fs.chmod(filePath, 0o600);
    }
  } catch (error: any) {
    // File doesn't exist, that's okay
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

/**
 * Read credentials from storage
 * @returns Parsed credentials or empty object if file doesn't exist
 */
async function readCredentialsStorage(): Promise<CredentialsStorage> {
  const credentialsFile = getCredentialsFile();
  try {
    // Ensure directory exists
    await ensureConfigDir();
    
    // Validate file permissions if file exists
    await validateFilePermissions(credentialsFile);
    
    // Read file
    const content = await fs.readFile(credentialsFile, "utf-8");
    return JSON.parse(content) as CredentialsStorage;
  } catch (error: any) {
    // File doesn't exist
    if (error.code === 'ENOENT') {
      return {};
    }
    
    // Parse error
    if (error instanceof SyntaxError) {
      console.warn(`Warning: Failed to parse credentials file, returning empty credentials: ${error.message}`);
      return {};
    }
    
    // Permission or other error
    throw new Error(`Failed to read credentials: ${error.message}`);
  }
}

/**
 * Write credentials to storage with atomic write and secure permissions
 * @param credentials Credentials to write
 */
async function writeCredentialsStorage(credentials: CredentialsStorage): Promise<void> {
  const credentialsFile = getCredentialsFile();
  try {
    // Ensure directory exists
    await ensureConfigDir();
    
    // Write to temp file first (atomic write)
    const tempFile = `${credentialsFile}.tmp`;
    await fs.writeFile(tempFile, JSON.stringify(credentials, null, 2), {
      mode: 0o600,
    });
    
    // Atomic rename
    await fs.rename(tempFile, credentialsFile);
    
    // Ensure correct permissions (in case umask interfered)
    await fs.chmod(credentialsFile, 0o600);
  } catch (error: any) {
    throw new Error(`Failed to write credentials: ${error.message}`);
  }
}

/**
 * Retrieve all configured credentials
 * @returns Object with all credential types (null for unconfigured)
 */
export async function getAllCredentials(): Promise<Credentials> {
  const storage = await readCredentialsStorage();
  
  return {
    claudeToken: storage.claudeCodeOAuthToken || null,
    llmKey: storage.llmKey || null,
    litellmCredentials: storage.litellmCredentials || null,
  };
}

/**
 * Check if at least one credential is configured
 * Required for deployment - ensures some AI service is available
 * @returns true if any credential exists
 */
export async function hasAnyCredential(): Promise<boolean> {
  const creds = await getAllCredentials();
  return Object.values(creds).some(val => val !== null);
}

/**
 * Get count of configured credentials
 * @returns Number of configured credentials
 */
export async function getConfiguredCredentialCount(): Promise<number> {
  const creds = await getAllCredentials();
  return Object.values(creds).filter(val => val !== null).length;
}

/**
 * Get list of configured credential types
 * @returns Array of service names with configured credentials
 */
export async function getConfiguredCredentialTypes(): Promise<string[]> {
  const creds = await getAllCredentials();
  const types: string[] = [];
  
  if (creds.claudeToken) types.push('Claude Code');
  if (creds.llmKey) types.push('LLM Key');
  if (creds.litellmCredentials) types.push('LiteLLM');
  
  return types;
}

/**
 * Get Claude Code OAuth token
 * @returns Claude token or null if not configured
 */
export async function getClaudeToken(): Promise<string | null> {
  const creds = await getAllCredentials();
  return creds.claudeToken;
}

/**
 * Check if Claude Code token is configured
 * @returns true if Claude token exists
 */
export async function hasClaudeToken(): Promise<boolean> {
  const token = await getClaudeToken();
  return token !== null && token.length > 0;
}

/**
 * Get LLM API key (OpenAI/LiteLLM)
 * @returns LLM key or null if not configured
 */
export async function getLLMKey(): Promise<string | null> {
  const creds = await getAllCredentials();
  return creds.llmKey;
}

/**
 * Check if LLM key is configured
 * @returns true if LLM key exists
 */
export async function hasLLMKey(): Promise<boolean> {
  const key = await getLLMKey();
  return key !== null && key.length > 0;
}

/**
 * Get LiteLLM credentials
 * @returns LiteLLM credentials object or null if not configured
 */
export async function getLiteLLMCredentials(): Promise<any | null> {
  const creds = await getAllCredentials();
  return creds.litellmCredentials;
}

/**
 * Check if LiteLLM credentials are configured
 * @returns true if LiteLLM credentials exist
 */
export async function hasLiteLLMCredentials(): Promise<boolean> {
  const creds = await getLiteLLMCredentials();
  return creds !== null;
}

/**
 * Set Claude Code OAuth token
 * @param token Claude Code OAuth token
 */
export async function setClaudeToken(token: string): Promise<void> {
  if (!token || token.length === 0) {
    throw new Error('Token cannot be empty');
  }
  
  const storage = await readCredentialsStorage();
  storage.claudeCodeOAuthToken = token;
  await writeCredentialsStorage(storage);
}

/**
 * Clear all stored credentials
 * Removes the credentials file
 */
export async function clearAllCredentials(): Promise<void> {
  const credentialsFile = getCredentialsFile();
  try {
    await fs.unlink(credentialsFile);
  } catch (error: any) {
    // File doesn't exist, that's okay
    if (error.code !== 'ENOENT') {
      throw new Error(`Failed to clear credentials: ${error.message}`);
    }
  }
}
