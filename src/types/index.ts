export interface Review {
    username: string;
    albumTitle: string;
    artistName: string;
    rating: string;
    reviewText: string;
    reviewUrl: string;
    imageUrl?: string;
    userAvatar?: string;
    releaseYear?: string;
    timestamp?: number; // Approximate, if available
    isTruncated?: boolean;
}

export interface User {
    discord_id: string;
    record_club_username: string;
    last_review_url: string | null;
    last_checked_at: number;
}
