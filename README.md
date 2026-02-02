# @myvtp/mcp

MCP (Model Context Protocol) server for VTP - deploy apps via Claude Code.

## Quick Start

Run the installer to automatically configure your AI coding assistant:

```bash
npx @myvtp/mcp install
```

This will detect and configure any of the following clients:
- **Claude Desktop** - Anthropic's desktop app
- **Claude Code** - Anthropic's CLI tool
- **Cursor** - AI-powered code editor
- **VS Code** - Project-level MCP config
- **Windsurf** - Codeium's AI code editor
- **Project (.mcp.json)** - Generic project-level config

### Installer Options

```bash
npx @myvtp/mcp install              # Interactive mode
npx @myvtp/mcp install --yes        # Configure all detected clients
npx @myvtp/mcp install --yes claude-desktop  # Configure specific client
npx @myvtp/mcp install --force      # Overwrite existing VTP config
```

Press **Escape** or **Ctrl+C** to cancel the installer.

## Manual Installation

Add to your MCP configuration file:

```json
{
  "mcpServers": {
    "vtp": {
      "command": "npx",
      "args": ["-y", "@myvtp/mcp"]
    }
  }
}
```

### Config File Locations

| Client | Config Path |
|--------|-------------|
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| Claude Code | `~/.claude.json` |
| Cursor | `~/.cursor/mcp.json` |
| VS Code | `.vscode/mcp.json` (project-level) |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| Generic | `.mcp.json` (project-level) |

## Usage

Once configured, simply ask Claude to deploy your app:

```
Deploy this app to VTP
```

Claude will analyse your project, create the necessary configuration, and deploy it.

### Available Tools

| Tool | Description |
|------|-------------|
| `deploy` | Deploy an app from a vtp.yaml config |
| `list` | List all deployed apps |
| `list_app_types` | Show supported app types |
| `get_deployment_guide` | Get detailed deployment instructions |

## Configuration

The MCP server connects to the VTP API. By default it uses `https://api.myvtp.app`.

To use a different API URL (e.g., for local development):

```json
{
  "mcpServers": {
    "vtp": {
      "command": "npx",
      "args": ["-y", "@myvtp/mcp"],
      "env": {
        "VTP_API_URL": "https://api.myvtp.dev"
      }
    }
  }
}
```

## Authentication

On first use, the MCP server will open your browser for authentication. Your credentials are stored locally at `~/.vtp/credentials.json`.

## License

MIT
