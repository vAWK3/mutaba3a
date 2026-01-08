import { UpdateModel } from "@/types";

function getRandomItems<T>(items: T[], count: number): T[] {
    const shuffled = items.sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count);
}

function generateRandomFeaturesOrFixes(): string[] {
    const possibleUpdates = [
        "Improved performance on mobile devices",
        "Fixed crash when opening app",
        "Added dark mode support",
        "Updated UI for better accessibility",
        "Fixed bug in user authentication",
        "Optimized database queries",
        "Enhanced security protocols",
        "Added multi-language support",
        "Improved error handling in forms",
        "Updated terms and conditions",
        "Fixed layout issue in profile page",
        "Added feature to export data",
        "Improved dashboard loading times",
        "Fixed issue with push notifications",
        "Enhanced image compression for uploads"
    ];

    const count = Math.floor(Math.random() * 6) + 5; // Random number between 5 and 10
    return getRandomItems(possibleUpdates, count);
}

const generateUniqueId = (): string => {
    return `update-${Math.random().toString(36).substring(2, 9)}`;
};


function generateUpdate(version: string): UpdateModel {
    return {
        id: generateUniqueId(),
        timestamp: new Date(),
        version,
        features: generateRandomFeaturesOrFixes(),
    };
}

export async function GET(request: Request) {
    const updates = [
        generateUpdate('1.5.0'),
        generateUpdate('1.4.0'),
        generateUpdate('1.3.0'),
        generateUpdate('1.2.0'),
        generateUpdate('1.1.0'),
        generateUpdate('1.0.0'),
    ];

    return Response.json(updates);
}