/**
 * Client detection utilities
 */

import { existsSync } from 'fs';
import { CLIENTS, VTP_SERVER_NAME } from './constants.js';
import { isVtpConfigured, readConfig } from './config.js';
import type { ClientConfig, DetectedClient } from './types.js';

/**
 * Get the config path for a client on the current platform
 */
export function getConfigPath(client: ClientConfig): string | null {
  const platform = process.platform as 'darwin' | 'win32' | 'linux';
  return client.paths[platform] || null;
}

/**
 * Detect a single client's status
 */
export function detectClient(client: ClientConfig): DetectedClient | null {
  const configPath = getConfigPath(client);

  if (!configPath) {
    return null;
  }

  const configExists = existsSync(configPath);
  let existingConfig = null;
  let vtpConfigured = false;

  if (configExists) {
    try {
      existingConfig = readConfig(configPath);
      vtpConfigured = isVtpConfigured(existingConfig, VTP_SERVER_NAME);
    } catch {
      // Config exists but is invalid - we can still offer to fix it
      existingConfig = null;
    }
  }

  return {
    client,
    configPath,
    configExists,
    vtpConfigured,
    existingConfig: existingConfig || undefined,
  };
}

/**
 * Detect all available clients on the current system
 */
export function detectAllClients(): DetectedClient[] {
  const detected: DetectedClient[] = [];

  for (const client of CLIENTS) {
    const result = detectClient(client);
    if (result) {
      detected.push(result);
    }
  }

  return detected;
}

/**
 * Filter clients by ID
 */
export function filterClients(clients: DetectedClient[], ids: string[]): DetectedClient[] {
  return clients.filter(c => ids.includes(c.client.id));
}

/**
 * Get a client by ID
 */
export function getClientById(id: string): ClientConfig | undefined {
  return CLIENTS.find(c => c.id === id);
}
