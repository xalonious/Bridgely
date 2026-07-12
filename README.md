# Bridgely

A Discord-to-Roblox verification bot built for communities that connect one
Discord server to one Roblox group. Bridgely verifies members, synchronizes
their group roles and nickname, and supports custom role binds.

## Overview

Bridgely provides a guided setup flow for linking a Discord server to a Roblox
group. Members can verify through a Roblox profile code or an optional Roblox
game, after which their verified role, group roles, binds, and nickname are
updated automatically.

## Features

- Guided `/setup` wizard
- Roblox profile-code verification
- Optional verification by joining a Roblox game
- Automatic verified-role, group-role, and nickname synchronization
- Support for members holding multiple Roblox group ranks
- Group rank, badge, and game-pass role binds
- Automatic group-role integrity repair when Roblox roles change
- Role hierarchy checks, safe role reuse, and cleanup on unlink
- MongoDB-backed server settings, binds, and verified accounts

## Setup

Install dependencies:

```bash
npm install
```

Copy `.env.example` to `.env` and configure it:

```env
TOKEN="YOUR_DISCORD_BOT_TOKEN"
MONGOURL="YOUR_MONGODB_CONNECTION_STRING"
DEV_ID="YOUR_DISCORD_USER_ID"
SERVER_ID="YOUR_DISCORD_SERVER_ID"
ROBLOX_CLOUD_KEY="YOUR_GROUP_SCOPED_ROBLOX_OPEN_CLOUD_KEY"
```

Start the bot:

```bash
npm start
```

Commands are registered automatically in `SERVER_ID`. Once Bridgely is online,
run `/setup` in Discord and then `/verifychannel` to post the verification
panel.

The bot needs Manage Roles, Manage Nicknames, Send Messages, Embed Links, and
Use Application Commands. Its Discord role must be above every role it needs to
manage. Enable the Server Members Intent in the Discord Developer Portal.

## Environment variables

| Variable | Description |
| --- | --- |
| `TOKEN` | Discord bot token |
| `MONGOURL` | MongoDB connection string |
| `DEV_ID` | Discord user ID used for developer-only commands |
| `SERVER_ID` | Discord server where slash commands are registered |
| `ROBLOX_CLOUD_KEY` | Group-scoped Roblox Open Cloud key used for complete multi-rank synchronization |
| `GAME_VERIFICATION_ENABLED` | Set to `true` to enable game verification |
| `GAME_VERIFICATION_PORT` | Port used by the optional Express verification server |
| `GAME_VERIFICATION_API_KEY` | Bearer API key shared with the Roblox server script |
| `ROBLOX_VERIFICATION_GAME_URL` | Roblox game URL shown to members |
| `ROBLOX_VERIFICATION_PLACE_ID` | Optional alternative to the full game URL |

The game-verification variables are optional when
`GAME_VERIFICATION_ENABLED` is `false`.

## Game verification

To enable verification through a Roblox game:

```env
GAME_VERIFICATION_ENABLED="true"
GAME_VERIFICATION_PORT="1123"
GAME_VERIFICATION_API_KEY="YOUR_PRIVATE_API_KEY"
ROBLOX_VERIFICATION_GAME_URL="https://www.roblox.com/games/YOUR_PLACE_ID/YOUR-GAME"
```

Copy [`src/server/server.luau`](src/server/server.luau) into
`ServerScriptService`, configure its public API URL and matching API key, then
enable **HTTP Requests** under Roblox **Game Settings → Security**. The Express
port must be available through a public HTTPS reverse proxy.

Pending game-verification sessions are stored in memory and are cleared when
the bot restarts.

## Commands

- `/setup` — configure Bridgely for the server
- `/verifychannel [channel]` — post the verification panel
- `/binds` — view, create, delete, or repair role binds
- `/verify` — connect a Discord account to Roblox
- `/getroles` — refresh your roles and nickname
- `/unlink` — unlink your Roblox account
- `/update user:<member>` — update another member as an administrator
- `/help` — view command information
- `/ping` — view bot latency and uptime

## License

This project is licensed under the **MIT License**.
