import { Client, GatewayIntentBits, Events } from 'discord.js';
import dotenv from 'dotenv';
import { database } from './database/db';
import { startPolling } from './services/polling';
import { registerCommands } from './commands';

dotenv.config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
    ],
});

client.once(Events.ClientReady, async (c) => {
    console.log(`Ready! Logged in as ${c.user.tag}`);

    // Initialize Database
    database.init();

    // Register Commands
    await registerCommands(client);

    // Start Polling
    startPolling(client);
});

client.login(process.env.DISCORD_TOKEN);
