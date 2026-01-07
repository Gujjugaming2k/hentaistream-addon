/**
 * Lightweight stream handler that delegates scraping to Cloudflare Workers.
 * This removes heavy HTML parsing from the Render server and keeps memory low.
 */

const logger = require('../../utils/logger');
const parser = require('../../utils/parser');
const config = require('../../config/env');

// Worker URLs from environment
const WORKER_HENTAIMAMA = process.env.WORKER_HENTAIMAMA || '';
const WORKER_HENTAISEA = process.env.WORKER_HENTAISEA || '';
const WORKER_HENTAITV = process.env.WORKER_HENTAITV || '';

const workersConfigured = Boolean(WORKER_HENTAIMAMA || WORKER_HENTAISEA || WORKER_HENTAITV);
if (!workersConfigured) {
  logger.warn('[Stream] Cloudflare Worker URLs not set (WORKER_HENTAIMAMA/WORKER_HENTAISEA/WORKER_HENTAITV)');
}

async function fetchFromWorker(workerUrl, episodeId, providerName, timeout = 15000) {
  if (!workerUrl) return [];
  const url = `${workerUrl}?action=stream&id=${encodeURIComponent(episodeId)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'HentaiStream-Addon/1.0' },
    });
    clearTimeout(timer);
    if (!res.ok) {
      logger.debug(`[${providerName}] Worker HTTP ${res.status}`);
      return [];
    }
    const json = await res.json().catch(() => null);
    if (json && Array.isArray(json.streams)) {
      logger.debug(`[${providerName}] ${json.streams.length} streams`);
      return json.streams;
    }
    return [];
  } catch (err) {
    clearTimeout(timer);
    if (err && err.name === 'AbortError') logger.debug(`[${providerName}] worker timeout ${timeout}ms`);
    else logger.debug(`[${providerName}] worker error: ${err?.message || err}`);
    return [];
  }
}

function cleanProviderSlug(slug) {
  return slug
    .replace(/^hmm-/i, '')
    .replace(/^hse-/i, '')
    .replace(/^htv-/i, '')
    .replace(/^hentaimama-/i, '')
    .replace(/^hentaisea-/i, '')
    .replace(/^hentaitv-/i, '')
    .replace(/^hentai-/i, '');
}

async function streamHandler(args) {
  const { type, id } = args;
  
  // VERBOSE LOGGING FOR DEBUGGING
  logger.info(`[STREAM] ========== STREAM REQUEST ==========`);
  logger.info(`[STREAM] args: ${JSON.stringify(args)}`);
  logger.info(`[STREAM] type: "${type}", id: "${id}"`);
  
  if (type !== 'series' && type !== 'hentai') {
    logger.info(`[STREAM] REJECTED: type "${type}" not supported (need series or hentai)`);
    return { streams: [] };
  }

  const parsed = parser.parseVideoId(id);
  logger.info(`[STREAM] parseVideoId result: ${JSON.stringify(parsed)}`);
  const { slug } = parsed;
  
  const episodeMatch = id.match(/:(\d+):(\d+)$/);
  logger.info(`[STREAM] episodeMatch: ${JSON.stringify(episodeMatch)}`);
  const episodeNum = episodeMatch ? episodeMatch[2] : '1';

  const baseSlug = cleanProviderSlug(slug);
  const episodeId = `${baseSlug}-episode-${episodeNum}`;
  logger.info(`[STREAM] slug="${slug}" -> baseSlug="${baseSlug}" -> episodeId="${episodeId}"`);
  logger.info(`[STREAM] Workers configured: HMM=${!!WORKER_HENTAIMAMA}, HSE=${!!WORKER_HENTAISEA}, HTV=${!!WORKER_HENTAITV}`);

  const [hmm, hse, htv] = await Promise.allSettled([
    fetchFromWorker(WORKER_HENTAIMAMA, episodeId, 'HentaiMama'),
    fetchFromWorker(WORKER_HENTAISEA, episodeId, 'HentaiSea'),
    fetchFromWorker(WORKER_HENTAITV, episodeId, 'HentaiTV'),
  ]);

  logger.info(`[STREAM] Worker results: HMM=${hmm.status}(${hmm.value?.length || 0}), HSE=${hse.status}(${hse.value?.length || 0}), HTV=${htv.status}(${htv.value?.length || 0})`);

  const all = [];
  if (hmm.status === 'fulfilled' && hmm.value?.length) all.push(...hmm.value);
  if (hse.status === 'fulfilled' && hse.value?.length) all.push(...hse.value);
  if (htv.status === 'fulfilled' && htv.value?.length) all.push(...htv.value);

  logger.info(`[STREAM] Total streams collected: ${all.length}`);
  
  if (!all.length) {
    logger.info(`[STREAM] NO STREAMS FOUND - returning empty`);
    return { streams: [] };
  }

  const baseUrl = config.server.baseUrl;

  const stremioStreams = all.map((s) => {
    const q = s.quality && s.quality !== 'Unknown' ? ` - ${s.quality}` : '';
    const raw = s.isRaw ? ' - RAW' : '';
    let url = s.url;

    if (s.needsProxy && s.proxyType === 'jwplayer' && s.jwplayerUrl) {
      url = `${baseUrl}/video-proxy?jwplayer=${encodeURIComponent(s.jwplayerUrl)}`;
    }

    return {
      name: s.provider || 'Source',
      title: `Episode ${episodeNum}${q}${raw}`,
      url,
    };
  }).filter(x => Boolean(x.url));

  return { streams: stremioStreams };
}

module.exports = streamHandler;
