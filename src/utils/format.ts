export const formatStars = (rating: string): string => {
    const num = parseFloat(rating);
    if (isNaN(num)) return rating;

    const fullStars = Math.floor(num);
    const halfStar = num % 1 !== 0;

    return '★'.repeat(fullStars) + (halfStar ? '½' : '');
};

// Explicit aliases for known mismatches between Record Club and standard Lists
const ALIASES: Record<string, string> = {
    'thekinksarethevillagegreenpreservationsociety': 'thevillagegreenpreservationsociety',
    'thekinksarethevillagegreenpreservation': 'thevillagegreenpreservationsociety' // Truncated by RSS feed limit
};

export const normalize = (str: string): string => {
    const normalized = str
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Remove accents
        .replace(/&/g, 'and')           // Treat & as 'and'
        .replace(/[^a-z0-9]/g, '');     // Remove non-alphanumeric

    return ALIASES[normalized] || normalized;
};
