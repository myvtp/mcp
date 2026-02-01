# @myvtp/mcp

MCP (Model Context Protocol) server for VTP - deploy apps via Claude Code.

## Installation

Add to your Claude Code configuration (`~/.claude.json`):

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

## Usage

Once configured, simply ask Claude Code to deploy your app:

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
