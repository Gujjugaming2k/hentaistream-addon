const cache = require('../../cache');
const logger = require('../../utils/logger');
const hentaimamaScraper = require('../../scrapers/hentaimama');
const oppaiStreamScraper = require('../../scrapers/oppaistream');
const hentaiseaScraper = require('../../scrapers/hentaisea');
const hentaitvScraper = require('../../scrapers/hentaitv');
const config = require('../../config/env');

/**
 * Mark a series as broken (returns 500 errors)
 * These will be filtered from catalog results
 */
async function markSeriesAsBroken(seriesId) {
  const brokenSeriesKey = cache.key('system', 'broken-series');
  const brokenSeries = await cache.get(brokenSeriesKey) || [];
  
  if (!brokenSeries.includes(seriesId)) {
    brokenSeries.push(seriesId);
    // Store for 24 hours - broken series may get fixed
    await cache.set(brokenSeriesKey, brokenSeries, 86400);
    logger.info(`Marked series as broken: ${seriesId}`);
  }
}

/**
 * Meta handler
 */
async function metaHandler(args) {
  const { type, id } = args;
  
  logger.info(`Meta request: ${id}`, { type });

  // Validate type
  if (type !== 'series') {
    logger.warn(`Unsupported type: ${type}`);
    return { meta: null };
  }

  const cacheKey = cache.key('meta', id);
  const ttl = cache.getTTL('meta');

  return cache.wrap(cacheKey, ttl, async () => {
    let data;
    try {
      // Determine which scraper to use based on ID prefix
      let scraper = hentaimamaScraper; // Default
      
      if (id.startsWith('hmm-') || id.startsWith('hentaimama-')) {
        scraper = hentaimamaScraper;
      } else if (id.startsWith('hse-') || id.startsWith('hentaisea-')) {
        scraper = hentaiseaScraper;
      } else if (id.startsWith('htv-') || id.startsWith('hentaitv-')) {
        scraper = hentaitvScraper;
      } else if (id.startsWith('os-') || id.startsWith('oppaistream-')) {
        scraper = oppaiStreamScraper;
      }
      
      data = await scraper.getMetadata(id);
    } catch (error) {
      logger.error(`Failed to fetch metadata for ${id}: ${error.message}`);
      
      // Mark series as broken if it returns 500 error
      if (error.message?.includes('500') || error.response?.status === 500) {
        await markSeriesAsBroken(id);
      }
      
      return { meta: null };
    }
    
    if (!data) {
      logger.warn(`No metadata found for ${id}`);
      return { meta: null };
    }

    // Build rating breakdown for description (if multiple providers)
    let ratingBreakdownText = '';
    if (data.ratingBreakdown && Object.keys(data.ratingBreakdown).length > 1) {
      const providerNames = {
        hmm: 'HentaiMama',
        htv: 'HentaiTV',
        hse: 'HentaiSea'
      };
      
      const parts = Object.entries(data.ratingBreakdown)
        .map(([prefix, ratingInfo]) => {
          const name = providerNames[prefix] || prefix;
          if (typeof ratingInfo === 'object' && ratingInfo !== null) {
            if (ratingInfo.type === 'views') {
              const viewsFormatted = ratingInfo.raw >= 1000 
                ? `${(ratingInfo.raw / 1000).toFixed(1)}k` 
                : ratingInfo.raw;
              return `${name}: ${viewsFormatted} views`;
            } else {
              return `${name}: ${ratingInfo.raw || ratingInfo.normalized}/10`;
            }
          }
          return `${name}: ${ratingInfo}/10`;
        });
      
      ratingBreakdownText = `\n\nRatings: ${parts.join(' | ')}`;
    }
    
    // Build genre data for Stremio
    // When `links` is present, Stremio ignores the `genres` array for display
    // So we need to put BOTH genres AND studio into the links array
    const genres = data.genres || [];
    
    // Debug: log what data we have
    logger.info(`Meta data for ${data.name}: studio="${data.studio || 'none'}", genres=${genres.length > 0 ? genres.join(', ') : 'none'}`);
    
    // Build links array with BOTH genres and studio
    const isLocalhost = config.server.baseUrl.includes('localhost') || config.server.baseUrl.includes('127.0.0.1');
    const manifestUrl = `${config.server.baseUrl}/manifest.json`;
    
    // Genre links
    const genreLinks = genres.map(genre => ({
      name: genre,
      category: 'Genres',
      url: isLocalhost 
        ? `stremio:///search?search=${encodeURIComponent(genre)}`
        : `stremio:///discover/${encodeURIComponent(manifestUrl)}/series/hentai?genre=${encodeURIComponent(genre)}`
    }));
    
    // Studio link
    const studioLinks = data.studio ? [{
      name: data.studio,
      category: 'Studio',
      url: `stremio:///search?search=${encodeURIComponent(data.studio)}`
    }] : [];
    
    // Combine all links - genres first, then studio (for display order)
    const allLinks = [...genreLinks, ...studioLinks];
    
    // Calculate display rating (same logic as catalog)
    let displayRating = undefined;
    if (data.rating && data.rating !== 6.0) {
      displayRating = `★ ${data.rating.toFixed(1)}`;
    }
    
    // Transform to Stremio meta format
    const meta = {
      id: data.seriesId || data.id,
      type: 'series',
      name: data.name,
      poster: data.poster || undefined,
      background: data.poster || undefined,
      description: (data.description || '') + ratingBreakdownText,
      releaseInfo: data.releaseInfo || data.year || undefined,
      // Show rating in runtime field (avoids IMDb logo)
      runtime: displayRating,
      // Keep genres array for backwards compatibility and catalog filtering
      genres: genres.length > 0 ? genres : undefined,
      // Links array with BOTH genres and studio - this is what Stremio displays
      links: allLinks.length > 0 ? allLinks : undefined,
      // Build videos array from episodes with individual thumbnails
      videos: (data.episodes || []).map(ep => ({
        id: `${ep.id}:1:${ep.number}`,
        title: ep.title || `Episode ${ep.number}`,
        season: 1,
        episode: ep.number,
        thumbnail: ep.poster || data.poster || undefined, // Use episode's poster first
      })),
    };
    
    // If no episodes, create a single episode entry
    if (meta.videos.length === 0) {
      meta.videos = [{
        id: `${data.id}:1:1`,
        title: data.name,
        season: 1,
        episode: 1,
        thumbnail: data.poster || undefined,
      }];
    }

    return { meta };
  });
}

module.exports = metaHandler;
