import Anthropic from '@anthropic-ai/sdk';
import { TwitterApi } from 'twitter-api-v2';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import cron from 'node-cron';

dotenv.config();

/**
 * ========================================================
 * BRAND RULES (DO NOT VIOLATE)
 * ========================================================
 * - Never output the word "Farcaster" in any reply/post.
 * - User-facing copy must say BaseApp / BaseApp activity / BaseApp profile.
 *
 * LINK RULE (UPDATED):
 * - Replies should NOT include the miniapp link.
 * - The miniapp link should appear ONLY in the "overview" reply.
 * - (Standalone daily posts may include the miniapp link.)
 */

const OVERVIEW_FOOTER = [
  'Visit Baseapp reward dashboard miniapp on @baseapp:',
  'https://base.app/app/baseapp-reward-dashboard.vercel.app',
].join('\n');

const HELP_TEXT = (mentionUsername) => [
  `Hey @${mentionUsername}! I'm here to help with BaseApp rewards and social info! 🎯`,
  '',
  'Try these:',
  '• show data for [baseapp username]',
  '• weekly — weekly leaderboard',
  '• alltime — alltime leaderboard',
  '• reward — overall distribution info',
  '• breakdown — latest week reward breakdown',
  '',
  'What would you like to know? 🚀',
].join('\n');

function mustHaveFooter(kind) {
  // kind: 'help' | 'clarify' | 'normal' | 'overview' | 'daily'
  // Only OVERVIEW replies (and standalone daily posts) should include the link.
  return kind === 'overview' || kind === 'daily';
}

function appendFooter(text, kind) {
  if (!mustHaveFooter(kind)) return text;
  if (text.includes(OVERVIEW_FOOTER)) return text;
  return `${text}\n\n${OVERVIEW_FOOTER}`;
}

function utcDateYmd(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isoAtUtcMidnight(dateStrYmd) {
  // "2026-02-04" -> "2026-02-04T00:00:00Z"
  return `${dateStrYmd}T00:00:00Z`;
}

function addDaysIso(iso, days) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const out = new Date(ms + days * 24 * 60 * 60 * 1000);
  return out.toISOString();
}

function formatMoney(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v ?? '0');
  // no trailing .00 if int
  return n % 1 === 0 ? String(n.toFixed(0)) : String(n.toFixed(2));
}

function arrowPct(pctStr) {
  if (!pctStr) return '—';
  const n = Number(pctStr);
  if (!Number.isFinite(n)) return '—';
  const arrow = n > 0 ? '⬆️' : (n < 0 ? '⬇️' : '➡️');
  const sign = n > 0 ? '+' : '';
  return `${arrow} ${sign}${n.toFixed(2)}%`;
}

function normalizeIdentifier(raw) {
  if (!raw) return '';
  let s = String(raw).trim().toLowerCase();

  // strip surrounding punctuation
  s = s.replace(/^[^a-z0-9@]+/g, '');
  s = s.replace(/[^a-z0-9.:-]+$/g, '');

  // remove leading @
  s = s.replace(/^@+/, '');

  // remove embedded punctuation around tokens (common in sentences)
  s = s.replace(/[,\)\]\}]+$/g, '');
  s = s.replace(/^[\(\[\{]+/g, '');

  return s.trim();
}

function baseName(usernameOrToken) {
  const s = normalizeIdentifier(usernameOrToken);
  // femiii.base.eth -> femiii
  // femiii.eth -> femiii
  // femiii -> femiii
  return s.split('.')[0] || s;
}

function isEthAddress(s) {
  return /^0x[a-f0-9]{40}$/.test(normalizeIdentifier(s));
}

function extractFirstIdentifier(message) {
  const text = String(message || '');

  // 0x...
  const addr = text.match(/0x[a-fA-F0-9]{40}/);
  if (addr) return { kind: 'address', value: normalizeIdentifier(addr[0]) };

  // Prefer explicit BaseApp usernames (with .eth suffix) or explicit @mentions.
  // This avoids treating casual words like "hi" as a username.
  const u = text.match(/@?[\w-]+(?:\.base\.eth|\.eth)/i); // require .eth suffix
  if (u) return { kind: 'username', value: normalizeIdentifier(u[0]) };

  const at = text.match(/@[\w-]+/i); // allow @name (no .eth)
  if (at) return { kind: 'username', value: normalizeIdentifier(at[0]) };

  return { kind: 'none', value: '' };
}


/**
 * ========================================================
 * Twitter client
 * ========================================================
 */
const client = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
});
const rwClient = client.readWrite;

/**
 * ========================================================
 * Anthropic (GENERAL CHAT ONLY; must not decide identity matching)
 * ========================================================
 */
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * ========================================================
 * Persistent State (Fix Issue #1)
 * ========================================================
 */
const STATE_PATH = process.env.STATE_FILE || './state.json';

const DEFAULT_STATE = {
  lastMentionId: null,
  processedMentionIds: [],
  latestWeekStartUtc: null,
  dailyPost: {
    date: null,
    weekStartUtc: null,
    cursor: 0,
    postedSlots: [],
  },
};

let state = structuredClone(DEFAULT_STATE);

async function atomicWriteJson(filePath, obj) {
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2), 'utf-8');
  await fs.rename(tmp, filePath);
}

async function loadState() {
  try {
    const raw = await fs.readFile(STATE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    state = {
      ...structuredClone(DEFAULT_STATE),
      ...parsed,
      dailyPost: {
        ...structuredClone(DEFAULT_STATE.dailyPost),
        ...(parsed.dailyPost || {}),
      },
    };
  } catch (e) {
    // create fresh state file
    state = structuredClone(DEFAULT_STATE);
    await atomicWriteJson(STATE_PATH, state);
  }
}

async function persistState() {
  await atomicWriteJson(STATE_PATH, state);
}

function rememberProcessedMention(id) {
  if (!id) return;
  if (!state.processedMentionIds.includes(id)) state.processedMentionIds.push(id);
  // keep bounded to avoid unbounded growth
  const MAX = Number(process.env.MAX_PROCESSED_MENTIONS || 5000);
  if (state.processedMentionIds.length > MAX) {
    state.processedMentionIds = state.processedMentionIds.slice(-MAX);
  }
}

/**
 * ========================================================
 * Local Data Cache
 * ========================================================
 */
let dataCache = {
  overview: null,
  allTimeLeaderboard: null,
  weeklyLeaderboard: null,
  weeklyMeta: null,
  farcasterMap: null, // local user map (keep internal naming; not user-facing)
  lastUpdated: null,

  // indexes
  byUsername: new Map(),      // normalized full username => record
  byBaseName: new Map(),      // baseName => [record,...]
  byVerifiedAddr: new Map(),  // verified eth address => record
};

async function loadData() {
  console.log('🔄 Loading data from local files...');
  const dataDir = process.env.DATA_DIR || './data';

  const [overview, allTime, weeklyLatest, weeklyMeta, farcaster] = await Promise.all([
    fs.readFile(path.join(dataDir, 'overview.json'), 'utf-8'),
    fs.readFile(path.join(dataDir, 'leaderboard_all_time.json'), 'utf-8'),
    fs.readFile(path.join(dataDir, 'leaderboard_weekly_latest.json'), 'utf-8'),
    fs.readFile(path.join(dataDir, 'weekly.json'), 'utf-8'),
    fs.readFile(path.join(dataDir, 'farcaster_map.json'), 'utf-8'),
  ]);

  dataCache.overview = JSON.parse(overview);
  dataCache.allTimeLeaderboard = JSON.parse(allTime);
  dataCache.weeklyLeaderboard = JSON.parse(weeklyLatest);
  dataCache.weeklyMeta = JSON.parse(weeklyMeta);
  dataCache.farcasterMap = JSON.parse(farcaster);
  dataCache.lastUpdated = new Date();

  buildIndexes();

  // Keep a copy in state for autopost week-change detection
  const latestWeekStart = dataCache.weeklyLeaderboard?.latest_week_start_utc || null;
  if (latestWeekStart && state.latestWeekStartUtc !== latestWeekStart) {
    state.latestWeekStartUtc = latestWeekStart;
    await persistState();
  }

  console.log('✅ Data loaded');
}

function buildIndexes() {
  dataCache.byUsername = new Map();
  dataCache.byBaseName = new Map();
  dataCache.byVerifiedAddr = new Map();

  for (const [rewardAddrRaw, userData] of Object.entries(dataCache.farcasterMap || {})) {
    if (!userData || userData.status !== 'ok') continue;

    const rewardAddr = normalizeIdentifier(rewardAddrRaw);
    const username = normalizeIdentifier(userData.username || '');
    const bname = baseName(username);

    const rec = {
      rewardAddressKey: rewardAddr, // address key in local map
      fid: userData.fid,
      username, // full username like femiii.base.eth
      display_name: userData.display_name || null,
      follower_count: userData.follower_count ?? null,
      following_count: userData.following_count ?? null,
      verified_eth_addresses: (userData.verified_addresses?.eth_addresses || userData.verifications || [])
        .map((a) => normalizeIdentifier(a))
        .filter((a) => isEthAddress(a)),
      raw: userData,
    };

    if (username) dataCache.byUsername.set(username, rec);

    if (bname) {
      const arr = dataCache.byBaseName.get(bname) || [];
      arr.push(rec);
      dataCache.byBaseName.set(bname, arr);
    }

    // Reward key itself should be searchable
    if (isEthAddress(rewardAddr)) {
      dataCache.byVerifiedAddr.set(rewardAddr, rec);
    }
    for (const a of rec.verified_eth_addresses) {
      if (!dataCache.byVerifiedAddr.has(a)) dataCache.byVerifiedAddr.set(a, rec);
    }
  }
}

function getWeekMetaByStart(weekStartUtcYmd) {
  const weeks = dataCache.weeklyMeta?.weeks || [];
  return weeks.find((w) => w.week_start_utc === weekStartUtcYmd) || null;
}

function getLeaderboardAllTimeEntry(address) {
  const rows = dataCache.allTimeLeaderboard?.rows || [];
  const a = normalizeIdentifier(address);
  return rows.find((r) => normalizeIdentifier(r.address) === a) || null;
}

function getLeaderboardWeeklyEntry(address) {
  const rows = dataCache.weeklyLeaderboard?.rows || [];
  const a = normalizeIdentifier(address);
  return rows.find((r) => normalizeIdentifier(r.address) === a) || null;
}

function pickRewardAddress(rec) {
  // prefer an eth address that exists in rewards data
  const candidates = [
    rec.rewardAddressKey,
    ...(rec.verified_eth_addresses || []),
  ].filter((a) => isEthAddress(a));

  const scored = candidates.map((a) => {
    const all = getLeaderboardAllTimeEntry(a);
    const weekly = getLeaderboardWeeklyEntry(a);
    const allUsd = all ? Number(all.total_usdc) : 0;
    const weeklyUsd = weekly ? Number(weekly.this_week_usdc) : 0;
    return { addr: a, score: (Number.isFinite(allUsd) ? allUsd : 0) * 1000 + (Number.isFinite(weeklyUsd) ? weeklyUsd : 0) };
  });

  scored.sort((x, y) => y.score - x.score);

  // prefer addresses present in any leaderboard; else keep original rewardAddressKey
  for (const s of scored) {
    if (getLeaderboardAllTimeEntry(s.addr) || getLeaderboardWeeklyEntry(s.addr)) return s.addr;
  }
  return rec.rewardAddressKey;
}

function resolveUserLocal(identifierRaw) {
  const identifier = normalizeIdentifier(identifierRaw);
  if (!identifier) return { ok: false, reason: 'missing' };

  if (isEthAddress(identifier)) {
    const rec = dataCache.byVerifiedAddr.get(identifier);
    if (!rec) return { ok: false, reason: 'not_found' };
    return {
      ok: true,
      rec,
      rewardAddress: pickRewardAddress(rec),
    };
  }

  // 1) exact normalized full username
  if (dataCache.byUsername.has(identifier)) {
    const rec = dataCache.byUsername.get(identifier);
    return { ok: true, rec, rewardAddress: pickRewardAddress(rec) };
  }

  // 2) baseName match (must be unique)
  const b = baseName(identifier);
  const matches = dataCache.byBaseName.get(b) || [];
  if (matches.length === 1) {
    const rec = matches[0];
    return { ok: true, rec, rewardAddress: pickRewardAddress(rec) };
  }
  if (matches.length > 1) {
    return { ok: false, reason: 'ambiguous_base', base: b, count: matches.length };
  }

  return { ok: false, reason: 'not_found' };
}

/**
 * ========================================================
 * Neynar lookups (fallback only)
 * ========================================================
 */
async function neynarGet(url) {
  const apiKey = process.env.NEYNAR_API_KEY;
  if (!apiKey) throw new Error('Missing NEYNAR_API_KEY');
  const res = await fetch(url, {
    headers: {
      accept: 'application/json',
      api_key: apiKey,
      'x-api-key': apiKey, // some docs use x-api-key; harmless to include both
    },
  });
  return res;
}

async function resolveUserNeynar(identifierRaw) {
  // Fallback: try exact by_username, then search
  const identifier = normalizeIdentifier(identifierRaw);
  if (!identifier) return { ok: false, reason: 'missing' };

  // 1) exact username lookup
  try {
    const url = new URL('https://api.neynar.com/v2/farcaster/user/by_username');
    url.searchParams.set('username', identifier);
    const res = await neynarGet(url.toString());
    if (res.ok) {
      const json = await res.json();
      const user = json?.user;
      if (user?.fid) return { ok: true, user };
    }
  } catch {
    // continue
  }

  // 2) search endpoint (best-effort; API name in docs is "search-user")
  try {
    const url = new URL('https://api.neynar.com/v2/farcaster/user/search');
    url.searchParams.set('q', identifier);
    url.searchParams.set('limit', '5');
    const res = await neynarGet(url.toString());
    if (res.ok) {
      const json = await res.json();
      const users = json?.result?.users || json?.users || [];
      if (Array.isArray(users) && users.length) {
        const norm = normalizeIdentifier(identifier);
        const b = baseName(norm);

        // choose best match: exact username, then baseName, else no guess
        const exact = users.find((u) => normalizeIdentifier(u?.username) === norm);
        if (exact) return { ok: true, user: exact };

        const base = users.find((u) => baseName(u?.username || '') === b);
        if (base) return { ok: true, user: base };

        return { ok: false, reason: 'no_confident_match' };
      }
    }
  } catch {
    // continue
  }

  return { ok: false, reason: 'not_found' };
}

/**
 * ========================================================
 * BaseApp activity metrics (mirrors miniapp route exactly)
 * ========================================================
 */
const socialCache = new Map(); // key => { expiresAt, value }

function socialCacheGet(key) {
  const entry = socialCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    socialCache.delete(key);
    return null;
  }
  return entry.value;
}

function socialCacheSet(key, value, ttlMs) {
  socialCache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function safeNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseMs(iso) {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function castCreatedMs(cast) {
  const createdAt =
    cast?.created_at ??
    cast?.cast?.created_at ??
    cast?.timestamp ??
    cast?.cast?.timestamp;
  if (!createdAt) return null;
  return parseMs(createdAt);
}

function extractCounts(cast) {
  const reactions = cast?.reactions || {};
  const repliesObj = cast?.replies || {};
  const likes = safeNum(reactions.likes_count);
  const recasts = safeNum(reactions.recasts_count) || safeNum(reactions.recasts) || safeNum(reactions.recastsCount);
  const replies = safeNum(repliesObj.count);
  return { likes, recasts, replies };
}

async function fetchUserCasts(fid, startMs, endMs) {
  const apiKey = process.env.NEYNAR_API_KEY;
  if (!apiKey) throw new Error('Missing NEYNAR_API_KEY');

  const casts = [];
  let cursor = null;

  for (let page = 0; page < 20; page += 1) {
    const url = new URL('https://api.neynar.com/v2/farcaster/feed/user/casts');
    url.searchParams.set('fid', String(fid));
    url.searchParams.set('limit', '100');
    url.searchParams.set('include_replies', 'false');
    url.searchParams.set('include_recasts', 'false');
    if (cursor) url.searchParams.set('cursor', cursor);

    const res = await fetch(url.toString(), {
      headers: {
        accept: 'application/json',
        api_key: apiKey,
        'x-api-key': apiKey,
      },
    });

    if (!res.ok) throw new Error(`Neynar error: ${res.status}`);

    const json = await res.json();
    const items = Array.isArray(json?.casts) ? json.casts : [];

    for (const c of items) {
      const ms = castCreatedMs(c);
      if (ms == null) continue;
      if (ms >= startMs && ms < endMs) casts.push(c);
    }

    // stop early if last item is older than start
    const last = items.length ? items[items.length - 1] : null;
    const lastMs = last ? castCreatedMs(last) : null;
    if (lastMs != null && lastMs < startMs) break;

    cursor = typeof json?.next === 'string' ? json.next : (json?.next?.cursor || null);
    if (!cursor) break;
  }

  return casts;
}

async function getBaseAppActivity(fid, startIso, endIso) {
  const key = `${fid}|${startIso}|${endIso}`;
  const cached = socialCacheGet(key);
  if (cached) return cached;

  const startMs = parseMs(startIso);
  const endMs = parseMs(endIso);
  if (startMs == null || endMs == null || endMs <= startMs) throw new Error('Invalid window');

  const casts = await fetchUserCasts(fid, startMs, endMs);

  let likes = 0, recasts = 0, replies = 0;
  for (const c of casts) {
    const counts = extractCounts(c);
    likes += counts.likes;
    recasts += counts.recasts;
    replies += counts.replies;
  }

  const payload = { casts: casts.length, likes, recasts, replies };

  // TTL: 30 minutes default (15–60 min recommended)
  const ttlMs = Number(process.env.SOCIAL_CACHE_TTL_MS || 30 * 60 * 1000);
  socialCacheSet(key, payload, ttlMs);
  return payload;
}

/**
 * ========================================================
 * Deterministic Router (Fix Issue #F)
 * ========================================================
 */
function detectIntent(message) {
  const raw = String(message || '').trim();
  const lower = raw.toLowerCase();

  if (!raw) return { type: 'help' };

  if (/\bhelp\b|\bcommands?\b|\bhow do i\b|\bwhat can you do\b/i.test(lower)) return { type: 'help' };

  if (/\bbreakdown\b/i.test(lower)) return { type: 'breakdown' };

  if (/\ball\s*time\b|\balltime\b/i.test(lower)) return { type: 'alltime' };

  if (/\bweekly\b|\btop\b/i.test(lower)) return { type: 'weekly' };

  if (/\breward\b|\boverview\b|\bdistributed\b/i.test(lower)) return { type: 'overview' };

  if (/\bmy stats\b|\bmy data\b|\bmy profile\b/i.test(lower)) return { type: 'user_stats_needs_lookup' };

  // explicit "stats for X" / "show data for X"
  const m = lower.match(/\b(stats|data)\s+(for|of)\s+(.+)$/i);
  if (m && m[3]) {
    const extracted = extractFirstIdentifier(m[3]);
    if (extracted.kind !== 'none') return { type: 'user_stats', identifier: extracted.value };

    // Allow bare base names ONLY in explicit "stats/data for" commands (e.g., "stats for femiii")
    const token = normalizeIdentifier(String(m[3]).split(/\s+/)[0]);
    if (token) return { type: 'user_stats', identifier: token };
  }

  // general user identifier present
  const { kind, value } = extractFirstIdentifier(raw);
  if (kind === 'address') return { type: 'user_stats', identifier: value };
  if (kind === 'username') return { type: 'user_stats', identifier: value };

  return { type: 'general' };
}

/**
 * ========================================================
 * Reply Formatters (Fix Issue #2 + templates E1..E6)
 * ========================================================
 */
function buildClarifyUsername(mentionUsername) {
  return [
    `Hey @${mentionUsername}! Please share the exact BaseApp username you want me to check (example: femiii.base.eth).`,
  ].join('\n');
}

function formatWeeklyLeaderboardTopN(N = 10) {
  const rows = (dataCache.weeklyLeaderboard?.rows || []).slice(0, N);
  const weekStart = dataCache.weeklyLeaderboard?.latest_week_start_utc || '';
  const meta = getWeekMetaByStart(weekStart);
  const weekNumber = meta?.week_number ?? '?';
  const weekLabel = meta?.week_label ?? weekStart;

  let out = `🏆 WEEK ${weekNumber} LEADERBOARD — Top ${rows.length}\n`;
  for (const r of rows) {
    const addr = normalizeIdentifier(r.address);
    const rec = dataCache.byVerifiedAddr.get(addr);
    const uname = rec?.username ? rec.username : r.user_display;
    out += `#${r.rank} ${uname} — $${formatMoney(r.this_week_usdc)}\n`;
  }
  out += `\nReply “stats for <username>” to see your profile.`;
  return out;
}

function formatAllTimeLeaderboardTopN(N = 10) {
  const rows = (dataCache.allTimeLeaderboard?.rows || []).slice(0, N);

  let out = `🏆 ALL-TIME LEADERBOARD — Top ${rows.length}\n`;
  for (const r of rows) {
    const addr = normalizeIdentifier(r.address);
    const rec = dataCache.byVerifiedAddr.get(addr);
    const uname = rec?.username ? rec.username : r.user_display;
    out += `#${r.all_time_rank} ${uname} — $${formatMoney(r.total_usdc)}\n`;
  }
  out += `\nReply “stats for <username>” to see your profile.`;
  return out;
}

function formatOverview() {
  const o = dataCache.overview;
  const weekStart = dataCache.weeklyLeaderboard?.latest_week_start_utc || o?.latest_week?.week_start_utc || '';
  const meta = getWeekMetaByStart(weekStart);
  const weekNumber = meta?.week_number ?? '?';
  const weekLabel = meta?.week_label ?? weekStart;

  const latestUsd = formatMoney(o?.latest_week?.total_usdc ?? 0);
  const latestUsers = o?.latest_week?.unique_users ?? 0;
  const allUsd = formatMoney(o?.all_time?.total_usdc ?? 0);
  const allUsers = o?.all_time?.unique_users ?? 0;

  // Keep overview compact so it fits in a SINGLE reply (the link footer is appended).
  return `📊 BaseApp rewards overview — Week ${weekNumber} (${weekLabel})\nLatest week: $${latestUsd} • ${latestUsers} creators\nAll-time: $${allUsd} • ${Number(allUsers).toLocaleString?.() || allUsers} creators`;
}

function formatBreakdown() {
  const o = dataCache.overview;
  const weekStart = dataCache.weeklyLeaderboard?.latest_week_start_utc || o?.latest_week?.week_start_utc || '';
  const meta = getWeekMetaByStart(weekStart);
  const weekNumber = meta?.week_number ?? '?';
  const weekLabel = meta?.week_label ?? weekStart;

  const tiers = (o?.latest_week?.breakdown || []).slice(0, 6);
  const body = tiers.map((t) => `$${formatMoney(t.reward_usdc)}:${t.users}`).join(' • ');
  return `📊 Latest week breakdown — Week ${weekNumber} (${weekLabel})\n${body || 'No breakdown data.'}`;
}

async function formatUserStats(identifier) {
  // local first
  let resolved = resolveUserLocal(identifier);

  if (!resolved.ok) {
    // fallback to Neynar if not found (never guess)
    if (resolved.reason === 'ambiguous_base') {
      return { kind: 'clarify', text: `I found multiple BaseApp profiles that match “${resolved.base}”. Please reply with the exact BaseApp username (example: femiii.base.eth).` };
    }

    const neyn = await resolveUserNeynar(identifier);
    if (!neyn.ok) {
      return { kind: 'clarify', text: `I couldn’t find that BaseApp username. Please reply with the exact BaseApp username (example: femiii.base.eth).` };
    }

    // We have a Neynar user hydrated object; now choose reward address using their verified addresses
    const user = neyn.user;
    const fid = user.fid;
    const username = normalizeIdentifier(user.username || '');
    const verified = (user.verified_addresses?.eth_addresses || []).map((a) => normalizeIdentifier(a)).filter((a) => isEthAddress(a));

    const pseudoRec = {
      rewardAddressKey: verified[0] || null,
      fid,
      username,
      display_name: user.display_name || null,
      follower_count: user.follower_count ?? null,
      following_count: user.following_count ?? null,
      verified_eth_addresses: verified,
      raw: user,
    };

    resolved = { ok: true, rec: pseudoRec, rewardAddress: pickRewardAddress(pseudoRec) };
  }

  const rec = resolved.rec;
  const rewardAddress = resolved.rewardAddress;

  const weekly = getLeaderboardWeeklyEntry(rewardAddress);
  const allTime = getLeaderboardAllTimeEntry(rewardAddress);

  const weekStartYmd = dataCache.weeklyLeaderboard?.latest_week_start_utc || null;
  const meta = weekStartYmd ? getWeekMetaByStart(weekStartYmd) : null;
  const weekNumber = meta?.week_number ?? '?';
  const weekLabel = meta?.week_label ?? (weekStartYmd || '');

  const startIso = weekStartYmd ? isoAtUtcMidnight(weekStartYmd) : new Date().toISOString();
  const nowIso = new Date().toISOString();
  // BaseApp activity windows (mirrors miniapp)
  // Replies must be a SINGLE post, so we keep this output compact.
  let activityThis = null;

  try {
    if (rec.fid) {
      activityThis = await getBaseAppActivity(rec.fid, startIso, nowIso);
    }
  } catch {
    // leave null; handled below
  }

  const uname = rec.username || identifier;

  // Compact community counters (keep it short)
  const followerCount = rec.follower_count ?? rec.raw?.follower_count ?? 0;

  // Build a SINGLE-post reply (no threads). Keep under 280 chars.
  const followersShort = Number(followerCount).toLocaleString?.() || String(followerCount);
  const act = activityThis
    ? `P${activityThis.casts} L${activityThis.likes} Rc${activityThis.recasts} Rp${activityThis.replies}`
    : 'BaseApp activity temporarily unavailable';

  if (allTime || weekly) {
    const allTimeUsd = allTime?.total_usdc ?? 0;
    const allTimeRank = allTime?.all_time_rank ?? '—';
    const weeks = allTime?.total_weeks_earned ?? 0;

    const thisWeekUsd = weekly?.this_week_usdc ?? 0;
    const weeklyRank = weekly?.rank ?? '—';
    const prevWeekUsd = weekly?.previous_week_usdc ?? 0;
    const change = arrowPct(weekly?.pct_change);

    const out = `📊 baseapp stats: ${uname}\n💰 All-time: $${formatMoney(allTimeUsd)} (#${allTimeRank}) • Weeks ${weeks}\n📈 Week ${weekNumber}: $${formatMoney(thisWeekUsd)} (#${weeklyRank}) • Prev $${formatMoney(prevWeekUsd)} • ${change}\n📱 BaseApp activity (This Week): ${act}\n👥 Followers: ${followersShort}`;
    return { kind: 'normal', text: out };
  }

  const out = `📊 baseapp stats: ${uname}\nYou didn’t yet earn creator reward from @baseapp — keep creating 💙\n📱 BaseApp activity (This Week): ${act}\n👥 Followers: ${followersShort}`;
  return { kind: 'normal', text: out };
}

/**
 * ========================================================
 * General chat via Claude (no identity matching)
 * ========================================================
 */
async function generateGeneralChat(message) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return `I can help with BaseApp rewards and social info. Reply “help” to see commands.`;
  }

  const aiResponse = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 280,
    system: `You are the BaseApp rewards bot for X. Be helpful and concise.
Rules:
- NEVER output the word "Farcaster". Use "BaseApp" instead.
- Never invent user stats. If asked for stats, instruct them to provide a BaseApp username.
- Keep responses under 280 characters.`,
    messages: [{ role: 'user', content: message }],
  });

  const text = aiResponse.content?.[0]?.text || '';
  // hard guard: replace forbidden word if model ever emits it
  return text.replace(/farcaster/gi, 'BaseApp');
}

/**
 * ========================================================
 * Tweet helpers
 * ========================================================
 */
function truncateTo(text, maxLen) {
  const s = String(text ?? '');
  if (s.length <= maxLen) return s;
  return s.slice(0, Math.max(0, maxLen - 1)).trimEnd() + '…';
}

// Replies should always be a SINGLE post (no threads).
// Even if the account has Premium, the API often enforces 280 chars.
function normalizeReplyText(text) {
  return truncateTo(text, 280);
}

async function replyToTweet(tweetId, message) {
  const tweetText = normalizeReplyText(message);
  await rwClient.v2.reply(tweetText, tweetId);
}

async function postStandalone(text) {
  // Keep standalone posts single as well (safer + avoids accidental threads).
  const tweetText = truncateTo(text, 280);
  await rwClient.v2.tweet(tweetText);
}

/**
 * ========================================================
 * Main mention processing (Fix Issue #1)
 * ========================================================
 */
async function bootstrapMentions(botUserId) {
  // Fetch latest mentions ONCE, set lastMentionId to newest_id, and DO NOT reply.
  console.log('🧰 Bootstrapping mentions (no replies)...');
  const params = {
    max_results: 10,
    'tweet.fields': ['created_at', 'conversation_id'],
    'user.fields': ['username'],
    expansions: ['author_id'],
  };

  const mentions = await rwClient.v2.userMentionTimeline(botUserId, params);
  const newest = mentions?.data?.meta?.newest_id || null;

  if (newest) {
    state.lastMentionId = newest;
    await persistState();
    console.log(`✅ Bootstrap complete. lastMentionId=${state.lastMentionId}`);
  } else {
    console.log('✅ Bootstrap complete. No mentions found.');
  }
}

async function processMentions(botUserId, botUsername) {
  const params = {
    max_results: 10,
    'tweet.fields': ['created_at', 'conversation_id'],
    'user.fields': ['username'],
    expansions: ['author_id'],
  };

  if (state.lastMentionId) params.since_id = state.lastMentionId;

  const mentions = await rwClient.v2.userMentionTimeline(botUserId, params);

  const tweets = mentions?.data?.data || [];
  const metaNewest = mentions?.data?.meta?.newest_id || null;

  if (!tweets.length) {
    if (metaNewest && metaNewest !== state.lastMentionId) {
      state.lastMentionId = metaNewest;
      await persistState();
    }
    return;
  }

  for (const tweet of tweets) {
    const id = tweet.id;
    if (state.processedMentionIds.includes(id)) continue;
    if (tweet.author_id === botUserId) continue;

    const author = mentions.includes?.users?.find((u) => u.id === tweet.author_id);
    const mentionUsername = author?.username || 'unknown';

    console.log(`\n📨 Mention from @${mentionUsername}: ${tweet.text}`);

    // Extract message (remove @mentions)
    const message = tweet.text.replace(/@\w+/g, '').trim();

    let kind = 'normal';
    let replyText = '';

    try {
      const intent = detectIntent(message);

      if (intent.type === 'help') {
        kind = 'help';
        replyText = HELP_TEXT(mentionUsername);
      } else if (intent.type === 'user_stats_needs_lookup') {
        kind = 'clarify';
        replyText = buildClarifyUsername(mentionUsername);
      } else if (intent.type === 'user_stats') {
        const res = await formatUserStats(intent.identifier);
        kind = res.kind;
        replyText = res.text;
      } else if (intent.type === 'weekly') {
        replyText = formatWeeklyLeaderboardTopN(Number(process.env.LEADERBOARD_TOP_N || 5));
      } else if (intent.type === 'alltime') {
        replyText = formatAllTimeLeaderboardTopN(Number(process.env.LEADERBOARD_TOP_N || 5));
      } else if (intent.type === 'overview') {
        kind = 'overview';
        replyText = formatOverview();
      } else if (intent.type === 'breakdown') {
        replyText = formatBreakdown();
      } else {
        // general chat via Claude
        replyText = await generateGeneralChat(message);
      }
    } catch (e) {
      console.error('❌ Error generating reply:', e?.message || e);
      kind = 'help';
      replyText = HELP_TEXT(mentionUsername);
    }

    replyText = appendFooter(replyText, kind);

    // Last guard: never output forbidden word
    replyText = replyText.replace(/farcaster/gi, 'BaseApp');

    await replyToTweet(id, replyText);

    rememberProcessedMention(id);

    // After processing batch, update lastMentionId to meta.newest_id (persist)
    if (metaNewest) state.lastMentionId = metaNewest;
    await persistState();

    // Rate limiting
    await new Promise((r) => setTimeout(r, 2500));
  }
}

/**
 * ========================================================
 * DAILY AUTOPOST (10 posts/day) — Issue #G
 * ========================================================
 */
function parseDailyTimesUtc() {
  const raw = (process.env.DAILY_POST_TIMES || '').trim();
  if (!raw) return null;
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const ok = parts.filter((t) => /^\d{2}:\d{2}$/.test(t));
  return ok.length ? ok : null;
}

function evenlySpacedTimes(count) {
  // evenly spaced hours; start at 00:00
  const out = [];
  for (let i = 0; i < count; i++) {
    const minutesTotal = Math.floor((24 * 60 * i) / count);
    const h = String(Math.floor(minutesTotal / 60)).padStart(2, '0');
    const m = String(minutesTotal % 60).padStart(2, '0');
    out.push(`${h}:${m}`);
  }
  return out;
}

async function ensureDailyPostState() {
  const today = utcDateYmd();
  const latestWeekStart = dataCache.weeklyLeaderboard?.latest_week_start_utc || state.latestWeekStartUtc;

  if (!state.dailyPost) state.dailyPost = structuredClone(DEFAULT_STATE.dailyPost);

  // day rollover
  if (state.dailyPost.date !== today) {
    state.dailyPost.date = today;
    state.dailyPost.postedSlots = [];
  }

  // week rollover
  if (latestWeekStart && state.dailyPost.weekStartUtc !== latestWeekStart) {
    state.dailyPost.weekStartUtc = latestWeekStart;
    state.dailyPost.cursor = 0;
    state.dailyPost.postedSlots = [];
  }

  await persistState();
}

async function buildDailyPostForRow(row) {
  const addr = normalizeIdentifier(row.address);
  const rec = dataCache.byVerifiedAddr.get(addr);
  const username = rec?.username || row.user_display;
  const fid = rec?.fid || null;

  const allTime = getLeaderboardAllTimeEntry(addr);
  const allTimeUsd = allTime?.total_usdc ?? 0;
  const allTimeRank = allTime?.all_time_rank ?? '—';

  const weekStart = dataCache.weeklyLeaderboard?.latest_week_start_utc || state.latestWeekStartUtc || '';
  const meta = getWeekMetaByStart(weekStart);
  const weekNumber = meta?.week_number ?? '?';

  const rank = row.rank;
  const rankRangeHint = rank <= 10 ? 'Top 10' : (rank <= 50 ? 'Top 50' : 'Top creators');

  let activityBlock = '(BaseApp activity temporarily unavailable)';
  if (fid) {
    try {
      const startIso = isoAtUtcMidnight(weekStart);
      const nowIso = new Date().toISOString();
      const a = await getBaseAppActivity(fid, startIso, nowIso);
      activityBlock = [
        '📱 BaseApp activity (This Week)',
        `• Posts: ${a.casts} • Likes: ${a.likes}`,
        `• Recasts: ${a.recasts} • Replies: ${a.replies}`,
      ].join('\n');
    } catch {
      // keep unavailable
    }
  }

  const followers = rec?.follower_count ?? rec?.raw?.follower_count ?? '—';

  const out = [
    `WEEK ${weekNumber} TOP CREATORS — #${rank} (${rankRangeHint})`,
    '',
    `🏆 ${username}`,
    `💰 Earned (latest week): $${formatMoney(row.this_week_usdc)}`,
    `📊 All-time: $${formatMoney(allTimeUsd)} (Rank #${allTimeRank})`,
    '',
    activityBlock,
    '',
    `👥 Followers: ${followers === '—' ? '—' : (Number(followers).toLocaleString?.() || followers)}`,
    '',
    `Reply “stats for <username>” to check yours.`,
  ].join('\n');

  // Standalone posts may include the miniapp link.
  return appendFooter(out.replace(/farcaster/gi, 'BaseApp'), 'daily');
}

async function runDailyPostSlot(slotIndex) {
  await ensureDailyPostState();

  const slotsKey = `${state.dailyPost.date}#${slotIndex}`;
  if (state.dailyPost.postedSlots.includes(slotsKey)) {
    console.log(`⏭️  Daily post slot already done: ${slotsKey}`);
    return;
  }

  const rows = dataCache.weeklyLeaderboard?.rows || [];
  if (!rows.length) {
    console.log('⚠️ No weekly leaderboard rows loaded; skipping daily post.');
    return;
  }

  // Cursor points to next row to post
  let idx = state.dailyPost.cursor % rows.length;
  const row = rows[idx];

  const postText = await buildDailyPostForRow(row);
  await postStandalone(postText);

  state.dailyPost.postedSlots.push(slotsKey);
  state.dailyPost.cursor = (state.dailyPost.cursor + 1) % rows.length;
  await persistState();

  console.log(`✅ Daily post slot ${slotIndex} posted. cursor=${state.dailyPost.cursor}`);
}

function setupDailyAutopost() {
  const enabled = String(process.env.ENABLE_DAILY_POSTS || '').toLowerCase() === 'true';
  if (!enabled) {
    console.log('🟦 Daily autopost disabled (ENABLE_DAILY_POSTS!=true)');
    return;
  }

  const perDay = Number(process.env.DAILY_POSTS_PER_DAY || 10);
  const times = parseDailyTimesUtc() || evenlySpacedTimes(perDay);

  console.log(`🗓️  Daily autopost enabled: ${times.length} posts/day (UTC)`);
  times.forEach((t, i) => {
    const [hh, mm] = t.split(':').map((x) => Number(x));
    const expr = `${mm} ${hh} * * *`;

    cron.schedule(expr, () => {
      runDailyPostSlot(i).catch((e) => console.error('❌ Daily post failed:', e?.message || e));
    }, { timezone: 'UTC' });
  });
}

/**
 * ========================================================
 * Main
 * ========================================================
 */
async function runBot() {
  console.log('🤖 BaseApp Twitter Bot Starting...\n');

  await loadState();
  await loadData();

  const me = await rwClient.v2.me();
  const botUserId = me.data.id;
  const botUsername = me.data.username;

  console.log(`✅ Authenticated as @${botUsername}`);
  console.log(`🗂️  State file: ${STATE_PATH}`);
  console.log('─'.repeat(60));

  // Bootstrap fix: never reply to old mentions after deploy
  await bootstrapMentions(botUserId);

  // Start autopost scheduler
  setupDailyAutopost();

  // Poll mentions
  const pollMs = Number(process.env.POLL_INTERVAL_MS || 60_000);
  console.log(`👂 Listening for mentions (poll every ${Math.round(pollMs / 1000)}s)...\n`);

  // initial poll after bootstrap (should be empty unless new mentions came in)
  await processMentions(botUserId, botUsername);

  setInterval(() => {
    processMentions(botUserId, botUsername).catch((e) => console.error('❌ Mention poll failed:', e?.message || e));
  }, pollMs);

  // reload data periodically
  const reloadMs = Number(process.env.DATA_RELOAD_MS || 6 * 60 * 60 * 1000);
  setInterval(() => {
    loadData().catch((e) => console.error('❌ Data reload failed:', e?.message || e));
  }, reloadMs);
}

process.on('SIGINT', () => {
  console.log('\n👋 Bot shutting down...');
  process.exit(0);
});

runBot().catch((e) => {
  console.error('❌ Fatal error:', e);
  process.exit(1);
});
