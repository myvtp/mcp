import { z } from 'zod';

// Tool parameter schemas
export const DeploySchema = z.object({
  config: z.string().optional().describe('Path to vtp.yaml (default: ./vtp.yaml)'),
  force: z.boolean().optional().describe('Replace existing app with same name'),
});

export const GuideTypeSchema = z.object({
  type: z.string().describe('App type from list_app_types (e.g., "node", "static", "multi-tenancy")'),
});

export const GetLogsSchema = z.object({
  app_id: z.string().describe('The app ID (use "list" to see deployed apps)'),
  lines: z.number().optional().describe('Number of log lines to retrieve (default: 100)'),
});

export const GetAppConfigSchema = z.object({
  app_id: z.string().describe('The app ID (use "list" to see deployed apps)'),
});

export const GetDeployStatusSchema = z.object({
  app_id: z.string().describe('The app ID to check deployment status for'),
});

export const GetAppReadmeSchema = z.object({
  app_id: z.string().describe('The app ID (use "list" to see deployed apps)'),
});

export const UpdateAppReadmeSchema = z.object({
  app_id: z.string().describe('The app ID (use "list" to see deployed apps)'),
  content: z.string().describe('Markdown content for the app readme'),
});

export const DetectFrameworkSchema = z.object({
  path: z.string().optional().describe('Path to the project directory (default: current directory)'),
});

// Tool definitions for MCP
export const toolDefinitions = [
  {
    name: 'how_to_deploy',
    description: `Get the deployment workflow for VTP.

Call this FIRST when deploying an app. You are responsible for analysing the user's code, fixing deployment issues (host binding, port configuration, lockfile generation, framework settings), and ensuring a successful deployment. Always inform the user of changes you make. This tool provides infrastructure details, vtp.yaml reference, and the agent's responsibilities.`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'list_app_types',
    description: `List supported app types for deployment.

Use this to see what frameworks VTP supports (Node.js, static).`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_deployment_guide',
    description: `Get framework-specific deployment configuration and notes.

Call this before deploying to get framework-specific configuration guidance.`,
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'App type from list_app_types (e.g., "node", "static", "multi-tenancy")',
        },
      },
      required: ['type'],
    },
  },
  {
    name: 'deploy',
    description: `Deploy a web app to VTP.

WARNING: Deployment is a production action. Redeployment replaces the running app. Ensure the code is correct and the configuration preserves existing connections and volumes before deploying.

Deployment happens asynchronously - this tool returns immediately and the app builds server-side. Use get_deploy_status to monitor build progress.

For redeploying, the previous version stays live until the new build completes (zero-downtime blue-green deployment).

Prerequisites:
1. Call detect_framework first and fix any validation errors or warnings
2. Call get_deployment_guide for framework-specific configuration
3. Run the build locally (e.g. npm run build) and fix any errors — never deploy code that has not built successfully
4. Create a vtp.md file in the project root (alongside vtp.yaml). This becomes the app's readme in the marketplace. Write it for non-technical users: explain what the app does, why someone would want it, and how to use it. No framework names, technical jargon, or setup instructions — just the value proposition and user-facing features. If vtp.md already exists, review and update it if the app has changed.
5. Call list to check if app already exists (redeploy needs force: true)
6. If redeploying, call get_app_config to preserve existing connections and volumes

VTP auto-detects frameworks and builds server-side. Often just \`name: My App\` in vtp.yaml is enough.`,
    inputSchema: {
      type: 'object',
      properties: {
        config: { type: 'string', description: 'Path to vtp.yaml (default: ./vtp.yaml)' },
        force: { type: 'boolean', description: 'Replace existing app with same id' },
      },
      required: [],
    },
  },
  {
    name: 'list',
    description: `List all deployed apps with their status and URLs.

Call before deploying to check if an app already exists.`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_app_config',
    description: `Get the deployment configuration for an existing app.

Use this when redeploying an app that exists but has no local vtp.yaml - retrieves the config used in the previous deployment (connections, volumes, etc.).`,
    inputSchema: {
      type: 'object',
      properties: {
        app_id: { type: 'string', description: 'The app ID (use "list" to see deployed apps)' },
      },
      required: ['app_id'],
    },
  },
  {
    name: 'list_supported_connections',
    description: `List available third-party API connections (OpenAI, Anthropic, etc.).

Call this during code analysis if the app imports any third-party SDK or references API keys. Cross-reference the app's package.json dependencies against available services. Connections inject encrypted credentials as environment variables at runtime — the user configures keys once in their VTP dashboard and reuses them across apps.`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_logs',
    description: `Get container logs for a deployed app.

Use this to debug startup failures, runtime errors, or connection issues.`,
    inputSchema: {
      type: 'object',
      properties: {
        app_id: { type: 'string', description: 'The app ID (use "list" to see deployed apps)' },
        lines: { type: 'number', description: 'Number of log lines to retrieve (default: 100, max: 1000)' },
      },
      required: ['app_id'],
    },
  },
  {
    name: 'get_deploy_status',
    description: `Check the current deployment status of an app.

Use this after deploying to monitor build progress. Returns the app's current status (deploying, building, running, error, etc.) and container logs if building/deploying.`,
    inputSchema: {
      type: 'object',
      properties: {
        app_id: { type: 'string', description: 'The app ID to check deployment status for' },
      },
      required: ['app_id'],
    },
  },
  {
    name: 'detect_framework',
    description: `Detect the framework and optimal deployment configuration for a project.

Use this to validate the project before deploying. If the project is inside a monorepo (NO_LOCKFILE warning, workspace: dependencies), inform the user that monorepo apps are not supported and the app must be extracted to a standalone project first.`,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the project directory (default: current directory)' },
      },
      required: [],
    },
  },
  {
    name: 'get_app_readme',
    description: `Get the readme/documentation for a deployed app.

Returns the app's markdown readme content, if one exists.`,
    inputSchema: {
      type: 'object',
      properties: {
        app_id: { type: 'string', description: 'The app ID (use "list" to see deployed apps)' },
      },
      required: ['app_id'],
    },
  },
  {
    name: 'update_app_readme',
    description: `Update the readme/documentation for a deployed app. Supports full markdown.

Use this to set or update an app's documentation. Max 50KB.`,
    inputSchema: {
      type: 'object',
      properties: {
        app_id: { type: 'string', description: 'The app ID (use "list" to see deployed apps)' },
        content: { type: 'string', description: 'Markdown content for the app readme' },
      },
      required: ['app_id', 'content'],
    },
  },
];
