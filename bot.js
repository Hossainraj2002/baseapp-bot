// ========================================
// BASEAPP ULTIMATE BOT - COMPLETE SYSTEM
// All features enabled, perfect Neynar integration
// ========================================

import Anthropic from '@anthropic-ai/sdk';
import { TwitterApi } from 'twitter-api-v2';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

// ===== CONFIGURATION =====
const CONFIG = {
  PLATFORM_NAME: 'BaseApp',
  POLL_INTERVAL: 60000, // 1 minute (you have API credits!)
  DAILY_POST_TIME_UTC: 10, // 10 AM UTC
  ENABLE_DAILY_POSTS: true, // ENABLED NOW!
  MAX_TWEET_LENGTH: 280,
};

// ===== INITIALIZE CLIENTS =====
const twitterClient = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
});

const rwClient = twitterClient.readWrite;

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ===== STATE =====
const processedTweets = new Set();
let lastMentionId = null;
let lastDailyPost = null;
let currentDayInCycle = 0;

let dataCache = {
  overview: null,
  allTimeLeaderboard: null,
  weeklyLeaderboard: null,
  farcasterMap: null,
  lastUpdated: null,
};

// ===== DATA LOADING =====
async function loadData() {
  try {
    console.log('🔄 Loading data...');
    
    const dataDir = process.env.DATA_DIR || './data';
    
    const [overview, allTime, weekly, farcaster] = await Promise.all([
      fs.readFile(path.join(dataDir, 'overview.json'), 'utf-8'),
      fs.readFile(path.join(dataDir, 'leaderboard_all_time.json'), 'utf-8'),
      fs.readFile(path.join(dataDir, 'leaderboard_weekly_latest.json'), 'utf-8'),
      fs.readFile(path.join(dataDir, 'farcaster_map.json'), 'utf-8'),
    ]);

    dataCache = {
      overview: JSON.parse(overview),
      allTimeLeaderboard: JSON.parse(allTime),
      weeklyLeaderboard: JSON.parse(weekly),
      farcasterMap: JSON.parse(farcaster),
      lastUpdated: new Date(),
    };

    console.log('✅ Data loaded');
    console.log(`   Users: ${dataCache.overview.all_time.unique_users.toLocaleString()}`);
    console.log(`   All-time: $${dataCache.overview.all_time.total_usdc.toLocaleString()}`);
  } catch (error) {
    console.error('❌ Error loading data:', error.message);
    throw error;
  }
}

// ===== NEYNAR API - SUPER ROBUST =====

/**
 * Get user by username from Neynar
 * ROBUST: Tries multiple times, handles all errors
 */
async function getNeynarUserByUsername(username, retries = 3) {
  const apiKey = process.env.NEYNAR_API_KEY;
  if (!apiKey) throw new Error('NEYNAR_API_KEY required!');

  const cleanUsername = username.replace(/@/g, '').replace(/\\.base\\.eth$/i, '').replace(/\\.eth$/i, '');

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`🔍 Neynar lookup: ${cleanUsername} (attempt ${attempt}/${retries})`);
      
      const response = await fetch(
        `https://api.neynar.com/v2/farcaster/user/by_username?username=${encodeURIComponent(cleanUsername)}`,
        {
          headers: {
            'accept': 'application/json',
            'api_key': apiKey,
          },
          signal: AbortSignal.timeout(10000), // 10s timeout
        }
      );

      if (response.status === 404) {
        console.log(`   User not found on Farcaster`);
        return null;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const user = data.user;
      
      if (!user) return null;

      console.log(`   ✅ Found: ${user.display_name}`);
      
      return {
        fid: user.fid,
        username: user.username,
        display_name: user.display_name,
        pfp_url: user.pfp_url,
        bio: user.profile?.bio?.text || '',
        follower_count: user.follower_count || 0,
        following_count: user.following_count || 0,
        verified_addresses: user.verified_addresses || { eth_addresses: [] },
      };
    } catch (error) {
      console.error(`   ⚠️  Attempt ${attempt} failed:`, error.message);
      
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
      }
    }
  }

  console.error(`   ❌ All attempts failed for ${cleanUsername}`);
  return null;
}

/**
 * Get user's casts for a time period
 * EXACTLY like your miniapp does it!
 */
async function getUserCasts(fid, startMs, endMs) {
  const apiKey = process.env.NEYNAR_API_KEY;
  if (!apiKey) return [];

  const casts = [];
  let cursor = null;

  try {
    // Fetch up to 500 casts (5 pages)
    for (let page = 0; page < 5; page++) {
      const url = new URL('https://api.neynar.com/v2/farcaster/feed/user/casts');
      url.searchParams.set('fid', String(fid));
      url.searchParams.set('limit', '100');
      url.searchParams.set('include_replies', 'false');
      url.searchParams.set('include_recasts', 'false');
      
      if (cursor) url.searchParams.set('cursor', cursor);

      const response = await fetch(url.toString(), {
        headers: {
          'accept': 'application/json',
          'api_key': apiKey,
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        console.error(`   Neynar casts API error: ${response.status}`);
        break;
      }

      const json = await response.json();
      const items = json.casts || [];

      for (const cast of items) {
        const createdAt = cast.timestamp || cast.created_at;
        if (!createdAt) continue;

        const castMs = new Date(createdAt).getTime();
        
        if (castMs >= startMs && castMs < endMs) {
          casts.push(cast);
        }
        
        // If cast is older than our window, stop fetching
        if (castMs < startMs) {
          return casts;
        }
      }

      cursor = json.next?.cursor || null;
      if (!cursor) break;
      
      // Small delay between pages
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } catch (error) {
    console.error('   Error fetching casts:', error.message);
  }

  return casts;
}

/**
 * Get social stats for a period
 * EXACTLY like miniapp's /api/social endpoint
 */
async function getSocialStats(fid, startIso, endIso) {
  try {
    const startMs = new Date(startIso).getTime();
    const endMs = new Date(endIso).getTime();

    console.log(`   📊 Getting social stats for FID ${fid}`);

    const casts = await getUserCasts(fid, startMs, endMs);

    let totalLikes = 0;
    let totalRecasts = 0;
    let totalReplies = 0;

    for (const cast of casts) {
      const reactions = cast.reactions || {};
      const replies = cast.replies || {};

      totalLikes += reactions.likes_count || reactions.likes || 0;
      totalRecasts += reactions.recasts_count || reactions.recasts || 0;
      totalReplies += replies.count || 0;
    }

    return {
      casts: casts.length,
      likes: totalLikes,
      recasts: totalRecasts,
      replies: totalReplies,
    };
  } catch (error) {
    console.error('   Error getting social stats:', error.message);
    return null;
  }
}

// ===== USER LOOKUP =====

/**
 * Find user in cache first (fast!)
 */
function findUserInCache(identifier) {
  identifier = identifier.toLowerCase().trim();
  const cleanId = identifier.replace(/\\.base\\.eth$/i, '').replace(/\\.eth$/i, '').replace(/@/g, '');

  // Try direct address match first
  for (const [address, data] of Object.entries(dataCache.farcasterMap)) {
    if (address.toLowerCase() === identifier) {
      return { address: address.toLowerCase(), farcaster: data, source: 'cache' };
    }
  }

  // Try username match
  for (const [address, data] of Object.entries(dataCache.farcasterMap)) {
    if (data.status !== 'ok') continue;

    const username = (data.username || '').toLowerCase();
    const usernameBase = username.split('.')[0];

    if (username.includes(cleanId) || cleanId.includes(usernameBase)) {
      return { address: address.toLowerCase(), farcaster: data, source: 'cache' };
    }

    // Also try display name
    const displayName = (data.display_name || '').toLowerCase();
    if (displayName === cleanId) {
      return { address: address.toLowerCase(), farcaster: data, source: 'cache' };
    }
  }

  return null;
}

/**
 * Smart user lookup: Cache first, then Neynar
 */
async function findUser(identifier) {
  // Try cache first (fast!)
  const cached = findUserInCache(identifier);
  if (cached) {
    console.log(`   ✅ Found in cache`);
    return cached;
  }

  // Try Neynar
  console.log(`   🔍 Not in cache, trying Neynar...`);
  const neynarUser = await getNeynarUserByUsername(identifier);
  
  if (!neynarUser) {
    return null;
  }

  // Match Neynar addresses to reward data
  const ethAddresses = neynarUser.verified_addresses?.eth_addresses || [];

  for (const addr of ethAddresses) {
    const normalized = addr.toLowerCase();

    // Check all-time leaderboard
    const allTimeEntry = dataCache.allTimeLeaderboard.rows.find(
      row => row.address.toLowerCase() === normalized
    );

    if (allTimeEntry) {
      console.log(`   ✅ Matched ${addr} to rewards!`);
      return {
        address: normalized,
        farcaster: neynarUser,
        source: 'neynar',
      };
    }
  }

  // User exists but no rewards
  return {
    address: null,
    farcaster: neynarUser,
    source: 'neynar',
    hasRewards: false,
  };
}

// ===== STATS GATHERING =====

function getUserRewardStats(address) {
  if (!address) return null;

  const addr = address.toLowerCase();

  const allTime = dataCache.allTimeLeaderboard.rows.find(
    row => row.address.toLowerCase() === addr
  );

  const weekly = dataCache.weeklyLeaderboard.rows.find(
    row => row.address.toLowerCase() === addr
  );

  return { allTime, weekly };
}

// ===== RESPONSE FORMATTING =====

async function formatCompleteUserStats(identifier) {
  console.log(`\\n📊 Getting stats for: ${identifier}`);

  const user = await findUser(identifier);

  if (!user) {
    return `❌ User "${identifier}" not found. Try their ${CONFIG.PLATFORM_NAME} username or wallet address.`;
  }

  const { address, farcaster, hasRewards, source } = user;

  // Get reward stats if has address
  let stats = null;
  if (address) {
    stats = getUserRewardStats(address);
  }

  // If no rewards yet
  if (!address || hasRewards === false) {
    let response = `👋 Hey ${farcaster.display_name || identifier}!\\n\\n`;
    response += `I found you on ${CONFIG.PLATFORM_NAME}, but you haven't earned rewards yet.\\n\\n`;
    response += `💡 **Start earning:** Create quality content on ${CONFIG.PLATFORM_NAME}!\\n\\n`;
    
    // Get social stats anyway
    if (farcaster.fid) {
      const latestWeekStart = dataCache.weeklyLeaderboard.latest_week_start_utc;
      if (latestWeekStart) {
        const social = await getSocialStats(
          farcaster.fid,
          latestWeekStart,
          new Date().toISOString()
        );

        if (social) {
          response += `📱 **Your Activity This Week:**\\n`;
          response += `Posts: ${social.casts}\\n`;
          response += `Likes: ${social.likes}\\n`;
          response += `Recasts: ${social.recasts}\\n`;
          response += `Replies: ${social.replies}\\n\\n`;
        }
      }
    }

    response += `👥 **Community:**\\n`;
    response += `Followers: ${farcaster.follower_count?.toLocaleString() || 0}\\n`;
    response += `Following: ${farcaster.following_count?.toLocaleString() || 0}\\n\\n`;
    response += `Next week could be yours! 🚀`;

    return response;
  }

  // Build full response with ALL data
  let response = `📊 **Stats for ${farcaster.display_name}** (@${farcaster.username})\\n\\n`;

  // ===== ON-CHAIN REWARDS =====
  if (stats?.allTime) {
    response += `💰 **ALL-TIME REWARDS**\\n`;
    response += `Total Earned: $${stats.allTime.total_usdc}\\n`;
    response += `Rank: #${stats.allTime.all_time_rank} 🏆\\n`;
    response += `Weeks Earned: ${stats.allTime.total_weeks_earned}\\n\\n`;
  }

  if (stats?.weekly) {
    response += `📈 **THIS WEEK**\\n`;
    response += `Earned: $${stats.weekly.this_week_usdc}\\n`;
    response += `Rank: #${stats.weekly.rank}\\n`;
    response += `Previous Week: $${stats.weekly.previous_week_usdc}\\n`;

    if (stats.weekly.pct_change) {
      const change = parseFloat(stats.weekly.pct_change);
      const arrow = change > 0 ? '📈' : change < 0 ? '📉' : '→';
      response += `Change: ${change >= 0 ? '+' : ''}${stats.weekly.pct_change}% ${arrow}\\n`;
    }
    response += '\\n';
  }

  // ===== SOCIAL STATS (TWO PERIODS) =====
  if (farcaster.fid) {
    const latestWeekStart = dataCache.weeklyLeaderboard.latest_week_start_utc;
    const previousWeekStart = dataCache.weeklyLeaderboard.previous_week_start_utc;

    if (latestWeekStart) {
      // Current week
      const currentSocial = await getSocialStats(
        farcaster.fid,
        latestWeekStart,
        new Date().toISOString()
      );

      if (currentSocial) {
        response += `📱 **${CONFIG.PLATFORM_NAME.toUpperCase()} ACTIVITY (This Week)**\\n`;
        response += `Posts: ${currentSocial.casts}\\n`;
        response += `Likes: ${currentSocial.likes}\\n`;
        response += `Recasts: ${currentSocial.recasts}\\n`;
        response += `Replies: ${currentSocial.replies}\\n\\n`;
      }

      // Previous week
      if (previousWeekStart) {
        const previousSocial = await getSocialStats(
          farcaster.fid,
          previousWeekStart,
          latestWeekStart
        );

        if (previousSocial) {
          response += `📱 **${CONFIG.PLATFORM_NAME.toUpperCase()} ACTIVITY (Last Week)**\\n`;
          response += `Posts: ${previousSocial.casts}\\n`;
          response += `Likes: ${previousSocial.likes}\\n`;
          response += `Recasts: ${previousSocial.recasts}\\n`;
          response += `Replies: ${previousSocial.replies}\\n\\n`;
        }
      }
    }
  }

  // ===== COMMUNITY =====
  response += `👥 **COMMUNITY**\\n`;
  response += `Followers: ${farcaster.follower_count?.toLocaleString() || 0}\\n`;
  response += `Following: ${farcaster.following_count?.toLocaleString() || 0}\\n\\n`;

  response += `🎉 Keep creating on ${CONFIG.PLATFORM_NAME}! 🚀`;

  return response;
}

function formatLeaderboard(type = 'weekly', count = 10) {
  const data = type === 'weekly' 
    ? dataCache.weeklyLeaderboard
    : dataCache.allTimeLeaderboard;

  const topN = data.rows.slice(0, count);

  let response = type === 'weekly'
    ? `🏆 **${CONFIG.PLATFORM_NAME} Top ${count} - This Week**\\n\\n`
    : `🏆 **${CONFIG.PLATFORM_NAME} Top ${count} - All-Time**\\n\\n`;

  topN.forEach((user, idx) => {
    const fc = dataCache.farcasterMap[user.address.toLowerCase()];
    const name = fc?.username || `User${idx + 1}`;

    if (type === 'weekly') {
      response += `${idx + 1}. @${name}: $${user.this_week_usdc} 💰\\n`;
    } else {
      response += `${idx + 1}. @${name}: $${user.total_usdc} (${user.total_weeks_earned} wks)\\n`;
    }
  });

  if (type === 'weekly') {
    response += `\\nTotal: $${dataCache.overview.latest_week.total_usdc.toLocaleString()} to ${dataCache.overview.latest_week.unique_users.toLocaleString()} creators! 🎊`;
  }

  return response;
}

function formatOverview() {
  const ov = dataCache.overview;

  let response = `📊 **${CONFIG.PLATFORM_NAME} Platform Overview**\\n\\n`;
  response += `💎 **ALL-TIME**\\n`;
  response += `Distributed: $${ov.all_time.total_usdc.toLocaleString()}\\n`;
  response += `Unique Users: ${ov.all_time.unique_users.toLocaleString()}\\n\\n`;

  response += `📈 **THIS WEEK**\\n`;
  response += `Rewards: $${ov.latest_week.total_usdc.toLocaleString()}\\n`;
  response += `Eligible: ${ov.latest_week.unique_users.toLocaleString()}\\n\\n`;

  response += `💰 **BREAKDOWN (Top 5 Tiers)**\\n`;
  ov.latest_week.breakdown.slice(0, 5).forEach(tier => {
    response += `$${tier.reward_usdc}: ${tier.users} users\\n`;
  });

  return response;
}

// ===== QUERY PARSING WITH CLAUDE =====

async function parseQueryWithClaude(message) {
  try {
    const systemPrompt = `You are a query parser for ${CONFIG.PLATFORM_NAME} rewards bot. Extract structured data from user queries.

Query types:
- user_stats: User asking for someone's stats/earnings/rank
- leaderboard_weekly: Top performers this week
- leaderboard_alltime: Top performers all-time
- platform_overview: Platform stats, total rewards, summary
- help: User asking how to use bot

For user_stats, extract the username/address from queries like:
- "stats for femiii"
- "how much did @alice earn"
- "show akbaronchain"
- "femiii.base.eth"
- "check 0x123..."

Respond ONLY with JSON:
{
  "type": "query_type",
  "identifier": "username or address",
  "count": 10
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      system: systemPrompt,
      messages: [{ role: 'user', content: message }],
    });

    const text = response.content[0].text.trim();
    const jsonMatch = text.match(/\\{[\\s\\S]*\\}/);

    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    return { type: 'help' };
  } catch (error) {
    console.error('Parse error:', error.message);
    return { type: 'help' };
  }
}

async function generateResponse(message, twitterUsername) {
  try {
    const query = await parseQueryWithClaude(message);
    console.log('   Query type:', query.type);

    switch (query.type) {
      case 'user_stats':
        const id = query.identifier || twitterUsername;
        return await formatCompleteUserStats(id);

      case 'leaderboard_weekly':
        return formatLeaderboard('weekly', query.count || 10);

      case 'leaderboard_alltime':
        return formatLeaderboard('alltime', query.count || 10);

      case 'platform_overview':
        return formatOverview();

      case 'help':
      default:
        return `👋 **${CONFIG.PLATFORM_NAME} Bot Commands:**\\n\\n` +
               `📊 "stats for [username]" - User stats\\n` +
               `🏆 "top 10" - Weekly leaderboard\\n` +
               `💰 "all-time top 10" - All-time leaders\\n` +
               `📈 "platform stats" - Overview\\n\\n` +
               `Just mention me and ask!`;
    }
  } catch (error) {
    console.error('Response error:', error.message);
    return `Sorry, I'm having trouble! Please try again. 🤖`;
  }
}

// ===== TWITTER FUNCTIONS =====

function splitIntoTweets(text) {
  if (text.length <= CONFIG.MAX_TWEET_LENGTH) {
    return [text];
  }

  const parts = text.split('\\n\\n');
  const tweets = [];
  let current = '';

  for (const part of parts) {
    if ((current + part + '\\n\\n').length > 270) {
      if (current) tweets.push(current.trim());
      current = part + '\\n\\n';
    } else {
      current += part + '\\n\\n';
    }
  }

  if (current.trim()) tweets.push(current.trim());

  return tweets;
}

async function replyToTweet(tweetId, message) {
  try {
    const tweets = splitIntoTweets(message);
    let lastId = tweetId;

    for (let i = 0; i < tweets.length; i++) {
      const text = tweets.length > 1
        ? `(${i + 1}/${tweets.length})\\n${tweets[i]}`
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
    console.error('   ❌ Reply failed:', error.message);
    return false;
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

    if (lastMentionId) {
      params.since_id = lastMentionId;
    }

    const mentions = await rwClient.v2.userMentionTimeline(botUserId, params);

    if (!mentions.data?.data?.length) return;

    lastMentionId = mentions.data.meta.newest_id;

    for (const tweet of mentions.data.data) {
      if (processedTweets.has(tweet.id) || tweet.author_id === botUserId) {
        continue;
      }

      const author = mentions.includes?.users?.find(u => u.id === tweet.author_id);
      const username = author?.username || 'user';

      console.log(`\\n📨 Mention from @${username}`);

      const message = tweet.text.replace(/@\\w+/g, '').trim();
      const response = await generateResponse(message, username);

      await replyToTweet(tweet.id, response);

      processedTweets.add(tweet.id);

      // Small delay between replies
      await new Promise(r => setTimeout(r, 3000));
    }
  } catch (error) {
    console.error('❌ Error processing mentions:', error.message);
    
    if (error.code === 429) {
      console.log('   ⏳ Rate limited, waiting 15min...');
      await new Promise(r => setTimeout(r, 15 * 60 * 1000));
    }
  }
}

// ===== DAILY POSTING =====

function getDayInCycle() {
  const weekStart = dataCache.weeklyLeaderboard?.latest_week_start_utc;
  if (!weekStart) return 0;

  const start = new Date(weekStart);
  const now = new Date();
  const days = Math.floor((now - start) / (1000 * 60 * 60 * 24));

  return (days % 10) + 1; // 1-10
}

function getWeekNumber() {
  return dataCache.allTimeLeaderboard?.week_keys?.length || 0;
}

async function postDailyWinners() {
  try {
    const today = new Date().toISOString().split('T')[0];

    if (lastDailyPost === today) {
      console.log('📅 Already posted today');
      return;
    }

    const day = getDayInCycle();
    const week = getWeekNumber();

    const startRank = (day - 1) * 10 + 1;
    const endRank = day * 10;

    console.log(`\\n📅 Posting daily winners: Day ${day}/10, Ranks ${startRank}-${endRank}`);

    const winners = dataCache.weeklyLeaderboard.rows
      .filter(r => r.rank >= startRank && r.rank <= endRank)
      .slice(0, 10);

    if (!winners.length) {
      console.log('   No winners for this range');
      return;
    }

    let post = `🏆 ${CONFIG.PLATFORM_NAME} Weekly Rewards - Week ${week}\\n\\n`;
    post += `Top Performers (#${startRank}-${endRank}):\\n\\n`;

    winners.forEach(w => {
      const fc = dataCache.farcasterMap[w.address.toLowerCase()];
      const username = fc?.username || `user${w.rank}`;
      const emoji = w.this_week_usdc >= 100 ? '💰' : 
                    w.this_week_usdc >= 50 ? '💎' : '⭐';
      post += `${w.rank}. @${username} - $${w.this_week_usdc} ${emoji}\\n`;
    });

    post += `\\nKeep creating on ${CONFIG.PLATFORM_NAME}! 🚀\\n`;
    post += `#${CONFIG.PLATFORM_NAME} #Rewards #Base`;

    await rwClient.v2.tweet(post);

    console.log('   ✅ Posted!');
    lastDailyPost = today;
  } catch (error) {
    console.error('❌ Daily post failed:', error.message);
  }
}

// ===== MAIN BOT =====

async function runBot() {
  console.log(`\\n🤖 ${CONFIG.PLATFORM_NAME} ULTIMATE BOT Starting...\\n`);

  await loadData();

  const me = await rwClient.v2.me();
  const botUserId = me.data.id;

  console.log(`✅ Authenticated as @${me.data.username}`);
  console.log(`👂 Listening for mentions...`);
  console.log(`📅 Daily posts: ${CONFIG.ENABLE_DAILY_POSTS ? 'ENABLED' : 'DISABLED'}\\n`);
  console.log('─'.repeat(60));

  // Initial mention check
  await processMentions(botUserId);

  // Poll for mentions
  setInterval(async () => {
    await processMentions(botUserId);
  }, CONFIG.POLL_INTERVAL);

  // Daily posting check (every hour)
  if (CONFIG.ENABLE_DAILY_POSTS) {
    setInterval(async () => {
      const hour = new Date().getUTCHours();
      if (hour === CONFIG.DAILY_POST_TIME_UTC) {
        await postDailyWinners();
      }
    }, 60 * 60 * 1000);

    // Check on startup too
    const hour = new Date().getUTCHours();
    if (hour === CONFIG.DAILY_POST_TIME_UTC) {
      setTimeout(() => postDailyWinners(), 10000);
    }
  }
}

process.on('SIGINT', () => {
  console.log('\\n👋 Bot shutting down...');
  process.exit(0);
});

runBot().catch(console.error);
