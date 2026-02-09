// ========================================
// BASEAPP ULTIMATE BOT - FIXED VERSION
// Better natural language, clearer responses
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
  POLL_INTERVAL: 60000,
  DAILY_POST_TIME_UTC: 10,
  ENABLE_DAILY_POSTS: true,
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
  } catch (error) {
    console.error('❌ Error loading data:', error.message);
    throw error;
  }
}

// ===== NEYNAR API =====

async function getNeynarUserByUsername(username, retries = 3) {
  const apiKey = process.env.NEYNAR_API_KEY;
  if (!apiKey) throw new Error('NEYNAR_API_KEY required!');

  const cleanUsername = username.replace(/@/g, '').replace(/\\.base\\.eth$/i, '').replace(/\\.eth$/i, '');

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`🔍 Neynar lookup: ${cleanUsername} (${attempt}/${retries})`);
      
      const response = await fetch(
        `https://api.neynar.com/v2/farcaster/user/by_username?username=${encodeURIComponent(cleanUsername)}`,
        {
          headers: {
            'accept': 'application/json',
            'api_key': apiKey,
          },
          signal: AbortSignal.timeout(10000),
        }
      );

      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

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
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
      }
    }
  }

  return null;
}

async function getUserCasts(fid, startMs, endMs) {
  const apiKey = process.env.NEYNAR_API_KEY;
  if (!apiKey) return [];

  const casts = [];
  let cursor = null;

  try {
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

      if (!response.ok) break;

      const json = await response.json();
      const items = json.casts || [];

      for (const cast of items) {
        const createdAt = cast.timestamp || cast.created_at;
        if (!createdAt) continue;

        const castMs = new Date(createdAt).getTime();
        
        if (castMs >= startMs && castMs < endMs) {
          casts.push(cast);
        }
        
        if (castMs < startMs) return casts;
      }

      cursor = json.next?.cursor || null;
      if (!cursor) break;
      
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } catch (error) {
    console.error('   Error fetching casts:', error.message);
  }

  return casts;
}

async function getSocialStats(fid, startIso, endIso) {
  try {
    const startMs = new Date(startIso).getTime();
    const endMs = new Date(endIso).getTime();

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
    return null;
  }
}

// ===== SMART QUERY PARSING (NO CLAUDE NEEDED!) =====

function parseQuery(message) {
  const lower = message.toLowerCase().trim();

  // Extract username/address patterns
  const usernameMatch = message.match(/(?:for|of|about|show|stats|check|data)\\s+(@?[a-zA-Z0-9._-]+)/i);
  const addressMatch = message.match(/(0x[a-fA-F0-9]{40})/);
  const ethNameMatch = message.match(/([a-zA-Z0-9._-]+\\.eth)/i);

  // User stats queries
  if (
    lower.includes('stat') ||
    lower.includes('earn') ||
    lower.includes('rank') ||
    lower.includes('show') ||
    lower.includes('data') ||
    lower.includes('check') ||
    lower.includes('how much') ||
    lower.includes('profile') ||
    usernameMatch ||
    addressMatch ||
    ethNameMatch
  ) {
    const identifier = 
      usernameMatch?.[1] ||
      addressMatch?.[1] ||
      ethNameMatch?.[1] ||
      null;

    return {
      type: 'user_stats',
      identifier: identifier?.replace(/@/g, ''),
    };
  }

  // Leaderboard queries
  if (
    lower.includes('top') ||
    lower.includes('leader') ||
    lower.includes('rank') ||
    lower.includes('best') ||
    lower.includes('winner')
  ) {
    const allTime = lower.includes('all') || lower.includes('total') || lower.includes('lifetime');
    const countMatch = lower.match(/top\\s+(\\d+)/);
    
    return {
      type: allTime ? 'leaderboard_alltime' : 'leaderboard_weekly',
      count: countMatch ? parseInt(countMatch[1]) : 10,
    };
  }

  // Platform overview
  if (
    lower.includes('platform') ||
    lower.includes('overview') ||
    lower.includes('summary') ||
    lower.includes('total') ||
    lower.includes('distributed')
  ) {
    return { type: 'platform_overview' };
  }

  // Help
  if (
    lower.includes('help') ||
    lower.includes('command') ||
    lower.includes('how') ||
    lower.includes('what can')
  ) {
    return { type: 'help' };
  }

  // Default: If message is short and looks like a username, treat as user stats
  if (message.length < 50 && !lower.includes('?')) {
    const words = message.trim().split(/\\s+/);
    if (words.length <= 3) {
      return {
        type: 'user_stats',
        identifier: words[words.length - 1].replace(/@/g, ''),
      };
    }
  }

  return { type: 'help' };
}

// ===== USER LOOKUP =====

function findUserInCache(identifier) {
  identifier = identifier.toLowerCase().trim();
  const cleanId = identifier.replace(/\\.base\\.eth$/i, '').replace(/\\.eth$/i, '').replace(/@/g, '');

  // Try direct address match
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

    if (username.includes(cleanId) || cleanId.includes(usernameBase) || usernameBase === cleanId) {
      return { address: address.toLowerCase(), farcaster: data, source: 'cache' };
    }

    const displayName = (data.display_name || '').toLowerCase();
    if (displayName === cleanId) {
      return { address: address.toLowerCase(), farcaster: data, source: 'cache' };
    }
  }

  return null;
}

async function findUser(identifier) {
  const cached = findUserInCache(identifier);
  if (cached) {
    console.log(`   ✅ Found in cache`);
    return cached;
  }

  console.log(`   🔍 Not in cache, trying Neynar...`);
  const neynarUser = await getNeynarUserByUsername(identifier);
  
  if (!neynarUser) return null;

  const ethAddresses = neynarUser.verified_addresses?.eth_addresses || [];

  for (const addr of ethAddresses) {
    const normalized = addr.toLowerCase();

    const allTimeEntry = dataCache.allTimeLeaderboard.rows.find(
      row => row.address.toLowerCase() === normalized
    );

    if (allTimeEntry) {
      console.log(`   ✅ Matched to rewards!`);
      return {
        address: normalized,
        farcaster: neynarUser,
        source: 'neynar',
      };
    }
  }

  return {
    address: null,
    farcaster: neynarUser,
    source: 'neynar',
    hasRewards: false,
  };
}

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

// ===== RESPONSE FORMATTING (CLEANER!) =====

async function formatCompleteUserStats(identifier) {
  console.log(`\\n📊 Getting stats for: ${identifier}`);

  const user = await findUser(identifier);

  if (!user) {
    return `❌ Sorry, I couldn't find "${identifier}".\\n\\nTry:\\n• Their ${CONFIG.PLATFORM_NAME} username\\n• Their wallet address\\n• username.base.eth format`;
  }

  const { address, farcaster, hasRewards } = user;

  let stats = null;
  if (address) {
    stats = getUserRewardStats(address);
  }

  // User has no rewards yet
  if (!address || hasRewards === false) {
    let response = `👋 ${farcaster.display_name || identifier}!\\n\\n`;
    response += `I found you, but you haven't earned ${CONFIG.PLATFORM_NAME} rewards yet.\\n\\n`;
    
    // Still show their activity!
    if (farcaster.fid) {
      const latestWeekStart = dataCache.weeklyLeaderboard.latest_week_start_utc;
      if (latestWeekStart) {
        const social = await getSocialStats(
          farcaster.fid,
          latestWeekStart,
          new Date().toISOString()
        );

        if (social) {
          response += `📱 This Week:\\n`;
          response += `• ${social.casts} posts\\n`;
          response += `• ${social.likes} likes\\n`;
          response += `• ${social.recasts} recasts\\n\\n`;
        }
      }
    }

    response += `👥 ${farcaster.follower_count?.toLocaleString() || 0} followers\\n\\n`;
    response += `💡 Start creating on ${CONFIG.PLATFORM_NAME} to earn rewards! 🚀`;

    return response;
  }

  // Full stats response
  let response = `📊 ${farcaster.display_name} (@${farcaster.username})\\n\\n`;

  // Rewards
  if (stats?.allTime) {
    response += `💰 ALL-TIME\\n`;
    response += `• Earned: $${stats.allTime.total_usdc}\\n`;
    response += `• Rank: #${stats.allTime.all_time_rank} 🏆\\n`;
    response += `• Weeks: ${stats.allTime.total_weeks_earned}\\n\\n`;
  }

  if (stats?.weekly) {
    response += `📈 THIS WEEK\\n`;
    response += `• $${stats.weekly.this_week_usdc} (Rank #${stats.weekly.rank})\\n`;
    response += `• Last week: $${stats.weekly.previous_week_usdc}\\n`;

    if (stats.weekly.pct_change) {
      const change = parseFloat(stats.weekly.pct_change);
      const arrow = change > 0 ? '📈' : change < 0 ? '📉' : '→';
      response += `• Change: ${change >= 0 ? '+' : ''}${stats.weekly.pct_change}% ${arrow}\\n`;
    }
    response += '\\n';
  }

  // Social stats
  if (farcaster.fid) {
    const latestWeekStart = dataCache.weeklyLeaderboard.latest_week_start_utc;
    const previousWeekStart = dataCache.weeklyLeaderboard.previous_week_start_utc;

    if (latestWeekStart) {
      const currentSocial = await getSocialStats(
        farcaster.fid,
        latestWeekStart,
        new Date().toISOString()
      );

      if (currentSocial) {
        response += `📱 THIS WEEK\\n`;
        response += `• ${currentSocial.casts} posts\\n`;
        response += `• ${currentSocial.likes} likes received\\n`;
        response += `• ${currentSocial.recasts} recasts\\n`;
        response += `• ${currentSocial.replies} replies\\n\\n`;
      }

      if (previousWeekStart) {
        const previousSocial = await getSocialStats(
          farcaster.fid,
          previousWeekStart,
          latestWeekStart
        );

        if (previousSocial) {
          response += `📱 LAST WEEK\\n`;
          response += `• ${previousSocial.casts} posts\\n`;
          response += `• ${previousSocial.likes} likes\\n`;
          response += `• ${previousSocial.recasts} recasts\\n`;
          response += `• ${previousSocial.replies} replies\\n\\n`;
        }
      }
    }
  }

  // Community
  response += `👥 ${farcaster.follower_count?.toLocaleString() || 0} followers\\n\\n`;
  response += `Keep creating! 🚀`;

  return response;
}

function formatLeaderboard(type = 'weekly', count = 10) {
  const data = type === 'weekly' 
    ? dataCache.weeklyLeaderboard
    : dataCache.allTimeLeaderboard;

  const topN = data.rows.slice(0, count);

  let response = type === 'weekly'
    ? `🏆 Top ${count} This Week\\n\\n`
    : `🏆 Top ${count} All-Time\\n\\n`;

  topN.forEach((user, idx) => {
    const fc = dataCache.farcasterMap[user.address.toLowerCase()];
    const name = fc?.username || `user${idx + 1}`;

    if (type === 'weekly') {
      response += `${idx + 1}. @${name} - $${user.this_week_usdc}\\n`;
    } else {
      response += `${idx + 1}. @${name} - $${user.total_usdc}\\n`;
    }
  });

  if (type === 'weekly') {
    response += `\\n$${dataCache.overview.latest_week.total_usdc.toLocaleString()} to ${dataCache.overview.latest_week.unique_users.toLocaleString()} creators! 🎉`;
  }

  return response;
}

function formatOverview() {
  const ov = dataCache.overview;

  let response = `📊 ${CONFIG.PLATFORM_NAME} Overview\\n\\n`;
  response += `💎 ALL-TIME\\n`;
  response += `• $${ov.all_time.total_usdc.toLocaleString()} distributed\\n`;
  response += `• ${ov.all_time.unique_users.toLocaleString()} unique users\\n\\n`;

  response += `📈 THIS WEEK\\n`;
  response += `• $${ov.latest_week.total_usdc.toLocaleString()} in rewards\\n`;
  response += `• ${ov.latest_week.unique_users.toLocaleString()} eligible users\\n\\n`;

  response += `💰 Top rewards: $${ov.latest_week.breakdown[0]?.reward_usdc || 0} to ${ov.latest_week.breakdown[0]?.users || 0} users`;

  return response;
}

function formatHelp() {
  return `👋 ${CONFIG.PLATFORM_NAME} Bot\\n\\n` +
         `Try these:\\n\\n` +
         `📊 "stats for [username]"\\n` +
         `   Example: stats for femiii\\n\\n` +
         `🏆 "top 10"\\n` +
         `   Shows weekly leaderboard\\n\\n` +
         `💰 "platform stats"\\n` +
         `   Shows overview\\n\\n` +
         `Just ask naturally!`;
}

// ===== GENERATE RESPONSE =====

async function generateResponse(message, twitterUsername) {
  try {
    const query = parseQuery(message);
    console.log('   Type:', query.type, query.identifier || '');

    switch (query.type) {
      case 'user_stats':
        const id = query.identifier || twitterUsername;
        if (!id) return formatHelp();
        return await formatCompleteUserStats(id);

      case 'leaderboard_weekly':
        return formatLeaderboard('weekly', query.count || 10);

      case 'leaderboard_alltime':
        return formatLeaderboard('alltime', query.count || 10);

      case 'platform_overview':
        return formatOverview();

      default:
        return formatHelp();
    }
  } catch (error) {
    console.error('Response error:', error.message);
    return `Sorry, something went wrong! Try again or type "help" for commands.`;
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
        ? `(${i + 1}/${tweets.length})\\n\\n${tweets[i]}`
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

      console.log(`\\n📨 @${username}: ${tweet.text.substring(0, 50)}...`);

      const message = tweet.text.replace(/@\\w+/g, '').trim();
      const response = await generateResponse(message, username);

      await replyToTweet(tweet.id, response);

      processedTweets.add(tweet.id);

      await new Promise(r => setTimeout(r, 3000));
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    
    if (error.code === 429) {
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

  return (days % 10) + 1;
}

function getWeekNumber() {
  return dataCache.allTimeLeaderboard?.week_keys?.length || 0;
}

async function postDailyWinners() {
  try {
    const today = new Date().toISOString().split('T')[0];

    if (lastDailyPost === today) {
      return;
    }

    const day = getDayInCycle();
    const week = getWeekNumber();

    const startRank = (day - 1) * 10 + 1;
    const endRank = day * 10;

    console.log(`\\n📅 Daily post: Day ${day}/10, Ranks ${startRank}-${endRank}`);

    const winners = dataCache.weeklyLeaderboard.rows
      .filter(r => r.rank >= startRank && r.rank <= endRank)
      .slice(0, 10);

    if (!winners.length) {
      console.log('   No winners');
      return;
    }

    let post = `🏆 ${CONFIG.PLATFORM_NAME} Week ${week}\\n\\n`;
    post += `Top #${startRank}-${endRank}:\\n\\n`;

    winners.forEach(w => {
      const fc = dataCache.farcasterMap[w.address.toLowerCase()];
      const username = fc?.username || `user${w.rank}`;
      const emoji = w.this_week_usdc >= 100 ? '💰' : 
                    w.this_week_usdc >= 50 ? '💎' : '⭐';
      post += `${w.rank}. @${username} - $${w.this_week_usdc} ${emoji}\\n`;
    });

    post += `\\nKeep creating! 🚀`;

    await rwClient.v2.tweet(post);

    console.log('   ✅ Posted!');
    lastDailyPost = today;
  } catch (error) {
    console.error('❌ Daily post failed:', error.message);
  }
}

// ===== MAIN BOT =====

async function runBot() {
  console.log(`\\n🤖 ${CONFIG.PLATFORM_NAME} Bot Starting...\\n`);

  await loadData();

  const me = await rwClient.v2.me();
  const botUserId = me.data.id;

  console.log(`✅ @${me.data.username}`);
  console.log(`👂 Listening...`);
  console.log(`📅 Daily posts: ${CONFIG.ENABLE_DAILY_POSTS ? 'ON' : 'OFF'}\\n`);

  await processMentions(botUserId);

  setInterval(async () => {
    await processMentions(botUserId);
  }, CONFIG.POLL_INTERVAL);

  if (CONFIG.ENABLE_DAILY_POSTS) {
    setInterval(async () => {
      const hour = new Date().getUTCHours();
      if (hour === CONFIG.DAILY_POST_TIME_UTC) {
        await postDailyWinners();
      }
    }, 60 * 60 * 1000);
  }
}

process.on('SIGINT', () => {
  console.log('\\n👋 Shutting down...');
  process.exit(0);
});

runBot().catch(console.error);
