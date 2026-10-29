require('dotenv').config();

const DatabaseConfig = {
    mongodb: {
        uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/discordbot',
        options: {
            maxPoolSize: parseInt(process.env.DB_MAX_POOL_SIZE) || 50,
            minPoolSize: 5,
            
            serverSelectionTimeoutMS: parseInt(process.env.DB_TIMEOUT) || 5000,
            socketTimeoutMS: 45000,
            connectTimeoutMS: 10000,
            
            bufferMaxEntries: 0,       // Disable mongoose buffering for better concurrency
            bufferCommands: false,     // Disable command buffering
            
            retryWrites: process.env.DB_RETRY_WRITES === 'true',
            readPreference: 'primary',
            
            monitorCommands: true,
            
            compressors: ['zlib'],
            
            writeConcern: {
                w: 'majority',
                j: true,
                wtimeout: 10000
            }
        }
    },

    redis: {
        url: process.env.REDIS_URL || 'redis://localhost:6379',
        options: {
            connectTimeout: 10000,
            commandTimeout: 5000,
            
            maxRetriesPerRequest: 3,
            retryDelayOnFailover: 100,
            
            enableOfflineQueue: false,
            lazyConnect: true,
            keepAlive: 30000,
            
            maxmemoryPolicy: 'allkeys-lru',
            
            family: 4,
            
            retryDelayOnConnectFailoverMs: 100,
            enableReadyCheck: true,
            maxLoadingTimeout: 5000
        },
        
        ttl: {
            customCommands: 3600,      // 1 hour
            guildCommands: 3600,       // 1 hour
            userData: 600,             // 10 minutes
            guildSettings: 1800,       // 30 minutes
            afkStatus: 86400,          // 24 hours
            quarantine: 7200,          // 2 hours
            rateLimit: 60              // 1 minute
        }
    },

    application: {
        cleanupInterval: 5 * 60 * 1000,        // 5 minutes
        expiredDataCleanup: 60 * 60 * 1000,    // 1 hour
        
        retention: {
            afkMentions: 7 * 24 * 60 * 60 * 1000,      // 7 days
            oldReminders: 24 * 60 * 60 * 1000,          // 1 day
            inactiveQuarantines: 30 * 24 * 60 * 60 * 1000, // 30 days
            rateLimitData: 60 * 1000                     // 1 minute
        },
        
        limits: {
            maxCustomCommandsPerGuild: 100,
            maxRemindersPerUser: 10,
            maxQuarantineRecords: 1000,
            maxAFKMentionsPerUser: 50,
            maxCacheKeys: 10000
        },
        
        batchSizes: {
            migration: 100,
            cleanup: 500,
            bulk_insert: 1000
        }
    },

    production: {
        enableMonitoring: process.env.NODE_ENV === 'production',
        
        mongoLogLevel: process.env.NODE_ENV === 'production' ? 'error' : 'info',
        redisLogLevel: process.env.NODE_ENV === 'production' ? 'error' : 'info',
        
        healthCheckInterval: 30000, // 30 seconds
        
        enableFailover: true,
        
        enablePerfMonitoring: true,
        
        memoryWarningThreshold: 400 * 1024 * 1024, // 400MB
        memoryCriticalThreshold: 450 * 1024 * 1024  // 450MB
    },

    development: {
        enableDebugLogging: process.env.NODE_ENV !== 'production',
        
        shortTimeouts: process.env.NODE_ENV !== 'production',
        
        enableSeeding: false,
        
        enableCacheDebugging: false
    }
};

if (process.env.NODE_ENV === 'development') {
    DatabaseConfig.mongodb.options.serverSelectionTimeoutMS = 2000;
    DatabaseConfig.redis.options.connectTimeout = 5000;
} else if (process.env.NODE_ENV === 'production') {
    DatabaseConfig.mongodb.options.maxPoolSize = 100;
    DatabaseConfig.redis.ttl.customCommands = 7200; // Longer cache in production
}

function validateConfig() {
    const errors = [];
    
    if (!DatabaseConfig.mongodb.uri) {
        errors.push('MongoDB URI is required');
    }
    
    if (!DatabaseConfig.redis.url) {
        errors.push('Redis URL is required');
    }
    
    if (DatabaseConfig.mongodb.options.maxPoolSize < 10) {
        errors.push('MongoDB max pool size should be at least 10 for good performance');
    }
    
    return {
        isValid: errors.length === 0,
        errors
    };
}

const DatabaseHelpers = {
    generateCacheKey: (type, ...identifiers) => {
        return `${type}:${identifiers.join(':')}`;
    },
    
    isRedisRequired: () => {
        return process.env.REDIS_REQUIRED === 'true';
    },
    
    getMemorySafeBatchSize: (totalRecords) => {
        const maxBatch = DatabaseConfig.application.batchSizes.bulk_insert;
        return Math.min(maxBatch, Math.max(1, Math.floor(totalRecords / 10)));
    },
    
    shouldLogPerformance: () => {
        return DatabaseConfig.production.enablePerfMonitoring && 
               process.env.NODE_ENV === 'production';
    },
    
    getHealthCheckConfig: () => {
        return {
            mongodb: {
                timeout: DatabaseConfig.mongodb.options.serverSelectionTimeoutMS,
                interval: DatabaseConfig.production.healthCheckInterval
            },
            redis: {
                timeout: DatabaseConfig.redis.options.connectTimeout,
                interval: DatabaseConfig.production.healthCheckInterval
            }
        };
    }
};

module.exports = {
    DatabaseConfig,
    validateConfig,
    DatabaseHelpers
};
