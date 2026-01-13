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
 * Prompt user to paste their token
 * @returns Promise that resolves to the user-provided token
 */
async function promptForToken(): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise((resolve) => {
    rl.question(
      chalk.yellow('\nPlease paste your OAuth token from above: '),
      (answer) => {
        rl.close();
        resolve(answer.trim());
      }
    );
  });
}

/**
 * Run Claude CLI OAuth flow
 * @returns Promise that resolves to the user-provided token
 */
async function runClaudeOAuthFlow(): Promise<string> {
  return new Promise((resolve, reject) => {
    console.log(chalk.blue('\nStarting OAuth flow...'));
    console.log(chalk.dim('(Claude CLI will open your browser for authentication)\n'));
    
    // Run fully interactively - no output capture
    const claudeProcess = spawn('claude', ['setup-token'], {
      stdio: 'inherit'
    });
    
    // Handle process completion
    claudeProcess.on('close', async (code) => {
      if (code !== 0) {
        reject(new Error('OAuth flow failed or was cancelled'));
        return;
      }
      
      // Prompt user to paste the token
      console.log('\n' + chalk.blue('━'.repeat(60)));
      const token = await promptForToken();
      
      if (!token) {
        reject(new Error('No token provided'));
        return;
      }
      
      if (!validateTokenFormat(token)) {
        reject(new Error('Invalid token format. Token must start with "sk-ant-"'));
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
    
    if (error.message.includes('No token provided')) {
      console.error(chalk.red('\n✗ No token provided\n'));
      console.error('You must paste the OAuth token to complete authentication.\n');
      console.error(chalk.dim('Please try again.\n'));
      process.exit(1);
    }
    
    if (error.message.includes('Invalid token format')) {
      console.error(chalk.red('\n✗ Invalid token format\n'));
      console.error('The token must start with "sk-ant-".');
      console.error('Please ensure you copied the complete token.\n');
      console.error(chalk.dim('Please try again.\n'));
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
