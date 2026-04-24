# Record Club Discord Bot

A premium Discord bot for tracking and formatting album reviews from Record Club, featuring robust metadata extraction and multi-list routing.

## Features

-   **Premium Formatting**: Beautifully designed embeds with custom star ratings, paragraph preservation, and consistent separators.
-   **High Efficiency**: Uses a lightweight RSS-based parser and **Lazy Loading** for metadata. It only fetches release years when a new review is posted, minimizing network overhead.
-   **Native Metadata Extraction**: Automatically extracts high-quality album art, user avatars (square cropped), and **Native Release Years** directly from Record Club album pages for 100% site parity.
-   **Smart List Matching**: Normalizes special characters and synonyms (e.g., treating `&` as `and`) to ensure perfectly accurate routing to the **1001 Albums** or **Latam** channels, even when naming conventions differ between sources.
-   **Multi-List Routing**: Automatically identifies and routes reviews from the **1001 Albums** list and the **600 Discos Latinoamérica** list to specific channels.
-   **Intelligent Fallback**: Uses the **MusicBrainz API** as a secondary backup for release years if direct scraping is unavailable.
-   **Admin Commands**: Easy server configuration using `/setchannel` and the ability to link accounts for other users.
-   **Duplicate Prevention**: Implements a robust content hashing system (SHA-256) to ensure that the same review is never posted twice, even if the source URL changes due to platform glitches.
-   **Rich Text Support**: Automatically converts Record Club HTML formatting (bold, italic, underline, strike-through, and hyperlinks) into beautiful Discord Markdown.
-   **Cloudflare Bypass (FlareSolverr)**: Optional support for **FlareSolverr** to solve JavaScript and Captcha challenges, allowing the bot to run reliably even on restricted networks like a Synology NAS.
-   **Stealth Headers**: Mimics a modern web browser signature with unified headers to improve compatibility and reduce 403 Forbidden errors.

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

# Optional: FlareSolverr URL for bypassing Cloudflare
# FLARESOLVERR_URL=http://localhost:8191
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
-   [ ] (Optional) Manually trigger a list update using `/sync`.

### 5. Slash Commands

-   `/link <username>`: Start tracking a Record Club user.
-   `/unlink <username>`: Stop tracking a Record Club user.
-   `/setchannel [type]`: Set the current channel for `general`, `1001`, or `latam` reviews.
-   `/latest [username]`: Get the most recent review for a user.
-   `/sync`: (Admin only) Force the bot to re-fetch the 1001 and Latam album lists.

### 6. User Tracking & Global Scope

-   **Pure Username Tracking**: Reviews are tracked based on Record Club usernames. The bot automatically fetches the reviewer's name and avatar directly from Record Club for the embed headers.
-   **No Member Tagging Required**: Admins can register as many usernames as they like using `/link username:<rc_name>`. You no longer need to specify which Discord user they belong to.
-   **One-Time Setup**: Once a username is added, their reviews will automatically be posted to all designated channels (General, 1001, or Latam) as configured by the admin.
-   **Unlinking**: To stop tracking a user, run `/unlink username:<rc_name>`.

---

## Technical Notes

-   **Scraper**: Uses a high-efficiency RSS-based parser with `axios` and `cheerio`.
-   **Avatars**: Retrieves user avatars with specific square crop parameters (`?width=300&height=300`) to ensure perfect display in Discord.
-   **Year Extraction**: Prioritizes direct scraping from Record Club album pages (headers, breadcrumbs, and "Release details") for maximum accuracy.
-   **Metadata Fallback**: If Record Club is slow or the year is missing, the bot queries the **MusicBrainz API** as a robust secondary source.
-   **Duplicate Prevention**: Stores SHA-256 hashes of processed review content in the database. A periodic cleanup task prunes records older than 30 days.
-   **Cloudflare Bypass**: Routes requests through a FlareSolverr instance if configured, using a headless browser to solve security challenges.
-   **Database**: Uses a local SQLite database (`record_club.db`) to store user links, album list data, and processed review hashes.
