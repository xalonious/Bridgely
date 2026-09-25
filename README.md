# Bridgely

A Discord bot for verification, role synchronization, and Roblox group ranking.
Bridgely connects one Discord server to one Roblox group: members can link their
accounts, keep Discord roles and nicknames in sync, and manage individual Roblox
group roles through slash commands.

## Overview

Bridgely provides a guided setup flow for the group chosen by `ROBLOX_GROUP_ID`.
Members verify through a Roblox profile code or an optional Roblox game. Bridgely
then synchronizes Discord roles, binds, and nicknames with their Roblox state.
Verified members with Roblox ranking authority can add or remove group roles by
Roblox username or by mentioning another verified Discord member.

## Features

- Guided `/setup` wizard
- Roblox profile-code verification
- Optional verification by joining a Roblox game
- Automatic verified-role, group-role, and nickname synchronization
- Add or remove individual Roblox group roles with `/rank` and `/rank-user`
- Searchable rank suggestions filtered by the target's roles and the ranker's permissions
- Roblox permission checks on every rank change and optional success-only audit logging
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
ROBLOX_GROUP_ID="YOUR_ROBLOX_GROUP_ID"
```

Start the bot:

```bash
npm start
```

Commands are registered automatically in `SERVER_ID`. Once Bridgely is online,
run `/setup` in Discord. Bridgely fetches the group named by `ROBLOX_GROUP_ID`
and asks you to confirm it. Then run `/verifychannel` to post the verification
panel. Changing `ROBLOX_GROUP_ID` later requires running `/setup` again so saved
role mappings stay tied to the correct group.

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
| `ROBLOX_CLOUD_KEY` | Group-scoped Roblox Open Cloud key for complete multi-role synchronization and ranking |
| `ROBLOX_GROUP_ID` | Authoritative Roblox group ID, used by setup and ranking |
| `LOG_CHANNEL_ID` | Optional Discord channel for successful rank-change audit embeds |
| `GAME_VERIFICATION_ENABLED` | Set to `true` to enable game verification |
| `GAME_VERIFICATION_PORT` | Port used by the optional Express verification server |
| `GAME_VERIFICATION_API_KEY` | Bearer API key shared with the Roblox server script |
| `ROBLOX_VERIFICATION_GAME_URL` | Roblox game URL shown to members |
| `ROBLOX_VERIFICATION_PLACE_ID` | Optional alternative to the full game URL |

The game-verification variables are optional when
`GAME_VERIFICATION_ENABLED` is `false`.

The Roblox key needs the configured group resource with `group:read` and
`group:write` scopes. Its owner must have the Roblox permissions and hierarchy
needed to assign or remove roles.

## Ranking

`/rank add` and `/rank remove` target a Roblox username directly; the target
does not need a Bridgely account. `/rank-user add` and `/rank-user remove` use
Discord's member picker and require the target to be verified with Bridgely.
The person running either command must be verified with Bridgely.

Ranking authority comes from the executor's current Roblox group roles, not
their Discord roles. Bridgely checks Roblox permission and whether the specific
role is below the executor's highest role when the command runs. Rank suggestions
also reflect the target's current roles when available, but the command always
validates again before changing anything. Reading other roles' `changeRank`
permission metadata may require a group-owner key; if Roblox hides it, Bridgely
denies ranking rather than assuming access.

Ranking changes Roblox roles only. Use `/update` to synchronize a verified
member's Discord roles afterward. Set `LOG_CHANNEL_ID` to post audit embeds for
successful changes; a logging failure does not undo the rank change. Bridgely's
`VerifiedUser` collection is the sole Discord-to-Roblox identity source.

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
- `/verify` — connect a Discord account to Roblox
- `/getroles` — refresh your roles and nickname
- `/unlink` — unlink your Roblox account
- `/rank add username:<Roblox username> rank:<role>` — add a Roblox role by username
- `/rank remove username:<Roblox username> rank:<role>` — remove a Roblox role by username
- `/rank-user add user:<member> rank:<role>` — add a role to a Bridgely-verified member
- `/rank-user remove user:<member> rank:<role>` — remove a role from a Bridgely-verified member
- `/update user:<member>` — update another member as an administrator
- `/binds` — view, create, delete, or repair role binds
- `/help` — view command information
- `/ping` — view bot latency and uptime

## License

This project is licensed under the **MIT License**.
