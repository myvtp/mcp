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

// Tool definitions for MCP
export const toolDefinitions = [
  {
    name: 'list_app_types',
    description: `List supported app types for deployment.

DEPLOYMENT WORKFLOW (all steps required):
1. list_app_types → identify your app type
2. get_deployment_guide → ALWAYS call this before deploy, even if vtp.yaml exists
3. list_supported_connections → if app uses API keys (OpenAI, Anthropic, TMDB, etc.)
4. list → check if app already exists (redeploy vs new)
5. Review files in deploy path, add 'ignore' to vtp.yaml for files not needed at runtime
6. deploy → deploy the app

After identifying the type, call get_deployment_guide to get the vtp.yaml template.

API KEYS: If the app uses third-party APIs (OpenAI, Anthropic, etc.), call list_supported_connections to see available services. Use 'connections' in vtp.yaml instead of hardcoding keys in 'env'.

MULTI-TENANCY: If the app needs per-user data or personalisation, also call get_deployment_guide with type="multi-tenancy" to learn about VTP's automatic user identity headers.`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_deployment_guide',
    description: `Get deployment instructions and vtp.yaml template for an app type.

MANDATORY: Call this before EVERY deployment - even if vtp.yaml already exists.
This ensures your configuration matches the latest requirements.

Returns a vtp.yaml template with 'predeploy' commands that automatically handle:
- Building the app (npm run build, etc.)
- Copying assets (for Next.js standalone, etc.)

CRITICAL FOR NODE APPS: Before creating vtp.yaml, check if the app uses SQLite or writes files:
- Look for: better-sqlite3, sql.js, sqlite3, prisma with SQLite, fs.writeFile to data files
- If found: You MUST add 'volumes' config AND update the app to use the volume path
- Without volumes, all data is lost on every redeployment

Copy the vtp.yaml template, adjust the app name, then call deploy.`,
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
    description: `PREREQUISITES (complete ALL before deploying):
1. Call get_deployment_guide to verify vtp.yaml config (even if it already exists)
2. Call list to check if this app already exists (redeploy vs new deployment)
3. Review files in deploy path - add 'ignore' to vtp.yaml for files not needed at runtime

Deploy a web app to VTP.

The vtp.yaml 'predeploy' commands run automatically before packaging.
You do NOT need to manually run build commands - predeploy handles it.

REQUIRED: vtp.yaml with:
  name: My App Name          # Display name (shown in dashboard)
  id: my-app                 # Optional: URL slug (auto-generated from name if omitted)
  description: Brief description of the app
  type: static|node
  path: ./dist
  predeploy: npm run build   # Runs automatically!
  ignore:                    # Exclude unnecessary files
    - node_modules           # ALWAYS exclude - reinstalled in container
    - src                    # Source files if deploying compiled output

NAME vs ID:
- name: Human-friendly display name (e.g., "My Budget Tracker")
- id: URL-safe identifier used for: https://{id}.{user}.myvtp.dev, container name, volumes
       If omitted, auto-generated from name: "My Budget Tracker" → "my-budget-tracker"
       Rules: lowercase, letters/numbers/hyphens only, max 63 chars

CRITICAL - FOR APPS WITH DATABASES OR FILE STORAGE:
You MUST add volumes or data will be lost on redeploy:
  volumes:
    data: /app/data
AND update the app code to write to the volume path (e.g., /app/data/app.db)

FILE EXCLUSION:
- .env files and .git are excluded automatically (security)
- .gitignore patterns are respected if the file exists
- Add 'ignore' in vtp.yaml for anything else not needed at runtime

API KEYS & SECRETS (OpenAI, Anthropic, TMDB, etc.):
Use 'connections' instead of hardcoding API keys in 'env':
  connections:
    - openai      # Injects OPENAI_API_KEY automatically
    - anthropic   # Injects ANTHROPIC_API_KEY automatically
    - tmdb        # Injects TMDB_API_KEY automatically

User must configure keys at https://home.myvtp.app/profile/connections before the app can start.
Call list_supported_connections to see all available services.

MULTI-TENANCY (automatic user identity):
VTP injects the authenticated user's identity into every request via headers:
- X-VTP-User: Unique user ID (use as database foreign key)
- X-VTP-Email: User's email address
- X-VTP-Slug: URL-safe username
- X-VTP-User-Name: Display name for UI
- X-VTP-Role: 'user' or 'admin'

To build multi-tenant apps, read these headers and use X-VTP-User as the owner key for all data.
No authentication code needed - VTP handles login automatically.

For detailed examples (Express, Next.js, Hono, database patterns), call get_deployment_guide with type="multi-tenancy".`,
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

Call this before deploying to check if the app already exists (redeploy requires force flag).`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'list_supported_connections',
    description: `List available third-party service connections that VTP apps can use.

This shows services like OpenAI, Anthropic, and Gemini that users can connect to their VTP account.
Apps declare required connections in vtp.yaml and receive credentials as environment variables at runtime.

Example vtp.yaml usage:
  connections:
    - openai
    - anthropic

The user must configure their API keys at https://home.myvtp.app/profile/connections before the app can start.

Returns: Service IDs, names, descriptions, required fields, and documentation URLs.`,
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_logs',
    description: `Get container logs for a deployed app.

Use this to debug issues with deployed apps. Returns the most recent log output from the app's container.

TROUBLESHOOTING WORKFLOW:
1. list → find the app ID
2. get_logs with the app ID → view recent logs
3. Analyse errors and suggest fixes

Examples of issues you can diagnose:
- App startup failures
- Runtime errors and exceptions
- Connection issues (database, API keys)
- Missing environment variables`,
    inputSchema: {
      type: 'object',
      properties: {
        app_id: { type: 'string', description: 'The app ID (use "list" to see deployed apps)' },
        lines: { type: 'number', description: 'Number of log lines to retrieve (default: 100, max: 1000)' },
      },
      required: ['app_id'],
    },
  },
];
