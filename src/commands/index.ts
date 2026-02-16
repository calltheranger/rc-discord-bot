import { REST, Routes, Client, SlashCommandBuilder, ChatInputCommandInteraction, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { database } from '../database/db';
import { scraper } from '../services/scraper';
import { importLists } from '../scripts/import_lists';
import { formatStars } from '../utils/format';

const commands = [
    // ... (rest of commands unchanged)
    new SlashCommandBuilder()
        .setName('link')
        .setDescription('Link a Discord account to a Record Club username')
        .addStringOption(option =>
            option.setName('username')
                .setDescription('The Record Club username')
                .setRequired(true))
        .addUserOption(option =>
            option.setName('user')
                .setDescription('The Discord user to link (defaults to you)')
                .setRequired(false)),
    new SlashCommandBuilder()
        .setName('unlink')
        .setDescription('Unlink your Record Club username'),
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

const getAlbumSource = (title: string, artist: string): string | null => {
    const db = database.getDb();

    // Attempt to match both title and artist case-insensitively
    const matches = db.prepare(`
        SELECT source FROM tracked_albums 
        WHERE title = ? COLLATE NOCASE AND artist = ? COLLATE NOCASE
    `).all(title, artist) as { source: string }[];

    if (matches.length > 0) {
        return matches[0].source;
    }

    // Fallback: If no exact title+artist match, try title ONLY (some Record Club entries vary in artist spelling)
    const titleOnlyMatches = db.prepare(`
        SELECT source FROM tracked_albums 
        WHERE title = ? COLLATE NOCASE
    `).all(title) as { source: string }[];

    if (titleOnlyMatches.length > 0) {
        return titleOnlyMatches[0].source;
    }

    return null;
};

const handleCommand = async (interaction: ChatInputCommandInteraction) => {
    const { commandName } = interaction;

    if (commandName === 'link') {
        const username = interaction.options.getString('username', true);
        const targetUser = interaction.options.getUser('user') || interaction.user;
        await interaction.deferReply();
        const review = await scraper.getLatestReview(username);

        if (review) {
            database.getDb().prepare(`
            INSERT OR REPLACE INTO users (discord_id, record_club_username, last_review_url, last_checked_at)
            VALUES (?, ?, ?, ?)
        `).run(targetUser.id, username, review.reviewUrl, Date.now());

            await interaction.editReply(`Linked **${username}** to <@${targetUser.id}>! I'll notify when new reviews drop.`);
        } else {
            await interaction.editReply(`Could not find reviews for **${username}**. Please check the username on Record Club.`);
        }
    }

    if (commandName === 'unlink') {
        database.getDb().prepare('DELETE FROM users WHERE discord_id = ?').run(interaction.user.id);
        await interaction.reply('Unlinked your Record Club account.');
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
                await interaction.editReply('You are not linked! Use `/link <username>` or provide a username.');
                return;
            }
        }

        const review = await scraper.getLatestReview(username);
        if (!review) {
            await interaction.editReply(`No reviews found for **${username}**.`);
            return;
        }

        const stars = formatStars(review.rating);
        const yearStr = review.releaseYear ? ` (${review.releaseYear})` : '';
        const source = getAlbumSource(review.albumTitle, review.artistName);

        let color = 0x0099FF; // Blue (Default)
        let footerText = 'Record Club Review';

        if (source === '1001') {
            color = 0xFFD700; // Gold
            footerText = '🏆 1001 Albums List';
        } else if (source === 'latam') {
            color = 0xFF5733; // Orange-Red
            footerText = '🌎 600 Discos Latinoamérica';
        }

        const separator1 = '┈┈┈┈┈';
        const separator2 = '┈'.repeat(footerText.length);

        const embed = new EmbedBuilder()
            .setColor(color)
            .setAuthor({
                name: `${review.username} reviewed...`,
                iconURL: review.userAvatar
            })
            .setTitle(`${review.albumTitle} by ${review.artistName}${yearStr}`)
            .setURL(review.reviewUrl)
            .setDescription(`${stars}\n${separator1}\n${review.reviewText || 'No review text.'}\n${separator2}`)
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
