import { createReadStream, existsSync, chmodSync } from 'fs';
import { unlink, copyFile, readFile, writeFile, mkdir } from 'fs/promises';
import { tmpdir, homedir } from 'os';
import { join, dirname, resolve } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import FormData from 'form-data';
import { parse as parseYaml } from 'yaml';
import * as tar from 'tar';
import { getFilesToInclude } from './utils/ignoreFilter.js';

// Used for opening browser during auth flow
const execAsync = promisify(exec);

const API_BASE = process.env.VTP_API_URL || 'https://api.myvtp.app';
const CREDENTIALS_PATH = join(homedir(), '.vtp', 'credentials.json');

// Auth types
interface Credentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;  // Unix timestamp
}

interface DeviceFlowResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

// Types matching the API responses
export interface App {
  id: string;            // URL-safe identifier (e.g., "my-app")
  name: string;          // Display name (e.g., "My App")
  description?: string;
  type: string;
  status: string;
  url: string;
  containerId: string;
  createdAt: string;
  imageName: string;
}

export interface DeployResult {
  app?: App;
  replaced?: boolean;
  warning?: string;
  error?: string;
  message?: string;
  existingApp?: App;
}

export interface AppTypeInfo {
  type: string;
  displayName: string;
  description: string;
  aliases: string[];
  apiType: 'static' | 'node';
}

export interface DeploymentGuide extends AppTypeInfo {
  content: string;
}

export interface ConnectionField {
  name: string;
  label: string;
  type: 'secret' | 'text';
  required: boolean;
  placeholder?: string;
  helpText?: string;
}

export interface ConnectionService {
  id: string;
  name: string;
  description: string;
  envPrefix: string;
  docsUrl: string;
  fields: ConnectionField[];
}

/**
 * VTP configuration schema (v2) - minimal config with server-side builds.
 */
interface VTPConfig {
  name: string;
  id?: string;
  description?: string;
  framework?: string;
  build?: {
    command?: string;
    output?: string;
    node_version?: number;
  };
  start?: {
    command?: string;
    port?: number;
  };
  env?: string[];
  build_env?: string[];
  connections?: string[];
  volumes?: Record<string, string>;
  ignore?: string[];
}

// =============================================================================
// Authentication Functions
// =============================================================================

/**
 * Load credentials from disk.
 */
async function loadCredentials(): Promise<Credentials | null> {
  try {
    if (!existsSync(CREDENTIALS_PATH)) {
      return null;
    }
    const content = await readFile(CREDENTIALS_PATH, 'utf-8');
    return JSON.parse(content) as Credentials;
  } catch {
    return null;
  }
}

/**
 * Save credentials to disk with restricted permissions.
 */
async function saveCredentials(credentials: Credentials): Promise<void> {
  const dir = dirname(CREDENTIALS_PATH);
  await mkdir(dir, { recursive: true });
  await writeFile(CREDENTIALS_PATH, JSON.stringify(credentials, null, 2));
  // Set file permissions to 0600 (owner read/write only)
  chmodSync(CREDENTIALS_PATH, 0o600);
}

/**
 * Delete credentials from disk.
 */
async function deleteCredentials(): Promise<void> {
  try {
    await unlink(CREDENTIALS_PATH);
  } catch {
    // Ignore if file doesn't exist
  }
}

/**
 * Check if credentials are expired (with 5 minute buffer).
 */
function isTokenExpired(credentials: Credentials): boolean {
  const bufferMs = 5 * 60 * 1000; // 5 minutes
  return Date.now() >= (credentials.expiresAt - bufferMs);
}

/**
 * Refresh the access token using the refresh token.
 */
async function refreshAccessToken(refreshToken: string): Promise<Credentials | null> {
  try {
    const response = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as { accessToken: string };
    const expiresAt = Date.now() + (24 * 60 * 60 * 1000); // 24 hours

    return {
      accessToken: data.accessToken,
      refreshToken,
      expiresAt,
    };
  } catch {
    return null;
  }
}

/**
 * Start the device authorization flow.
 */
async function startDeviceFlow(): Promise<DeviceFlowResponse> {
  const response = await fetch(`${API_BASE}/auth/device/start`, {
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error('Failed to start device flow');
  }

  return response.json();
}

/**
 * Poll for device authorization completion.
 */
async function pollDeviceFlow(deviceCode: string): Promise<TokenResponse | 'pending' | 'denied' | 'expired'> {
  const response = await fetch(`${API_BASE}/auth/device/poll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_code: deviceCode }),
  });

  if (response.status === 428) {
    return 'pending';
  }

  if (response.status === 403) {
    return 'denied';
  }

  if (response.status === 410) {
    return 'expired';
  }

  if (!response.ok) {
    throw new Error('Device flow poll failed');
  }

  return response.json();
}

/**
 * Open a URL in the default browser.
 */
async function openBrowser(url: string): Promise<void> {
  const platform = process.platform;
  let cmd: string;

  if (platform === 'darwin') {
    cmd = `open "${url}"`;
  } else if (platform === 'win32') {
    cmd = `start "" "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }

  await execAsync(cmd);
}

/**
 * Perform device flow authentication.
 * Returns credentials on success, throws on failure.
 */
async function performDeviceFlow(): Promise<Credentials> {
  // Start the device flow
  const deviceFlow = await startDeviceFlow();

  // Notify user and open browser
  console.error(`\n┌─────────────────────────────────────────────────┐`);
  console.error(`│  VTP Authentication Required                    │`);
  console.error(`├─────────────────────────────────────────────────┤`);
  console.error(`│  Opening browser to complete authentication...  │`);
  console.error(`│                                                 │`);
  console.error(`│  If the browser doesn't open, visit:            │`);
  console.error(`│  ${deviceFlow.verification_uri.padEnd(41)}    │`);
  console.error(`│                                                 │`);
  console.error(`│  And enter code: ${deviceFlow.user_code.padEnd(28)}  │`);
  console.error(`└─────────────────────────────────────────────────┘\n`);

  // Open browser
  try {
    await openBrowser(deviceFlow.verification_uri_complete);
  } catch {
    // Browser failed to open, user will need to manually visit the URL
  }

  // Poll for completion
  const pollIntervalMs = deviceFlow.interval * 1000;
  const expiresAt = Date.now() + (deviceFlow.expires_in * 1000);

  while (Date.now() < expiresAt) {
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));

    const result = await pollDeviceFlow(deviceFlow.device_code);

    if (result === 'pending') {
      continue;
    }

    if (result === 'denied') {
      throw new Error('Authorization denied by user');
    }

    if (result === 'expired') {
      throw new Error('Device code expired. Please try again.');
    }

    // Success - we have tokens
    const credentials: Credentials = {
      accessToken: result.access_token,
      refreshToken: result.refresh_token,
      expiresAt: Date.now() + (result.expires_in * 1000),
    };

    // Save credentials
    await saveCredentials(credentials);

    console.error(`\n✓ Authentication successful!\n`);
    return credentials;
  }

  throw new Error('Device code expired. Please try again.');
}

/**
 * Ensure we have valid credentials.
 * Will refresh token if expired, or start device flow if no valid credentials.
 */
async function ensureAuthenticated(): Promise<string> {
  let credentials = await loadCredentials();

  // No credentials - need to authenticate
  if (!credentials) {
    credentials = await performDeviceFlow();
    return credentials.accessToken;
  }

  // Token expired - try to refresh
  if (isTokenExpired(credentials)) {
    const refreshed = await refreshAccessToken(credentials.refreshToken);

    if (refreshed) {
      await saveCredentials(refreshed);
      return refreshed.accessToken;
    }

    // Refresh failed - need to re-authenticate
    await deleteCredentials();
    credentials = await performDeviceFlow();
    return credentials.accessToken;
  }

  return credentials.accessToken;
}

// =============================================================================
// API Request Helper
// =============================================================================

/**
 * Generic HTTP request helper with authentication and connection error handling.
 */
async function apiRequest<T>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
  retried: boolean = false
): Promise<T> {
  const url = `${API_BASE}${path}`;

  // Get valid access token
  const accessToken = await ensureAuthenticated();

  try {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${accessToken}`,
    };

    if (body) {
      headers['Content-Type'] = 'application/json';
    }

    const options: RequestInit = {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    };

    const response = await fetch(url, options);

    // Handle 401 - token might have been invalidated, try re-auth once
    if (response.status === 401) {
      await deleteCredentials();
      if (!retried) {
        return apiRequest(method, path, body, true);
      }
      throw new Error('Authentication failed. Please check your credentials.');
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      throw new Error(error.message || error.error || `HTTP ${response.status}`);
    }

    return response.json();
  } catch (error) {
    // Handle connection errors
    if (error instanceof TypeError && error.message.includes('fetch failed')) {
      throw new Error(
        `Cannot connect to VTP API at ${API_BASE}. ` +
        `Make sure the API server is running (pnpm dev:api).`
      );
    }
    throw error;
  }
}

interface AppsResponse {
  owned: App[];
  shared: App[];
  installed: App[];
  subscribed: App[];
}

/**
 * List all deployed apps (owned by the current user).
 */
export async function listApps(): Promise<App[]> {
  const response = await apiRequest<AppsResponse>('GET', '/apps');
  // Return only owned apps for MCP (the user's deployed apps)
  return response.owned || [];
}

/**
 * List all supported app types.
 */
export async function listAppTypes(): Promise<AppTypeInfo[]> {
  const response = await apiRequest<{ guides: AppTypeInfo[] }>('GET', '/guides');
  return response.guides;
}

/**
 * Get deployment guide for a specific app type.
 */
export async function getDeploymentGuide(type: string): Promise<DeploymentGuide> {
  return apiRequest('GET', `/guides/${encodeURIComponent(type)}`);
}

/**
 * Get the deployment workflow guide.
 */
export async function getWorkflow(): Promise<string> {
  const response = await apiRequest<DeploymentGuide>('GET', '/guides/workflow');
  return response.content;
}

/**
 * Create a tar.gz archive of a directory.
 * Copies the config file (vtp.yaml) into the archive.
 * Respects .gitignore, vtp.yaml ignore patterns, and filters out sensitive files.
 * Returns the path to the temporary tar.gz file.
 */
async function createTarGz(
  sourcePath: string,
  configPath: string,
  ignorePatterns?: string[]
): Promise<string> {
  const tarPath = join(tmpdir(), `vtp-deploy-${Date.now()}.tar.gz`);
  const destVtpYaml = join(sourcePath, 'vtp.yaml');
  let copiedVtpYaml = false;

  // Copy vtp.yaml into source directory if not already there
  if (!existsSync(destVtpYaml)) {
    await copyFile(configPath, destVtpYaml);
    copiedVtpYaml = true;
  }

  try {
    // Get filtered list of files respecting vtp.yaml ignore, .gitignore, and security defaults
    const filesToInclude = await getFilesToInclude(sourcePath, ignorePatterns);

    // Always include vtp.yaml
    if (!filesToInclude.includes('vtp.yaml')) {
      filesToInclude.push('vtp.yaml');
    }

    // Create tar.gz archive with only the filtered files
    await tar.create(
      {
        gzip: true,
        file: tarPath,
        cwd: sourcePath,
      },
      filesToInclude
    );
  } finally {
    // Clean up the copied vtp.yaml
    if (copiedVtpYaml) {
      try {
        await unlink(destVtpYaml);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  return tarPath;
}

/**
 * Legacy v1 config fields that are no longer supported.
 */
const LEGACY_V1_FIELDS = ['type', 'path', 'predeploy'] as const;

/**
 * Deploy an app from a local directory.
 * Reads vtp.yaml for all config, creates tar.gz archive, and POSTs to the API.
 * Builds happen server-side - only v2 schema is supported.
 */
export async function deploy(
  configPath: string = './vtp.yaml',
  force: boolean = false
): Promise<DeployResult> {
  // Read and parse vtp.yaml
  const yamlContent = await readFile(configPath, 'utf-8');
  const config = parseYaml(yamlContent) as VTPConfig & Record<string, unknown>;

  // Validate required fields
  if (!config.name) {
    throw new Error('vtp.yaml: "name" is required');
  }

  // Reject legacy v1 config fields with helpful migration message
  const legacyFields = LEGACY_V1_FIELDS.filter(field => field in config);
  if (legacyFields.length > 0) {
    throw new Error(
      `vtp.yaml uses deprecated fields: ${legacyFields.join(', ')}. ` +
      `Migrate to v2 schema: remove 'type' and 'path' (auto-detected), ` +
      `remove 'predeploy' (builds happen server-side). ` +
      `See get_deployment_guide for examples.`
    );
  }

  // Resolve path relative to vtp.yaml location
  const configDir = dirname(resolve(configPath));

  // v2 schema - source root is the config directory
  // No predeploy - builds happen server-side
  const sourcePath = configDir;

  if (!existsSync(sourcePath)) {
    throw new Error(`Deploy path does not exist: ${sourcePath}`);
  }

  // Create tar.gz of the directory, including vtp.yaml
  const tarPath = await createTarGz(sourcePath, configPath, config.ignore);

  try {
    return await postDeploy(tarPath, config.name, force);
  } finally {
    // Clean up temp tar file
    await unlink(tarPath).catch(() => {});
  }
}

/**
 * POST to the /deploy endpoint with tar.gz archive.
 * Uses form-data's submit() method for proper streaming support.
 * Type is auto-detected server-side from the uploaded files.
 */
async function postDeploy(
  tarPath: string,
  name: string,
  force: boolean,
  retried: boolean = false
): Promise<DeployResult> {
  // Ensure we have valid authentication
  const accessToken = await ensureAuthenticated();

  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('archive', createReadStream(tarPath), {
      filename: 'app.tar.gz',
      contentType: 'application/gzip',
    });
    form.append('name', name);
    form.append('force', String(force));

    // Parse API_BASE URL
    const url = new URL(`${API_BASE}/deploy`);

    form.submit(
      {
        host: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        protocol: url.protocol as 'http:' | 'https:',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      },
      (err, res) => {
        if (err) {
          // Handle connection errors
          if (err.message.includes('ECONNREFUSED')) {
            reject(new Error(
              `Cannot connect to VTP API at ${API_BASE}. ` +
              `Make sure the API server is running (pnpm dev:api).`
            ));
            return;
          }
          reject(err);
          return;
        }

        // Handle 401 - try re-auth once
        if (res.statusCode === 401 && !retried) {
          deleteCredentials()
            .then(() => postDeploy(tarPath, name, force, true))
            .then(resolve)
            .catch(reject);
          return;
        }
        if (res.statusCode === 401) {
          reject(new Error('Authentication failed. Please check your credentials.'));
          return;
        }

        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error(`Invalid JSON response: ${body}`));
          }
        });
        res.on('error', reject);
      }
    );
  });
}

/**
 * List available connection services.
 */
export async function listConnectionServices(): Promise<ConnectionService[]> {
  const response = await apiRequest<{ services: ConnectionService[] }>('GET', '/connections/services');
  return response.services;
}

/**
 * Get the deployment config for an existing app.
 * Returns null if not found or error.
 */
export async function getAppConfig(appId: string): Promise<VTPConfig | null> {
  try {
    const response = await apiRequest<{ config: VTPConfig }>('GET', `/apps/${encodeURIComponent(appId)}/config`);
    return response.config;
  } catch {
    return null;
  }
}

/**
 * Get container logs for a deployed app.
 */
export async function getAppLogs(appId: string, lines?: number): Promise<string> {
  const params = lines ? `?lines=${lines}` : '';
  const response = await apiRequest<{ logs: string }>('GET', `/apps/${encodeURIComponent(appId)}/logs${params}`);
  return response.logs;
}

/**
 * Get the current status of an app, including logs if still deploying/building.
 */
export async function getAppStatus(appId: string): Promise<{ app: App; logs?: string }> {
  const app = await apiRequest<App>('GET', `/apps/${encodeURIComponent(appId)}`);
  // If still deploying/building, also fetch recent logs for progress info
  if (app.status === 'deploying' || app.status === 'building') {
    try {
      const logsResp = await apiRequest<{ logs: string }>('GET', `/apps/${encodeURIComponent(appId)}/logs?lines=20`);
      return { app, logs: logsResp.logs };
    } catch {
      // Logs may not be available yet if container hasn't started
      return { app };
    }
  }
  return { app };
}

/**
 * Framework detection result from the API.
 */
export interface DetectionResult {
  framework: string;
  confidence: 'high' | 'medium' | 'low';
  mode?: string;
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'bun';
  nodeVersion?: number;
  buildCommand?: string;
  outputDir?: string;
  startCommand?: string;
  defaultPort?: number;
  warnings?: string[];
}

export interface ValidationResult {
  valid: boolean;
  errors: Array<{ code: string; message: string; file?: string; suggestion?: string }>;
  warnings: Array<{ code: string; message: string; suggestion?: string }>;
}

export interface FrameworkDetectionResponse {
  detection: DetectionResult;
  validation: ValidationResult;
  vtpConfig: Record<string, unknown> | null;
  buildConfig: Record<string, unknown>;
}

/**
 * Detect framework from a local directory.
 * Uploads the source files to the API for server-side detection.
 */
export async function detectFramework(
  sourcePath: string = '.',
  ignorePatterns?: string[]
): Promise<FrameworkDetectionResponse> {
  const resolvedPath = resolve(sourcePath);

  if (!existsSync(resolvedPath)) {
    throw new Error(`Path does not exist: ${resolvedPath}`);
  }

  // Create tar.gz of the directory with source files
  const tarPath = join(tmpdir(), `vtp-detect-${Date.now()}.tar.gz`);

  try {
    // Get filtered list of files (excluding build outputs, node_modules, etc.)
    const filesToInclude = await getFilesToInclude(resolvedPath, ignorePatterns);

    // Create tar.gz archive with only the filtered files
    await tar.create(
      {
        gzip: true,
        file: tarPath,
        cwd: resolvedPath,
      },
      filesToInclude
    );

    // POST to /detect endpoint
    return await postDetect(tarPath);
  } finally {
    // Clean up temp tar file
    await unlink(tarPath).catch(() => {});
  }
}

/**
 * POST to the /detect endpoint with tar.gz archive.
 */
async function postDetect(
  tarPath: string,
  retried: boolean = false
): Promise<FrameworkDetectionResponse> {
  const accessToken = await ensureAuthenticated();

  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('archive', createReadStream(tarPath), {
      filename: 'source.tar.gz',
      contentType: 'application/gzip',
    });

    const url = new URL(`${API_BASE}/detect`);

    form.submit(
      {
        host: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        protocol: url.protocol as 'http:' | 'https:',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      },
      (err, res) => {
        if (err) {
          if (err.message.includes('ECONNREFUSED')) {
            reject(new Error(
              `Cannot connect to VTP API at ${API_BASE}. ` +
              `Make sure the API server is running (pnpm dev:api).`
            ));
            return;
          }
          reject(err);
          return;
        }

        if (res.statusCode === 401 && !retried) {
          deleteCredentials()
            .then(() => postDetect(tarPath, true))
            .then(resolve)
            .catch(reject);
          return;
        }
        if (res.statusCode === 401) {
          reject(new Error('Authentication failed. Please check your credentials.'));
          return;
        }

        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (res.statusCode !== 200) {
              reject(new Error(data.message || data.error || `HTTP ${res.statusCode}`));
              return;
            }
            resolve(data);
          } catch {
            reject(new Error(`Invalid JSON response: ${body}`));
          }
        });
        res.on('error', reject);
      }
    );
  });
}
