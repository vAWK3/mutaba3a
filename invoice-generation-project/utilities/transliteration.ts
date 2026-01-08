//TODO: to update and find library

// Transliterate Arabic text to English characters
export const transliterateToEnglish = (text: string): string => {
    const transliterations: { [key: string]: string } = {
        "ا": "a", "ب": "b", "ت": "t", "ث": "th", "ج": "j", "ح": "h", "خ": "kh",
        "د": "d", "ذ": "dh", "ر": "r", "ز": "z", "س": "s", "ش": "sh", "ص": "s",
        "ض": "d", "ط": "t", "ظ": "z", "ع": "a", "غ": "gh", "ف": "f", "ق": "q",
        "ك": "k", "ل": "l", "م": "m", "ن": "n", "ه": "h", "و": "w", "ي": "y",
        "ء": "'", "ى": "a", "ئ": "y", "ؤ": "w", "لا": "la", "ة": "t",
        " ": " ", ",": ",", ".": ".", "!": "!", "?": "?"
        // Add more rules as necessary
    };

    return text
        .split("")
        .map((char) => transliterations[char] || char)
        .join("");
};

// Transliterate English text to Arabic characters
export const transliterateToArabic = (text: string): string => {
    const transliterations: { [key: string]: string } = {
        "a": "ا", "b": "ب", "t": "ت", "th": "ث", "j": "ج", "h": "ح", "kh": "خ",
        "d": "د", "dh": "ذ", "r": "ر", "z": "ز", "s": "س", "sh": "ش", "d'": "ض",
        "T": "ط", "zh": "ظ", "a'": "ع", "gh": "غ", "f": "ف", "q": "ق", "k": "ك",
        "l": "ل", "m": "م", "n": "ن", "ha": "ه", "w": "و", "y": "ي", "'": "ء",
        "la": "لا", "ta": "ة",
        " ": " ", ",": ",", ".": ".", "!": "!", "?": "?"
        // Add more rules as necessary
    };

    return text
        .split("")
        .map((char) => transliterations[char] || char)
        .join("");
};