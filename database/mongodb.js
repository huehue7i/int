const mongoose = require('mongoose');

// MongoDB connection setup
class MongoDB {
    constructor() {
        this.isConnected = false;
        this.connection = null;
    }

    async connect(uri) {
        try {
            console.log('🔄 Connecting to MongoDB...');
            
            this.connection = await mongoose.connect(uri, {
                maxPoolSize: 50,           // Maximum 50 concurrent connections
                serverSelectionTimeoutMS: 5000,  // Keep connections fast
                socketTimeoutMS: 45000     // Socket timeout
            });

            this.isConnected = true;
            console.log('✅ MongoDB connected successfully');
            
            // Handle connection events
            mongoose.connection.on('error', (error) => {
                console.error('❌ MongoDB connection error:', error);
                this.isConnected = false;
            });

            mongoose.connection.on('disconnected', () => {
                console.log('⚠️ MongoDB disconnected');
                this.isConnected = false;
            });

            return this.connection;
        } catch (error) {
            console.error('❌ MongoDB connection failed:', error);
            this.isConnected = false;
            throw error;
        }
    }

    async disconnect() {
        if (this.connection) {
            await mongoose.disconnect();
            this.isConnected = false;
            console.log('📴 MongoDB disconnected');
        }
    }

    getConnection() {
        return this.connection;
    }

    isConnectedToDatabase() {
        return this.isConnected && mongoose.connection.readyState === 1;
    }
}

module.exports = new MongoDB();