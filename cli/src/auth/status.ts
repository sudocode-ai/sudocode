/**
 * Auth status command - displays all configured credentials with masked values
 */

import { getAllCredentials } from './credentials.js';
import chalk from 'chalk';

/**
 * Options for auth status command
 */
export interface StatusOptions {
  json?: boolean;
}

/**
 * Mask a token for display
 * Shows first 15 characters and last 3 characters, masks the rest
 * 
 * @param token Token to mask
 * @returns Masked token string
 */
function maskToken(token: string): string {
  if (!token) return '';
  
  if (token.length < 20) {
    // Too short to safely mask - just show first few chars
    return token.substring(0, Math.min(5, token.length)) + '***';
  }
  
  const start = token.substring(0, 15);
  const end = token.substring(token.length - 3);
  const masked = '*'.repeat(Math.max(0, token.length - 18));
  return `${start}${masked}${end}`;
}

/**
 * Handle auth status command
 * Displays all configured credentials with masked values and deployment readiness
 * 
 * @param options Command options
 */
export async function showAuthStatus(options: StatusOptions = {}): Promise<void> {
  const credentials = await getAllCredentials();
  let configuredCount = 0;
  
  // JSON output
  if (options.json) {
    const configured: string[] = [];
    const credentialsOutput: Record<string, any> = {};
    
    if (credentials.claudeToken) {
      configured.push('claude');
      credentialsOutput.claude = {
        configured: true,
        masked: maskToken(credentials.claudeToken)
      };
    } else {
      credentialsOutput.claude = {
        configured: false
      };
    }
    
    if (credentials.llmKey) {
      configured.push('llm');
      credentialsOutput.llm = {
        configured: true,
        masked: maskToken(credentials.llmKey)
      };
    } else {
      credentialsOutput.llm = {
        configured: false
      };
    }
    
    if (credentials.litellmCredentials) {
      configured.push('litellm');
      credentialsOutput.litellm = {
        configured: true,
        masked: maskToken(credentials.litellmCredentials.api_key || '')
      };
    } else {
      credentialsOutput.litellm = {
        configured: false
      };
    }
    
    const output = {
      configured,
      available: ['claude', 'llm', 'litellm'],
      ready: configured.length > 0,
      storage: '~/.config/sudocode/user_credentials.json',
      credentials: credentialsOutput
    };
    
    console.log(JSON.stringify(output, null, 2));
    return;
  }
  
  // Human-readable output
  console.log('\nAuthentication Status:\n');
  
  // Claude Code
  if (credentials.claudeToken) {
    configuredCount++;
    console.log(chalk.green('Claude Code: ✓ Configured'));
    console.log(`  Token: ${maskToken(credentials.claudeToken)}`);
  } else {
    console.log(chalk.yellow('Claude Code: ✗ Not configured'));
    console.log(chalk.dim('  Run: sudocode auth claude'));
  }
  console.log('');
  
  // LLM Key (future)
  if (credentials.llmKey) {
    configuredCount++;
    console.log(chalk.green('LLM Key: ✓ Configured'));
    console.log(`  Key: ${maskToken(credentials.llmKey)}`);
  } else {
    console.log(chalk.yellow('LLM Key: ✗ Not configured'));
    console.log(chalk.dim('  Run: sudocode auth llm --key <key> (coming soon)'));
  }
  console.log('');
  
  // LiteLLM (future)
  if (credentials.litellmCredentials) {
    configuredCount++;
    console.log(chalk.green('LiteLLM: ✓ Configured'));
    console.log(`  API Base: ${credentials.litellmCredentials.api_base}`);
    console.log(`  API Key: ${maskToken(credentials.litellmCredentials.api_key)}`);
  } else {
    console.log(chalk.yellow('LiteLLM: ✗ Not configured'));
    console.log(chalk.dim('  Run: sudocode auth litellm (coming soon)'));
  }
  console.log('');
  
  // Summary
  console.log('━'.repeat(44));
  console.log(`Configured: ${configuredCount}/3 services`);
  console.log(`Storage: ~/.config/sudocode/user_credentials.json`);
  
  if (configuredCount === 0) {
    console.log(chalk.yellow('\n⚠ No credentials configured. Remote deployment unavailable.'));
  } else {
    console.log(chalk.green('\n✓ Ready for remote deployment'));
  }
  console.log('');
}
