import { AnalyticsPeriod } from "../models/enums/analytics_period";

export const calculateStartDate = (period: AnalyticsPeriod) => {
    
    const now = new Date();
    const startDate = new Date(now); // Create a copy of the current date
  
    switch (period) {
      case AnalyticsPeriod.Days30:
        startDate.setDate(now.getDate() - 30); // 30 days ago
        break;
      case AnalyticsPeriod.Months6:
        startDate.setMonth(now.getMonth() - 6); // 6 months ago
        break;
      case AnalyticsPeriod.YTD:
        startDate.setMonth(0); // Start of the year (January)
        startDate.setDate(1); // First day of January
        break;
      case AnalyticsPeriod.Year1:
        startDate.setFullYear(now.getFullYear() - 1); // 1 year ago
        break;
      default:
        break; // Default case to handle unexpected input
    }
  
    return startDate;
  };

