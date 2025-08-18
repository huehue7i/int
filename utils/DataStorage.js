const fs = require('fs');
const path = require('path');

/**
 * Utility class for managing data storage
 */
class DataStorage {
    constructor() {
        this.dataDir = path.join(__dirname, '..', 'data');
        this.ensureDataDirectory();
        
        // Define file paths for different data types
        this.files = {
            afkUsers: path.join(this.dataDir, 'afk_users.json'),
            mentionLogs: path.join(this.dataDir, 'mention_logs.json'),
            starboardConfigs: path.join(this.dataDir, 'starboard_configs.json'),
            customCommands: path.join(this.dataDir, 'custom_commands.json'),
            reminders: path.join(this.dataDir, 'reminders.json'),
            userReminders: path.join(this.dataDir, 'user_reminders.json'),
            autoReactions: path.join(this.dataDir, 'auto_reactions.json'),
            antidoxxData: path.join(this.dataDir, 'antidoxx_data.json'),
            quarantineRecords: path.join(this.dataDir, 'quarantine_records.json')
        };
    }

    /**
     * Ensure the data directory exists
     */
    ensureDataDirectory() {
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
            console.log(`✅ Created data directory at ${this.dataDir}`);
        }
    }

    /**
     * Save data to a file
     * @param {string} fileKey - Key of the file in this.files
     * @param {any} data - Data to save
     */
    saveData(fileKey, data) {
        try {
            const filePath = this.files[fileKey];
            if (!filePath) {
                throw new Error(`Unknown file key: ${fileKey}`);
            }

            // Convert Map to serializable format if needed
            let serializedData = data;
            
            if (data instanceof Map) {
                serializedData = this._mapToObject(data);
            }

            fs.writeFileSync(filePath, JSON.stringify(serializedData, null, 2));
            return true;
        } catch (error) {
            console.error(`Error saving ${fileKey} data:`, error);
            return false;
        }
    }

    /**
     * Load data from a file
     * @param {string} fileKey - Key of the file in this.files
     * @param {boolean} asMap - Whether to convert the loaded data to a Map
     * @returns {any} Loaded data or empty object/map if file doesn't exist
     */
    loadData(fileKey, asMap = false) {
        try {
            const filePath = this.files[fileKey];
            if (!filePath) {
                throw new Error(`Unknown file key: ${fileKey}`);
            }

            if (fs.existsSync(filePath)) {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                return asMap ? this._objectToMap(data) : data;
            }
        } catch (error) {
            console.error(`Error loading ${fileKey} data:`, error);
        }
        
        return asMap ? new Map() : {};
    }

    /**
     * Save all bot data
     * @param {Object} data - Object containing all data to save
     */
    saveAllData(data) {
        try {
            this.saveData('afkUsers', data.afkUsers);
            this.saveData('mentionLogs', data.mentionLogs);
            this.saveData('starboardConfigs', data.starboardConfigs);
            this.saveData('customCommands', data.customCommands);
            this.saveData('reminders', data.reminders);
            this.saveData('userReminders', data.userReminders);
            this.saveData('autoReactions', data.autoReactions);
            this.saveData('antidoxxData', data.antidoxxData);
            this.saveData('quarantineRecords', data.quarantineRecords);
            console.log('✅ All data saved successfully');
            return true;
        } catch (error) {
            console.error('Error saving all data:', error);
            return false;
        }
    }

    /**
     * Load all bot data
     * @returns {Object} Object containing all loaded data
     */
    loadAllData() {
        try {
            const data = {
                afkUsers: this.loadData('afkUsers', true),
                mentionLogs: this.loadData('mentionLogs', true),
                starboardConfigs: this.loadData('starboardConfigs', true),
                customCommands: this.loadData('customCommands', true),
                reminders: this.loadData('reminders', true),
                userReminders: this.loadData('userReminders', true),
                autoReactions: this.loadData('autoReactions', true),
                antidoxxData: this.loadData('antidoxxData', true),
                quarantineRecords: this.loadData('quarantineRecords', true)
            };
            console.log('✅ All data loaded successfully');
            return data;
        } catch (error) {
            console.error('Error loading all data:', error);
            return {
                afkUsers: new Map(),
                mentionLogs: new Map(),
                starboardConfigs: new Map(),
                customCommands: new Map(),
                reminders: new Map(),
                userReminders: new Map(),
                autoReactions: new Map(),
                antidoxxData: new Map(),
                quarantineRecords: new Map()
            };
        }
    }

    /**
     * Convert a Map to a serializable object
     * @param {Map} map - Map to convert
     * @returns {Object} Serializable object
     * @private
     */
    _mapToObject(map) {
        const obj = {};
        
        for (const [key, value] of map.entries()) {
            obj[key] = this._valueToSerializable(value);
        }
        
        return obj;
    }
    
    /**
     * Convert any value to a serializable format
     * @param {any} value - Value to convert
     * @returns {any} Serializable value
     * @private
     */
    _valueToSerializable(value) {
        if (value instanceof Map) {
            return {
                __type: 'Map',
                data: this._mapToObject(value)
            };
        } else if (value instanceof Set) {
            return {
                __type: 'Set',
                data: Array.from(value)
            };
        } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            // Handle regular objects that might contain Maps or Sets
            const obj = {};
            for (const key in value) {
                obj[key] = this._valueToSerializable(value[key]);
            }
            return obj;
        } else {
            return value;
        }
    }

    /**
     * Convert an object to a Map
     * @param {Object} obj - Object to convert
     * @returns {Map} Converted Map
     * @private
     */
    _objectToMap(obj) {
        const map = new Map();
        
        for (const key in obj) {
            map.set(key, this._valueFromSerialized(obj[key]));
        }
        
        return map;
    }
    
    /**
     * Convert a serialized value back to its original type
     * @param {any} value - Serialized value
     * @returns {any} Original value
     * @private
     */
    _valueFromSerialized(value) {
        if (value !== null && typeof value === 'object' && value.__type) {
            if (value.__type === 'Map') {
                return this._objectToMap(value.data);
            } else if (value.__type === 'Set') {
                return new Set(value.data);
            }
        } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            // Handle regular objects that might contain serialized Maps or Sets
            const obj = {};
            for (const key in value) {
                obj[key] = this._valueFromSerialized(value[key]);
            }
            return obj;
        }
        
        return value;
    }
}

module.exports = new DataStorage();