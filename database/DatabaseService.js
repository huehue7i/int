const MongoDB = require('./mongodb');
const RedisCache = require('./redis');
const { 
    User, 
    CustomCommand, 
    QuarantineRecord, 
    Reminder, 
    AFK, 
    GuildSettings, 
    Starboard, 
    AutoReaction,
    UserAutoReaction,
    FrozenNickname
} = require('./models');

class DatabaseService {
    constructor() {
        this.mongodb = MongoDB;
        this.redis = RedisCache;
        this.isInitialized = false;
        
        this.queryStats = {
            totalQueries: 0,
            cacheHits: 0,
            slowQueries: 0,
            averageResponseTime: 0
        };
        
        this.batchQueue = new Map();
        this.batchTimeout = null;
    }

    recordQuery(operation, duration, cached = false) {
        this.queryStats.totalQueries++;
        if (cached) this.queryStats.cacheHits++;
        if (duration > 100) this.queryStats.slowQueries++; // Queries over 100ms
        
        this.queryStats.averageResponseTime = 
            ((this.queryStats.averageResponseTime * (this.queryStats.totalQueries - 1)) + duration) / 
            this.queryStats.totalQueries;
    }

    getPerformanceStats() {
        const cacheHitRate = this.queryStats.totalQueries > 0 ? 
            (this.queryStats.cacheHits / this.queryStats.totalQueries * 100).toFixed(2) : 0;
        
        return {
            ...this.queryStats,
            cacheHitRate: `${cacheHitRate}%`,
            averageResponseTime: `${Math.round(this.queryStats.averageResponseTime)}ms`
        };
    }

    async initialize(mongoUri, redisUrl) {
        try {
            console.log('ðŸ”„ Initializing Database Service...');
            
            await this.mongodb.connect(mongoUri);
            
            try {
                await this.redis.connect(redisUrl);
            } catch (redisError) {
                console.warn('âš ï¸ Redis connection failed, continuing with MongoDB only:', redisError.message);
            }
            
            this.isInitialized = true;
            console.log('âœ… Database Service initialized successfully');
            
            return true;
        } catch (error) {
            console.error('âŒ Database Service initialization failed:', error);
            throw error;
        }
    }

    async close() {
        await Promise.all([
            this.mongodb.disconnect(),
            this.redis.disconnect()
        ]);
        this.isInitialized = false;
        console.log('ðŸ“´ Database Service closed');
    }

    isRedisAvailable() {
        return this.redis.isRedisConnected();
    }

    
    async getCustomCommand(guildId, commandName) {
        try {
            if (this.isRedisAvailable()) {
                const cached = await this.redis.getCustomCommand(guildId, commandName);
                if (cached) return cached;
            }
            
            const command = await CustomCommand.findOne({ guildId, name: commandName });
            
            if (command && this.isRedisAvailable()) {
                await this.redis.setCustomCommand(guildId, commandName, command.toObject());
            }
            
            return command ? command.toObject() : null;
        } catch (error) {
            console.error('Error getting custom command:', error);
            return null;
        }
    }

    async createCustomCommand(guildId, commandData) {
        try {
            const command = new CustomCommand({ guildId, ...commandData });
            await command.save();
            
            if (this.isRedisAvailable()) {
                await this.redis.setCustomCommand(guildId, commandData.name, command.toObject());
                await this.redis.invalidateGuildCommands(guildId);
            }
            
            return command.toObject();
        } catch (error) {
            console.error('Error creating custom command:', error);
            throw error;
        }
    }

    async updateCustomCommand(guildId, commandName, updateData) {
        try {
            const command = await CustomCommand.findOneAndUpdate(
                { guildId, name: commandName },
                { ...updateData, editedAt: new Date() },
                { new: true }
            );
            
            if (command && this.isRedisAvailable()) {
                await this.redis.setCustomCommand(guildId, commandName, command.toObject());
                await this.redis.invalidateGuildCommands(guildId);
            }
            
            return command ? command.toObject() : null;
        } catch (error) {
            console.error('Error updating custom command:', error);
            throw error;
        }
    }

    async deleteCustomCommand(guildId, commandName) {
        try {
            const result = await CustomCommand.deleteOne({ guildId, name: commandName });
            
            if (this.isRedisAvailable()) {
                await this.redis.deleteCustomCommand(guildId, commandName);
                await this.redis.invalidateGuildCommands(guildId);
            }
            
            return result.deletedCount > 0;
        } catch (error) {
            console.error('Error deleting custom command:', error);
            return false;
        }
    }

    async getGuildCustomCommands(guildId) {
        try {
            if (this.isRedisAvailable()) {
                const cached = await this.redis.getGuildCustomCommands(guildId);
                if (cached) return cached;
            }
            
            const commands = await CustomCommand.find({ guildId }).lean();
            const commandMap = {};
            commands.forEach(cmd => {
                commandMap[cmd.name] = cmd;
            });
            
            if (this.isRedisAvailable()) {
                await this.redis.setGuildCustomCommands(guildId, commandMap);
            }
            
            return commandMap;
        } catch (error) {
            console.error('Error getting guild custom commands:', error);
            return {};
        }
    }

    async incrementCommandUsage(guildId, commandName) {
        try {
            await CustomCommand.updateOne(
                { guildId, name: commandName },
                { $inc: { useCount: 1 } }
            );
        } catch (error) {
            console.error('Error incrementing command usage:', error);
        }
    }

    async getAllCustomCommands() {
        try {
            const commands = await CustomCommand.find({}).lean();
            return commands;
        } catch (error) {
            console.error('Error getting all custom commands:', error);
            return [];
        }
    }

    
    async getUserData(userId, guildId) {
        try {
            if (this.isRedisAvailable()) {
                const cached = await this.redis.getUserData(userId, guildId);
                if (cached) return cached;
            }
            
            let user = await User.findOne({ userId, guildId }).lean();
            
            if (!user) {
                user = await User.create({ userId, guildId });
                user = user.toObject();
            }
            
            if (this.isRedisAvailable()) {
                await this.redis.setUserData(userId, guildId, user);
            }
            
            return user;
        } catch (error) {
            console.error('Error getting user data:', error);
            return null;
        }
    }

    async updateUserData(userId, guildId, updateData) {
        try {
            const user = await User.findOneAndUpdate(
                { userId, guildId },
                { ...updateData, updatedAt: new Date() },
                { new: true, upsert: true }
            ).lean();
            
            if (this.isRedisAvailable()) {
                await this.redis.setUserData(userId, guildId, user);
            }
            
            return user;
        } catch (error) {
            console.error('Error updating user data:', error);
            return null;
        }
    }

    async addUserXP(userId, guildId, xpAmount) {
        try {
            const user = await User.findOneAndUpdate(
                { userId, guildId },
                { 
                    $inc: { xp: xpAmount, messages: 1 },
                    $set: { updatedAt: new Date() }
                },
                { new: true, upsert: true }
            );

            const newLevel = Math.floor(user.xp / 1000);
            if (newLevel > user.level) {
                user.level = newLevel;
                await user.save();
            }

            const userObj = user.toObject();
            
            if (this.isRedisAvailable()) {
                await this.redis.setUserData(userId, guildId, userObj);
            }
            
            return { user: userObj, leveledUp: newLevel > (userObj.level - 1) };
        } catch (error) {
            console.error('Error adding user XP:', error);
            return null;
        }
    }

    
    async setUserAFK(userId, guildId, reason) {
        try {
            const afkData = {
                userId,
                guildId,
                reason,
                mentions: [],
                createdAt: new Date()
            };

            await AFK.findOneAndUpdate(
                { userId, guildId },
                afkData,
                { upsert: true, new: true }
            );

            if (this.isRedisAvailable()) {
                await this.redis.setAFKStatus(userId, guildId, afkData);
            }

            return true;
        } catch (error) {
            console.error('Error setting user AFK:', error);
            return false;
        }
    }

    async getUserAFK(userId, guildId) {
        try {
            if (this.isRedisAvailable()) {
                const cached = await this.redis.getAFKStatus(userId, guildId);
                if (cached) return cached;
            }
            
            const afk = await AFK.findOne({ userId, guildId }).lean();
            
            if (afk && this.isRedisAvailable()) {
                await this.redis.setAFKStatus(userId, guildId, afk);
            }
            
            return afk;
        } catch (error) {
            console.error('Error getting user AFK:', error);
            return null;
        }
    }

    async removeUserAFK(userId, guildId) {
        try {
            await AFK.deleteOne({ userId, guildId });
            
            if (this.isRedisAvailable()) {
                await this.redis.removeAFKStatus(userId, guildId);
            }
            
            return true;
        } catch (error) {
            console.error('Error removing user AFK:', error);
            return false;
        }
    }

    async addAFKMention(userId, guildId, mentionData) {
        try {
            await AFK.updateOne(
                { userId, guildId },
                { $push: { mentions: { ...mentionData, timestamp: new Date() } } }
            );
            
            if (this.isRedisAvailable()) {
                await this.redis.removeAFKStatus(userId, guildId);
            }
            
            return true;
        } catch (error) {
            console.error('Error adding AFK mention:', error);
            return false;
        }
    }

    async getGuildAFKUsers(guildId) {
        try {
            const afkUsers = await AFK.find({ guildId }).lean();
            return afkUsers || [];
        } catch (error) {
            console.error('Error getting guild AFK users:', error);
            return [];
        }
    }

    
    async createQuarantineRecord(recordData) {
        try {
            const record = await QuarantineRecord.create(recordData);
            
            if (recordData.active && this.isRedisAvailable()) {
                await this.redis.setActiveQuarantine(recordData.userId, recordData.guildId, record.toObject());
            }
            
            return record.toObject();
        } catch (error) {
            console.error('Error creating quarantine record:', error);
            return null;
        }
    }

    async getActiveQuarantine(userId, guildId) {
        try {
            if (this.isRedisAvailable()) {
                const cached = await this.redis.getActiveQuarantine(userId, guildId);
                if (cached) return cached;
            }
            
            const record = await QuarantineRecord.findOne({ 
                userId, 
                guildId, 
                active: true 
            }).lean();
            
            if (record && this.isRedisAvailable()) {
                await this.redis.setActiveQuarantine(userId, guildId, record);
            }
            
            return record;
        } catch (error) {
            console.error('Error getting active quarantine:', error);
            return null;
        }
    }

    async updateQuarantineRecord(userId, guildId, updateData) {
        try {
            const record = await QuarantineRecord.findOneAndUpdate(
                { userId, guildId, active: true },
                updateData,
                { new: true }
            ).lean();
            
            if (this.isRedisAvailable()) {
                if (record && record.active) {
                    await this.redis.setActiveQuarantine(userId, guildId, record);
                } else {
                    await this.redis.removeActiveQuarantine(userId, guildId);
                }
            }
            
            return record;
        } catch (error) {
            console.error('Error updating quarantine record:', error);
            return null;
        }
    }

    async getGuildQuarantineRecords(guildId, userId = null, limit = 50) {
        try {
            let query = { guildId };
            if (userId) {
                query.userId = userId;
            }
            
            const records = await QuarantineRecord.find(query)
                .sort({ createdAt: -1 })
                .limit(limit)
                .lean();
                
            return records;
        } catch (error) {
            console.error('Error getting guild quarantine records:', error);
            return [];
        }
    }

    
    async createReminder(reminderData) {
        try {
            const reminder = await Reminder.create(reminderData);
            return reminder.toObject();
        } catch (error) {
            console.error('Error creating reminder:', error);
            return null;
        }
    }

    async getActiveReminders() {
        try {
            return await Reminder.find({ 
                active: true, 
                reminderTime: { $lte: new Date() } 
            }).lean();
        } catch (error) {
            console.error('Error getting active reminders:', error);
            return [];
        }
    }

    async getUserReminders(userId, guildId) {
        try {
            return await Reminder.find({ userId, guildId, active: true }).lean();
        } catch (error) {
            console.error('Error getting user reminders:', error);
            return [];
        }
    }

    async deleteReminder(reminderId) {
        try {
            const result = await Reminder.deleteOne({ _id: reminderId });
            return result.deletedCount > 0;
        } catch (error) {
            console.error('Error deleting reminder:', error);
            return false;
        }
    }

    
    async getGuildSettings(guildId) {
        try {
            if (this.isRedisAvailable()) {
                const cached = await this.redis.getGuildSettings(guildId);
                if (cached) return cached;
            }
            
            let settings = await GuildSettings.findOne({ guildId }).lean();
            
            if (!settings) {
                settings = await GuildSettings.create({ guildId });
                settings = settings.toObject();
            }
            
            if (this.isRedisAvailable()) {
                await this.redis.setGuildSettings(guildId, settings);
            }
            
            return settings;
        } catch (error) {
            console.error('Error getting guild settings:', error);
            return null;
        }
    }

    async updateGuildSettings(guildId, updateData) {
        try {
            const settings = await GuildSettings.findOneAndUpdate(
                { guildId },
                { ...updateData, updatedAt: new Date() },
                { new: true, upsert: true }
            ).lean();
            
            if (this.isRedisAvailable()) {
                await this.redis.setGuildSettings(guildId, settings);
            }
            
            return settings;
        } catch (error) {
            console.error('Error updating guild settings:', error);
            return null;
        }
    }

    
    async getStarboardConfig(guildId) {
        try {
            if (this.isRedisAvailable()) {
                const cached = await this.redis.getStarboardConfig(guildId);
                if (cached) return cached;
            }
            
            const config = await Starboard.findOne({ guildId, messageId: '__CONFIG__' }).lean();
            
            if (config && this.isRedisAvailable()) {
                await this.redis.setStarboardConfig(guildId, config);
            }
            
            return config;
        } catch (error) {
            console.error('Error getting starboard config:', error);
            return null;
        }
    }

    async saveStarboardConfig(guildId, config) {
        try {
            await Starboard.findOneAndUpdate(
                { guildId, messageId: '__CONFIG__' },
                { 
                    guildId,
                    messageId: '__CONFIG__',
                    channelId: config.channelId,
                    threshold: config.threshold || 3,
                    emoji: config.emoji || 'â­'
                },
                { upsert: true }
            );
            
            if (this.isRedisAvailable()) {
                await this.redis.removeStarboardConfig(guildId);
            }
            
            return true;
        } catch (error) {
            console.error('Error saving starboard config:', error);
            return false;
        }
    }

    async createStarboardEntry(starboardData) {
        try {
            const entry = new Starboard(starboardData);
            await entry.save();
            return entry.toObject();
        } catch (error) {
            console.error('Error creating starboard entry:', error);
            return null;
        }
    }

    async updateStarboardEntry(guildId, messageId, updateData) {
        try {
            const entry = await Starboard.findOneAndUpdate(
                { guildId, messageId },
                updateData,
                { new: true }
            ).lean();
            return entry;
        } catch (error) {
            console.error('Error updating starboard entry:', error);
            return null;
        }
    }

    async getStarboardEntry(guildId, messageId) {
        try {
            return await Starboard.findOne({ guildId, messageId }).lean();
        } catch (error) {
            console.error('Error getting starboard entry:', error);
            return null;
        }
    }

    async getAllStarboardConfigs() {
        try {
            const configs = await Starboard.find({ messageId: '__CONFIG__' })
                .select('guildId channelId threshold emoji')
                .lean();
            
            return configs.map(config => ({
                guildId: config.guildId,
                channelId: config.channelId,
                threshold: config.threshold || 3,
                emoji: config.emoji || 'â­'
            }));
        } catch (error) {
            console.error('Error getting all starboard configs:', error);
            return [];
        }
    }

    async getAllStarboardMessages() {
        try {
            const messages = await Starboard.find({ 
                starboardMessageId: { $ne: null },
                messageId: { $ne: '__CONFIG__' }
            })
                .select('messageId starboardMessageId')
                .lean();
            
            return messages.map(msg => ({
                originalMessageId: msg.messageId,
                starboardMessageId: msg.starboardMessageId
            }));
        } catch (error) {
            console.error('Error getting all starboard messages:', error);
            return [];
        }
    }

    async saveStarboardMessage(guildId, originalMessageId, starboardMessageId) {
        try {
            await Starboard.findOneAndUpdate(
                { guildId, messageId: originalMessageId },
                { 
                    guildId,
                    messageId: originalMessageId,
                    starboardMessageId 
                },
                { upsert: true }
            );
            return true;
        } catch (error) {
            console.error('Error saving starboard message:', error);
            return false;
        }
    }

    async deleteStarboardMessage(guildId, originalMessageId) {
        try {
            await Starboard.deleteOne({ guildId, messageId: originalMessageId });
            return true;
        } catch (error) {
            console.error('Error deleting starboard message:', error);
            return false;
        }
    }

    
    async getGuildAutoReactions(guildId) {
        try {
            const reactions = await UserAutoReaction.find({ guildId }).lean();
            
            const reactionMap = new Map();
            reactions.forEach(reaction => {
                reactionMap.set(reaction.userId, {
                    emoji: reaction.emoji,
                    enabled: reaction.enabled
                });
            });
            
            return reactionMap;
        } catch (error) {
            console.error('Error getting guild auto reactions:', error);
            return new Map(); // Return empty Map instead of empty object
        }
    }

    async setAutoReaction(guildId, userId, emoji, enabled = true) {
        try {
            const result = await UserAutoReaction.findOneAndUpdate(
                { guildId, userId },
                { emoji, enabled, createdBy: userId },
                { upsert: true, new: true }
            );
            return result ? result.toObject() : null;
        } catch (error) {
            console.error('Error setting auto reaction:', error);
            return null;
        }
    }

    async removeAutoReaction(guildId, userId) {
        try {
            const result = await UserAutoReaction.deleteOne({ guildId, userId });
            return result.deletedCount > 0;
        } catch (error) {
            console.error('Error removing auto reaction:', error);
            return false;
        }
    }

    async toggleAutoReaction(guildId, userId) {
        try {
            const reaction = await UserAutoReaction.findOne({ guildId, userId });
            if (reaction) {
                reaction.enabled = !reaction.enabled;
                await reaction.save();
                return reaction.enabled;
            }
            return false;
        } catch (error) {
            console.error('Error toggling auto reaction:', error);
            return false;
        }
    }

    async createAutoReaction(guildId, reactionData) {
        try {
            const reaction = new AutoReaction({ guildId, ...reactionData });
            await reaction.save();
            
            if (this.isRedisAvailable()) {
                await this.redis.deleteGuildAutoReactions(guildId);
            }
            
            return reaction.toObject();
        } catch (error) {
            console.error('Error creating auto reaction:', error);
            return null;
        }
    }

    async deleteAutoReaction(guildId, trigger) {
        try {
            const result = await AutoReaction.deleteOne({ guildId, trigger });
            
            if (this.isRedisAvailable()) {
                await this.redis.deleteGuildAutoReactions(guildId);
            }
            
            return result.deletedCount > 0;
        } catch (error) {
            console.error('Error deleting auto reaction:', error);
            return false;
        }
    }

    
    async getLeaderboard(guildId, type = 'xp', limit = 10) {
        try {
            const sortField = type === 'xp' ? { xp: -1 } : { level: -1 };
            return await User.find({ guildId })
                .sort(sortField)
                .limit(limit)
                .lean();
        } catch (error) {
            console.error('Error getting leaderboard:', error);
            return [];
        }
    }

    async getUserRank(userId, guildId) {
        try {
            const user = await User.findOne({ userId, guildId }).lean();
            if (!user) return null;

            const rank = await User.countDocuments({
                guildId,
                xp: { $gt: user.xp }
            });

            return { ...user, rank: rank + 1 };
        } catch (error) {
            console.error('Error getting user rank:', error);
            return null;
        }
    }

    async getAllActiveReminders() {
        try {
            const reminders = await Reminder.find({ active: true }).lean();
            return reminders;
        } catch (error) {
            console.error('Error getting all active reminders:', error);
            return [];
        }
    }

    async createReminder(reminderData) {
        try {
            const reminder = new Reminder(reminderData);
            await reminder.save();
            return reminder.toObject();
        } catch (error) {
            console.error('Error creating reminder:', error);
            return null;
        }
    }

    async updateReminder(reminderId, updateData) {
        try {
            const reminder = await Reminder.findByIdAndUpdate(
                reminderId, 
                updateData, 
                { new: true }
            );
            return reminder ? reminder.toObject() : null;
        } catch (error) {
            console.error('Error updating reminder:', error);
            return null;
        }
    }

    async deactivateReminder(reminderId) {
        try {
            const reminder = await Reminder.findByIdAndUpdate(
                reminderId, 
                { active: false }, 
                { new: true }
            );
            return reminder ? reminder.toObject() : null;
        } catch (error) {
            console.error('Error deactivating reminder:', error);
            return null;
        }
    }

    async getUserReminders(userId) {
        try {
            const reminders = await Reminder.find({ 
                userId: userId, 
                active: true 
            }).lean();
            return reminders;
        } catch (error) {
            console.error('Error getting user reminders:', error);
            return [];
        }
    }

    async cleanupExpiredData() {
        try {
            const now = new Date();
            
            await QuarantineRecord.updateMany(
                { expiresAt: { $lte: now }, active: true },
                { active: false }
            );
            
            await Reminder.deleteMany({
                reminderTime: { $lt: new Date(now - 24 * 60 * 60 * 1000) },
                active: false
            });
            
            console.log('ðŸ§¹ Expired data cleanup completed');
            return true;
        } catch (error) {
            console.error('Error cleaning up expired data:', error);
            return false;
        }
    }

    async healthCheck() {
        const health = {
            mongodb: this.mongodb.isConnectedToDatabase(),
            redis: this.isRedisAvailable(),
            timestamp: new Date()
        };
        
        return health;
    }

    async freezeNickname(userId, guildId, frozenNickname, moderatorId, reason = 'No reason provided') {
        try {
            const freezeData = {
                userId,
                guildId,
                frozenNickname: frozenNickname || null,
                moderatorId,
                reason,
                active: true,
                createdAt: new Date()
            };

            await FrozenNickname.findOneAndUpdate(
                { userId, guildId },
                freezeData,
                { upsert: true, new: true }
            );

            return true;
        } catch (error) {
            console.error('Error freezing nickname:', error);
            return false;
        }
    }

    async getFrozenNickname(userId, guildId) {
        try {
            const frozen = await FrozenNickname.findOne({ userId, guildId, active: true }).lean();
            return frozen;
        } catch (error) {
            console.error('Error getting frozen nickname:', error);
            return null;
        }
    }

    async unfreezeNickname(userId, guildId) {
        try {
            console.log(`[DB] Unfreezing nickname for user ${userId} in guild ${guildId}`);
            const result = await FrozenNickname.deleteOne({ userId, guildId });
            console.log(`[DB] Delete result:`, result);
            console.log(`[DB] Deleted count: ${result.deletedCount}`);
            return true;
        } catch (error) {
            console.error('[DB] Error unfreezing nickname:', error);
            return false;
        }
    }

    async getAllFrozenNicknames(guildId) {
        try {
            const frozen = await FrozenNickname.find({ guildId, active: true }).lean();
            return frozen || [];
        } catch (error) {
            console.error('Error getting all frozen nicknames:', error);
            return [];
        }
    }
}

module.exports = new DatabaseService();
