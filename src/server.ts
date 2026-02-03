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
import { DeploySchema, GetLogsSchema, GuideTypeSchema, toolDefinitions } from './tools.js';

const server = new Server(
  {
    name: 'vtp',
    version: '0.7.0',
  },
  {
    capabilities: {
      tools: {},
    },
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
          return {
            content: [{
              type: 'text',
              text: guide.content,
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
                    `  name: My App Name      # Display name\n` +
                    `  id: my-app             # Optional: URL slug\n` +
                    `  type: static           # or "node"\n` +
                    `  path: ./dist           # folder to deploy\n\n` +
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

        // Success
        const app = result.app!;
        const prefix = result.replaced ? 'Replaced' : 'Deployed';
        let responseText = `${prefix} ${app.name} (@${app.id})\n` +
                           `  URL: ${app.url}\n` +
                           `  Type: ${app.type}\n` +
                           `  Status: ${app.status}`;

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
                  `Environment variables are injected as: {PREFIX}_{FIELD} (e.g., OPENAI_API_KEY)`,
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
