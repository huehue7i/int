require('dotenv').config();

// Database configuration and settings
const DatabaseConfig = {
    // MongoDB Configuration
    mongodb: {
        uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/discordbot',
        options: {
            // Connection Pool Settings (for concurrency)
            maxPoolSize: parseInt(process.env.DB_MAX_POOL_SIZE) || 50,
            minPoolSize: 5,
            
            // Timeout Settings
            serverSelectionTimeoutMS: parseInt(process.env.DB_TIMEOUT) || 5000,
            socketTimeoutMS: 45000,
            connectTimeoutMS: 10000,
            
            // Performance Settings
            bufferMaxEntries: 0,       // Disable mongoose buffering for better concurrency
            bufferCommands: false,     // Disable command buffering
            
            // Reliability Settings
            retryWrites: process.env.DB_RETRY_WRITES === 'true',
            readPreference: 'primary',
            
            // Monitoring
            monitorCommands: true,
            
            // Compression (saves bandwidth)
            compressors: ['zlib'],
            
            // Write Concern (for data consistency)
            writeConcern: {
                w: 'majority',
                j: true,
                wtimeout: 10000
            }
        }
    },

    // Redis Configuration
    redis: {
        url: process.env.REDIS_URL || 'redis://localhost:6379',
        options: {
            // Connection Settings
            connectTimeout: 10000,
            commandTimeout: 5000,
            
            // Retry Logic
            maxRetriesPerRequest: 3,
            retryDelayOnFailover: 100,
            
            // Performance Settings
            enableOfflineQueue: false,
            lazyConnect: true,
            keepAlive: 30000,
            
            // Memory Management
            maxmemoryPolicy: 'allkeys-lru',
            
            // Connection Pool
            family: 4,
            
            // Reconnection Settings
            retryDelayOnConnectFailoverMs: 100,
            enableReadyCheck: true,
            maxLoadingTimeout: 5000
        },
        
        // Cache TTL Settings (in seconds)
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

    // Application-specific Database Settings
    application: {
        // Cleanup intervals (in milliseconds)
        cleanupInterval: 5 * 60 * 1000,        // 5 minutes
        expiredDataCleanup: 60 * 60 * 1000,    // 1 hour
        
        // Data retention periods (in milliseconds)
        retention: {
            afkMentions: 7 * 24 * 60 * 60 * 1000,      // 7 days
            oldReminders: 24 * 60 * 60 * 1000,          // 1 day
            inactiveQuarantines: 30 * 24 * 60 * 60 * 1000, // 30 days
            rateLimitData: 60 * 1000                     // 1 minute
        },
        
        // Performance limits
        limits: {
            maxCustomCommandsPerGuild: 100,
            maxRemindersPerUser: 10,
            maxQuarantineRecords: 1000,
            maxAFKMentionsPerUser: 50,
            maxCacheKeys: 10000
        },
        
        // Batch operation sizes
        batchSizes: {
            migration: 100,
            cleanup: 500,
            bulk_insert: 1000
        }
    },

    // Production optimizations
    production: {
        // Enable connection monitoring
        enableMonitoring: process.env.NODE_ENV === 'production',
        
        // Logging levels
        mongoLogLevel: process.env.NODE_ENV === 'production' ? 'error' : 'info',
        redisLogLevel: process.env.NODE_ENV === 'production' ? 'error' : 'info',
        
        // Health check intervals
        healthCheckInterval: 30000, // 30 seconds
        
        // Automatic failover
        enableFailover: true,
        
        // Performance monitoring
        enablePerfMonitoring: true,
        
        // Memory usage warnings
        memoryWarningThreshold: 400 * 1024 * 1024, // 400MB
        memoryCriticalThreshold: 450 * 1024 * 1024  // 450MB
    },

    // Development settings
    development: {
        // More verbose logging
        enableDebugLogging: process.env.NODE_ENV !== 'production',
        
        // Shorter timeouts for faster feedback
        shortTimeouts: process.env.NODE_ENV !== 'production',
        
        // Database seeding
        enableSeeding: false,
        
        // Cache debugging
        enableCacheDebugging: false
    }
};

// Environment-specific overrides
if (process.env.NODE_ENV === 'development') {
    // Development overrides
    DatabaseConfig.mongodb.options.serverSelectionTimeoutMS = 2000;
    DatabaseConfig.redis.options.connectTimeout = 5000;
} else if (process.env.NODE_ENV === 'production') {
    // Production optimizations
    DatabaseConfig.mongodb.options.maxPoolSize = 100;
    DatabaseConfig.redis.ttl.customCommands = 7200; // Longer cache in production
}

// Validation function
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

// Helper functions
const DatabaseHelpers = {
    // Generate cache keys
    generateCacheKey: (type, ...identifiers) => {
        return `${type}:${identifiers.join(':')}`;
    },
    
    // Check if Redis is available
    isRedisRequired: () => {
        return process.env.REDIS_REQUIRED === 'true';
    },
    
    // Get memory-safe batch size
    getMemorySafeBatchSize: (totalRecords) => {
        const maxBatch = DatabaseConfig.application.batchSizes.bulk_insert;
        return Math.min(maxBatch, Math.max(1, Math.floor(totalRecords / 10)));
    },
    
    // Performance monitoring
    shouldLogPerformance: () => {
        return DatabaseConfig.production.enablePerfMonitoring && 
               process.env.NODE_ENV === 'production';
    },
    
    // Health check configuration
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