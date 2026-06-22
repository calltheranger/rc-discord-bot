"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const discord_js_1 = require("discord.js");
const node_cron_1 = __importDefault(require("node-cron"));
const dotenv_1 = __importDefault(require("dotenv"));
const summarizer_1 = require("./summarizer");
dotenv_1.default.config();
const client = new discord_js_1.Client({
    intents: [
        discord_js_1.GatewayIntentBits.Guilds,
        discord_js_1.GatewayIntentBits.GuildMessages,
        discord_js_1.GatewayIntentBits.MessageContent,
    ],
});
client.once(discord_js_1.Events.ClientReady, async (c) => {
    console.log(`Ready! Logged in as ${c.user.tag}`);
    const timezone = process.env.SUMMARY_TIMEZONE || 'America/New_York';
    // Run at 00:00 every day
    node_cron_1.default.schedule('0 0 * * *', async () => {
        console.log('Running daily channel summarization...');
        await (0, summarizer_1.executeDailySummary)(client);
    }, {
        timezone: timezone
    });
    console.log(`Daily summary scheduler started (Timezone: ${timezone})`);
});
// Setup a command to force the summary for testing
client.on(discord_js_1.Events.MessageCreate, async (message) => {
    // Only allow server admins to trigger this via a specific command in the chat
    if (message.content === '!forcesummary' && message.member?.permissions.has('Administrator')) {
        await message.reply('⏳ Initiating daily summary generation...');
        try {
            await (0, summarizer_1.executeDailySummary)(client, message.channelId);
        }
        catch (e) {
            console.error(e);
            await message.reply('❌ Failed to generate summary. Check console logs.');
        }
    }
});
client.login(process.env.DISCORD_TOKEN);
//# sourceMappingURL=index.js.map