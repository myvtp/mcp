import { z } from 'zod';

// Tool parameter schemas
export const DeploySchema = z.object({
  config: z.string().optional().describe('Path to vtp.yaml (default: ./vtp.yaml)'),
  force: z.boolean().optional().describe('Replace existing app with same name'),
});

export const GuideTypeSchema = z.object({
  type: z.string().describe('App type from list_app_types (e.g., "nextjs", "spa", "node")'),
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

export const DetectFrameworkSchema = z.object({
  path: z.string().optional().describe('Path to the project directory (default: current directory)'),
});

// Tool definitions for MCP
export const toolDefinitions = [
  {
    name: 'how_to_deploy',
    description: `Get the deployment workflow for VTP.

Call this FIRST when deploying an app. VTP is designed for AI agents to handle deployments - the user should not need to understand DevOps. This tool explains the required steps to ensure successful deployment.`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'list_app_types',
    description: `List supported app types for deployment.

Use this to see what frameworks VTP supports (Next.js, SvelteKit, Remix, Astro, Nuxt, Vite, Node.js, static).`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_deployment_guide',
    description: `Get the vtp.yaml template and deployment instructions for an app type.

Call this before deploying to get framework-specific configuration guidance.`,
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'App type from list_app_types (e.g., "nextjs", "spa", "node")',
        },
      },
      required: ['type'],
    },
  },
  {
    name: 'deploy',
    description: `Deploy a web app to VTP.

Deployment happens asynchronously - this tool returns immediately and the app builds server-side. Use get_deploy_status to monitor build progress.

For redeploying, the previous version stays live until the new build completes (zero-downtime blue-green deployment).

Prerequisites:
1. Call get_deployment_guide first
2. Call list to check if app already exists (redeploy needs force: true)

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

Use this if your app needs API keys - connections inject credentials automatically at runtime.`,
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

Use this to see what VTP will auto-detect before deploying.`,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the project directory (default: current directory)' },
      },
      required: [],
    },
  },
];
