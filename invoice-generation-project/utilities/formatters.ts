import { Currency } from "@/types";
import { type DatesRangeValue } from "@mantine/dates";
import dayjs from "dayjs";




export const formatDate = (date: Date, pattern?: string): string => {

    const formattedDate = dayjs(date).format(pattern ?? 'DD/MM/YYYY');

    return formattedDate;
};

export const formatTotal = (total: number, currency?: Currency | string): string => {
    if (total === undefined) return 'error';

    const number = formatNumberWithCommas(total.toFixed(total > 1000 ? 0 : 2));

    if (!currency) {
        return number;
    }

    const currencySymbol = currency === Currency.Dollar ? '$' : currency === Currency.Shekel ? '₪' : currency;
    return `${currencySymbol}${number}`;
};

export const formatNumberWithCommas = (number: string): string => {
    const [integerPart, decimalPart] = number.split('.');
    const formattedIntegerPart = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

    if (!decimalPart) {
        return formattedIntegerPart;
    }

    return `${formattedIntegerPart}.${decimalPart}`;
};

export const getInitials = (name?: string | undefined | null) => {
    if (!name) { return "" };
    const nameParts = name.split(" ");
    if (nameParts.length === 1) {
        return nameParts[0].charAt(0).toUpperCase();
    }
    return (
        nameParts[0].charAt(0).toUpperCase() +
        nameParts[1].charAt(0).toUpperCase()
    );
};

export const formatDatesRange = (dates?: DatesRangeValue): string[] => {
    if (!dates) {
        return [];
    }

    if (!dates[0] || !dates[1]) {
        return [];
    }

    const fromDate = dayjs(dates[0]).format('DD/MM/YYYY');
    const toDate = dayjs(dates[1]).format('DD/MM/YYYY');

    return [fromDate, toDate];
}

export function parseStringToNumber(input: string): number | null {
    // Trim the input to remove any leading or trailing whitespace

    const trimmedInput = input.trim();

    // Attempt to parse the string as a float
    const parsedNumber = parseFloat(trimmedInput);

    // Check if the result is a valid number
    if (isNaN(parsedNumber)) {
        return null; // Return null for invalid numbers
    }

    return parsedNumber; // Return the parsed number
}
