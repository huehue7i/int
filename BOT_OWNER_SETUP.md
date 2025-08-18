# Bot Owner Setup Guide

## Overview
The bot now includes a **Bot Owner** permission level that has the highest authority, above even server owners. Bot owners can manage the bot across all servers and have access to all commands.

## Permission Hierarchy
1. **Bot Owners** - Ultimate authority, can use all commands on any server
2. **Server Owners** - Limited admin access to their own server
3. **Authorized Users** - Emergency commands (antidoxx/undoantidoxx)
4. **Moderators** - Basic moderation commands
5. **Regular Users** - Basic utility commands

## Setting Up Bot Owners

### Environment Variable Setup
Add the following environment variable to your `.env` file or system environment:

```env
BOT_OWNERS=USER_ID_1,USER_ID_2,USER_ID_3
```

### How to Get User IDs
1. Enable Developer Mode in Discord (User Settings > Advanced > Developer Mode)
2. Right-click on a user and select "Copy User ID"
3. Add the ID to the BOT_OWNERS environment variable

### Example
```env
BOT_OWNERS=123456789012345678,987654321098765432
```

## Bot Owner Privileges

### Exclusive Commands
- `/admin list` - List all authorized users
- `/admin add` - Add users to authorized list
- `/admin remove` - Remove users from authorized list
- Full privacy management access

### Override Authority
- Bot owners bypass all permission checks
- Can use moderation commands on any server
- Can access emergency commands (antidoxx/undoantidoxx)
- Have full access even in private mode

### Multi-Server Control
- Bot owner permissions work across ALL servers
- No server-specific restrictions apply
- Can manage bot settings globally

## Security Considerations

⚠️ **Important Security Notes:**
- Only add trusted individuals as bot owners
- Bot owners have unrestricted access to all bot functions
- Review the BOT_OWNERS list regularly
- Remove access immediately if someone should no longer have bot owner privileges

## Environment Variables Summary

```env
# Bot Owner Management (NEW)
BOT_OWNERS=comma,separated,user,ids

# Existing Variables
AUTHORIZED_USERS=comma,separated,user,ids
AUTHORIZED_GUILDS=comma,separated,guild,ids
PRIVATE_MODE=true/false
```

## Testing Bot Owner Setup

1. Add your user ID to BOT_OWNERS environment variable
2. Restart the bot
3. Try using `/admin list` command
4. Check `/help` to see "Bot Owner" access level
5. Test access to restricted commands

## Troubleshooting

### Bot Owner Commands Not Working
1. Verify user ID is correct (17-19 digits)
2. Check BOT_OWNERS environment variable is set
3. Restart the bot after changing environment variables
4. Ensure no extra spaces in the comma-separated list

### Permission Denied Errors
1. Confirm the user ID matches exactly
2. Check that the environment variable is loaded
3. Verify the bot has restarted since the change

## Support

If you need help setting up bot owners or encounter issues:
1. Check the console logs for error messages
2. Verify environment variables are correctly formatted
3. Test with a single bot owner first before adding multiple
