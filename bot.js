// ================================================================
// BASEAPP ULTIMATE BOT - Production Ready
// All fixes: state persistence, exact miniapp logic, daily posts
// ================================================================

import { TwitterApi } from 'twitter-api-v2';
import Anthropic from '@anthropic-ai/sdk';
import cron from 'node-cron';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

// ===== CONFIGURATION =====
const CONFIG = {
  PLATFORM_NAME: 'BaseApp',
  MINIAPP_LINK: 'Visit Baseapp reward dashboard miniapp on @baseapp:\nhttps://base.app/app/baseapp-reward-dashboard.vercel.app',
  
  STATE_FILE: './state.json',
  POLL_INTERVAL: parseInt(process.env.POLL_INTERVAL) || 60000,
  
  ENABLE_DAILY_POSTS: process.env.ENABLE_DAILY_POSTS === 'true',
  DAILY_POSTS_PER_DAY: parseInt(process.env.DAILY_POSTS_PER_DAY) || 10,
  DAILY_POST_TIMES: (process.env.DAILY_POST_TIMES || '00:30,02:30,04:30,06:30,08:30,10:30,12:30,14:30,16:30,18:30').split(','),
  
  ACTIVITY_CACHE_TTL: 15 * 60 * 1000,
};

// ===== CLIENTS =====
const twitter = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
});

const rwClient = twitter.readWrite;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ===== STATE =====
let state = {
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

let dataCache = {
  overview: null,
  allTimeLeaderboard: null,
  weeklyLeaderboard: null,
  farcasterMap: null,
  weekly: null,
};

const activityCache = new Map();

async function loadState() {
  try {
    const data = await fs.readFile(CONFIG.STATE_FILE, 'utf-8');
    state = JSON.parse(data);
    console.log('✅ State loaded');
  } catch {
    console.log('📝 New state');
    await saveState();
  }
}

async function saveState() {
  try {
    await fs.writeFile(CONFIG.STATE_FILE, JSON.stringify(state, null, 2));
  } catch (error) {
    console.error('❌ Save state failed:', error.message);
  }
}

async function loadData() {
  try {
    console.log('🔄 Loading data...');
    
    const dataDir = process.env.DATA_DIR || './data';
    
    const [overview, allTime, weekly, farcaster, weeklyMeta] = await Promise.all([
      fs.readFile(path.join(dataDir, 'overview.json'), 'utf-8'),
      fs.readFile(path.join(dataDir, 'leaderboard_all_time.json'), 'utf-8'),
      fs.readFile(path.join(dataDir, 'leaderboard_weekly_latest.json'), 'utf-8'),
      fs.readFile(path.join(dataDir, 'farcaster_map.json'), 'utf-8'),
      fs.readFile(path.join(dataDir, 'weekly.json'), 'utf-8'),
    ]);

    dataCache = {
      overview: JSON.parse(overview),
      allTimeLeaderboard: JSON.parse(allTime),
      weeklyLeaderboard: JSON.parse(weekly),
      farcasterMap: JSON.parse(farcaster),
      weekly: JSON.parse(weeklyMeta),
    };

    console.log('✅ Data loaded');
    
    const latestWeek = dataCache.weeklyLeaderboard.latest_week_start_utc;
    if (latestWeek !== state.latestWeekStartUtc) {
      console.log(`📅 New week: ${latestWeek}`);
      state.latestWeekStartUtc = latestWeek;
      state.dailyPost.weekStartUtc = latestWeek;
      state.dailyPost.cursor = 0;
      await saveState();
    }
    
  } catch (error) {
    console.error('❌ Data load failed:', error.message);
    throw error;
  }
}

// ===== NEYNAR (EXACT MINIAPP LOGIC) =====

async function searchNeynarUser(query) {
  const apiKey = process.env.NEYNAR_API_KEY;
  if (!apiKey) return null;

  try {
    const response = await fetch(
      `https://api.neynar.com/v2/farcaster/user/search?q=${encodeURIComponent(query)}&limit=10`,
      {
        headers: { 'accept': 'application/json', 'api_key': apiKey },
      }
    );

    if (!response.ok) return null;
    const data = await response.json();
    return data.result?.users || [];
  } catch {
    return null;
  }
}

async function fetchUserCasts(fid, apiKey, startMs, endMs) {
  const casts = [];
  let cursor = null;

  for (let page = 0; page < 20; page++) {
    const url = new URL('https://api.neynar.com/v2/farcaster/feed/user/casts');
    url.searchParams.set('fid', String(fid));
    url.searchParams.set('limit', '100');
    url.searchParams.set('include_replies', 'false');
    url.searchParams.set('include_recasts', 'false');
    if (cursor) url.searchParams.set('cursor', cursor);

    const res = await fetch(url.toString(), {
      headers: { 'accept': 'application/json', 'api_key': apiKey },
    });

    if (!res.ok) break;

    const json = await res.json();
    const items = json.casts || [];

    for (const cast of items) {
      const createdAt = cast.timestamp || cast.created_at;
      if (!createdAt) continue;

      const ms = Date.parse(createdAt);
      if (!isFinite(ms)) continue;

      if (ms >= startMs && ms < endMs) {
        casts.push(cast);
      }

      if (ms < startMs) return casts;
    }

    const last = items[items.length - 1];
    if (last) {
      const lastMs = Date.parse(last.timestamp || last.created_at);
      if (lastMs < startMs) break;
    }

    cursor = json.next?.cursor || null;
    if (!cursor) break;
  }

  return casts;
}

function extractCounts(cast) {
  const reactions = cast.reactions || {};
  const replies = cast.replies || {};

  return {
    likes: reactions.likes_count || reactions.likes || 0,
    recasts: reactions.recasts_count || reactions.recasts || reactions.recastsCount || 0,
    replies: replies.count || 0,
  };
}

async function getActivityMetrics(fid, startIso, endIso) {
  const cacheKey = `${fid}_${startIso}_${endIso}`;
  
  const cached = activityCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CONFIG.ACTIVITY_CACHE_TTL) {
    return cached.data;
  }

  const apiKey = process.env.NEYNAR_API_KEY;
  if (!apiKey) return null;

  try {
    const startMs = Date.parse(startIso);
    const endMs = Date.parse(endIso);

    const casts = await fetchUserCasts(fid, apiKey, startMs, endMs);

    let totalLikes = 0;
    let totalRecasts = 0;
    let totalReplies = 0;

    for (const cast of casts) {
      const counts = extractCounts(cast);
      totalLikes += counts.likes;
      totalRecasts += counts.recasts;
      totalReplies += counts.replies;
    }

    const result = {
      casts: casts.length,
      likes: totalLikes,
      recasts: totalRecasts,
      replies: totalReplies,
    };

    activityCache.set(cacheKey, {
      timestamp: Date.now(),
      data: result,
    });

    return result;
  } catch {
    return null;
  }
}

// ===== USER RESOLUTION (EXACT SPEC) =====

function normalizeUsername(input) {
  if (!input) return null;
  
  let cleaned = input.trim().toLowerCase();
  
  if (cleaned.startsWith('@')) {
    cleaned = cleaned.substring(1);
  }
  
  return cleaned;
}

function getBaseName(username) {
  if (!username) return null;
  const parts = username.split('.');
  return parts[0];
}

function findUserInLocal(identifier) {
  const normalized = normalizeUsername(identifier);
  if (!normalized) return null;

  const baseName = getBaseName(normalized);

  // Priority 1: Exact match
  for (const [address, userData] of Object.entries(dataCache.farcasterMap)) {
    if (userData.status !== 'ok') continue;
    
    const fcUsername = normalizeUsername(userData.username);
    if (fcUsername === normalized) {
      return { address, userData, source: 'local_exact' };
    }
  }

  // Priority 2: baseName match
  for (const [address, userData] of Object.entries(dataCache.farcasterMap)) {
    if (userData.status !== 'ok') continue;
    
    const fcUsername = normalizeUsername(userData.username);
    const fcBaseName = getBaseName(fcUsername);
    
    if (fcBaseName === baseName) {
      return { address, userData, source: 'local_basename' };
    }
  }

  // Priority 3: Wallet
  if (normalized.startsWith('0x') && normalized.length === 42) {
    if (dataCache.farcasterMap[normalized]) {
      return {
        address: normalized,
        userData: dataCache.farcasterMap[normalized],
        source: 'local_wallet',
      };
    }
  }

  return null;
}

async function findUserViaNeynar(identifier) {
  const normalized = normalizeUsername(identifier);
  if (!normalized) return null;

  const baseName = getBaseName(normalized);

  const users = await searchNeynarUser(normalized);
  if (!users || users.length === 0) return null;

  let bestMatch = null;

  // Exact username match
  for (const user of users) {
    const neynarUsername = normalizeUsername(user.username);
    if (neynarUsername === normalized) {
      bestMatch = user;
      break;
    }
  }

  // baseName match
  if (!bestMatch) {
    for (const user of users) {
      const neynarUsername = normalizeUsername(user.username);
      const neynarBaseName = getBaseName(neynarUsername);
      if (neynarBaseName === baseName) {
        bestMatch = user;
        break;
      }
    }
  }

  if (!bestMatch) return null;

  // Find best wallet with rewards
  const ethAddresses = bestMatch.verified_addresses?.eth_addresses || [];
  
  let bestWallet = null;
  let maxEarnings = 0;

  for (const addr of ethAddresses) {
    const normalizedAddr = addr.toLowerCase();
    
    const allTimeEntry = dataCache.allTimeLeaderboard.rows.find(
      row => row.address.toLowerCase() === normalizedAddr
    );

    if (allTimeEntry) {
      const earnings = parseFloat(allTimeEntry.total_usdc) || 0;
      if (earnings > maxEarnings) {
        maxEarnings = earnings;
        bestWallet = normalizedAddr;
      }
    }
  }

  return {
    address: bestWallet,
    userData: {
      fid: bestMatch.fid,
      username: bestMatch.username,
      display_name: bestMatch.display_name,
      pfp_url: bestMatch.pfp_url,
      follower_count: bestMatch.follower_count || 0,
      following_count: bestMatch.following_count || 0,
      status: 'ok',
    },
    source: 'neynar',
    hasRewards: !!bestWallet,
  };
}

async function resolveUser(identifier) {
  const local = findUserInLocal(identifier);
  if (local) {
    console.log(`✅ Local: ${local.userData.username}`);
    return local;
  }

  console.log(`🔍 Neynar: ${identifier}`);
  const neynar = await findUserViaNeynar(identifier);
  
  if (neynar) {
    console.log(`✅ Neynar: ${neynar.userData.username}`);
    return neynar;
  }

  return null;
}

// ===== ROUTER =====

function routeQuery(message) {
  const lower = message.toLowerCase().trim();

  if (lower.includes('weekly') || (lower.includes('week') && lower.includes('top'))) {
    return { intent: 'weekly', count: extractNumber(lower) || 10 };
  }

  if (lower.includes('alltime') || lower.includes('all time') || lower.includes('all-time')) {
    return { intent: 'alltime', count: extractNumber(lower) || 10 };
  }

  if (lower.includes('reward') || lower.includes('overview') || lower.includes('distributed')) {
    return { intent: 'overview' };
  }

  if (lower.includes('breakdown')) {
    return { intent: 'breakdown' };
  }

  if (lower.includes('help') || lower.includes('command')) {
    return { intent: 'help' };
  }

  const walletMatch = message.match(/(0x[a-fA-F0-9]{40})/);
  if (walletMatch) {
    return { intent: 'user_stats', identifier: walletMatch[1] };
  }

  const usernameMatch = message.match(/@?([\w-]+(?:\.base\.eth|\.eth)?)/i);
  if (usernameMatch) {
    return { intent: 'user_stats', identifier: usernameMatch[1] };
  }

  if (lower.includes('my stats') || lower === 'my' || lower === 'me') {
    return { intent: 'user_stats_needs_lookup' };
  }

  return { intent: 'general_chat' };
}

function extractNumber(text) {
  const match = text.match(/\d+/);
  return match ? parseInt(match[0]) : null;
}

// ===== FORMATTING =====

function formatWeekLabel(weekStartIso) {
  const date = new Date(weekStartIso);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getWeekNumber() {
  return dataCache.allTimeLeaderboard?.week_keys?.length || 0;
}

async function formatUserStats(user, twitterUsername) {
  const { address, userData, hasRewards } = user;

  const latestWeekStart = dataCache.weeklyLeaderboard.latest_week_start_utc;
  const previousWeekStart = dataCache.weeklyLeaderboard.previous_week_start_utc;
  
  const weekNumber = getWeekNumber();
  const weekLabel = formatWeekLabel(latestWeekStart);

  const thisWeekActivity = userData.fid ? await getActivityMetrics(
    userData.fid,
    latestWeekStart,
    new Date().toISOString()
  ) : null;

  const lastWeekActivity = userData.fid && previousWeekStart ? await getActivityMetrics(
    userData.fid,
    previousWeekStart,
    latestWeekStart
  ) : null;

  const formatActivity = (activity, label, startDate, endDate) => {
    if (!activity) {
      return `📱 BASEAPP ACTIVITY (${label})\n(Temporarily unavailable)`;
    }

    const start = formatWeekLabel(startDate);
    const end = endDate === 'now' ? 'now' : formatWeekLabel(endDate);

    return `📱 BASEAPP ACTIVITY (${label}: ${start} → ${end})\n` +
           `📝 Posts: ${activity.casts}\n` +
           `❤️ Likes received: ${activity.likes}\n` +
           `🔄 Recasts: ${activity.recasts}\n` +
           `✒️ Replies: ${activity.replies}`;
  };

  if (!address || hasRewards === false) {
    let response = `📊 baseapp creator statistics of ${userData.username}\n\n`;
    response += `You didn't yet earn creator reward from @baseapp — keep creating, you can earn next week 💙🤝\n\n`;
    
    if (thisWeekActivity) {
      response += formatActivity(thisWeekActivity, 'This Week', latestWeekStart, 'now') + '\n\n';
    }
    
    if (lastWeekActivity) {
      response += formatActivity(lastWeekActivity, 'Last reward window', previousWeekStart, latestWeekStart) + '\n\n';
    }

    response += `👥 COMMUNITY\n`;
    response += `Followers: ${userData.follower_count || 0}\n`;
    response += `Following: ${userData.following_count || 0}\n\n`;
    response += CONFIG.MINIAPP_LINK;

    return response;
  }

  const allTimeEntry = dataCache.allTimeLeaderboard.rows.find(
    row => row.address.toLowerCase() === address.toLowerCase()
  );

  const weeklyEntry = dataCache.weeklyLeaderboard.rows.find(
    row => row.address.toLowerCase() === address.toLowerCase()
  );

  let response = `📊 baseapp creator statistics of ${userData.username}\n\n`;

  if (allTimeEntry) {
    response += `💰 ALL-TIME REWARDS\n`;
    response += `Total Earned: $${allTimeEntry.total_usdc}\n`;
    response += `Rank: #${allTimeEntry.all_time_rank} 🏆\n`;
    response += `Weeks Earned: ${allTimeEntry.total_weeks_earned}\n\n`;
  }

  if (weeklyEntry) {
    response += `📈 LATEST WEEK (Week ${weekNumber} — ${weekLabel})\n`;
    response += `Earned: $${weeklyEntry.this_week_usdc}\n`;
    response += `Rank: #${weeklyEntry.rank}\n`;
    response += `Previous Week: $${weeklyEntry.previous_week_usdc}\n`;

    if (weeklyEntry.pct_change) {
      const change = parseFloat(weeklyEntry.pct_change);
      const arrow = change > 0 ? '📈' : change < 0 ? '📉' : '→';
      response += `Change: ${change >= 0 ? '+' : ''}${weeklyEntry.pct_change}% ${arrow}\n`;
    }
    response += '\n';
  }

  if (thisWeekActivity) {
    response += formatActivity(thisWeekActivity, 'This Week', latestWeekStart, 'now') + '\n\n';
  }

  if (lastWeekActivity) {
    response += formatActivity(lastWeekActivity, 'Last reward window', previousWeekStart, latestWeekStart) + '\n\n';
  }

  response += `👥 COMMUNITY\n`;
  response += `Followers: ${userData.follower_count || 0}\n`;
  response += `Following: ${userData.following_count || 0}\n\n`;

  response += `🎉 Keep creating on ${CONFIG.PLATFORM_NAME}! 🚀\n\n`;
  response += CONFIG.MINIAPP_LINK;

  return response;
}

function formatLeaderboard(type, count) {
  const data = type === 'weekly' 
    ? dataCache.weeklyLeaderboard
    : dataCache.allTimeLeaderboard;

  const weekNumber = getWeekNumber();
  const topN = data.rows.slice(0, count);

  let response = type === 'weekly'
    ? `🏆 WEEK ${weekNumber} LEADERBOARD — Top ${count}\n`
    : `🏆 ALL-TIME LEADERBOARD — Top ${count}\n`;

  topN.forEach((user, idx) => {
    const fc = dataCache.farcasterMap[user.address.toLowerCase()];
    const username = fc?.username || `user${idx + 1}`;

    if (type === 'weekly') {
      response += `#${idx + 1} ${username} — $${user.this_week_usdc}\n`;
    } else {
      response += `#${idx + 1} ${username} — $${user.total_usdc}\n`;
    }
  });

  response += `\nReply "stats for <username>" to see your profile.\n\n`;
  response += CONFIG.MINIAPP_LINK;

  return response;
}

function formatOverview() {
  const ov = dataCache.overview;
  const weekNumber = getWeekNumber();
  const weekLabel = formatWeekLabel(dataCache.weeklyLeaderboard.latest_week_start_utc);

  let response = `📊 BASEAPP REWARDS OVERVIEW (Latest Week: Week ${weekNumber} — ${weekLabel})\n`;
  response += `Total USDC distributed (latest week): $${ov.latest_week.total_usdc}\n`;
  response += `Unique creators rewarded (latest week): ${ov.latest_week.unique_users}\n\n`;
  response += `Total USDC distributed (all-time): $${ov.all_time.total_usdc}\n`;
  response += `Unique creators (all-time): ${ov.all_time.unique_users}\n\n`;
  response += CONFIG.MINIAPP_LINK;

  return response;
}

function formatBreakdown() {
  const ov = dataCache.overview;
  const weekNumber = getWeekNumber();
  const weekLabel = formatWeekLabel(dataCache.weeklyLeaderboard.latest_week_start_utc);

  let response = `📊 LATEST WEEK REWARD BREAKDOWN (Week ${weekNumber} — ${weekLabel})\n`;
  
  ov.latest_week.breakdown.forEach(bucket => {
    response += `$${bucket.reward_usdc} — ${bucket.users} creators\n`;
  });

  response += `\n${CONFIG.MINIAPP_LINK}`;

  return response;
}

function formatHelp(mentionUsername) {
  return `Hey @${mentionUsername}! I'm here to help with ${CONFIG.PLATFORM_NAME} rewards and social info! 🎯\n\n` +
         `Try these:\n` +
         `• show data for [baseapp username]\n` +
         `• weekly — weekly leaderboard\n` +
         `• alltime — alltime leaderboard\n` +
         `• reward — overall distribution info\n` +
         `• breakdown — latest week reward breakdown\n\n` +
         `What would you like to know? 🚀`;
}

function formatClarification(mentionUsername) {
  return `Hey @${mentionUsername}! I need your exact ${CONFIG.PLATFORM_NAME} username to show your stats.\n\n` +
         `Reply with your username (e.g., "femiii.base.eth" or "femiii")`;
}

// ===== TWEET HANDLING =====

function splitIntoTweets(text) {
  if (text.length <= 280) return [text];

  const parts = text.split('\n\n');
  const tweets = [];
  let current = '';

  for (const part of parts) {
    if ((current + '\n\n' + part).length > 270) {
      if (current) tweets.push(current.trim());
      current = part;
    } else {
      current += (current ? '\n\n' : '') + part;
    }
  }

  if (current) tweets.push(current.trim());

  return tweets;
}

async function replyToTweet(tweetId, message) {
  try {
    const tweets = splitIntoTweets(message);
    let lastId = tweetId;

    for (let i = 0; i < tweets.length; i++) {
      const text = tweets.length > 1
        ? `(${i + 1}/${tweets.length})\n\n${tweets[i]}`
        : tweets[i];

      const response = await rwClient.v2.reply(text, lastId);
      lastId = response.data.id;

      console.log(`   ✅ Replied (${i + 1}/${tweets.length})`);

      if (i < tweets.length - 1) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    return true;
  } catch (error) {
    console.error(`   ❌ Reply failed:`, error.message);
    return false;
  }
}

// ===== MENTIONS =====

async function bootstrapMentions(botUserId) {
  console.log('🔄 Bootstrap mentions...');

  try {
    const mentions = await rwClient.v2.userMentionTimeline(botUserId, {
      max_results: 10,
      'tweet.fields': ['created_at'],
    });

    if (mentions.data?.meta?.newest_id) {
      state.lastMentionId = mentions.data.meta.newest_id;
      await saveState();
      console.log(`✅ Bootstrap done: ${state.lastMentionId}`);
    }
  } catch (error) {
    console.error('Bootstrap error:', error.message);
  }
}

async function processMentions(botUserId) {
  try {
    const params = {
      max_results: 10,
      'tweet.fields': ['created_at'],
      'user.fields': ['username'],
      expansions: ['author_id'],
    };

    if (state.lastMentionId) {
      params.since_id = state.lastMentionId;
    }

    const mentions = await rwClient.v2.userMentionTimeline(botUserId, params);

    if (!mentions.data?.data?.length) return;

    if (mentions.data.meta.newest_id) {
      state.lastMentionId = mentions.data.meta.newest_id;
      await saveState();
    }

    for (const tweet of mentions.data.data) {
      if (state.processedMentionIds.includes(tweet.id)) {
        continue;
      }

      if (tweet.author_id === botUserId) {
        continue;
      }

      const author = mentions.includes?.users?.find(u => u.id === tweet.author_id);
      const username = author?.username || 'user';

      console.log(`\n📨 @${username}: ${tweet.text.substring(0, 50)}...`);

      const message = tweet.text.replace(/@\w+/g, '').trim();

      const route = routeQuery(message);

      let response;

      switch (route.intent) {
        case 'weekly':
          response = formatLeaderboard('weekly', route.count);
          break;

        case 'alltime':
          response = formatLeaderboard('alltime', route.count);
          break;

        case 'overview':
          response = formatOverview();
          break;

        case 'breakdown':
          response = formatBreakdown();
          break;

        case 'help':
          response = formatHelp(username);
          break;

        case 'user_stats':
          const user = await resolveUser(route.identifier);
          if (!user) {
            response = formatClarification(username);
          } else {
            response = await formatUserStats(user, username);
          }
          break;

        case 'user_stats_needs_lookup':
          response = formatClarification(username);
          break;

        case 'general_chat':
        default:
          try {
            const aiResponse = await anthropic.messages.create({
              model: 'claude-sonnet-4-20250514',
              max_tokens: 200,
              messages: [{ role: 'user', content: message }],
            });
            response = aiResponse.content[0].text + '\n\n' + CONFIG.MINIAPP_LINK;
          } catch {
            response = formatHelp(username);
          }
      }

      await replyToTweet(tweet.id, response);

      state.processedMentionIds.push(tweet.id);
      
      if (state.processedMentionIds.length > 1000) {
        state.processedMentionIds = state.processedMentionIds.slice(-1000);
      }

      await saveState();

      await new Promise(r => setTimeout(r, 3000));
    }
  } catch (error) {
    console.error('❌ Mention error:', error.message);
  }
}

// ===== DAILY POSTS =====

async function postDailyWinner(slotIndex) {
  const today = new Date().toISOString().split('T')[0];
  const slotKey = `${today}#${slotIndex}`;

  if (state.dailyPost.postedSlots.includes(slotKey)) {
    console.log(`✅ Slot ${slotIndex} posted`);
    return;
  }

  const currentWeek = dataCache.weeklyLeaderboard.latest_week_start_utc;
  if (currentWeek !== state.dailyPost.weekStartUtc) {
    console.log(`📅 New week! Reset`);
    state.dailyPost.weekStartUtc = currentWeek;
    state.dailyPost.cursor = 0;
    state.dailyPost.date = today;
    state.dailyPost.postedSlots = [];
    await saveState();
  }

  if (state.dailyPost.date !== today) {
    state.dailyPost.date = today;
    state.dailyPost.postedSlots = [];
    await saveState();
  }

  const weeklyRows = dataCache.weeklyLeaderboard.rows;
  
  if (state.dailyPost.cursor >= weeklyRows.length) {
    state.dailyPost.cursor = 0;
    await saveState();
  }

  const winner = weeklyRows[state.dailyPost.cursor];
  if (!winner) {
    console.log('No winner');
    return;
  }

  const fc = dataCache.farcasterMap[winner.address.toLowerCase()];
  const username = fc?.username || `user${winner.rank}`;

  const allTimeEntry = dataCache.allTimeLeaderboard.rows.find(
    row => row.address.toLowerCase() === winner.address.toLowerCase()
  );

  const weekNumber = getWeekNumber();
  const latestWeekStart = dataCache.weeklyLeaderboard.latest_week_start_utc;

  const activity = fc?.fid ? await getActivityMetrics(
    fc.fid,
    latestWeekStart,
    new Date().toISOString()
  ) : null;

  let post = `WEEK ${weekNumber} TOP CREATORS — #${winner.rank}\n\n`;
  post += `🏆 ${username}\n`;
  post += `💰 Earned (latest week): $${winner.this_week_usdc}\n`;
  
  if (allTimeEntry) {
    post += `📊 All-time: $${allTimeEntry.total_usdc} (Rank #${allTimeEntry.all_time_rank})\n\n`;
  } else {
    post += '\n';
  }

  if (activity) {
    post += `📱 ${CONFIG.PLATFORM_NAME} activity (This Week)\n`;
    post += `• Posts: ${activity.casts} • Likes: ${activity.likes}\n`;
    post += `• Recasts: ${activity.recasts} • Replies: ${activity.replies}\n\n`;
  } else {
    post += `📱 ${CONFIG.PLATFORM_NAME} activity (This Week)\n`;
    post += `(Temporarily unavailable)\n\n`;
  }

  if (fc) {
    post += `👥 Followers: ${fc.follower_count || 0}\n\n`;
  }

  post += `${CONFIG.MINIAPP_LINK}\n\n`;
  post += `Reply "stats for <username>" to check yours.`;

  try {
    await rwClient.v2.tweet(post);
    
    console.log(`✅ Daily ${slotIndex}: Rank #${winner.rank}`);

    state.dailyPost.postedSlots.push(slotKey);
    state.dailyPost.cursor++;
    await saveState();

  } catch (error) {
    console.error(`❌ Daily post failed:`, error.message);
  }
}

function setupDailyPosts() {
  if (!CONFIG.ENABLE_DAILY_POSTS) {
    console.log('📅 Daily posts OFF');
    return;
  }

  console.log(`📅 Daily posts ON: ${CONFIG.DAILY_POSTS_PER_DAY}/day`);

  CONFIG.DAILY_POST_TIMES.forEach((time, index) => {
    const [hour, minute] = time.split(':');
    const cronPattern = `${minute} ${hour} * * *`;

    cron.schedule(cronPattern, async () => {
      console.log(`\n⏰ Slot ${index}`);
      await postDailyWinner(index);
    });

    console.log(`   ${index}: ${time} UTC`);
  });
}

// ===== MAIN =====

async function runBot() {
  console.log(`\n🤖 ${CONFIG.PLATFORM_NAME} ULTIMATE BOT\n`);

  await loadState();
  await loadData();

  const me = await rwClient.v2.me();
  const botUserId = me.data.id;

  console.log(`✅ @${me.data.username}`);
  console.log(`📊 Week ${getWeekNumber()}`);
  console.log(`👂 Listening...\n`);

  if (!state.lastMentionId) {
    await bootstrapMentions(botUserId);
  }

  await processMentions(botUserId);

  setInterval(async () => {
    await processMentions(botUserId);
  }, CONFIG.POLL_INTERVAL);

  setupDailyPosts();

  console.log('✅ Running!');
}

process.on('SIGINT', async () => {
  console.log('\n👋 Shutting down...');
  await saveState();
  process.exit(0);
});

runBot().catch(console.error);
