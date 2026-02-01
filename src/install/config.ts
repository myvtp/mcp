/**
 * Configuration file reading and writing utilities
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import type { McpConfig, McpServerConfig } from './types.js';

/**
 * Read and parse a JSON config file
 * Returns null if file doesn't exist, throws on parse error
 */
export function readConfig(configPath: string): McpConfig | null {
  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    return JSON.parse(content) as McpConfig;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in ${configPath}: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Check if VTP is already configured in a config file
 */
export function isVtpConfigured(config: McpConfig | null, serverName: string): boolean {
  if (!config?.mcpServers) {
    return false;
  }
  return serverName in config.mcpServers;
}

/**
 * Merge VTP server config into existing config
 * Creates a new config if none exists
 * Preserves all existing servers and settings
 */
export function mergeVtpConfig(
  existingConfig: McpConfig | null,
  serverName: string,
  serverConfig: McpServerConfig,
  force: boolean = false
): { config: McpConfig; action: 'created' | 'updated' | 'skipped' } {
  const config: McpConfig = existingConfig ? { ...existingConfig } : {};

  // Ensure mcpServers exists
  if (!config.mcpServers) {
    config.mcpServers = {};
  }

  // Check if already configured
  const alreadyConfigured = serverName in config.mcpServers;

  if (alreadyConfigured && !force) {
    return { config, action: 'skipped' };
  }

  // Add or update VTP server
  config.mcpServers = {
    ...config.mcpServers,
    [serverName]: serverConfig,
  };

  const action = existingConfig === null ? 'created' : 'updated';
  return { config, action };
}

/**
 * Write config to file, creating directories as needed
 */
export function writeConfig(configPath: string, config: McpConfig): void {
  const dir = dirname(configPath);

  // Create directory if it doesn't exist
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const content = JSON.stringify(config, null, 2);
  writeFileSync(configPath, content + '\n', 'utf-8');
}
