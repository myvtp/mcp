/**
 * VTP MCP Server - handles tool requests from AI assistants
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { existsSync } from 'fs';

import * as client from './client.js';
import { DeploySchema, GetLogsSchema, GetAppConfigSchema, GetDeployStatusSchema, GuideTypeSchema, DetectFrameworkSchema, GetAppReadmeSchema, UpdateAppReadmeSchema, toolDefinitions } from './tools.js';

const server = new Server(
  {
    name: 'vtp',
    version: '0.7.0',
  },
  {
    capabilities: {
      tools: {},
    },
    instructions: `VTP (Vibe Transfer Protocol) is a personal app hosting platform designed for AI agents to deploy web apps on behalf of users. Apps deploy as Docker containers accessible at {id}-{user}.myvtp.app.

YOUR RESPONSIBILITY AS THE AGENT:
You orchestrate the deployment process. The end user should not need to understand DevOps, infrastructure, or deployment details — that complexity is your job to handle. You must analyse the codebase, fix deployment blockers (host binding, port config, framework settings, missing lockfiles), and be confident the app will work before deploying. Always inform the user what you changed and why.

Every deployment is production — if the new version is broken, the app goes down. If volumes are misconfigured or removed, persistent data is gone permanently. Be confident, not hopeful. If you're unsure, investigate first.

Before deploying, run the app's build command locally (e.g. npm run build) and fix any errors. A passing local build is the minimum bar for confidence — never deploy code that does not build.

Monorepo/workspace projects are not currently supported. The app must be a standalone project with its own package.json and lockfile. If the user's app is inside a monorepo, it must be extracted into a standalone directory before deploying.

Unconfigured connections inject empty-string env vars — the app starts immediately and will error if it uses empty API keys without checking. When redeploying, always retrieve the existing config with \`get_app_config\` to preserve connections and volumes.

IMPORTANT: Call \`how_to_deploy\` to get the deployment workflow before deploying any app. Never guess or assume configuration — use the tools to get accurate, current information. Call \`detect_framework\` to validate the project. Call \`get_deployment_guide\` for framework-specific notes. If deployment fails, read logs with \`get_logs\`, fix the issue, and redeploy with \`force: true\`.`,
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: toolDefinitions,
}));

// Handle tool calls - all delegate to HTTP API via client
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'how_to_deploy': {
        const workflow = await client.getWorkflow();
        return {
          content: [{
            type: 'text',
            text: workflow,
          }],
        };
      }

      case 'list_app_types': {
        const types = await client.listAppTypes();

        const typeList = types
          .map(t => `- **${t.displayName}** (${t.type})\n  ${t.description}`)
          .join('\n');

        return {
          content: [{
            type: 'text',
            text: `Supported app types:\n\n${typeList}\n\n` +
                  `Use get_deployment_guide with a type to see detailed instructions.`,
          }],
        };
      }

      case 'get_deployment_guide': {
        const { type: guideType } = GuideTypeSchema.parse(args);

        try {
          const guide = await client.getDeploymentGuide(guideType);
          const vtpMdSection = `\n\n## App Documentation (vtp.md)\n\n` +
            `Create a \`vtp.md\` file in the project root (alongside vtp.yaml) before deploying. ` +
            `This becomes the app's readme in the marketplace — write it for non-technical users. ` +
            `Explain what the app does, why someone would want it, and how to use it. ` +
            `Avoid framework names, technical jargon, or developer setup steps.\n\n` +
            `You can update the readme after deployment using the \`update_app_readme\` tool.`;
          return {
            content: [{
              type: 'text',
              text: guide.content + vtpMdSection,
            }],
          };
        } catch (error) {
          if (error instanceof Error && error.message.includes('guide_not_found')) {
            const types = await client.listAppTypes();
            const available = types.map(t => t.type).join(', ');
            return {
              content: [{
                type: 'text',
                text: `Unknown app type: "${guideType}"\n\nAvailable types: ${available}`,
              }],
              isError: true,
            };
          }
          throw error;
        }
      }

      case 'deploy': {
        const { config, force } = DeploySchema.parse(args);
        const configPath = config || './vtp.yaml';

        // Validate config exists
        if (!existsSync(configPath)) {
          return {
            content: [{
              type: 'text',
              text: `Error: Config file not found: ${configPath}\n\n` +
                    `Create a vtp.yaml file with:\n` +
                    `  name: My App Name      # Display name (required)\n` +
                    `  description: Brief description of the app\n\n` +
                    `VTP auto-detects your framework and builds server-side.\n` +
                    `Use list_app_types and get_deployment_guide for help.`,
            }],
            isError: true,
          };
        }

        // Deploy via HTTP API
        const result = await client.deploy(configPath, force ?? false);

        // Handle conflict
        if (result.error === 'conflict') {
          const existingApp = result.existingApp;
          return {
            content: [{
              type: 'text',
              text: `App '${existingApp?.id}' already exists at ${existingApp?.url || 'unknown URL'}\n` +
                    `Name: ${existingApp?.name || 'unknown'}\n` +
                    `Status: ${existingApp?.status || 'unknown'}\n\n` +
                    `Use force: true to replace it.`,
            }],
          };
        }

        // Handle other errors
        if (result.error) {
          return {
            content: [{
              type: 'text',
              text: `Error: ${result.message || result.error}`,
            }],
            isError: true,
          };
        }

        // Success — deploy started asynchronously
        const app = result.app!;
        const action = result.replaced ? 'Redeploy' : 'Deploy';
        let responseText = `${action} started for ${app.name} (@${app.id})\n` +
                           `  URL: ${app.url} (available once build completes)\n` +
                           `  Type: ${app.type}\n` +
                           `  Status: ${app.status}\n\n` +
                           `The app is building server-side. Use get_deploy_status with app_id "${app.id}" to check progress.`;

        // Include warning if app wasn't started due to missing connections
        if (result.warning) {
          responseText += `\n\n⚠️ WARNING: ${result.warning}`;
        }

        return {
          content: [{
            type: 'text',
            text: responseText,
          }],
        };
      }

      case 'list': {
        const apps = await client.listApps();

        if (apps.length === 0) {
          return {
            content: [{
              type: 'text',
              text: 'No apps deployed yet.',
            }],
          };
        }

        const appList = apps
          .map(app => {
            const desc = app.description ? `\n  ${app.description}` : '';
            return `- ${app.name} (@${app.id}) - ${app.type} - ${app.status}${desc}\n  ${app.url}`;
          })
          .join('\n');

        return {
          content: [{
            type: 'text',
            text: `Deployed apps:\n${appList}`,
          }],
        };
      }

      case 'get_app_config': {
        const { app_id } = GetAppConfigSchema.parse(args);
        const config = await client.getAppConfig(app_id);

        if (!config) {
          return {
            content: [{
              type: 'text',
              text: `No config found for app '${app_id}'. The app may not exist or its container has been removed.`,
            }],
            isError: true,
          };
        }

        // Format config as YAML-like output for readability
        const formatValue = (v: unknown): string => {
          if (Array.isArray(v)) {
            return v.map(item => `\n  - ${item}`).join('');
          }
          if (typeof v === 'object' && v !== null) {
            return '\n' + Object.entries(v)
              .map(([k, val]) => `  ${k}: ${val}`)
              .join('\n');
          }
          return String(v);
        };

        const configLines = Object.entries(config)
          .filter(([_, v]) => v !== undefined && v !== null)
          .map(([k, v]) => `${k}: ${formatValue(v)}`)
          .join('\n');

        return {
          content: [{
            type: 'text',
            text: `Config for ${app_id}:\n\n\`\`\`yaml\n${configLines}\n\`\`\`\n\nUse this to recreate vtp.yaml for redeployment.`,
          }],
        };
      }

      case 'list_supported_connections': {
        const services = await client.listConnectionServices();

        const serviceList = services
          .map(service => {
            const requiredFields = service.fields
              .filter(f => f.required)
              .map(f => f.name)
              .join(', ');
            const optionalFields = service.fields
              .filter(f => !f.required)
              .map(f => f.name);
            const optionalText = optionalFields.length > 0
              ? `\n    Optional: ${optionalFields.join(', ')}`
              : '';

            return `- **${service.name}** (${service.id})\n` +
                   `    ${service.description}\n` +
                   `    Env prefix: ${service.envPrefix}_\n` +
                   `    Required: ${requiredFields}${optionalText}\n` +
                   `    Docs: ${service.docsUrl}`;
          })
          .join('\n\n');

        return {
          content: [{
            type: 'text',
            text: `Available connection services:\n\n${serviceList}\n\n` +
                  `**Usage in vtp.yaml:**\n` +
                  `\`\`\`yaml\n` +
                  `connections:\n` +
                  `  - openai\n` +
                  `  - anthropic\n` +
                  `\`\`\`\n\n` +
                  `The user must configure API keys at their VTP dashboard before deploying.\n` +
                  `Environment variables are injected as: {PREFIX}_{FIELD} (e.g., OPENAI_API_KEY)\n\n` +
                  `**If not yet configured:** The app starts with empty-string env vars. Ensure the code handles missing keys gracefully (check for empty strings before using API clients). When the user configures the connection, the container is automatically recreated with real credentials.`,
          }],
        };
      }

      case 'get_logs': {
        const { app_id, lines } = GetLogsSchema.parse(args);
        const logs = await client.getAppLogs(app_id, lines);

        if (!logs || logs.trim() === '') {
          return {
            content: [{
              type: 'text',
              text: `No logs available for app '${app_id}'. The app may not have produced any output yet.`,
            }],
          };
        }

        return {
          content: [{
            type: 'text',
            text: `Logs for ${app_id}:\n\n${logs}`,
          }],
        };
      }

      case 'get_deploy_status': {
        const { app_id } = GetDeployStatusSchema.parse(args);
        const statusResult = await client.getAppStatus(app_id);
        const statusApp = statusResult.app;

        let statusText: string;

        // If the most recent deploy failed, report it regardless of current container status.
        // The old version may still be running (rollback), so status='running' is misleading.
        if (statusApp.deployStatus === 'failed') {
          const errDetail = statusApp.lastDeployError
            ? `\n  Error: ${statusApp.lastDeployError}`
            : '';
          statusText = `Deploy failed for "${statusApp.name}" (@${statusApp.id}).${errDetail}\n\n` +
                       `The previous version is still running at ${statusApp.url}\n\n` +
                       `Use get_logs with app_id "${statusApp.id}" to see more details.`;
        } else if (statusApp.deployStatus === 'deploying' || statusApp.status === 'deploying' || statusApp.status === 'building') {
          statusText = `App "${statusApp.name}" (@${statusApp.id}) is building...\n` +
                       `  Status: ${statusApp.status}\n` +
                       `  URL: ${statusApp.url} (will be available once build completes)`;
          if (statusResult.logs) {
            statusText += `\n\nRecent build output:\n${statusResult.logs}`;
          }
          statusText += `\n\nCheck again in 30 seconds.`;
        } else {
          switch (statusApp.status) {
            case 'running': {
              statusText = `App "${statusApp.name}" (@${statusApp.id}) is running and healthy!\n` +
                           `  Status: running\n` +
                           `  URL: ${statusApp.url}`;
              break;
            }
            case 'error':
            case 'stopped': {
              statusText = `App "${statusApp.name}" (@${statusApp.id}) has issues.\n` +
                           `  Status: ${statusApp.status}\n` +
                           `  URL: ${statusApp.url}\n\n` +
                           `Use get_logs with app_id "${statusApp.id}" to see error details.`;
              break;
            }
            default: {
              statusText = `App "${statusApp.name}" (@${statusApp.id})\n` +
                           `  Status: ${statusApp.status}\n` +
                           `  URL: ${statusApp.url}`;
            }
          }
        }

        return {
          content: [{
            type: 'text',
            text: statusText,
          }],
        };
      }

      case 'detect_framework': {
        const { path: projectPath } = DetectFrameworkSchema.parse(args);
        const sourcePath = projectPath || '.';

        // Validate path exists
        if (!existsSync(sourcePath)) {
          return {
            content: [{
              type: 'text',
              text: `Error: Path does not exist: ${sourcePath}`,
            }],
            isError: true,
          };
        }

        // Detect framework via API
        const result = await client.detectFramework(sourcePath);

        // Format the response
        let responseText = `## Framework Detection Results\n\n`;
        responseText += `**Framework:** ${result.detection.framework}`;
        if (result.detection.mode) {
          responseText += ` (${result.detection.mode})`;
        }
        responseText += `\n**Confidence:** ${result.detection.confidence}\n`;
        responseText += `**Package Manager:** ${result.detection.packageManager}\n`;

        if (result.detection.nodeVersion) {
          responseText += `**Node Version:** ${result.detection.nodeVersion}\n`;
        }
        if (result.detection.buildCommand) {
          responseText += `**Build Command:** ${result.detection.buildCommand}\n`;
        }
        if (result.detection.outputDir) {
          responseText += `**Output Directory:** ${result.detection.outputDir}\n`;
        }
        if (result.detection.startCommand) {
          responseText += `**Start Command:** ${result.detection.startCommand}\n`;
        }
        if (result.detection.defaultPort) {
          responseText += `**Default Port:** ${result.detection.defaultPort}\n`;
        }

        // Validation results
        responseText += `\n## Validation\n\n`;
        responseText += `**Valid:** ${result.validation.valid ? 'Yes' : 'No'}\n`;

        if (result.validation.errors.length > 0) {
          responseText += `\n### Errors\n`;
          for (const err of result.validation.errors) {
            responseText += `- **${err.code}:** ${err.message}`;
            if (err.suggestion) {
              responseText += `\n  💡 ${err.suggestion}`;
            }
            responseText += `\n`;
          }
        }

        if (result.validation.warnings.length > 0) {
          responseText += `\n### Warnings\n`;
          for (const warn of result.validation.warnings) {
            responseText += `- **${warn.code}:** ${warn.message}`;
            if (warn.suggestion) {
              responseText += `\n  💡 ${warn.suggestion}`;
            }
            responseText += `\n`;
          }
        }

        // Detection warnings
        if (result.detection.warnings && result.detection.warnings.length > 0) {
          responseText += `\n### Detection Notes\n`;
          for (const warn of result.detection.warnings) {
            responseText += `- ${warn}\n`;
          }
        }

        // Existing vtp.yaml config
        if (result.vtpConfig) {
          responseText += `\n## Existing vtp.yaml\n\n`;
          responseText += `\`\`\`yaml\n${JSON.stringify(result.vtpConfig, null, 2)}\n\`\`\`\n`;
        }

        return {
          content: [{
            type: 'text',
            text: responseText,
          }],
        };
      }

      case 'get_app_readme': {
        const { app_id } = GetAppReadmeSchema.parse(args);
        const readme = await client.getAppReadme(app_id);

        if (!readme) {
          return {
            content: [{
              type: 'text',
              text: `No readme found for app '${app_id}'. You can add one using update_app_readme or by including a vtp.md file in the project root.`,
            }],
          };
        }

        return {
          content: [{
            type: 'text',
            text: readme,
          }],
        };
      }

      case 'update_app_readme': {
        const { app_id, content } = UpdateAppReadmeSchema.parse(args);
        await client.updateAppReadme(app_id, content);

        return {
          content: [{
            type: 'text',
            text: `Readme updated for app '${app_id}'.`,
          }],
        };
      }

      default:
        return {
          content: [{
            type: 'text',
            text: `Unknown tool: ${name}`,
          }],
          isError: true,
        };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{
        type: 'text',
        text: `Error: ${message}`,
      }],
      isError: true,
    };
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('VTP MCP server running on stdio');
}

main().catch(console.error);
