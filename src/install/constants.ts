/**
 * Constants and client definitions for the install command
 */

import { homedir } from 'os';
import { join } from 'path';
import type { ClientConfig, McpServerConfig } from './types.js';

/**
 * Supported MCP clients with their config locations
 */
export const CLIENTS: ClientConfig[] = [
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    description: 'Anthropic\'s desktop app for Claude',
    paths: {
      darwin: join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
      win32: join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json'),
      linux: join(homedir(), '.config', 'Claude', 'claude_desktop_config.json'),
    },
    restartInstructions: 'Quit and restart Claude Desktop',
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    description: 'Anthropic\'s CLI tool for Claude',
    paths: {
      darwin: join(homedir(), '.claude.json'),
      win32: join(homedir(), '.claude.json'),
      linux: join(homedir(), '.claude.json'),
    },
    restartInstructions: 'Start a new Claude Code session',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    description: 'AI-powered code editor',
    paths: {
      darwin: join(homedir(), '.cursor', 'mcp.json'),
      win32: join(homedir(), '.cursor', 'mcp.json'),
      linux: join(homedir(), '.cursor', 'mcp.json'),
    },
    restartInstructions: 'Restart Cursor',
  },
  {
    id: 'project',
    name: 'Project (.mcp.json)',
    description: 'Project-level config in current directory',
    paths: {
      darwin: join(process.cwd(), '.mcp.json'),
      win32: join(process.cwd(), '.mcp.json'),
      linux: join(process.cwd(), '.mcp.json'),
    },
    projectLevel: true,
    restartInstructions: 'Restart your AI coding assistant',
  },
  {
    id: 'vscode',
    name: 'VS Code',
    description: 'Project-level MCP config for VS Code',
    paths: {
      darwin: join(process.cwd(), '.vscode', 'mcp.json'),
      win32: join(process.cwd(), '.vscode', 'mcp.json'),
      linux: join(process.cwd(), '.vscode', 'mcp.json'),
    },
    projectLevel: true,
    restartInstructions: 'Reload VS Code window (Cmd/Ctrl+Shift+P → "Reload Window")',
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    description: 'Codeium\'s AI code editor',
    paths: {
      darwin: join(homedir(), '.codeium', 'windsurf', 'mcp_config.json'),
      win32: join(homedir(), '.codeium', 'windsurf', 'mcp_config.json'),
      linux: join(homedir(), '.codeium', 'windsurf', 'mcp_config.json'),
    },
    restartInstructions: 'Restart Windsurf',
  },
];

/**
 * The VTP MCP server configuration to inject
 */
export function getVtpServerConfig(): McpServerConfig {
  const isWindows = process.platform === 'win32';

  if (isWindows) {
    return {
      command: 'cmd',
      args: ['/c', 'npx', '-y', '@myvtp/mcp'],
    };
  }

  return {
    command: 'npx',
    args: ['-y', '@myvtp/mcp'],
  };
}

export const VTP_SERVER_NAME = 'vtp';
