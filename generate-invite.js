require('dotenv').config();

const CLIENT_ID = process.env.CLIENT_ID || 'YOUR_CLIENT_ID_HERE';

console.log('🔗 Discord Bot Invite Link Generator');
console.log('=====================================\n');

// Define all permissions your bot needs
const permissions = [
    'ViewChannel',           // View channels
    'SendMessages',          // Send messages
    'ManageMessages',        // Delete messages, pin messages
    'EmbedLinks',           // Embed links in messages
    'AttachFiles',          // Attach files to messages
    'ReadMessageHistory',   // Read message history
    'AddReactions',         // Add reactions to messages
    'UseExternalEmojis',    // Use external emojis
    'ManageRoles',          // Manage roles (for mute/quarantine)
    'ManageChannels',       // Manage channels (for viewlock)
    'KickMembers',          // Kick members
    'BanMembers',           // Ban members
    'ModerateMembers',      // Timeout members (Discord's built-in timeout)
    'ManageNicknames',      // Change others' nicknames (for freeze nick)
    'ManageWebhooks',       // Manage webhooks (optional)
    'ViewAuditLog',         // View audit log (for moderation tracking)
];

// Permission bit values from Discord API
const permissionBits = {
    ViewChannel: 1024n,
    SendMessages: 2048n,
    ManageMessages: 8192n,
    EmbedLinks: 16384n,
    AttachFiles: 32768n,
    ReadMessageHistory: 65536n,
    AddReactions: 64n,
    UseExternalEmojis: 262144n,
    ManageRoles: 268435456n,
    ManageChannels: 16n,
    KickMembers: 2n,
    BanMembers: 4n,
    ModerateMembers: 1099511627776n,
    ManageNicknames: 134217728n,
    ManageWebhooks: 536870912n,
    ViewAuditLog: 128n,
    Administrator: 8n, // Optional: uncomment if you want full admin
};

// Calculate total permissions value
let totalPermissions = 0n;
for (const permission of permissions) {
    if (permissionBits[permission]) {
        totalPermissions |= permissionBits[permission];
    }
}

// Generate invite links
const inviteLink = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&permissions=${totalPermissions}&scope=bot%20applications.commands`;
const adminLink = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&permissions=${permissionBits.Administrator}&scope=bot%20applications.commands`;

console.log('✅ Invite Link (Recommended Permissions):');
console.log(inviteLink);
console.log('\n📋 Permissions included:');
permissions.forEach(perm => console.log(`   - ${perm}`));

console.log('\n⚠️  Administrator Link (Full Access - Use with Caution):');
console.log(adminLink);

console.log('\n📝 Instructions:');
console.log('1. Copy one of the links above');
console.log('2. Paste it in your browser');
console.log('3. Select the server you want to add the bot to');
console.log('4. Authorize the permissions');
console.log('5. Complete the CAPTCHA if prompted');

console.log('\n💡 Tips:');
console.log('- Use the recommended link for better security');
console.log('- The bot needs "Manage Roles" to create Muted/Quarantined roles');
console.log('- The bot needs "Manage Nicknames" for the freeze nick feature');
console.log('- Make sure the bot\'s role is ABOVE the roles it needs to manage');

console.log('\n🔒 Security Note:');
console.log('The Administrator permission gives the bot full access to your server.');
console.log('Only use it if you fully trust the bot and understand the implications.');

console.log('\n=====================================');
console.log('💚 Generated successfully!');

// Also save to a file
const fs = require('fs');
const inviteContent = `
Discord Bot Invite Links
========================

CLIENT_ID: ${CLIENT_ID}

Recommended Invite Link (Specific Permissions):
${inviteLink}

Permissions Included:
${permissions.map(p => `- ${p}`).join('\n')}

Administrator Invite Link (Full Access):
${adminLink}

Generated: ${new Date().toLocaleString()}
`;

fs.writeFileSync('INVITE_LINKS.txt', inviteContent.trim());
console.log('💾 Links saved to INVITE_LINKS.txt');