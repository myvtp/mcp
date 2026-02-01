#!/usr/bin/env node
/**
 * VTP MCP Package Entry Point
 *
 * Routes to either the MCP server or the install command based on arguments:
 * - `npx myvtp-mcp` or `npx -y @myvtp/mcp` → runs the MCP server
 * - `npx myvtp-mcp install` → runs the installer
 */

const args = process.argv.slice(2);

if (args[0] === 'install') {
  // Run the install command
  import('./install/index.js').then(m => m.default(args.slice(1)));
} else {
  // Run the MCP server (default)
  import('./server.js');
}
