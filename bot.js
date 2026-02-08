import Anthropic from '@anthropic-ai/sdk';
import { TwitterApi } from 'twitter-api-v2';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

// Initialize Twitter client
const client = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_SECRET,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
});

const rwClient = client.readWrite;

// Initialize Anthropic
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Store processed tweet IDs
const processedTweets = new Set();
let lastMentionId = null;

// Data cache (reload periodically)
let dataCache = {
  overview: null,
  allTimeLeaderboard: null,
  weeklyLeaderboard: null,
  farcasterMap: null,
  lastUpdated: null,
};

/**
 * Load data from local JSON files (bundled with bot)
 */
async function loadData() {
  try {
    console.log('🔄 Loading data from local files...');
    
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

    console.log('✅ Data loaded successfully from local files');
    console.log(`   - Total users: ${dataCache.overview.all_time.unique_users}`);
    console.log(`   - All-time rewards: $${dataCache.overview.all_time.total_usdc}`);
    console.log(`   - Latest week: $${dataCache.overview.latest_week.total_usdc}`);
    console.log(`   - Last updated: ${dataCache.lastUpdated.toISOString()}`);
  } catch (error) {
    console.error('❌ Error loading data:', error.message);
    console.error('   Make sure JSON files exist in the data/ folder!');
    throw error;
  }
}

/**
 * Find user by Farcaster username or wallet address
 */
function findUser(identifier) {
  identifier = identifier.toLowerCase().trim();
  
  // Remove .base.eth or .eth if present
  const cleanIdentifier = identifier.replace(/\.(base\.)?eth$/i, '');
  
  // Search in Farcaster map
  for (const [address, userData] of Object.entries(dataCache.farcasterMap)) {
    if (userData.status !== 'ok') continue;
    
    // Match by username (with or without .base.eth)
    const username = userData.username?.toLowerCase();
    if (username === cleanIdentifier || username === identifier) {
      return { address: address.toLowerCase(), farcaster: userData };
    }
    
    // Match by display name
    if (userData.display_name?.toLowerCase() === cleanIdentifier) {
      return { address: address.toLowerCase(), farcaster: userData };
    }
  }
  
  // Search by wallet address
  const addressKey = identifier.toLowerCase();
  if (dataCache.farcasterMap[addressKey]) {
    return {
      address: addressKey,
      farcaster: dataCache.farcasterMap[addressKey],
    };
  }
  
  return null;
}

/**
 * Get user stats from leaderboards
 */
function getUserStats(address) {
  const normalizedAddress = address.toLowerCase();
  
  // Find in all-time leaderboard
  const allTimeEntry = dataCache.allTimeLeaderboard.rows.find(
    row => row.address.toLowerCase() === normalizedAddress
  );
  
  // Find in weekly leaderboard
  const weeklyEntry = dataCache.weeklyLeaderboard.rows.find(
    row => row.address.toLowerCase() === normalizedAddress
  );
  
  return {
    allTime: allTimeEntry,
    weekly: weeklyEntry,
  };
}

/**
 * Get Farcaster social stats via Neynar API
 */
async function getFarcasterStats(fid) {
  try {
    const response = await fetch(
      `https://api.neynar.com/v2/farcaster/user/bulk?fids=${fid}`,
      {
        headers: {
          'accept': 'application/json',
          'api_key': process.env.NEYNAR_API_KEY,
        },
      }
    );

    if (!response.ok) {
      console.error(`Neynar API error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data.users?.[0] || null;
  } catch (error) {
    console.error('Error fetching Neynar data:', error.message);
    return null;
  }
}

/**
 * Format user stats into a readable response
 */
async function formatUserStats(identifier) {
  const user = findUser(identifier);
  
  if (!user) {
    return `❌ User "${identifier}" not found. Make sure to use their Farcaster username (e.g., akbaronchain.base.eth) or wallet address.`;
  }

  const stats = getUserStats(user.address);
  const farcaster = user.farcaster;
  
  let response = '';
  
  // User identity
  if (farcaster.status === 'ok') {
    response += `📊 Stats for ${farcaster.display_name} (@${farcaster.username})\\n\\n`;
  } else {
    response += `📊 Stats for ${user.address}\\n\\n`;
  }

  // All-time stats
  if (stats.allTime) {
    response += `💰 All-Time Earnings: $${stats.allTime.total_usdc}\\n`;
    response += `🏆 All-Time Rank: #${stats.allTime.all_time_rank}\\n`;
    response += `📅 Weeks Earned: ${stats.allTime.total_weeks_earned}\\n\\n`;
  } else {
    response += `💰 All-Time Earnings: $0 (not in top rankings)\\n\\n`;
  }

  // Weekly stats
  if (stats.weekly) {
    response += `📈 This Week: $${stats.weekly.this_week_usdc}\\n`;
    response += `📉 Previous Week: $${stats.weekly.previous_week_usdc}\\n`;
    response += `🎯 Weekly Rank: #${stats.weekly.rank}\\n`;
    
    if (stats.weekly.pct_change) {
      const change = parseFloat(stats.weekly.pct_change);
      const emoji = change > 0 ? '🔥' : '📊';
      response += `${emoji} Change: ${change > 0 ? '+' : ''}${stats.weekly.pct_change}%\\n`;
    }
  } else {
    response += `📈 This Week: $0\\n`;
    response += `📉 Previous Week: $0\\n`;
  }

  // Farcaster social stats
  if (farcaster.status === 'ok') {
    response += `\\n👥 Followers: ${farcaster.follower_count?.toLocaleString() || 0}\\n`;
    response += `🤝 Following: ${farcaster.following_count?.toLocaleString() || 0}\\n`;
  }

  // Encouragement
  if (stats.allTime || stats.weekly) {
    response += `\\n🎉 You're doing great on BaseApp! Keep it up! 🚀`;
  } else {
    response += `\\n💡 Start earning by being active on Farcaster! 🚀`;
  }

  return response;
}

/**
 * Get top 10 users for a specific leaderboard
 */
function getTop10(type = 'weekly') {
  const data = type === 'weekly' 
    ? dataCache.weeklyLeaderboard 
    : dataCache.allTimeLeaderboard;
  
  const top10 = data.rows.slice(0, 10);
  
  let response = type === 'weekly' 
    ? `🏆 Top 10 This Week:\\n\\n`
    : `🏆 Top 10 All-Time:\\n\\n`;

  top10.forEach((user, index) => {
    const farcaster = dataCache.farcasterMap[user.address.toLowerCase()];
    const displayName = farcaster?.username || user.user_display;
    
    if (type === 'weekly') {
      response += `${index + 1}. @${displayName}: $${user.this_week_usdc}\\n`;
    } else {
      response += `${index + 1}. @${displayName}: $${user.total_usdc} (${user.total_weeks_earned} weeks)\\n`;
    }
  });

  return response;
}

/**
 * Get overview stats
 */
function getOverviewStats() {
  const overview = dataCache.overview;
  
  let response = `📊 BaseApp Rewards Overview:\\n\\n`;
  response += `💎 All-Time:\\n`;
  response += `  • Total Distributed: $${overview.all_time.total_usdc}\\n`;
  response += `  • Unique Users: ${overview.all_time.unique_users.toLocaleString()}\\n\\n`;
  
  response += `📈 This Week:\\n`;
  response += `  • Rewards: $${overview.latest_week.total_usdc}\\n`;
  response += `  • Eligible Users: ${overview.latest_week.unique_users}\\n\\n`;
  
  response += `💰 Reward Breakdown:\\n`;
  overview.latest_week.breakdown.forEach(tier => {
    response += `  • $${tier.reward_usdc}: ${tier.users} users\\n`;
  });

  return response;
}

/**
 * Extract query intent and parameters using Claude
 */
async function parseQuery(message) {
  try {
    const systemPrompt = `You are a query parser for a BaseApp rewards bot. Extract structured data from user queries.

Available query types:
1. user_stats - User asking for their or someone's stats
2. top_10_weekly - Top 10 users this week
3. top_10_alltime - Top 10 users all-time
4. overview - General overview/summary stats
5. general - General question or greeting

For user_stats queries, extract the username or address from queries like:
- "show stats for akbaronchain.base.eth"
- "how much did @femiii earn"
- "my stats" (means they want their own stats - needs Twitter handle lookup)

Respond ONLY with JSON:
{
  "type": "query_type",
  "identifier": "username or address (if applicable)",
  "needs_twitter_lookup": true/false
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `Parse this query: "${message}"`
        }
      ],
    });

    const text = response.content[0].text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    return { type: 'general', identifier: null, needs_twitter_lookup: false };
  } catch (error) {
    console.error('Error parsing query:', error);
    return { type: 'general', identifier: null, needs_twitter_lookup: false };
  }
}

/**
 * Generate AI response with data
 */
async function generateResponse(message, twitterUsername = null) {
  try {
    // Parse the query intent
    const query = await parseQuery(message);
    console.log('📋 Query parsed:', query);

    let dataResponse = '';

    // Handle different query types
    switch (query.type) {
      case 'user_stats':
        if (query.identifier) {
          dataResponse = await formatUserStats(query.identifier);
        } else if (query.needs_twitter_lookup && twitterUsername) {
          // Try to find by Twitter username
          dataResponse = await formatUserStats(twitterUsername);
        } else {
          dataResponse = `Please provide a Farcaster username (e.g., @akbaronchain.base.eth) or wallet address to check stats.`;
        }
        break;

      case 'top_10_weekly':
        dataResponse = getTop10('weekly');
        break;

      case 'top_10_alltime':
        dataResponse = getTop10('alltime');
        break;

      case 'overview':
        dataResponse = getOverviewStats();
        break;

      case 'general':
        // Use AI to generate a general response
        const aiResponse = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 280,
          system: `You are the BaseApp rewards bot. Be helpful and concise.
Available commands:
- Ask for user stats: "show stats for [username]"
- Top 10: "show top 10 this week" or "all-time top 10"
- Overview: "total rewards" or "how much distributed"

Keep responses under 280 characters and friendly.`,
          messages: [{ role: 'user', content: message }],
        });
        
        return aiResponse.content[0].text;

      default:
        dataResponse = `I can help you with:\\n• User stats\\n• Top 10 leaderboards\\n• Reward summaries\\n\\nTry: "show stats for akbaronchain.base.eth"`;
    }

    return dataResponse;
  } catch (error) {
    console.error('Error generating response:', error);
    return `Sorry, I'm having trouble processing that. Please try again! 🤖`;
  }
}

/**
 * Split long responses into tweets
 */
function splitIntoTweets(text) {
  const maxLength = 280;
  
  if (text.length <= maxLength) {
    return [text];
  }

  const lines = text.split('\\n');
  const tweets = [];
  let currentTweet = '';

  for (const line of lines) {
    if ((currentTweet + line + '\\n').length > maxLength) {
      if (currentTweet) {
        tweets.push(currentTweet.trim());
        currentTweet = line + '\\n';
      } else {
        // Line itself is too long, split it
        tweets.push(line.substring(0, maxLength - 3) + '...');
      }
    } else {
      currentTweet += line + '\\n';
    }
  }

  if (currentTweet.trim()) {
    tweets.push(currentTweet.trim());
  }

  return tweets;
}

/**
 * Reply to a tweet (with thread support for long responses)
 */
async function replyToTweet(tweetId, username, message) {
  try {
    const tweets = splitIntoTweets(message);
    let lastTweetId = tweetId;

    for (let i = 0; i < tweets.length; i++) {
      const tweetText = tweets.length > 1 
        ? `(${i + 1}/${tweets.length}) ${tweets[i]}`
        : tweets[i];

      const response = await rwClient.v2.reply(tweetText, lastTweetId);
      lastTweetId = response.data.id;
      
      console.log(`✅ Replied ${i + 1}/${tweets.length} to @${username}`);

      // Wait between tweets in thread
      if (i < tweets.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    return true;
  } catch (error) {
    console.error('❌ Error replying:', error.message);
    return false;
  }
}

/**
 * Process mentions
 */
async function processMentions(botUserId) {
  try {
    const params = {
      max_results: 10,
      'tweet.fields': ['created_at', 'conversation_id'],
      'user.fields': ['username'],
      expansions: ['author_id'],
    };

    if (lastMentionId) {
      params.since_id = lastMentionId;
    }

    const mentions = await rwClient.v2.userMentionTimeline(botUserId, params);

    if (!mentions.data || mentions.data.data.length === 0) {
      return;
    }

    lastMentionId = mentions.data.meta.newest_id;

    for (const tweet of mentions.data.data) {
      if (processedTweets.has(tweet.id) || tweet.author_id === botUserId) {
        continue;
      }

      const author = mentions.includes.users.find(u => u.id === tweet.author_id);
      const username = author?.username || 'unknown';

      console.log(`\\n📨 Mention from @${username}: ${tweet.text}`);

      // Extract message (remove mentions)
      const message = tweet.text.replace(/@\\w+/g, '').trim();

      // Generate response with data
      const aiResponse = await generateResponse(message, username);

      // Reply
      await replyToTweet(tweet.id, username, aiResponse);

      processedTweets.add(tweet.id);

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  } catch (error) {
    console.error('❌ Error processing mentions:', error.message);
  }
}

/**
 * Main bot loop
 */
async function runBot() {
  console.log('🤖 BaseApp Intelligent Twitter Bot Starting...\\n');

  // Load data
  await loadData();

  // Get bot ID
  const me = await rwClient.v2.me();
  const botUserId = me.data.id;
  console.log(`✅ Authenticated as @${me.data.username}\\n`);
  console.log('👂 Listening for mentions...\\n');
  console.log('─'.repeat(60));

  // Initial run
  await processMentions(botUserId);

  // Poll every 60 seconds
  setInterval(async () => {
    await processMentions(botUserId);
  }, 60000);

  // Auto-sync data from Vercel every 6 hours
  setInterval(async () => {
    console.log('\\n🔄 Auto-syncing data from Vercel...');
    try {
      await loadData();
      console.log('✅ Auto-sync complete!');
    } catch (error) {
      console.error('❌ Auto-sync failed:', error.message);
    }
  }, 6 * 60 * 60 * 1000); // 6 hours
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\\n👋 Bot shutting down...');
  process.exit(0);
});

// Start bot
runBot().catch(console.error);
