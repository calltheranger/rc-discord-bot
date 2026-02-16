# Record Club Discord Bot

A premium Discord bot for tracking and formatting album reviews from Record Club, featuring robust metadata extraction and multi-list routing.

## Features

-   **Premium Formatting**: Beautifully designed embeds with custom star ratings and consistent separators.
-   **Robust Metadata**: Uses Puppeteer for reliable avatar/cover extraction and **MusicBrainz** as a fallback for release years.
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

The bot requires **Node.js (v18+)** and **Puppeteer** (which requires Chromium dependencies on Linux).

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
-   [ ] Link user accounts using `/link username:<rc_name>`.

### 5. User Linking & Global Scope

-   **One-Time Global Link**: Users only need to link their Record Club account **once**. The bot stores this link globally in the database.
-   **No Per-Channel Linking**: Once a user is linked, their reviews will automatically be posted to all designated channels (General, 1001, or Latam) as configured by the admin.
-   **Admin Capability**: Admins can link accounts for other users using `/link username:<rc_name> user:<@discord_user>`.

---

## Technical Notes

-   **Scraper**: Uses Puppeteer with a stealth plugin to handle dynamic content on Record Club.
-   **Metadata Fallback**: If Record Club is slow or blocked, the bot automatically queries the **MusicBrainz API** for release years.
-   **Database**: Uses a local SQLite database (`bot.db`) to store user links and album list data.
