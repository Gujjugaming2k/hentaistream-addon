const logger = require('./logger');

/**
 * Series Name Matcher
 * Converts series names to OppaiStream episode URL format
 */

/**
 * Normalize a series name for matching
 * @param {string} name - Series name
 * @returns {string} Normalized name
 */
function normalizeName(name) {
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // Remove special chars except hyphens and spaces
    .replace(/\s+/g, '-')      // Replace spaces with hyphens
    .replace(/-+/g, '-')       // Collapse multiple hyphens
    .trim();
}

/**
 * Convert HentaiMama series slug to OppaiStream episode slug
 * @param {string} hmSlug - HentaiMama slug (e.g., "kaede-to-suzu-the-animation-episode-1")
 * @param {number} episodeNumber - Episode number
 * @returns {string} OppaiStream episode slug (e.g., "Kaede-to-Suzu-THE-ANIMATION-1")
 */
function hentaiMamaToOppaiStream(hmSlug, episodeNumber) {
  // Remove "episode-X" suffix from HentaiMama slug
  let seriesName = hmSlug
    .replace(/-episode-\d+$/i, '')
    .replace(/-episodes?$/i, '');
  
  // Convert to title case for OppaiStream format
  const titleCase = seriesName
    .split('-')
    .map(word => {
      // Keep "THE" and "ANIMATION" uppercase
      if (word.toLowerCase() === 'the' || word.toLowerCase() === 'animation') {
        return word.toUpperCase();
      }
      // Capitalize first letter
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join('-');
  
  // Format: "Series-Name-Episode-Number"
  return `${titleCase}-${episodeNumber}`;
}

/**
 * Manual mappings for series with different names between providers
 * Key: HentaiMama slug (without episode suffix)
 * Value: OppaiStream series name
 */
const MANUAL_MAPPINGS = {
  'kaede-suzu-animation': 'Kaede-to-Suzu-THE-ANIMATION',
  'uchi-no-otouto-maji-de-dekain-dakedo-mi-ni-konai': 'Uchi-no-Otouto-Maji-de-Dekain-Dakedo-Mi-ni-Konai',
  // Add more mappings as needed
};

/**
 * Get OppaiStream episode slug for a HentaiMama episode
 * @param {string} hmSlug - HentaiMama episode slug
 * @returns {string|null} OppaiStream episode slug or null if can't determine
 */
function getOppaiStreamSlug(hmSlug) {
  try {
    // Extract series name and episode number from HentaiMama slug
    const episodeMatch = hmSlug.match(/^(.+?)-episode-(\d+)$/i);
    
    if (!episodeMatch) {
      // Try alternative format: series-name-episodes (single episode)
      const altMatch = hmSlug.match(/^(.+?)-episodes?$/i);
      if (altMatch) {
        const seriesSlug = altMatch[1];
        const episodeNumber = 1;
        
        // Check manual mappings
        if (MANUAL_MAPPINGS[seriesSlug]) {
          return `${MANUAL_MAPPINGS[seriesSlug]}-${episodeNumber}`;
        }
        
        return hentaiMamaToOppaiStream(seriesSlug, episodeNumber);
      }
      
      logger.warn(`Cannot extract episode info from HentaiMama slug: ${hmSlug}`);
      return null;
    }
    
    const seriesSlug = episodeMatch[1];
    const episodeNumber = parseInt(episodeMatch[2]);
    
    // Check manual mappings first
    if (MANUAL_MAPPINGS[seriesSlug]) {
      return `${MANUAL_MAPPINGS[seriesSlug]}-${episodeNumber}`;
    }
    
    // Use automatic conversion
    return hentaiMamaToOppaiStream(hmSlug, episodeNumber);
    
  } catch (error) {
    logger.error(`Error converting HentaiMama slug to OppaiStream: ${error.message}`);
    return null;
  }
}

module.exports = {
  normalizeName,
  hentaiMamaToOppaiStream,
  getOppaiStreamSlug,
  MANUAL_MAPPINGS
};
