/**
 * Rating Normalizer Utility
 * 
 * Converts different rating systems to a unified 0-10 scale
 * and calculates weighted averages across providers.
 */

const logger = require('./logger');

// Configuration
const CONFIG = {
  // Minimum view threshold before view-based ratings have full weight
  // Lowered to 100 to include more content with ratings
  VIEW_THRESHOLD: 1000,
  
  // Default rating for content without ratings (neutral)
  DEFAULT_RATING: 6.0,
  
  // Provider weights (HentaiMama ratings are most reliable - PRIMARY SOURCE)
  PROVIDER_WEIGHTS: {
    hmm: 5.0,  // HentaiMama - direct user ratings, highest weight (primary source)
    htv: 1.0,  // HentaiTV - view counts, lower weight
    hse: 1.0,  // HentaiSea - trending position (when available), lower weight
  },
  
  // View count to rating conversion (logarithmic scale)
  // Max 7.0 for view-based ratings - HentaiMama's real ratings (8-10) should dominate
  VIEWS: {
    multiplier: 1.5,  // Reduced from 2.5
    maxValue: 7.0,    // Reduced from 8.5
    logBase: 10
  }
};

/**
 * Normalize a direct rating (0-10 scale)
 * @param {number} rating - Direct rating value
 * @returns {number} Normalized rating (0-10)
 */
function normalizeDirectRating(rating) {
  if (typeof rating !== 'number' || isNaN(rating)) {
    return null;
  }
  // Clamp to 0-10 range
  return Math.max(0, Math.min(10, rating));
}

/**
 * Normalize view count to a rating
 * Uses logarithmic scale: more views = higher rating
 * BUT only if views exceed threshold, otherwise returns null (unrated)
 * 
 * @param {number} views - View count
 * @returns {number|null} Normalized rating or null if below threshold
 */
function normalizeViewCount(views) {
  if (typeof views !== 'number' || isNaN(views) || views < 0) {
    return null;
  }
  
  // Below threshold = unrated (will use default or be excluded)
  if (views < CONFIG.VIEW_THRESHOLD) {
    return null;
  }
  
  // Logarithmic scaling: log10(views) * multiplier, capped at 10
  const normalized = Math.min(
    CONFIG.VIEWS.maxValue,
    Math.log10(views + 1) * CONFIG.VIEWS.multiplier
  );
  
  return Math.round(normalized * 10) / 10; // Round to 1 decimal
}

/**
 * Normalize a rating based on its type
 * @param {number} value - Raw rating/view value
 * @param {string} type - Type of rating: 'direct', 'views', 'percentage', 'stars', 'trending'
 * @returns {number|null} Normalized rating (0-10) or null if invalid
 */
function normalizeRating(value, type = 'direct') {
  switch (type) {
    case 'direct':
      return normalizeDirectRating(value);
    
    case 'views':
      return normalizeViewCount(value);
    
    case 'trending':
      // Trending position converted to a rating, but capped at 7.5
      // since it's not a real user rating (HentaiMama ratings should dominate)
      if (typeof value !== 'number' || isNaN(value)) return null;
      return Math.min(7.5, normalizeDirectRating(value));
    
    case 'percentage':
      // 0-100% to 0-10
      if (typeof value !== 'number' || isNaN(value)) return null;
      return Math.max(0, Math.min(10, value / 10));
    
    case 'stars':
      // 1-5 stars to 0-10
      if (typeof value !== 'number' || isNaN(value)) return null;
      return Math.max(0, Math.min(10, (value / 5) * 10));
    
    default:
      return normalizeDirectRating(value);
  }
}

/**
 * Calculate weighted average rating across providers
 * 
 * Logic:
 * 1. HentaiMama ratings get higher weight (2x) since they're direct user ratings
 * 2. Providers without ratings are excluded from average (not penalized)
 * 3. If only view-based ratings exist and views < threshold, use default rating
 * 4. If HentaiMama has a rating, it has more influence even on low-view content
 * 
 * @param {Object} ratingBreakdown - Map of provider prefix to rating info
 *   Example: { hmm: { raw: 8.6, normalized: 8.6, type: 'direct' }, hse: null }
 *   OR:      { hmm: { raw: 8.6, type: 'direct' } } - normalized will be calculated
 * @returns {number} Weighted average rating (0-10), defaults to 6.0 if no ratings
 */
function calculateWeightedAverage(ratingBreakdown) {
  if (!ratingBreakdown || typeof ratingBreakdown !== 'object') {
    return CONFIG.DEFAULT_RATING;
  }
  
  let totalWeight = 0;
  let weightedSum = 0;
  let hasHentaiMamaRating = false;
  
  for (const [provider, ratingInfo] of Object.entries(ratingBreakdown)) {
    if (!ratingInfo) continue;
    
    // Get or calculate normalized value
    let normalized = ratingInfo.normalized;
    
    // If normalized is missing, calculate it from raw + type
    if (normalized === null || normalized === undefined) {
      const raw = ratingInfo.raw;
      const type = ratingInfo.type || 'direct';
      
      if (raw === null || raw === undefined) continue;
      
      // Normalize based on type
      if (type === 'views') {
        normalized = normalizeViewCount(raw);
      } else if (type === 'trending') {
        // Trending ratings are capped at 7.5
        normalized = Math.min(7.5, normalizeDirectRating(raw));
      } else {
        normalized = normalizeDirectRating(raw);
      }
    }
    
    // Skip if normalization failed
    if (normalized === null || normalized === undefined) continue;
    
    const weight = CONFIG.PROVIDER_WEIGHTS[provider] || 1.0;
    
    if (provider === 'hmm' && normalized !== null) {
      hasHentaiMamaRating = true;
    }
    
    weightedSum += normalized * weight;
    totalWeight += weight;
  }
  
  // If no valid ratings, return default
  if (totalWeight === 0) {
    return CONFIG.DEFAULT_RATING;
  }
  
  const average = weightedSum / totalWeight;
  
  // Round to 1 decimal place
  return Math.round(average * 10) / 10;
}

/**
 * Create a rating breakdown object for a series
 * @param {Object} ratings - Map of provider prefix to raw rating data
 *   Example: { hmm: { value: 8.6, type: 'direct' }, hse: { value: 5000, type: 'views' } }
 * @returns {Object} Rating breakdown with raw and normalized values
 */
function createRatingBreakdown(ratings) {
  const breakdown = {};
  
  for (const [provider, data] of Object.entries(ratings)) {
    if (!data || data.value === null || data.value === undefined) {
      breakdown[provider] = null;
      continue;
    }
    
    const normalized = normalizeRating(data.value, data.type || 'direct');
    
    breakdown[provider] = {
      raw: data.value,
      normalized: normalized,
      type: data.type || 'direct'
    };
  }
  
  return breakdown;
}

/**
 * Format rating for display in Stremio
 * Shows the rating where runtime would normally appear
 * 
 * @param {number} rating - Normalized rating (0-10)
 * @param {Object} ratingBreakdown - Optional breakdown for tooltip
 * @returns {string} Formatted rating string
 */
function formatRatingForDisplay(rating, ratingBreakdown = null) {
  if (rating === null || rating === undefined || isNaN(rating)) {
    return '';
  }
  
  // Format as "8.5" - no star icon needed since Stremio shows its own
  return rating.toFixed(1);
}

/**
 * Format detailed rating breakdown for metadata view
 * @param {Object} ratingBreakdown - Provider ratings breakdown
 * @returns {string} Formatted breakdown string
 */
function formatRatingBreakdown(ratingBreakdown) {
  if (!ratingBreakdown || Object.keys(ratingBreakdown).length === 0) {
    return '';
  }
  
  const providerNames = {
    hmm: 'HentaiMama',
    hse: 'HentaiSea',
    htv: 'HentaiTV',
  };
  
  const parts = [];
  
  for (const [provider, info] of Object.entries(ratingBreakdown)) {
    if (!info || info.normalized === null) continue;
    
    const name = providerNames[provider] || provider;
    
    if (info.type === 'views') {
      parts.push(`${name}: ${info.raw.toLocaleString()} views`);
    } else {
      parts.push(`${name}: ${info.normalized}/10`);
    }
  }
  
  return parts.join(' | ');
}

module.exports = {
  normalizeRating,
  normalizeDirectRating,
  normalizeViewCount,
  calculateWeightedAverage,
  createRatingBreakdown,
  formatRatingForDisplay,
  formatRatingBreakdown,
  CONFIG
};
