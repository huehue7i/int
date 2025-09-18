const Redis = require('ioredis');

// Redis connection and caching layer
class RedisCache {
    constructor() {
        this.client = null;
        this.isConnected = false;
        this.connectionRetries = 0;
        this.maxRetries = 5;
    }

    async connect(redisConfig = 'redis://localhost:6379') {
        try {
            console.log('🔄 Connecting to Redis...');
            
            // Handle both URL string and object configuration
            if (typeof redisConfig === 'object') {
                // Object configuration (preferred for Redis Cloud)
                this.client = new Redis({
                    ...redisConfig,
                    maxRetriesPerRequest: 3,
                    retryDelayOnFailover: 100,
                    enableOfflineQueue: false,
                    lazyConnect: true,
                    keepAlive: 30000,
                    connectTimeout: 10000,
                    commandTimeout: 5000
                });
            } else {
                // URL string configuration
                this.client = new Redis(redisConfig, {
                    maxRetriesPerRequest: 3,
                    retryDelayOnFailover: 100,
                    enableOfflineQueue: false,
                    lazyConnect: true,
                    keepAlive: 30000,
                    connectTimeout: 10000,
                    commandTimeout: 5000
                });
            }

            // Connection event handlers
            this.client.on('connect', () => {
                console.log('✅ Redis connected successfully');
                this.isConnected = true;
                this.connectionRetries = 0;
            });

            this.client.on('error', (error) => {
                console.error('❌ Redis connection error:', error.message);
                this.isConnected = false;
                
                // Auto-reconnect logic
                if (this.connectionRetries < this.maxRetries) {
                    this.connectionRetries++;
                    console.log(`🔄 Attempting Redis reconnection (${this.connectionRetries}/${this.maxRetries})...`);
                    setTimeout(() => this.connect(redisConfig), 5000 * this.connectionRetries);
                }
            });

            this.client.on('close', () => {
                console.log('⚠️ Redis connection closed');
                this.isConnected = false;
            });

            // Test connection with proper connection handling
            await this.client.connect();
            await this.client.ping();
            return this.client;

        } catch (error) {
            console.error('❌ Redis connection failed:', error);
            this.isConnected = false;
            throw error;
        }
    }

    async disconnect() {
        if (this.client) {
            await this.client.quit();
            this.isConnected = false;
            console.log('📴 Redis disconnected');
        }
    }

    // Generic cache methods
    async get(key) {
        if (!this.isConnected) return null;
        try {
            const data = await this.client.get(key);
            return data ? JSON.parse(data) : null;
        } catch (error) {
            console.error(`Redis GET error for key ${key}:`, error);
            return null;
        }
    }

    async set(key, value, ttlSeconds = 3600) {
        if (!this.isConnected) return false;
        try {
            const serialized = JSON.stringify(value);
            if (ttlSeconds) {
                await this.client.setex(key, ttlSeconds, serialized);
            } else {
                await this.client.set(key, serialized);
            }
            return true;
        } catch (error) {
            console.error(`Redis SET error for key ${key}:`, error);
            return false;
        }
    }

    async del(key) {
        if (!this.isConnected) return false;
        try {
            await this.client.del(key);
            return true;
        } catch (error) {
            console.error(`Redis DEL error for key ${key}:`, error);
            return false;
        }
    }

    async exists(key) {
        if (!this.isConnected) return false;
        try {
            return await this.client.exists(key) === 1;
        } catch (error) {
            console.error(`Redis EXISTS error for key ${key}:`, error);
            return false;
        }
    }

    // Specialized caching methods for Discord bot data
    
    // Custom Commands Cache
    async getCustomCommand(guildId, commandName) {
        return await this.get(`custom_cmd:${guildId}:${commandName}`);
    }

    async setCustomCommand(guildId, commandName, commandData) {
        return await this.set(`custom_cmd:${guildId}:${commandName}`, commandData, 3600); // 1 hour TTL
    }

    async deleteCustomCommand(guildId, commandName) {
        return await this.del(`custom_cmd:${guildId}:${commandName}`);
    }

    // Guild Custom Commands List Cache
    async getGuildCustomCommands(guildId) {
        return await this.get(`guild_cmds:${guildId}`);
    }

    async setGuildCustomCommands(guildId, commands) {
        return await this.set(`guild_cmds:${guildId}`, commands, 3600); // 1 hour TTL
    }

    async invalidateGuildCommands(guildId) {
        await this.del(`guild_cmds:${guildId}`);
    }

    // User Data Cache
    async getUserData(userId, guildId) {
        return await this.get(`user:${guildId}:${userId}`);
    }

    async setUserData(userId, guildId, userData) {
        return await this.set(`user:${guildId}:${userId}`, userData, 600); // 10 minutes TTL
    }

    async deleteUserData(userId, guildId) {
        return await this.del(`user:${guildId}:${userId}`);
    }

    // AFK Status Cache
    async getAFKStatus(userId, guildId) {
        return await this.get(`afk:${guildId}:${userId}`);
    }

    async setAFKStatus(userId, guildId, afkData) {
        return await this.set(`afk:${guildId}:${userId}`, afkData, 86400); // 24 hours TTL
    }

    async removeAFKStatus(userId, guildId) {
        return await this.del(`afk:${guildId}:${userId}`);
    }

    // Guild Settings Cache
    async getGuildSettings(guildId) {
        return await this.get(`guild_settings:${guildId}`);
    }

    async setGuildSettings(guildId, settings) {
        return await this.set(`guild_settings:${guildId}`, settings, 1800); // 30 minutes TTL
    }

    async invalidateGuildSettings(guildId) {
        return await this.del(`guild_settings:${guildId}`);
    }

    // Quarantine Records Cache (for active quarantines)
    async getActiveQuarantine(userId, guildId) {
        return await this.get(`quarantine:${guildId}:${userId}`);
    }

    async setActiveQuarantine(userId, guildId, quarantineData) {
        return await this.set(`quarantine:${guildId}:${userId}`, quarantineData, 7200); // 2 hours TTL
    }

    async removeActiveQuarantine(userId, guildId) {
        return await this.del(`quarantine:${guildId}:${userId}`);
    }

    // Rate Limiting Cache
    async getRateLimit(userId, commandType = 'global') {
        return await this.get(`ratelimit:${commandType}:${userId}`);
    }

    async setRateLimit(userId, commandType = 'global', attempts = 1) {
        return await this.set(`ratelimit:${commandType}:${userId}`, { attempts, timestamp: Date.now() }, 60); // 1 minute TTL
    }

    async incrementRateLimit(userId, commandType = 'global') {
        if (!this.isConnected) return false;
        try {
            const key = `ratelimit:${commandType}:${userId}`;
            const current = await this.get(key) || { attempts: 0, timestamp: Date.now() };
            current.attempts++;
            await this.set(key, current, 60);
            return current.attempts;
        } catch (error) {
            console.error('Redis rate limit increment error:', error);
            return false;
        }
    }

    // Cache Statistics
    async getCacheStats() {
        if (!this.isConnected) return null;
        try {
            const info = await this.client.info('memory');
            return {
                connected: this.isConnected,
                memoryUsage: info,
                keyCount: await this.client.dbsize()
            };
        } catch (error) {
            console.error('Redis stats error:', error);
            return null;
        }
    }

    // Bulk operations
    async mget(keys) {
        if (!this.isConnected || !keys.length) return [];
        try {
            const results = await this.client.mget(keys);
            return results.map(result => result ? JSON.parse(result) : null);
        } catch (error) {
            console.error('Redis MGET error:', error);
            return [];
        }
    }

    async mset(keyValuePairs, ttlSeconds = 3600) {
        if (!this.isConnected || !keyValuePairs.length) return false;
        try {
            const pipeline = this.client.pipeline();
            
            for (let i = 0; i < keyValuePairs.length; i += 2) {
                const key = keyValuePairs[i];
                const value = JSON.stringify(keyValuePairs[i + 1]);
                pipeline.setex(key, ttlSeconds, value);
            }
            
            await pipeline.exec();
            return true;
        } catch (error) {
            console.error('Redis MSET error:', error);
            return false;
        }
    }

    // Clear all cache (use carefully)
    async flushAll() {
        if (!this.isConnected) return false;
        try {
            await this.client.flushall();
            console.log('🧹 Redis cache cleared');
            return true;
        } catch (error) {
            console.error('Redis flush error:', error);
            return false;
        }
    }

    isRedisConnected() {
        return this.isConnected && this.client && this.client.status === 'ready';
    }
}

module.exports = new RedisCache();