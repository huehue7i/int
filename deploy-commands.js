require('dotenv').config();
const { REST, Routes } = require('discord.js');

const { commands } = require('./main.js');

const rest = new REST().setToken(process.env.TOKEN);

async function deployCommands() {
    try {
        console.log('🚀 Started refreshing application (/) commands.');

        const commandData = commands.map(command => command.toJSON());

        console.log(`📋 Found ${commandData.length} commands to register:`);
        commandData.forEach(cmd => {
            console.log(`   /${cmd.name} - ${cmd.description}`);
        });

        const data = await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commandData },
        );

        console.log(`✅ Successfully reloaded ${data.length} application (/) commands.`);
        console.log('🎉 Commands deployed successfully!');

    } catch (error) {
        console.error('❌ Error deploying commands:', error);

        if (error.code === 50001) {
            console.error('Missing Access - Check your bot permissions');
        } else if (error.code === 10002) {
            console.error('Unknown Application - Check your CLIENT_ID');
        } else if (error.code === 50035) {
            console.error('Invalid Form Body - Check your command structure');
        }

        process.exit(1);
    }
}

deployCommands();
