import { Client, TextChannel, EmbedBuilder } from 'discord.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

export interface ChannelHistory {
    channelName: string;
    messages: string[];
}

export const getDailyHistory = async (client: Client): Promise<ChannelHistory[]> => {
    const history: ChannelHistory[] = [];
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

    // Get all text channels the bot has access to
    const channels = client.channels.cache.filter(c => c.isTextBased()) as Map<string, TextChannel>;

    for (const [id, channel] of channels) {
        try {
            if (!channel.viewable) continue;

            let lastId: string | undefined = undefined;
            const channelMessages: string[] = [];
            let keepFetching = true;

            // Fetch messages in batches of 100
            while (keepFetching) {
                const options: { limit: number; before?: string } = { limit: 100 };
                if (lastId) options.before = lastId;

                const messages = await channel.messages.fetch(options);
                if (messages.size === 0) break;

                for (const [msgId, msg] of messages) {
                    if (msg.createdTimestamp < oneDayAgo) {
                        keepFetching = false;
                        break;
                    }

                    if (!msg.author.bot && !msg.system && msg.content.trim() !== '') {
                        const timeStr = new Date(msg.createdTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        channelMessages.push(`[${timeStr}] ${msg.author.username}: ${msg.content}`);
                    }
                }

                lastId = messages.last()?.id;
            }

            if (channelMessages.length > 0) {
                history.push({
                    channelName: channel.name,
                    messages: channelMessages.reverse()
                });
            }
        } catch (error) {
            console.error(`Failed to fetch history for channel ${channel.name}:`, error);
        }
    }

    return history;
};

export const summarizeDailyHistory = async (history: ChannelHistory[]): Promise<string> => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY is not set in the environment variables.');
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    let finalSummary = '';
    const channelSummaries: string[] = [];

    // Summarize each channel individually
    for (const ch of history) {
        if (ch.messages.length === 0) continue;

        const transcript = ch.messages.join('\n');
        
        if (ch.messages.length < 5) {
            channelSummaries.push(`### #${ch.channelName}\nNot much activity. People discussed: \n${transcript.substring(0, 200)}...`);
            continue;
        }

        const prompt = `You are a helpful Discord bot. Please summarize the following daily chat transcript from the channel #${ch.channelName}. 
Extract the main topics, interesting highlights, or important decisions. Keep it concise, engaging, and in bullet points if applicable.

Transcript:
${transcript}

Summary:`;

        try {
            const result = await model.generateContent(prompt);
            const response = await result.response;
            channelSummaries.push(`### #${ch.channelName}\n${response.text()}`);
        } catch (error) {
            console.error(`Failed to summarize channel ${ch.channelName}:`, error);
        }
    }

    if (channelSummaries.length === 0) {
        return "No significant activity was recorded today.";
    }

    // Generate final executive summary
    const combinedSummaries = channelSummaries.join('\n\n');
    const finalPrompt = `You are a helpful community manager bot for a Discord server. 
I am going to provide you with a list of summaries of today's activity across various channels. 
Please create a final, unified "Daily Highlights" report. 

Format the output nicely using Markdown, making it easy to read in Discord. Include a catchy intro, group related topics if possible, and highlight the most active or interesting discussions.

Channel Summaries:
${combinedSummaries}

Final Report:`;

    try {
        const result = await model.generateContent(finalPrompt);
        const response = await result.response;
        finalSummary = response.text();
    } catch (error) {
        console.error('Failed to generate final summary:', error);
        finalSummary = "Failed to generate the final summary due to an error.";
    }

    return finalSummary;
};

export const executeDailySummary = async (client: Client, overrideChannelId?: string) => {
    try {
        const channelId = overrideChannelId || process.env.SUMMARY_CHANNEL_ID;
        if (!channelId) {
            console.error('SUMMARY_CHANNEL_ID is not set. Skipping daily summary.');
            return;
        }

        const targetChannel = await client.channels.fetch(channelId).catch(() => null);
        if (!targetChannel || !targetChannel.isTextBased()) {
            console.error(`Target summary channel ${channelId} not found or is not a text channel.`);
            return;
        }

        const tc = targetChannel as TextChannel;
        const history = await getDailyHistory(client);
        
        if (history.length === 0) {
             if (overrideChannelId) await tc.send("No activity recorded in the last 24 hours.");
             return;
        }

        const summaryMarkdown = await summarizeDailyHistory(history);
        const chunks = splitMessage(summaryMarkdown, 2000);
        const embedColor = 0x9B59B6; // Purple

        for (let i = 0; i < chunks.length; i++) {
            const embed = new EmbedBuilder()
                .setColor(embedColor)
                .setDescription(chunks[i] || "Empty chunk");

            if (i === 0) embed.setTitle('📅 Daily Server Highlights');
            if (i === chunks.length - 1) {
                embed.setFooter({ text: 'Generated by Gemini AI • See you tomorrow!' }).setTimestamp();
            }

            await tc.send({ embeds: [embed] });
        }
    } catch (error) {
        console.error('Error executing daily summary:', error);
    }
};

const splitMessage = (text: string, maxLength: number): string[] => {
    if (text.length <= maxLength) return [text];
    const chunks: string[] = [];
    let currentChunk = '';
    const lines = text.split('\n');
    for (const line of lines) {
        if (currentChunk.length + line.length + 1 > maxLength) {
            if (currentChunk.length > 0) {
                chunks.push(currentChunk);
                currentChunk = '';
            }
            if (line.length > maxLength) {
                 const subChunks = line.match(new RegExp(`.{1,${maxLength}}`, 'g')) || [];
                 chunks.push(...subChunks.slice(0, subChunks.length - 1));
                 currentChunk = subChunks[subChunks.length - 1] + '\n';
            } else {
                 currentChunk = line + '\n';
            }
        } else {
            currentChunk += line + '\n';
        }
    }
    if (currentChunk.trim().length > 0) chunks.push(currentChunk.trim());
    return chunks;
};
