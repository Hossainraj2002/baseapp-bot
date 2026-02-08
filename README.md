# BaseApp Intelligent Twitter Bot 🤖

An **intelligent AI agent** for Twitter that understands your BaseApp rewards data and provides personalized stats to users.

## What Makes This Bot Special? 🌟

Unlike basic bots that just respond with generic AI, this bot:

✅ **Reads your actual data** - Connects to your miniapp's leaderboard data  
✅ **Auto-syncs from Vercel** - Automatically fetches fresh data every 6 hours!  
✅ **Understands natural language** - Users can ask in any way they want  
✅ **Provides personalized stats** - Shows earnings, rankings, and social data  
✅ **Integrates Farcaster** - Uses Neynar API for social stats  
✅ **Smart query parsing** - Uses Claude AI to understand user intent  
✅ **Handles complex queries** - Top 10, summaries, individual stats, etc.  
✅ **Zero manual updates** - Just update your miniapp, bot syncs automatically!

### 🚀 Built-in Auto-Sync Feature!

The bot **automatically downloads data** from your Vercel deployment:
- ✅ Fetches data when it starts
- ✅ Auto-refreshes every 6 hours
- ✅ Saves local backups
- ✅ No manual work needed!

**Your workflow stays the same:**
1. Update your miniapp data
2. Push to GitHub
3. Vercel deploys
4. Bot auto-syncs ← **Happens automatically!**

---

## Features

### User Stats Queries 👤

Users can ask for stats in many ways:

```
@your_bot show stats for femiii.base.eth
@your_bot how much did akbaronchain earn?
@your_bot what's my rank?
```

Bot responds with:
- All-time earnings and rank
- This week's earnings
- Previous week's earnings
- Week-over-week change
- Farcaster follower/following counts
- Encouragement messages

### Leaderboard Queries 🏆

```
@your_bot top 10 this week
@your_bot show all-time leaderboard
@your_bot who's winning?
```

Bot shows:
- Top 10 users with usernames
- Earnings for each user
- Ranks and trends

### Overview Stats 📊

```
@your_bot how much total rewards?
@your_bot how many users earned this week?
@your_bot reward breakdown
```

Bot provides:
- Total all-time distribution
- This week's rewards
- Reward tier breakdown
- Eligible user counts

---

## Setup Guide

### Prerequisites

You'll need:

1. **Twitter Developer Account** - Get API keys
2. **Anthropic API Key** - For Claude AI
3. **Neynar API Key** (optional) - For enhanced Farcaster data
4. **Your miniapp data** - JSON files from your deployment

### Step 1: Get API Keys (10 minutes)

#### Twitter API Keys

1. Go to https://developer.twitter.com/en/portal/dashboard
2. Create a project and app
3. Set permissions to **"Read and Write"**
4. Generate:
   - API Key
   - API Secret  
   - Access Token
   - Access Token Secret

#### Anthropic API Key

1. Go to https://console.anthropic.com
2. Create an API key
3. Add billing (required for API usage)

#### Neynar API Key (Optional)

1. Go to https://neynar.com
2. Sign up for free tier
3. Get your API key from dashboard

### Step 2: Install & Configure (5 minutes)

```bash
# Navigate to bot directory
cd baseapp-intelligent-bot

# Install dependencies
npm install

# Copy env template
cp .env.example .env

# Edit with your keys
nano .env
```

Fill in `.env`:

```env
# Twitter
TWITTER_API_KEY=your_key
TWITTER_API_SECRET=your_secret
TWITTER_ACCESS_TOKEN=your_token
TWITTER_ACCESS_TOKEN_SECRET=your_token_secret

# Anthropic
ANTHROPIC_API_KEY=sk-ant-xxxxx

# Neynar (optional but recommended)
NEYNAR_API_KEY=your_neynar_key

# Data location
DATA_DIR=./data
MINIAPP_URL=https://baseapp-reward-dashboard.vercel.app
```

### Step 3: Download Data (2 minutes)

Your bot needs the JSON data files from your miniapp. Two options:

#### Option A: Download from your deployment

```bash
npm run update-data
```

This fetches data from your Vercel deployment automatically.

#### Option B: Copy manually

If you have the data locally:

```bash
mkdir -p data
cp /path/to/your/miniapp/data/*.json ./data/
```

You need these files:
- `overview.json`
- `leaderboard_all_time.json`
- `leaderboard_weekly_latest.json`
- `farcaster_map.json`

### Step 4: Test Everything (2 minutes)

```bash
npm test
```

You should see:
```
✅ Twitter API
✅ Anthropic API  
✅ Neynar API
✅ Data Files
✅ User Lookup
✅ Query Parsing

🎉 All tests passed!
```

### Step 5: Run Your Bot! 🚀

```bash
npm start
```

Output:
```
🤖 BaseApp Intelligent Twitter Bot Starting...

✅ Data loaded successfully
   - Total users: 17084
   - All-time rewards: $454557
   - Latest week: $12381

✅ Authenticated as @your_bot_name

👂 Listening for mentions...
```

**Test it!** Tweet: `@your_bot show stats for femiii.base.eth`

---

## How It Works

### Architecture

```
┌─────────────────────┐
│  User tweets        │
│  @bot show stats    │
│  for femiii         │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Bot receives       │
│  mention            │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Claude AI          │
│  Parses query       │
│  → user_stats       │
│  → identifier:      │
│     femiii          │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Bot searches       │
│  local data         │
│  - farcaster_map    │
│  - leaderboards     │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Formats response   │
│  with actual data   │
│  - $1185 all-time   │
│  - Rank #1          │
│  - etc.             │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Bot replies to     │
│  user on Twitter    │
└─────────────────────┘
```

### Data Flow

1. **Bot starts** → Loads all JSON data into memory
2. **Mention received** → Extracts user query
3. **Query parsing** → Claude AI determines intent and extracts identifiers
4. **Data lookup** → Searches Farcaster map by username/address
5. **Stats gathering** → Finds user in leaderboards
6. **Response formatting** → Creates human-readable message
7. **Reply** → Posts to Twitter (with thread support for long responses)

### Smart Query Understanding

The bot uses Claude AI to understand various query formats:

**User Stats Queries:**
- "show stats for femiii.base.eth" → Looks up femiii
- "how much did akbaronchain earn?" → Extracts akbaronchain
- "what's @alice's rank?" → Searches for alice
- "my earnings" → Uses Twitter username to find Farcaster identity

**Leaderboard Queries:**
- "top 10" / "leaderboard" / "who's winning" → Shows current week top 10
- "all-time top 10" → Shows all-time leaderboard

**Overview Queries:**
- "total rewards" / "how much distributed" → Overview stats
- "this week summary" → Current week breakdown

---

## Example Interactions

### User Stats

```
User: @baseapp_bot show stats for femiii.base.eth

Bot: 📊 Stats for femi (@femiii.base.eth)

💰 All-Time Earnings: $1185
🏆 All-Time Rank: #1
📅 Weeks Earned: 28

📈 This Week: $5
📉 Previous Week: $5
🎯 Weekly Rank: #234

👥 Followers: 11,289
🤝 Following: 327

🎉 You're doing great on BaseApp! Keep it up! 🚀
```

### Top 10 This Week

```
User: @baseapp_bot top 10

Bot: 🏆 Top 10 This Week:

1. @user1: $100
2. @user2: $100
3. @user3: $100
4. @user4: $100
5. @user5: $100
6. @user6: $50
7. @user7: $50
8. @user8: $50
9. @user9: $50
10. @user10: $50
```

### Overview

```
User: @baseapp_bot how much total rewards?

Bot: 📊 BaseApp Rewards Overview:

💎 All-Time:
  • Total Distributed: $454557
  • Unique Users: 17,084

📈 This Week:
  • Rewards: $12381
  • Eligible Users: 1939

💰 Reward Breakdown:
  • $100: 5 users
  • $50: 17 users
  • $25: 47 users
  • $10: 102 users
  • $5: 1766 users
```

---

## Deployment

### Option 1: Railway (Recommended)

Railway is the easiest option:

1. Push code to GitHub
2. Go to https://railway.app
3. Create new project → Deploy from GitHub
4. Add environment variables in Railway dashboard
5. Add a cron job to update data:
   ```
   Schedule: 0 */6 * * * (every 6 hours)
   Command: npm run update-data
   ```

**Cost**: ~$5-10/month

### Option 2: DigitalOcean Droplet

For more control:

```bash
# SSH into droplet
ssh root@your-ip

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git

# Clone repo
git clone <your-repo>
cd baseapp-intelligent-bot

# Install and configure
npm install
nano .env  # Add your keys

# Download data
npm run update-data

# Install PM2
npm install -g pm2

# Start bot
pm2 start bot.js --name baseapp-bot

# Auto-restart on reboot
pm2 startup
pm2 save

# Set up cron for data updates
crontab -e
# Add: 0 */6 * * * cd /path/to/bot && npm run update-data
```

**Cost**: ~$6/month

### Option 3: Heroku

```bash
heroku create baseapp-bot
heroku config:set TWITTER_API_KEY=xxx
# ... set all env vars
git push heroku main

# Add scheduler for data updates
heroku addons:create scheduler:standard
# Configure to run "npm run update-data" every 6 hours
```

---

## Data Management

### Keeping Data Fresh

Your bot loads data from JSON files. Keep them updated:

#### Option A: Auto-sync from Vercel (Recommended)

The bot includes a fetch script:

```bash
# Manual update
npm run update-data

# Or set up cron (Linux/Mac)
crontab -e
# Add: 0 */6 * * * cd /path/to/bot && npm run update-data
```

#### Option B: Direct file sync

If your miniapp generates new data:

```bash
# Use rsync or scp to sync files
rsync -avz /path/to/miniapp/data/*.json /path/to/bot/data/

# Or use GitHub Actions to auto-sync
```

#### Option C: Bot auto-reload

The bot automatically reloads data every 5 minutes by default. You can adjust in `bot.js`:

```javascript
// Reload data every 10 minutes instead
setInterval(async () => {
  await loadData();
}, 600000); // 10 minutes
```

---

## Customization

### Change Bot Personality

Edit the system prompts in `bot.js`:

```javascript
// Line ~300 - General responses
system: `You are the BaseApp rewards bot. 
You're friendly, encouraging, and data-driven.
Always celebrate user achievements!
Use emojis appropriately: 🚀 🎉 💰 🏆
Keep responses under 280 characters.`
```

### Add New Query Types

In `bot.js`, add to the `generateResponse()` function:

```javascript
case 'my_weekly_trend':
  // Show user's earnings trend over past 4 weeks
  dataResponse = getWeeklyTrend(query.identifier);
  break;

case 'compare_users':
  // Compare two users
  dataResponse = compareUsers(query.user1, query.user2);
  break;
```

### Add Commands

```javascript
// In generateResponse() before AI parsing
if (message.toLowerCase() === '/help') {
  return `I can help you with:
• User stats: "stats for [username]"
• Top 10: "top 10 this week"  
• Overview: "total rewards"
Ask me anything about BaseApp rewards! 💡`;
}
```

### Integrate with Your Miniapp API

If you add an API to your miniapp:

```javascript
async function fetchLiveUserStats(address) {
  const response = await fetch(
    `https://baseapp-reward-dashboard.vercel.app/api/user/${address}`
  );
  return response.json();
}
```

---

## Advanced Features

### Add Real-time Neynar Social Stats

Enhance responses with live Farcaster activity:

```javascript
async function getDetailedUserStats(identifier) {
  const user = findUser(identifier);
  const stats = getUserStats(user.address);
  
  // Fetch live social data
  if (user.farcaster.fid) {
    const socialData = await getFarcasterStats(user.farcaster.fid);
    
    // Add recent cast count, engagement, etc.
    response += `\n\n📝 Recent Activity:\n`;
    response += `  • Casts this week: ${socialData.recent_casts}\n`;
    response += `  • Engagement: ${socialData.engagement_score}\n`;
  }
  
  return response;
}
```

### Add Conversation Memory

Track user conversations:

```javascript
const conversations = new Map();

async function generateResponse(message, twitterUsername) {
  const history = conversations.get(twitterUsername) || [];
  
  // Include conversation context
  const contextPrompt = history.length > 0
    ? `Previous conversation:\n${history.slice(-3).join('\n')}\n\nNew query: ${message}`
    : message;
  
  const response = await parseQuery(contextPrompt);
  
  // Save to history
  history.push(`User: ${message}`);
  history.push(`Bot: ${response}`);
  conversations.set(twitterUsername, history.slice(-10)); // Keep last 10
  
  return response;
}
```

### Add Analytics

Track bot usage:

```javascript
const analytics = {
  queries: 0,
  userStatsQueries: 0,
  leaderboardQueries: 0,
  uniqueUsers: new Set(),
};

async function processMentions(botUserId) {
  // ... existing code
  
  analytics.queries++;
  analytics.uniqueUsers.add(username);
  
  if (query.type === 'user_stats') {
    analytics.userStatsQueries++;
  }
  
  // Log daily
  if (new Date().getHours() === 0) {
    console.log('📊 Daily stats:', analytics);
  }
}
```

---

## Troubleshooting

### "User not found"

**Problem**: Bot can't find user by username

**Solutions**:
1. Check if user is in `farcaster_map.json`
2. Try using wallet address instead
3. Run `npm run update-data` to refresh mappings
4. Verify username spelling (with/without .base.eth)

### "Data files missing"

**Problem**: Bot can't load JSON files

**Solutions**:
1. Run `npm run update-data`
2. Check `DATA_DIR` path in `.env`
3. Manually copy files from your miniapp
4. Verify file permissions

### Responses are slow

**Problem**: Bot takes too long to reply

**Solutions**:
1. Reduce polling frequency (increase interval)
2. Optimize data loading (use indexes)
3. Cache frequently requested data
4. Upgrade hosting (more RAM/CPU)

### Rate limit errors

**Problem**: Twitter API rate limit exceeded

**Solutions**:
1. Increase delay between responses (line 393)
2. Reduce polling frequency
3. Upgrade Twitter API tier
4. Implement queue system

---

## Cost Breakdown

### Minimal Usage (50 queries/day)

- **Twitter API**: Free (Essential tier)
- **Anthropic API**: ~$1/month
- **Neynar API**: Free (tier allows 100 requests/day)
- **Hosting**: $5/month (Railway)
- **Total**: ~$6/month

### Moderate Usage (500 queries/day)

- **Twitter API**: $100/month (Basic tier)
- **Anthropic API**: ~$10/month
- **Neynar API**: Free or $10/month
- **Hosting**: $10/month
- **Total**: ~$120-130/month

### High Usage (2000+ queries/day)

- **Twitter API**: Consider Pro tier
- **Anthropic API**: ~$50/month
- **Neynar API**: $50/month (enterprise)
- **Hosting**: $20/month
- **Total**: ~$120+/month (or much more with Pro Twitter API)

---

## Best Practices

### 1. Keep Data Fresh

- Update data files at least every 6 hours
- Consider real-time sync if your miniapp has an API
- Log data age and warn if stale

### 2. Monitor Performance

- Track response times
- Log errors and warnings
- Set up alerts for failures
- Monitor API usage

### 3. Be Respectful

- Don't spam users
- Respect rate limits
- Only reply when mentioned
- Follow Twitter automation rules

### 4. Improve Continuously

- Collect feedback from users
- Add features users request
- Improve response quality
- Fix bugs promptly

### 5. Security

- Never commit `.env` to git
- Rotate API keys periodically
- Use environment variables everywhere
- Limit bot permissions to minimum needed

---

## Support

Need help?

1. Check this README first
2. Run `npm test` to diagnose issues
3. Check logs for error messages
4. Open a GitHub issue
5. Ask on Twitter dev forums

---

## License

MIT - Use it however you want!

---

## What's Next?

### Phase 1: Launch ✅
- Set up bot
- Test with friends
- Deploy to production
- Announce on Twitter

### Phase 2: Enhance (Week 2-4)
- Add more query types
- Improve response quality
- Add conversation memory
- Integrate with miniapp API

### Phase 3: Scale (Month 2+)
- Add analytics dashboard
- Create bot website
- Implement advanced features
- Build community

---

**You now have an INTELLIGENT bot that actually understands your BaseApp data!** 🎉

Good luck! 🚀
