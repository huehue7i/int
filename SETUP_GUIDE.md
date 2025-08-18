# 🤖 Manual Setup Guide

If the automatic scripts don't work, follow these manual steps:

## ✅ Step 1: Install Dependencies Manually

Open PowerShell or Command Prompt in this folder and run:

```bash
npm install
```

If `npm` is not found, try:
```bash
npm.cmd install
```

## ✅ Step 2: Deploy Slash Commands

```bash
node deploy-commands.js
```

## ✅ Step 3: Start the Bot

```bash
node main.js
```

## 🔧 Alternative: Use the Windows Batch File

Double-click `setup.bat` to run the automatic setup.

## 🔗 Bot Invite Link

Use this link to invite your bot to your server:
```
https://discord.com/api/oauth2/authorize?client_id=1394008524689903626&permissions=1099511627775&scope=bot%20applications.commands
```

## 📋 Required Files Checklist

Make sure you have all these files:
- ✅ main.js
- ✅ deploy-commands.js  
- ✅ package.json
- ✅ .env (with your actual DISCORD_TOKEN and CLIENT_ID)
- ✅ start.js
- ✅ setup.bat

## 🆘 Troubleshooting

### Problem: "npm not found"
**Solution:** Install Node.js from https://nodejs.org/ (includes npm)

### Problem: "DISCORD_TOKEN invalid"
**Solution:** Check your token in .env file, regenerate if needed

### Problem: "Missing Permissions"
**Solution:** Re-invite bot with the provided link above

### Problem: Bot appears offline
**Solution:** 
1. Check your .env file has the correct token
2. Make sure the bot is started (`node main.js`)
3. Check Discord Developer Portal - bot should be online

## 🎯 Quick Commands Reference

Once your bot is running, test these commands in Discord:

**Slash Commands:**
- `/ping` - Test if bot is working
- `/help` - Show all commands
- `/kick @user reason` - Kick a user
- `/ban @user reason` - Ban a user
- `/clear 10` - Delete 10 messages

**Prefix Commands:**
- `!ping` - Test if bot is working  
- `!help` - Show all commands
- `!kick @user reason` - Kick a user
- `!ban @user reason` - Ban a user
- `!clear 10` - Delete 10 messages

## 🔒 Permissions Setup

1. In your Discord server, go to Server Settings > Roles
2. Make sure your bot's role is above the "Muted" role
3. Give your bot role these permissions:
   - Kick Members
   - Ban Members  
   - Manage Messages
   - Manage Roles
   - Manage Channels
   - Send Messages
   - Embed Links
   - Read Message History

## 🌟 Advanced Features

### Starboard System
- React with ⭐ to messages to add them to the starboard
- Use `/starboard setup #channel` to configure
- Set star threshold with `/starboard threshold 5`

### Custom Commands
- Create server-specific commands with `/custom create`
- Example: `/custom create hello Hello, World!`
- Users can then use `/hello` or `!hello`

### Reminder System
- Set reminders with `/reminder set 10m Take a break`
- Schedule events with `/reminder event`
- Create recurring reminders with `/reminder recurring`

### AFK System
- Set AFK status with `/afk Going to lunch`
- Bot automatically notifies when AFK users are mentioned
- AFK status is removed when user sends a message

## 🎨 Customization

### Changing the Bot Prefix
Edit the `.env` file:
```
PREFIX=!
```
Change `!` to any symbol you want (e.g., `?`, `.`, `>`)

### Adding Authorized Users
Add user IDs to the `.env` file:
```
AUTHORIZED_USERS=123456789012345678,987654321098765432
```
These users can use all commands regardless of roles.

### Setting Up Moderator Role
1. Create a role called "Moderator" in your server
2. Assign this role to users who should have moderation permissions
3. Or change the role name in `.env`:
```
MODERATOR_ROLE=Staff
```

## 🔧 Manual Installation (If npm fails)

### Step 1: Install Node.js
1. Go to https://nodejs.org/
2. Download the LTS version
3. Install with default settings
4. Restart your computer

### Step 2: Try Alternative Commands
```bash
# Try these if npm doesn't work:
npm.cmd install
# or
npx npm install
# or
node npm install
```

### Step 3: Manual Dependencies
If all else fails, create a `node_modules` folder and install manually:
```bash
git clone https://github.com/discordjs/discord.js node_modules/discord.js
git clone https://github.com/motdotla/dotenv node_modules/dotenv
```

## 🚀 Hosting Options

### Free Hosting Platforms:
1. **Replit** - Easy setup, good for testing
2. **Railway** - Great for small bots
3. **Heroku** - Popular choice (may have costs)
4. **Glitch** - Simple deployment

### VPS Hosting:
1. **DigitalOcean** - Reliable and affordable
2. **Linode** - Good performance
3. **AWS EC2** - Enterprise-grade
4. **Google Cloud** - Scalable options

## 📊 Monitoring & Logs

### Check Bot Status:
```bash
# See if bot is running
node -e "console.log('Bot status check...')"

# Check for errors in main.js
node -c main.js
```

### View Logs:
The bot will show logs in the console when running. Common logs:
- `✅ Bot is ready!` - Bot started successfully
- `🔧 Logged in as YourBot#1234` - Authentication successful
- `❌ Error:` - Something went wrong

## 🛡️ Security Best Practices

1. **Never share your bot token** - Keep `.env` file private
2. **Use specific permissions** - Don't give Administrator if not needed
3. **Regular updates** - Keep discord.js updated
4. **Monitor usage** - Check who's using what commands
5. **Backup configuration** - Save your `.env` and custom settings

## 📞 Support & Help

### If you need help:
1. Check the troubleshooting section above
2. Verify all files are present and configured
3. Make sure Node.js and npm are installed correctly
4. Check Discord Developer Portal for any issues
5. Ensure your bot token is valid and not regenerated

### Common Error Messages:
- `DiscordAPIError: Invalid Form Body` - Check your slash command syntax
- `Missing Permissions` - Bot needs higher role or permissions
- `Cannot read property` - Usually a configuration issue
- `fetch failed` - Network or Discord API issue

## ✨ Final Checklist

Before going live, make sure:
- [ ] Bot appears online in your Discord server
- [ ] `/ping` command works
- [ ] `/help` shows all commands
- [ ] Moderation commands work (test with permission)
- [ ] Bot can create "Muted" role
- [ ] Starboard system is configured (if desired)
- [ ] All required permissions are granted

## 🎉 You're Ready!

Your Discord moderation bot is now set up and ready to use! 

**Quick test commands:**
- Type `/ping` or `!ping` - Should respond with latency
- Type `/help` or `!help` - Should show command list
- React with ⭐ to a message - Should add to starboard (if configured)

**Enjoy your new Discord moderation bot!** 🤖✨
