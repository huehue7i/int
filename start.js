#!/usr/bin/env node

/**
 * Discord Bot Startup Script
 * This script handles the complete deployment and startup process
 */

const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const CONFIG = {
    envFile: '.env',
    deployScript: 'deploy-commands.js',
    mainScript: 'main.js',
    packageFile: 'package.json'
};

// Colors for console output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function logStep(step, message) {
    log(`[${step}] ${message}`, 'cyan');
}

function logSuccess(message) {
    log(`✅ ${message}`, 'green');
}

function logError(message) {
    log(`❌ ${message}`, 'red');
}

function logWarning(message) {
    log(`⚠️  ${message}`, 'yellow');
}

// Check if required files exist
function checkRequiredFiles() {
    logStep('SETUP', 'Checking required files...');
    
    const requiredFiles = [
        CONFIG.envFile,
        CONFIG.deployScript,
        CONFIG.mainScript,
        CONFIG.packageFile
    ];
    
    const missingFiles = requiredFiles.filter(file => !fs.existsSync(file));
    
    if (missingFiles.length > 0) {
        logError(`Missing required files: ${missingFiles.join(', ')}`);
        return false;
    }
    
    logSuccess('All required files found');
    return true;
}

// Check environment variables
function checkEnvironment() {
    logStep('ENV', 'Checking environment configuration...');
    
    if (!fs.existsSync(CONFIG.envFile)) {
        logError('.env file not found');
        return false;
    }
    
    const envContent = fs.readFileSync(CONFIG.envFile, 'utf8');
    const requiredVars = ['TOKEN', 'CLIENT_ID']; // Changed from DISCORD_TOKEN to TOKEN
    const missingVars = [];
    
    requiredVars.forEach(varName => {
        // Check if variable exists and has a value (not just placeholder)
        const varMatch = envContent.match(new RegExp(`^${varName}=(.+)$`, 'm'));
        if (!varMatch || !varMatch[1] || varMatch[1].startsWith('your_') || varMatch[1].startsWith('YOUR_')) {
            missingVars.push(varName);
        }
    });
    
    if (missingVars.length > 0) {
        logError(`Missing or incomplete environment variables: ${missingVars.join(', ')}`);
        logWarning('Please update your .env file with actual values');
        logWarning('Example:');
        logWarning('  TOKEN=your_actual_discord_bot_token');
        logWarning('  CLIENT_ID=your_actual_client_id');
        return false;
    }
    
    // Check for optional but recommended variables
    const optionalVars = ['AUTHORIZED_USERS', 'AUTHORIZED_GUILDS'];
    const missingOptional = [];

    optionalVars.forEach(varName => {
        const varMatch = envContent.match(new RegExp(`^${varName}=(.*)$`, 'm'));
        if (!varMatch || !varMatch[1]) {
            missingOptional.push(varName);
        }
    });

    if (missingOptional.length > 0) {
        logWarning(`Optional environment variables not set: ${missingOptional.join(', ')}`);
        logWarning('These are not required but recommended for security');
    }

    logSuccess('Environment configuration is valid');
    return true;
}

// Install dependencies
function installDependencies() {
    return new Promise((resolve, reject) => {
        logStep('DEPS', 'Installing dependencies...');
        
        // Try different npm commands for Windows compatibility
        const npmCommands = ['npm', 'npm.cmd', 'npm.exe'];
        let npmCommand = 'npm';
        
        // Check if npm is available
        exec('where npm', (error, stdout, stderr) => {
            if (error) {
                // Try npm.cmd for Windows
                exec('where npm.cmd', (error2, stdout2, stderr2) => {
                    if (error2) {
                        logWarning('npm not found in PATH. Skipping dependency installation.');
                        logWarning('Please run "npm install" manually before starting the bot.');
                        resolve(); // Continue without installing
                        return;
                    } else {
                        npmCommand = 'npm.cmd';
                    }
                    runNpmInstall();
                });
            } else {
                runNpmInstall();
            }
        });
        
        function runNpmInstall() {
            const npm = spawn(npmCommand, ['install'], { 
                stdio: 'pipe',
                shell: true // Use shell for Windows compatibility
            });
            
            npm.stdout.on('data', (data) => {
                // Only log important npm messages
                const output = data.toString();
                if (output.includes('added') || output.includes('updated') || output.includes('audited')) {
                    log(output.trim(), 'blue');
                }
            });
            
            npm.stderr.on('data', (data) => {
                const error = data.toString();
                if (!error.includes('npm WARN')) {
                    log(error.trim(), 'red');
                }
            });
            
            npm.on('close', (code) => {
                if (code === 0) {
                    logSuccess('Dependencies installed successfully');
                    resolve();
                } else {
                    logError(`npm install failed with code ${code}`);
                    logWarning('Please run "npm install" manually');
                    resolve(); // Continue anyway
                }
            });
            
            npm.on('error', (error) => {
                logWarning(`npm install failed: ${error.message}`);
                logWarning('Please run "npm install" manually');
                resolve(); // Continue anyway
            });
        }
    });
}

// Deploy slash commands
function deployCommands() {
    return new Promise((resolve, reject) => {
        logStep('DEPLOY', 'Deploying slash commands...');
        
        const deploy = spawn('node', [CONFIG.deployScript], { 
            stdio: 'pipe',
            shell: true // Use shell for Windows compatibility
        });
        
        deploy.stdout.on('data', (data) => {
            log(data.toString().trim(), 'blue');
        });
        
        deploy.stderr.on('data', (data) => {
            log(data.toString().trim(), 'red');
        });
        
        deploy.on('close', (code) => {
            if (code === 0) {
                logSuccess('Slash commands deployed successfully');
                resolve();
            } else {
                logError(`Command deployment failed with code ${code}`);
                reject(new Error(`Command deployment failed`));
            }
        });
        
        deploy.on('error', (error) => {
            logError(`Command deployment failed: ${error.message}`);
            reject(new Error(`Command deployment failed`));
        });
    });
}

// Start the bot
function startBot() {
    return new Promise((resolve, reject) => {
        logStep('START', 'Starting Discord bot...');
        
        const bot = spawn('node', [CONFIG.mainScript], { 
            stdio: 'inherit',
            shell: true // Use shell for Windows compatibility
        });
        
        bot.on('close', (code) => {
            if (code === 0) {
                logSuccess('Bot stopped gracefully');
                resolve();
            } else {
                logError(`Bot exited with code ${code}`);
                reject(new Error(`Bot failed`));
            }
        });
        
        bot.on('error', (error) => {
            logError(`Bot failed to start: ${error.message}`);
            reject(new Error(`Bot failed to start`));
        });
        
        // Handle graceful shutdown
        process.on('SIGINT', () => {
            log('\n🛑 Received SIGINT, shutting down gracefully...', 'yellow');
            bot.kill('SIGINT');
        });
        
        process.on('SIGTERM', () => {
            log('\n🛑 Received SIGTERM, shutting down gracefully...', 'yellow');
            bot.kill('SIGTERM');
        });
    });
}

// Main startup function
async function startup() {
    log('🤖 Discord Moderation Bot Startup Script', 'bright');
    log('=========================================', 'bright');
    
    try {
        // Step 1: Check files
        if (!checkRequiredFiles()) {
            process.exit(1);
        }
        
        // Step 2: Check environment
        if (!checkEnvironment()) {
            process.exit(1);
        }
        
        // Step 3: Install dependencies
        await installDependencies();
        
        // Step 4: Deploy commands
        await deployCommands();
        
        // Step 5: Start bot
        log('\n🚀 Starting bot...', 'green');
        log('Press Ctrl+C to stop the bot\n', 'yellow');
        
        await startBot();
        
    } catch (error) {
        logError(`Startup failed: ${error.message}`);
        process.exit(1);
    }
}

// Handle command line arguments
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
    log('Discord Bot Startup Script', 'bright');
    log('Usage: node start.js [options]', 'cyan');
    log('\nOptions:', 'bright');
    log('  --skip-deps    Skip dependency installation', 'blue');
    log('  --skip-deploy  Skip command deployment', 'blue');
    log('  --help, -h     Show this help message', 'blue');
    log('\nFiles required:', 'bright');
    log('  - .env (with TOKEN and CLIENT_ID)', 'blue');
    log('  - deploy-commands.js', 'blue');
    log('  - main.js', 'blue');
    log('  - package.json', 'blue');
    process.exit(0);
}

// Modified startup with options
async function startupWithOptions() {
    log('🤖 Discord Moderation Bot Startup Script', 'bright');
    log('=========================================', 'bright');
    
    try {
        // Step 1: Check files
        if (!checkRequiredFiles()) {
            process.exit(1);
        }
        
        // Step 2: Check environment
        if (!checkEnvironment()) {
            process.exit(1);
        }
        
        // Step 3: Install dependencies (optional)
        if (!args.includes('--skip-deps')) {
            await installDependencies();
        } else {
            logWarning('Skipping dependency installation');
        }
        
        // Step 4: Deploy commands (optional)
        if (!args.includes('--skip-deploy')) {
            await deployCommands();
        } else {
            logWarning('Skipping command deployment');
        }
        
        // Step 5: Start bot
        log('\n🚀 Starting bot...', 'green');
        log('Press Ctrl+C to stop the bot\n', 'yellow');
        
        await startBot();
        
    } catch (error) {
        logError(`Startup failed: ${error.message}`);
        process.exit(1);
    }
}

// Run the startup
if (require.main === module) {
    startupWithOptions();
}

module.exports = { startup, startupWithOptions };
