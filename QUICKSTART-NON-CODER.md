# QUICK START (For Non-Coders) 🚀

**Don't worry!** This guide assumes you know nothing about coding. Just follow these steps exactly.

---

## What You're Building

A Twitter bot that:
- Responds when people tag it
- Shows real stats from your BaseApp miniapp
- Updates automatically from your Vercel deployment
- Runs 24/7 in the cloud

---

## What You Need (15 minutes to get)

### 1. Twitter API Keys (5 minutes)

**Step 1:** Go to https://developer.twitter.com/en/portal/petition/essential/basic-info

**Step 2:** Fill out the form:
- Name: Your name
- Email: Your email
- Use case: Select "Making a bot"
- Will you make Twitter content available to a government entity?: No

**Step 3:** Wait for email approval (usually instant)

**Step 4:** Once approved, go to https://developer.twitter.com/en/portal/dashboard

**Step 5:** Click "Create Project" → "Create App"
- App name: "BaseApp Bot" (or anything)

**Step 6:** Go to your app → "Settings" tab → "User authentication settings"
- Click "Set up"
- App permissions: Select "Read and Write"
- Type of App: "Web App"
- Callback URL: https://example.com (doesn't matter)
- Website URL: https://baseapp-reward-dashboard.vercel.app
- Save

**Step 7:** Go to "Keys and tokens" tab
- Click "Generate" next to "Access Token and Secret"
- **SAVE THESE SOMEWHERE SAFE:**
  - API Key
  - API Secret
  - Access Token
  - Access Token Secret

✅ Done with Twitter!

---

### 2. Anthropic API Key (3 minutes)

**Step 1:** Go to https://console.anthropic.com

**Step 2:** Sign up with email

**Step 3:** Click "API Keys" on left sidebar

**Step 4:** Click "Create Key"

**Step 5:** Give it a name: "BaseApp Bot"

**Step 6:** Copy the key (starts with `sk-ant-`)

**Step 7:** Go to "Billing" and add payment method
- You need at least $5 credit
- It costs about $1-2/month for typical usage

✅ Done with Anthropic!

---

### 3. Neynar API Key (2 minutes - OPTIONAL)

**Step 1:** Go to https://neynar.com

**Step 2:** Sign up (free)

**Step 3:** Go to dashboard → API Keys

**Step 4:** Copy your API key

✅ Done! (This is optional but makes responses better)

---

## Setup Your Bot (10 minutes)

### Step 1: Download the Bot Files

You already have them! They're in the folder called `baseapp-intelligent-bot`

### Step 2: Install Node.js (if you don't have it)

**Windows:**
1. Go to https://nodejs.org
2. Download "LTS" version
3. Run installer
4. Click Next, Next, Next, Install

**Mac:**
1. Go to https://nodejs.org
2. Download "LTS" version
3. Open the .pkg file
4. Follow installer

**To check if it worked:**
- Open Terminal (Mac) or Command Prompt (Windows)
- Type: `node --version`
- Should show: v20.x.x or similar

### Step 3: Configure Your Bot

1. Open the `baseapp-intelligent-bot` folder

2. Find the file called `.env.example`

3. **Make a copy** of it and name it `.env` (just `.env`, no `.example`)

4. Open `.env` with a text editor (Notepad on Windows, TextEdit on Mac)

5. Fill in your API keys:

```
TWITTER_API_KEY=paste_your_twitter_api_key_here
TWITTER_API_SECRET=paste_your_twitter_api_secret_here
TWITTER_ACCESS_TOKEN=paste_your_twitter_access_token_here
TWITTER_ACCESS_TOKEN_SECRET=paste_your_twitter_access_token_secret_here

ANTHROPIC_API_KEY=sk-ant-paste_your_key_here

NEYNAR_API_KEY=paste_if_you_have_it

MINIAPP_URL=https://baseapp-reward-dashboard.vercel.app

DATA_DIR=./data
```

6. **Save the file**

### Step 4: Install Dependencies

1. Open Terminal (Mac) or Command Prompt (Windows)

2. Navigate to your bot folder:
```bash
cd path/to/baseapp-intelligent-bot
```

**Tip:** You can drag the folder into Terminal/Command Prompt to get the path!

3. Install packages:
```bash
npm install
```

This will take 1-2 minutes. You'll see lots of text scrolling - that's normal!

### Step 5: Test Your Bot

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

**If you see red X's:**
- Check your API keys are correct
- Make sure you saved the `.env` file
- Run `npm test` again

### Step 6: Run Your Bot!

```bash
npm start
```

You should see:
```
🤖 BaseApp Intelligent Twitter Bot Starting...

🔄 Loading data from Vercel...
📥 Fetching data/overview.json from Vercel...
📥 Fetching data/leaderboard_all_time.json from Vercel...
📥 Fetching data/leaderboard_weekly_latest.json from Vercel...
📥 Fetching data/farcaster_map.json from Vercel...

✅ Data loaded successfully
   - Total users: 17084
   - All-time rewards: $454557
   - Latest week: $12381

✅ Authenticated as @your_bot_name

👂 Listening for mentions...
```

**🎉 YOUR BOT IS RUNNING!**

### Step 7: Test It!

1. Go to Twitter
2. Tweet: `@your_bot_name show stats for femiii.base.eth`
3. Wait up to 60 seconds
4. Your bot should reply!

---

## Keep Your Bot Running 24/7

Right now, your bot only runs when your computer is on. Let's make it run 24/7 in the cloud!

### Option 1: Railway (Easiest - Recommended)

**Cost:** $5/month

1. Go to https://railway.app
2. Sign up with GitHub
3. Click "New Project"
4. Click "Deploy from GitHub repo"
5. Connect your GitHub account
6. Upload your bot folder to GitHub first:

**How to upload to GitHub:**

a. Go to https://github.com
b. Click "New repository"
c. Name: "baseapp-bot"
d. Click "Create repository"
e. Follow the instructions to upload your folder

**Or use GitHub Desktop (easier):**
- Download GitHub Desktop: https://desktop.github.com
- Sign in
- Click "Add" → "Add Existing Repository"
- Select your bot folder
- Click "Publish repository"

6. Back to Railway, select your repository
7. Click on your deployment
8. Go to "Variables" tab
9. Add ALL your environment variables from `.env`:
   - Click "New Variable"
   - Name: `TWITTER_API_KEY`, Value: your key
   - Repeat for ALL variables

10. Railway will auto-deploy!

11. Check logs to see if it's running

**✅ Done! Your bot runs 24/7!**

**To update data sync schedule:**
- Railway will auto-sync data every 6 hours
- No extra setup needed!

---

### Option 2: DigitalOcean (More Control)

**Cost:** $6/month

This requires more steps. See DEPLOYMENT.md for full guide.

---

## How Data Syncing Works (Automatic!)

**Your bot automatically:**
1. Fetches data from your Vercel deployment when it starts
2. Saves a local backup
3. Auto-refreshes data every 6 hours

**You don't need to do anything!** Just update your miniapp as usual:

```bash
# Your normal workflow:
npm run farcaster:map
npm run users:index
git push
```

Vercel deploys → Bot auto-syncs within 6 hours!

**Want to sync immediately?**
```bash
# On your bot server (Railway/DigitalOcean)
npm run update-data
```

---

## Troubleshooting

### "Cannot find module"
```bash
npm install
```

### "Permission denied"
```bash
# Mac/Linux:
chmod +x scripts/update-bot.sh
```

### "Port already in use"
- Another program is using the port
- Restart your computer
- Or change PORT in `.env`

### Bot doesn't respond
1. Check Twitter API permissions are "Read and Write"
2. Check bot is running: `pm2 list` (on server)
3. Check logs for errors

### Data is old
```bash
npm run update-data
```

---

## Important Files

- `.env` - Your secret API keys (NEVER share this!)
- `bot.js` - Main bot code (don't change unless you know what you're doing)
- `package.json` - Dependencies list
- `README.md` - Full documentation
- `DATA-SYNC-GUIDE.md` - How data syncing works

---

## Need Help?

1. Read README.md for more details
2. Check DEPLOYMENT.md for hosting options
3. Run `npm test` to diagnose issues
4. Check logs for error messages

---

## Your Bot Features

✅ **Auto-responds to mentions**
✅ **Shows real user stats**
✅ **Displays leaderboards**
✅ **Provides overview data**
✅ **Auto-syncs from Vercel every 6 hours**
✅ **Backs up data automatically**
✅ **Understands natural language**
✅ **Runs 24/7 (when deployed)**

---

## Summary

**Setup Steps:**
1. ✅ Get Twitter API keys
2. ✅ Get Anthropic API key
3. ✅ Get Neynar API key (optional)
4. ✅ Install Node.js
5. ✅ Configure `.env` file
6. ✅ Run `npm install`
7. ✅ Run `npm test`
8. ✅ Run `npm start`
9. ✅ Deploy to Railway/DigitalOcean

**Data syncing:**
- ✅ Automatic! Updates every 6 hours from Vercel
- ✅ No manual work needed
- ✅ Runs `npm run update-data` to sync immediately

**That's it! You're done!** 🎉

---

**Questions?** Check the other guide files or ask for help!
