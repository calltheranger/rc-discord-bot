import { REST, Routes, Client, SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { database } from '../database/db';
import { scraper, getYearFromMusicBrainz } from '../services/scraper';
import { getAlbumSource } from '../services/polling';
import { importLists } from '../scripts/import_lists';
import { formatStars } from '../utils/format';

const commands = [
    // ... (rest of commands unchanged)
    new SlashCommandBuilder()
        .setName('link')
        .setDescription('Add a Record Club username to the tracking list')
        .addStringOption(option =>
            option.setName('username')
                .setDescription('The Record Club username')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('unlink')
        .setDescription('Remove a Record Club username from the tracking list')
        .addStringOption(option =>
            option.setName('username')
                .setDescription('The Record Club username')
                .setRequired(true)),
    new SlashCommandBuilder()
        .setName('setchannel')
        .setDescription('Set the channel for review notifications')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption(option =>
            option.setName('type')
                .setDescription('Channel type: general (default), 1001, or latam')
                .setRequired(false)
                .addChoices(
                    { name: 'General Reviews', value: 'general' },
                    { name: '1001 Albums', value: '1001' },
                    { name: '600 Latam Albums', value: 'latam' }
                )
        ),
    new SlashCommandBuilder()
        .setName('latest')
        .setDescription('Get the latest review for you or a specific user')
        .addStringOption(option =>
            option.setName('username')
                .setDescription('Record Club username (optional)')),
    new SlashCommandBuilder()
        .setName('sync')
        .setDescription('Manually trigger an update of the album lists (1001 & Latam)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
];

export const registerCommands = async (client: Client) => {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!);

    try {
        console.log('Started refreshing application (/) commands.');

        if (process.env.GUILD_ID) {
            await rest.put(
                Routes.applicationGuildCommands(client.user!.id, process.env.GUILD_ID),
                { body: commands },
            );
        } else {
            await rest.put(
                Routes.applicationCommands(client.user!.id),
                { body: commands },
            );
        }

        console.log('Successfully reloaded application (/) commands.');

        // Set up interaction handler
        client.on('interactionCreate', async interaction => {
            if (!interaction.isChatInputCommand()) return;
            await handleCommand(interaction);
        });

    } catch (error) {
        console.error(error);
    }
};



const handleCommand = async (interaction: ChatInputCommandInteraction) => {
    const { commandName } = interaction;

    if (commandName === 'link') {
        const username = interaction.options.getString('username', true);
        await interaction.deferReply();
        const reviews = await scraper.getRecentReviews(username);

        if (reviews.length > 0) {
            const latestReview = reviews[0];
            database.getDb().prepare(`
            INSERT OR REPLACE INTO users (record_club_username, discord_id, last_review_url, last_checked_at)
            VALUES (?, ?, ?, ?)
        `).run(username, interaction.user.id, latestReview.reviewUrl, Date.now());

            // Auto-initialize guild settings if they don't exist
            const settings = database.getDb().prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(interaction.guildId) as any;
            if (!settings) {
                database.getDb().prepare(`
                    INSERT INTO guild_settings (guild_id, notification_channel_id)
                    VALUES (?, ?)
                `).run(interaction.guildId, interaction.channelId);
                await interaction.editReply(`Now tracking **${username}** and set <#${interaction.channelId}> as the default notification channel!`);
            } else {
                await interaction.editReply(`Now tracking **${username}**! Reviews will be posted automatically.`);
            }
        } else {
            await interaction.editReply(`Could not find reviews for **${username}**. Please check the username on Record Club.`);
        }
    }

    if (commandName === 'unlink') {
        const username = interaction.options.getString('username', true);
        const result = database.getDb().prepare('DELETE FROM users WHERE record_club_username = ?').run(username);

        if (result.changes > 0) {
            await interaction.reply(`Stopped tracking **${username}**.`);
        } else {
            await interaction.reply(`**${username}** was not in the tracking list.`);
        }
    }

    if (commandName === 'setchannel') {
        if (!interaction.guildId) {
            await interaction.reply('This command can only be used in a server.');
            return;
        }
        const type = interaction.options.getString('type') || 'general';

        if (type === '1001') {
            const result = database.getDb().prepare(`
                UPDATE guild_settings SET channel_1001_id = ? WHERE guild_id = ?
            `).run(interaction.channelId, interaction.guildId);

            // Ensure guild exists
            if (result.changes === 0) {
                database.getDb().prepare(`
                    INSERT INTO guild_settings (guild_id, notification_channel_id, channel_1001_id)
                    VALUES (?, NULL, ?)
                `).run(interaction.guildId, interaction.channelId);
            }
            await interaction.reply(`Set <#${interaction.channelId}> as the **1001 Albums** notification channel.`);
        } else if (type === 'latam') {
            const result = database.getDb().prepare(`
                UPDATE guild_settings SET channel_latam_id = ? WHERE guild_id = ?
            `).run(interaction.channelId, interaction.guildId);

            if (result.changes === 0) {
                database.getDb().prepare(`
                    INSERT INTO guild_settings (guild_id, notification_channel_id, channel_latam_id)
                    VALUES (?, NULL, ?)
                `).run(interaction.guildId, interaction.channelId);
            }
            await interaction.reply(`Set <#${interaction.channelId}> as the **600 Discos Latinoamérica** notification channel.`);

        } else {
            database.getDb().prepare(`
            INSERT OR REPLACE INTO guild_settings (guild_id, notification_channel_id, channel_1001_id, channel_latam_id)
            VALUES (?, ?, 
                (SELECT channel_1001_id FROM guild_settings WHERE guild_id = ?),
                (SELECT channel_latam_id FROM guild_settings WHERE guild_id = ?)
            )
        `).run(interaction.guildId, interaction.channelId, interaction.guildId, interaction.guildId);
            await interaction.reply(`Set <#${interaction.channelId}> as the **General** review notification channel.`);
        }
    }

    if (commandName === 'latest') {
        await interaction.deferReply();
        let username = interaction.options.getString('username');

        if (!username) {
            const user = database.getDb().prepare('SELECT record_club_username FROM users WHERE discord_id = ?').get(interaction.user.id) as { record_club_username: string };
            if (user) {
                username = user.record_club_username;
            } else {
                // Return the very first user in the system if this user isn't specificially linked
                const firstUser = database.getDb().prepare('SELECT record_club_username FROM users LIMIT 1').get() as { record_club_username: string };
                if (firstUser) {
                    username = firstUser.record_club_username;
                } else {
                    await interaction.editReply('No users are being tracked! Use `/link <username>` to get started.');
                    return;
                }
            }
        }

        const reviews = await scraper.getRecentReviews(username);
        if (reviews.length === 0) {
            await interaction.editReply(`No reviews found for **${username}**.`);
            return;
        }
        const review = reviews[0];

        // Fetch year if missing
        if (!review.releaseYear) {
            review.releaseYear = await getYearFromMusicBrainz(review.artistName, review.albumTitle);
        }

        const stars = formatStars(review.rating);
        const yearStr = review.releaseYear ? ` (${review.releaseYear})` : '';
        const source = getAlbumSource(review.albumTitle, review.artistName);

        let color = 0x0099FF; // Blue (Default)
        let footerText = '💿 Record Club Review';

        if (source === '1001') {
            color = 0xFFD700; // Gold
            footerText = '📀 1001 Albums List';
        } else if (source === 'latam') {
            color = 0xFF5733; // Orange-Red
            footerText = '🌎 600 Discos Latinoamérica';
        }

        const separator1 = '┈┈┈┈┈';

        const embed = new EmbedBuilder()
            .setColor(color)
            .setAuthor({
                name: `${review.username} reviewed...`,
                iconURL: review.userAvatar
            })
            .setTitle(`${review.artistName}\n**${review.albumTitle}**${yearStr}`)
            .setURL(review.reviewUrl)
            .setDescription(`${stars}\n${separator1}\n${review.reviewText || 'No review text.'}`)
            .setFooter({ text: footerText })
            .setTimestamp(review.timestamp);

        if (review.imageUrl) {
            embed.setThumbnail(review.imageUrl);
        }

        await interaction.editReply({ embeds: [embed] });
    }

    if (commandName === 'sync') {
        await interaction.deferReply();
        try {
            await importLists();
            await interaction.editReply('Successfully synced all album lists (1001 & Latam)!');
        } catch (e) {
            console.error(e);
            await interaction.editReply('Failed to sync the album lists. Check logs.');
        }
    }
};
