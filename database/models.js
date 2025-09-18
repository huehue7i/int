const mongoose = require('mongoose');

// User Schema - for leveling, economy, and user data
const userSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    guildId: { type: String, required: true },
    xp: { type: Number, default: 0 },
    level: { type: Number, default: 0 },
    coins: { type: Number, default: 0 },
    messages: { type: Number, default: 0 },
    warnings: { type: Number, default: 0 },
    lastDaily: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, {
    timestamps: true
});

// Create compound index for efficient queries
userSchema.index({ userId: 1, guildId: 1 }, { unique: true });
userSchema.index({ guildId: 1, xp: -1 }); // For leaderboards

// Custom Commands Schema
const customCommandSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    name: { type: String, required: true },
    response: { type: String, required: true },
    type: { type: String, default: 'text', enum: ['text', 'embed'] },
    createdBy: { type: String, required: true },
    editedBy: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
    editedAt: { type: Date, default: null },
    useCount: { type: Number, default: 0 }
}, {
    timestamps: true
});

customCommandSchema.index({ guildId: 1, name: 1 }, { unique: true });

// Quarantine Records Schema
const quarantineRecordSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    guildId: { type: String, required: true },
    moderatorId: { type: String, required: true },
    reason: { type: String, required: true },
    type: { type: String, required: true, enum: ['quarantine', 'unquarantine', 'kick', 'ban', 'timeout'] },
    duration: { type: Number, default: null }, // Duration in milliseconds
    roles: [{ type: String }], // Removed roles (for restoration)
    channelId: { type: String, default: null },
    messageId: { type: String, default: null },
    active: { type: Boolean, default: true },
    expiresAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now }
}, {
    timestamps: true
});

quarantineRecordSchema.index({ userId: 1, guildId: 1 });
quarantineRecordSchema.index({ guildId: 1, active: 1 });
quarantineRecordSchema.index({ expiresAt: 1 }); // For TTL cleanup

// Reminders Schema
const reminderSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    guildId: { type: String, required: true },
    channelId: { type: String, required: true },
    message: { type: String, required: true },
    reminderTime: { type: Date, required: true },
    recurring: { type: String, default: null, enum: [null, 'daily', 'weekly', 'monthly'] },
    active: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now }
}, {
    timestamps: true
});

reminderSchema.index({ userId: 1, active: 1 });
reminderSchema.index({ reminderTime: 1, active: 1 });

// AFK Users Schema
const afkSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    guildId: { type: String, required: true },
    reason: { type: String, default: 'AFK' },
    mentions: [{
        userId: { type: String },
        username: { type: String },
        channelId: { type: String },
        messageId: { type: String },
        timestamp: { type: Date, default: Date.now }
    }],
    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: () => new Date(Date.now() + 24 * 60 * 60 * 1000) } // 24 hours TTL
}, {
    timestamps: true
});

afkSchema.index({ userId: 1, guildId: 1 }, { unique: true });
afkSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // MongoDB TTL

// Guild Settings Schema
const guildSettingsSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true },
    prefix: { type: String, default: '!' },
    moderatorRole: { type: String, default: null },
    quarantineRole: { type: String, default: null },
    logChannel: { type: String, default: null },
    welcomeChannel: { type: String, default: null },
    welcomeMessage: { type: String, default: null },
    autoModEnabled: { type: Boolean, default: false },
    levelingEnabled: { type: Boolean, default: true },
    economyEnabled: { type: Boolean, default: false },
    settings: {
        antiSpam: { type: Boolean, default: false },
        antiRaid: { type: Boolean, default: false },
        autoRole: { type: String, default: null },
        maxWarnings: { type: Number, default: 3 }
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, {
    timestamps: true
});

// guildId already has unique constraint, no additional index needed

// Starboard Schema
const starboardSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    channelId: { type: String, required: true },
    messageId: { type: String, required: true },
    starboardMessageId: { type: String, default: null },
    authorId: { type: String, required: true },
    content: { type: String, required: true },
    stars: { type: Number, default: 0 },
    starredBy: [{ type: String }], // Array of user IDs who starred
    createdAt: { type: Date, default: Date.now }
}, {
    timestamps: true
});

starboardSchema.index({ guildId: 1, messageId: 1 }, { unique: true });
starboardSchema.index({ guildId: 1, stars: -1 });

// Auto Reactions Schema
const autoReactionSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    trigger: { type: String, required: true },
    reactions: [{ type: String }], // Array of emoji/reaction IDs
    createdBy: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
}, {
    timestamps: true
});

autoReactionSchema.index({ guildId: 1, trigger: 1 });

// User Auto Reactions Schema (for mention-based auto reactions)
const userAutoReactionSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    userId: { type: String, required: true },
    emoji: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    createdBy: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
}, {
    timestamps: true
});

userAutoReactionSchema.index({ guildId: 1, userId: 1 }, { unique: true });

// Create and export models
const User = mongoose.model('User', userSchema);
const CustomCommand = mongoose.model('CustomCommand', customCommandSchema);
const QuarantineRecord = mongoose.model('QuarantineRecord', quarantineRecordSchema);
const Reminder = mongoose.model('Reminder', reminderSchema);
const AFK = mongoose.model('AFK', afkSchema);
const GuildSettings = mongoose.model('GuildSettings', guildSettingsSchema);
const Starboard = mongoose.model('Starboard', starboardSchema);
const AutoReaction = mongoose.model('AutoReaction', autoReactionSchema);
const UserAutoReaction = mongoose.model('UserAutoReaction', userAutoReactionSchema);

module.exports = {
    User,
    CustomCommand,
    QuarantineRecord,
    Reminder,
    AFK,
    GuildSettings,
    Starboard,
    AutoReaction,
    UserAutoReaction
};