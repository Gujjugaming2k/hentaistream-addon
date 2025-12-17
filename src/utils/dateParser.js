/**
 * Date parsing utility for normalizing dates from various source formats
 */

const logger = require('./logger');

/**
 * Parse a date string from various formats into ISO 8601 format
 * @param {string} dateString - Date string in various formats
 * @returns {string|null} ISO 8601 date string (YYYY-MM-DDTHH:mm:ss.sssZ) or null if unparseable
 */
function parseDate(dateString) {
  if (!dateString || typeof dateString !== 'string') {
    return null;
  }

  const trimmed = dateString.trim();
  if (!trimmed) {
    return null;
  }

  try {
    // Try ISO 8601 first (most reliable)
    // Handles: "2024-12-10T14:22:30Z", "2024-12-10T14:22:30+00:00", "2024-12-10"
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
      const date = new Date(trimmed);
      if (!isNaN(date.getTime())) {
        return date.toISOString();
      }
    }

    // Try common date formats
    const formats = [
      // "Jan 15, 2023" or "January 15, 2023"
      /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/,
      // "15 Jan 2023" or "15 January 2023"
      /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/,
      // "2023/01/15"
      /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/,
      // "01/15/2023" (US format)
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
      // "15-01-2023" or "15.01.2023"
      /^(\d{1,2})[-.](\d{1,2})[-.](\d{4})$/,
    ];

    const monthNames = {
      jan: 0, january: 0,
      feb: 1, february: 1,
      mar: 2, march: 2,
      apr: 3, april: 3,
      may: 4,
      jun: 5, june: 5,
      jul: 6, july: 6,
      aug: 7, august: 7,
      sep: 8, sept: 8, september: 8,
      oct: 9, october: 9,
      nov: 10, november: 10,
      dec: 11, december: 11,
    };

    // "Jan 15, 2023" format
    let match = trimmed.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
    if (match) {
      const month = monthNames[match[1].toLowerCase()];
      if (month !== undefined) {
        const date = new Date(parseInt(match[3]), month, parseInt(match[2]));
        if (!isNaN(date.getTime())) {
          return date.toISOString();
        }
      }
    }

    // "15 Jan 2023" format
    match = trimmed.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
    if (match) {
      const month = monthNames[match[2].toLowerCase()];
      if (month !== undefined) {
        const date = new Date(parseInt(match[3]), month, parseInt(match[1]));
        if (!isNaN(date.getTime())) {
          return date.toISOString();
        }
      }
    }

    // "2023/01/15" format
    match = trimmed.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    if (match) {
      const date = new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
      if (!isNaN(date.getTime())) {
        return date.toISOString();
      }
    }

    // Try native Date parsing as last resort
    const nativeDate = new Date(trimmed);
    if (!isNaN(nativeDate.getTime())) {
      return nativeDate.toISOString();
    }

    return null;
  } catch (error) {
    logger.debug(`Failed to parse date "${dateString}": ${error.message}`);
    return null;
  }
}

/**
 * Extract year from a date string or ISO date
 * @param {string} dateString - Date string or ISO date
 * @returns {number|null} Year as integer or null
 */
function extractYear(dateString) {
  if (!dateString) return null;

  // If it's already an ISO date, extract year directly
  const isoMatch = dateString.match(/^(\d{4})-/);
  if (isoMatch) {
    return parseInt(isoMatch[1]);
  }

  // Try to find a 4-digit year in the string
  const yearMatch = dateString.match(/(19|20)\d{2}/);
  if (yearMatch) {
    return parseInt(yearMatch[0]);
  }

  // Try parsing the full date and extracting year
  const parsed = parseDate(dateString);
  if (parsed) {
    return new Date(parsed).getFullYear();
  }

  return null;
}

/**
 * Check if a date is within a certain number of days from now
 * @param {string} isoDate - ISO 8601 date string
 * @param {number} days - Number of days to check
 * @returns {boolean} True if date is within the specified days
 */
function isWithinDays(isoDate, days) {
  if (!isoDate) return false;

  try {
    const date = new Date(isoDate);
    if (isNaN(date.getTime())) return false;

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    return diffDays >= 0 && diffDays <= days;
  } catch {
    return false;
  }
}

/**
 * Check if a date is within the last week (7 days)
 * @param {string} isoDate - ISO 8601 date string
 * @returns {boolean} True if date is within last 7 days
 */
function isWithinWeek(isoDate) {
  return isWithinDays(isoDate, 7);
}

/**
 * Check if a date is within the last month (30 days)
 * @param {string} isoDate - ISO 8601 date string
 * @returns {boolean} True if date is within last 30 days
 */
function isWithinMonth(isoDate) {
  return isWithinDays(isoDate, 30);
}

/**
 * Compare two ISO dates for sorting (newest first)
 * @param {string} dateA - First ISO date
 * @param {string} dateB - Second ISO date
 * @returns {number} Comparison result for sort (negative = A first, positive = B first)
 */
function compareDatesNewestFirst(dateA, dateB) {
  // Treat null/undefined dates as very old (sort to bottom)
  if (!dateA && !dateB) return 0;
  if (!dateA) return 1;  // B is newer
  if (!dateB) return -1; // A is newer

  try {
    const timeA = new Date(dateA).getTime();
    const timeB = new Date(dateB).getTime();

    if (isNaN(timeA) && isNaN(timeB)) return 0;
    if (isNaN(timeA)) return 1;
    if (isNaN(timeB)) return -1;

    return timeB - timeA; // Newest first
  } catch {
    return 0;
  }
}

/**
 * Get the more recent of two dates
 * @param {string} dateA - First ISO date
 * @param {string} dateB - Second ISO date
 * @returns {string|null} The more recent date, or whichever is defined
 */
function getMostRecentDate(dateA, dateB) {
  if (!dateA && !dateB) return null;
  if (!dateA) return dateB;
  if (!dateB) return dateA;

  try {
    const timeA = new Date(dateA).getTime();
    const timeB = new Date(dateB).getTime();

    if (isNaN(timeA)) return dateB;
    if (isNaN(timeB)) return dateA;

    return timeA > timeB ? dateA : dateB;
  } catch {
    return dateA || dateB;
  }
}

module.exports = {
  parseDate,
  extractYear,
  isWithinDays,
  isWithinWeek,
  isWithinMonth,
  compareDatesNewestFirst,
  getMostRecentDate,
};
