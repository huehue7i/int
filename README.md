# Discord Moderation Bot

A comprehensive Discord moderation bot built with discord.js v14 that supports both slash commands and prefix commands.

## Features

- **Kick** - Remove users from the server with optional reason
- **Ban** - Permanently ban users with optional reason  
- **Mute** - Temporarily mute users with duration and reason
- **Unmute** - Remove mute from users
- **Warn** - Send warnings to users
- **Clear** - Bulk delete messages from channels
- **Lock/Unlock** - Lock channels to prevent sending messages
- **Viewlock/Viewunlock** - Lock channels to prevent viewing messages
- **Slowmode** - Control channel slowmode settings
- **Ping** - Check bot latency and response time
- **Server Info** - Display detailed server information
- **Avatar** - View user avatars in high quality
- **Emoji Management** - Add, remove, and list server emojis
- **AFK Tracking** - Users can set AFK status with automatic notifications and removal
- **Starboard** - Highlights best messages through star reactions with dedicated channel display
- **Custom Command Builder** - Create server-specific commands with text or embed responses
- **Reminder System** - Schedule reminders, events, and recurring notifications with flexible time formats
- **Permission system** - Role-based access control with authorized user override
- **Admin commands** - Dynamic management of authorized users

## Setup Instructions

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Create a Discord Application**
   - Go to https://discord.com/developers/applications
   - Click "New Application" and give it a name
   - Go to "Bot" section and create a bot
   - Copy the bot token

3. **Configure Environment**
   - Copy the bot token to `.env` file under `DISCORD_TOKEN`
   - Get your Client ID from the "General Information" tab
   - Get your Guild ID by right-clicking your server and "Copy Server ID"
   - **Optional:** Add authorized user IDs to `AUTHORIZED_USERS` (comma-separated)
     - To get user IDs: Enable Developer Mode in Discord → Right-click user → "Copy User ID"
     - Example: `AUTHORIZED_USERS=123456789012345678,987654321098765432`
   - Update the `.env` file with these values

4. **Bot Permissions**
   The bot needs these permissions:
   - Send Messages
   - Use Slash Commands
   - Manage Messages
   - Kick Members
   - Ban Members
   - Manage Roles
   - Manage Channels
   - Manage Emojis and Stickers
   - Read Message History
   - Attach Files
   - Add Reactions
   - Read Message History (for starboard)
   - Manage Channels (for starboard auto-setup)

5. **Invite Bot to Server**
   - Go to "OAuth2" > "URL Generator"
   - Select "bot" and "applications.commands" scopes
   - Select the required permissions
   - Use the generated URL to invite the bot

6. **Create Moderator Role**
   - Create a role called "Moderator" in your server
   - Assign this role to users who should have moderation permissions

7. **Run the Bot**
   ```bash
   npm start
   ```

## Commands

### Prefix Commands (using !)
- `!kick @user [reason]` - Kick a user
- `!ban @user [reason]` - Ban a user
- `!mute @user [duration] [reason]` - Mute a user (e.g., 10m, 1h, 2d)
- `!unmute @user` - Unmute a user
- `!warn @user [reason]` - Warn a user
- `!clear [amount]` - Delete messages (1-100)
- `!lock [#channel] [reason]` - Lock a channel
- `!unlock [#channel] [reason]` - Unlock a channel
- `!viewlock [#channel] [reason]` - Viewlock a channel
- `!viewunlock [#channel] [reason]` - Viewunlock a channel
- `!slowmode [seconds] [#channel]` - Set slowmode (0-21600 seconds)
- `!ping` - Check bot latency (available to all)
- `!serverinfo` - Show server information (available to all)
- `!avatar [@user]` - Show user avatar (available to all)
- `!afk [reason]` - Set AFK status (available to all)
- `!remindme [time] [message]` - Set a quick reminder (available to all)
- `!reminders` - View your active reminders (available to all)
- `!help` - Show available commands
- `![custom_command_name]` - Trigger any custom command created with `/custom create`

### Slash Commands
All commands are also available as slash commands with the same functionality.

### Admin Commands (Server Owner Only)
- `/admin list` - List all authorized users
- `/admin add @user` - Add user to authorized list
- `/admin remove @user` - Remove user from authorized list

### Emoji Commands (Moderators Only)
- `/emoji add [name] [url/attachment]` - Add emoji from URL or file
- `/emoji remove [emoji]` - Remove emoji from server
- `/emoji list` - List all server emojis

### AFK System (Available to All)
- `/afk [reason]` or `!afk [reason]` - Set AFK status
- **Automatic features:**
  - Users are notified when they mention someone who is AFK
  - AFK users receive DMs when they are mentioned with message links
  - AFK status is automatically removed when the user sends any message
  - Welcome back message shows how long they were AFK
  - DM summary of all missed mentions when returning

### Starboard System (Moderators Only)
- `/starboard auto-setup [name]` - **NEW!** Automatically create and configure starboard channel
- `/starboard setup [#channel]` - Set up starboard in specified channel
- `/starboard threshold [amount]` - Set number of stars required (1-20)
- `/starboard info` - Show current starboard configuration
- **How it works:**
  - Users react with ⭐ on messages to star them
  - Messages reaching the star threshold appear in the starboard channel
  - Users cannot star their own messages
  - Star count updates in real-time as reactions are added/removed
  - Messages are removed from starboard if stars fall below threshold
- **Auto-setup features:**
  - Creates starboard channel with proper permissions
  - Sets read-only for users (prevents spam)
  - Posts welcome message with instructions
  - Configures optimal settings automatically

### Custom Command Builder (Available to All)
- `/custom create [name] [response] [type]` - Create a new custom command
- `/custom edit [name] [response] [type]` - Edit an existing custom command
- `/custom delete [name]` - Delete a custom command
- `/custom list` - List all server custom commands
- `/custom info [name]` - Get detailed information about a command
- **Features:**
  - Create text or embed responses
  - Variable support: `{user}`, `{server}`, `{channel}`, `{date}`, `{time}`, etc.
  - Anyone can use created commands with `!commandname`
  - Commands are server-specific and persist across bot restarts
  - Built-in validation prevents conflicts with existing commands
- **Response Types:**
  - `text` - Simple text response with variables
  - `embed` - Fancy embed format (use `Title|Description` format)
- **Example Variables:**
  - `{user}` - Mentions the user who used the command
  - `{user.name}` - User's display name
  - `{server}` - Server name
  - `{channel}` - Current channel mention
  - `{date}` - Current date
  - `{time}` - Current time

### Reminder System (Available to All)
- `/reminder set [time] [message] [channel]` - Set a one-time reminder
- `/reminder event [time] [title] [description] [channel]` - Schedule an event announcement
- `/reminder recurring [time] [interval] [message] [max_occurrences] [channel]` - Set repeating reminders
- `/reminder list` - View all your active reminders
- `/reminder cancel [id]` - Cancel a specific reminder
- `/reminder info [id]` - Get detailed information about a reminder
- `!remindme [time] [message]` - Quick reminder via prefix command
- `!reminders` - View your reminders via prefix command
- **Features:**
  - Flexible time formats: relative (`10m`, `2h`, `1d`) or absolute (`2023-12-25 15:30`)
  - Reminders can be sent to any channel or via DM if channel unavailable
  - Recurring reminders with customizable intervals and max occurrences
  - Event reminders with special formatting and announcements
  - Automatic cleanup of expired reminders
  - Persistent across bot restarts (reminders are rescheduled on startup)
  - User-specific management (users can only see and cancel their own reminders)
- **Time Format Examples:**
  - `10m` - 10 minutes from now
  - `2h` - 2 hours from now
  - `1d` - 1 day from now
  - `1w` - 1 week from now
  - `2023-12-25 15:30` - Specific date and time
  - `Dec 25 2023 3:30 PM` - Alternative date format
- **Recurring Examples:**
  - Daily standup: `/reminder recurring 9:00 1d "Daily standup meeting!" 30`
  - Weekly reminder: `/reminder recurring 1h 1w "Submit weekly report"`
  - Hourly check: `/reminder recurring 5m 1h "Server health check" 24`

## Time Formats for Mute
- `10s` - 10 seconds
- `5m` - 5 minutes  
- `2h` - 2 hours
- `1d` - 1 day
- `1w` - 1 week

## Notes
- Users with the "Moderator" role can use moderation commands
- **Authorized users** (configured in .env) can use ALL commands regardless of roles
- **Server owner** can manage the authorized users list with `/admin` commands
- The bot automatically creates a "Muted" role if it doesn't exist
- All moderation actions are logged to the console
- Error handling is built-in for common issues

## Permission Hierarchy
1. **Server Owner** - Can use all commands + manage authorized users
2. **Authorized Users** - Can use all commands (configured in .env)
3. **Server Administrators** - Can use all moderation commands + starboard setup + custom command creation
4. **Moderator Role** - Can use moderation commands + starboard setup + custom command creation
5. **Regular Users** - Can use `!ping`, `!help`, `/ping`, `/afk`, reminders, custom commands, and star messages with ⭐
