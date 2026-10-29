const mongoose = require('mongoose');

class MongoDB {
    constructor() {
        this.isConnected = false;
        this.connection = null;
    }

    async connect(uri) {
        try {
            console.log('ðŸ”„ Connecting to MongoDB...');
            
            this.connection = await mongoose.connect(uri, {
                maxPoolSize: 50,
                serverSelectionTimeoutMS: 5000,
                socketTimeoutMS: 45000
            });

            this.isConnected = true;
            console.log('âœ… MongoDB connected successfully');
            
            mongoose.connection.on('error', (error) => {
                console.error('âŒ MongoDB connection error:', error);
                this.isConnected = false;
            });

            mongoose.connection.on('disconnected', () => {
                console.log('âš ï¸ MongoDB disconnected');
                this.isConnected = false;
            });

            return this.connection;
        } catch (error) {
            console.error('âŒ MongoDB connection failed:', error);
            this.isConnected = false;
            throw error;
        }
    }

    async disconnect() {
        if (this.connection) {
            await mongoose.disconnect();
            this.isConnected = false;
            console.log('ðŸ“´ MongoDB disconnected');
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
