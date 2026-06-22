import { Client, GatewayIntentBits, Events } from 'discord.js';
import cron from 'node-cron';
import dotenv from 'dotenv';
import { executeDailySummary } from './summarizer';

dotenv.config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

client.once(Events.ClientReady, async (c) => {
    console.log(`Ready! Logged in as ${c.user.tag}`);

    const timezone = process.env.SUMMARY_TIMEZONE || 'America/New_York';

    // Run at 00:00 every day
    cron.schedule('0 0 * * *', async () => {
        console.log('Running daily channel summarization...');
        await executeDailySummary(client);
    }, {
        timezone: timezone
    });

    console.log(`Daily summary scheduler started (Timezone: ${timezone})`);
});

// Setup a command to force the summary for testing
client.on(Events.MessageCreate, async (message) => {
    // Only allow server admins to trigger this via a specific command in the chat
    if (message.content === '!forcesummary' && message.member?.permissions.has('Administrator')) {
        await message.reply('⏳ Initiating daily summary generation...');
        try {
            await executeDailySummary(client, message.channelId);
        } catch (e) {
            console.error(e);
            await message.reply('❌ Failed to generate summary. Check console logs.');
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
