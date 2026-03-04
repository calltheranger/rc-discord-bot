export const formatStars = (rating: string): string => {
    const num = parseFloat(rating);
    if (isNaN(num)) return rating;

    const fullStars = Math.floor(num);
    const halfStar = num % 1 !== 0;

    return '★'.repeat(fullStars) + (halfStar ? '½' : '');
};

export const normalize = (str: string): string => {
    return str
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Remove accents
        .replace(/[^a-z0-9]/g, ''); // Remove non-alphanumeric
};
