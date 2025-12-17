const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('../utils/logger');
const { spawn } = require('child_process');
const path = require('path');

/**
 * OppaiStream Scraper
 * 
 * LIMITATION: OppaiStream is a React/Next.js SPA (Single Page Application).
 * Episode links are loaded dynamically via JavaScript, not in initial HTML.
 * 
 * CURRENT IMPLEMENTATION:
 * - getCatalog(): Returns empty array (cannot scrape without browser automation)
 * - getMetadata(): Returns null (no catalog = no metadata)
 * - getStreams(): WORKS via yt-dlp plugin when episode URL is known
 * 
 * USAGE:
 * - Cannot provide its own catalog entries
 * - Can provide alternative streams for episodes IF we know the OppaiStream episode URL
 * - Requires manual URL mapping or series name matching to find episodes
 * 
 * FUTURE IMPROVEMENTS:
 * - Add puppeteer/playwright for browser automation (catalog scraping)
 * - Discover OppaiStream API endpoints (if available)
 * - Implement series name → OppaiStream URL mapping
 */
class OppaiStreamScraper {
  constructor() {
    this.baseUrl = 'https://oppai.stream';
    this.name = 'OppaiStream';
    this.prefix = 'os';
  }

  /**
   * Get catalog from OppaiStream home page
   * @param {number} page - Page number (1-indexed)
   * @param {string} genre - Genre/tag filter (optional)
   * @param {string} sortBy - Sort order: 'recent', 'trending', 'random'
   */
  async getCatalog(page = 1, genre = null, sortBy = 'recent') {
    try {
      let url;
      
      if (genre) {
        // Genre/tag search: https://oppai.stream/search?g={genre}
        url = `${this.baseUrl}/search?g=${encodeURIComponent(genre)}`;
      } else if (sortBy === 'trending') {
        // Top 10 / Trending: https://oppai.stream/search?a=trending
        url = `${this.baseUrl}/search?a=trending`;
      } else if (sortBy === 'random') {
        // Random: https://oppai.stream/search?a=random
        url = `${this.baseUrl}/search?a=random`;
      } else {
        // Recent uploads (default): https://oppai.stream/search?a=uploaded
        url = `${this.baseUrl}/search?a=uploaded`;
      }

      logger.info(`Fetching OppaiStream catalog: ${url}`);
      
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': this.baseUrl
        }
      });

      // OppaiStream is a React/Next.js SPA that loads content via JavaScript
      // Cheerio cannot scrape dynamic content - would need puppeteer/playwright
      // Strategy: Skip catalog scraping, only provide streams via yt-dlp
      logger.info(`OppaiStream catalog scraping skipped (React SPA) - will provide streams only`);
      
      return [];

    } catch (error) {
      logger.error(`Error fetching OppaiStream catalog: ${error.message}`);
      return [];
    }
  }

  /**
   * Get metadata for a specific series
   * @param {string} seriesId - Series ID (format: "os-series-slug")
   */
  async getMetadata(seriesId) {
    try {
      const slug = seriesId.replace(`${this.prefix}-`, '');
      
      // OppaiStream has series pages: https://oppai.stream/series?a={slug}
      const seriesUrl = `${this.baseUrl}/series?a=${slug}`;
      
      logger.info(`Fetching OppaiStream series: ${seriesUrl}`);
      
      const response = await axios.get(seriesUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': this.baseUrl
        }
      });

      const $ = cheerio.load(response.data);

      // Extract series title
      let title = $('h1').first().text().trim() ||
                 $('title').text().replace(' - Oppai.stream', '').trim() ||
                 slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

      // Extract poster
      let poster = $('img[src*="myspacecat.pictures"], img.cover-img-in').first().attr('src') || '';
      if (poster && !poster.startsWith('http')) {
        poster = poster.startsWith('//') ? `https:${poster}` : `${this.baseUrl}${poster}`;
      }

      // Extract description (if available)
      const description = $('p.description, .series-description').first().text().trim() || 
                         'High quality hentai anime streaming on OppaiStream';

      // Find all episodes for this series
      const episodes = [];
      $('a[href*="/watch?e="]').each((i, elem) => {
        const $elem = $(elem);
        const href = $elem.attr('href');
        
        if (!href) return;

        const match = href.match(/\/watch\?e=([^&]+)/);
        if (!match) return;

        const episodeSlug = match[1];
        
        // Check if this episode belongs to this series
        if (!episodeSlug.toLowerCase().includes(slug.toLowerCase())) return;

        const episodeMatch = episodeSlug.match(/[-\s](?:Episode[-\s])?(\d+)$/i);
        const episodeNumber = episodeMatch ? parseInt(episodeMatch[1]) : episodes.length + 1;

        const $thumbnail = $elem.find('img').first();
        const episodePoster = $thumbnail.attr('src') || $thumbnail.attr('data-src') || poster;

        episodes.push({
          id: `${this.prefix}-${episodeSlug}`,
          number: episodeNumber,
          title: `Episode ${episodeNumber}`,
          poster: episodePoster.startsWith('http') ? episodePoster : `https:${episodePoster}`,
          episodeSlug: episodeSlug
        });
      });

      // Sort episodes by number
      episodes.sort((a, b) => a.number - b.number);

      logger.info(`Found ${episodes.length} episodes for ${title}`);

      return {
        id: seriesId,
        seriesId: seriesId,
        seriesSlug: slug,
        name: title,
        poster: poster || undefined,
        description: description,
        genres: ['Hentai'],
        type: 'series',
        episodes: episodes
      };

    } catch (error) {
      const errorMsg = error.response?.status === 404 
        ? `Series not found (404): ${seriesId}`
        : `${error.message} (${error.response?.status || 'unknown'})`;
      
      logger.error(`Error fetching OppaiStream metadata for ${seriesId}: ${errorMsg}`);
      return null;
    }
  }

  /**
   * Get stream URLs for an episode using yt-dlp
   * @param {string} episodeId - Episode ID (format: "os-episode-slug")
   */
  async getStreams(episodeId) {
    try {
      const slug = episodeId.replace(`${this.prefix}-`, '');
      const episodeUrl = `${this.baseUrl}/watch?e=${slug}`;
      
      logger.info(`Fetching OppaiStream streams for: ${episodeUrl}`);

      // Use yt-dlp plugin to extract streams
      const ytdlpPath = path.join(__dirname, '../../yt_dlp_plugins');
      
      return new Promise((resolve, reject) => {
        const args = [
          '-m', 'yt_dlp',
          '--paths', ytdlpPath,
          '-g', // Get direct URL only (no JSON)
          '--no-warnings',
          episodeUrl
        ];

        const ytdlp = spawn('python', args, {
          stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        ytdlp.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        ytdlp.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        ytdlp.on('close', (code) => {
          if (code !== 0) {
            logger.error(`yt-dlp error for ${episodeId}: ${stderr}`);
            return resolve([]);
          }

          try {
            // -g flag returns direct URLs, one per line (best quality)
            const urls = stdout.trim().split('\n').filter(u => u);
            
            if (urls.length === 0) {
              logger.warn(`No stream URLs extracted for ${episodeId}`);
              return resolve([]);
            }

            // yt-dlp with -g returns best format URL
            const stream = {
              url: urls[0], // Best quality URL
              quality: '1080p', // We don't know exact quality from -g
              title: `${this.name} - Best Quality`,
              name: 'Best Quality',
              provider: this.name
            };

            logger.info(`Found ${urls.length} stream(s) for ${episodeId}`);
            resolve([stream]);

          } catch (error) {
            logger.error(`Failed to parse yt-dlp output for ${episodeId}: ${error.message}`);
            resolve([]);
          }
        });
      });

    } catch (error) {
      logger.error(`Error getting OppaiStream streams for ${episodeId}: ${error.message}`);
      return [];
    }
  }
}

module.exports = new OppaiStreamScraper();
