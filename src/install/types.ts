/**
 * Type definitions for the install command
 */

export interface ClientConfig {
  /** Display name for the client */
  name: string;
  /** Unique identifier used in CLI args */
  id: string;
  /** Description shown in the installer */
  description: string;
  /** Config file paths per platform */
  paths: {
    darwin?: string;
    win32?: string;
    linux?: string;
  };
  /** Whether this is a project-level config (like VS Code) */
  projectLevel?: boolean;
  /** Restart instructions after configuration */
  restartInstructions: string;
}

export interface DetectedClient {
  /** Client definition */
  client: ClientConfig;
  /** Resolved config path for current platform */
  configPath: string;
  /** Whether the config file exists */
  configExists: boolean;
  /** Whether VTP is already configured */
  vtpConfigured: boolean;
  /** The existing config content (if readable) */
  existingConfig?: McpConfig;
}

export interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface McpConfig {
  mcpServers?: Record<string, McpServerConfig>;
  [key: string]: unknown;
}

export interface InstallOptions {
  /** Run without prompts, configure all detected clients */
  yes?: boolean;
  /** Force overwrite existing VTP config */
  force?: boolean;
  /** Specific clients to configure (by id) */
  clients?: string[];
}

export interface InstallResult {
  client: ClientConfig;
  success: boolean;
  action: 'created' | 'updated' | 'skipped' | 'error';
  message: string;
}
