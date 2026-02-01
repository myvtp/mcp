/**
 * Install command - configures VTP MCP server for AI coding clients
 */

import { checkbox, confirm } from '@inquirer/prompts';
import pc from 'picocolors';
import { detectAllClients, filterClients, getClientById } from './clients.js';
import { mergeVtpConfig, readConfig, writeConfig } from './config.js';
import { getVtpServerConfig, VTP_SERVER_NAME } from './constants.js';
import type { DetectedClient, InstallOptions, InstallResult } from './types.js';

type CancellablePromise<T> = Promise<T> & { cancel: () => void };

/**
 * Wrap a cancellable prompt to also cancel on Escape key
 */
function withEscapeCancel<T>(prompt: CancellablePromise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    // Set up escape key listener
    const onData = (data: Buffer) => {
      // Escape key is 0x1b (27) as a single byte
      if (data.length === 1 && data[0] === 0x1b) {
        prompt.cancel();
      }
    };

    process.stdin.on('data', onData);

    prompt
      .then(resolve)
      .catch(reject)
      .finally(() => {
        process.stdin.off('data', onData);
      });
  });
}

/**
 * Parse CLI arguments into install options
 */
function parseArgs(args: string[]): InstallOptions {
  const options: InstallOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--yes' || arg === '-y') {
      options.yes = true;
    } else if (arg === '--force' || arg === '-f') {
      options.force = true;
    } else if (!arg.startsWith('-')) {
      // Client ID
      if (!options.clients) {
        options.clients = [];
      }
      options.clients.push(arg);
    }
  }

  return options;
}

/**
 * Format client choice for the checkbox prompt
 */
function formatClientChoice(detected: DetectedClient): { name: string; value: string; checked: boolean } {
  const { client, configExists, vtpConfigured, configPath } = detected;

  let status = '';
  let checked = true;

  if (vtpConfigured) {
    status = pc.yellow(' (already configured)');
    checked = false;
  } else if (configExists) {
    status = pc.dim(' (will update config)');
  } else if (client.projectLevel) {
    status = pc.dim(` (will create ${configPath})`);
    checked = false; // Don't auto-select project-level configs
  } else {
    status = pc.dim(' (will create config)');
  }

  return {
    name: `${client.name}${status}`,
    value: client.id,
    checked,
  };
}

/**
 * Configure a single client
 */
function configureClient(detected: DetectedClient, force: boolean): InstallResult {
  const { client, configPath, vtpConfigured } = detected;

  // Skip if already configured and not forcing
  if (vtpConfigured && !force) {
    return {
      client,
      success: true,
      action: 'skipped',
      message: 'VTP already configured',
    };
  }

  try {
    const existingConfig = readConfig(configPath);
    const vtpConfig = getVtpServerConfig();
    const { config, action } = mergeVtpConfig(existingConfig, VTP_SERVER_NAME, vtpConfig, force);

    if (action === 'skipped') {
      return {
        client,
        success: true,
        action: 'skipped',
        message: 'VTP already configured',
      };
    }

    writeConfig(configPath, config);

    return {
      client,
      success: true,
      action,
      message: action === 'created' ? 'Created new config with VTP server' : 'Added VTP server to existing config',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      client,
      success: false,
      action: 'error',
      message,
    };
  }
}

/**
 * Print the results summary
 */
function printResults(results: InstallResult[]): void {
  console.log();

  const successResults = results.filter(r => r.success && r.action !== 'skipped');
  const skippedResults = results.filter(r => r.action === 'skipped');
  const errorResults = results.filter(r => !r.success);

  // Print successes
  for (const result of successResults) {
    console.log(`  ${pc.green('✓')} ${result.client.name}: ${result.message}`);
  }

  // Print skipped
  for (const result of skippedResults) {
    console.log(`  ${pc.yellow('○')} ${result.client.name}: ${result.message}`);
  }

  // Print errors
  for (const result of errorResults) {
    console.log(`  ${pc.red('✗')} ${result.client.name}: ${result.message}`);
  }

  // Print next steps if we configured anything
  if (successResults.length > 0) {
    console.log();
    console.log(pc.bold('  Next steps:'));

    const restartInstructions = [...new Set(successResults.map(r => r.client.restartInstructions))];
    restartInstructions.forEach((instruction, i) => {
      console.log(`  ${i + 1}. ${instruction}`);
    });

    console.log();
    console.log(pc.dim('  Once restarted, ask Claude to "deploy my app" to get started.'));
  }

  console.log();
}

/**
 * Main install command
 */
export default async function install(args: string[]): Promise<void> {
  const options = parseArgs(args);

  // Header
  console.log();
  console.log(pc.bold('  VTP MCP Server Setup'));
  console.log(pc.dim('  Configure AI coding assistants to use VTP for deployments'));
  console.log();

  // Detect available clients
  let detected = detectAllClients();

  if (detected.length === 0) {
    console.log(pc.yellow('  No supported AI clients detected.'));
    console.log();
    console.log('  Supported clients: Claude Desktop, Claude Code, Cursor, VS Code, Windsurf');
    console.log();
    return;
  }

  // Filter by specified clients if provided
  if (options.clients && options.clients.length > 0) {
    // Validate client IDs
    for (const id of options.clients) {
      if (!getClientById(id)) {
        console.log(pc.red(`  Unknown client: ${id}`));
        console.log();
        console.log('  Available clients: ' + detected.map(d => d.client.id).join(', '));
        console.log();
        return;
      }
    }

    detected = filterClients(detected, options.clients);
  }

  let selectedClients: DetectedClient[];

  if (options.yes) {
    // Non-interactive mode: select all (or filtered) clients
    selectedClients = detected;

    if (selectedClients.length === 0) {
      console.log(pc.yellow('  No clients to configure.'));
      console.log();
      return;
    }
  } else {
    // Interactive mode: show checkbox prompt
    const choices = detected.map(formatClientChoice);

    try {
      const checkboxPrompt = checkbox({
        message: 'Select AI clients to configure:',
        choices,
        pageSize: 10,
        required: true,
      }) as CancellablePromise<string[]>;

      const selectedIds = await withEscapeCancel(checkboxPrompt);

      if (selectedIds.length === 0) {
        console.log(pc.yellow('  No clients selected.'));
        console.log();
        return;
      }

      selectedClients = filterClients(detected, selectedIds);

      // Check for already-configured clients and confirm overwrite
      const alreadyConfigured = selectedClients.filter(c => c.vtpConfigured);
      if (alreadyConfigured.length > 0 && !options.force) {
        const names = alreadyConfigured.map(c => c.client.name).join(', ');
        const confirmPrompt = confirm({
          message: `${names} already have VTP configured. Overwrite?`,
          default: false,
        }) as CancellablePromise<boolean>;

        const shouldOverwrite = await withEscapeCancel(confirmPrompt);

        if (!shouldOverwrite) {
          selectedClients = selectedClients.filter(c => !c.vtpConfigured);
        } else {
          options.force = true;
        }
      }
    } catch {
      // User cancelled (Ctrl+C or Escape)
      console.log();
      return;
    }
  }

  // Configure selected clients
  const results: InstallResult[] = [];
  for (const detected of selectedClients) {
    const result = configureClient(detected, options.force || false);
    results.push(result);
  }

  // Print results
  printResults(results);
}
