# Data Sync Guide 🔄

How to keep your bot's data in sync with your miniapp.

## Your Situation

- ✅ You run indexing scripts weekly in your miniapp
- ✅ New data files are generated (JSON files)
- ✅ Files are committed to GitHub and deployed to Vercel
- ❓ How does the bot get the updated data?

---

## **RECOMMENDED SOLUTION**

### Auto-Fetch from Vercel + Manual Trigger

**Why this is best for you:**
1. Your data is already live on Vercel
2. Bot can fetch it anytime
3. Set up automatic sync every 6 hours
4. Manually trigger after your weekly update (fastest)

---

## Setup Instructions

### Step 1: Configure Bot

Your bot already has the sync script built-in!

Check `.env`:
```env
MINIAPP_URL=https://baseapp-reward-dashboard.vercel.app
```

This tells the bot where to fetch data from.

### Step 2: Test Data Sync

```bash
cd baseapp-intelligent-bot
npm run update-data
```

You should see:
```
🔄 Starting data sync from miniapp...
📍 Source: https://baseapp-reward-dashboard.vercel.app

📥 Fetching data/overview.json...
✅ Saved overview.json
   • All-time: $454557 (17084 users)
   • This week: $12381 (1939 users)

📥 Fetching data/leaderboard_all_time.json...
✅ Saved leaderboard_all_time.json
   • 17084 users in leaderboard

📥 Fetching data/leaderboard_weekly_latest.json...
✅ Saved leaderboard_weekly_latest.json
   • 1939 users in leaderboard

📥 Fetching data/farcaster_map.json...
✅ Saved farcaster_map.json
   • 15234 users mapped

──────────────────────────────────────────────────
📊 Sync Summary:
   ✅ Success: 4/4
   ❌ Failed: 0/4

✨ Data sync complete! Bot will use updated data on next reload.
```

### Step 3: Set Up Automatic Sync (Every 6 Hours)

#### If using Railway:

1. Go to your bot's Railway dashboard
2. Click on your service
3. Go to "Settings" tab
4. Add a Cron Job:
   - **Command:** `npm run update-data`
   - **Schedule:** `0 */6 * * *` (every 6 hours)

#### If using DigitalOcean/VPS:

```bash
# SSH into your server
ssh root@your-bot-server

# Edit crontab
crontab -e

# Add this line (runs every 6 hours):
0 */6 * * * cd /root/baseapp-intelligent-bot && npm run update-data >> /var/log/bot-sync.log 2>&1

# Save and exit (Ctrl+X, then Y, then Enter)

# Verify it's added
crontab -l
```

**Check logs:**
```bash
tail -f /var/log/bot-sync.log
```

### Step 4: Manual Trigger After Weekly Update

After you run your indexing:

#### Option A: Quick Script (Recommended)

```bash
# Make the script executable
chmod +x scripts/update-bot.sh

# Edit the script with your server details
nano scripts/update-bot.sh

# Change these lines:
# BOT_SERVER="root@your-bot-server-ip"
# BOT_PATH="/root/baseapp-intelligent-bot"

# Then after your weekly update, just run:
./scripts/update-bot.sh
```

#### Option B: Manual SSH

```bash
# SSH into bot server
ssh root@your-bot-server

# Update data
cd /root/baseapp-intelligent-bot
npm run update-data

# Restart bot (if using PM2)
pm2 restart baseapp-bot

# Exit
exit
```

#### Option C: One-liner

```bash
ssh root@your-bot-server 'cd /root/baseapp-intelligent-bot && npm run update-data && pm2 restart baseapp-bot'
```

---

## Your Weekly Workflow

### Current Workflow:
```bash
# 1. In your miniapp repo
cd baseapp-reward-dashboard
npm run farcaster:map
npm run users:index

# 2. Commit and push
git add data/*.json
git commit -m "Weekly data update"
git push

# 3. Vercel auto-deploys ✅
```

### Add This Step:
```bash
# 4. Update bot (choose one):

# Option A: Wait for auto-sync (within 6 hours)
# Nothing to do! 😊

# Option B: Trigger immediately (recommended)
./scripts/update-bot.sh

# Option C: SSH manually
ssh root@your-bot-server 'cd /root/baseapp-intelligent-bot && npm run update-data && pm2 restart baseapp-bot'
```

**That's it!** Your bot now has the latest data. 🎉

---

## How the Bot Handles Data

### On Startup:
```javascript
// Bot loads data from JSON files
await loadData();
// Now bot has all data in memory
```

### Every 5 Minutes (Automatic):
```javascript
// Bot reloads data to catch any updates
setInterval(async () => {
  await loadData();
}, 300000); // 5 minutes
```

So even if you don't restart the bot, it will pick up new data within 5 minutes!

---

## Advanced: GitHub Actions Auto-Sync

If you want the bot to automatically sync when you push data to your miniapp repo:

### In your MINIAPP repo (baseapp-reward-dashboard):

Create `.github/workflows/notify-bot.yml`:

```yaml
name: Notify Bot of Data Update

on:
  push:
    branches: [ main ]
    paths:
      - 'data/**'

jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger bot data sync
        env:
          BOT_SERVER: ${{ secrets.BOT_SERVER }}
          BOT_SSH_KEY: ${{ secrets.BOT_SSH_KEY }}
        run: |
          # Set up SSH
          mkdir -p ~/.ssh
          echo "$BOT_SSH_KEY" > ~/.ssh/id_rsa
          chmod 600 ~/.ssh/id_rsa
          ssh-keyscan -H $BOT_SERVER >> ~/.ssh/known_hosts
          
          # Trigger update on bot server
          ssh root@$BOT_SERVER 'cd /root/baseapp-intelligent-bot && npm run update-data && pm2 restart baseapp-bot'
```

### Add secrets in GitHub:

1. Go to your miniapp repo → Settings → Secrets
2. Add:
   - `BOT_SERVER` = `your-bot-server-ip`
   - `BOT_SSH_KEY` = Your private SSH key

Now every time you push data updates, the bot automatically syncs! 🤖

---

## Monitoring Data Freshness

### Check when data was last synced:

```bash
# On bot server
cat /root/baseapp-intelligent-bot/data/last_sync.json
```

Output:
```json
{
  "timestamp": "2026-02-07T18:30:00.000Z",
  "source": "https://baseapp-reward-dashboard.vercel.app",
  "success": 4,
  "failed": 0
}
```

### Add to bot dashboard:

```javascript
// Add to bot.js health check endpoint
app.get('/health', (req, res) => {
  const lastSync = JSON.parse(
    fs.readFileSync('./data/last_sync.json', 'utf-8')
  );
  
  const dataAge = (Date.now() - new Date(lastSync.timestamp)) / 1000 / 60; // minutes
  
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    dataAge: `${Math.floor(dataAge)} minutes ago`,
    lastSync: lastSync.timestamp,
  });
});
```

---

## Troubleshooting

### Problem: Bot shows old data

**Solution:**
```bash
# Check when data was last synced
cat data/last_sync.json

# Manually trigger sync
npm run update-data

# Restart bot
pm2 restart baseapp-bot
```

### Problem: Sync fails

**Solution:**
```bash
# Check if Vercel deployment is working
curl https://baseapp-reward-dashboard.vercel.app/data/overview.json

# Check bot can reach Vercel
ssh root@your-bot-server
curl https://baseapp-reward-dashboard.vercel.app/data/overview.json

# If curl works but sync fails, check logs
npm run update-data
```

### Problem: Cron job not running

**Solution:**
```bash
# Check cron is running
sudo systemctl status cron

# Check cron logs
grep CRON /var/log/syslog | tail -20

# Test cron manually
cd /root/baseapp-intelligent-bot && npm run update-data
```

---

## Data Backup

The sync script automatically backs up your data before updating!

**Backups are stored in:** `data/backups/`

**Last 5 syncs are kept**, older ones are auto-deleted.

### Restore from backup:

```bash
# List backups
ls -la data/backups/

# Restore from a backup
cp data/backups/2026-02-07T18-30-00-000Z/*.json data/

# Restart bot
pm2 restart baseapp-bot
```

---

## Summary

### ✅ Automatic Sync (Every 6 Hours)
- Set up with cron job
- Bot always has reasonably fresh data
- No manual work needed

### ✅ Manual Trigger (Immediate)
- Run after your weekly update
- Use `scripts/update-bot.sh`
- Bot gets data instantly

### ✅ Auto-Reload (Every 5 Minutes)
- Bot automatically reloads data
- No restart needed
- Picks up changes within 5 minutes

### ✅ Backup System
- Data is backed up before each sync
- Last 5 backups kept
- Easy to restore if needed

**Your bot will always have fresh data!** 🎉

---

## Quick Reference

```bash
# Test sync locally
npm run update-data

# Trigger remote sync
./scripts/update-bot.sh

# Check data age
cat data/last_sync.json

# View sync logs (if using cron)
tail -f /var/log/bot-sync.log

# Restart bot
pm2 restart baseapp-bot

# View bot logs
pm2 logs baseapp-bot
```

---

**Questions?** Check the main README.md or ask me!
