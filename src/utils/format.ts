export const formatStars = (rating: string): string => {
    const num = parseFloat(rating);
    if (isNaN(num)) return rating;

    const fullStars = Math.floor(num);
    const halfStar = num % 1 !== 0;

    return '★'.repeat(fullStars) + (halfStar ? '½' : '');
};
