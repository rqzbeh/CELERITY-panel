# MCP Integration User Guide

## What is MCP?

**Model Context Protocol (MCP)** is a protocol that allows AI assistants (Claude, Cursor, etc.) to directly interact with the C³ CELERITY panel. Through MCP, AI can:

- Manage VPN users (create, edit, disable)
- Configure servers and nodes
- Execute SSH commands on servers
- Retrieve statistics and logs
- Diagnose issues

## Requirements

- API key with `mcp:enabled` scope
- MCP-compatible AI client (Claude Desktop, Cursor IDE, or any HTTP client with SSE support)

## Creating an API Key

1. Open panel → **Settings** → **API Keys**
2. Click **Create MCP API Key**
3. Enter a key name (e.g., "Claude Assistant")
4. Select permissions:
   - Basic: `mcp:enabled` + read scopes (default)
   - Extended: `users:write`, `nodes:write`, `sync:write` — for write operations
5. Copy the key — it's shown only once

## Connecting AI Clients

### Claude Desktop

Add to your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "celerity": {
      "url": "https://your-panel.com/api/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

### Cursor IDE

Create a `.cursor/mcp.json` file in your project root:

```json
{
  "mcpServers": {
    "celerity": {
      "url": "https://your-panel.com/api/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

### Custom Client

Any HTTP client with SSE support can connect:

- **Endpoint**: `https://your-panel.com/api/mcp`
- **Auth**: `Authorization: Bearer YOUR_API_KEY`
- **Content-Type**: `application/json`
- **Accept**: `text/event-stream` (for streaming)

Example request:

```bash
curl -X POST https://your-panel.com/api/mcp \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{}}}'
```

## Available Tools

### query — Read Data

Universal tool for retrieving data from the panel.

| Resource | Description | Required scope |
|----------|-------------|----------------|
| `users` | List of users | `users:read` |
| `nodes` | List of servers | `nodes:read` |
| `groups` | Server groups | `stats:read` |
| `stats` | Traffic statistics | `stats:read` |
| `logs` | System logs | `stats:read` |

Parameters:
- `resource` (required) — resource type
- `id` — specific item ID
- `filter` — filters (resource-dependent)
- `limit`, `page` — pagination
- `sortBy`, `sortOrder` — sorting

**Example**: Get all active users

```json
{
  "name": "query",
  "arguments": {
    "resource": "users",
    "filter": { "enabled": true },
    "limit": 50
  }
}
```

### manage_user — User Management

Actions: `create`, `update`, `delete`, `enable`, `disable`, `reset_traffic`

Required scope: `users:write`

**Example**: Create a user

```json
{
  "name": "manage_user",
  "arguments": {
    "action": "create",
    "userId": "user123",
    "data": {
      "username": "John Doe",
      "trafficLimit": 107374182400,
      "maxDevices": 3,
      "groups": ["groupId1"]
    }
  }
}
```

### manage_node — Server Management

Actions: `create`, `update`, `delete`, `sync`, `setup`, `reset_status`, `update_config`

Required scope: `nodes:write`

**Example**: Setup node via SSH

```json
{
  "name": "manage_node",
  "arguments": {
    "action": "setup",
    "id": "nodeId123",
    "setupOptions": {
      "installHysteria": true,
      "setupPortHopping": true,
      "restartService": true
    }
  }
}
```

### manage_group — Group Management

Actions: `create`, `update`, `delete`

Required scope: `nodes:write`

### manage_cascade — Cascade Tunnels

Actions: `create`, `update`, `delete`, `deploy`, `undeploy`, `reconnect`

Required scope: `nodes:write`

### execute_ssh — Execute Commands

Executes a shell command on the server and returns the output.

Required scope: `nodes:write`

**Example**: Check service status

```json
{
  "name": "execute_ssh",
  "arguments": {
    "nodeId": "nodeId123",
    "command": "systemctl status hysteria-server"
  }
}
```

### ssh_session — Interactive SSH Session

Actions: `start`, `input`, `close`

Required scope: `nodes:write`

### system_action — System Operations

Actions: `sync_all`, `clear_cache`, `backup`, `kick_user`

Required scope: `sync:write`

### get_topology — Network Topology

Returns all active nodes and connections between them.

Required scope: `nodes:read`

### health_check — Health Check

Returns uptime, sync status, cache stats, memory usage.

No scope required.

## Built-in Prompts

Prompts are pre-configured scenarios that appear as slash commands in Claude Desktop (e.g., `/panel_overview`).

| Prompt | Description |
|--------|-------------|
| `panel_overview` | System overview: nodes, users, health |
| `audit_nodes` | Find problematic nodes and suggest fixes |
| `user_report` | Detailed report for a specific user |
| `setup_new_node` | Step-by-step node addition guide |
| `troubleshoot_node` | Node diagnostics via SSH |
| `manage_expired_users` | Find and handle expired users |

## Usage Examples

### "Show me the status of all servers"

AI will:
1. `health_check` — overall status
2. `query` with `resource=nodes` — list of nodes
3. Generate a report highlighting problematic nodes

### "Create user testuser with 50 GB limit"

AI will:
1. `manage_user` with `action=create`, `userId=testuser`, `trafficLimit=53687091200`

### "Why is node DE-01 not working?"

AI will:
1. `query` with `resource=nodes`, `id=<DE-01-id>` — get lastError
2. `execute_ssh` with command `systemctl status hysteria-server`
3. Analyze and suggest a solution

### "Set up new server 192.168.1.100"

AI will use the `setup_new_node` prompt and guide through all steps:
1. Collect data (IP, domain, SSH credentials)
2. Create node via `manage_node`
3. Run auto-setup via `manage_node action=setup`
4. Verify status

## Access Permissions (Scopes)

| Scope | Description |
|-------|-------------|
| `mcp:enabled` | Basic MCP access permission |
| `users:read` | Read users |
| `users:write` | Create, modify, delete users |
| `nodes:read` | Read servers and statistics |
| `nodes:write` | Manage servers, SSH commands |
| `stats:read` | Read statistics and logs |
| `sync:write` | Sync, backups, system operations |

## Security

- Store API keys in a secure location
- Use minimum required permissions
- Rotate keys periodically
- All MCP operations are logged in panel system logs

---

**Sources**: 
- `src/services/mcpService.js` — tool registry
- `src/routes/mcp.js` — MCP endpoints
- `src/mcp/prompts.js` — built-in prompts
- `src/locales/en.json` — MCP interface localization
