const { Client, GatewayIntentBits, Partials, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const DatabaseService = require('./database/DatabaseService');
require('dotenv').config();

console.log('🤖 Starting Discord Moderation Bot...');
console.log('=====================================');

// Initialize client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

console.log('✅ Client initialized with intents and partials');

// Legacy storage maps (FULLY DEPRECATED - all data now in DatabaseService)
// const afkUsers = new Map(); // REMOVED: Now uses DatabaseService.getUserAFK()
// const mentionLogs = new Map(); // REMOVED: Stored in AFK schema mentions array
const starboardConfigs = new Map(); // ACTIVE: Loaded from database on startup
const starboardMessages = new Map(); // ACTIVE: Maps originalMessageId -> starboardMessageId
const customCommands = new Map(); // CACHED: Loaded from database, auto-refreshed
const reminders = new Map(); // DEPRECATED: Use DatabaseService reminder methods instead
const userReminders = new Map(); // DEPRECATED: Use DatabaseService.getUserReminders() instead
const activeTimeouts = new Map(); // ACTIVE: Still needed for reminder scheduling
const autoReactions = new Map(); // DEPRECATED: Use DatabaseService auto reaction methods instead
const antidoxxData = new Map(); // LEGACY: Consider moving to database
const quarantineRecords = new Map(); // DEPRECATED: Use DatabaseService quarantine methods instead
let reminderIdCounter = 1; // DEPRECATED: Use MongoDB ObjectId instead

// Performance monitoring
const performanceMetrics = {
    commandsProcessed: 0,
    averageResponseTime: 0,
    uptime: Date.now(),
    memoryUsage: () => process.memoryUsage(),
    
    recordCommand(duration) {
        this.commandsProcessed++;
        this.averageResponseTime = ((this.averageResponseTime * (this.commandsProcessed - 1)) + duration) / this.commandsProcessed;
    },
    
    getStats() {
        const uptimeMs = Date.now() - this.uptime;
        const memory = this.memoryUsage();
        
        return {
            uptime: formatDuration(Math.floor(uptimeMs / 1000)),
            commandsProcessed: this.commandsProcessed,
            averageResponseTime: `${Math.round(this.averageResponseTime)}ms`,
            memoryUsage: `${Math.round(memory.heapUsed / 1024 / 1024)}MB`,
            totalMemory: `${Math.round(memory.heapTotal / 1024 / 1024)}MB`
        };
    }
};

// Optimized periodic cleanup and monitoring
setInterval(async () => {
    try {
        // Log performance metrics and database stats
        if (performanceMetrics.commandsProcessed > 0) {
            const botStats = performanceMetrics.getStats();
            const dbStats = DatabaseService.getPerformanceStats ? DatabaseService.getPerformanceStats() : {};
            
            console.log('📊 Performance:', botStats);
            console.log('🗄️ Database:', dbStats);
            
            // Memory cleanup for legacy Maps (deprecated, data now in database)
            if (antidoxxData.size > 100) antidoxxData.clear(); // Cleanup old antidoxx data
        }
        
        // Trigger database cleanup every hour
        if (Date.now() % (60 * 60 * 1000) < 300000) { // Within 5 minutes of the hour
            await DatabaseService.cleanupExpiredData();
        }
    } catch (error) {
        console.error('Error in periodic cleanup:', error);
    }
}, 300000); // Every 5 minutes

// Prefix for commands
const PREFIX = '!';

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Validates if a string is not empty and within length limits
 * @param {string} str - String to validate
 * @param {number} minLength - Minimum length (default: 1)
 * @param {number} maxLength - Maximum length (default: 2000)
 * @returns {boolean} - True if valid
 */
function isValidString(str, minLength = 1, maxLength = 2000) {
    return typeof str === 'string' && str.trim().length >= minLength && str.length <= maxLength;
}

/**
 * Validates if a user ID is valid
 * @param {string} userId - User ID to validate
 * @returns {boolean} - True if valid
 */
function isValidUserId(userId) {
    return typeof userId === 'string' && /^\d{17,19}$/.test(userId);
}

/**
 * Validates if a guild ID is valid
 * @param {string} guildId - Guild ID to validate
 * @returns {boolean} - True if valid
 */
function isValidGuildId(guildId) {
    return typeof guildId === 'string' && /^\d{17,19}$/.test(guildId);
}

/**
 * Sanitizes user input by removing potentially harmful characters
 * @param {string} input - Input to sanitize
 * @returns {string} - Sanitized input
 */
/**
 * Centralized error logging with context
 * @param {string} context - Where the error occurred
 * @param {Error} error - The error object
 * @param {Object} metadata - Additional context data
 */
function logError(context, error, metadata = {}) {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] ERROR in ${context}:`, {
        message: error.message,
        stack: error.stack,
        metadata
    });
}

/**
 * Safe async function wrapper that handles errors gracefully
 * @param {Function} fn - Async function to wrap
 * @param {string} context - Context for error logging
 * @returns {Function} - Wrapped function
 */
function safeAsync(fn, context) {
    return async (...args) => {
        try {
            return await fn(...args);
        } catch (error) {
            logError(context, error, { args });
            return null;
        }
    };
}

function sanitizeInput(input) {
    if (typeof input !== 'string') return '';
    return input.replace(/[<>@&"']/g, '').trim();
}

function formatDuration(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
    
    return parts.join(' ');
}

function formatAfkDuration(timestamp) {
    const now = Date.now();
    const diff = Math.floor((now - timestamp) / 1000);
    return formatDuration(diff);
}

function isBotOwner(userId) {
    const botOwners = process.env.BOT_OWNERS?.split(',').map(id => id.trim()) || [];
    return botOwners.includes(userId);
}

function hasModeratorPermissions(member) {
    return isBotOwner(member.id) ||
           member.permissions.has(PermissionFlagsBits.Administrator) ||
           member.roles.cache.some(role => role.name.toLowerCase() === 'moderator') ||
           isAuthorizedUser(member.id) ||
           member.guild.ownerId === member.id;
}

function hasBotOwnerPermissions(member) {
    return isBotOwner(member.id);
}

function hasServerOwnerPermissions(member) {
    return isBotOwner(member.id) || member.guild.ownerId === member.id;
}

function isAuthorizedUser(userId) {
    const authorizedUsers = process.env.AUTHORIZED_USERS?.split(',').map(id => id.trim()) || [];
    return authorizedUsers.includes(userId);
}

function isAuthorizedGuild(guildId) {
    const authorizedGuilds = process.env.AUTHORIZED_GUILDS?.split(',').map(id => id.trim()) || [];
    return authorizedGuilds.includes(guildId);
}

function hasCustomCommandPermissions(member) {
    return isBotOwner(member.id) ||
           member.guild.ownerId === member.id ||
           isAuthorizedUser(member.id);
}

function isPrivateModeEnabled() {
    return process.env.PRIVATE_MODE === 'true';
}

function canUseBot(member) {
    if (!isPrivateModeEnabled()) return true; // If not in private mode, allow everyone
    
    // Bot owners always have access
    if (isBotOwner(member.id)) return true;
    
    // Check if guild is authorized
    if (!isAuthorizedGuild(member.guild.id)) {
        return false;
    }
    
    // Check if user is authorized
    return isAuthorizedUser(member.id) || 
           member.guild.ownerId === member.id ||
           member.permissions.has(PermissionFlagsBits.Administrator);
}

function parseDuration(duration) {
    const matches = duration.match(/^(\d+)([smhdw])$/);
    if (!matches) return null;
    
    const value = parseInt(matches[1]);
    const unit = matches[2];
    
    const multipliers = {
        's': 1000,
        'm': 60 * 1000,
        'h': 60 * 60 * 1000,
        'd': 24 * 60 * 60 * 1000,
        'w': 7 * 24 * 60 * 60 * 1000
    };
    
    return value * multipliers[unit];
}

async function getMutedRole(guild) {
    let mutedRole = guild.roles.cache.find(role => role.name === 'Muted');
    
    if (!mutedRole) {
        try {
            mutedRole = await guild.roles.create({
                name: 'Muted',
                color: '#818386',
                permissions: [],
                reason: 'Auto-created muted role for moderation',
                position: 1 // Place near bottom but above @everyone
            });
            
            console.log(`✅ Created muted role in ${guild.name}`);
        } catch (error) {
            console.error('Error creating muted role:', error);
            return null;
        }
    }
    
    // Always ensure permissions are set correctly for all channels
    await setupMutePermissions(guild, mutedRole);
    
    return mutedRole;
}

async function setupMutePermissions(guild, mutedRole) {
    try {
        const channels = await guild.channels.fetch();
        let updatedChannels = 0;
        
        for (const [channelId, channel] of channels) {
            try {
                // Check if this channel type needs mute permissions
                if (channel.type === 0 || channel.type === 2 || channel.type === 5 || channel.type === 13) { 
                    // Text, Voice, Announcement, Stage channels
                    const permissions = {
                        SendMessages: false,
                        AddReactions: false,
                        SendMessagesInThreads: false,
                        CreatePublicThreads: false,
                        CreatePrivateThreads: false,
                        UseApplicationCommands: false
                    };
                    
                    // Add voice-specific permissions for voice channels
                    if (channel.type === 2 || channel.type === 13) { // Voice or Stage channels
                        permissions.Speak = false;
                        permissions.Connect = false;
                        permissions.Stream = false;
                        permissions.UseVAD = false;
                        permissions.RequestToSpeak = false;
                    }
                    
                    // Check if permissions are already set correctly
                    const existingOverwrite = channel.permissionOverwrites.cache.get(mutedRole.id);
                    let needsUpdate = !existingOverwrite;
                    
                    if (existingOverwrite) {
                        for (const [perm, value] of Object.entries(permissions)) {
                            if (existingOverwrite.deny.has(perm) !== value) {
                                needsUpdate = true;
                                break;
                            }
                        }
                    }
                    
                    if (needsUpdate) {
                        await channel.permissionOverwrites.edit(mutedRole, permissions, {
                            reason: 'Auto-setup mute permissions'
                        });
                        updatedChannels++;
                    }
                }
            } catch (channelError) {
                console.error(`Error setting permissions for channel ${channel.name}:`, channelError);
            }
        }
        
        if (updatedChannels > 0) {
            console.log(`✅ Updated mute permissions for ${updatedChannels} channels in ${guild.name}`);
        }
    } catch (error) {
        console.error('Error setting up mute permissions:', error);
    }
}

async function getQuarantinedRole(guild) {
    let quarantinedRole = guild.roles.cache.find(role => role.name === 'Quarantined');
    
    if (!quarantinedRole) {
        try {
            quarantinedRole = await guild.roles.create({
                name: 'Quarantined',
                color: '#ff0000',
                permissions: [],
                reason: 'Auto-created quarantined role for moderation',
                position: 1 // Place near bottom but above @everyone
            });
            
            console.log(`✅ Created quarantined role in ${guild.name}`);
        } catch (error) {
            console.error('Error creating quarantined role:', error);
            return null;
        }
    }
    
    // Always ensure permissions are set correctly for all channels
    await setupQuarantinePermissions(guild, quarantinedRole);
    
    return quarantinedRole;
}

async function setupQuarantinePermissions(guild, quarantinedRole) {
    try {
        const channels = await guild.channels.fetch();
        let updatedChannels = 0;
        
        // Find the quarantine channel to exclude it from restrictions
        const quarantineChannel = guild.channels.cache.find(channel => 
            channel.name === 'bundfaad-baat-chit' && channel.type === 0
        );
        
        // Filter channels that need quarantine permissions
        const relevantChannels = channels.filter(channel => 
            channel.type === 0 || channel.type === 2 || channel.type === 4 || 
            channel.type === 5 || channel.type === 13 || channel.type === 15
        );
        
        const batchPromises = [];
        
        for (const [channelId, channel] of relevantChannels) {
            try {
                // Skip the quarantine channel - quarantined users should be able to access it
                if (quarantineChannel && channel.id === quarantineChannel.id) {
                    continue;
                }
                
                const permissions = {
                    ViewChannel: false,
                    SendMessages: false,
                    AddReactions: false,
                    SendMessagesInThreads: false,
                    CreatePublicThreads: false,
                    CreatePrivateThreads: false,
                    UseApplicationCommands: false,
                    Connect: false,
                    Speak: false,
                    Stream: false,
                    UseVAD: false,
                    RequestToSpeak: false,
                    ReadMessageHistory: false
                };
                
                // Check if permissions need updating
                const existingOverwrite = channel.permissionOverwrites.cache.get(quarantinedRole.id);
                let needsUpdate = !existingOverwrite;
                
                if (existingOverwrite) {
                    for (const [perm, value] of Object.entries(permissions)) {
                        if (existingOverwrite.deny.has(perm) !== value) {
                            needsUpdate = true;
                            break;
                        }
                    }
                }
                
                if (needsUpdate) {
                    batchPromises.push(
                        channel.permissionOverwrites.edit(quarantinedRole, permissions, {
                            reason: 'Auto-setup quarantine permissions'
                        }).then(() => updatedChannels++)
                        .catch(error => logError('setupQuarantinePermissions', error, { channelName: channel.name }))
                    );
                }
            } catch (channelError) {
                logError('setupQuarantinePermissions:channel', channelError, { channelName: channel.name });
            }
        }
        
        // Process all permission updates concurrently
        await Promise.allSettled(batchPromises);
        
        if (updatedChannels > 0) {
            console.log(`✅ Updated quarantine permissions for ${updatedChannels} channels in ${guild.name}`);
        }
    } catch (error) {
        logError('setupQuarantinePermissions', error, { guildName: guild.name });
    }
}

async function setupQuarantineSystem(guild) {
    const result = {
        success: false,
        role: null,
        channel: null,
        error: null
    };
    
    try {
        // Get or create the quarantined role
        const quarantinedRole = await getQuarantinedRole(guild);
        if (!quarantinedRole) {
            result.error = 'Failed to create or find the quarantined role.';
            return result;
        }
        
        // Check if quarantine channel already exists
        let quarantineChannel = guild.channels.cache.find(channel => 
            channel.name === 'bundfaad-baat-chit' && channel.type === 0
        );
        
        if (!quarantineChannel) {
            // Create the quarantine channel
            quarantineChannel = await guild.channels.create({
                name: 'bundfaad-baat-chit',
                type: 0, // Text channel
                topic: 'Channel for quarantined users to communicate with moderators - bundfaad baat chit',
                reason: 'Auto-created quarantine channel',
                permissionOverwrites: [
                    // Deny @everyone access
                    {
                        id: guild.roles.everyone.id,
                        deny: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ReadMessageHistory
                        ]
                    },
                    // Allow quarantined users to view and send messages ONLY in this channel
                    {
                        id: quarantinedRole.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ReadMessageHistory
                        ],
                        deny: [
                            PermissionFlagsBits.AddReactions,
                            PermissionFlagsBits.AttachFiles,
                            PermissionFlagsBits.EmbedLinks,
                            PermissionFlagsBits.CreatePublicThreads,
                            PermissionFlagsBits.CreatePrivateThreads,
                            PermissionFlagsBits.SendMessagesInThreads,
                            PermissionFlagsBits.UseApplicationCommands
                        ]
                    }
                ]
            });
            
            console.log(`✅ Created quarantine channel in ${guild.name}`);
        } else {
            // Update existing quarantine channel permissions to ensure they're correct
            try {
                // Ensure @everyone can't see it
                await quarantineChannel.permissionOverwrites.edit(guild.roles.everyone.id, {
                    ViewChannel: false,
                    SendMessages: false,
                    ReadMessageHistory: false
                });
                
                // Ensure quarantined users can access it
                await quarantineChannel.permissionOverwrites.edit(quarantinedRole.id, {
                    ViewChannel: true,
                    SendMessages: true,
                    ReadMessageHistory: true,
                    AddReactions: false,
                    AttachFiles: false,
                    EmbedLinks: false,
                    CreatePublicThreads: false,
                    CreatePrivateThreads: false,
                    SendMessagesInThreads: false,
                    UseApplicationCommands: false
                });
                
                console.log(`✅ Updated quarantine channel permissions in ${guild.name}`);
            } catch (permError) {
                console.error('Error updating quarantine channel permissions:', permError);
            }
        }
        
        // Send/update welcome message to the quarantine channel (for both new and existing channels)
        try {
            const welcomeEmbed = new EmbedBuilder()
                .setColor('#ff6b35')
                .setTitle('🔒 Quarantine Channel')
                .setDescription('This channel is for quarantined users to communicate with moderators.')
                .addFields(
                    {
                        name: '📋 Rules for Quarantined Users',
                        value: '• Be respectful and civil\n• Explain your situation clearly\n• Wait for moderator response\n• Do not spam or argue\n• Use this opportunity to apologize if needed',
                        inline: false
                    },
                    {
                        name: '👮 For Moderators',
                        value: 'This channel allows quarantined users to:\n• Appeal their quarantine\n• Apologize for their actions\n• Discuss their behavior\n• Request unquarantine',
                        inline: false
                    }
                )
                .setFooter({ text: 'Quarantine system - Use responsibly' })
                .setTimestamp();
            
            // Check if welcome message already exists (look for bot's embed message)
            const messages = await quarantineChannel.messages.fetch({ limit: 10 });
            const existingWelcome = messages.find(msg => 
                msg.author.id === client.user.id && 
                msg.embeds.length > 0 && 
                msg.embeds[0].title === '🔒 Quarantine Channel'
            );
            
            if (!existingWelcome) {
                await quarantineChannel.send({ embeds: [welcomeEmbed] });
                console.log(`✅ Sent welcome message to quarantine channel in ${guild.name}`);
            }
        } catch (welcomeError) {
            console.error('Error sending welcome message to quarantine channel:', welcomeError);
        }
        
        // Set up permissions for moderators, admins, owners, and authorized users
        const permissionUpdates = [];
        
        // Allow moderators (anyone with moderate members permission)
        try {
            await quarantineChannel.permissionOverwrites.edit(guild.roles.everyone, {
                ViewChannel: false
            });
            
            // Find roles with moderate permissions and grant access
            const moderatorRoles = guild.roles.cache.filter(role => 
                role.permissions.has(PermissionFlagsBits.ModerateMembers) ||
                role.permissions.has(PermissionFlagsBits.BanMembers) ||
                role.permissions.has(PermissionFlagsBits.KickMembers) ||
                role.permissions.has(PermissionFlagsBits.ManageMessages)
            );
            
            for (const [roleId, role] of moderatorRoles) {
                if (role.id !== guild.roles.everyone.id) {
                    await quarantineChannel.permissionOverwrites.edit(role, {
                        ViewChannel: true,
                        SendMessages: true,
                        ReadMessageHistory: true,
                        ManageMessages: true
                    });
                    permissionUpdates.push(`Granted access to role: ${role.name}`);
                }
            }
            
            // Allow server owner
            if (guild.ownerId) {
                await quarantineChannel.permissionOverwrites.edit(guild.ownerId, {
                    ViewChannel: true,
                    SendMessages: true,
                    ReadMessageHistory: true,
                    ManageMessages: true,
                    ManageChannels: true
                });
                permissionUpdates.push('Granted access to server owner');
            }
            
            // Allow authorized users and bot owners
            const authorizedUsers = process.env.AUTHORIZED_USERS?.split(',').map(id => id.trim()) || [];
            const botOwners = process.env.BOT_OWNERS?.split(',').map(id => id.trim()) || [];
            const allAuthorizedUsers = [...new Set([...authorizedUsers, ...botOwners])];
            
            for (const userId of allAuthorizedUsers) {
                if (userId && guild.members.cache.has(userId)) {
                    await quarantineChannel.permissionOverwrites.edit(userId, {
                        ViewChannel: true,
                        SendMessages: true,
                        ReadMessageHistory: true,
                        ManageMessages: true
                    });
                    permissionUpdates.push(`Granted access to authorized user: ${userId}`);
                }
            }
            
            console.log(`✅ Set quarantine channel permissions: ${permissionUpdates.join(', ')}`);
            
        } catch (permError) {
            console.error('Error setting quarantine channel permissions:', permError);
        }
        
        result.success = true;
        result.role = quarantinedRole;
        result.channel = quarantineChannel;
        
        console.log(`✅ Quarantine system setup complete for ${guild.name}`);
        
    } catch (error) {
        console.error('Error in setupQuarantineSystem:', error);
        result.error = error.message;
    }
    
    return result;
}

async function autoSetupMutedRoles() {
    console.log('🔧 Auto-setting up moderation roles for all servers...');
    
    for (const [guildId, guild] of client.guilds.cache) {
        try {
            await getMutedRole(guild);
            await getQuarantinedRole(guild);
        } catch (error) {
            console.error(`Error setting up moderation roles for ${guild.name}:`, error);
        }
    }
    
    console.log('✅ Moderation role setup completed for all servers');
}

function createSuccessEmbed(title, description) {
    return new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle(`✅ ${title}`)
        .setDescription(description)
        .setTimestamp();
}

function createErrorEmbed(title, description) {
    return new EmbedBuilder()
        .setColor('#ff0000')
        .setTitle(`❌ ${title}`)
        .setDescription(description)
        .setTimestamp();
}

function saveAllBotData() {
    try {
        console.log('💾 Database auto-saves data automatically...');
        // With DatabaseService, data is automatically persisted to MongoDB
        // No manual saving needed - data is saved immediately when modified
        console.log('✅ Database-powered bot - no manual saves needed');
    } catch (error) {
        console.error('❌ Error with database operations:', error);
    }
}

// =============================================================================
// SERVER INFO HELPER FUNCTIONS
// =============================================================================

function getVerificationLevel(level) {
    const levels = {
        0: '🔓 None',
        1: '📧 Low (Email)',
        2: '📱 Medium (Phone)',
        3: '⏰ High (10+ min)',
        4: '🎓 Highest (Phone + 10+ min)'
    };
    return levels[level] || `🔒 Level ${level}`;
}

// =============================================================================
// STARBOARD FUNCTIONS
// =============================================================================

async function getStarboardConfig(guildId) {
    try {
        // Check memory cache first
        if (starboardConfigs.has(guildId)) {
            return starboardConfigs.get(guildId);
        }
        
        // Fetch from database if not in cache
        const config = await DatabaseService.getStarboardConfig(guildId);
        if (config) {
            // Cache it for future use
            const cacheConfig = {
                channelId: config.channelId,
                threshold: config.threshold || 3,
                emoji: config.emoji || '⭐'
            };
            starboardConfigs.set(guildId, cacheConfig);
            return cacheConfig;
        }
        
        return null;
    } catch (error) {
        console.error('[Starboard] Failed to get starboard config:', error);
        // Fallback to in-memory
        return starboardConfigs.get(guildId) || null;
    }
}

function createStarboardEmbed(message, starCount) {
    const embed = new EmbedBuilder()
        .setColor('#ffd700')
        .setAuthor({
            name: message.author.displayName,
            iconURL: message.author.displayAvatarURL()
        })
        .setDescription(message.content || '*No text content*')
        .addFields(
            { name: 'Original Message', value: `[Jump to Message](${message.url})`, inline: true },
            { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
            { name: 'Stars', value: `⭐ ${starCount}`, inline: true }
        )
        .setTimestamp(message.createdAt);

    if (message.attachments.size > 0) {
        const attachment = message.attachments.first();
        if (attachment.contentType?.startsWith('image/')) {
            embed.setImage(attachment.url);
        }
    }

    return embed;
}

// =============================================================================
// CUSTOM COMMAND FUNCTIONS
// =============================================================================

function getGuildCustomCommands(guildId) {
    if (!customCommands.has(guildId)) {
        customCommands.set(guildId, new Map());
    }
    return customCommands.get(guildId);
}

// Load all custom commands from database into memory on startup
async function loadCustomCommandsFromDatabase() {
    try {
        console.log('🔄 Loading custom commands from database...');
        const allCommands = await DatabaseService.getAllCustomCommands();
        
        let loadedCount = 0;
        for (const command of allCommands) {
            const guildCommands = getGuildCustomCommands(command.guildId);
            guildCommands.set(command.name, {
                name: command.name,
                response: command.response,
                type: command.type,
                createdBy: command.createdBy,
                editedBy: command.editedBy,
                createdAt: command.createdAt,
                editedAt: command.editedAt,
                useCount: command.useCount
            });
            loadedCount++;
        }
        
        console.log(`✅ Loaded ${loadedCount} custom commands from database`);
    } catch (error) {
        console.error('❌ Failed to load custom commands from database:', error);
    }
}

// Load all persistent data from database into memory on startup
async function loadAllPersistentData() {
    try {
        console.log('🔄 Loading all persistent data from database...');
        
        // Load custom commands
        await loadCustomCommandsFromDatabase();
        
        // Load starboard configurations
        try {
            const configs = await DatabaseService.getAllStarboardConfigs();
            starboardConfigs.clear();
            for (const config of configs) {
                starboardConfigs.set(config.guildId, {
                    channelId: config.channelId,
                    threshold: config.threshold || 3,
                    emoji: config.emoji || '⭐'
                });
            }
            console.log(`✅ Loaded ${configs.length} starboard config(s) from database`);
        } catch (error) {
            console.error('⚠️ Failed to load starboard configs:', error);
        }
        
        // Load starboard message mappings
        try {
            const mappings = await DatabaseService.getAllStarboardMessages();
            starboardMessages.clear();
            for (const mapping of mappings) {
                starboardMessages.set(mapping.originalMessageId, mapping.starboardMessageId);
            }
            console.log(`✅ Loaded ${mappings.length} starboard message mapping(s) from database`);
        } catch (error) {
            console.error('⚠️ Failed to load starboard messages:', error);
        }
        
        // AFK data is loaded dynamically via DatabaseService calls (no memory cache needed)
        console.log('✅ AFK system ready (database-backed)');
        
        // Quarantine records are loaded dynamically via DatabaseService calls (no memory cache needed)
        console.log('✅ Quarantine system ready (database-backed)');
        
        // Auto reactions are loaded dynamically via DatabaseService calls (no memory cache needed)
        console.log('✅ Auto reactions system ready (database-backed)');
        
        // Reminders system - database methods ready, but conversion in progress
        console.log('✅ Reminder system ready (database methods available)');
        
        console.log('✅ All persistent data loaded successfully');
    } catch (error) {
        console.error('❌ Failed to load persistent data from database:', error);
    }
}

function validateCommandName(name) {
    return /^[a-z0-9_-]+$/i.test(name) && name.length >= 2 && name.length <= 32;
}

function isBuiltInCommand(name) {
    const builtInCommands = [
        'kick', 'ban', 'mute', 'unmute', 'warn', 'quarantine', 'unquarantine', 'clear', 'lock', 'unlock',
        'viewlock', 'viewunlock', 'slowmode', 'ping', 'serverinfo', 'avatar', 'banner',
        'help', 'afk', 'remindme', 'reminders', 'emoji', 'starboard', 'custom',
        'reminder', 'admin', 'antidoxx', 'undoantidoxx', 'setupmute', 'setupquarantine', 'quarantineinfo',
        'freezenick', 'unfreezenick', 'afkclear', 'afklist'
    ];
    return builtInCommands.includes(name.toLowerCase());
}

function processCustomCommandResponse(response, user, guild, channel) {
    return response
        .replace(/{user}/g, `<@${user.id}>`)
        .replace(/{user\.mention}/g, `<@${user.id}>`)
        .replace(/{user\.name}/g, user.displayName)
        .replace(/{user\.tag}/g, user.tag)
        .replace(/{user\.id}/g, user.id)
        .replace(/{server}/g, guild.name)
        .replace(/{server\.name}/g, guild.name)
        .replace(/{server\.id}/g, guild.id)
        .replace(/{server\.members}/g, guild.memberCount.toString())
        .replace(/{channel}/g, `<#${channel.id}>`)
        .replace(/{channel\.name}/g, channel.name)
        .replace(/{channel\.id}/g, channel.id)
        .replace(/{date}/g, new Date().toLocaleDateString())
        .replace(/{time}/g, new Date().toLocaleTimeString())
        .replace(/{datetime}/g, new Date().toLocaleString());
}

// =============================================================================
// REMINDER FUNCTIONS
// =============================================================================

function parseReminderTime(timeString) {
    // Check if it's a relative duration (e.g., "10m", "2h", "1d")
    const durationMatch = timeString.match(/^(\d+)([smhdw])$/);
    if (durationMatch) {
        const value = parseInt(durationMatch[1]);
        const unit = durationMatch[2];
        const multipliers = {
            's': 1000,
            'm': 60 * 1000,
            'h': 60 * 60 * 1000,
            'd': 24 * 60 * 60 * 1000,
            'w': 7 * 24 * 60 * 60 * 1000
        };
        
        return Date.now() + (value * multipliers[unit]);
    }
    
    // Check if it's an absolute date/time
    try {
        const date = new Date(timeString);
        if (isNaN(date.getTime())) return null;
        if (date.getTime() <= Date.now()) return null; // Must be in the future
        return date.getTime();
    } catch {
        return null;
    }
}

function formatTimeRemaining(timestamp) {
    const now = Date.now();
    const diff = timestamp - now;
    
    if (diff <= 0) return 'Expired';
    
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}

async function createReminder(userId, guildId, channelId, message, timestamp, type = 'reminder', recurring = null) {
    const reminderId = `reminder_${reminderIdCounter++}`;
    
    const reminderData = {
        id: reminderId,
        userId,
        guildId,
        channelId,
        message,
        timestamp,
        type,
        recurring,
        createdAt: Date.now()
    };
    
    // Save to database
    try {
        const dbReminderData = {
            userId,
            guildId,
            channelId,
            message,
            reminderTime: new Date(timestamp),
            recurring: recurring || null,
            active: true
        };
        
        const savedReminder = await DatabaseService.createReminder(dbReminderData);
        if (savedReminder) {
            // Use database ID for consistency
            reminderId = savedReminder._id.toString();
            reminderData._id = reminderId;
        }
    } catch (error) {
        console.error('Failed to save reminder to database:', error);
        // Continue with in-memory only as fallback
    }
    
    // Add to in-memory storage for active management
    reminders.set(reminderId, reminderData);
    
    // Add to user's reminder list for quick access
    if (!userReminders.has(userId)) {
        userReminders.set(userId, new Set());
    }
    userReminders.get(userId).add(reminderId);
    
    // Schedule the reminder
    scheduleReminder(reminderId);
    
    return reminderId;
}

function scheduleReminder(reminderId) {
    const reminder = reminders.get(reminderId);
    if (!reminder) return;
    
    const delay = reminder.timestamp - Date.now();
    if (delay <= 0) {
        // Trigger immediately if time has passed
        triggerReminder(reminderId);
        return;
    }
    
    // Clear existing timeout if any
    if (activeTimeouts.has(reminderId)) {
        clearTimeout(activeTimeouts.get(reminderId));
    }
    
    // Set new timeout
    const timeoutId = setTimeout(() => {
        triggerReminder(reminderId);
    }, delay);
    
    activeTimeouts.set(reminderId, timeoutId);
}

async function triggerReminder(reminderId) {
    try {
        const reminder = reminders.get(reminderId);
        if (!reminder) return;
        
        const guild = client.guilds.cache.get(reminder.guildId);
        if (!guild) return;
        
        const channel = guild.channels.cache.get(reminder.channelId);
        const user = await client.users.fetch(reminder.userId);
        if (!user) return;
        
        // Create reminder embed
        const embed = new EmbedBuilder()
            .setColor(reminder.type === 'event' ? '#ff6b6b' : '#4ecdc4')
            .setTitle(reminder.type === 'event' ? '📅 Event Reminder' : '⏰ Reminder')
            .setDescription(reminder.message)
            .addFields(
                { name: 'Reminded User', value: `<@${reminder.userId}>`, inline: true },
                { name: 'Set', value: `<t:${Math.floor(reminder.createdAt / 1000)}:R>`, inline: true }
            )
            .setTimestamp()
            .setFooter({ text: `Reminder ID: ${reminderId}` });
        
        // Send in channel if available, otherwise DM
        if (channel) {
            await channel.send({ content: `<@${reminder.userId}>`, embeds: [embed] });
        } else {
            try {
                await user.send({ embeds: [embed] });
            } catch (error) {
                console.log(`Could not send reminder DM to ${user.tag}`);
            }
        }
        
        // Handle recurring reminders
        if (reminder.recurring) {
            const nextTimestamp = getNextRecurringTime(reminder.timestamp, reminder.recurring);
            if (nextTimestamp) {
                reminder.timestamp = nextTimestamp;
                scheduleReminder(reminderId);
                console.log(`Recurring reminder ${reminderId} rescheduled for ${new Date(nextTimestamp)}`);
            } else {
                deleteReminder(reminderId);
            }
        } else {
            // Delete one-time reminder
            deleteReminder(reminderId);
        }
        
        console.log(`Triggered reminder ${reminderId} for ${user.tag}: ${reminder.message}`);
        
    } catch (error) {
        console.error('Error triggering reminder:', error);
    }
}

function getNextRecurringTime(currentTimestamp, recurring) {
    if (!recurring || !recurring.interval) return null;
    
    const intervalMs = parseDuration(recurring.interval);
    if (!intervalMs) return null;
    
    const nextTime = currentTimestamp + intervalMs;
    
    // Check if we've reached the end date
    if (recurring.endDate && nextTime > recurring.endDate) {
        return null;
    }
    
    // Check if we've reached the max occurrences
    if (recurring.maxOccurrences) {
        recurring.currentOccurrence = (recurring.currentOccurrence || 1) + 1;
        if (recurring.currentOccurrence > recurring.maxOccurrences) {
            return null;
        }
    }
    
    return nextTime;
}

function deleteReminder(reminderId) {
    const reminder = reminders.get(reminderId);
    if (!reminder) return;
    
    // Clear timeout
    if (activeTimeouts.has(reminderId)) {
        clearTimeout(activeTimeouts.get(reminderId));
        activeTimeouts.delete(reminderId);
    }
    
    // Remove from user's reminder list
    if (userReminders.has(reminder.userId)) {
        userReminders.get(reminder.userId).delete(reminderId);
        if (userReminders.get(reminder.userId).size === 0) {
            userReminders.delete(reminder.userId);
        }
    }
    
    // Remove from main storage
    reminders.delete(reminderId);
}

function getUserReminders(userId) {
    const userReminderIds = userReminders.get(userId);
    if (!userReminderIds) return [];
    
    return Array.from(userReminderIds)
        .map(id => reminders.get(id))
        .filter(reminder => reminder)
        .sort((a, b) => a.timestamp - b.timestamp);
}

// =============================================================================
// AUTO-REACTION FUNCTIONS
// =============================================================================

async function getGuildAutoReactions(guildId) {
    try {
        const reactions = await DatabaseService.getGuildAutoReactions(guildId);
        return reactions;
    } catch (error) {
        console.error('Failed to get auto reactions from database:', error);
        // Fallback to in-memory
        if (!autoReactions.has(guildId)) {
            autoReactions.set(guildId, new Map());
        }
        return autoReactions.get(guildId);
    }
}

async function setAutoReaction(guildId, userId, emoji) {
    try {
        await DatabaseService.setAutoReaction(guildId, userId, emoji, true);
    } catch (error) {
        console.error('Failed to set auto reaction in database:', error);
        // Fallback to in-memory
        const guildReactions = await getGuildAutoReactions(guildId);
        guildReactions.set(userId, { emoji, enabled: true });
        saveAutoReactionData();
    }
}

async function removeAutoReaction(guildId, userId) {
    try {
        const result = await DatabaseService.removeAutoReaction(guildId, userId);
        return result;
    } catch (error) {
        console.error('Failed to remove auto reaction from database:', error);
        // Fallback to in-memory
        const guildReactions = await getGuildAutoReactions(guildId);
        const result = guildReactions.delete(userId);
        if (result) saveAutoReactionData();
        return result;
    }
}

async function toggleAutoReaction(guildId, userId) {
    try {
        const result = await DatabaseService.toggleAutoReaction(guildId, userId);
        return result;
    } catch (error) {
        console.error('Failed to toggle auto reaction in database:', error);
        // Fallback to in-memory
        const guildReactions = await getGuildAutoReactions(guildId);
        const reaction = guildReactions.get(userId);
        if (reaction) {
            reaction.enabled = !reaction.enabled;
            saveAutoReactionData();
            return reaction.enabled;
        }
        return false;
    }
}

function isValidEmoji(emoji) {
    // Check if it's a Unicode emoji
    const unicodeEmojiRegex = /^(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])$/;
    if (unicodeEmojiRegex.test(emoji)) return true;
    
    // Check if it's a custom emoji format <:name:id> or <a:name:id>
    const customEmojiRegex = /^<a?:[a-zA-Z0-9_]+:\d+>$/;
    if (customEmojiRegex.test(emoji)) return true;
    
    // Check if it's just an emoji name like :smile:
    const emojiNameRegex = /^:[a-zA-Z0-9_]+:$/;
    if (emojiNameRegex.test(emoji)) return true;
    
    return false;
}

function saveAutoReactionData() {
    try {
        // Data automatically saved to database
        console.log('💾 Auto-reaction data saved');
    } catch (error) {
        console.error('Error saving auto-reaction data:', error);
    }
}

// =============================================================================
// QUARANTINE DATABASE FUNCTIONS
// =============================================================================

function generateQuarantineRecordId() {
    return `quar_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

async function addQuarantineRecord(guildId, userId, username, moderatorId, moderatorUsername, reason, action = 'quarantine', duration = null) {
    const recordData = {
        userId,
        guildId,
        moderatorId,
        reason,
        type: action, // 'quarantine' or 'unquarantine'
        duration,
        roles: [], // Will be populated when removing roles
        active: action === 'quarantine'
    };
    
    try {
        // Save to database
        const savedRecord = await DatabaseService.createQuarantineRecord(recordData);
        if (savedRecord) {
            console.log(`📝 Added quarantine record: ${action} for ${username} by ${moderatorUsername} in guild ${guildId}`);
            return savedRecord._id.toString();
        }
    } catch (error) {
        console.error('Failed to save quarantine record to database:', error);
    }
    
    // Fallback to in-memory storage if database fails
    const recordId = generateQuarantineRecordId();
    const record = {
        recordId,
        userId,
        username,
        moderatorId,
        moderatorUsername,
        reason,
        action,
        timestamp: Date.now(),
        duration
    };
    
    // Get or create guild records for fallback
    if (!quarantineRecords.has(guildId)) {
        quarantineRecords.set(guildId, new Map());
    }
    
    const guildRecords = quarantineRecords.get(guildId);
    guildRecords.set(recordId, record);
    
    console.log(`📝 Added quarantine record (fallback): ${action} for ${username} by ${moderatorUsername} in guild ${guildId}`);
    return recordId;
}

async function getQuarantineHistory(guildId, userId = null, limit = 50) {
    try {
        // Get records from database
        const records = await DatabaseService.getGuildQuarantineRecords(guildId, userId, limit);
        return records || [];
    } catch (error) {
        console.error('Failed to get quarantine history from database:', error);
        
        // Fallback to in-memory records
        const guildRecords = quarantineRecords.get(guildId);
        if (!guildRecords) return [];
        
        let records = Array.from(guildRecords.values());
        
        // Filter by user if specified
        if (userId) {
            records = records.filter(record => record.userId === userId);
        }
        
        // Sort by timestamp (newest first)
        records.sort((a, b) => b.timestamp - a.timestamp);
        
        // Limit results
        return records.slice(0, limit);
    }
}

async function getUserQuarantineStatus(guildId, userId) {
    try {
        // Check database for active quarantine
        const activeQuarantine = await DatabaseService.getActiveQuarantine(userId, guildId);
        if (activeQuarantine) {
            return {
                isQuarantined: true,
                lastAction: activeQuarantine,
                totalRecords: 1 // Could be enhanced to get total count
            };
        }
        
        return { isQuarantined: false, lastAction: null };
    } catch (error) {
        console.error('Failed to get quarantine status from database:', error);
        
        // Fallback to in-memory records
        const guildRecords = quarantineRecords.get(guildId);
        if (!guildRecords) return { isQuarantined: false, lastAction: null };
        
        const userRecords = Array.from(guildRecords.values())
            .filter(record => record.userId === userId)
            .sort((a, b) => b.timestamp - a.timestamp);
        
        if (userRecords.length === 0) {
            return { isQuarantined: false, lastAction: null };
        }
        
        const lastRecord = userRecords[0];
        return {
            isQuarantined: lastRecord.action === 'quarantine',
            lastAction: lastRecord,
            totalRecords: userRecords.length
        };
    }
}

function getQuarantineStats(guildId) {
    const guildRecords = quarantineRecords.get(guildId);
    if (!guildRecords) {
        return {
            totalRecords: 0,
            totalQuarantines: 0,
            totalUnquarantines: 0,
            uniqueUsers: 0,
            activeModerators: 0
        };
    }
    
    const records = Array.from(guildRecords.values());
    const uniqueUsers = new Set(records.map(r => r.userId));
    const activeModerators = new Set(records.map(r => r.moderatorId));
    
    return {
        totalRecords: records.length,
        totalQuarantines: records.filter(r => r.action === 'quarantine').length,
        totalUnquarantines: records.filter(r => r.action === 'unquarantine').length,
        uniqueUsers: uniqueUsers.size,
        activeModerators: activeModerators.size
    };
}

function searchQuarantineRecords(guildId, query, searchType = 'all') {
    const guildRecords = quarantineRecords.get(guildId);
    if (!guildRecords) return [];
    
    const records = Array.from(guildRecords.values());
    const lowerQuery = query.toLowerCase();
    
    return records.filter(record => {
        switch (searchType) {
            case 'username':
                return record.username.toLowerCase().includes(lowerQuery);
            case 'moderator':
                return record.moderatorUsername.toLowerCase().includes(lowerQuery);
            case 'reason':
                return record.reason.toLowerCase().includes(lowerQuery);
            case 'userid':
                return record.userId === query;
            case 'all':
            default:
                return record.username.toLowerCase().includes(lowerQuery) ||
                       record.moderatorUsername.toLowerCase().includes(lowerQuery) ||
                       record.reason.toLowerCase().includes(lowerQuery) ||
                       record.userId === query;
        }
    }).sort((a, b) => b.timestamp - a.timestamp);
}

// =============================================================================
// SLASH COMMANDS
// =============================================================================

const commands = [
    // Moderation commands
    new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Kick a user from the server')
        .addUserOption(option => 
            option.setName('user')
                .setDescription('User to kick')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('reason')
                .setDescription('Reason for kicking')
                .setRequired(false)),
                
    new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Ban a user from the server')
        .addUserOption(option => 
            option.setName('user')
                .setDescription('User to ban')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('reason')
                .setDescription('Reason for banning')
                .setRequired(false)),
                
    new SlashCommandBuilder()
        .setName('unban')
        .setDescription('Unban a user from the server')
        .addStringOption(option => 
            option.setName('userid')
                .setDescription('User ID to unban')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('reason')
                .setDescription('Reason for unbanning')
                .setRequired(false)),
                
    new SlashCommandBuilder()
        .setName('mute')
        .setDescription('Mute a user for a specified duration')
        .addUserOption(option => 
            option.setName('user')
                .setDescription('User to mute')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('duration')
                .setDescription('Duration (e.g., 10m, 1h, 2d)')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('reason')
                .setDescription('Reason for muting')
                .setRequired(false)),
                
    new SlashCommandBuilder()
        .setName('unmute')
        .setDescription('Unmute a user')
        .addUserOption(option => 
            option.setName('user')
                .setDescription('User to unmute')
                .setRequired(true)),
                
    new SlashCommandBuilder()
        .setName('warn')
        .setDescription('Warn a user')
        .addUserOption(option => 
            option.setName('user')
                .setDescription('User to warn')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('reason')
                .setDescription('Reason for warning')
                .setRequired(false)),
                
    new SlashCommandBuilder()
        .setName('clear')
        .setDescription('Delete messages from this channel')
        .addIntegerOption(option => 
            option.setName('amount')
                .setDescription('Number of messages to delete (1-100)')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(100)),
    
    new SlashCommandBuilder()
        .setName('freezenick')
        .setDescription('Freeze a user\'s nickname to prevent changes')
        .addUserOption(option => 
            option.setName('user')
                .setDescription('User to freeze nickname')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('nickname')
                .setDescription('Set a specific nickname (leave empty to freeze current)')
                .setRequired(false))
        .addStringOption(option => 
            option.setName('reason')
                .setDescription('Reason for freezing')
                .setRequired(false)),
    
    new SlashCommandBuilder()
        .setName('unfreezenick')
        .setDescription('Unfreeze a user\'s nickname to allow changes')
        .addUserOption(option => 
            option.setName('user')
                .setDescription('User to unfreeze nickname')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('reason')
                .setDescription('Reason for unfreezing')
                .setRequired(false)),
                
    // Channel management
    new SlashCommandBuilder()
        .setName('lock')
        .setDescription('Lock a channel')
        .addChannelOption(option => 
            option.setName('channel')
                .setDescription('Channel to lock (default: current channel)')
                .setRequired(false))
        .addStringOption(option => 
            option.setName('reason')
                .setDescription('Reason for locking')
                .setRequired(false)),
                
    new SlashCommandBuilder()
        .setName('unlock')
        .setDescription('Unlock a channel')
        .addChannelOption(option => 
            option.setName('channel')
                .setDescription('Channel to unlock (default: current channel)')
                .setRequired(false))
        .addStringOption(option => 
            option.setName('reason')
                .setDescription('Reason for unlocking')
                .setRequired(false)),
                
    new SlashCommandBuilder()
        .setName('viewlock')
        .setDescription('Prevent users from viewing a channel')
        .addChannelOption(option => 
            option.setName('channel')
                .setDescription('Channel to viewlock (default: current channel)')
                .setRequired(false))
        .addStringOption(option => 
            option.setName('reason')
                .setDescription('Reason for viewlocking')
                .setRequired(false)),
                
    new SlashCommandBuilder()
        .setName('viewunlock')
        .setDescription('Allow users to view a channel again')
        .addChannelOption(option => 
            option.setName('channel')
                .setDescription('Channel to viewunlock (default: current channel)')
                .setRequired(false))
        .addStringOption(option => 
            option.setName('reason')
                .setDescription('Reason for viewunlocking')
                .setRequired(false)),
                
    new SlashCommandBuilder()
        .setName('slowmode')
        .setDescription('Set channel slowmode')
        .addIntegerOption(option => 
            option.setName('seconds')
                .setDescription('Slowmode in seconds (0-21600)')
                .setRequired(true)
                .setMinValue(0)
                .setMaxValue(21600))
        .addChannelOption(option => 
            option.setName('channel')
                .setDescription('Channel to set slowmode (default: current channel)')
                .setRequired(false)),
                
    // Utility commands
    new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Check bot latency'),
        
    new SlashCommandBuilder()
        .setName('serverinfo')
        .setDescription('Display server information'),
        
    new SlashCommandBuilder()
        .setName('avatar')
        .setDescription('Display user avatar')
        .addUserOption(option => 
            option.setName('user')
                .setDescription('User to show avatar (default: yourself)')
                .setRequired(false)),
                
    new SlashCommandBuilder()
        .setName('banner')
        .setDescription('Display user banner')
        .addUserOption(option => 
            option.setName('user')
                .setDescription('User to show banner (default: yourself)')
                .setRequired(false)),
                
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show available commands'),
        
    // AFK system
    new SlashCommandBuilder()
        .setName('afk')
        .setDescription('Set your AFK status')
        .addStringOption(option => 
            option.setName('reason')
                .setDescription('Reason for being AFK')
                .setRequired(false)),
                
    // Starboard system
    new SlashCommandBuilder()
        .setName('starboard')
        .setDescription('Manage starboard system')
        .addSubcommand(subcommand =>
            subcommand
                .setName('setup')
                .setDescription('Set up starboard in a channel')
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('Channel for starboard')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('threshold')
                        .setDescription('Number of stars required (default: 3)')
                        .setRequired(false)
                        .setMinValue(1)
                        .setMaxValue(50)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('auto-setup')
                .setDescription('Automatically create and set up starboard')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('Name for the starboard channel')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('threshold')
                .setDescription('Set star threshold')
                .addIntegerOption(option =>
                    option.setName('amount')
                        .setDescription('Number of stars required')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(20)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('info')
                .setDescription('Show starboard configuration')),
                
    // Custom commands
    new SlashCommandBuilder()
        .setName('custom')
        .setDescription('Manage custom commands')
        .addSubcommand(subcommand =>
            subcommand
                .setName('create')
                .setDescription('Create a new custom command')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('Command name')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('response')
                        .setDescription('Command response')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('type')
                        .setDescription('Response type')
                        .setRequired(false)
                        .addChoices(
                            { name: 'Text', value: 'text' },
                            { name: 'Embed', value: 'embed' }
                        )))
        .addSubcommand(subcommand =>
            subcommand
                .setName('edit')
                .setDescription('Edit an existing custom command')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('Command name')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('response')
                        .setDescription('New response')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('type')
                        .setDescription('Response type')
                        .setRequired(false)
                        .addChoices(
                            { name: 'Text', value: 'text' },
                            { name: 'Embed', value: 'embed' }
                        )))
        .addSubcommand(subcommand =>
            subcommand
                .setName('delete')
                .setDescription('Delete a custom command')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('Command name')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List all custom commands'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('info')
                .setDescription('Get info about a custom command')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('Command name')
                        .setRequired(true))),
                        
    // Reminder system
    new SlashCommandBuilder()
        .setName('reminder')
        .setDescription('Manage reminders')
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Set a reminder')
                .addStringOption(option =>
                    option.setName('time')
                        .setDescription('When to remind (e.g., 10m, 2h, 2023-12-25 15:30)')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('message')
                        .setDescription('Reminder message')
                        .setRequired(true))
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('Channel to send reminder (default: current channel)')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List your active reminders'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('cancel')
                .setDescription('Cancel a reminder')
                .addStringOption(option =>
                    option.setName('id')
                        .setDescription('Reminder ID')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('event')
                .setDescription('Schedule an event reminder')
                .addStringOption(option =>
                    option.setName('time')
                        .setDescription('When to remind')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('title')
                        .setDescription('Event title')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('description')
                        .setDescription('Event description')
                        .setRequired(false))
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('Channel to send reminder')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('recurring')
                .setDescription('Set a recurring reminder')
                .addStringOption(option =>
                    option.setName('time')
                        .setDescription('First reminder time')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('interval')
                        .setDescription('Repeat interval (e.g., 1h, 1d, 1w)')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('message')
                        .setDescription('Reminder message')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('max_occurrences')
                        .setDescription('Maximum number of reminders (optional)')
                        .setRequired(false))
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('Channel to send reminders')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('info')
                .setDescription('Get detailed info about a reminder')
                .addStringOption(option =>
                    option.setName('id')
                        .setDescription('Reminder ID')
                        .setRequired(true))),
                        
    // Admin commands
    new SlashCommandBuilder()
        .setName('admin')
        .setDescription('Manage authorized users (Server Owner only)')
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List all authorized users'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add user to authorized list')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('User to add')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove user from authorized list')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('User to remove')
                        .setRequired(true))),
                        
    // Emoji commands
    new SlashCommandBuilder()
        .setName('emoji')
        .setDescription('Manage server emojis')
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add an emoji to the server')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('Emoji name')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('url')
                        .setDescription('Emoji URL or upload attachment')
                        .setRequired(false))
                .addAttachmentOption(option =>
                    option.setName('file')
                        .setDescription('Emoji file')
                        .setRequired(false)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove an emoji from the server')
                .addStringOption(option =>
                    option.setName('emoji')
                        .setDescription('Emoji to remove')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List all server emojis')),
    new SlashCommandBuilder()
        .setName('privacy')
        .setDescription('Manage bot privacy settings')
        .addSubcommand(subcommand =>
            subcommand
                .setName('status')
                .setDescription('Show current privacy settings'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('info')
                .setDescription('Show detailed privacy information')),
                
    new SlashCommandBuilder()
        .setName('setupmute')
        .setDescription('Set up muted role permissions for all channels'),
        
    new SlashCommandBuilder()
        .setName('setupquarantine')
        .setDescription('Set up quarantine role and channel for quarantined users'),
        
    new SlashCommandBuilder()
        .setName('autoreact')
        .setDescription('Manage automatic emoji reactions when users are mentioned')
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Set auto-reaction for a user')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('User to set auto-reaction for')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('emoji')
                        .setDescription('Emoji to react with (Unicode emoji, :name:, or custom emoji)')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove auto-reaction for a user')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('User to remove auto-reaction for')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('toggle')
                .setDescription('Enable/disable auto-reaction for a user')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('User to toggle auto-reaction for')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List all auto-reactions in this server')),
                
    new SlashCommandBuilder()
        .setName('antidoxx')
        .setDescription('Emergency viewlock all channels (Authorized users only)')
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for emergency viewlock')
                .setRequired(false)),
                
    new SlashCommandBuilder()
        .setName('undoantidoxx')
        .setDescription('Restore channel visibility after antidoxx (Authorized users only)')
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for restoring channel visibility')
                .setRequired(false)),
                
    new SlashCommandBuilder()
        .setName('quarantine')
        .setDescription('Quarantine a user by removing their channel access')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to quarantine')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for quarantine')
                .setRequired(false)),
                
    new SlashCommandBuilder()
        .setName('unquarantine')
        .setDescription('Remove quarantine from a user')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('User to unquarantine')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for removing quarantine')
                .setRequired(false)),
                
    new SlashCommandBuilder()
        .setName('quarantineinfo')
        .setDescription('View quarantine records and statistics')
        .addSubcommand(subcommand =>
            subcommand
                .setName('user')
                .setDescription('View quarantine history for a specific user')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('User to check')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('history')
                .setDescription('View recent quarantine history')
                .addIntegerOption(option =>
                    option.setName('limit')
                        .setDescription('Number of records to show (max 25)')
                        .setRequired(false)
                        .setMinValue(1)
                        .setMaxValue(25)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('stats')
                .setDescription('View quarantine statistics for this server'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('search')
                .setDescription('Search quarantine records')
                .addStringOption(option =>
                    option.setName('query')
                        .setDescription('Search term')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('type')
                        .setDescription('Search type')
                        .setRequired(false)
                        .addChoices(
                            { name: 'All', value: 'all' },
                            { name: 'Username', value: 'username' },
                            { name: 'Moderator', value: 'moderator' },
                            { name: 'Reason', value: 'reason' },
                            { name: 'User ID', value: 'userid' }
                        )))
];

module.exports = { client, commands };

// =============================================================================
// EVENT HANDLERS
// =============================================================================

client.once('ready', async () => {
    console.log(`✅ Bot is ready! Logged in as ${client.user.tag}`);
    console.log(`📊 Serving ${client.guilds.cache.size} servers with ${client.users.cache.size} users`);
    
    // Initialize database connection
    console.log('🔄 Initializing database connection...');
    try {
        const mongoUri = process.env.MONGODB_URI;
        const redisConfig = {
            host: process.env.REDIS_HOST,
            port: process.env.REDIS_PORT,
            password: process.env.REDIS_PASSWORD
        };
        
        console.log('📋 Database configuration:');
        console.log(`   MongoDB URI: ${mongoUri ? 'Found' : 'Missing'}`);
        console.log(`   Redis Config: ${redisConfig.host && redisConfig.port ? 'Found' : 'Missing'}`);
        
        await DatabaseService.initialize(mongoUri, redisConfig);
        console.log('✅ Database connected successfully');
    } catch (error) {
        console.error('❌ Database initialization failed:', error);
        console.log('⚠️ Bot will continue with limited functionality');
    }
    
    // Load all persistent data from database into memory for fast access
    await loadAllPersistentData();
    console.log('✅ Bot fully initialized with database support');

    
    // Optimized periodic data maintenance (reduced frequency since data is now real-time)
    setInterval(async () => {
        try {
            // Only save legacy data that might still be in memory
            await saveAllBotData();
            
            // Check database health periodically
            const healthStatus = await DatabaseService.healthCheck();
            if (!healthStatus.mongodb || !healthStatus.redis) {
                console.warn('⚠️ Database health check failed:', healthStatus);
            }
            
            console.log('💾 Periodic maintenance completed');
        } catch (error) {
            console.error('❌ Error in periodic maintenance:', error);
        }
    }, 10 * 60 * 1000); // Every 10 minutes (less frequent since database is real-time)
    
    // Enhanced cleanup on process exit
    const gracefulShutdown = async (signal) => {
        console.log(`🛑 Received ${signal}. Bot shutting down gracefully...`);
        
        // Clear all active timeouts to prevent memory leaks
        console.log(`🧹 Clearing ${activeTimeouts.size} active timeouts...`);
        for (const [reminderId, timeoutId] of activeTimeouts) {
            clearTimeout(timeoutId);
        }
        activeTimeouts.clear();
        
        // Save all data
        console.log('💾 Saving all data...');
        saveAllBotData();
        
        // Close client connection
        if (client.isReady()) {
            console.log('� Closing Discord connection...');
            await client.destroy();
        }
        
        console.log('✅ Graceful shutdown completed');
        process.exit(0);
    };
    
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
        logError('uncaughtException', error);
        gracefulShutdown('uncaughtException');
    });
    
    process.on('unhandledRejection', (reason, promise) => {
        logError('unhandledRejection', new Error(reason), { promise });
    });
    
    // Auto-setup muted roles for all servers
    await autoSetupMutedRoles();
    
    // Ensure quarantine system is properly set up for all servers
    console.log('🔧 Setting up quarantine systems for all servers...');
    for (const [guildId, guild] of client.guilds.cache) {
        try {
            const quarantineSetup = await setupQuarantineSystem(guild);
            if (quarantineSetup.success) {
                console.log(`✅ Quarantine system verified for ${guild.name}`);
            } else {
                console.error(`❌ Quarantine system setup failed for ${guild.name}:`, quarantineSetup.error);
            }
        } catch (error) {
            console.error(`Error setting up quarantine system for ${guild.name}:`, error);
        }
    }
    
    // Reschedule all reminders on startup
    let rescheduledCount = 0;
    for (const [reminderId, reminder] of reminders) {
        if (reminder.timestamp > Date.now()) {
            scheduleReminder(reminderId);
            rescheduledCount++;
        } else {
            // Clean up expired reminders
            deleteReminder(reminderId);
        }
    }
    console.log(`🔄 Rescheduled ${rescheduledCount} active reminders`);
});

// Error handling
client.on('error', error => {
    console.error('Discord client error:', error);
});

client.on('warn', warning => {
    console.warn('Discord client warning:', warning);
});

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

// Message event for prefix commands and AFK system
client.on('messageCreate', async message => {
    // Early returns for performance
    if (message.author.bot || !message.guild) return;
    
    // Privacy check - only respond if not in private mode or user is authorized
    if (isPrivateModeEnabled() && !canUseBot(message.member)) {
        return; // Silently ignore unauthorized users
    }
    
    // Performance: Start timing for metrics
    const startTime = Date.now();
    
    // Check if user is returning from AFK
    const afkData = await DatabaseService.getUserAFK(message.author.id, message.guild.id);
    if (afkData) {
        const timeAway = Date.now() - new Date(afkData.createdAt).getTime();
        
        // Clear AFK status from database
        await DatabaseService.removeUserAFK(message.author.id, message.guild.id);
        
        const embed = new EmbedBuilder()
            .setColor('#4ecdc4')
            .setTitle('👋 Welcome Back!')
            .setDescription(`You were AFK for **${formatAfkDuration(new Date(afkData.createdAt).getTime())}**`)
            .addFields({ name: 'Previous Status', value: afkData.reason })
            .setTimestamp();
        
        try {
            await message.reply({ embeds: [embed] });
        } catch (error) {
            console.error('Error sending AFK return message:', error);
        }
        
        // Send DM with missed mentions if any
        const userMentions = afkData.mentions || [];
        if (userMentions.length > 0) {
            try {
                const mentionEmbed = new EmbedBuilder()
                    .setColor('#4ecdc4')
                    .setTitle('📨 Missed Mentions While AFK')
                    .setDescription(`You were mentioned **${userMentions.length}** time(s) while away:`)
                    .setFooter({ text: `Total AFK time: ${formatAfkDuration(new Date(afkData.createdAt).getTime())}` });
                
                // Group mentions by channel for better organization
                const mentionsByChannel = {};
                userMentions.forEach((mention) => {
                    const channelName = `<#${mention.channelId}>`;
                    if (!mentionsByChannel[channelName]) {
                        mentionsByChannel[channelName] = [];
                    }
                    mentionsByChannel[channelName].push(mention);
                });
                
                let fieldCount = 0;
                for (const [channelName, mentions] of Object.entries(mentionsByChannel)) {
                    if (fieldCount >= 8) break; // Limit fields to avoid embed limits
                    
                    const mentionTexts = mentions.slice(0, 3).map(mention => 
                        `**${mention.username}**: [Jump to message](https://discord.com/channels/${message.guild.id}/${mention.channelId}/${mention.messageId})`
                    );
                    
                    if (mentions.length > 3) {
                        mentionTexts.push(`*+${mentions.length - 3} more mentions...*`);
                    }
                    
                    mentionEmbed.addFields({
                        name: `#${channelName} (${mentions.length})`,
                        value: mentionTexts.join('\n'),
                        inline: false
                    });
                    fieldCount++;
                }
                
                if (Object.keys(mentionsByChannel).length > 8) {
                    mentionEmbed.setFooter({ 
                        text: `And mentions in ${Object.keys(mentionsByChannel).length - 8} more channels... | Total AFK time: ${formatAfkDuration(new Date(afkData.createdAt).getTime())}` 
                    });
                }
                
                await message.author.send({ embeds: [mentionEmbed] });
            } catch (error) {
                console.error('Error sending missed mentions DM:', error);
                // Try to inform user in the channel if DM fails
                try {
                    const dmFailEmbed = new EmbedBuilder()
                        .setColor('#ffa500')
                        .setDescription(`📨 I couldn't DM you your ${userMentions.length} missed mentions. Please check your DM settings.`)
                        .setTimestamp();
                    await message.reply({ embeds: [dmFailEmbed] });
                } catch (dmError) {
                    console.error('Error sending DM failure notification:', dmError);
                }
            }
            
            // Mentions are now automatically handled in database
        }
    }
    
    // Check for mentions of AFK users
    if (message.mentions.users.size > 0) {
        for (const [userId, user] of message.mentions.users) {
            try {
                const afkData = await DatabaseService.getUserAFK(userId, message.guild.id);
                if (afkData) {
                    const timeAway = Date.now() - new Date(afkData.createdAt).getTime();
                    
                    const embed = new EmbedBuilder()
                        .setColor('#ffa500')
                        .setTitle('💤 User is AFK')
                        .setDescription(`**${user.displayName}** is currently AFK`)
                        .addFields(
                            { name: '💭 Reason', value: afkData.reason, inline: true },
                            { name: '⏱️ Away for', value: formatAfkDuration(new Date(afkData.createdAt).getTime()), inline: true },
                            { name: '📅 Since', value: `<t:${Math.floor(new Date(afkData.createdAt).getTime() / 1000)}:R>`, inline: true }
                        )
                        .setThumbnail(user.displayAvatarURL({ dynamic: true }))
                        .setTimestamp();
                    
                    try {
                        await message.reply({ embeds: [embed] });
                    } catch (error) {
                        logError('AFK mention reply', error, { userId, guildId: message.guild.id });
                    }
                    
                    // Log mention in database
                    const mentionData = {
                        userId: message.author.id,
                        username: message.author.displayName,
                        channelId: message.channel.id,
                        messageId: message.id,
                        timestamp: new Date()
                    };
                    
                    await DatabaseService.addAFKMention(userId, message.guild.id, mentionData);
                    
                    // Get updated mention count from database for DM logic
                    const updatedAfkData = await DatabaseService.getUserAFK(userId, message.guild.id);
                    const userMentions = updatedAfkData?.mentions || [];
                    const recentMentions = userMentions.filter(m => Date.now() - new Date(m.timestamp).getTime() < 5 * 60 * 1000); // Last 5 minutes
                    
                    // Only send DM for first mention or every 5th mention to avoid spam
                    if (userMentions.length === 1 || userMentions.length % 5 === 0) {
                        try {
                            const dmEmbed = new EmbedBuilder()
                                .setColor('#4ecdc4')
                                .setTitle('📨 You were mentioned!')
                                .setDescription(`**${message.author.displayName}** mentioned you in **${message.guild.name}**`)
                                .addFields(
                                    { name: '📍 Channel', value: `<#${message.channel.id}>`, inline: true },
                                    { name: '📊 Total Mentions', value: `${userMentions.length}`, inline: true },
                                    { name: '🕐 Recent (5m)', value: `${recentMentions.length}`, inline: true },
                                    { name: '💬 Message', value: message.content.substring(0, 1000) || '*No text content*', inline: false },
                                    { name: '🔗 Jump to Message', value: `[Click here](${message.url})`, inline: false }
                                )
                                .setFooter({ text: `AFK since ${new Date(afkData.createdAt).toLocaleString()}` })
                                .setTimestamp();
                            
                            await user.send({ embeds: [dmEmbed] });
                        } catch (error) {
                            logError('AFK mention DM', error, { userId, guildId: message.guild.id });
                        }
                    }
                }
            } catch (error) {
                logError('AFK mention processing', error, { userId, guildId: message.guild.id });
            }
        }
    }
    
    // Handle auto-reactions for user mentions
    if (message.mentions.users.size > 0 && !message.author.bot) {
        const guildReactions = await getGuildAutoReactions(message.guild.id);
        
        for (const [userId, user] of message.mentions.users) {
            if (guildReactions.has(userId)) {
                const reactionData = guildReactions.get(userId);
                
                // Only react if auto-reaction is enabled
                if (reactionData.enabled) {
                    try {
                        await message.react(reactionData.emoji);
                    } catch (error) {
                        console.error(`Error adding auto-reaction ${reactionData.emoji} for user ${user.tag}:`, error);
                        
                        // If the emoji is invalid, disable the auto-reaction
                        if (error.code === 10014 || error.message.includes('Unknown Emoji')) {
                            console.log(`Disabling invalid auto-reaction emoji for user ${user.tag}`);
                            reactionData.enabled = false;
                            guildReactions.set(userId, reactionData);
                        }
                    }
                }
            }
        }
    }
    
    // Handle prefix commands
    if (!message.content.startsWith(PREFIX)) return;
    
    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();
    
    // Check for custom commands first
    const guildCommands = getGuildCustomCommands(message.guild.id);
    if (guildCommands.has(commandName)) {
        // Check if user has permission to use custom commands
        if (!hasCustomCommandPermissions(message.member)) {
            const embed = createErrorEmbed('Permission Denied', 'Only authorized users, server owners, and bot owners can use custom commands.');
            return message.reply({ embeds: [embed] });
        }
        
        const customCommand = guildCommands.get(commandName);
        const processedResponse = processCustomCommandResponse(
            customCommand.response,
            message.author,
            message.guild,
            message.channel
        );
        
        try {
            if (customCommand.type === 'embed') {
                const [title, description] = processedResponse.split('|');
                const embed = new EmbedBuilder()
                    .setColor('#4ecdc4')
                    .setTitle(title || 'Custom Command')
                    .setDescription(description || processedResponse)
                    .setTimestamp();
                await message.reply({ embeds: [embed] });
            } else {
                await message.reply(processedResponse);
            }
            
            // Track command usage in database
            try {
                await DatabaseService.incrementCommandUsage(message.guild.id, commandName);
                // Update local cache
                if (customCommand.useCount !== undefined) {
                    customCommand.useCount++;
                } else {
                    customCommand.useCount = 1;
                }
            } catch (usageError) {
                console.error('Failed to track command usage:', usageError);
                // Don't fail the command execution for tracking errors
            }
        } catch (error) {
            console.error('Error executing custom command:', error);
            await message.reply('❌ Error executing custom command.');
        }
        return;
    }
    
    // Built-in prefix commands
    try {
        switch (commandName) {
            case 'kick':
                await handleKickCommand(message, args);
                break;
            case 'ban':
                await handleBanCommand(message, args);
                break;
            case 'unban':
                await handleUnbanCommand(message, args);
                break;
            case 'mute':
                await handleMuteCommand(message, args);
                break;
            case 'unmute':
                await handleUnmuteCommand(message, args);
                break;
            case 'warn':
                await handleWarnCommand(message, args);
                break;
            case 'clear':
                await handleClearCommand(message, args);
                break;
            case 'freezenick':
                await handleFreezeNickCommand(message, args);
                break;
            case 'unfreezenick':
                await handleUnfreezeNickCommand(message, args);
                break;
            case 'lock':
                await handleLockCommand(message, args);
                break;
            case 'unlock':
                await handleUnlockCommand(message, args);
                break;
            case 'viewlock':
                await handleViewlockCommand(message, args);
                break;
            case 'viewunlock':
                await handleViewunlockCommand(message, args);
                break;
            case 'slowmode':
                await handleSlowmodeCommand(message, args);
                break;
            case 'ping':
                await handlePingCommand(message);
                break;
            case 'serverinfo':
                await handleServerInfoCommand(message);
                break;
            case 'avatar':
                await handleAvatarCommand(message, args);
                break;
            case 'banner':
                await handleBannerCommand(message, args);
                break;
            case 'afk':
                await handleAfkCommand(message, args);
                break;
            case 'afkclear':
            case 'unafk':
                await handleAfkClearCommand(message);
                break;
            case 'afklist':
            case 'whoafk':
                await handleAfkListCommand(message);
                break;
            case 'remindme':
                await handleRemindMeCommand(message, args);
                break;
            case 'reminders':
                await handleRemindersCommand(message);
                break;
            case 'help':
                await handleHelpCommand(message);
                break;
            case 'privacy':
                await handlePrivacyCommand(message, args);
                break;
            case 'setupmute':
                await handleSetupMuteCommand(message);
                break;
            case 'setupquarantine':
                await handleSetupQuarantineCommand(message);
                break;
            case 'admin':
                await handleAdminCommand(message, args);
                break;
            case 'antidoxx':
                await handleAntidoxxCommand(message, args);
                break;
            case 'undoantidoxx':
                await handleUndoAntidoxxCommand(message, args);
                break;
            case 'quarantine':
                await handleQuarantineCommand(message, args);
                break;
            case 'unquarantine':
                await handleUnquarantineCommand(message, args);
                break;
            case 'quarantineinfo':
                await handleQuarantineInfoCommand(message, args);
                break;
        }
    } catch (error) {
        console.error(`Error executing command ${commandName}:`, error);
        await message.reply('❌ An error occurred while executing the command.');
    } finally {
        // Record performance metrics
        const duration = Date.now() - startTime;
        performanceMetrics.recordCommand(duration);
    }
});

// Slash command interaction handler
client.on('interactionCreate', async interaction => {
    const startTime = Date.now();
    
    if (!interaction.isChatInputCommand()) return;
    
    // Privacy check - only respond if not in private mode or user is authorized
    if (isPrivateModeEnabled() && !canUseBot(interaction.member)) {
        const embed = new EmbedBuilder()
            .setColor('#ff4757')
            .setTitle('🔒 Access Denied')
            .setDescription('This bot is in private mode. You are not authorized to use it.')
            .setFooter({ text: 'Contact the bot owner for access' });
        
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
    
    try {
        switch (interaction.commandName) {
            case 'kick':
                await handleKickSlash(interaction);
                break;
            case 'ban':
                await handleBanSlash(interaction);
                break;
            case 'unban':
                await handleUnbanSlash(interaction);
                break;
            case 'mute':
                await handleMuteSlash(interaction);
                break;
            case 'unmute':
                await handleUnmuteSlash(interaction);
                break;
            case 'warn':
                await handleWarnSlash(interaction);
                break;
            case 'clear':
                await handleClearSlash(interaction);
                break;
            case 'freezenick':
                await handleFreezeNickSlash(interaction);
                break;
            case 'unfreezenick':
                await handleUnfreezeNickSlash(interaction);
                break;
            case 'lock':
                await handleLockSlash(interaction);
                break;
            case 'unlock':
                await handleUnlockSlash(interaction);
                break;
            case 'viewlock':
                await handleViewlockSlash(interaction);
                break;
            case 'viewunlock':
                await handleViewunlockSlash(interaction);
                break;
            case 'slowmode':
                await handleSlowmodeSlash(interaction);
                break;
            case 'ping':
                await handlePingSlash(interaction);
                break;
            case 'serverinfo':
                await handleServerInfoSlash(interaction);
                break;
            case 'avatar':
                await handleAvatarSlash(interaction);
                break;
            case 'banner':
                await handleBannerSlash(interaction);
                break;
            case 'afk':
                await handleAfkSlash(interaction);
                break;
            case 'help':
                await handleHelpSlash(interaction);
                break;
            case 'starboard':
                await handleStarboardSlash(interaction);
                break;
            case 'custom':
                await handleCustomSlash(interaction);
                break;
            case 'reminder':
                await handleReminderSlash(interaction);
                break;
            case 'admin':
                await handleAdminSlash(interaction);
                break;
            case 'emoji':
                await handleEmojiSlash(interaction);
                break;
            case 'autoreact':
                await handleAutoreactSlash(interaction);
                break;
            case 'privacy':
                await handlePrivacySlash(interaction);
                break;
            case 'setupmute':
                await handleSetupMuteSlash(interaction);
                break;
            case 'setupquarantine':
                await handleSetupQuarantineSlash(interaction);
                break;
            case 'antidoxx':
                await handleAntidoxxSlash(interaction);
                break;
            case 'undoantidoxx':
                await handleUndoAntidoxxSlash(interaction);
                break;
            case 'quarantine':
                await handleQuarantineSlash(interaction);
                break;
            case 'unquarantine':
                await handleUnquarantineSlash(interaction);
                break;
            case 'quarantineinfo':
                await handleQuarantineInfoSlash(interaction);
                break;
        }
    } catch (error) {
        console.error(`Error executing slash command ${interaction.commandName}:`, error);
        logError('interactionCreate:command', error, { 
            commandName: interaction.commandName,
            userId: interaction.user.id,
            guildId: interaction.guild?.id 
        });
        
        const errorEmbed = createErrorEmbed(
            'Command Error',
            'An error occurred while executing this command.'
        );
        
        try {
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
            } else {
                await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
            }
        } catch (criticalError) {
            logError('interactionCreate:critical', criticalError, { 
                commandName: interaction.commandName,
                userId: interaction.user.id 
            });
        }
    } finally {
        // Record performance metrics
        const duration = Date.now() - startTime;
        performanceMetrics.recordCommand(duration);
    }
});

// Message reaction handlers for starboard
client.on('messageReactionAdd', async (reaction, user) => {
    try {
        if (user.bot) return;
        
        // Fetch partial reactions
        if (reaction.partial) {
            try {
                await reaction.fetch();
            } catch (error) {
                console.error('Error fetching reaction:', error);
                return;
            }
        }
        
        // Fetch partial messages
        if (reaction.message.partial) {
            try {
                await reaction.message.fetch();
            } catch (error) {
                console.error('Error fetching message:', error);
                return;
            }
        }
        
        if (reaction.emoji.name === '⭐') {
            await handleStarReaction(reaction, user, 'add');
        }
    } catch (error) {
        console.error('Error in messageReactionAdd:', error);
    }
});

client.on('messageReactionRemove', async (reaction, user) => {
    try {
        if (user.bot) return;
        
        // Fetch partial reactions
        if (reaction.partial) {
            try {
                await reaction.fetch();
            } catch (error) {
                console.error('Error fetching reaction:', error);
                return;
            }
        }
        
        // Fetch partial messages
        if (reaction.message.partial) {
            try {
                await reaction.message.fetch();
            } catch (error) {
                console.error('Error fetching message:', error);
                return;
            }
        }
        
        if (reaction.emoji.name === '⭐') {
            await handleStarReaction(reaction, user, 'remove');
        }
    } catch (error) {
        console.error('Error in messageReactionRemove:', error);
    }
});

// Handle message deletion to clean up starboard
client.on('messageDelete', async (message) => {
    try {
        // Handle partial messages
        if (message.partial) {
            try {
                await message.fetch();
            } catch (error) {
                console.log('[Starboard] Could not fetch partial deleted message, using cached data');
            }
        }

        // Check if this message was on the starboard
        if (starboardMessages.has(message.id)) {
            const starboardMessageId = starboardMessages.get(message.id);
            
            // Get config from memory or database
            let config = starboardConfigs.get(message.guild?.id);
            if (!config && message.guild) {
                config = await getStarboardConfig(message.guild.id);
            }
            
            if (config && config.channelId && message.guild) {
                try {
                    const starboardChannel = await message.guild.channels.fetch(config.channelId);
                    if (starboardChannel) {
                        // Delete the starboard message
                        const starboardMsg = await starboardChannel.messages.fetch(starboardMessageId).catch(() => null);
                        if (starboardMsg) {
                            await starboardMsg.delete();
                            console.log(`[Starboard] Deleted starboard message for deleted original message ${message.id}`);
                        }
                    }
                } catch (error) {
                    console.error('[Starboard] Error deleting starboard message:', error);
                }
            }
            
            // Remove from tracking
            starboardMessages.delete(message.id);
            if (message.guild) {
                await DatabaseService.deleteStarboardMessage(message.guild.id, message.id);
            }
        }
    } catch (error) {
        console.error('[Starboard] Error in messageDelete handler:', error);
    }
});

// Auto-setup mute and quarantine permissions for new channels
client.on('channelCreate', async (channel) => {
    try {
        if (channel.guild) {
            const mutedRole = channel.guild.roles.cache.find(role => role.name === 'Muted');
            const quarantinedRole = channel.guild.roles.cache.find(role => role.name === 'Quarantined');
            
            if (mutedRole) {
                // Set mute permissions for the new channel
                if (channel.type === 0 || channel.type === 2 || channel.type === 5 || channel.type === 13) {
                    const permissions = {
                        SendMessages: false,
                        AddReactions: false,
                        SendMessagesInThreads: false,
                        CreatePublicThreads: false,
                        CreatePrivateThreads: false,
                        UseApplicationCommands: false
                    };
                    
                    // Add voice-specific permissions for voice channels
                    if (channel.type === 2 || channel.type === 13) { // Voice or Stage channels
                        permissions.Speak = false;
                        permissions.Connect = false;
                        permissions.Stream = false;
                        permissions.UseVAD = false;
                        permissions.RequestToSpeak = false;
                    }
                    
                    await channel.permissionOverwrites.edit(mutedRole, permissions, {
                        reason: 'Auto-setup mute permissions for new channel'
                    });
                    
                    console.log(`🔧 Auto-configured mute permissions for new channel: ${channel.name} in ${channel.guild.name}`);
                }
            }
            
            if (quarantinedRole) {
                // Set quarantine permissions for the new channel
                if (channel.type === 0 || channel.type === 2 || channel.type === 4 || channel.type === 5 || channel.type === 13 || channel.type === 15) {
                    const permissions = {
                        ViewChannel: false,
                        SendMessages: false,
                        AddReactions: false,
                        SendMessagesInThreads: false,
                        CreatePublicThreads: false,
                        CreatePrivateThreads: false,
                        UseApplicationCommands: false,
                        Connect: false,
                        Speak: false,
                        Stream: false,
                        UseVAD: false,
                        RequestToSpeak: false,
                        ReadMessageHistory: false
                    };
                    
                    await channel.permissionOverwrites.edit(quarantinedRole, permissions, {
                        reason: 'Auto-setup quarantine permissions for new channel'
                    });
                    
                    console.log(`🔧 Auto-configured quarantine permissions for new channel: ${channel.name} in ${channel.guild.name}`);
                }
            }
        }
    } catch (error) {
        console.error('Error setting up moderation permissions for new channel:', error);
    }
});

// Handle nickname changes to enforce frozen nicknames
client.on('guildMemberUpdate', async (oldMember, newMember) => {
    try {
        // Check if nickname changed
        if (oldMember.nickname === newMember.nickname) {
            return; // No nickname change
        }

        // Check if this user's nickname is frozen
        const frozenData = await DatabaseService.getFrozenNickname(newMember.id, newMember.guild.id);
        
        if (frozenData && frozenData.active) {
            const frozenNickname = frozenData.frozenNickname;
            
            // If nickname was changed to something other than frozen nickname, revert it
            if (newMember.nickname !== frozenNickname) {
                try {
                    await newMember.setNickname(frozenNickname, 'Nickname is frozen by moderator');
                    
                    // Try to DM the user about the frozen nickname
                    try {
                        const dmEmbed = new EmbedBuilder()
                            .setColor('#ffa500')
                            .setTitle('🔒 Nickname Change Prevented')
                            .setDescription(`Your nickname in **${newMember.guild.name}** is currently frozen.`)
                            .addFields(
                                { name: '📛 Frozen Nickname', value: frozenNickname, inline: true },
                                { name: '📝 Reason', value: frozenData.reason || 'No reason provided', inline: false }
                            )
                            .setFooter({ text: 'Contact a moderator to unfreeze your nickname.' })
                            .setTimestamp();

                        await newMember.user.send({ embeds: [dmEmbed] });
                    } catch (dmError) {
                        // Silently fail DM if user has DMs disabled
                        logError('guildMemberUpdate - Frozen nick DM', dmError, { userId: newMember.id });
                    }
                } catch (error) {
                    logError('guildMemberUpdate - Revert nickname', error, { userId: newMember.id, guildId: newMember.guild.id });
                }
            }
        }
    } catch (error) {
        logError('guildMemberUpdate', error, { userId: newMember.id, guildId: newMember.guild.id });
    }
});

// =============================================================================
// COMMAND HANDLERS
// =============================================================================

// Moderation command handlers
async function handleKickCommand(message, args) {
    if (!hasModeratorPermissions(message.member)) {
        return message.reply('❌ You need moderator permissions to use this command.');
    }
    
    const user = message.mentions.users.first();
    if (!user) {
        return message.reply('❌ Please mention a user to kick.');
    }
    
    const member = message.guild.members.cache.get(user.id);
    if (!member) {
        return message.reply('❌ User not found in this server.');
    }
    
    if (!member.kickable) {
        return message.reply('❌ I cannot kick this user.');
    }
    
    const reason = args.slice(1).join(' ') || 'No reason provided';
    
    try {
        await member.kick(reason);
        const embed = createSuccessEmbed(
            'User Kicked',
            `**${user.tag}** has been kicked.\n**Reason:** ${reason}`
        );
        await message.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Error kicking user:', error);
        await message.reply('❌ Failed to kick user.');
    }
}

async function handleKickSlash(interaction) {
    if (!hasModeratorPermissions(interaction.member)) {
        return interaction.reply({ 
            embeds: [createErrorEmbed('Permission Denied', 'You need moderator permissions to use this command.')], 
            flags: MessageFlags.Ephemeral 
        });
    }
    
    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    
    const member = interaction.guild.members.cache.get(user.id);
    if (!member) {
        return interaction.reply({ 
            embeds: [createErrorEmbed('User Not Found', 'User not found in this server.')], 
            flags: MessageFlags.Ephemeral 
        });
    }
    
    if (!member.kickable) {
        return interaction.reply({ 
            embeds: [createErrorEmbed('Cannot Kick', 'I cannot kick this user.')], 
            flags: MessageFlags.Ephemeral 
        });
    }
    
    try {
        await member.kick(reason);
        const embed = createSuccessEmbed(
            'User Kicked',
            `**${user.tag}** has been kicked.\n**Reason:** ${reason}`
        );
        await interaction.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Error kicking user:', error);
        await interaction.reply({ 
            embeds: [createErrorEmbed('Kick Failed', 'Failed to kick user.')], 
            flags: MessageFlags.Ephemeral 
        });
    }
}

async function handleBanCommand(message, args) {
    if (!hasModeratorPermissions(message.member)) {
        return message.reply('❌ You need moderator permissions to use this command.');
    }
    
    const user = message.mentions.users.first();
    if (!user) {
        return message.reply('❌ Please mention a user to ban.');
    }
    
    const member = message.guild.members.cache.get(user.id);
    if (member && !member.bannable) {
        return message.reply('❌ I cannot ban this user.');
    }
    
    const reason = args.slice(1).join(' ') || 'No reason provided';
    
    try {
        // Try to DM the user before banning them
        try {
            const dmEmbed = new EmbedBuilder()
                .setColor('#ff4757')
                .setTitle('🔨 You have been banned')
                .setDescription(`You have been banned from **${message.guild.name}**`)
                .addFields(
                    { name: 'Reason', value: reason, inline: false },
                    { name: 'Banned by', value: `${message.author.tag}`, inline: true },
                    { name: 'Server', value: message.guild.name, inline: true }
                )
                .setTimestamp()
                .setFooter({ text: 'If you believe this ban was issued in error, please contact the server moderators.' });
            
            await user.send({ embeds: [dmEmbed] });
        } catch (error) {
            console.log(`Could not send ban DM to ${user.tag} - they may have DMs disabled`);
        }
        
        await message.guild.members.ban(user, { reason });
        const embed = createSuccessEmbed(
            'User Banned',
            `**${user.tag}** has been banned.\n**Reason:** ${reason}`
        );
        await message.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Error banning user:', error);
        await message.reply('❌ Failed to ban user.');
    }
}

async function handleBanSlash(interaction) {
    if (!hasModeratorPermissions(interaction.member)) {
        return interaction.reply({ 
            embeds: [createErrorEmbed('Permission Denied', 'You need moderator permissions to use this command.')], 
            flags: MessageFlags.Ephemeral 
        });
    }
    
    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    
    const member = interaction.guild.members.cache.get(user.id);
    if (member && !member.bannable) {
        return interaction.reply({ 
            embeds: [createErrorEmbed('Cannot Ban', 'I cannot ban this user.')], 
            flags: MessageFlags.Ephemeral 
        });
    }
    
    try {
        // Try to DM the user before banning them
        try {
            const dmEmbed = new EmbedBuilder()
                .setColor('#ff4757')
                .setTitle('🔨 You have been banned')
                .setDescription(`You have been banned from **${interaction.guild.name}**`)
                .addFields(
                    { name: 'Reason', value: reason, inline: false },
                    { name: 'Banned by', value: `${interaction.user.tag}`, inline: true },
                    { name: 'Server', value: interaction.guild.name, inline: true }
                )
                .setTimestamp()
                .setFooter({ text: 'If you believe this ban was issued in error, please contact the server moderators.' });
            
            await user.send({ embeds: [dmEmbed] });
        } catch (error) {
            console.log(`Could not send ban DM to ${user.tag} - they may have DMs disabled`);
        }
        
        await interaction.guild.members.ban(user, { reason });
        const embed = createSuccessEmbed(
            'User Banned',
            `**${user.tag}** has been banned.\n**Reason:** ${reason}`
        );
        await interaction.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Error banning user:', error);
        await interaction.reply({ 
            embeds: [createErrorEmbed('Ban Failed', 'Failed to ban user.')], 
            flags: MessageFlags.Ephemeral 
        });
    }
}

async function handleUnbanCommand(message, args) {
    if (!hasModeratorPermissions(message.member)) {
        return message.reply('❌ You need moderator permissions to use this command.');
    }
    
    const userId = args[0];
    if (!userId) {
        return message.reply('❌ Please provide a user ID to unban.\nExample: `!unban 123456789012345678`');
    }
    
    // Validate user ID format
    if (!/^\d{17,19}$/.test(userId)) {
        return message.reply('❌ Invalid user ID format. User IDs should be 17-19 digits.');
    }
    
    const reason = args.slice(1).join(' ') || 'No reason provided';
    
    try {
        // Check if user is actually banned
        const bans = await message.guild.bans.fetch();
        const bannedUser = bans.get(userId);
        
        if (!bannedUser) {
            return message.reply('❌ User is not banned or user ID not found.');
        }
        
        await message.guild.members.unban(userId, reason);
        
        const embed = createSuccessEmbed(
            'User Unbanned',
            `**${bannedUser.user.tag}** has been unbanned.\n**Reason:** ${reason}`
        );
        await message.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Error unbanning user:', error);
        await message.reply('❌ Failed to unban user. Please check the user ID and try again.');
    }
}

async function handleUnbanSlash(interaction) {
    if (!hasModeratorPermissions(interaction.member)) {
        return interaction.reply({ 
            embeds: [createErrorEmbed('Permission Denied', 'You need moderator permissions to use this command.')], 
            flags: MessageFlags.Ephemeral 
        });
    }
    
    const userId = interaction.options.getString('userid');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    
    // Validate user ID format
    if (!/^\d{17,19}$/.test(userId)) {
        return interaction.reply({ 
            embeds: [createErrorEmbed('Invalid User ID', 'User IDs should be 17-19 digits.')], 
            flags: MessageFlags.Ephemeral 
        });
    }
    
    try {
        // Check if user is actually banned
        const bans = await interaction.guild.bans.fetch();
        const bannedUser = bans.get(userId);
        
        if (!bannedUser) {
            return interaction.reply({ 
                embeds: [createErrorEmbed('User Not Banned', 'User is not banned or user ID not found.')], 
                flags: MessageFlags.Ephemeral 
            });
        }
        
        await interaction.guild.members.unban(userId, reason);
        
        const embed = createSuccessEmbed(
            'User Unbanned',
            `**${bannedUser.user.tag}** has been unbanned.\n**Reason:** ${reason}`
        );
        await interaction.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Error unbanning user:', error);
        await interaction.reply({ 
            embeds: [createErrorEmbed('Unban Failed', 'Failed to unban user. Please check the user ID and try again.')], 
            flags: MessageFlags.Ephemeral 
        });
    }
}

async function handleSetupMuteSlash(interaction) {
    if (!hasModeratorPermissions(interaction.member)) {
        return interaction.reply({ 
            embeds: [createErrorEmbed('Permission Denied', 'You need moderator permissions to use this command.')], 
            flags: MessageFlags.Ephemeral 
        });
    }
    
    try {
        await interaction.deferReply();
        
        // Get or create muted role and set up permissions
        const mutedRole = await getMutedRole(interaction.guild);
        
        if (!mutedRole) {
            return interaction.editReply({ 
                embeds: [createErrorEmbed('Setup Failed', 'Could not create or find the muted role.')] 
            });
        }
        
        const embed = createSuccessEmbed(
            'Muted Role Setup Complete',
            'Successfully configured mute permissions!'
        )
        .addFields(
            { name: 'Role Name', value: mutedRole.name, inline: true },
            { name: 'Role ID', value: mutedRole.id, inline: true },
            { name: 'Position', value: `${mutedRole.position}`, inline: true }
        )
        .setFooter({ text: 'Mute permissions have been applied to all channels' });
        
        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error('Error in setupmute slash command:', error);
        await interaction.editReply({ 
            embeds: [createErrorEmbed('Setup Failed', 'An error occurred while setting up the muted role.')] 
        });
    }
}

async function handleSetupQuarantineCommand(message) {
    if (!hasModeratorPermissions(message.member)) {
        return message.reply('❌ You need moderator permissions to use this command.');
    }
    
    try {
        const embed = new EmbedBuilder()
            .setColor('#ff6b35')
            .setTitle('🔧 Setting Up Quarantine System...')
            .setDescription('Creating quarantine role and channel...')
            .setTimestamp();
        
        const statusMessage = await message.reply({ embeds: [embed] });
        
        // Set up the quarantine system
        const result = await setupQuarantineSystem(message.guild);
        
        if (!result.success) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ff4757')
                .setTitle('❌ Setup Failed')
                .setDescription(result.error)
                .setTimestamp();
            
            return statusMessage.edit({ embeds: [errorEmbed] });
        }
        
        const successEmbed = new EmbedBuilder()
            .setColor('#2ecc71')
            .setTitle('✅ Quarantine System Setup Complete')
            .setDescription('Successfully set up quarantine role and channel!')
            .addFields(
                { name: 'Role Name', value: result.role.name, inline: true },
                { name: 'Role ID', value: result.role.id, inline: true },
                { name: 'Channel Name', value: `#${result.channel.name}`, inline: true },
                { name: 'Channel ID', value: result.channel.id, inline: true },
                { name: 'Position', value: `${result.role.position}`, inline: true },
                { name: 'Access', value: 'Mods, Admins, Owners & Authorized Users', inline: true }
            )
            .setFooter({ text: 'Quarantined users can now communicate in the bundfaad-baat-chit channel' })
            .setTimestamp();
        
        await statusMessage.edit({ embeds: [successEmbed] });
    } catch (error) {
        console.error('Error in setupquarantine command:', error);
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#ff4757')
            .setTitle('❌ Setup Failed')
            .setDescription('An error occurred while setting up the quarantine system.')
            .setTimestamp();
        
        await message.reply({ embeds: [errorEmbed] });
    }
}

async function handleSetupQuarantineSlash(interaction) {
    if (!hasModeratorPermissions(interaction.member)) {
        return interaction.reply({ 
            embeds: [createErrorEmbed('Permission Denied', 'You need moderator permissions to use this command.')], 
            flags: MessageFlags.Ephemeral 
        });
    }
    
    try {
        const embed = new EmbedBuilder()
            .setColor('#ff6b35')
            .setTitle('🔧 Setting Up Quarantine System...')
            .setDescription('Creating quarantine role and channel...')
            .setTimestamp();
        
        await interaction.reply({ embeds: [embed] });
        
        // Set up the quarantine system
        const result = await setupQuarantineSystem(interaction.guild);
        
        if (!result.success) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ff4757')
                .setTitle('❌ Setup Failed')
                .setDescription(result.error)
                .setTimestamp();
            
            return interaction.editReply({ embeds: [errorEmbed] });
        }
        
        const successEmbed = new EmbedBuilder()
            .setColor('#2ecc71')
            .setTitle('✅ Quarantine System Setup Complete')
            .setDescription('Successfully set up quarantine role and channel!')
            .addFields(
                { name: 'Role Name', value: result.role.name, inline: true },
                { name: 'Role ID', value: result.role.id, inline: true },
                { name: 'Channel Name', value: `#${result.channel.name}`, inline: true },
                { name: 'Channel ID', value: result.channel.id, inline: true },
                { name: 'Position', value: `${result.role.position}`, inline: true },
                { name: 'Access', value: 'Mods, Admins, Owners & Authorized Users', inline: true }
            )
            .setFooter({ text: 'Quarantined users can now communicate in the bundfaad-baat-chit channel' })
            .setTimestamp();
        
        await interaction.editReply({ embeds: [successEmbed] });
    } catch (error) {
        console.error('Error in setupquarantine slash command:', error);
        await interaction.editReply({ 
            embeds: [createErrorEmbed('Setup Failed', 'An error occurred while setting up the quarantine system.')] 
        });
    }
}

async function handleMuteCommand(message, args) {
    if (!hasModeratorPermissions(message.member)) {
        return message.reply('❌ You need moderator permissions to use this command.');
    }
    
    const user = message.mentions.users.first();
    if (!user) {
        return message.reply('❌ Please mention a user to mute.');
    }
    
    const durationStr = args[1];
    if (!durationStr) {
        return message.reply('❌ Please specify a duration (e.g., 10m, 1h, 2d).');
    }
    
    const durationMs = parseDuration(durationStr);
    if (!durationMs) {
        return message.reply('❌ Invalid duration format. Use: 10s, 5m, 2h, 1d, 1w');
    }
    
    const member = message.guild.members.cache.get(user.id);
    if (!member) {
        return message.reply('❌ User not found in this server.');
    }
    
    if (!member.manageable) {
        return message.reply('❌ I cannot mute this user due to role hierarchy.');
    }
    
    const mutedRole = await getMutedRole(message.guild);
    if (!mutedRole) {
        return message.reply('❌ Could not create or find muted role.');
    }
    
    if (member.roles.cache.has(mutedRole.id)) {
        return message.reply('❌ User is already muted.');
    }
    
    const reason = args.slice(2).join(' ') || 'No reason provided';
    
    try {
        await member.roles.add(mutedRole, reason);
        
        // Set timeout to unmute
        setTimeout(async () => {
            try {
                await member.roles.remove(mutedRole, 'Mute duration expired');
            } catch (error) {
                console.error('Error auto-unmuting user:', error);
            }
        }, durationMs);
        
        const embed = createSuccessEmbed(
            'User Muted',
            `**${user.tag}** has been muted for ${formatDuration(durationMs / 1000)}.\n**Reason:** ${reason}`
        );
        await message.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Error muting user:', error);
        await message.reply('❌ Failed to mute user.');
    }
}

async function handleMuteSlash(interaction) {
    if (!hasModeratorPermissions(interaction.member)) {
        return interaction.reply({ 
            embeds: [createErrorEmbed('Permission Denied', 'You need moderator permissions to use this command.')], 
            flags: MessageFlags.Ephemeral 
        });
    }
    
    const user = interaction.options.getUser('user');
    const durationStr = interaction.options.getString('duration');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    
    const durationMs = parseDuration(durationStr);
    if (!durationMs) {
        return interaction.reply({ 
            embeds: [createErrorEmbed('Invalid Duration', 'Invalid duration format. Use: 10s, 5m, 2h, 1d, 1w')], 
            flags: MessageFlags.Ephemeral 
        });
    }
    
    const member = interaction.guild.members.cache.get(user.id);
    if (!member) {
        return interaction.reply({ 
            embeds: [createErrorEmbed('User Not Found', 'User not found in this server.')], 
            flags: MessageFlags.Ephemeral 
        });
    }
    
    if (!member.manageable) {
        return interaction.reply({ 
            embeds: [createErrorEmbed('Cannot Mute', 'I cannot mute this user due to role hierarchy.')], 
            flags: MessageFlags.Ephemeral 
        });
    }
    
    const mutedRole = await getMutedRole(interaction.guild);
    if (!mutedRole) {
        return interaction.reply({ 
            embeds: [createErrorEmbed('Muted Role Error', 'Could not create or find muted role.')], 
            flags: MessageFlags.Ephemeral 
        });
    }
    
    if (member.roles.cache.has(mutedRole.id)) {
        return interaction.reply({ 
            embeds: [createErrorEmbed('Already Muted', 'User is already muted.')], 
            flags: MessageFlags.Ephemeral 
        });
    }
    
    try {
        await member.roles.add(mutedRole, reason);
        
        // Set timeout to unmute
        setTimeout(async () => {
            try {
                await member.roles.remove(mutedRole, 'Mute duration expired');
            } catch (error) {
                console.error('Error auto-unmuting user:', error);
            }
        }, durationMs);
        
        const embed = createSuccessEmbed(
            'User Muted',
            `**${user.tag}** has been muted for ${formatDuration(durationMs / 1000)}.\n**Reason:** ${reason}`
        );
        await interaction.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Error muting user:', error);
        await interaction.reply({ 
            embeds: [createErrorEmbed('Mute Failed', 'Failed to mute user.')], 
            flags: MessageFlags.Ephemeral 
        });
    }
}

async function handleUnmuteCommand(message, args) {
    if (!hasModeratorPermissions(message.member)) {
        return message.reply('❌ You need moderator permissions to use this command.');
    }
    
    const user = message.mentions.users.first();
    if (!user) {
        return message.reply('❌ Please mention a user to unmute.');
    }
    
    const member = message.guild.members.cache.get(user.id);
    if (!member) {
        return message.reply('❌ User not found in this server.');
    }
    
    const mutedRole = message.guild.roles.cache.find(role => role.name === 'Muted');
    if (!mutedRole || !member.roles.cache.has(mutedRole.id)) {
        return message.reply('❌ User is not muted.');
    }
    
    try {
        await member.roles.remove(mutedRole, 'Manually unmuted');
        const embed = createSuccessEmbed('User Unmuted', `**${user.tag}** has been unmuted.`);
        await message.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Error unmuting user:', error);
        await message.reply('❌ Failed to unmute user.');
    }
}

async function handleUnmuteSlash(interaction) {
    if (!hasModeratorPermissions(interaction.member)) {
        return interaction.reply({ 
            embeds: [createErrorEmbed('Permission Denied', 'You need moderator permissions to use this command.')], 
            flags: MessageFlags.Ephemeral 
        });
    }
    
    const user = interaction.options.getUser('user');
    const member = interaction.guild.members.cache.get(user.id);
    if (!member) {
        return interaction.reply({ 
            embeds: [createErrorEmbed('User Not Found', 'User not found in this server.')], 
            flags: MessageFlags.Ephemeral 
        });
    }
    
    const mutedRole = interaction.guild.roles.cache.find(role => role.name === 'Muted');
    if (!mutedRole || !member.roles.cache.has(mutedRole.id)) {
        return interaction.reply({ 
            embeds: [createErrorEmbed('Not Muted', 'User is not muted.')], 
            flags: MessageFlags.Ephemeral 
        });
    }
    
    try {
        await member.roles.remove(mutedRole, 'Manually unmuted');
        const embed = createSuccessEmbed('User Unmuted', `**${user.tag}** has been unmuted.`);
        await interaction.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Error unmuting user:', error);
        await interaction.reply({ 
            embeds: [createErrorEmbed('Unmute Failed', 'Failed to unmute user.')], 
            flags: MessageFlags.Ephemeral 
        });
    }
}

async function handleWarnCommand(message, args) {
    if (!hasModeratorPermissions(message.member)) {
        return message.reply('❌ You need moderator permissions to use this command.');
    }
    
    const user = message.mentions.users.first();
    if (!user) {
        return message.reply('❌ Please mention a user to warn.');
    }
    
    const reason = args.slice(1).join(' ') || 'No reason provided';
    
    try {
        const embed = createSuccessEmbed(
            'User Warned',
            `**${user.tag}** has been warned.\n**Reason:** ${reason}`
        );
        await message.reply({ embeds: [embed] });
        
        // Try to DM the user
        try {
            const dmEmbed = new EmbedBuilder()
                .setColor('#ffa500')
                .setTitle('⚠️ Warning')
                .setDescription(`You have been warned in **${message.guild.name}**`)
                .addFields({ name: 'Reason', value: reason })
                .setTimestamp();
            await user.send({ embeds: [dmEmbed] });
        } catch (error) {
            console.log(`Could not send warning DM to ${user.tag}`);
        }
    } catch (error) {
        console.error('Error warning user:', error);
        await message.reply('❌ Failed to warn user.');
    }
}

async function handleWarnSlash(interaction) {
    if (!hasModeratorPermissions(interaction.member)) {
        return interaction.reply({ 
            embeds: [createErrorEmbed('Permission Denied', 'You need moderator permissions to use this command.')], 
            flags: MessageFlags.Ephemeral 
        });
    }
    
    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    
    try {
        const embed = createSuccessEmbed(
            'User Warned',
            `**${user.tag}** has been warned.\n**Reason:** ${reason}`
        );
        await interaction.reply({ embeds: [embed] });
        
        // Try to DM the user
        try {
            const dmEmbed = new EmbedBuilder()
                .setColor('#ffa500')
                .setTitle('⚠️ Warning')
                .setDescription(`You have been warned in **${interaction.guild.name}**`)
                .addFields({ name: 'Reason', value: reason })
                .setTimestamp();
            await user.send({ embeds: [dmEmbed] });
        } catch (error) {
            console.log(`Could not send warning DM to ${user.tag}`);
        }
    } catch (error) {
        console.error('Error warning user:', error);
        await interaction.reply({ 
            embeds: [createErrorEmbed('Warning Failed', 'Failed to warn user.')], 
            flags: MessageFlags.Ephemeral 
        });
    }
}

async function handleQuarantineCommand(message, args) {
    if (!hasModeratorPermissions(message.member)) {
        return message.reply('❌ You need moderator permissions to use this command.');
    }
    
    const user = message.mentions.users.first();
    if (!user) {
        return message.reply('❌ Please mention a user to quarantine.');
    }
    
    const member = message.guild.members.cache.get(user.id);
    if (!member) {
        return message.reply('❌ User not found in this server.');
    }
    
    if (!member.manageable) {
        return message.reply('❌ I cannot quarantine this user due to role hierarchy.');
    }
    
    const quarantinedRole = await getQuarantinedRole(message.guild);
    if (!quarantinedRole) {
        return message.reply('❌ Could not create or find quarantined role.');
    }
    
    // Ensure quarantine system is properly set up (including channel permissions)
    const quarantineSetup = await setupQuarantineSystem(message.guild);
    if (!quarantineSetup.success) {
        console.error('Quarantine system setup failed:', quarantineSetup.error);
        // Continue anyway - role permissions should still work
    }
    
    if (member.roles.cache.has(quarantinedRole.id)) {
        return message.reply('❌ User is already quarantined.');
    }
    
    const reason = args.slice(1).join(' ') || 'No reason provided';
    
    try {
        // Try to DM the user before quarantining them
        try {
            const dmEmbed = new EmbedBuilder()
                .setColor('#ff0000')
                .setTitle('🔒 You have been quarantined')
                .setDescription(`You have been quarantined in **${message.guild.name}**`)
                .addFields(
                    { name: 'Reason', value: reason, inline: false },
                    { name: 'Quarantined by', value: `${message.author.tag}`, inline: true },
                    { name: 'Server', value: message.guild.name, inline: true }
                )
                .setTimestamp()
                .setFooter({ text: 'You cannot view any channels while quarantined. Contact server moderators for assistance.' });
            
            await user.send({ embeds: [dmEmbed] });
        } catch (error) {
            console.log(`Could not send quarantine DM to ${user.tag} - they may have DMs disabled`);
        }
        
        await member.roles.add(quarantinedRole, reason);
        
        // Add quarantine record to database
        await addQuarantineRecord(
            message.guild.id,
            user.id,
            user.tag,
            message.author.id,
            message.author.tag,
            reason,
            'quarantine'
        );
        
        const embed = createSuccessEmbed(
            'User Quarantined',
            `**${user.tag}** has been quarantined and cannot view any channels.\n**Reason:** ${reason}`
        );
        await message.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Error quarantining user:', error);
        await message.reply('❌ Failed to quarantine user.');
    }
}

async function handleQuarantineSlash(interaction) {
    // Add defer reply immediately to prevent timeout
    try {
        await interaction.deferReply();
    } catch (error) {
        console.error('Error deferring interaction:', error);
        return;
    }

    if (!hasModeratorPermissions(interaction.member)) {
        return interaction.editReply({ 
            embeds: [createErrorEmbed('Permission Denied', 'You need moderator permissions to use this command.')] 
        });
    }
    
    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    
    const member = interaction.guild.members.cache.get(user.id);
    if (!member) {
        return interaction.editReply({ 
            embeds: [createErrorEmbed('User Not Found', 'User not found in this server.')] 
        });
    }
    
    if (!member.manageable) {
        return interaction.editReply({ 
            embeds: [createErrorEmbed('Cannot Quarantine', 'I cannot quarantine this user due to role hierarchy.')] 
        });
    }
    
    const quarantinedRole = await getQuarantinedRole(interaction.guild);
    if (!quarantinedRole) {
        return interaction.editReply({ 
            embeds: [createErrorEmbed('Quarantined Role Error', 'Could not create or find quarantined role.')] 
        });
    }
    
    // Ensure quarantine system is properly set up (including channel permissions)
    const quarantineSetup = await setupQuarantineSystem(interaction.guild);
    if (!quarantineSetup.success) {
        console.error('Quarantine system setup failed:', quarantineSetup.error);
        // Continue anyway - role permissions should still work
    }
    
    if (member.roles.cache.has(quarantinedRole.id)) {
        return interaction.editReply({ 
            embeds: [createErrorEmbed('Already Quarantined', 'User is already quarantined.')] 
        });
    }
    
    try {
        // Try to DM the user before quarantining them
        try {
            const dmEmbed = new EmbedBuilder()
                .setColor('#ff0000')
                .setTitle('🔒 You have been quarantined')
                .setDescription(`You have been quarantined in **${interaction.guild.name}**`)
                .addFields(
                    { name: 'Reason', value: reason, inline: false },
                    { name: 'Quarantined by', value: `${interaction.user.tag}`, inline: true },
                    { name: 'Server', value: interaction.guild.name, inline: true }
                )
                .setTimestamp()
                .setFooter({ text: 'You cannot view any channels while quarantined. Contact server moderators for assistance.' });
            
            await user.send({ embeds: [dmEmbed] });
        } catch (error) {
            console.log(`Could not send quarantine DM to ${user.tag} - they may have DMs disabled`);
        }
        
        await member.roles.add(quarantinedRole, reason);
        
        // Add quarantine record to database
        await addQuarantineRecord(
            interaction.guild.id,
            user.id,
            user.tag,
            interaction.user.id,
            interaction.user.tag,
            reason,
            'quarantine'
        );
        
        const embed = createSuccessEmbed(
            'User Quarantined',
            `**${user.tag}** has been quarantined and cannot view any channels.\n**Reason:** ${reason}`
        );
        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error('Error quarantining user:', error);
        await interaction.editReply({ 
            embeds: [createErrorEmbed('Quarantine Failed', 'Failed to quarantine user.')] 
        });
    }
}

async function handleUnquarantineCommand(message, args) {
    if (!hasModeratorPermissions(message.member)) {
        return message.reply('❌ You need moderator permissions to use this command.');
    }
    
    const user = message.mentions.users.first();
    if (!user) {
        return message.reply('❌ Please mention a user to unquarantine.');
    }
    
    const member = message.guild.members.cache.get(user.id);
    if (!member) {
        return message.reply('❌ User not found in this server.');
    }
    
    const quarantinedRole = message.guild.roles.cache.find(role => role.name === 'Quarantined');
    if (!quarantinedRole || !member.roles.cache.has(quarantinedRole.id)) {
        return message.reply('❌ User is not quarantined.');
    }
    
    const reason = args.slice(1).join(' ') || 'No reason provided';
    
    try {
        await member.roles.remove(quarantinedRole, reason);
        
        // Add unquarantine record to database
        await addQuarantineRecord(
            message.guild.id,
            user.id,
            user.tag,
            message.author.id,
            message.author.tag,
            reason,
            'unquarantine'
        );
        
        // Try to DM the user about being unquarantined
        try {
            const dmEmbed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('🔓 Quarantine Removed')
                .setDescription(`Your quarantine has been removed in **${message.guild.name}**`)
                .addFields(
                    { name: 'Reason', value: reason, inline: false },
                    { name: 'Removed by', value: `${message.author.tag}`, inline: true }
                )
                .setTimestamp()
                .setFooter({ text: 'You can now view and access channels normally.' });
            
            await user.send({ embeds: [dmEmbed] });
        } catch (error) {
            console.log(`Could not send unquarantine DM to ${user.tag} - they may have DMs disabled`);
        }
        
        const embed = createSuccessEmbed(
            'User Unquarantined', 
            `**${user.tag}** has been unquarantined and can now view channels.\n**Reason:** ${reason}`
        );
        await message.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Error unquarantining user:', error);
        await message.reply('❌ Failed to unquarantine user.');
    }
}

async function handleUnquarantineSlash(interaction) {
    // Add defer reply immediately to prevent timeout
    try {
        await interaction.deferReply();
    } catch (error) {
        console.error('Error deferring interaction:', error);
        return;
    }

    if (!hasModeratorPermissions(interaction.member)) {
        return interaction.editReply({ 
            embeds: [createErrorEmbed('Permission Denied', 'You need moderator permissions to use this command.')] 
        });
    }
    
    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') || 'No reason provided';
    
    const member = interaction.guild.members.cache.get(user.id);
    if (!member) {
        return interaction.editReply({ 
            embeds: [createErrorEmbed('User Not Found', 'User not found in this server.')] 
        });
    }
    
    const quarantinedRole = interaction.guild.roles.cache.find(role => role.name === 'Quarantined');
    if (!quarantinedRole || !member.roles.cache.has(quarantinedRole.id)) {
        return interaction.editReply({ 
            embeds: [createErrorEmbed('Not Quarantined', 'User is not quarantined.')] 
        });
    }
    
    try {
        await member.roles.remove(quarantinedRole, reason);
        
        // Add unquarantine record to database
        await addQuarantineRecord(
            interaction.guild.id,
            user.id,
            user.tag,
            interaction.user.id,
            interaction.user.tag,
            reason,
            'unquarantine'
        );
        
        // Try to DM the user about being unquarantined
        try {
            const dmEmbed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('🔓 Quarantine Removed')
                .setDescription(`Your quarantine has been removed in **${interaction.guild.name}**`)
                .addFields(
                    { name: 'Reason', value: reason, inline: false },
                    { name: 'Removed by', value: `${interaction.user.tag}`, inline: true }
                )
                .setTimestamp()
                .setFooter({ text: 'You can now view and access channels normally.' });
            
            await user.send({ embeds: [dmEmbed] });
        } catch (error) {
            console.log(`Could not send unquarantine DM to ${user.tag} - they may have DMs disabled`);
        }
        
        const embed = createSuccessEmbed(
            'User Unquarantined', 
            `**${user.tag}** has been unquarantined and can now view channels.\n**Reason:** ${reason}`
        );
        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        console.error('Error unquarantining user:', error);
        await interaction.editReply({ 
            embeds: [createErrorEmbed('Unquarantine Failed', 'Failed to unquarantine user.')] 
        });
    }
}

async function handleQuarantineInfoCommand(message, args) {
    if (!hasModeratorPermissions(message.member)) {
        return message.reply('❌ You need moderator permissions to use this command.');
    }
    
    const subcommand = args[0]?.toLowerCase();
    
    if (!subcommand || subcommand === 'help') {
        const helpEmbed = new EmbedBuilder()
            .setColor('#ff6b35')
            .setTitle('📋 Quarantine Info Commands')
            .setDescription('Available quarantine information commands:')
            .addFields(
                { name: '`!quarantineinfo user @user`', value: 'View quarantine history for a user', inline: false },
                { name: '`!quarantineinfo history [limit]`', value: 'View recent quarantine history', inline: false },
                { name: '`!quarantineinfo stats`', value: 'View server quarantine statistics', inline: false },
                { name: '`!quarantineinfo search <query>`', value: 'Search quarantine records', inline: false }
            )
            .setFooter({ text: 'Use /quarantineinfo for more advanced options' });
        
        return message.reply({ embeds: [helpEmbed] });
    }
    
    switch (subcommand) {
        case 'user':
            const user = message.mentions.users.first();
            if (!user) {
                return message.reply('❌ Please mention a user to check their quarantine history.');
            }
            return await showUserQuarantineHistory(message, user);
            
        case 'history':
            const limit = parseInt(args[1]) || 10;
            return await showQuarantineHistory(message, Math.min(Math.max(limit, 1), 25));
            
        case 'stats':
            return await showQuarantineStats(message);
            
        case 'search':
            const query = args.slice(1).join(' ');
            if (!query) {
                return message.reply('❌ Please provide a search term.');
            }
            return await searchQuarantineRecords(message, query);
            
        default:
            return message.reply('❌ Invalid subcommand. Use `!quarantineinfo help` for available options.');
    }
}

async function handleQuarantineInfoSlash(interaction) {
    // Add defer reply immediately to prevent timeout
    try {
        await interaction.deferReply();
    } catch (error) {
        console.error('Error deferring interaction:', error);
        return;
    }

    if (!hasModeratorPermissions(interaction.member)) {
        return interaction.editReply({ 
            embeds: [createErrorEmbed('Permission Denied', 'You need moderator permissions to use this command.')] 
        });
    }
    
    const subcommand = interaction.options.getSubcommand();
    
    try {
        switch (subcommand) {
            case 'user':
                const user = interaction.options.getUser('user');
                return await showUserQuarantineHistorySlash(interaction, user);
                
            case 'history':
                const limit = interaction.options.getInteger('limit') || 10;
                return await showQuarantineHistorySlash(interaction, limit);
                
            case 'stats':
                return await showQuarantineStatsSlash(interaction);
                
            case 'search':
                const query = interaction.options.getString('query');
                const searchType = interaction.options.getString('type') || 'all';
                return await searchQuarantineRecordsSlash(interaction, query, searchType);
                
            default:
                return interaction.editReply({ 
                    embeds: [createErrorEmbed('Invalid Command', 'Invalid subcommand.')] 
                });
        }
    } catch (error) {
        console.error('Error in quarantine info command:', error);
        await interaction.editReply({ 
            embeds: [createErrorEmbed('Command Error', 'An error occurred while processing your request.')] 
        });
    }
}

// Helper functions for quarantine info display
async function showUserQuarantineHistory(message, user) {
    const history = getQuarantineHistory(message.guild.id, user.id, 10);
    const status = getUserQuarantineStatus(message.guild.id, user.id);
    
    const embed = new EmbedBuilder()
        .setColor(status.isQuarantined ? '#ff4757' : '#4ecdc4')
        .setTitle(`📋 Quarantine History for ${user.tag}`)
        .setThumbnail(user.displayAvatarURL({ dynamic: true }))
        .addFields(
            { name: 'Current Status', value: status.isQuarantined ? '🔒 Quarantined' : '✅ Not Quarantined', inline: true },
            { name: 'Total Records', value: status.totalRecords.toString(), inline: true },
            { name: 'User ID', value: user.id, inline: true }
        );
    
    if (history.length === 0) {
        embed.setDescription('No quarantine records found for this user.');
    } else {
        let historyText = '';
        history.slice(0, 5).forEach((record, index) => {
            const action = record.action === 'quarantine' ? '🔒 Quarantined' : '🔓 Unquarantined';
            const date = new Date(record.timestamp).toLocaleString();
            historyText += `**${index + 1}.** ${action} by ${record.moderatorUsername}\n`;
            historyText += `*${date}* - ${record.reason.length > 50 ? record.reason.substring(0, 50) + '...' : record.reason}\n\n`;
        });
        
        embed.setDescription(historyText);
        
        if (history.length > 5) {
            embed.setFooter({ text: `Showing 5 of ${history.length} records. Use /quarantineinfo user for full history.` });
        }
    }
    
    await message.reply({ embeds: [embed] });
}

async function showUserQuarantineHistorySlash(interaction, user) {
    const history = getQuarantineHistory(interaction.guild.id, user.id, 15);
    const status = getUserQuarantineStatus(interaction.guild.id, user.id);
    
    const embed = new EmbedBuilder()
        .setColor(status.isQuarantined ? '#ff4757' : '#4ecdc4')
        .setTitle(`📋 Quarantine History for ${user.tag}`)
        .setThumbnail(user.displayAvatarURL({ dynamic: true }))
        .addFields(
            { name: 'Current Status', value: status.isQuarantined ? '🔒 Quarantined' : '✅ Not Quarantined', inline: true },
            { name: 'Total Records', value: status.totalRecords.toString(), inline: true },
            { name: 'User ID', value: user.id, inline: true }
        );
    
    if (history.length === 0) {
        embed.setDescription('No quarantine records found for this user.');
    } else {
        let historyText = '';
        history.forEach((record, index) => {
            const action = record.action === 'quarantine' ? '🔒 Quarantined' : '🔓 Unquarantined';
            const date = new Date(record.timestamp).toLocaleString();
            historyText += `**${index + 1}.** ${action} by ${record.moderatorUsername}\n`;
            historyText += `*${date}* - ${record.reason}\n\n`;
        });
        
        embed.setDescription(historyText);
    }
    
    await interaction.editReply({ embeds: [embed] });
}

async function showQuarantineHistory(message, limit) {
    const history = getQuarantineHistory(message.guild.id, null, limit);
    
    const embed = new EmbedBuilder()
        .setColor('#ff6b35')
        .setTitle(`📋 Recent Quarantine History (${limit} records)`)
        .setTimestamp();
    
    if (history.length === 0) {
        embed.setDescription('No quarantine records found for this server.');
    } else {
        let historyText = '';
        history.forEach((record, index) => {
            const action = record.action === 'quarantine' ? '🔒' : '🔓';
            const date = new Date(record.timestamp).toLocaleString();
            historyText += `**${index + 1}.** ${action} ${record.username} by ${record.moderatorUsername}\n`;
            historyText += `*${date}* - ${record.reason.length > 30 ? record.reason.substring(0, 30) + '...' : record.reason}\n\n`;
        });
        embed.setDescription(historyText);
    }
    
    await message.reply({ embeds: [embed] });
}

async function showQuarantineHistorySlash(interaction, limit) {
    const history = getQuarantineHistory(interaction.guild.id, null, limit);
    
    const embed = new EmbedBuilder()
        .setColor('#ff6b35')
        .setTitle(`📋 Recent Quarantine History (${limit} records)`)
        .setTimestamp();
    
    if (history.length === 0) {
        embed.setDescription('No quarantine records found for this server.');
    } else {
        let historyText = '';
        history.forEach((record, index) => {
            const action = record.action === 'quarantine' ? '🔒' : '🔓';
            const date = new Date(record.timestamp).toLocaleString();
            historyText += `**${index + 1}.** ${action} ${record.username} by ${record.moderatorUsername}\n`;
            historyText += `*${date}* - ${record.reason}\n\n`;
        });
        embed.setDescription(historyText);
    }
    
    await interaction.editReply({ embeds: [embed] });
}

async function showQuarantineStats(message) {
    const stats = getQuarantineStats(message.guild.id);
    
    const embed = new EmbedBuilder()
        .setColor('#4ecdc4')
        .setTitle('📊 Quarantine Statistics')
        .addFields(
            { name: 'Total Records', value: stats.totalRecords.toString(), inline: true },
            { name: 'Total Quarantines', value: stats.totalQuarantines.toString(), inline: true },
            { name: 'Total Unquarantines', value: stats.totalUnquarantines.toString(), inline: true },
            { name: 'Unique Users', value: stats.uniqueUsers.toString(), inline: true },
            { name: 'Active Moderators', value: stats.activeModerators.toString(), inline: true },
            { name: 'Server', value: message.guild.name, inline: true }
        )
        .setTimestamp();
    
    await message.reply({ embeds: [embed] });
}

async function showQuarantineStatsSlash(interaction) {
    const stats = getQuarantineStats(interaction.guild.id);
    
    const embed = new EmbedBuilder()
        .setColor('#4ecdc4')
        .setTitle('📊 Quarantine Statistics')
        .addFields(
            { name: 'Total Records', value: stats.totalRecords.toString(), inline: true },
            { name: 'Total Quarantines', value: stats.totalQuarantines.toString(), inline: true },
            { name: 'Total Unquarantines', value: stats.totalUnquarantines.toString(), inline: true },
            { name: 'Unique Users', value: stats.uniqueUsers.toString(), inline: true },
            { name: 'Active Moderators', value: stats.activeModerators.toString(), inline: true },
            { name: 'Server', value: interaction.guild.name, inline: true }
        )
        .setTimestamp();
    
    await interaction.editReply({ embeds: [embed] });
}

async function searchQuarantineRecordsSlash(interaction, query, searchType) {
    const results = searchQuarantineRecords(interaction.guild.id, query, searchType);
    
    const embed = new EmbedBuilder()
        .setColor('#ff6b35')
        .setTitle(`📋 Search Results for "${query}"`)
        .setTimestamp();
    
    if (results.length === 0) {
        embed.setDescription('No matching quarantine records found.');
    } else {
        let resultsText = '';
        results.slice(0, 10).forEach((record, index) => {
            const action = record.action === 'quarantine' ? '🔒' : '🔓';
            const date = new Date(record.timestamp).toLocaleString();
            resultsText += `**${index + 1}.** ${action} ${record.username} by ${record.moderatorUsername}\n`;
            resultsText += `*${date}* - ${record.reason}\n\n`;
        });
        embed.setDescription(resultsText);
        
        if (results.length > 10) {
            embed.setFooter({ text: `Showing 10 of ${results.length} results` });
        }
    }
    
    await interaction.editReply({ embeds: [embed] });
}

async function handleClearCommand(message, args) {
    if (!hasModeratorPermissions(message.member)) {
        return message.reply('❌ You need moderator permissions to use this command.');
    }
    
    const amount = parseInt(args[0]);
    if (!amount || amount < 1 || amount > 100) {
        return message.reply('❌ Please specify a number between 1 and 100.');
    }
    
    try {
        const deleted = await message.channel.bulkDelete(amount + 1, true); // +1 to include command message
        const embed = createSuccessEmbed(
            'Messages Cleared',
            `Successfully deleted ${deleted.size - 1} messages.`
        );
        const reply = await message.channel.send({ embeds: [embed] });
        
        // Delete confirmation message after 5 seconds
        setTimeout(() => {
            reply.delete().catch(() => {});
        }, 5000);
    } catch (error) {
        console.error('Error clearing messages:', error);
        await message.reply('❌ Failed to clear messages. Messages might be too old (older than 14 days).');
    }
}

async function handleFreezeNickCommand(message, args) {
    try {
        if (!hasModeratorPermissions(message.member)) {
            return message.reply('❌ You need moderator permissions to use this command.');
        }

        const targetUser = message.mentions.users.first();
        if (!targetUser) {
            return message.reply('❌ Please mention a user to freeze their nickname. Usage: `!freezenick @user [nickname] [reason]`');
        }

        const targetMember = await message.guild.members.fetch(targetUser.id);
        
        // Check if bot can manage the target member
        if (!targetMember.manageable) {
            return message.reply('❌ I cannot manage this user\'s nickname (they may have a higher role than me).');
        }

        // Check if target is higher than moderator
        if (targetMember.roles.highest.position >= message.member.roles.highest.position && message.guild.ownerId !== message.author.id) {
            return message.reply('❌ You cannot freeze the nickname of someone with equal or higher roles.');
        }

        // Parse args: first is mention, rest could be nickname or reason
        const argsWithoutMention = args.slice(1);
        let customNickname = null;
        let reason = 'No reason provided';

        // Check if a custom nickname is provided (if starts with quotes or first arg doesn't look like a reason)
        if (argsWithoutMention.length > 0) {
            // Simple heuristic: if it doesn't start with common reason words, treat as nickname
            const potentialNick = argsWithoutMention[0];
            if (argsWithoutMention.length === 1) {
                // Single arg could be either nickname or reason
                customNickname = potentialNick;
            } else if (potentialNick.length <= 32) {
                // Likely a nickname if reasonable length
                customNickname = potentialNick;
                reason = argsWithoutMention.slice(1).join(' ');
            } else {
                // Too long for nickname, treat all as reason
                reason = argsWithoutMention.join(' ');
            }
        }

        // Validate custom nickname length
        if (customNickname && customNickname.length > 32) {
            return message.reply('❌ Nicknames must be 32 characters or less.');
        }

        const nicknameToFreeze = customNickname || targetMember.nickname || targetUser.username;

        // Set the nickname if custom one provided
        if (customNickname && customNickname !== targetMember.nickname) {
            try {
                await targetMember.setNickname(customNickname, `Nickname frozen by ${message.author.tag}: ${reason}`);
            } catch (error) {
                logError('handleFreezeNickCommand - setNickname', error, { targetUserId: targetUser.id });
                return message.reply('❌ Failed to set the nickname. Please check bot permissions.');
            }
        }

        // Save to database
        const success = await DatabaseService.freezeNickname(
            targetUser.id,
            message.guild.id,
            nicknameToFreeze,
            message.author.id,
            reason
        );

        if (!success) {
            return message.reply('❌ Failed to freeze nickname in database.');
        }

        const embed = new EmbedBuilder()
            .setColor('#4ecdc4')
            .setTitle('🔒 Nickname Frozen')
            .setDescription(`${targetUser.tag}'s nickname has been frozen`)
            .addFields(
                { name: '👤 User', value: `${targetUser} (${targetUser.tag})`, inline: true },
                { name: '📛 Frozen Nickname', value: nicknameToFreeze, inline: true },
                { name: '👮 Moderator', value: `${message.author}`, inline: true },
                { name: '📝 Reason', value: reason, inline: false }
            )
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
            .setFooter({ text: `User ID: ${targetUser.id}` })
            .setTimestamp();

        await message.reply({ embeds: [embed] });

        // Try to DM the user
        try {
            const dmEmbed = new EmbedBuilder()
                .setColor('#ffa500')
                .setTitle('🔒 Your Nickname Has Been Frozen')
                .setDescription(`Your nickname in **${message.guild.name}** has been frozen.`)
                .addFields(
                    { name: '📛 Frozen Nickname', value: nicknameToFreeze, inline: true },
                    { name: '👮 Moderator', value: message.author.tag, inline: true },
                    { name: '📝 Reason', value: reason, inline: false }
                )
                .setFooter({ text: 'You cannot change your nickname until a moderator unfreezes it.' })
                .setTimestamp();

            await targetUser.send({ embeds: [dmEmbed] });
        } catch (dmError) {
            logError('handleFreezeNickCommand - DM', dmError, { targetUserId: targetUser.id });
        }

    } catch (error) {
        logError('handleFreezeNickCommand', error, { guildId: message.guild.id });
        await message.reply('❌ An error occurred while freezing the nickname.').catch(() => {});
    }
}

async function handleUnfreezeNickCommand(message, args) {
    try {
        if (!hasModeratorPermissions(message.member)) {
            console.log(`[UnfreezeNick] Permission denied for ${message.author.tag}`);
            return message.reply('❌ You need moderator permissions to use this command.');
        }

        const targetUser = message.mentions.users.first();
        if (!targetUser) {
            return message.reply('❌ Please mention a user to unfreeze their nickname. Usage: `!unfreezenick @user [reason]`');
        }

        const reason = args.slice(1).join(' ') || 'No reason provided';

        console.log(`[UnfreezeNick] Attempting to unfreeze ${targetUser.tag} (${targetUser.id}) in guild ${message.guild.id}`);

        // Check if nickname is frozen
        const frozenData = await DatabaseService.getFrozenNickname(targetUser.id, message.guild.id);
        console.log(`[UnfreezeNick] Frozen data:`, frozenData);
        
        if (!frozenData) {
            console.log(`[UnfreezeNick] User ${targetUser.tag} is not frozen`);
            return message.reply('❌ This user\'s nickname is not currently frozen.');
        }

        // Remove from database
        const success = await DatabaseService.unfreezeNickname(targetUser.id, message.guild.id);
        console.log(`[UnfreezeNick] Database removal success: ${success}`);

        if (!success) {
            console.log(`[UnfreezeNick] Failed to unfreeze in database`);
            return message.reply('❌ Failed to unfreeze nickname in database.');
        }

        console.log(`[UnfreezeNick] Successfully unfroze ${targetUser.tag}`);

        const embed = new EmbedBuilder()
            .setColor('#4ecdc4')
            .setTitle('🔓 Nickname Unfrozen')
            .setDescription(`${targetUser.tag}'s nickname has been unfrozen`)
            .addFields(
                { name: '👤 User', value: `${targetUser} (${targetUser.tag})`, inline: true },
                { name: '📛 Previous Frozen Nickname', value: frozenData.frozenNickname || 'Current nickname', inline: true },
                { name: '👮 Moderator', value: `${message.author}`, inline: true },
                { name: '📝 Reason', value: reason, inline: false }
            )
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
            .setFooter({ text: `User ID: ${targetUser.id}` })
            .setTimestamp();

        await message.reply({ embeds: [embed] });

        // Try to DM the user
        try {
            const dmEmbed = new EmbedBuilder()
                .setColor('#4ecdc4')
                .setTitle('🔓 Your Nickname Has Been Unfrozen')
                .setDescription(`Your nickname in **${message.guild.name}** has been unfrozen.`)
                .addFields(
                    { name: '👮 Moderator', value: message.author.tag, inline: true },
                    { name: '📝 Reason', value: reason, inline: false }
                )
                .setFooter({ text: 'You can now change your nickname freely.' })
                .setTimestamp();

            await targetUser.send({ embeds: [dmEmbed] });
        } catch (dmError) {
            logError('handleUnfreezeNickCommand - DM', dmError, { targetUserId: targetUser.id });
        }

    } catch (error) {
        console.error('[UnfreezeNick] Error:', error);
        logError('handleUnfreezeNickCommand', error, { guildId: message.guild.id });
        await message.reply('❌ An error occurred while unfreezing the nickname.').catch(() => {});
    }
}

async function handleClearSlash(interaction) {
    if (!hasModeratorPermissions(interaction.member)) {
        return interaction.reply({ 
            embeds: [createErrorEmbed('Permission Denied', 'You need moderator permissions to use this command.')], 
            flags: MessageFlags.Ephemeral 
        });
    }
    
    const amount = interaction.options.getInteger('amount');
    
    try {
        const deleted = await interaction.channel.bulkDelete(amount, true);
        const embed = createSuccessEmbed(
            'Messages Cleared',
            `Successfully deleted ${deleted.size} messages.`
        );
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } catch (error) {
        console.error('Error clearing messages:', error);
        await interaction.reply({ 
            embeds: [createErrorEmbed('Clear Failed', 'Failed to clear messages. Messages might be too old (older than 14 days).')], 
            flags: MessageFlags.Ephemeral 
        });
    }
}

async function handleFreezeNickSlash(interaction) {
    try {
        // Check permissions
        if (!hasModeratorPermissions(interaction.member)) {
            return interaction.reply({ 
                embeds: [createErrorEmbed('Permission Denied', 'You need moderator permissions to use this command.')], 
                flags: MessageFlags.Ephemeral 
            });
        }

        const targetUser = interaction.options.getUser('user');
        const targetMember = await interaction.guild.members.fetch(targetUser.id);
        const customNickname = interaction.options.getString('nickname');
        const reason = interaction.options.getString('reason') || 'No reason provided';

        // Check if bot can manage the target member
        if (!targetMember.manageable) {
            return interaction.reply({ 
                embeds: [createErrorEmbed('Permission Error', 'I cannot manage this user\'s nickname (they may have a higher role than me).')], 
                flags: MessageFlags.Ephemeral 
            });
        }

        // Check if target is higher than moderator
        if (targetMember.roles.highest.position >= interaction.member.roles.highest.position && interaction.guild.ownerId !== interaction.user.id) {
            return interaction.reply({ 
                embeds: [createErrorEmbed('Permission Denied', 'You cannot freeze the nickname of someone with equal or higher roles.')], 
                flags: MessageFlags.Ephemeral 
            });
        }

        // Validate custom nickname length
        if (customNickname && customNickname.length > 32) {
            return interaction.reply({ 
                embeds: [createErrorEmbed('Invalid Nickname', 'Nicknames must be 32 characters or less.')], 
                flags: MessageFlags.Ephemeral 
            });
        }

        const nicknameToFreeze = customNickname || targetMember.nickname || targetUser.username;

        // Set the nickname if custom one provided
        if (customNickname && customNickname !== targetMember.nickname) {
            try {
                await targetMember.setNickname(customNickname, `Nickname frozen by ${interaction.user.tag}: ${reason}`);
            } catch (error) {
                logError('handleFreezeNickSlash - setNickname', error, { targetUserId: targetUser.id });
                return interaction.reply({ 
                    embeds: [createErrorEmbed('Nickname Error', 'Failed to set the nickname. Please check bot permissions.')], 
                    flags: MessageFlags.Ephemeral 
                });
            }
        }

        // Save to database
        const success = await DatabaseService.freezeNickname(
            targetUser.id,
            interaction.guild.id,
            nicknameToFreeze,
            interaction.user.id,
            reason
        );

        if (!success) {
            return interaction.reply({ 
                embeds: [createErrorEmbed('Database Error', 'Failed to freeze nickname in database.')], 
                flags: MessageFlags.Ephemeral 
            });
        }

        const embed = new EmbedBuilder()
            .setColor('#4ecdc4')
            .setTitle('🔒 Nickname Frozen')
            .setDescription(`${targetUser.tag}'s nickname has been frozen`)
            .addFields(
                { name: '👤 User', value: `${targetUser} (${targetUser.tag})`, inline: true },
                { name: '📛 Frozen Nickname', value: nicknameToFreeze, inline: true },
                { name: '👮 Moderator', value: `${interaction.user}`, inline: true },
                { name: '📝 Reason', value: reason, inline: false }
            )
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
            .setFooter({ text: `User ID: ${targetUser.id}` })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });

        // Try to DM the user
        try {
            const dmEmbed = new EmbedBuilder()
                .setColor('#ffa500')
                .setTitle('🔒 Your Nickname Has Been Frozen')
                .setDescription(`Your nickname in **${interaction.guild.name}** has been frozen.`)
                .addFields(
                    { name: '📛 Frozen Nickname', value: nicknameToFreeze, inline: true },
                    { name: '👮 Moderator', value: interaction.user.tag, inline: true },
                    { name: '📝 Reason', value: reason, inline: false }
                )
                .setFooter({ text: 'You cannot change your nickname until a moderator unfreezes it.' })
                .setTimestamp();

            await targetUser.send({ embeds: [dmEmbed] });
        } catch (dmError) {
            logError('handleFreezeNickSlash - DM', dmError, { targetUserId: targetUser.id });
        }

    } catch (error) {
        logError('handleFreezeNickSlash', error, { guildId: interaction.guild.id });
        await interaction.reply({ 
            embeds: [createErrorEmbed('Error', 'An error occurred while freezing the nickname.')], 
            flags: MessageFlags.Ephemeral 
        }).catch(() => {});
    }
}

async function handleUnfreezeNickSlash(interaction) {
    try {
        // Check permissions
        if (!hasModeratorPermissions(interaction.member)) {
            console.log(`[UnfreezeNick] Permission denied for ${interaction.user.tag}`);
            return interaction.reply({ 
                embeds: [createErrorEmbed('Permission Denied', 'You need moderator permissions to use this command.')], 
                flags: MessageFlags.Ephemeral 
            });
        }

        const targetUser = interaction.options.getUser('user');
        const reason = interaction.options.getString('reason') || 'No reason provided';

        console.log(`[UnfreezeNick] Attempting to unfreeze ${targetUser.tag} (${targetUser.id}) in guild ${interaction.guild.id}`);

        // Check if nickname is frozen
        const frozenData = await DatabaseService.getFrozenNickname(targetUser.id, interaction.guild.id);
        console.log(`[UnfreezeNick] Frozen data:`, frozenData);
        
        if (!frozenData) {
            console.log(`[UnfreezeNick] User ${targetUser.tag} is not frozen`);
            return interaction.reply({ 
                embeds: [createErrorEmbed('Not Frozen', 'This user\'s nickname is not currently frozen.')], 
                flags: MessageFlags.Ephemeral 
            });
        }

        // Remove from database
        const success = await DatabaseService.unfreezeNickname(targetUser.id, interaction.guild.id);
        console.log(`[UnfreezeNick] Database removal success: ${success}`);

        if (!success) {
            console.log(`[UnfreezeNick] Failed to unfreeze in database`);
            return interaction.reply({ 
                embeds: [createErrorEmbed('Database Error', 'Failed to unfreeze nickname in database.')], 
                flags: MessageFlags.Ephemeral 
            });
        }

        console.log(`[UnfreezeNick] Successfully unfroze ${targetUser.tag}`);

        const embed = new EmbedBuilder()
            .setColor('#4ecdc4')
            .setTitle('🔓 Nickname Unfrozen')
            .setDescription(`${targetUser.tag}'s nickname has been unfrozen`)
            .addFields(
                { name: '👤 User', value: `${targetUser} (${targetUser.tag})`, inline: true },
                { name: '📛 Previous Frozen Nickname', value: frozenData.frozenNickname || 'Current nickname', inline: true },
                { name: '👮 Moderator', value: `${interaction.user}`, inline: true },
                { name: '📝 Reason', value: reason, inline: false }
            )
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
            .setFooter({ text: `User ID: ${targetUser.id}` })
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });

        // Try to DM the user
        try {
            const dmEmbed = new EmbedBuilder()
                .setColor('#4ecdc4')
                .setTitle('🔓 Your Nickname Has Been Unfrozen')
                .setDescription(`Your nickname in **${interaction.guild.name}** has been unfrozen.`)
                .addFields(
                    { name: '👮 Moderator', value: interaction.user.tag, inline: true },
                    { name: '📝 Reason', value: reason, inline: false }
                )
                .setFooter({ text: 'You can now change your nickname freely.' })
                .setTimestamp();

            await targetUser.send({ embeds: [dmEmbed] });
        } catch (dmError) {
            logError('handleUnfreezeNickSlash - DM', dmError, { targetUserId: targetUser.id });
        }

    } catch (error) {
        logError('handleUnfreezeNickSlash', error, { guildId: interaction.guild.id });
        await interaction.reply({ 
            embeds: [createErrorEmbed('Error', 'An error occurred while unfreezing the nickname.')], 
            flags: MessageFlags.Ephemeral 
        }).catch(() => {});
    }
}

// Missing command handlers
async function handlePingCommand(message) {
    const sent = await message.reply('🏓 Pinging...');
    const messageLatency = sent.createdTimestamp - message.createdTimestamp;
    const apiLatency = client.ws.ping;
    
    const embed = new EmbedBuilder()
        .setColor('#4ecdc4')
        .setTitle('🏓 Pong!')
        .addFields(
            { name: '📨 Message Latency', value: `${messageLatency}ms`, inline: true },
            { name: '🌐 API Latency', value: `${apiLatency}ms`, inline: true },
            { name: '🤖 Bot Status', value: getStatusEmoji(apiLatency), inline: true }
        )
        .setFooter({ text: `Uptime: ${formatUptime(process.uptime())}` })
        .setTimestamp();
    
    await sent.edit({ content: '', embeds: [embed] });
}

async function handlePingSlash(interaction) {
    const start = Date.now();
    await interaction.deferReply();
    const end = Date.now();
    
    const messageLatency = end - start;
    const apiLatency = client.ws.ping;
    
    const embed = new EmbedBuilder()
        .setColor('#4ecdc4')
        .setTitle('🏓 Pong!')
        .addFields(
            { name: '📨 Response Time', value: `${messageLatency}ms`, inline: true },
            { name: '🌐 API Latency', value: `${apiLatency}ms`, inline: true },
            { name: '🤖 Bot Status', value: getStatusEmoji(apiLatency), inline: true },
            { name: '📊 Server Count', value: `${client.guilds.cache.size}`, inline: true },
            { name: '👥 User Count', value: `${client.users.cache.size}`, inline: true },
            { name: '💾 Memory Usage', value: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`, inline: true }
        )
        .setFooter({ text: `Uptime: ${formatUptime(process.uptime())} | Node.js ${process.version}` })
        .setTimestamp();
    
    await interaction.editReply({ embeds: [embed] });
}

function getStatusEmoji(ping) {
    if (ping < 100) return '🟢 Excellent';
    if (ping < 200) return '🟡 Good';
    if (ping < 300) return '🟠 Fair';
    return '🔴 Poor';
}

function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
    if (minutes > 0) return `${minutes}m ${secs}s`;
    return `${secs}s`;
}

async function handleAfkCommand(message, args) {
    try {
        const reason = args.join(' ') || 'No reason provided';
        
        // Validate reason length
        if (reason.length > 500) {
            const embed = createErrorEmbed('Invalid Reason', 'AFK reason must be 500 characters or less.');
            return message.reply({ embeds: [embed] });
        }
        
        // Sanitize input
        const sanitizedReason = sanitizeInput(reason);
        
        // Check if user is already AFK
        const currentAfk = await DatabaseService.getUserAFK(message.author.id, message.guild.id);
        if (currentAfk) {
            const embed = new EmbedBuilder()
                .setColor('#ffa500')
                .setTitle('⚠️ Already AFK')
                .setDescription(`You're already AFK since <t:${Math.floor(new Date(currentAfk.createdAt).getTime() / 1000)}:R>`)
                .addFields(
                    { name: 'Current Status', value: currentAfk.reason, inline: true },
                    { name: 'Duration', value: formatAfkDuration(new Date(currentAfk.createdAt).getTime()), inline: true }
                )
                .setFooter({ text: 'Use !afkclear to remove AFK status or !afk with new reason to update' });
            
            return message.reply({ embeds: [embed] });
        }
        
        // Set AFK status in database
        const success = await DatabaseService.setUserAFK(message.author.id, message.guild.id, sanitizedReason);
        
        if (!success) {
            const embed = createErrorEmbed('Database Error', 'Failed to set AFK status. Please try again.');
            return message.reply({ embeds: [embed] });
        }
        
        const embed = new EmbedBuilder()
            .setColor('#4ecdc4')
            .setTitle('💤 AFK Status Set')
            .setDescription(`You are now AFK in **${message.guild.name}**`)
            .addFields(
                { name: '💭 Reason', value: sanitizedReason, inline: true },
                { name: '📅 Since', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
            )
            .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
            .setFooter({ text: 'Send any message to clear AFK status | Use !afkclear to manually clear' })
            .setTimestamp();
        
        await message.reply({ embeds: [embed] });
    } catch (error) {
        logError('handleAfkCommand', error, { userId: message.author.id, guildId: message.guild.id });
        const embed = createErrorEmbed('Error', 'An error occurred while setting AFK status.');
        await message.reply({ embeds: [embed] }).catch(() => {});
    }
}

async function handleAfkSlash(interaction) {
    try {
        // Check if this is a subcommand
        if (interaction.options.getSubcommand) {
            try {
                const subcommand = interaction.options.getSubcommand();
                
                switch (subcommand) {
                    case 'set':
                        return await handleAfkSetSlash(interaction);
                    case 'clear':
                        return await handleAfkClearSlash(interaction);
                    case 'list':
                        return await handleAfkListSlash(interaction);
                    default:
                        return interaction.reply({ 
                            embeds: [createErrorEmbed('Unknown Subcommand', 'Unknown AFK subcommand.')], 
                            flags: MessageFlags.Ephemeral 
                        });
                }
            } catch (error) {
                // No subcommand, treat as regular AFK set
            }
        }
        
        // Default behavior - set AFK status
        return await handleAfkSetSlash(interaction);
    } catch (error) {
        logError('handleAfkSlash', error, { userId: interaction.user.id, guildId: interaction.guild.id });
        const embed = createErrorEmbed('Error', 'An error occurred while processing the AFK command.');
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral }).catch(() => {});
    }
}

async function handleAfkSetSlash(interaction) {
    try {
        const reason = interaction.options.getString('reason') || 'No reason provided';
        
        // Validate reason length
        if (reason.length > 500) {
            const embed = createErrorEmbed('Invalid Reason', 'AFK reason must be 500 characters or less.');
            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }
        
        // Sanitize input
        const sanitizedReason = sanitizeInput(reason);
        
        // Check if user is already AFK using DatabaseService
        const currentAfk = await DatabaseService.getUserAFK(interaction.user.id, interaction.guild.id);
        if (currentAfk) {
            const embed = new EmbedBuilder()
                .setColor('#ffa500')
                .setTitle('⚠️ Already AFK')
                .setDescription(`You're already AFK since <t:${Math.floor(new Date(currentAfk.createdAt).getTime() / 1000)}:R>`)
                .addFields(
                    { name: 'Current Status', value: currentAfk.reason, inline: true },
                    { name: 'Duration', value: formatAfkDuration(new Date(currentAfk.createdAt).getTime()), inline: true }
                )
                .setFooter({ text: 'Use /afk clear to remove AFK status or set a new reason to update' });
            
            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }
        
        // Set AFK status in database
        const success = await DatabaseService.setUserAFK(interaction.user.id, interaction.guild.id, sanitizedReason);
        
        if (!success) {
            const embed = createErrorEmbed('Database Error', 'Failed to set AFK status. Please try again.');
            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }
        
        const embed = new EmbedBuilder()
            .setColor('#4ecdc4')
            .setTitle('💤 AFK Status Set')
            .setDescription(`You are now AFK in **${interaction.guild.name}**`)
            .addFields(
                { name: '💭 Reason', value: sanitizedReason, inline: true },
                { name: '📅 Since', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
            )
            .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
            .setFooter({ text: 'Send any message to clear AFK status | Use /afk clear to manually clear' })
            .setTimestamp();
        
        await interaction.reply({ embeds: [embed] });
    } catch (error) {
        logError('handleAfkSetSlash', error, { userId: interaction.user.id, guildId: interaction.guild.id });
        const embed = createErrorEmbed('Error', 'An error occurred while setting AFK status.');
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral }).catch(() => {});
    }
}

async function handleAfkClearSlash(interaction) {
    try {
        const afkData = await DatabaseService.getUserAFK(interaction.user.id, interaction.guild.id);
        if (!afkData) {
            const embed = new EmbedBuilder()
                .setColor('#ffa500')
                .setDescription('❌ You are not currently AFK.');
            
            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }
        
        const success = await DatabaseService.removeUserAFK(interaction.user.id, interaction.guild.id);
        
        if (!success) {
            const embed = createErrorEmbed('Database Error', 'Failed to clear AFK status. Please try again.');
            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }
        
        const embed = new EmbedBuilder()
            .setColor('#4ecdc4')
            .setTitle('✅ AFK Status Cleared')
            .setDescription('Your AFK status has been manually removed')
            .addFields(
                { name: 'Previous Status', value: afkData.reason, inline: true },
                { name: 'Total AFK Time', value: formatAfkDuration(new Date(afkData.createdAt).getTime()), inline: true }
            )
            .setTimestamp();
        
        // Check for missed mentions from database
        const userMentions = afkData.mentions || [];
        if (userMentions.length > 0) {
            embed.addFields({ name: '📨 Missed Mentions', value: `${userMentions.length} mention(s) while away`, inline: true });
            embed.setFooter({ text: 'Check your DMs for missed mentions summary' });
            
            // Send missed mentions DM
            try {
                const mentionEmbed = new EmbedBuilder()
                    .setColor('#4ecdc4')
                    .setTitle('📨 Missed Mentions While AFK')
                    .setDescription(`You had **${userMentions.length}** mention(s) while away:`)
                    .setFooter({ text: `Total AFK time: ${formatAfkDuration(new Date(afkData.createdAt).getTime())}` });
                
                userMentions.slice(0, 10).forEach((mention, index) => {
                    mentionEmbed.addFields({
                        name: `${index + 1}. ${mention.username}`,
                        value: `<#${mention.channelId}> - <t:${Math.floor(new Date(mention.timestamp).getTime() / 1000)}:R>`,
                        inline: false
                    });
                });
                
                if (userMentions.length > 10) {
                    mentionEmbed.setFooter({ text: `And ${userMentions.length - 10} more mentions...` });
                }
                
                await interaction.user.send({ embeds: [mentionEmbed] });
            } catch (dmError) {
                logError('handleAfkClearSlash DM', dmError, { userId: interaction.user.id });
            }
        }
        
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } catch (error) {
        logError('handleAfkClearSlash', error, { userId: interaction.user.id, guildId: interaction.guild.id });
        const embed = createErrorEmbed('Error', 'An error occurred while clearing AFK status.');
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral }).catch(() => {});
    }
}

async function handleAfkListSlash(interaction) {
    try {
        // Get all AFK users from database for this guild
        const guildAfkUsers = await DatabaseService.getGuildAFKUsers(interaction.guild.id);
        
        if (guildAfkUsers.length === 0) {
            const embed = new EmbedBuilder()
                .setColor('#4ecdc4')
                .setDescription('✨ No one is currently AFK in this server.')
                .setTimestamp();
            
            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }
        
        // Sort by AFK duration (longest first)
        guildAfkUsers.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        
        const embed = new EmbedBuilder()
            .setColor('#ffa500')
            .setTitle('💤 Currently AFK Users')
            .setDescription(`${guildAfkUsers.length} user(s) are currently AFK in this server:`)
            .setTimestamp();
        
        // Fetch user details and add to embed
        for (let i = 0; i < Math.min(guildAfkUsers.length, 10); i++) {
            const afkUser = guildAfkUsers[i];
            try {
                const member = await interaction.guild.members.fetch(afkUser.userId);
                const mentions = afkUser.mentions || [];
                embed.addFields({
                    name: `${i + 1}. ${member.user.displayName}`,
                    value: `**Status:** ${afkUser.reason}\n**Away for:** ${formatAfkDuration(new Date(afkUser.createdAt).getTime())}\n**Mentions:** ${mentions.length}`,
                    inline: true
                });
            } catch (error) {
                // User not in guild or fetch failed, skip
                logError('handleAfkListSlash member fetch', error, { userId: afkUser.userId });
            }
        }
        
        if (guildAfkUsers.length > 10) {
            embed.setFooter({ text: `And ${guildAfkUsers.length - 10} more AFK users...` });
        }
        
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } catch (error) {
        logError('handleAfkListSlash', error, { guildId: interaction.guild.id });
        const embed = createErrorEmbed('Error', 'An error occurred while fetching AFK users.');
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral }).catch(() => {});
    }
}

async function handleAfkClearCommand(message) {
    try {
        const afkData = await DatabaseService.getUserAFK(message.author.id, message.guild.id);
        if (!afkData) {
            const embed = new EmbedBuilder()
                .setColor('#ffa500')
                .setDescription('❌ You are not currently AFK.');
            
            return message.reply({ embeds: [embed] });
        }
        
        const success = await DatabaseService.removeUserAFK(message.author.id, message.guild.id);
        
        if (!success) {
            const embed = createErrorEmbed('Database Error', 'Failed to clear AFK status. Please try again.');
            return message.reply({ embeds: [embed] });
        }
        
        const embed = new EmbedBuilder()
            .setColor('#4ecdc4')
            .setTitle('✅ AFK Status Cleared')
            .setDescription('Your AFK status has been manually removed')
            .addFields(
                { name: 'Previous Status', value: afkData.reason, inline: true },
                { name: 'Total AFK Time', value: formatAfkDuration(new Date(afkData.createdAt).getTime()), inline: true }
            )
            .setTimestamp();
        
        // Check for missed mentions from database
        const userMentions = afkData.mentions || [];
        if (userMentions.length > 0) {
            embed.addFields({ name: '📨 Missed Mentions', value: `${userMentions.length} mention(s) while away`, inline: true });
            embed.setFooter({ text: 'Check your DMs for missed mentions summary' });
            
            // Send missed mentions DM
            try {
                const mentionEmbed = new EmbedBuilder()
                    .setColor('#4ecdc4')
                    .setTitle('📨 Missed Mentions While AFK')
                    .setDescription(`You had **${userMentions.length}** mention(s) while away:`)
                    .setFooter({ text: `Total AFK time: ${formatAfkDuration(new Date(afkData.createdAt).getTime())}` });
                
                userMentions.slice(0, 10).forEach((mention, index) => {
                    mentionEmbed.addFields({
                        name: `${index + 1}. ${mention.username}`,
                        value: `<#${mention.channelId}> - <t:${Math.floor(new Date(mention.timestamp).getTime() / 1000)}:R>`,
                        inline: false
                    });
                });
                
                if (userMentions.length > 10) {
                    mentionEmbed.setFooter({ text: `And ${userMentions.length - 10} more mentions...` });
                }
                
                await message.author.send({ embeds: [mentionEmbed] });
            } catch (dmError) {
                logError('handleAfkClearCommand DM', dmError, { userId: message.author.id });
            }
        }
        
        await message.reply({ embeds: [embed] });
    } catch (error) {
        logError('handleAfkClearCommand', error, { userId: message.author.id, guildId: message.guild.id });
        const embed = createErrorEmbed('Error', 'An error occurred while clearing AFK status.');
        await message.reply({ embeds: [embed] }).catch(() => {});
    }
}

async function handleAfkListCommand(message) {
    try {
        // Get all AFK users from database for this guild
        const guildAfkUsers = await DatabaseService.getGuildAFKUsers(message.guild.id);
        
        if (guildAfkUsers.length === 0) {
            const embed = new EmbedBuilder()
                .setColor('#4ecdc4')
                .setDescription('✨ No one is currently AFK in this server.')
                .setTimestamp();
            
            return message.reply({ embeds: [embed] });
        }
        
        // Sort by AFK duration (longest first)
        guildAfkUsers.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        
        const embed = new EmbedBuilder()
            .setColor('#ffa500')
            .setTitle('💤 Currently AFK Users')
            .setDescription(`${guildAfkUsers.length} user(s) are currently AFK in this server:`)
            .setTimestamp();
        
        // Fetch user details and add to embed
        for (let i = 0; i < Math.min(guildAfkUsers.length, 10); i++) {
            const afkUser = guildAfkUsers[i];
            try {
                const member = await message.guild.members.fetch(afkUser.userId);
                const mentions = afkUser.mentions || [];
                embed.addFields({
                    name: `${i + 1}. ${member.user.displayName}`,
                    value: `**Status:** ${afkUser.reason}\n**Away for:** ${formatAfkDuration(new Date(afkUser.createdAt).getTime())}\n**Mentions:** ${mentions.length}`,
                    inline: true
                });
            } catch (error) {
                // User not in guild or fetch failed, skip
                logError('handleAfkListCommand member fetch', error, { userId: afkUser.userId });
            }
        }
        
        if (guildAfkUsers.length > 10) {
            embed.setFooter({ text: `And ${guildAfkUsers.length - 10} more AFK users...` });
        }
        
        await message.reply({ embeds: [embed] });
    } catch (error) {
        logError('handleAfkListCommand', error, { guildId: message.guild.id });
        const embed = createErrorEmbed('Error', 'An error occurred while fetching AFK users.');
        await message.reply({ embeds: [embed] }).catch(() => {});
    }
}

async function handleServerInfoCommand(message) {
    const guild = message.guild;
    
    try {
        const owner = await guild.fetchOwner();
        
        // Fetch all members for accurate statistics
        await guild.members.fetch();
        
        // Calculate member statistics
        const allMembers = guild.members.cache;
        const totalMembers = allMembers.size;
        const humans = allMembers.filter(member => !member.user.bot).size;
        const bots = allMembers.filter(member => member.user.bot).size;
        
        // Calculate online status (now with proper Guild Presences intent)
        const onlineMembers = allMembers.filter(member => 
            !member.user.bot && (
                member.presence?.status === 'online' || 
                member.presence?.status === 'idle' || 
                member.presence?.status === 'dnd'
            )
        ).size;
        
        // Channel breakdown
        const channels = guild.channels.cache;
        const textChannels = channels.filter(channel => channel.type === 0).size;
        const voiceChannels = channels.filter(channel => channel.type === 2).size;
        const categoryChannels = channels.filter(channel => channel.type === 4).size;
        
        // Role information
        const roles = guild.roles.cache.size - 1; // Exclude @everyone
        
        // Server features
        const features = guild.features.length > 0 ? guild.features.map(feature => 
            feature.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
        ).join(', ') : 'None';
        
        // Calculate server age
        const serverAge = Math.floor((Date.now() - guild.createdTimestamp) / (1000 * 60 * 60 * 24));
        
        const embed = new EmbedBuilder()
            .setColor('#4ecdc4')
            .setTitle(`📊 ${guild.name} Server Information`)
            .setThumbnail(guild.iconURL({ dynamic: true, size: 256 }))
            .addFields(
                // Basic Info
                { name: '👑 Owner', value: `${owner.user.tag}\n\`${owner.user.id}\``, inline: true },
                { name: '📅 Server Age', value: `${serverAge} days\n<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
                { name: '🆔 Server ID', value: `\`${guild.id}\``, inline: true },
                
                // Member Statistics
                { name: '👥 Total Members', value: `${totalMembers.toLocaleString()}`, inline: true },
                { name: '🧑‍💻 Humans', value: `${humans.toLocaleString()}`, inline: true },
                { name: '🤖 Bots', value: `${bots.toLocaleString()}`, inline: true },
                
                // Activity
                { name: '🟢 Online/Active', value: `${onlineMembers.toLocaleString()}`, inline: true },
                { name: '📊 Human/Bot Ratio', value: `${bots > 0 ? (humans/bots).toFixed(1) : humans}:1`, inline: true },
                { name: '📈 Online Rate', value: `${humans > 0 ? ((onlineMembers/humans)*100).toFixed(1) : 0}%`, inline: true },
                
                // Channels
                { name: '💬 Text Channels', value: `${textChannels}`, inline: true },
                { name: '🔊 Voice Channels', value: `${voiceChannels}`, inline: true },
                { name: '📁 Categories', value: `${categoryChannels}`, inline: true },
                
                // Server Details
                { name: '🎭 Roles', value: `${roles}`, inline: true },
                { name: '😀 Emojis', value: `${guild.emojis.cache.size}`, inline: true },
                { name: '🛡️ Verification', value: getVerificationLevel(guild.verificationLevel), inline: true },
                
                // Features
                { name: '✨ Server Features', value: features.length > 1024 ? features.substring(0, 1021) + '...' : features, inline: false }
            )
            .setTimestamp();
        
        if (guild.description) {
            embed.setDescription(`*${guild.description}*`);
        }
        
        // Add server boost info if applicable
        if (guild.premiumSubscriptionCount > 0) {
            embed.addFields({
                name: '💎 Nitro Boosts',
                value: `Level ${guild.premiumTier} (${guild.premiumSubscriptionCount} boosts)`,
                inline: true
            });
        }
        
        embed.setFooter({ 
            text: `Analysis completed • ${guild.memberCount} members verified` 
        });
        
        await message.reply({ embeds: [embed] });
        
    } catch (error) {
        console.error('Error in serverinfo command:', error);
        const errorEmbed = new EmbedBuilder()
            .setColor('#ff4757')
            .setTitle('❌ Error')
            .setDescription('Failed to fetch complete server information. Some data may be unavailable.')
            .setTimestamp();
        
        await message.reply({ embeds: [errorEmbed] });
    }
}

async function handleServerInfoSlash(interaction) {
    await interaction.deferReply();
    
    try {
        const guild = interaction.guild;
        
        // Fetch detailed information
        const owner = await guild.fetchOwner();
        const members = await guild.members.fetch();
        
        // Analyze members
        const botCount = members.filter(member => member.user.bot).size;
        const humanCount = members.size - botCount;
        
        const onlineMembers = members.filter(member => 
            !member.user.bot && ['online', 'idle', 'dnd'].includes(member.presence?.status)
        ).size;
        
        // Count roles, channels by type
        const roles = guild.roles.cache.filter(role => role.name !== '@everyone');
        const textChannels = guild.channels.cache.filter(ch => ch.type === 0).size;
        const voiceChannels = guild.channels.cache.filter(ch => ch.type === 2).size;
        const categories = guild.channels.cache.filter(ch => ch.type === 4).size;
        
        // Create detailed embed
        const embed = new EmbedBuilder()
            .setColor('#4ecdc4')
            .setTitle(`📊 ${guild.name} - Server Information`)
            .setThumbnail(guild.iconURL({ dynamic: true, size: 256 }))
            .addFields(
                { name: '👑 Server Owner', value: `${owner.user.tag}\n(${owner.user.id})`, inline: true },
                { name: '📅 Server Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:F>\n<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
                { name: '🛡️ Verification Level', value: getVerificationLevel(guild.verificationLevel), inline: true },
                
                { name: '👥 Total Members', value: `**${guild.memberCount}** members`, inline: true },
                { name: '🤖 Bots vs Humans', value: `🤖 **${botCount}** bots\n👤 **${humanCount}** humans`, inline: true },
                { name: '🟢 Online Members', value: `**${onlineMembers}** / ${humanCount} humans`, inline: true },
                
                { name: '� Text Channels', value: `**${textChannels}** channels`, inline: true },
                { name: '� Voice Channels', value: `**${voiceChannels}** channels`, inline: true },
                { name: '📁 Categories', value: `**${categories}** categories`, inline: true },
                
                { name: '🎭 Roles', value: `**${roles.size}** roles`, inline: true },
                { name: '😀 Emojis', value: `**${guild.emojis.cache.size}** emojis`, inline: true },
                { name: '� Online Rate', value: `**${humanCount > 0 ? ((onlineMembers/humanCount)*100).toFixed(1) : 0}%**`, inline: true }
            )
            .setTimestamp();
        
        // Add server description if available
        if (guild.description) {
            embed.setDescription(`*${guild.description}*`);
        }
        
        // Add server banner if available
        if (guild.bannerURL()) {
            embed.setImage(guild.bannerURL({ dynamic: true, size: 1024 }));
        }
        
        // Server boost info
        if (guild.premiumTier > 0) {
            embed.addFields({
                name: '💎 Server Boost',
                value: `Level **${guild.premiumTier}** (${guild.premiumSubscriptionCount} boosts)`,
                inline: true
            });
        }
        
        await interaction.editReply({ embeds: [embed] });
        
    } catch (error) {
        console.error('Error in serverinfo slash command:', error);
        const errorEmbed = createErrorEmbed(
            'Server Analysis Failed',
            'Could not retrieve detailed server information. Please try again later.'
        );
        await interaction.editReply({ embeds: [errorEmbed] });
    }
}

async function handleAvatarCommand(message, args) {
    const user = message.mentions.users.first() || message.author;
    
    const embed = new EmbedBuilder()
        .setColor('#4ecdc4')
        .setTitle(`${user.displayName}'s Avatar`)
        .setImage(user.displayAvatarURL({ dynamic: true, size: 512 }))
        .setTimestamp();
    
    await message.reply({ embeds: [embed] });
}

async function handleAvatarSlash(interaction) {
    const user = interaction.options.getUser('user') || interaction.user;
    
    const embed = new EmbedBuilder()
        .setColor('#4ecdc4')
        .setTitle(`${user.displayName}'s Avatar`)
        .setImage(user.displayAvatarURL({ dynamic: true, size: 512 }))
        .setTimestamp();
    
    await interaction.reply({ embeds: [embed] });
}

async function handleBannerCommand(message, args) {
    try {
        const user = message.mentions.users.first() || message.author;
        
        // Fetch the full user object to get banner info
        const fullUser = await client.users.fetch(user.id, { force: true });
        
        if (!fullUser.banner) {
            const embed = new EmbedBuilder()
                .setColor('#ff6b35')
                .setTitle(`${fullUser.displayName}'s Banner`)
                .setDescription('❌ This user doesn\'t have a banner set.')
                .setTimestamp();
            
            return message.reply({ embeds: [embed] });
        }
        
        const bannerURL = fullUser.bannerURL({ dynamic: true, size: 1024 });
        
        const embed = new EmbedBuilder()
            .setColor(fullUser.accentColor || '#4ecdc4')
            .setTitle(`${fullUser.displayName}'s Banner`)
            .setImage(bannerURL)
            .setTimestamp();
        
        await message.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Error in handleBannerCommand:', error);
        const errorEmbed = createErrorEmbed('Error', 'Failed to fetch user banner.');
        await message.reply({ embeds: [errorEmbed] });
    }
}

async function handleBannerSlash(interaction) {
    try {
        const user = interaction.options.getUser('user') || interaction.user;
        
        // Fetch the full user object to get banner info
        const fullUser = await client.users.fetch(user.id, { force: true });
        
        if (!fullUser.banner) {
            const embed = new EmbedBuilder()
                .setColor('#ff6b35')
                .setTitle(`${fullUser.displayName}'s Banner`)
                .setDescription('❌ This user doesn\'t have a banner set.')
                .setTimestamp();
            
            return interaction.reply({ embeds: [embed] });
        }
        
        const bannerURL = fullUser.bannerURL({ dynamic: true, size: 1024 });
        
        const embed = new EmbedBuilder()
            .setColor(fullUser.accentColor || '#4ecdc4')
            .setTitle(`${fullUser.displayName}'s Banner`)
            .setImage(bannerURL)
            .setTimestamp();
        
        await interaction.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Error in handleBannerSlash:', error);
        const errorEmbed = createErrorEmbed('Error', 'Failed to fetch user banner.');
        await interaction.reply({ embeds: [errorEmbed] });
    }
}

async function handleRemindMeCommand(message, args) {
    if (args.length < 2) {
        return message.reply('❌ Usage: `!remindme <time> <message>`\nExample: `!remindme 10m Take a break`');
    }
    
    const timeStr = args[0];
    const reminderMessage = args.slice(1).join(' ');
    
    const timestamp = parseReminderTime(timeStr);
    if (!timestamp) {
        return message.reply('❌ Invalid time format. Use: 10m, 2h, 1d, 1w or absolute dates like "2023-12-25 15:30"');
    }
    
    const reminderId = createReminder(
        message.author.id,
        message.guild.id,
        message.channel.id,
        reminderMessage,
        timestamp
    );
    
    const embed = createSuccessEmbed(
        'Reminder Set',
        `I'll remind you about "${reminderMessage}" in ${formatTimeRemaining(timestamp)}\n**Reminder ID:** ${reminderId}`
    );
    await message.reply({ embeds: [embed] });
}

async function handleRemindersCommand(message) {
    const userReminders = getUserReminders(message.author.id);
    
    if (userReminders.length === 0) {
        return message.reply('📭 You have no active reminders.');
    }
    
    const embed = new EmbedBuilder()
        .setColor('#4ecdc4')
        .setTitle('⏰ Your Active Reminders')
        .setDescription(`You have ${userReminders.length} active reminder(s):`);
    
    userReminders.slice(0, 10).forEach((reminder, index) => {
        embed.addFields({
            name: `${index + 1}. ${reminder.id}`,
            value: `**Message:** ${reminder.message.substring(0, 50)}${reminder.message.length > 50 ? '...' : ''}\n**Time:** ${formatTimeRemaining(reminder.timestamp)}`,
            inline: false
        });
    });
    
    if (userReminders.length > 10) {
        embed.setFooter({ text: `And ${userReminders.length - 10} more reminders...` });
    }
    
    await message.reply({ embeds: [embed] });
}

async function handlePrivacyCommand(message, args) {
    // Bot owners have full access, server owners and authorized users have limited access
    if (!isBotOwner(message.author.id) && 
        message.guild.ownerId !== message.author.id && 
        !isAuthorizedUser(message.author.id)) {
        const embed = new EmbedBuilder()
            .setColor('#ff4757')
            .setTitle('❌ Access Denied')
            .setDescription('Only bot owners, server owners, or authorized users can manage privacy settings.');
        
        return message.reply({ embeds: [embed] });
    }
    
    const subcommand = args[0]?.toLowerCase();
    
    if (!subcommand || subcommand === 'status') {
        const embed = new EmbedBuilder()
            .setColor('#4ecdc4')
            .setTitle('🔒 Privacy Settings')
            .addFields(
                { 
                    name: 'Private Mode', 
                    value: isPrivateModeEnabled() ? '✅ Enabled' : '❌ Disabled', 
                    inline: true 
                },
                { 
                    name: 'Server Status', 
                    value: isAuthorizedGuild(message.guild.id) ? '✅ Authorized' : '❌ Unauthorized', 
                    inline: true 
                }
            )
            .setDescription('Use `!privacy info` for detailed information')
            .setTimestamp();
        
        return message.reply({ embeds: [embed] });
    }
    
    if (subcommand === 'info') {
        const embed = new EmbedBuilder()
            .setColor('#4ecdc4')
            .setTitle('🔒 Privacy Information')
            .setDescription('To authorize this server, add this Guild ID to AUTHORIZED_GUILDS environment variable:')
            .addFields({
                name: 'Guild ID',
                value: `\`${message.guild.id}\``,
                inline: false
            })
            .setFooter({ text: 'Set PRIVATE_MODE=true to enable private mode' })
            .setTimestamp();
        
        return message.reply({ embeds: [embed] });
    }
}

async function handlePrivacySlash(interaction) {
    // Bot owners have full access, server owners and authorized users have limited access
    if (!isBotOwner(interaction.user.id) && 
        interaction.guild.ownerId !== interaction.user.id && 
        !isAuthorizedUser(interaction.user.id)) {
        const embed = new EmbedBuilder()
            .setColor('#ff4757')
            .setTitle('❌ Access Denied')
            .setDescription('Only bot owners, server owners, or authorized users can manage privacy settings.');
        
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
    
    const subcommand = interaction.options.getSubcommand();
    
    if (subcommand === 'status') {
        const embed = new EmbedBuilder()
            .setColor('#4ecdc4')
            .setTitle('🔒 Privacy Settings')
            .addFields(
                { 
                    name: 'Private Mode', 
                    value: isPrivateModeEnabled() ? '✅ Enabled' : '❌ Disabled', 
                    inline: true 
                },
                { 
                    name: 'Server Status', 
                    value: isAuthorizedGuild(interaction.guild.id) ? '✅ Authorized' : '❌ Unauthorized', 
                    inline: true 
                },
                {
                    name: 'Your Access Level',
                    value: canUseBot(interaction.member) ? '✅ Authorized' : '❌ Unauthorized',
                    inline: true
                }
            )
            .setDescription('Use `/privacy info` for detailed information')
            .setFooter({ text: 'Privacy mode restricts bot usage to authorized servers and users' })
            .setTimestamp();
        
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
    
    if (subcommand === 'info') {
        const authorizedGuilds = process.env.AUTHORIZED_GUILDS?.split(',').map(id => id.trim()) || [];
        const authorizedUsers = process.env.AUTHORIZED_USERS?.split(',').map(id => id.trim()) || [];
        
        const embed = new EmbedBuilder()
            .setColor('#4ecdc4')
            .setTitle('🔒 Privacy Information')
            .addFields(
                { 
                    name: 'Private Mode', 
                    value: isPrivateModeEnabled() ? '✅ Enabled' : '❌ Disabled', 
                    inline: true 
                },
                { 
                    name: 'Authorized Servers', 
                    value: authorizedGuilds.length > 0 ? `${authorizedGuilds.length} server(s)` : 'None', 
                    inline: true 
                },
                { 
                    name: 'Authorized Users', 
                    value: authorizedUsers.length > 0 ? `${authorizedUsers.length} user(s)` : 'None', 
                    inline: true 
                },
                {
                    name: 'This Server',
                    value: `**Guild ID:** \`${interaction.guild.id}\`\n**Status:** ${isAuthorizedGuild(interaction.guild.id) ? '✅ Authorized' : '❌ Unauthorized'}`,
                    inline: false
                },
                {
                    name: 'How to Authorize This Server',
                    value: `Add this Guild ID to your \`AUTHORIZED_GUILDS\` environment variable:\n\`\`\`\nAUTHORIZED_GUILDS=${interaction.guild.id}\n\`\`\``,
                    inline: false
                }
            )
            .setFooter({ text: 'Restart the bot after updating environment variables' })
            .setTimestamp();
        
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
}

async function handleSetupMuteCommand(message) {
    if (!hasModeratorPermissions(message.member)) {
        return message.reply('❌ You need moderator permissions to use this command.');
    }
    
    try {
        const embed = new EmbedBuilder()
            .setColor('#4ecdc4')
            .setTitle('🔧 Setting Up Muted Role...')
            .setDescription('Configuring mute permissions for all channels...')
            .setTimestamp();
        
        const statusMessage = await message.reply({ embeds: [embed] });
        
        // Get or create muted role and set up permissions
        const mutedRole = await getMutedRole(message.guild);
        
        if (!mutedRole) {
            const errorEmbed = new EmbedBuilder()
                .setColor('#ff4757')
                .setTitle('❌ Setup Failed')
                .setDescription('Could not create or find the muted role.')
                .setTimestamp();
            
            return statusMessage.edit({ embeds: [errorEmbed] });
        }
        
        const successEmbed = new EmbedBuilder()
            .setColor('#2ecc71')
            .setTitle('✅ Muted Role Setup Complete')
            .setDescription('Successfully configured mute permissions!')
            .addFields(
                { name: 'Role Name', value: mutedRole.name, inline: true },
                { name: 'Role ID', value: mutedRole.id, inline: true },
                { name: 'Position', value: `${mutedRole.position}`, inline: true }
            )
            .setFooter({ text: 'Mute permissions have been applied to all channels' })
            .setTimestamp();
        
        await statusMessage.edit({ embeds: [successEmbed] });
    } catch (error) {
        console.error('Error in setupmute command:', error);
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#ff4757')
            .setTitle('❌ Setup Failed')
            .setDescription('An error occurred while setting up the muted role.')
            .setTimestamp();
        
        await message.reply({ embeds: [errorEmbed] });
    }
}

async function handleAdminCommand(message, args) {
    if (!hasBotOwnerPermissions(message.member)) {
        return message.reply('❌ Only bot owners can use admin commands.');
    }
    
    const subcommand = args[0]?.toLowerCase();
    
    if (!subcommand) {
        const helpEmbed = new EmbedBuilder()
            .setColor('#4ecdc4')
            .setTitle('👑 Admin Commands')
            .setDescription('Available admin subcommands:')
            .addFields(
                { name: '`!admin list`', value: 'List all authorized users', inline: false },
                { name: '`!admin add @user`', value: 'Show instructions to add a user', inline: false },
                { name: '`!admin remove @user`', value: 'Show instructions to remove a user', inline: false }
            )
            .setFooter({ text: 'Admin commands are exclusive to the server owner' });
        
        return message.reply({ embeds: [helpEmbed] });
    }
    
    switch (subcommand) {
        case 'list':
            const authorizedUsers = process.env.AUTHORIZED_USERS?.split(',').map(id => id.trim()) || [];
            
            if (authorizedUsers.length === 0) {
                return message.reply('📭 No authorized users configured.');
            }
            
            const listEmbed = new EmbedBuilder()
                .setColor('#4ecdc4')
                .setTitle('👑 Authorized Users')
                .setDescription(`Currently ${authorizedUsers.length} authorized user(s):`);
            
            for (const userId of authorizedUsers.slice(0, 10)) {
                try {
                    const user = await client.users.fetch(userId);
                    listEmbed.addFields({ name: user.tag, value: `<@${userId}>`, inline: true });
                } catch (error) {
                    listEmbed.addFields({ name: 'Unknown User', value: `ID: ${userId}`, inline: true });
                }
            }
            
            await message.reply({ embeds: [listEmbed] });
            break;
            
        case 'add':
            const userToAdd = message.mentions.users.first();
            if (!userToAdd) {
                return message.reply('❌ Please mention a user to add. Usage: `!admin add @user`');
            }
            
            const currentAuthorizedUsers = process.env.AUTHORIZED_USERS?.split(',').map(id => id.trim()) || [];
            
            if (currentAuthorizedUsers.includes(userToAdd.id)) {
                return message.reply(`❌ ${userToAdd.tag} is already in the authorized users list.`);
            }
            
            currentAuthorizedUsers.push(userToAdd.id);
            
            const addEmbed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('✅ User Authorization Instructions')
                .setDescription(`To authorize ${userToAdd.tag}, add their ID to your .env file:`)
                .addFields({ 
                    name: 'Add to AUTHORIZED_USERS', 
                    value: `\`AUTHORIZED_USERS=${currentAuthorizedUsers.join(',')}\``,
                    inline: false 
                })
                .setFooter({ text: 'Restart the bot after updating the .env file' });
            
            await message.reply({ embeds: [addEmbed] });
            break;
            
        case 'remove':
            const userToRemove = message.mentions.users.first();
            if (!userToRemove) {
                return message.reply('❌ Please mention a user to remove. Usage: `!admin remove @user`');
            }
            
            let updatedAuthorizedUsers = process.env.AUTHORIZED_USERS?.split(',').map(id => id.trim()) || [];
            
            if (!updatedAuthorizedUsers.includes(userToRemove.id)) {
                return message.reply(`❌ ${userToRemove.tag} is not in the authorized users list.`);
            }
            
            updatedAuthorizedUsers = updatedAuthorizedUsers.filter(id => id !== userToRemove.id);
            
            const removeEmbed = new EmbedBuilder()
                .setColor('#ff6b6b')
                .setTitle('🗑️ User Deauthorization Instructions')
                .setDescription(`To remove ${userToRemove.tag} from authorized users, update your .env file:`)
                .addFields({ 
                    name: 'Update AUTHORIZED_USERS', 
                    value: updatedAuthorizedUsers.length > 0 ? `\`AUTHORIZED_USERS=${updatedAuthorizedUsers.join(',')}\`` : '`AUTHORIZED_USERS=` (empty)',
                    inline: false 
                })
                .setFooter({ text: 'Restart the bot after updating the .env file' });
            
            await message.reply({ embeds: [removeEmbed] });
            break;
            
        default:
            await message.reply('❌ Invalid subcommand. Use `!admin` to see available options.');
    }
}

async function handleAntidoxxCommand(message, args) {
    // Check if user is bot owner, authorized user, server owner, or admin
    if (!isBotOwner(message.author.id) &&
        !isAuthorizedUser(message.author.id) && 
        message.guild.ownerId !== message.author.id && 
        !message.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return message.reply('❌ Only bot owners, authorized users, server owners, or administrators can use the antidoxx command.');
    }
    
    const reason = args.join(' ') || 'Emergency antidoxx activated';
    
    try {
        const embed = new EmbedBuilder()
            .setColor('#ff4757')
            .setTitle('🚨 Emergency Antidoxx Activated')
            .setDescription('Viewlocking all channels in the server...')
            .addFields(
                { name: 'Initiated by', value: `<@${message.author.id}>`, inline: true },
                { name: 'Reason', value: reason, inline: true }
            )
            .setTimestamp();
        
        const statusMessage = await message.reply({ embeds: [embed] });
        
        // Viewlock all channels
        const result = await viewlockAllChannels(message.guild, reason, message.author);
        
        // Update the embed with results
        const resultEmbed = new EmbedBuilder()
            .setColor(result.success ? '#2ecc71' : '#ff4757')
            .setTitle(result.success ? '✅ Antidoxx Complete' : '⚠️ Antidoxx Partial')
            .setDescription(result.message)
            .addFields(
                { name: 'Initiated by', value: `<@${message.author.id}>`, inline: true },
                { name: 'Reason', value: reason, inline: true },
                { name: 'Channels Affected', value: `${result.successCount}/${result.totalCount}`, inline: true }
            )
            .setTimestamp();
        
        if (result.errors.length > 0) {
            resultEmbed.addFields({
                name: 'Errors',
                value: result.errors.slice(0, 3).join('\n') + (result.errors.length > 3 ? `\n... and ${result.errors.length - 3} more` : ''),
                inline: false
            });
        }
        
        await statusMessage.edit({ embeds: [resultEmbed] });
        
        // Log the action
        console.log(`🚨 Antidoxx activated by ${message.author.tag} in ${message.guild.name}: ${reason}`);
        
    } catch (error) {
        console.error('Error in antidoxx command:', error);
        await message.reply('❌ An error occurred while executing the antidoxx command.');
    }
}

async function handleAntidoxxSlash(interaction) {
    // Check if user is bot owner, authorized user, server owner, or admin
    if (!isBotOwner(interaction.user.id) &&
        !isAuthorizedUser(interaction.user.id) && 
        interaction.guild.ownerId !== interaction.user.id && 
        !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ 
            embeds: [createErrorEmbed('Permission Denied', 'Only bot owners, authorized users, server owners, or administrators can use the antidoxx command.')], 
            flags: MessageFlags.Ephemeral 
        });
    }
    
    const reason = interaction.options.getString('reason') || 'Emergency antidoxx activated';
    
    try {
        const embed = new EmbedBuilder()
            .setColor('#ff4757')
            .setTitle('🚨 Emergency Antidoxx Activated')
            .setDescription('Viewlocking all channels in the server...')
            .addFields(
                { name: 'Initiated by', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'Reason', value: reason, inline: true }
            )
            .setTimestamp();
        
        await interaction.reply({ embeds: [embed] });
        
        // Viewlock all channels
        const result = await viewlockAllChannels(interaction.guild, reason, interaction.user);
        
        // Update the embed with results
        const resultEmbed = new EmbedBuilder()
            .setColor(result.success ? '#2ecc71' : '#ff4757')
            .setTitle(result.success ? '✅ Antidoxx Complete' : '⚠️ Antidoxx Partial')
            .setDescription(result.message)
            .addFields(
                { name: 'Initiated by', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'Reason', value: reason, inline: true },
                { name: 'Channels Affected', value: `${result.successCount}/${result.totalCount}`, inline: true }
            )
            .setTimestamp();
        
        if (result.errors.length > 0) {
            resultEmbed.addFields({
                name: 'Errors',
                value: result.errors.slice(0, 3).join('\n') + (result.errors.length > 3 ? `\n... and ${result.errors.length - 3} more` : ''),
                inline: false
            });
        }
        
        await interaction.editReply({ embeds: [resultEmbed] });
        
        // Log the action
        console.log(`🚨 Antidoxx activated by ${interaction.user.tag} in ${interaction.guild.name}: ${reason}`);
        
    } catch (error) {
        console.error('Error in antidoxx slash command:', error);
        const errorEmbed = createErrorEmbed('Command Error', 'An error occurred while executing the antidoxx command.');
        
        if (interaction.replied || interaction.deferred) {
            await interaction.editReply({ embeds: [errorEmbed] });
        } else {
            await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        }
    }
}

async function viewlockAllChannels(guild, reason, user) {
    const result = {
        success: true,
        successCount: 0,
        totalCount: 0,
        errors: [],
        message: '',
        viewlockedChannels: []
    };
    
    try {
        const channels = await guild.channels.fetch();
        const everyoneRole = guild.roles.everyone;
        
        // Filter channels that can be viewlocked (text, voice, announcement, stage, forum)
        const lockableChannels = channels.filter(channel => 
            channel.type === 0 || // Text
            channel.type === 2 || // Voice
            channel.type === 5 || // Announcement
            channel.type === 13 || // Stage
            channel.type === 15   // Forum
        );
        
        result.totalCount = lockableChannels.size;
        
        if (result.totalCount === 0) {
            result.message = 'No channels found that can be viewlocked.';
            result.success = false;
            return result;
        }
        
        // Process channels in batches to avoid rate limits
        const batchSize = 5;
        const channelBatches = [];
        const channelArray = Array.from(lockableChannels.values());
        
        for (let i = 0; i < channelArray.length; i += batchSize) {
            channelBatches.push(channelArray.slice(i, i + batchSize));
        }
        
        for (const batch of channelBatches) {
            const batchPromises = batch.map(async (channel) => {
                try {
                    // Check if channel was already viewlocked before antidoxx
                    const everyoneOverwrite = channel.permissionOverwrites.cache.get(everyoneRole.id);
                    const wasAlreadyViewlocked = everyoneOverwrite && everyoneOverwrite.deny.has('ViewChannel');
                    
                    // Set @everyone to not be able to view the channel
                    await channel.permissionOverwrites.edit(everyoneRole, {
                        ViewChannel: false
                    }, {
                        reason: `Antidoxx by ${user.tag}: ${reason}`
                    });
                    result.successCount++;
                    
                    // Only track channels that weren't already viewlocked
                    if (!wasAlreadyViewlocked) {
                        result.viewlockedChannels.push({
                            id: channel.id,
                            name: channel.name,
                            type: channel.type
                        });
                    }
                } catch (error) {
                    result.errors.push(`${channel.name}: ${error.message}`);
                    console.error(`Error viewlocking channel ${channel.name}:`, error);
                }
            });
            
            await Promise.all(batchPromises);
            
            // Small delay between batches to avoid rate limits
            if (channelBatches.length > 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        // Save antidoxx data for this guild
        if (result.viewlockedChannels.length > 0) {
            antidoxxData.set(guild.id, {
                channels: result.viewlockedChannels,
                timestamp: Date.now(),
                user: {
                    id: user.id,
                    tag: user.tag
                },
                reason: reason
            });
            
            // Save immediately
            // Data automatically saved to database
            console.log(`🔒 Tracked ${result.viewlockedChannels.length} newly viewlocked channels for guild ${guild.name}`);
        }
        
        if (result.successCount === result.totalCount) {
            result.message = `Successfully viewlocked all ${result.totalCount} channels.`;
        } else if (result.successCount > 0) {
            result.message = `Viewlocked ${result.successCount} out of ${result.totalCount} channels. Some channels failed.`;
            result.success = false;
        } else {
            result.message = 'Failed to viewlock any channels.';
            result.success = false;
        }
        
    } catch (error) {
        result.errors.push(`General error: ${error.message}`);
        result.message = 'A critical error occurred during the antidoxx operation.';
        result.success = false;
        console.error('Critical error in viewlockAllChannels:', error);
    }
    
    return result;
}

async function handleUndoAntidoxxCommand(message, args) {
    // Check if user is bot owner, authorized user, server owner, or admin
    if (!isBotOwner(message.author.id) &&
        !isAuthorizedUser(message.author.id) && 
        message.guild.ownerId !== message.author.id && 
        !message.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return message.reply('❌ Only bot owners, authorized users, server owners, or administrators can use the undoantidoxx command.');
    }
    
    const reason = args.join(' ') || 'Restoring channel visibility after antidoxx';
    
    try {
        const embed = new EmbedBuilder()
            .setColor('#2ecc71')
            .setTitle('🔓 Undoing Antidoxx')
            .setDescription('Restoring visibility for all channels...')
            .addFields(
                { name: 'Initiated by', value: `<@${message.author.id}>`, inline: true },
                { name: 'Reason', value: reason, inline: true }
            )
            .setTimestamp();
        
        const statusMessage = await message.reply({ embeds: [embed] });
        
        // Restore channel visibility
        const result = await restoreChannelVisibility(message.guild, reason, message.author);
        
        // Update the embed with results
        const resultEmbed = new EmbedBuilder()
            .setColor(result.success ? '#2ecc71' : '#ff4757')
            .setTitle(result.success ? '✅ Antidoxx Undone' : '⚠️ Partial Restoration')
            .setDescription(result.message)
            .addFields(
                { name: 'Initiated by', value: `<@${message.author.id}>`, inline: true },
                { name: 'Reason', value: reason, inline: true },
                { name: 'Channels Affected', value: `${result.successCount}/${result.totalCount}`, inline: true }
            )
            .setTimestamp();
        
        if (result.errors.length > 0) {
            resultEmbed.addFields({
                name: 'Errors',
                value: result.errors.slice(0, 3).join('\n') + (result.errors.length > 3 ? `\n... and ${result.errors.length - 3} more` : ''),
                inline: false
            });
        }
        
        await statusMessage.edit({ embeds: [resultEmbed] });
        
        // Log the action
        console.log(`🔓 Undoantidoxx activated by ${message.author.tag} in ${message.guild.name}: ${reason}`);
        
    } catch (error) {
        console.error('Error in undoantidoxx command:', error);
        await message.reply('❌ An error occurred while executing the undoantidoxx command.');
    }
}

async function handleUndoAntidoxxSlash(interaction) {
    // Check if user is bot owner, authorized user, server owner, or admin
    if (!isBotOwner(interaction.user.id) &&
        !isAuthorizedUser(interaction.user.id) && 
        interaction.guild.ownerId !== interaction.user.id && 
        !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ 
            embeds: [createErrorEmbed('Permission Denied', 'Only bot owners, authorized users, server owners, or administrators can use the undoantidoxx command.')], 
            flags: MessageFlags.Ephemeral 
        });
    }
    
    const reason = interaction.options.getString('reason') || 'Restoring channel visibility after antidoxx';
    
    try {
        const embed = new EmbedBuilder()
            .setColor('#2ecc71')
            .setTitle('🔓 Undoing Antidoxx')
            .setDescription('Restoring visibility for all channels...')
            .addFields(
                { name: 'Initiated by', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'Reason', value: reason, inline: true }
            )
            .setTimestamp();
        
        await interaction.reply({ embeds: [embed] });
        
        // Restore channel visibility
        const result = await restoreChannelVisibility(interaction.guild, reason, interaction.user);
        
        // Update the embed with results
        const resultEmbed = new EmbedBuilder()
            .setColor(result.success ? '#2ecc71' : '#ff4757')
            .setTitle(result.success ? '✅ Antidoxx Undone' : '⚠️ Partial Restoration')
            .setDescription(result.message)
            .addFields(
                { name: 'Initiated by', value: `<@${interaction.user.id}>`, inline: true },
                { name: 'Reason', value: reason, inline: true },
                { name: 'Channels Affected', value: `${result.successCount}/${result.totalCount}`, inline: true }
            )
            .setTimestamp();
        
        if (result.errors.length > 0) {
            resultEmbed.addFields({
                name: 'Errors',
                value: result.errors.slice(0, 3).join('\n') + (result.errors.length > 3 ? `\n... and ${result.errors.length - 3} more` : ''),
                inline: false
            });
        }
        
        await interaction.editReply({ embeds: [resultEmbed] });
        
        // Log the action
        console.log(`🔓 Undoantidoxx activated by ${interaction.user.tag} in ${interaction.guild.name}: ${reason}`);
        
    } catch (error) {
        console.error('Error in undoantidoxx slash command:', error);
        const errorEmbed = createErrorEmbed('Command Error', 'An error occurred while executing the undoantidoxx command.');
        
        if (interaction.replied || interaction.deferred) {
            await interaction.editReply({ embeds: [errorEmbed] });
        } else {
            await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
        }
    }
}

async function restoreChannelVisibility(guild, reason, user) {
    const result = {
        success: true,
        successCount: 0,
        totalCount: 0,
        errors: [],
        message: ''
    };
    
    try {
        // Check if there's antidoxx data for this guild
        const guildAntidoxxData = antidoxxData.get(guild.id);
        
        if (!guildAntidoxxData || !guildAntidoxxData.channels || guildAntidoxxData.channels.length === 0) {
            result.message = 'No antidoxx data found for this server. Either no antidoxx was performed or channels were already restored.';
            result.success = false;
            return result;
        }
        
        const channelsToRestore = guildAntidoxxData.channels;
        result.totalCount = channelsToRestore.length;
        
        const everyoneRole = guild.roles.everyone;
        
        // Process channels in batches to avoid rate limits
        const batchSize = 5;
        const channelBatches = [];
        
        for (let i = 0; i < channelsToRestore.length; i += batchSize) {
            channelBatches.push(channelsToRestore.slice(i, i + batchSize));
        }
        
        for (const batch of channelBatches) {
            const batchPromises = batch.map(async (channelData) => {
                try {
                    // Try to get the channel
                    const channel = await guild.channels.fetch(channelData.id).catch(() => null);
                    
                    if (!channel) {
                        result.errors.push(`${channelData.name}: Channel no longer exists`);
                        return;
                    }
                    
                    // Check if @everyone has explicit ViewChannel deny permission
                    const everyoneOverwrite = channel.permissionOverwrites.cache.get(everyoneRole.id);
                    
                    if (everyoneOverwrite && everyoneOverwrite.deny.has('ViewChannel')) {
                        // Remove the explicit deny permission (restore to inherit)
                        await channel.permissionOverwrites.edit(everyoneRole, {
                            ViewChannel: null
                        }, {
                            reason: `Undoantidoxx by ${user.tag}: ${reason}`
                        });
                        result.successCount++;
                        console.log(`🔓 Restored visibility for ${channel.name}`);
                    } else {
                        // Channel wasn't viewlocked anymore, count as success
                        result.successCount++;
                        console.log(`ℹ️ Channel ${channel.name} was already restored or not viewlocked`);
                    }
                } catch (error) {
                    result.errors.push(`${channelData.name}: ${error.message}`);
                    console.error(`Error restoring visibility for channel ${channelData.name}:`, error);
                }
            });
            
            await Promise.all(batchPromises);
            
            // Small delay between batches to avoid rate limits
            if (channelBatches.length > 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        
        // Clear the antidoxx data for this guild after restoration
        antidoxxData.delete(guild.id);
        // Data automatically saved to database
        console.log(`🧹 Cleared antidoxx data for guild ${guild.name}`);
        
        if (result.successCount === result.totalCount) {
            result.message = `Successfully restored visibility for ${result.totalCount} channels that were viewlocked during antidoxx.`;
        } else if (result.successCount > 0) {
            result.message = `Restored visibility for ${result.successCount} out of ${result.totalCount} tracked channels. Some channels failed.`;
            result.success = false;
        } else {
            result.message = 'Failed to restore visibility for any tracked channels.';
            result.success = false;
        }
        
    } catch (error) {
        result.errors.push(`General error: ${error.message}`);
        result.message = 'A critical error occurred during the undoantidoxx operation.';
        result.success = false;
        console.error('Critical error in restoreChannelVisibility:', error);
    }
    
    return result;
}

async function handleLockCommand(message, args) {
    if (!hasModeratorPermissions(message.member)) {
        return message.reply('❌ You need moderator permissions to use this command.');
    }
    
    const channel = message.mentions.channels.first() || message.channel;
    const reason = args.slice(message.mentions.channels.size).join(' ') || 'No reason provided';
    
    try {
        await channel.permissionOverwrites.edit(message.guild.roles.everyone, {
            SendMessages: false
        }, { reason });
        
        const embed = createSuccessEmbed(
            'Channel Locked',
            `${channel} has been locked.\n**Reason:** ${reason}`
        );
        await message.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Error locking channel:', error);
        await message.reply('❌ Failed to lock channel.');
    }
}

async function handleLockSlash(interaction) {
    if (!hasModeratorPermissions(interaction.member)) {
        return interaction.reply({ 
            embeds: [createErrorEmbed('Permission Denied', 'You need moderator permissions to use this command.')], 
            flags: MessageFlags.Ephemeral 
        });
    }
    
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    const reason = interaction.options.getString('reason') || 'No reason provided';
    
    try {
        await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
            SendMessages: false
        }, { reason });
        
        const embed = createSuccessEmbed(
            'Channel Locked',
            `${channel} has been locked.\n**Reason:** ${reason}`
        );
        await interaction.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Error locking channel:', error);
        await interaction.reply({ 
            embeds: [createErrorEmbed('Lock Failed', 'Failed to lock channel.')], 
            flags: MessageFlags.Ephemeral 
        });
    }
}

async function handleUnlockCommand(message, args) {
    if (!hasModeratorPermissions(message.member)) {
        return message.reply('❌ You need moderator permissions to use this command.');
    }
    
    const channel = message.mentions.channels.first() || message.channel;
    const reason = args.slice(message.mentions.channels.size).join(' ') || 'No reason provided';
    
    try {
        await channel.permissionOverwrites.edit(message.guild.roles.everyone, {
            SendMessages: null
        }, { reason });
        
        const embed = createSuccessEmbed(
            'Channel Unlocked',
            `${channel} has been unlocked.\n**Reason:** ${reason}`
        );
        await message.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Error unlocking channel:', error);
        await message.reply('❌ Failed to unlock channel.');
    }
}

async function handleUnlockSlash(interaction) {
    if (!hasModeratorPermissions(interaction.member)) {
        return interaction.reply({ 
            embeds: [createErrorEmbed('Permission Denied', 'You need moderator permissions to use this command.')], 
            flags: MessageFlags.Ephemeral 
        });
    }
    
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    const reason = interaction.options.getString('reason') || 'No reason provided';
    
    try {
        await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
            SendMessages: null
        }, { reason });
        
        const embed = createSuccessEmbed(
            'Channel Unlocked',
            `${channel} has been unlocked.\n**Reason:** ${reason}`
        );
        await interaction.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Error unlocking channel:', error);
        await interaction.reply({ 
            embeds: [createErrorEmbed('Unlock Failed', 'Failed to unlock channel.')], 
            flags: MessageFlags.Ephemeral 
        });
    }
}

async function handleViewlockCommand(message, args) {
    if (!hasModeratorPermissions(message.member)) {
        return message.reply('❌ You need moderator permissions to use this command.');
    }
    
    const channel = message.mentions.channels.first() || message.channel;
    const reason = args.slice(message.mentions.channels.size).join(' ') || 'No reason provided';
    
    try {
        await channel.permissionOverwrites.edit(message.guild.roles.everyone, {
            ViewChannel: false
        }, { reason });
        
        const embed = createSuccessEmbed(
            'Channel Viewlocked',
            `${channel} has been viewlocked.\n**Reason:** ${reason}`
        );
        await message.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Error viewlocking channel:', error);
        await message.reply('❌ Failed to viewlock channel.');
    }
}

async function handleViewlockSlash(interaction) {
    if (!hasModeratorPermissions(interaction.member)) {
        return interaction.reply({ 
            embeds: [createErrorEmbed('Permission Denied', 'You need moderator permissions to use this command.')], 
            flags: MessageFlags.Ephemeral 
        });
    }
    
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    const reason = interaction.options.getString('reason') || 'No reason provided';
    
    try {
        await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
            ViewChannel: false
        }, { reason });
        
        const embed = createSuccessEmbed(
            'Channel Viewlocked',
            `${channel} has been viewlocked.\n**Reason:** ${reason}`
        );
        await interaction.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Error viewlocking channel:', error);
        await interaction.reply({ 
            embeds: [createErrorEmbed('Viewlock Failed', 'Failed to viewlock channel.')], 
            flags: MessageFlags.Ephemeral 
        });
    }
}

async function handleViewunlockCommand(message, args) {
    if (!hasModeratorPermissions(message.member)) {
        return message.reply('❌ You need moderator permissions to use this command.');
    }
    
    const channel = message.mentions.channels.first() || message.channel;
    const reason = args.slice(message.mentions.channels.size).join(' ') || 'No reason provided';
    
    try {
        await channel.permissionOverwrites.edit(message.guild.roles.everyone, {
            ViewChannel: null
        }, { reason });
        
        const embed = createSuccessEmbed(
            'Channel Viewunlocked',
            `${channel} has been viewunlocked.\n**Reason:** ${reason}`
        );
        await message.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Error viewunlocking channel:', error);
        await message.reply('❌ Failed to viewunlock channel.');
    }
}

async function handleViewunlockSlash(interaction) {
    if (!hasModeratorPermissions(interaction.member)) {
        return interaction.reply({ 
            embeds: [createErrorEmbed('Permission Denied', 'You need moderator permissions to use this command.')], 
            flags: MessageFlags.Ephemeral 
        });
    }
    
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    const reason = interaction.options.getString('reason') || 'No reason provided';
    
    try {
        await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
            ViewChannel: null
        }, { reason });
        
        const embed = createSuccessEmbed(
            'Channel Viewunlocked',
            `${channel} has been viewunlocked.\n**Reason:** ${reason}`
        );
        await interaction.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Error viewunlocking channel:', error);
        await interaction.reply({ 
            embeds: [createErrorEmbed('Viewunlock Failed', 'Failed to viewunlock channel.')], 
            flags: MessageFlags.Ephemeral 
        });
    }
}

async function handleSlowmodeCommand(message, args) {
    if (!hasModeratorPermissions(message.member)) {
        return message.reply('❌ You need moderator permissions to use this command.');
    }
    
    const seconds = parseInt(args[0]);
    if (isNaN(seconds) || seconds < 0 || seconds > 21600) {
        return message.reply('❌ Please specify a number between 0 and 21600 seconds.');
    }
    
    const channel = message.mentions.channels.first() || message.channel;
    
    try {
        await channel.setRateLimitPerUser(seconds);
        
        const embed = createSuccessEmbed(
            'Slowmode Updated',
            seconds === 0 
                ? `Slowmode disabled for ${channel}`
                : `Slowmode set to ${seconds} seconds for ${channel}`
        );
        await message.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Error setting slowmode:', error);
        await message.reply('❌ Failed to set slowmode.');
    }
}

async function handleSlowmodeSlash(interaction) {
    if (!hasModeratorPermissions(interaction.member)) {
        return interaction.reply({ 
            embeds: [createErrorEmbed('Permission Denied', 'You need moderator permissions to use this command.')], 
            flags: MessageFlags.Ephemeral 
        });
    }
    
    const seconds = interaction.options.getInteger('seconds');
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    
    try {
        await channel.setRateLimitPerUser(seconds);
        
        const embed = createSuccessEmbed(
            'Slowmode Updated',
            seconds === 0 
                ? `Slowmode disabled for ${channel}`
                : `Slowmode set to ${seconds} seconds for ${channel}`
        );
        await interaction.reply({ embeds: [embed] });
    } catch (error) {
        console.error('Error setting slowmode:', error);
        await interaction.reply({ 
            embeds: [createErrorEmbed('Slowmode Failed', 'Failed to set slowmode.')], 
            flags: MessageFlags.Ephemeral 
        });
    }
}

async function handleAvatarCommand(message, args) {
    const user = message.mentions.users.first() || message.author;
    
    const embed = new EmbedBuilder()
        .setColor('#4ecdc4')
        .setTitle(`${user.displayName}'s Avatar`)
        .setImage(user.displayAvatarURL({ dynamic: true, size: 512 }))
        .setTimestamp();
    
    await message.reply({ embeds: [embed] });
}

async function handleAvatarSlash(interaction) {
    const user = interaction.options.getUser('user') || interaction.user;
    
    const embed = new EmbedBuilder()
        .setColor('#4ecdc4')
        .setTitle(`${user.displayName}'s Avatar`)
        .setImage(user.displayAvatarURL({ dynamic: true, size: 512 }))
        .setTimestamp();
    
    await interaction.reply({ embeds: [embed] });
}

async function handleRemindMeCommand(message, args) {
    if (args.length < 2) {
        return message.reply('❌ Usage: `!remindme <time> <message>`\nExample: `!remindme 10m Take a break`');
    }
    
    const timeStr = args[0];
    const reminderMessage = args.slice(1).join(' ');
    
    const timestamp = parseReminderTime(timeStr);
    if (!timestamp) {
        return message.reply('❌ Invalid time format. Use: 10m, 2h, 1d, 1w or absolute dates like "2023-12-25 15:30"');
    }
    
    const reminderId = createReminder(
        message.author.id,
        message.guild.id,
        message.channel.id,
        reminderMessage,
        timestamp
    );
    
    const embed = createSuccessEmbed(
        'Reminder Set',
        `I'll remind you about "${reminderMessage}" in ${formatTimeRemaining(timestamp)}\n**Reminder ID:** ${reminderId}`
    );
    await message.reply({ embeds: [embed] });
}

async function handleRemindersCommand(message) {
    const userReminders = getUserReminders(message.author.id);
    
    if (userReminders.length === 0) {
        return message.reply('📭 You have no active reminders.');
    }
    
    const embed = new EmbedBuilder()
        .setColor('#4ecdc4')
        .setTitle('⏰ Your Active Reminders')
        .setDescription(`You have ${userReminders.length} active reminder(s):`);
    
    userReminders.slice(0, 10).forEach((reminder, index) => {
        embed.addFields({
            name: `${index + 1}. ${reminder.id}`,
            value: `**Message:** ${reminder.message.substring(0, 50)}${reminder.message.length > 50 ? '...' : ''}\n**Time:** ${formatTimeRemaining(reminder.timestamp)}`,
            inline: false
        });
    });
    
    if (userReminders.length > 10) {
        embed.setFooter({ text: `And ${userReminders.length - 10} more reminders...` });
    }
    
    await message.reply({ embeds: [embed] });
}

async function handleHelpCommand(message) {
    const embed = new EmbedBuilder()
        .setColor('#4ecdc4')
        .setTitle('🤖 Bot Commands Help')
        .setDescription('Here are all available commands:')
        .addFields(
            {
                name: '🔨 Moderation Commands',
                value: '`!kick @user [reason]` - Kick a user\n`!ban @user [reason]` - Ban a user\n`!mute @user <duration> [reason]` - Mute a user\n`!unmute @user` - Unmute a user\n`!warn @user [reason]` - Warn a user\n`!quarantine @user [reason]` - Remove channel access\n`!unquarantine @user [reason]` - Restore channel access\n`!quarantineinfo` - View quarantine records\n`!clear <amount>` - Delete messages\n`!freezenick @user [nickname] [reason]` - Freeze nickname\n`!unfreezenick @user [reason]` - Unfreeze nickname',
                inline: false
            },
            {
                name: '🔒 Channel Management',
                value: '`!lock [#channel] [reason]` - Lock channel\n`!unlock [#channel] [reason]` - Unlock channel\n`!viewlock [#channel] [reason]` - Viewlock channel\n`!viewunlock [#channel] [reason]` - Viewunlock channel\n`!slowmode <seconds> [#channel]` - Set slowmode',
                inline: false
            },
            {
                name: '⚙️ Setup Commands (Moderators)',
                value: '`!setupmute` - Setup muted role permissions\n`!setupquarantine` - Setup quarantine system',
                inline: false
            },
            {
                name: '🛠️ Utility Commands',
                value: '`!ping` - Check bot latency\n`!serverinfo` - Show server info\n`!avatar [@user]` - Show user avatar\n`!banner [@user]` - Show user banner\n`!afk [reason]` - Set AFK status\n`!help` - Show this help',
                inline: false
            },
            {
                name: '⏰ Reminder Commands',
                value: '`!remindme <time> <message>` - Set a reminder\n`!reminders` - View your reminders\n\nUse `/reminder` for advanced options',
                inline: false
            },
            {
                name: '🚨 Emergency Commands (Authorized Users)',
                value: '`!antidoxx [reason]` - Emergency viewlock all channels\n`!undoantidoxx [reason]` - Restore channel visibility',
                inline: false
            },
            {
                name: '👑 Admin Commands (Bot Owners Only)',
                value: '`!admin list/add/remove` - Manage authorized users\n`!privacy` - Manage privacy settings',
                inline: false
            },
            {
                name: '⭐ Other Features',
                value: '• **Starboard** - React with ⭐ to star messages\n• **Custom Commands** - Use `/custom create` to make server commands\n• **AFK System** - Automatic AFK tracking and notifications',
                inline: false
            },
            {
                name: '🔐 Permission Hierarchy',
                value: '1. **Bot Owners** - Full bot control\n2. **Server Owners** - Server management\n3. **Authorized Users** - Emergency commands\n4. **Moderators** - Basic moderation\n5. **Users** - Basic commands',
                inline: false
            }
        )
        .setFooter({ text: 'All commands are also available as slash commands (/) • Use /help for personalized command list' })
        .setTimestamp();
    
    await message.reply({ embeds: [embed] });
}

async function handleHelpSlash(interaction) {
    const user = interaction.member;
    const isBotOwner = hasBotOwnerPermissions(user);
    const isOwner = interaction.guild.ownerId === user.id;
    const isAuthorized = isAuthorizedUser(user.id);
    const isModerator = hasModeratorPermissions(user);
    
    // Determine user access level
    let accessLevel = 'Basic User';
    let accessColor = '#4ecdc4';
    
    if (isBotOwner) {
        accessLevel = 'Bot Owner';
        accessColor = '#ff1744';
    } else if (isOwner) {
        accessLevel = 'Server Owner';
        accessColor = '#ff6b6b';
    } else if (isAuthorized) {
        accessLevel = 'Authorized User';
        accessColor = '#ffa500';
    } else if (isModerator) {
        accessLevel = 'Moderator';
        accessColor = '#54a0ff';
    }
    
    const embed = new EmbedBuilder()
        .setColor(accessColor)
        .setTitle('🤖 Bot Commands Help')
        .setDescription(`**Your Access Level:** ${accessLevel}\nShowing commands available to you:`)
        .setTimestamp();
    
    // Always available commands
    embed.addFields({
        name: '🛠️ Basic Commands',
        value: '`/ping` - Check bot latency\n`/serverinfo` - Show server info\n`/avatar [user]` - Show user avatar\n`/banner [user]` - Show user banner\n`/afk [reason]` - Set AFK status\n`/help` - Show this help',
        inline: false
    });
    
    embed.addFields({
        name: '⏰ Reminder System',
        value: '`/reminder set time message` - Set a reminder\n`/reminder list` - View your reminders\n`/reminder cancel id` - Cancel a reminder\n`/reminder event` - Schedule events\n`/reminder recurring` - Set repeating reminders',
        inline: false
    });
    
    // Moderator commands
    if (isModerator) {
        embed.addFields({
            name: '🔨 Moderation Commands',
            value: '`/kick user [reason]` - Kick a user\n`/ban user [reason]` - Ban a user\n`/mute user duration [reason]` - Mute a user\n`/unmute user` - Unmute a user\n`/warn user [reason]` - Warn a user\n`/quarantine user [reason]` - Remove channel access\n`/unquarantine user [reason]` - Restore channel access\n`/quarantineinfo` - View quarantine records\n`/clear amount` - Delete messages\n`/freezenick user [nickname] [reason]` - Freeze nickname\n`/unfreezenick user [reason]` - Unfreeze nickname',
            inline: false
        });
        
        embed.addFields({
            name: '🔒 Channel Management',
            value: '`/lock [channel] [reason]` - Lock channel\n`/unlock [channel] [reason]` - Unlock channel\n`/viewlock [channel] [reason]` - Viewlock channel\n`/viewunlock [channel] [reason]` - Viewunlock channel\n`/slowmode seconds [channel]` - Set slowmode',
            inline: false
        });
        
        embed.addFields({
            name: '🎭 Advanced Features',
            value: '`/starboard setup` - Configure starboard\n`/custom create` - Create custom commands\n`/emoji add/remove/list` - Manage emojis\n`/setupmute` - Setup muted role permissions\n`/setupquarantine` - Setup quarantine system',
            inline: false
        });
    }
    
    // Owner/Authorized user exclusive commands
    if (isOwner || isAuthorized) {
        embed.addFields({
            name: '🎯 Auto-Reaction System',
            value: '`/autoreact set user emoji` - Set auto-reaction\n`/autoreact remove user` - Remove auto-reaction\n`/autoreact toggle user` - Toggle auto-reaction\n`/autoreact list` - List all auto-reactions',
            inline: false
        });
        
        embed.addFields({
            name: '🚨 Emergency Commands',
            value: '`/antidoxx [reason]` - Emergency viewlock all channels\n`/undoantidoxx [reason]` - Restore channel visibility',
            inline: false
        });
    }
    
    // Bot Owner exclusive commands (highest authority)
    if (isBotOwner) {
        embed.addFields({
            name: '�️ Bot Owner Commands',
            value: '`/admin list` - List authorized users\n`/admin add user` - Add authorized user\n`/admin remove user` - Remove authorized user\n`/privacy status` - Manage privacy settings\n**Note:** Bot owners have authority over all server functions',
            inline: false
        });
    }
    // Server Owner exclusive commands (if not bot owner)
    else if (isOwner) {
        embed.addFields({
            name: '👑 Server Owner Commands',
            value: '`/privacy status` - Check privacy settings\n**Note:** Limited admin access compared to bot owners',
            inline: false
        });
    }
    
    embed.addFields({
        name: '⭐ Additional Features',
        value: `• **Starboard** - React with ⭐ to star messages${isBotOwner ? ' (Bot owners can bypass all rules!)' : ''}\n• **AFK System** - Automatic AFK tracking and notifications\n• **Custom Commands** - Server-specific commands`,
        inline: false
    });
    
    embed.setFooter({ text: 'All commands also work with ! prefix (e.g., !ping) • Access may vary based on permissions' });
    
    await interaction.reply({ embeds: [embed] });
}

// Starboard reaction handler
async function handleStarReaction(reaction, user, action) {
    try {
        const message = reaction.message;
        const config = starboardConfigs.get(message.guild.id);
        
        if (!config || !config.channelId) {
            return; // Starboard not configured
        }
        
        // Check if message author exists
        if (!message.author) {
            console.log('[Starboard] Message author not available');
            return;
        }

        // Check if user is bot owner
        const isOwner = isBotOwner(user.id);
        
        // Bot owner bypass: Allow starring any message including own, ignores threshold
        if (isOwner) {
            console.log('[Starboard] Bot owner starred message - bypassing all rules');
            
            // Get starboard channel
            const starboardChannel = message.guild.channels.cache.get(config.channelId);
            if (!starboardChannel) {
                console.error('[Starboard] Starboard channel not found:', config.channelId);
                return;
            }

            // Verify bot can send messages
            const botPermissions = starboardChannel.permissionsFor(message.guild.members.me);
            if (!botPermissions || !botPermissions.has(['SendMessages', 'EmbedLinks'])) {
                console.error('[Starboard] Bot lacks permissions in starboard channel');
                return;
            }

            // Check if message already on starboard
            const existingStarboardMessageId = starboardMessages.get(message.id);
            
            if (!existingStarboardMessageId) {
                // Create starboard message immediately
                const embed = new EmbedBuilder()
                    .setColor('#FFD700')
                    .setAuthor({ 
                        name: message.author.tag || 'Unknown User',
                        iconURL: message.author.displayAvatarURL() || undefined
                    })
                    .setDescription(message.content || '*[No text content]*')
                    .addFields({ 
                        name: 'Source', 
                        value: `[Jump to Message](${message.url})`,
                        inline: true
                    })
                    .setTimestamp(message.createdAt)
                    .setFooter({ text: `⭐ Bot Owner Featured | Message ID: ${message.id}` });

                // Add image if present
                if (message.attachments.size > 0) {
                    const attachment = message.attachments.first();
                    if (attachment.contentType?.startsWith('image/')) {
                        embed.setImage(attachment.url);
                    }
                }

                try {
                    const starboardMessage = await starboardChannel.send({ embeds: [embed] });
                    starboardMessages.set(message.id, starboardMessage.id);
                    await DatabaseService.saveStarboardMessage(message.guild.id, message.id, starboardMessage.id);
                    console.log(`[Starboard] Bot owner featured message ${message.id}`);
                } catch (error) {
                    console.error('[Starboard] Error sending bot owner featured message:', error);
                }
            }
            return; // Skip normal star processing
        }
        
        // Don't allow regular users to star their own messages
        if (message.author.id === user.id) {
            try {
                await reaction.users.remove(user.id);
            } catch (error) {
                console.error('[Starboard] Error removing self-star:', error);
            }
            return;
        }
        
        // Get fresh star count by fetching reaction users (exclude bots)
        const starReaction = message.reactions.cache.get('⭐');
        if (!starReaction) {
            return; // No star reaction found
        }

        let starCount = 0;
        try {
            const users = await starReaction.users.fetch();
            starCount = users.filter(u => !u.bot).size;
        } catch (error) {
            console.error('[Starboard] Error fetching reaction users:', error);
            starCount = starReaction.count - 1; // Fallback to cached count
        }

        const threshold = config.threshold || 3;
        
        // Get starboard channel
        const starboardChannel = message.guild.channels.cache.get(config.channelId);
        if (!starboardChannel) {
            console.error('[Starboard] Starboard channel not found:', config.channelId);
            return;
        }

        // Verify bot can send messages
        const botPermissions = starboardChannel.permissionsFor(message.guild.members.me);
        if (!botPermissions || !botPermissions.has(['SendMessages', 'EmbedLinks'])) {
            console.error('[Starboard] Bot lacks permissions in starboard channel');
            return;
        }

        // Check if message is already on starboard
        const existingStarboardMessageId = starboardMessages.get(message.id);
        
        if (starCount >= threshold) {
            // Create or update starboard message
            const embed = new EmbedBuilder()
                .setColor('#FFD700')
                .setAuthor({ 
                    name: message.author.tag || 'Unknown User',
                    iconURL: message.author.displayAvatarURL() || undefined
                })
                .setDescription(message.content || '*[No text content]*')
                .addFields({ 
                    name: 'Source', 
                    value: `[Jump to Message](${message.url})`,
                    inline: true
                })
                .setTimestamp(message.createdAt)
                .setFooter({ text: `⭐ ${starCount} | Message ID: ${message.id}` });

            // Add image if present
            if (message.attachments.size > 0) {
                const attachment = message.attachments.first();
                if (attachment.contentType?.startsWith('image/')) {
                    embed.setImage(attachment.url);
                }
            }

            if (existingStarboardMessageId) {
                // Update existing starboard message
                try {
                    const starboardMessage = await starboardChannel.messages.fetch(existingStarboardMessageId);
                    await starboardMessage.edit({ embeds: [embed] });
                    console.log(`[Starboard] Updated message ${message.id} with ${starCount} stars`);
                } catch (error) {
                    console.error('[Starboard] Error updating starboard message:', error);
                    // If message was deleted, remove from tracking and create new one
                    starboardMessages.delete(message.id);
                    await DatabaseService.deleteStarboardMessage(message.guild.id, message.id);
                    
                    // Create new starboard message
                    const newStarboardMessage = await starboardChannel.send({ embeds: [embed] });
                    starboardMessages.set(message.id, newStarboardMessage.id);
                    await DatabaseService.saveStarboardMessage(message.guild.id, message.id, newStarboardMessage.id);
                    console.log(`[Starboard] Re-created starboard message for ${message.id}`);
                }
            } else {
                // Create new starboard message
                try {
                    const starboardMessage = await starboardChannel.send({ embeds: [embed] });
                    starboardMessages.set(message.id, starboardMessage.id);
                    await DatabaseService.saveStarboardMessage(message.guild.id, message.id, starboardMessage.id);
                    console.log(`[Starboard] Created starboard message for ${message.id} with ${starCount} stars`);
                } catch (error) {
                    console.error('[Starboard] Error sending starboard message:', error);
                }
            }
        } else if (existingStarboardMessageId && starCount < threshold) {
            // Remove from starboard if below threshold
            try {
                const starboardMessage = await starboardChannel.messages.fetch(existingStarboardMessageId);
                await starboardMessage.delete();
                starboardMessages.delete(message.id);
                await DatabaseService.deleteStarboardMessage(message.guild.id, message.id);
                console.log(`[Starboard] Removed message ${message.id} (below threshold: ${starCount}/${threshold})`);
            } catch (error) {
                console.error('[Starboard] Error deleting starboard message:', error);
                // Clean up tracking even if delete failed
                starboardMessages.delete(message.id);
                await DatabaseService.deleteStarboardMessage(message.guild.id, message.id);
            }
        }
    } catch (error) {
        console.error('Error handling starboard reaction:', error);
        logError('handleStarReaction', error, { 
            guildId: reaction.message.guild?.id,
            messageId: reaction.message.id
        });
    }
}

// Placeholder functions for remaining slash command handlers
async function handleStarboardSlash(interaction) {
    if (!hasModeratorPermissions(interaction.member)) {
        return interaction.reply({ 
            embeds: [createErrorEmbed('Permission Denied', 'You need moderator permissions to use this command.')], 
            flags: MessageFlags.Ephemeral 
        });
    }
    
    const subcommand = interaction.options.getSubcommand();
    
    switch (subcommand) {
        case 'setup':
            const channel = interaction.options.getChannel('channel');
            const threshold = interaction.options.getInteger('threshold') || 3;

            // Validate channel type
            if (channel.type !== ChannelType.GuildText) {
                return interaction.reply({ 
                    embeds: [createErrorEmbed('Invalid Channel', 'The starboard channel must be a text channel.')],
                    flags: MessageFlags.Ephemeral 
                });
            }

            // Validate bot permissions in target channel
            const botPermissions = channel.permissionsFor(interaction.guild.members.me);
            if (!botPermissions || !botPermissions.has(['ViewChannel', 'SendMessages', 'EmbedLinks'])) {
                return interaction.reply({ 
                    embeds: [createErrorEmbed('Missing Permissions', 'I don\'t have the required permissions in that channel. I need: View Channel, Send Messages, and Embed Links.')],
                    flags: MessageFlags.Ephemeral 
                });
            }

            // Validate threshold
            if (threshold < 1 || threshold > 50) {
                return interaction.reply({ 
                    embeds: [createErrorEmbed('Invalid Threshold', 'Threshold must be between 1 and 50.')],
                    flags: MessageFlags.Ephemeral 
                });
            }

            const newConfig = {
                channelId: channel.id,
                threshold: threshold,
                emoji: '⭐'
            };
            
            const saveSuccess = await DatabaseService.saveStarboardConfig(interaction.guild.id, newConfig);
            if (saveSuccess) {
                // Update in-memory cache
                starboardConfigs.set(interaction.guild.id, newConfig);
            } else {
                console.error('[Starboard] Failed to save starboard config to database');
                // Still update in-memory for current session
                starboardConfigs.set(interaction.guild.id, newConfig);
            }
            
            const embed = new EmbedBuilder()
                .setColor('#FFD700')
                .setTitle('⭐ Starboard Configured')
                .setDescription('The starboard has been set up successfully!')
                .addFields(
                    { name: 'Channel', value: `${channel}`, inline: true },
                    { name: 'Threshold', value: `${threshold} ⭐`, inline: true }
                )
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });
            console.log(`[Starboard] Configured for guild ${interaction.guild.id}: channel=${channel.id}, threshold=${threshold}`);
            break;
            
        case 'auto-setup':
            await interaction.deferReply();
            
            const channelName = interaction.options.getString('name') || 'starboard';
            
            try {
                // Check if bot can manage channels
                const botPerms = interaction.guild.members.me.permissions;
                if (!botPerms.has('ManageChannels')) {
                    return interaction.editReply({ 
                        embeds: [createErrorEmbed('Missing Permissions', 'I need the "Manage Channels" permission to create the starboard channel.')]
                    });
                }

                const starboardChannel = await interaction.guild.channels.create({
                    name: channelName,
                    type: ChannelType.GuildText,
                    topic: '⭐ Messages that receive enough stars appear here!',
                    reason: 'Starboard auto-setup',
                    permissionOverwrites: [
                        {
                            id: interaction.guild.id, // @everyone
                            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
                            deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions]
                        },
                        {
                            id: interaction.client.user.id, // Bot
                            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ReadMessageHistory]
                        }
                    ]
                });

                // Verify bot can use the channel
                const botChannelPerms = starboardChannel.permissionsFor(interaction.guild.members.me);
                if (!botChannelPerms.has(['SendMessages', 'EmbedLinks'])) {
                    await starboardChannel.delete();
                    return interaction.editReply({ 
                        embeds: [createErrorEmbed('Setup Failed', 'Failed to set up proper permissions for the starboard channel.')]
                    });
                }
                
                const autoConfig = {
                    channelId: starboardChannel.id,
                    threshold: 3,
                    emoji: '⭐'
                };
                
                const autoSaveSuccess = await DatabaseService.saveStarboardConfig(interaction.guild.id, autoConfig);
                if (autoSaveSuccess) {
                    // Update in-memory cache
                    starboardConfigs.set(interaction.guild.id, autoConfig);
                } else {
                    console.error('[Starboard] Failed to save auto starboard config to database');
                    // Still update in-memory for current session
                    starboardConfigs.set(interaction.guild.id, autoConfig);
                }
                
                const welcomeEmbed = new EmbedBuilder()
                    .setColor('#FFD700')
                    .setTitle('⭐ Welcome to the Starboard!')
                    .setDescription('Messages that receive **3 or more** ⭐ reactions will appear here.')
                    .addFields({ 
                        name: 'How it works', 
                        value: 'React to any message with ⭐ to nominate it for the starboard!' 
                    })
                    .setTimestamp();
                
                await starboardChannel.send({ embeds: [welcomeEmbed] });
                
                const setupEmbed = new EmbedBuilder()
                    .setColor('#FFD700')
                    .setTitle('✅ Starboard Auto-Setup Complete')
                    .setDescription('The starboard has been automatically configured!')
                    .addFields(
                        { name: 'Channel', value: `${starboardChannel}`, inline: true },
                        { name: 'Threshold', value: `3 ⭐`, inline: true }
                    )
                    .setTimestamp();

                await interaction.editReply({ embeds: [setupEmbed] });
                console.log(`[Starboard] Auto-setup completed for guild ${interaction.guild.id}`);
            } catch (error) {
                console.error('[Starboard] Error in auto-setup:', error);
                logError('handleStarboardAutoSetup', error, { guildId: interaction.guild?.id });
                await interaction.editReply({ 
                    embeds: [createErrorEmbed('Setup Failed', 'An error occurred during auto-setup.')]
                });
            }
            break;
            
        case 'threshold':
            const newThreshold = interaction.options.getInteger('amount');
            const currentConfig = await getStarboardConfig(interaction.guild.id);
            
            if (!currentConfig) {
                return interaction.reply({ 
                    embeds: [createErrorEmbed('No Starboard', 'Please set up a starboard first with `/starboard setup`.')], 
                    flags: MessageFlags.Ephemeral 
                });
            }

            // Validate threshold
            if (newThreshold < 1 || newThreshold > 50) {
                return interaction.reply({ 
                    embeds: [createErrorEmbed('Invalid Threshold', 'Threshold must be between 1 and 50.')],
                    flags: MessageFlags.Ephemeral 
                });
            }
            
            currentConfig.threshold = newThreshold;
            
            const thresholdSaveSuccess = await DatabaseService.saveStarboardConfig(interaction.guild.id, currentConfig);
            if (thresholdSaveSuccess) {
                // Update in-memory cache
                starboardConfigs.set(interaction.guild.id, currentConfig);
            } else {
                console.error('[Starboard] Failed to save updated starboard config to database');
                // Still update in-memory for current session
                starboardConfigs.set(interaction.guild.id, currentConfig);
            }
            
            const thresholdEmbed = new EmbedBuilder()
                .setColor('#FFD700')
                .setTitle('✅ Threshold Updated')
                .setDescription(`Starboard threshold set to **${newThreshold}** ⭐`)
                .setTimestamp();

            await interaction.reply({ embeds: [thresholdEmbed] });
            console.log(`[Starboard] Threshold updated for guild ${interaction.guild.id}: ${newThreshold}`);
            break;
            
        case 'info':
            const infoConfig = await getStarboardConfig(interaction.guild.id);
            
            if (!infoConfig) {
                return interaction.reply({ 
                    embeds: [createErrorEmbed('No Starboard', 'No starboard is configured for this server.')], 
                    flags: MessageFlags.Ephemeral 
                });
            }
            
            const infoEmbed = new EmbedBuilder()
                .setColor('#FFD700')
                .setTitle('⭐ Starboard Configuration')
                .addFields(
                    { name: 'Channel', value: `<#${infoConfig.channelId}>`, inline: true },
                    { name: 'Threshold', value: `${infoConfig.threshold} ⭐`, inline: true }
                )
                .setTimestamp();
            
            await interaction.reply({ embeds: [infoEmbed] });
            break;
    }
}

async function handleCustomSlash(interaction) {
    // Check if user has permission to use custom commands
    if (!hasCustomCommandPermissions(interaction.member)) {
        return interaction.reply({ 
            embeds: [createErrorEmbed('Permission Denied', 'Only authorized users, server owners, and bot owners can use custom command features.')], 
            flags: MessageFlags.Ephemeral 
        });
    }
    
    const subcommand = interaction.options.getSubcommand();
    const guildCommands = getGuildCustomCommands(interaction.guild.id);
    
    switch (subcommand) {
        case 'create':
            const createName = interaction.options.getString('name').toLowerCase();
            const createResponse = interaction.options.getString('response');
            const createType = interaction.options.getString('type') || 'text';
            
            if (!validateCommandName(createName)) {
                return interaction.reply({ 
                    embeds: [createErrorEmbed('Invalid Name', 'Command name must be 2-32 characters, letters, numbers, underscore, or hyphen only.')], 
                    flags: MessageFlags.Ephemeral 
                });
            }
            
            if (isBuiltInCommand(createName)) {
                return interaction.reply({ 
                    embeds: [createErrorEmbed('Name Conflict', 'Cannot use built-in command names.')], 
                    flags: MessageFlags.Ephemeral 
                });
            }
            
            if (guildCommands.has(createName)) {
                return interaction.reply({ 
                    embeds: [createErrorEmbed('Command Exists', 'A command with this name already exists.')], 
                    flags: MessageFlags.Ephemeral 
                });
            }
            
            // Save to database first
            try {
                await DatabaseService.createCustomCommand(interaction.guild.id, {
                    name: createName,
                    response: createResponse,
                    type: createType,
                    createdBy: interaction.user.id
                });
                
                // Update in-memory cache
                guildCommands.set(createName, {
                    name: createName,
                    response: createResponse,
                    type: createType,
                    createdBy: interaction.user.id,
                    createdAt: Date.now()
                });
            } catch (dbError) {
                console.error('Failed to save custom command to database:', dbError);
                return interaction.reply({
                    embeds: [createErrorEmbed('Database Error', 'Failed to save command to database.')],
                    flags: MessageFlags.Ephemeral
                });
            }
            
            const createEmbed = createSuccessEmbed(
                'Custom Command Created',
                `Command \`!${createName}\` has been created!\nTrigger it with \`!${createName}\``
            );
            await interaction.reply({ embeds: [createEmbed] });
            break;
            
        case 'edit':
            const editName = interaction.options.getString('name').toLowerCase();
            const editResponse = interaction.options.getString('response');
            const editType = interaction.options.getString('type');
            
            if (!guildCommands.has(editName)) {
                return interaction.reply({ 
                    embeds: [createErrorEmbed('Command Not Found', 'No custom command with this name exists.')], 
                    flags: MessageFlags.Ephemeral 
                });
            }
            
            const existingCommand = guildCommands.get(editName);
            
            // Check if user has permission to edit (command creator or custom command permissions)
            if (existingCommand.createdBy !== interaction.user.id && 
                !hasCustomCommandPermissions(interaction.member)) {
                return interaction.reply({ 
                    embeds: [createErrorEmbed('Permission Denied', 'You can only edit commands you created, or you need authorized user/server owner/bot owner permissions.')], 
                    flags: MessageFlags.Ephemeral 
                });
            }
            
            // Update in database first
            try {
                const updateData = {
                    response: editResponse,
                    editedBy: interaction.user.id,
                    editedAt: new Date()
                };
                if (editType) updateData.type = editType;
                
                await DatabaseService.updateCustomCommand(interaction.guild.id, editName, updateData);
                
                // Update in-memory cache
                existingCommand.response = editResponse;
                if (editType) existingCommand.type = editType;
                existingCommand.editedBy = interaction.user.id;
                existingCommand.editedAt = Date.now();
                
                guildCommands.set(editName, existingCommand);
            } catch (dbError) {
                console.error('Failed to update custom command in database:', dbError);
                return interaction.reply({
                    embeds: [createErrorEmbed('Database Error', 'Failed to update command in database.')],
                    flags: MessageFlags.Ephemeral
                });
            }
            
            const editEmbed = createSuccessEmbed(
                'Custom Command Updated',
                `Command \`!${editName}\` has been updated successfully!`
            );
            await interaction.reply({ embeds: [editEmbed] });
            break;
            
        case 'delete':
            const deleteName = interaction.options.getString('name').toLowerCase();
            
            if (!guildCommands.has(deleteName)) {
                return interaction.reply({ 
                    embeds: [createErrorEmbed('Command Not Found', 'No custom command with this name exists.')], 
                    flags: MessageFlags.Ephemeral 
                });
            }
            
            const commandToDelete = guildCommands.get(deleteName);
            
            // Check if user has permission to delete (command creator or custom command permissions)
            if (commandToDelete.createdBy !== interaction.user.id && 
                !hasCustomCommandPermissions(interaction.member)) {
                return interaction.reply({ 
                    embeds: [createErrorEmbed('Permission Denied', 'You can only delete commands you created, or you need authorized user/server owner/bot owner permissions.')], 
                    flags: MessageFlags.Ephemeral 
                });
            }
            
            // Delete from database first
            try {
                await DatabaseService.deleteCustomCommand(interaction.guild.id, deleteName);
                
                // Delete from in-memory cache
                guildCommands.delete(deleteName);
            } catch (dbError) {
                console.error('Failed to delete custom command from database:', dbError);
                return interaction.reply({
                    embeds: [createErrorEmbed('Database Error', 'Failed to delete command from database.')],
                    flags: MessageFlags.Ephemeral
                });
            }
            
            const deleteEmbed = createSuccessEmbed(
                'Custom Command Deleted',
                `Command \`!${deleteName}\` has been deleted successfully.`
            );
            await interaction.reply({ embeds: [deleteEmbed] });
            break;
            
        case 'info':
            const infoName = interaction.options.getString('name').toLowerCase();
            
            if (!guildCommands.has(infoName)) {
                return interaction.reply({ 
                    embeds: [createErrorEmbed('Command Not Found', 'No custom command with this name exists.')], 
                    flags: MessageFlags.Ephemeral 
                });
            }
            
            const commandInfo = guildCommands.get(infoName);
            
            try {
                const creator = await client.users.fetch(commandInfo.createdBy);
                
                const infoEmbed = new EmbedBuilder()
                    .setColor('#4ecdc4')
                    .setTitle(`📋 Command Info: !${commandInfo.name}`)
                    .addFields(
                        { name: 'Response Type', value: commandInfo.type, inline: true },
                        { name: 'Created By', value: creator.tag, inline: true },
                        { name: 'Created', value: `<t:${Math.floor(commandInfo.createdAt / 1000)}:R>`, inline: true },
                        { name: 'Response Preview', value: commandInfo.response.length > 100 ? commandInfo.response.substring(0, 100) + '...' : commandInfo.response, inline: false }
                    )
                    .setTimestamp();
                
                if (commandInfo.editedAt) {
                    try {
                        const editor = await client.users.fetch(commandInfo.editedBy);
                        infoEmbed.addFields(
                            { name: 'Last Edited By', value: editor.tag, inline: true },
                            { name: 'Last Edited', value: `<t:${Math.floor(commandInfo.editedAt / 1000)}:R>`, inline: true }
                        );
                    } catch (error) {
                        infoEmbed.addFields({ name: 'Last Edited', value: `<t:${Math.floor(commandInfo.editedAt / 1000)}:R>`, inline: true });
                    }
                }
                
                await interaction.reply({ embeds: [infoEmbed], flags: MessageFlags.Ephemeral });
            } catch (error) {
                console.error('Error fetching command creator:', error);
                const infoEmbed = new EmbedBuilder()
                    .setColor('#4ecdc4')
                    .setTitle(`📋 Command Info: !${commandInfo.name}`)
                    .addFields(
                        { name: 'Response Type', value: commandInfo.type, inline: true },
                        { name: 'Created', value: `<t:${Math.floor(commandInfo.createdAt / 1000)}:R>`, inline: true },
                        { name: 'Response Preview', value: commandInfo.response.length > 100 ? commandInfo.response.substring(0, 100) + '...' : commandInfo.response, inline: false }
                    )
                    .setTimestamp();
                
                await interaction.reply({ embeds: [infoEmbed], flags: MessageFlags.Ephemeral });
            }
            break;
            
        case 'list':
            if (guildCommands.size === 0) {
                return interaction.reply('📭 No custom commands found for this server.');
            }
            
            const listEmbed = new EmbedBuilder()
                .setColor('#4ecdc4')
                .setTitle('🎨 Custom Commands')
                .setDescription(`This server has ${guildCommands.size} custom command(s):`);
            
            Array.from(guildCommands.values()).slice(0, 25).forEach(cmd => {
                listEmbed.addFields({
                    name: `!${cmd.name}`,
                    value: `Type: ${cmd.type}\nCreated: <t:${Math.floor(cmd.createdAt / 1000)}:R>`,
                    inline: true
                });
            });
            
            if (guildCommands.size > 25) {
                listEmbed.setFooter({ text: `Showing 25 of ${guildCommands.size} commands` });
            }
            
            await interaction.reply({ embeds: [listEmbed] });
            break;
            
        default:
            await interaction.reply({ embeds: [createErrorEmbed('Unknown Subcommand', 'This subcommand is not recognized.')], flags: MessageFlags.Ephemeral });
    }
}

async function handleReminderSlash(interaction) {
    const subcommand = interaction.options.getSubcommand();
    
    switch (subcommand) {
        case 'set':
            const timeStr = interaction.options.getString('time');
            const message = interaction.options.getString('message');
            const channel = interaction.options.getChannel('channel') || interaction.channel;
            
            const timestamp = parseReminderTime(timeStr);
            if (!timestamp) {
                return interaction.reply({ 
                    embeds: [createErrorEmbed('Invalid Time', 'Invalid time format. Use: 10m, 2h, 1d, etc.')], 
                    flags: MessageFlags.Ephemeral 
                });
            }
            
            const reminderId = createReminder(
                interaction.user.id,
                interaction.guild.id,
                channel.id,
                message,
                timestamp
            );
            
            const embed = createSuccessEmbed(
                'Reminder Set',
                `I'll remind you about "${message}" in ${formatTimeRemaining(timestamp)}\nLocation: ${channel}`
            );
            embed.setFooter({ text: `Reminder ID: ${reminderId}` });
            
            await interaction.reply({ embeds: [embed] });
            break;
            
        case 'list':
            const userReminders = getUserReminders(interaction.user.id);
            
            if (userReminders.length === 0) {
                return interaction.reply({ content: '📭 You have no active reminders.', flags: MessageFlags.Ephemeral });
            }
            
            const listEmbed = new EmbedBuilder()
                .setColor('#4ecdc4')
                .setTitle('📅 Your Active Reminders')
                .setDescription(`You have ${userReminders.length} active reminder(s):`);
            
            userReminders.slice(0, 10).forEach((reminder, index) => {
                listEmbed.addFields({
                    name: `${index + 1}. ${reminder.type === 'event' ? '📅' : '⏰'} ${reminder.id}`,
                    value: `**Message:** ${reminder.message.substring(0, 50)}${reminder.message.length > 50 ? '...' : ''}\n**Time:** ${formatTimeRemaining(reminder.timestamp)}`,
                    inline: false
                });
            });
            
            if (userReminders.length > 10) {
                listEmbed.setFooter({ text: `And ${userReminders.length - 10} more reminders...` });
            }
            
            await interaction.reply({ embeds: [listEmbed], flags: MessageFlags.Ephemeral });
            break;
            
        case 'cancel':
            const cancelId = interaction.options.getString('id');
            const reminder = reminders.get(cancelId);
            
            if (!reminder || reminder.userId !== interaction.user.id) {
                return interaction.reply({ 
                    embeds: [createErrorEmbed('Reminder Not Found', 'Reminder not found or you do not own this reminder.')], 
                    flags: MessageFlags.Ephemeral 
                });
            }
            
            deleteReminder(cancelId);
            
            const cancelEmbed = createSuccessEmbed(
                'Reminder Cancelled',
                `Reminder "${reminder.message}" has been cancelled.`
            );
            await interaction.reply({ embeds: [cancelEmbed], flags: MessageFlags.Ephemeral });
            break;
            
        // Add other reminder subcommands (event, recurring, info)
        default:
            await interaction.reply({ embeds: [createErrorEmbed('Not Implemented', 'This subcommand is not yet implemented.')], flags: MessageFlags.Ephemeral });
    }
}

async function handleAdminSlash(interaction) {
    if (!hasBotOwnerPermissions(interaction.member)) {
        return interaction.reply({ 
            embeds: [createErrorEmbed('Permission Denied', 'Only bot owners can use admin commands.')], 
            flags: MessageFlags.Ephemeral 
        });
    }
    
    const subcommand = interaction.options.getSubcommand();
    
    switch (subcommand) {
        case 'list':
            const authorizedUsers = process.env.AUTHORIZED_USERS?.split(',').map(id => id.trim()) || [];
            
            if (authorizedUsers.length === 0) {
                return interaction.reply({ content: '📭 No authorized users configured.', flags: MessageFlags.Ephemeral });
            }
            
            const listEmbed = new EmbedBuilder()
                .setColor('#4ecdc4')
                .setTitle('👑 Authorized Users')
                .setDescription(`Currently ${authorizedUsers.length} authorized user(s):`);
            
            for (const userId of authorizedUsers.slice(0, 10)) {
                try {
                    const user = await client.users.fetch(userId);
                    listEmbed.addFields({ name: user.tag, value: `<@${userId}>`, inline: true });
                } catch (error) {
                    listEmbed.addFields({ name: 'Unknown User', value: `ID: ${userId}`, inline: true });
                }
            }
            
            await interaction.reply({ embeds: [listEmbed], flags: MessageFlags.Ephemeral });
            break;
            
        case 'add':
            const userToAdd = interaction.options.getUser('user');
            const currentAuthorizedUsers = process.env.AUTHORIZED_USERS?.split(',').map(id => id.trim()) || [];
            
            if (currentAuthorizedUsers.includes(userToAdd.id)) {
                return interaction.reply({ 
                    embeds: [createErrorEmbed('Already Authorized', `${userToAdd.tag} is already in the authorized users list.`)], 
                    flags: MessageFlags.Ephemeral 
                });
            }
            
            currentAuthorizedUsers.push(userToAdd.id);
            
            const addEmbed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('✅ User Authorization Instructions')
                .setDescription(`To authorize ${userToAdd.tag}, add their ID to your .env file:`)
                .addFields({ 
                    name: 'Add to AUTHORIZED_USERS', 
                    value: `\`AUTHORIZED_USERS=${currentAuthorizedUsers.join(',')}\``,
                    inline: false 
                })
                .setFooter({ text: 'Restart the bot after updating the .env file' });
            
            await interaction.reply({ embeds: [addEmbed], flags: MessageFlags.Ephemeral });
            break;
            
        case 'remove':
            const userToRemove = interaction.options.getUser('user');
            let updatedAuthorizedUsers = process.env.AUTHORIZED_USERS?.split(',').map(id => id.trim()) || [];
            
            if (!updatedAuthorizedUsers.includes(userToRemove.id)) {
                return interaction.reply({ 
                    embeds: [createErrorEmbed('Not Authorized', `${userToRemove.tag} is not in the authorized users list.`)], 
                    flags: MessageFlags.Ephemeral 
                });
            }
            
            updatedAuthorizedUsers = updatedAuthorizedUsers.filter(id => id !== userToRemove.id);
            
            const removeEmbed = new EmbedBuilder()
                .setColor('#ff6b6b')
                .setTitle('🗑️ User Deauthorization Instructions')
                .setDescription(`To remove ${userToRemove.tag} from authorized users, update your .env file:`)
                .addFields({ 
                    name: 'Update AUTHORIZED_USERS', 
                    value: updatedAuthorizedUsers.length > 0 ? `\`AUTHORIZED_USERS=${updatedAuthorizedUsers.join(',')}\`` : '`AUTHORIZED_USERS=` (empty)',
                    inline: false 
                })
                .setFooter({ text: 'Restart the bot after updating the .env file' });
            
            await interaction.reply({ embeds: [removeEmbed], flags: MessageFlags.Ephemeral });
            break;
            
        default:
            await interaction.reply({ embeds: [createErrorEmbed('Not Implemented', 'This admin command is not yet implemented.')], flags: MessageFlags.Ephemeral });
    }
}

async function handleEmojiSlash(interaction) {
    if (!hasModeratorPermissions(interaction.member)) {
        return interaction.reply({ 
            embeds: [createErrorEmbed('Permission Denied', 'You need moderator permissions to use this command.')], 
            flags: MessageFlags.Ephemeral 
        });
    }
    
    const subcommand = interaction.options.getSubcommand();
    
    switch (subcommand) {
        case 'list':
            const emojis = interaction.guild.emojis.cache;
            
            if (emojis.size === 0) {
                return interaction.reply('📭 This server has no custom emojis.');
            }
            
            const emojiEmbed = new EmbedBuilder()
                .setColor('#4ecdc4')
                .setTitle('😀 Server Emojis')
                .setDescription(`This server has ${emojis.size} custom emoji(s):`);
            
            const emojiList = emojis.map(emoji => `${emoji} \`:${emoji.name}:\``).join('\n');
            emojiEmbed.addFields({ name: 'Emojis', value: emojiList.substring(0, 1024) });
            
            if (emojiList.length > 1024) {
                emojiEmbed.setFooter({ text: 'List truncated due to length limits' });
            }
            
            await interaction.reply({ embeds: [emojiEmbed] });
            break;
            
        default:
            await interaction.reply({ embeds: [createErrorEmbed('Not Implemented', 'This emoji command is not yet implemented.')], flags: MessageFlags.Ephemeral });
    }
}

async function handleAutoreactSlash(interaction) {
    // Bot owners have full access, server owners and authorized users have limited access
    if (!isBotOwner(interaction.user.id) && 
        interaction.guild.ownerId !== interaction.user.id && 
        !isAuthorizedUser(interaction.user.id)) {
        return interaction.reply({ 
            embeds: [createErrorEmbed('Permission Denied', 'Only bot owners, server owners, or authorized users can use this command.')], 
            flags: MessageFlags.Ephemeral 
        });
    }
    
    const subcommand = interaction.options.getSubcommand();
    const guildReactions = await getGuildAutoReactions(interaction.guild.id);
    
    switch (subcommand) {
        case 'set':
            const user = interaction.options.getUser('user');
            const emoji = interaction.options.getString('emoji');
            
            // Validate emoji
            if (!isValidEmoji(emoji)) {
                return interaction.reply({ 
                    embeds: [createErrorEmbed('Invalid Emoji', 'Please provide a valid emoji (Unicode, :name:, or custom emoji)')], 
                    flags: MessageFlags.Ephemeral 
                });
            }
            
            await setAutoReaction(interaction.guild.id, user.id, emoji);
            
            const setEmbed = new EmbedBuilder()
                .setColor('#4ecdc4')
                .setTitle('🎭 Auto-Reaction Set')
                .setDescription(`Auto-reaction has been set for ${user}`)
                .addFields(
                    { name: 'User', value: `${user.tag}`, inline: true },
                    { name: 'Emoji', value: emoji, inline: true },
                    { name: 'Status', value: '✅ Enabled', inline: true }
                )
                .setFooter({ text: 'This emoji will be added automatically when this user is mentioned' })
                .setTimestamp();
            
            await interaction.reply({ embeds: [setEmbed] });
            break;
            
        case 'remove':
            const removeUser = interaction.options.getUser('user');
            
            if (!guildReactions.has(removeUser.id)) {
                return interaction.reply({ 
                    embeds: [createErrorEmbed('No Auto-Reaction', 'This user does not have an auto-reaction set.')], 
                    flags: MessageFlags.Ephemeral 
                });
            }
            
            await removeAutoReaction(interaction.guild.id, removeUser.id);
            
            const removeEmbed = new EmbedBuilder()
                .setColor('#ff6b6b')
                .setTitle('🗑️ Auto-Reaction Removed')
                .setDescription(`Auto-reaction has been removed for ${removeUser}`)
                .addFields({ name: 'User', value: `${removeUser.tag}`, inline: true })
                .setTimestamp();
            
            await interaction.reply({ embeds: [removeEmbed] });
            break;
            
        case 'toggle':
            const toggleUser = interaction.options.getUser('user');
            
            if (!guildReactions.has(toggleUser.id)) {
                return interaction.reply({ 
                    embeds: [createErrorEmbed('No Auto-Reaction', 'This user does not have an auto-reaction set.')], 
                    flags: MessageFlags.Ephemeral 
                });
            }
            
            const isEnabled = await toggleAutoReaction(interaction.guild.id, toggleUser.id);
            const reactionData = guildReactions.get(toggleUser.id);
            
            const toggleEmbed = new EmbedBuilder()
                .setColor(isEnabled ? '#4ecdc4' : '#ffa500')
                .setTitle('🔄 Auto-Reaction Toggled')
                .setDescription(`Auto-reaction has been ${isEnabled ? 'enabled' : 'disabled'} for ${toggleUser}`)
                .addFields(
                    { name: 'User', value: `${toggleUser.tag}`, inline: true },
                    { name: 'Emoji', value: reactionData.emoji, inline: true },
                    { name: 'Status', value: isEnabled ? '✅ Enabled' : '❌ Disabled', inline: true }
                )
                .setTimestamp();
            
            await interaction.reply({ embeds: [toggleEmbed] });
            break;
            
        case 'list':
            if (guildReactions.size === 0) {
                return interaction.reply({ 
                    embeds: [new EmbedBuilder()
                        .setColor('#4ecdc4')
                        .setDescription('📭 No auto-reactions are configured for this server.')
                        .setTimestamp()
                    ], 
                    flags: MessageFlags.Ephemeral 
                });
            }
            
            const listEmbed = new EmbedBuilder()
                .setColor('#4ecdc4')
                .setTitle('🎭 Auto-Reactions List')
                .setDescription(`${guildReactions.size} auto-reaction(s) configured in this server:`)
                .setTimestamp();
            
            let reactionList = '';
            for (const [userId, data] of guildReactions.entries()) {
                try {
                    const user = await client.users.fetch(userId);
                    const status = data.enabled ? '✅' : '❌';
                    reactionList += `${status} **${user.tag}** → ${data.emoji}\n`;
                } catch (error) {
                    reactionList += `❓ **Unknown User** (${userId}) → ${data.emoji}\n`;
                }
            }
            
            if (reactionList.length > 4096) {
                reactionList = reactionList.substring(0, 4000) + '\n... (list truncated)';
            }
            
            listEmbed.setDescription(listEmbed.data.description + '\n\n' + reactionList);
            listEmbed.setFooter({ text: '✅ = Enabled | ❌ = Disabled' });
            
            await interaction.reply({ embeds: [listEmbed], flags: MessageFlags.Ephemeral });
            break;
            
        default:
            await interaction.reply({ 
                embeds: [createErrorEmbed('Not Implemented', 'This autoreact command is not yet implemented.')], 
                flags: MessageFlags.Ephemeral 
            });
    }
}

// Helper function to validate emoji
function isValidEmoji(emoji) {
    // Unicode emoji regex (simplified)
    const unicodeEmojiRegex = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u;
    
    // Discord emoji format :name: or <:name:id> or <a:name:id>
    const discordEmojiRegex = /^(:\w+:|<a?:\w+:\d+>)$/;
    
    return unicodeEmojiRegex.test(emoji) || discordEmojiRegex.test(emoji) || emoji.length === 1;
}

// =============================================================================
// BOT LOGIN
// =============================================================================

console.log('🔌 Connecting to Discord...');

// Login to Discord
client.login(process.env.TOKEN).catch(error => {
    console.error('❌ Failed to login to Discord:');
    console.error(error);
    process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Shutting down bot gracefully...');
    console.log('✅ All data is already persisted in database - no manual save needed');
    
    client.destroy();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n👋 Shutting down bot gracefully...');
    console.log('✅ All data is already persisted in database - no manual save needed');
    
    client.destroy();
    process.exit(0);
});
