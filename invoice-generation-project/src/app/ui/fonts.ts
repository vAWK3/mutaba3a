import { IBM_Plex_Sans_Arabic, IBM_Plex_Mono, Inter } from "next/font/google";

export const fontAr = IBM_Plex_Sans_Arabic({
    weight: ["300", "400", "500", "600", "700"],
    subsets: ["arabic", "latin"],
    display: "swap",
});

export const fontEn = Inter({
    weight: ["300", "400", "500", "700"],
    subsets: ["latin"],
    display: "swap",
});

export const fontMono = IBM_Plex_Mono({
    weight: ["300", "400", "500", "600", "700"],
    subsets: ["latin"],
    display: "swap",
});