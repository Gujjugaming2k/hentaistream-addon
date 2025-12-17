const logger = require('./logger');
const ratingNormalizer = require('./ratingNormalizer');
const { getMostRecentDate } = require('./dateParser');

/**
 * Normalize series name for matching across providers
 * @param {string} name - Series name
 * @returns {string} Normalized name
 */
function normalizeName(name) {
  if (!name) return '';
  
  return name
    .toLowerCase()
    .trim()
    // Remove special characters but keep spaces
    .replace(/[^\w\s-]/g, '')
    // Normalize multiple spaces to single space
    .replace(/\s+/g, ' ')
    // Remove common prefixes/suffixes
    .replace(/^(the|a|an)\s+/i, '')
    .replace(/\s+(episode|ep|series|season|s)\s*\d*$/i, '');
}

/**
 * Calculate similarity between two strings using Levenshtein distance
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Similarity score (0-1)
 */
function similarity(a, b) {
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  
  if (longer.length === 0) return 1.0;
  
  const editDistance = levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

/**
 * Calculate Levenshtein distance between two strings
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Edit distance
 */
function levenshteinDistance(a, b) {
  const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));
  
  for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= b.length; j++) matrix[j][0] = j;
  
  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const indicator = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + indicator
      );
    }
  }
  
  return matrix[b.length][a.length];
}

/**
 * Check if two series are duplicates
 * @param {Object} series1 - First series
 * @param {Object} series2 - Second series
 * @returns {boolean} True if series are duplicates
 */
function isDuplicate(series1, series2) {
  const name1 = normalizeName(series1.name);
  const name2 = normalizeName(series2.name);
  
  // Exact match
  if (name1 === name2) return true;
  
  // Fuzzy match (90% similarity threshold)
  const score = similarity(name1, name2);
  return score >= 0.90;
}

/**
 * Calculate weighted average rating from multiple provider ratings
 * Uses ratingNormalizer for proper weighting
 * @param {Object} ratingBreakdown - Object with provider rating info
 *   Example: { hmm: { raw: 8.6, type: 'direct' }, htv: { raw: 5000, type: 'views' } }
 * @returns {number} Weighted average rating (rounded to 1 decimal)
 */
function calculateAverageRating(ratingBreakdown) {
  if (!ratingBreakdown || typeof ratingBreakdown !== 'object') {
    return ratingNormalizer.CONFIG.DEFAULT_RATING;
  }
  
  // Convert old format (just numbers) to new format if needed
  const normalizedBreakdown = {};
  
  for (const [provider, data] of Object.entries(ratingBreakdown)) {
    if (data === null || data === undefined) continue;
    
    // Handle old format (just a number) vs new format (object with raw/type)
    if (typeof data === 'number') {
      const normalized = ratingNormalizer.normalizeDirectRating(data);
      if (normalized !== null) {
        normalizedBreakdown[provider] = {
          raw: data,
          normalized: normalized,
          type: 'direct'
        };
      }
    } else if (typeof data === 'object') {
      const type = data.type || 'direct';
      const raw = data.raw;
      
      let normalized;
      if (type === 'views') {
        normalized = ratingNormalizer.normalizeViewCount(raw);
      } else {
        normalized = ratingNormalizer.normalizeDirectRating(raw);
      }
      
      if (normalized !== null) {
        normalizedBreakdown[provider] = {
          raw: raw,
          normalized: normalized,
          type: type
        };
      }
    }
  }
  
  // Use the rating normalizer's weighted average calculation
  return ratingNormalizer.calculateWeightedAverage(normalizedBreakdown);
}

/**
 * Calculate metadata quality score for a series
 * Higher score = more complete metadata
 * @param {Object} series - Series object
 * @returns {number} Quality score
 */
function calculateMetadataScore(series) {
  let score = 0;
  
  // +3 for having a description (most important)
  if (series.description && series.description.length > 20) {
    score += 3;
    // Bonus for longer descriptions
    if (series.description.length > 100) score += 1;
    if (series.description.length > 200) score += 1;
  }
  
  // +1 per genre (max 5 points)
  if (series.genres && Array.isArray(series.genres)) {
    score += Math.min(series.genres.length, 5);
  }
  
  // +2 for having a poster
  if (series.poster && series.poster.length > 10) {
    score += 2;
  }
  
  // +1 for having a year
  if (series.year) {
    score += 1;
  }
  
  // +1 for having a rating
  if (series.rating && series.rating > 0) {
    score += 1;
  }
  
  return score;
}

/**
 * Merge duplicate series from multiple providers
 * Prefers the item with higher metadata quality score as primary
 * @param {Object} existing - Existing series in aggregated list
 * @param {Object} newSeries - New series from another provider
 * @returns {Object} Merged series with best metadata
 */
function mergeSeries(existing, newSeries) {
  // Extract provider prefix from IDs
  const getPrefixFromId = (id) => {
    const match = id.match(/^([a-z]+)-/);
    return match ? match[1] : 'unknown';
  };
  
  const existingPrefix = getPrefixFromId(existing.id);
  const newPrefix = getPrefixFromId(newSeries.id);
  
  // Calculate metadata scores to determine which should be primary
  const existingScore = calculateMetadataScore(existing);
  const newScore = calculateMetadataScore(newSeries);
  
  // Determine primary (higher score wins)
  let primary, secondary;
  if (newScore > existingScore) {
    // New series has better metadata - swap primary
    primary = { ...newSeries };
    secondary = existing;
    logger.debug(`Swapping primary: ${newSeries.name} (score: ${newScore}) > ${existing.name} (score: ${existingScore})`);
  } else {
    primary = existing;
    secondary = newSeries;
  }
  
  const primaryPrefix = getPrefixFromId(primary.id);
  const secondaryPrefix = getPrefixFromId(secondary.id);
  
  // Initialize arrays and objects if they don't exist
  if (!primary.providers) primary.providers = [primaryPrefix];
  if (!primary.providerSlugs) primary.providerSlugs = { [primaryPrefix]: primary.id.replace(`${primaryPrefix}-`, '') };
  if (!primary.ratingBreakdown) primary.ratingBreakdown = {};
  
  // Copy over existing provider data if swapping primary
  if (existing.providers) {
    existing.providers.forEach(p => {
      if (!primary.providers.includes(p)) primary.providers.push(p);
    });
  }
  if (existing.providerSlugs) {
    Object.assign(primary.providerSlugs, existing.providerSlugs);
  }
  if (existing.ratingBreakdown) {
    Object.assign(primary.ratingBreakdown, existing.ratingBreakdown);
  }
  
  // Add ratings from both (with type info for proper normalization)
  // HentaiMama has direct ratings, HentaiTV has view counts, HentaiSea has neither
  if (primary.rating !== undefined && primary.rating !== null && !primary.ratingBreakdown[primaryPrefix]) {
    primary.ratingBreakdown[primaryPrefix] = {
      raw: primary.rating,
      type: primary.ratingType || 'direct'
    };
  }
  // Handle view counts from HentaiTV
  if (primary.viewCount !== undefined && primary.viewCount !== null && !primary.ratingBreakdown[primaryPrefix]) {
    primary.ratingBreakdown[primaryPrefix] = {
      raw: primary.viewCount,
      type: 'views'
    };
  }
  
  if (secondary.rating !== undefined && secondary.rating !== null) {
    secondary.ratingBreakdown = secondary.ratingBreakdown || {};
    secondary.ratingBreakdown[secondaryPrefix] = {
      raw: secondary.rating,
      type: secondary.ratingType || 'direct'
    };
  }
  // Handle view counts from secondary provider
  if (secondary.viewCount !== undefined && secondary.viewCount !== null) {
    secondary.ratingBreakdown = secondary.ratingBreakdown || {};
    secondary.ratingBreakdown[secondaryPrefix] = {
      raw: secondary.viewCount,
      type: 'views'
    };
  }
  
  // Merge rating breakdowns
  if (secondary.ratingBreakdown) {
    Object.assign(primary.ratingBreakdown, secondary.ratingBreakdown);
  }
  
  // Merge secondary provider data
  if (!primary.providers.includes(secondaryPrefix)) {
    primary.providers.push(secondaryPrefix);
  }
  primary.providerSlugs[secondaryPrefix] = secondary.id.replace(`${secondaryPrefix}-`, '');
  
  // Recalculate average rating
  primary.rating = calculateAverageRating(primary.ratingBreakdown);
  
  // Keep best poster (prefer non-null, prefer primary's)
  if (!primary.poster && secondary.poster) {
    primary.poster = secondary.poster;
  }
  
  // Keep longest description (primary already has better metadata, but check anyway)
  if (!primary.description || (secondary.description && secondary.description.length > primary.description.length)) {
    primary.description = secondary.description;
  }
  
  // Merge genres (deduplicate and filter out studio name)
  if (secondary.genres && Array.isArray(secondary.genres)) {
    if (!primary.genres) primary.genres = [];
    const allGenres = [...primary.genres, ...secondary.genres];
    // Filter out studio from genres (some scrapers include studio in genres array)
    const studioName = primary.studio || secondary.studio;
    const filteredGenres = studioName 
      ? allGenres.filter(g => g.toLowerCase() !== studioName.toLowerCase())
      : allGenres;
    primary.genres = [...new Set(filteredGenres)];
  }
  
  // Merge studio (prefer non-null, prefer properly capitalized)
  if (!primary.studio && secondary.studio) {
    primary.studio = secondary.studio;
  } else if (primary.studio && secondary.studio) {
    // Prefer Title Case over ALL CAPS
    const primaryAllCaps = primary.studio === primary.studio.toUpperCase();
    const secondaryAllCaps = secondary.studio === secondary.studio.toUpperCase();
    if (primaryAllCaps && !secondaryAllCaps) {
      primary.studio = secondary.studio;
    }
  }
  
  // Merge lastUpdated dates (keep most recent)
  primary.lastUpdated = getMostRecentDate(primary.lastUpdated, secondary.lastUpdated);
  
  // Store metadata score for sorting
  primary.metadataScore = calculateMetadataScore(primary);
  
  return primary;
}

/**
 * Aggregate catalogs from multiple providers
 * @param {Array<Object>} providerCatalogs - Array of { provider, catalog } objects
 * @returns {Array<Object>} Deduplicated, merged, and sorted catalog
 */
function aggregateCatalogs(providerCatalogs) {
  const startTime = Date.now();
  const aggregated = [];
  
  logger.info(`Aggregating catalogs from ${providerCatalogs.length} providers`);
  
  for (const { provider, catalog } of providerCatalogs) {
    logger.info(`Processing ${catalog.length} series from ${provider}`);
    
    for (const series of catalog) {
      // Find if this series already exists in aggregated catalog
      const existingIndex = aggregated.findIndex(s => isDuplicate(s, series));
      
      if (existingIndex >= 0) {
        // Merge with existing series (may swap primary based on metadata quality)
        aggregated[existingIndex] = mergeSeries(aggregated[existingIndex], series);
        logger.debug(`Merged duplicate: ${series.name} from ${provider}`);
      } else {
        // Add as new series
        const getPrefixFromId = (id) => {
          const match = id.match(/^([a-z]+)-/);
          return match ? match[1] : 'unknown';
        };
        
        const prefix = getPrefixFromId(series.id);
        
        // Build rating breakdown with proper type info
        const ratingBreakdown = {};
        if (series.rating !== undefined && series.rating !== null) {
          ratingBreakdown[prefix] = {
            raw: series.rating,
            type: series.ratingType || 'direct'
          };
        } else if (series.viewCount !== undefined && series.viewCount !== null) {
          ratingBreakdown[prefix] = {
            raw: series.viewCount,
            type: 'views'
          };
        }
        
        // Filter out studio from genres (some scrapers include studio in genres array)
        let filteredGenres = series.genres;
        if (series.studio && Array.isArray(series.genres)) {
          filteredGenres = series.genres.filter(g => 
            g.toLowerCase() !== series.studio.toLowerCase()
          );
        }
        
        const newSeries = {
          ...series,
          genres: filteredGenres,
          providers: [prefix],
          providerSlugs: {
            [prefix]: series.id.replace(`${prefix}-`, '')
          },
          ratingBreakdown: ratingBreakdown,
          metadataScore: calculateMetadataScore(series)
        };
        
        // Calculate initial rating
        newSeries.rating = calculateAverageRating(newSeries.ratingBreakdown);
        
        aggregated.push(newSeries);
      }
    }
  }
  
  // Sort by metadata completeness (more complete first), then alphabetically
  aggregated.sort((a, b) => {
    // First: sort by metadata score (higher = better)
    const scoreDiff = (b.metadataScore || 0) - (a.metadataScore || 0);
    if (scoreDiff !== 0) return scoreDiff;
    
    // Second: sort by number of providers (more = more reliable)
    const providerDiff = (b.providers?.length || 1) - (a.providers?.length || 1);
    if (providerDiff !== 0) return providerDiff;
    
    // Third: alphabetical by name
    return (a.name || '').localeCompare(b.name || '');
  });
  
  const duration = Date.now() - startTime;
  logger.info(`Catalog aggregation complete: ${aggregated.length} unique series from ${providerCatalogs.length} providers (${duration}ms)`);
  
  return aggregated;
}

module.exports = {
  aggregateCatalogs,
  normalizeName,
  similarity,
  isDuplicate,
  calculateAverageRating,
  calculateMetadataScore,
  mergeSeries
};
