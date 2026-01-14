/**
 * Auth clear command - removes all stored credentials with confirmation
 */

import * as fs from "fs";
import * as readline from "readline";
import { getCredentialsFilePath, getConfiguredCredentialTypes } from "./credentials.js";
import chalk from "chalk";

/**
 * Options for auth clear command
 */
export interface ClearOptions {
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
 * Handle auth clear command
 * Removes all stored authentication credentials with user confirmation
 * 
 * @param options Command options
 */
export async function handleAuthClear(options: ClearOptions): Promise<void> {
  const credentialsFile = getCredentialsFilePath();
  
  // Check if credentials file exists
  if (!fs.existsSync(credentialsFile)) {
    console.log('No credentials configured. Nothing to clear.');
    return;
  }
  
  // Get configured types for display
  const configuredTypes = await getConfiguredCredentialTypes();
  
  if (configuredTypes.length === 0) {
    console.log('No credentials configured. Nothing to clear.');
    return;
  }
  
  // Force mode - skip confirmation
  if (options.force) {
    fs.unlinkSync(credentialsFile);
    console.log(chalk.green('✓ All credentials cleared'));
    console.log(chalk.dim(`✓ Removed ${credentialsFile}`));
    return;
  }
  
  // Interactive confirmation
  console.log(chalk.yellow('\n⚠ Warning: This will delete all stored authentication credentials.\n'));
  console.log('Current credentials:');
  
  configuredTypes.forEach(type => {
    console.log(`  • ${type} (configured)`);
  });
  
  console.log('');
  
  const confirmed = await promptConfirmation('Delete all credentials? (y/N): ');
  
  if (confirmed) {
    fs.unlinkSync(credentialsFile);
    console.log(chalk.green('\n✓ All credentials cleared'));
    console.log(chalk.dim(`✓ Removed ${credentialsFile}`));
  } else {
    console.log('\nCancelled. No changes made.');
  }
}
