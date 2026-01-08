import dayjs from "dayjs"

export const isDateInRange = (dates: [Date | null, Date | null], itemDate: Date): boolean => {
    if (!dates || !dates[0] || !dates[1]) {
        return false;
    }

    const issueDate = dayjs(itemDate);
    const startDate = dayjs(dates[0]);
    const endDate = dayjs(dates[1]);

    // Check if issueDate is outside the range
    if (issueDate.isBefore(startDate, 'day') || issueDate.isAfter(endDate, 'day')) {
        return false;
    }

    return true;
}