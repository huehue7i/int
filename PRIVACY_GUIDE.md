# 🔒 Bot Privacy Setup Guide

This guide will help you configure your Discord bot to be private, restricting its usage to specific servers and users.

## 🎯 What is Private Mode?

When private mode is enabled, your bot will:
- ✅ Only respond to commands in authorized servers
- ✅ Only allow authorized users to use commands
- ✅ Automatically authorize server owners and administrators
- ✅ Show a clear "Access Denied" message to unauthorized users

## 🛠️ Setup Instructions

### Step 1: Configure Environment Variables

Edit your `.env` file and add/modify these settings:

```env
# Enable private mode
PRIVATE_MODE=true

# Add authorized user IDs (comma-separated)
# These users can use the bot in any authorized server
AUTHORIZED_USERS=123456789012345678,987654321098765432

# Add authorized server IDs (comma-separated)
# The bot will only work in these servers when private mode is enabled
AUTHORIZED_GUILDS=123456789012345678,987654321098765432
```

### Step 2: Get Required IDs

#### Get Your User ID:
1. Enable Developer Mode in Discord (Settings → Advanced → Developer Mode)
2. Right-click your username → Copy User ID

#### Get Server/Guild ID:
1. Right-click the server name → Copy Server ID
2. Or use the `!privacy info` command in the server

#### Get Other User IDs:
1. Right-click any user → Copy User ID

### Step 3: Update Configuration

**Example configuration:**
```env
PRIVATE_MODE=true
AUTHORIZED_USERS=123456789012345678,987654321098765432
AUTHORIZED_GUILDS=123456789012345678,987654321098765432,555666777888999000
```

### Step 4: Restart the Bot

After updating your `.env` file, restart the bot:
```bash
npm start
# or
node main.js
```

## 📋 Privacy Commands

Use these commands to manage privacy settings:

### Basic Commands
- `!privacy` or `!privacy status` - Show current privacy settings
- `!privacy info` - Show detailed information and server ID

### Server Owner Only
These commands help server owners get authorization information:
- Shows the server's Guild ID for adding to AUTHORIZED_GUILDS

## 🔧 How It Works

### Authorization Hierarchy
1. **Bot Owner** - Users in AUTHORIZED_USERS can use the bot anywhere
2. **Server Owner** - Automatically authorized in their own servers
3. **Administrators** - Users with Administrator permission are automatically authorized
4. **Server Authorization** - The server must be in AUTHORIZED_GUILDS list

### Example Scenarios

#### Scenario 1: Fully Private Bot
```env
PRIVATE_MODE=true
AUTHORIZED_USERS=123456789012345678  # Your user ID
AUTHORIZED_GUILDS=987654321098765432  # Your server ID
```
**Result:** Only you can use the bot, and only in your specified server.

#### Scenario 2: Multiple Servers
```env
PRIVATE_MODE=true
AUTHORIZED_USERS=123456789012345678,555666777888999000
AUTHORIZED_GUILDS=987654321098765432,111222333444555666,777888999000111222
```
**Result:** Two users can use the bot across three authorized servers.

#### Scenario 3: Public Bot (Default)
```env
PRIVATE_MODE=false
```
**Result:** Anyone can use the bot in any server where it's installed.

## 🛡️ Security Features

### Access Control
- ✅ Silent rejection of unauthorized users (no spam)
- ✅ Clear error messages for slash commands
- ✅ Automatic authorization for server owners and admins
- ✅ Easy management through environment variables

### Privacy Protection
- ✅ No data collection from unauthorized servers
- ✅ No response to unauthorized commands
- ✅ Server-specific authorization checks

## 🔍 Troubleshooting

### Bot Not Responding?
1. Check if `PRIVATE_MODE=true` in your `.env` file
2. Verify your server ID is in `AUTHORIZED_GUILDS`
3. Confirm your user ID is in `AUTHORIZED_USERS` or you're the server owner
4. Restart the bot after changing `.env` file

### Getting Server ID:
1. Use `!privacy info` command in the server
2. Right-click server name → Copy Server ID
3. Check bot logs when it joins a server

### Getting User ID:
1. Enable Developer Mode in Discord
2. Right-click your username → Copy User ID

## 📝 Environment Variable Examples

### Single User, Single Server
```env
PRIVATE_MODE=true
AUTHORIZED_USERS=123456789012345678
AUTHORIZED_GUILDS=987654321098765432
```

### Multiple Users, Multiple Servers
```env
PRIVATE_MODE=true
AUTHORIZED_USERS=123456789012345678,555666777888999000,111222333444555666
AUTHORIZED_GUILDS=987654321098765432,111222333444555666,777888999000111222
```

### Public Mode (Anyone Can Use)
```env
PRIVATE_MODE=false
# Other settings are ignored when private mode is disabled
```

## 🎮 Usage Examples

### Check Privacy Status
```
!privacy
```

### Get Server Information
```
!privacy info
```

### Example Response
```
🔒 Privacy Settings
Private Mode: ✅ Enabled
Server Status: ✅ Authorized

Use !privacy info for detailed information
```

---

## 📞 Support

If you need help setting up private mode:
1. Use the `!privacy` command to check current status
2. Use the `!privacy info` command to get your server's Guild ID
3. Make sure to restart the bot after updating environment variables
4. Check the console for any error messages

Your bot is now configured for private use! 🎉
