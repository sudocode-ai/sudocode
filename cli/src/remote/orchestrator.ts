/**
 * SpawnOrchestrator - Main orchestration service for remote deployments
 * 
 * Coordinates the full deployment workflow:
 * 1. Check GitHub CLI authentication
 * 2. Detect git context
 * 3. Ensure Claude authentication
 * 4. Load and merge configuration
 * 5. Create sudopod provider
 * 6. Execute deployment with progress indicator
 */

import { execSync, exec } from 'child_process';
import chalk from 'chalk';
import type { 
  SpawnOptions, 
  GitInfo, 
  ServerConfig, 
  ProviderOptions 
} from './types.js';

// Re-export for convenience
export type { DeploymentInfo } from './types.js';
export type { SpawnOptions } from './types.js';

import type { DeploymentInfo } from './types.js';
import { GitContextDetector } from './git-context.js';
import { SpawnConfigManager } from './config.js';
import { ClaudeAuthIntegration } from './claude-auth.js';

/**
 * Main orchestrator for remote deployments
 */
export class SpawnOrchestrator {
  private configManager: SpawnConfigManager;
  private gitDetector: GitContextDetector;
  private authIntegration: ClaudeAuthIntegration;

  constructor(private sudocodeDir: string) {
    this.configManager = new SpawnConfigManager(sudocodeDir);
    this.gitDetector = new GitContextDetector();
    this.authIntegration = new ClaudeAuthIntegration();
  }

  /**
   * Open a URL in the default browser (platform-agnostic)
   * Fire and forget - doesn't block or throw errors
   */
  private openBrowser(url: string): void {
    const platform = process.platform;
    let command: string;

    if (platform === 'darwin') {
      command = `open "${url}"`;
    } else if (platform === 'win32') {
      command = `start "" "${url}"`;
    } else {
      // Linux and other Unix-like systems
      command = `xdg-open "${url}"`;
    }

    // Fire and forget - don't block on browser open
    exec(command, (error) => {
      if (error) {
        // Silently fail - browser open is nice-to-have, not critical
        console.log(chalk.gray(`  (Could not auto-open browser: ${error.message})`));
      }
    });
  }

  /**
   * Spawn to a remote provider (alias for deploy)
   * 
   * @param options Spawn options with optional overrides
   * @returns Deployment information
   * @throws Error if deployment fails or prerequisites are not met
   */
  async spawn(options: SpawnOptions & { provider?: 'codespaces' | 'coder' }): Promise<DeploymentInfo> {
    return this.deploy(options);
  }

  /**
   * Deploy to a remote provider
   * 
   * @param options Spawn options with optional overrides
   * @returns Deployment information
   * @throws Error if deployment fails or prerequisites are not met
   */
  async deploy(options: SpawnOptions): Promise<DeploymentInfo> {
    // 1. Check GitHub CLI authentication
    console.log(chalk.blue('Checking GitHub authentication...'));
    this.checkGitHubAuth();
    console.log(chalk.green('✓ GitHub authenticated\n'));

    // 2. Detect git context
    console.log(chalk.blue('Detecting git context...'));
    const gitContext = this.gitDetector.detectContext({
      owner: options.owner,
      repo: options.repo,
      branch: options.branch,
      remote: options.remote,
    });
    console.log(chalk.green(`✓ Detected: ${gitContext.owner}/${gitContext.repo} (${gitContext.branch})\n`));

    // 3. Ensure Claude authentication
    console.log(chalk.blue('Checking Claude authentication...'));
    const claudeToken = await this.authIntegration.ensureAuthenticated();
    if (!claudeToken) {
      throw new Error('Claude authentication failed - no token available');
    }
    console.log(chalk.green('✓ Claude authenticated'));
    console.log(chalk.gray(`  Token length: ${claudeToken.length} characters\n`));

    // 4. Load and merge configuration
    const providerConfig = this.configManager.getProviderConfig('codespaces');
    
    // Use defaults if provider config doesn't exist
    const defaults = SpawnConfigManager.getDefaults().providers.codespaces!;
    const config = providerConfig || defaults;

    const spawnConfig: {
      git: GitInfo;
      server: ServerConfig;
      providerOptions: ProviderOptions;
      dev?: boolean;
      agents?: {
        install: string[];
      };
      models?: {
        claudeLtt: string;
      };
      sudocode?: {
        mode: 'local' | 'npm';
        version: string;
      };
    } = {
      git: {
        owner: gitContext.owner,
        repo: gitContext.repo,
        branch: gitContext.branch,
      },
      server: {
        port: options.port ?? config.port,
        idleTimeout: options.idleTimeout ?? config.idleTimeout,
        keepAliveHours: options.keepAliveHours ?? config.keepAliveHours,
      },
      providerOptions: {
        machine: options.machine ?? config.machine,
        retentionPeriod: options.retentionPeriod ?? config.retentionPeriod,
      },
      dev: options.dev ?? false,
      agents: {
        install: ['claude'],
      },
      models: {
        claudeLtt: claudeToken,
      },
      sudocode: {
        mode: options.dev ? 'local' : 'npm',
        version: 'latest',
      },
    };

    // 5. Create sudopod provider
    const sudopod = await this.loadSudopod();
    const provider = sudopod.createProvider({ type: 'codespaces' });

    // 6. Execute deployment with progress indicator
    console.log(chalk.blue('Spawning to GitHub Codespaces...'));

    // Simple progress dots (no external dependency)
    const progressInterval = setInterval(() => {
      process.stdout.write('.');
    }, 500);

    try {
      const deployment = await provider.deploy(spawnConfig);

      clearInterval(progressInterval);
      console.log(); // New line after dots
      console.log(chalk.green('✓ Spawn complete'));

      // Open browsers (unless noOpen option is set)
      const noOpen = (options as any).noOpen;
      if (!noOpen) {
        if (deployment.urls?.workspace) {
          console.log(chalk.gray('Opening codespace in browser...'));
          this.openBrowser(deployment.urls.workspace);
        }
        
        // Wait 5 seconds before opening Sudocode UI to give codespace time to initialize
        if (deployment.urls?.sudocode) {
          console.log(chalk.gray('Opening Sudocode UI in 5 seconds...\n'));
          setTimeout(() => {
            this.openBrowser(deployment.urls.sudocode);
          }, 5000);
        }
      }

      return deployment;
    } catch (error) {
      clearInterval(progressInterval);
      console.log(); // New line after dots
      console.log(chalk.red('✗ Spawn failed'));
      throw error;
    }
  }

  /**
   * List all deployments for a provider
   * 
   * @param provider Provider name ('codespaces' or 'coder')
   * @returns List of deployments
   * @throws Error if provider not supported or listing fails
   */
  async list(provider: 'codespaces' | 'coder'): Promise<DeploymentInfo[]> {
    this.validateProvider(provider);
    
    const sudopod = await this.loadSudopod();
    const providerInstance = sudopod.createProvider({ type: provider });
    
    return await providerInstance.list();
  }

  /**
   * Get status of a specific deployment
   * 
   * @param provider Provider name ('codespaces' or 'coder')
   * @param id Deployment ID
   * @returns Deployment information
   * @throws Error if deployment not found
   */
  async status(provider: 'codespaces' | 'coder', id: string): Promise<DeploymentInfo> {
    this.validateProvider(provider);
    
    const sudopod = await this.loadSudopod();
    const providerInstance = sudopod.createProvider({ type: provider });
    
    return await providerInstance.getStatus(id);
  }

  /**
   * Stop and delete a deployment
   * 
   * @param provider Provider name ('codespaces' or 'coder')
   * @param id Deployment ID
   * @throws Error if deployment not found or stop fails
   */
  async stop(provider: 'codespaces' | 'coder', id: string): Promise<void> {
    this.validateProvider(provider);
    
    const sudopod = await this.loadSudopod();
    const providerInstance = sudopod.createProvider({ type: provider });
    
    await providerInstance.stop(id);
  }

  /**
   * Validate provider is supported
   * 
   * @param provider Provider name to validate
   * @throws Error if provider not supported
   */
  private validateProvider(provider: string): void {
    const supported = ['codespaces', 'coder'];
    if (!supported.includes(provider)) {
      throw new Error(
        `Unknown provider '${provider}'.\nSupported providers: ${supported.join(', ')}`
      );
    }
    
    if (provider === 'coder') {
      throw new Error(
        "Provider 'coder' is not yet supported.\nCurrently supported: codespaces"
      );
    }
  }

  /**
   * Check if GitHub CLI is authenticated
   * 
   * @throws Error if not authenticated
   */
  private checkGitHubAuth(): void {
    try {
      execSync('gh auth status', { stdio: 'ignore' });
    } catch {
      throw new Error(
        'GitHub CLI is not authenticated.\nRun: gh auth login'
      );
    }
  }

  /**
   * Load sudopod SDK dynamically
   * 
   * @returns sudopod module
   * @throws Error if sudopod is not installed
   */
  private async loadSudopod(): Promise<any> {
    try {
      const sudopod = await import('sudopod');
      return sudopod;
    } catch (error) {
      throw new Error(
        'sudopod SDK is not installed.\n' +
        'Install it with: npm install sudopod\n' +
        'Or install globally: npm install -g sudopod'
      );
    }
  }
}
