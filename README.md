# Record Club Discord Bot

A premium Discord bot for tracking and formatting album reviews from Record Club, featuring robust metadata extraction and multi-list routing.

## Features

-   **Premium Formatting**: Beautifully designed embeds with custom star ratings, paragraph preservation, and consistent separators.
-   **High Efficiency**: Uses a lightweight RSS-based scraper instead of a full browser, making it perfect for Synology NAS and lower-spec servers.
-   **Smart Metadata**: Automatically extracts high-quality album art and user avatars using lightweight HTTP requests and **MusicBrainz** fallback for release years.
-   **Multi-List Routing**: Automatically identifies and routes reviews from the **1001 Albums** list and the **600 Discos Latinoamérica** list to specific channels.
-   **Admin Commands**: Easy server configuration using `/setchannel` and the ability to link accounts for other users.

---

## Deployment Guide

This guide provides instructions for deploying the bot to your own Discord server.

### 1. Discord Developer Portal Setup

1.  Go to the [Discord Developer Portal](https://discord.com/developers/applications).
2.  Click **"New Application"** and give it a name.
3.  Go to the **Bot** tab:
    -   Reset/Copy the **Token** (You will need this later).
    -   **Privileged Gateway Intents**: Enable **"Server Members Intent"** and **"Message Content Intent"**.
4.  Go to the **OAuth2** -> **URL Generator** tab:
    -   **Scopes**: Select `bot` and `applications.commands`.
    -   **Bot Permissions**: Select:
        -   `View Channels`
        -   `Send Messages`
        -   `Embed Links`
        -   `Use Slash Commands`
5.  Copy the generated URL and use it to invite the bot to your server.

### 2. Environment Setup

The bot is designed to be extremely lightweight and requires **Node.js (v18+)**. No Chromium or browser dependencies are needed.

#### Required Environment Variables (`.env`)
Create a `.env` file in the root directory:
```env
DISCORD_TOKEN=your_bot_token_here
GUILD_ID=your_guild_id_here (optional, for instant slash command updates)
```

### 3. Installation & Deployment

1.  **Clone** the repository.
2.  **Install dependencies**:
    ```bash
    npm install
    ```
3.  **Import Album Lists** (1001 Albums & 600 Latam):
    ```bash
    npm run sync
    ```
4.  **Build the project**:
    ```bash
    npm run build
    ```
5.  **Start the bot**:
    ```bash
    npm start
    ```

### 4. Admin Checklist

-   [ ] Set the **General** review notification channel using `/setchannel type:general`.
-   [ ] Set specific notification channels for curated lists using `/setchannel type:1001` or `/setchannel type:latam`.
-   [ ] Ensure the bot has access to those specific channels.
-   [ ] Add Record Club usernames to the tracking list using `/link username:<rc_name>`.

### 5. User Tracking & Global Scope

-   **Pure Username Tracking**: Reviews are tracked based on Record Club usernames. The bot automatically fetches the reviewer's name and avatar directly from Record Club for the embed headers.
-   **No Member Tagging Required**: Admins can register as many usernames as they like using `/link username:<rc_name>`. You no longer need to specify which Discord user they belong to.
-   **One-Time Setup**: Once a username is added, their reviews will automatically be posted to all designated channels (General, 1001, or Latam) as configured by the admin.
-   **Unlinking**: To stop tracking a user, run `/unlink username:<rc_name>`.

---

## Technical Notes

-   **Scraper**: Uses a high-efficiency RSS-based parser with `axios` and `cheerio`.
-   **Avatars**: Retrieves user avatars by mimicking a Discord bot to access profile metadata without a full browser.
-   **Metadata Fallback**: If Record Club is slow or blocked, the bot automatically queries the **MusicBrainz API** for release years.
-   **Database**: Uses a local SQLite database (`bot.db`) to store user links and album list data.
