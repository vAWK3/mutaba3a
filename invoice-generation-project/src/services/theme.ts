'use server';

import { cookies } from 'next/headers';

const COOKIE_NAME = 'NEXT_THEME';

export async function getUserTheme(): Promise<"auto" | "dark" | "light"> {

    const value = cookies().get(COOKIE_NAME)?.value;

    if (!value) return "auto";

    if (value != "dark" && value != "light" && value != "auto") {
        return "auto";
    }

    return value;
}

export async function setUserTheme(theme: "auto" | "dark" | "light") {
    cookies().set(COOKIE_NAME, theme);
}