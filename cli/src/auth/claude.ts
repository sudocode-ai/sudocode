/**
 * Claude Code interactive authentication command
 * 
 * Wraps the Claude CLI's OAuth flow and stores the resulting token securely
 */

import { spawn } from "child_process";
import * as readline from "readline";
import { setClaudeToken, hasClaudeToken } from "./credentials.js";
import chalk from "chalk";

/**
 * Options for Claude auth command
 */
export interface ClaudeAuthOptions {
  force?: boolean;
}

/**
 * Prompt user for confirmation
 * @param message Message to display
 * @returns true if user confirms (y/yes), false otherwise
 */
async function promptConfirmation(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise((resolve) => {
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

/**
 * Check if Claude CLI is installed
 * @returns Promise that resolves to true if installed, false otherwise
 */
async function checkClaudeCLI(): Promise<boolean> {
  return new Promise((resolve) => {
    const claudeCheck = spawn('claude', ['--version']);
    
    claudeCheck.on('error', (err: any) => {
      if (err.code === 'ENOENT') {
        resolve(false);
      } else {
        // Other errors still mean CLI exists but something else went wrong
        resolve(true);
      }
    });
    
    claudeCheck.on('close', (code) => {
      // If we got here, the command executed (even if it failed)
      resolve(true);
    });
  });
}

/**
 * Validate Claude token format
 * @param token Token to validate
 * @returns true if token format is valid
 */
function validateTokenFormat(token: string): boolean {
  return token.startsWith('sk-ant-');
}

/**
 * Extract Claude token from CLI output
 * Claude CLI outputs token in format: "Token: sk-ant-api03-..."
 * 
 * @param output Combined stdout/stderr output from Claude CLI
 * @returns Extracted token or null if not found
 */
function extractToken(output: string): string | null {
  const tokenMatch = output.match(/Token:\s*(sk-ant-[^\s]+)/);
  if (!tokenMatch) {
    return null;
  }
  
  const token = tokenMatch[1];
  
  // Validate token format
  if (!validateTokenFormat(token)) {
    return null;
  }
  
  return token;
}

/**
 * Run Claude CLI OAuth flow
 * @returns Promise that resolves to the extracted token
 */
async function runClaudeOAuthFlow(): Promise<string> {
  return new Promise((resolve, reject) => {
    let tokenOutput = '';
    
    console.log(chalk.blue('\nStarting OAuth flow...'));
    console.log(chalk.dim('(Claude CLI will open your browser for authentication)\n'));
    
    const claudeProcess = spawn('claude', ['setup-token'], {
      stdio: ['inherit', 'pipe', 'pipe']
    });
    
    // Capture stdout (also display to user)
    claudeProcess.stdout.on('data', (data) => {
      const output = data.toString();
      process.stdout.write(output);
      tokenOutput += output;
    });
    
    // Capture stderr (also display to user)
    claudeProcess.stderr.on('data', (data) => {
      const output = data.toString();
      process.stderr.write(output);
      tokenOutput += output;
    });
    
    // Handle process completion
    claudeProcess.on('close', (code) => {
      if (code !== 0) {
        reject(new Error('OAuth flow failed or was cancelled'));
        return;
      }
      
      // Extract token from output
      const token = extractToken(tokenOutput);
      if (!token) {
        reject(new Error('Failed to extract token from Claude CLI output'));
        return;
      }
      
      resolve(token);
    });
    
    // Handle spawn errors
    claudeProcess.on('error', (err) => {
      reject(new Error(`Failed to spawn Claude CLI: ${err.message}`));
    });
  });
}

/**
 * Handle Claude authentication command
 * Interactive command that wraps Claude CLI OAuth flow and stores token
 * 
 * @param options Command options
 */
export async function handleClaudeAuth(options: ClaudeAuthOptions = {}): Promise<void> {
  console.log(chalk.blue('\nClaude Code Authentication\n'));
  
  // Check if already authenticated
  if (!options.force && await hasClaudeToken()) {
    console.log(chalk.yellow('⚠ Claude Code is already configured.\n'));
    const confirmed = await promptConfirmation('Overwrite existing token? (y/N): ');
    
    if (!confirmed) {
      console.log('\nCancelled. No changes made.');
      return;
    }
    console.log('');
  }
  
  // Check if Claude CLI is installed
  console.log('Checking for Claude CLI...');
  const isInstalled = await checkClaudeCLI();
  
  if (!isInstalled) {
    console.error(chalk.red('✗ Error: claude CLI not found\n'));
    console.error('The Claude CLI is required for authentication.');
    console.error('Install: npm install -g @anthropic-ai/claude-cli\n');
    process.exit(1);
  }
  
  console.log(chalk.green('✓ Found Claude CLI\n'));
  
  try {
    // Run OAuth flow
    const token = await runClaudeOAuthFlow();
    
    // Store token
    await setClaudeToken(token);
    
    // Success message
    console.log(chalk.green('\n✓ Authentication successful'));
    console.log(chalk.green('✓ Token stored securely at ~/.config/sudocode/user_credentials.json\n'));
    console.log(chalk.dim('Run \'sudocode auth status\' to verify configuration.\n'));
    
  } catch (error: any) {
    // Handle different error types
    if (error.message.includes('cancelled')) {
      console.error(chalk.yellow('\n✗ OAuth flow was cancelled\n'));
      process.exit(1);
    }
    
    if (error.message.includes('extract token')) {
      console.error(chalk.red('\n✗ Failed to extract token from Claude CLI output\n'));
      console.error('This may indicate:');
      console.error('  • The OAuth flow didn\'t complete successfully');
      console.error('  • The Claude CLI version is incompatible');
      console.error('  • The token format has changed\n');
      console.error(chalk.dim('Please try again or report this issue.\n'));
      process.exit(1);
    }
    
    if (error.message.includes('permission')) {
      console.error(chalk.red('\n✗ Permission error\n'));
      console.error('Failed to write credentials file.');
      console.error('Ensure you have write permissions for:');
      console.error('  ~/.config/sudocode/user_credentials.json\n');
      process.exit(1);
    }
    
    // Generic error
    console.error(chalk.red(`\n✗ Authentication failed: ${error.message}\n`));
    process.exit(1);
  }
}
