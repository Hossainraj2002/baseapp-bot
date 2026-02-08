# 📱 DEPLOY FROM PHONE - COMPLETE GUIDE

## 🎯 What We're Doing

Getting your bot live in 30 minutes, all from your phone!

**You need:**
- 📱 Your phone
- 🌐 Internet connection
- 💳 Credit card (for Railway - $5/month)

**You DON'T need:**
- ❌ A computer
- ❌ VS Code
- ❌ Terminal/Command line
- ❌ Coding knowledge

---

## PLAN OVERVIEW

```
Step 1: Get API Keys (15 min)
   ↓
Step 2: Create GitHub Account (2 min)
   ↓
Step 3: Get Bot Files to GitHub (5 min)
   ↓
Step 4: Deploy to Railway (5 min)
   ↓
Step 5: Configure Bot (3 min)
   ↓
DONE! Bot is LIVE! 🎉
```

---

## 📋 STEP 1: GET API KEYS (15 minutes)

### A. Twitter API Keys

**On your phone browser:**

1. Go to: https://developer.twitter.com/en/portal/petition/essential/basic-info

2. Fill out form:
   - Your name
   - Your email
   - Use case: "Making a bot"
   - Click Submit

3. Wait for approval email (usually instant)

4. Go to: https://developer.twitter.com/en/portal/dashboard

5. Click "Create Project"
   - Name: "BaseApp Bot"
   - Click Next

6. Click "Create App"
   - App name: "baseapp-bot"
   - Click Complete

7. Go to your app → "Settings" tab

8. Scroll down to "User authentication settings"
   - Click "Set up"
   - App permissions: **"Read and Write"** ← IMPORTANT!
   - Type: "Web App"
   - Callback URL: `https://example.com`
   - Website: `https://baseapp-reward-dashboard.vercel.app`
   - Click Save

9. Go to "Keys and tokens" tab

10. Click "Generate" next to "Access Token and Secret"

11. **SAVE THESE IN YOUR NOTES APP:**
    ```
    TWITTER_API_KEY=copy_this_key
    TWITTER_API_SECRET=copy_this_secret
    TWITTER_ACCESS_TOKEN=copy_this_token
    TWITTER_ACCESS_TOKEN_SECRET=copy_this_secret
    ```

✅ Done with Twitter!

---

### B. Anthropic API Key

**On your phone browser:**

1. Go to: https://console.anthropic.com

2. Sign up with email

3. Verify email

4. Click "API Keys" (left menu)

5. Click "Create Key"
   - Name: "BaseApp Bot"
   - Click Create

6. **Copy the key (starts with `sk-ant-`)**

7. **Add to your notes:**
    ```
    ANTHROPIC_API_KEY=sk-ant-your_key_here
    ```

8. Click "Billing" (left menu)

9. Add payment method

10. Add at least $5 credit

✅ Done with Anthropic!

---

### C. Neynar API Key (Optional but recommended)

**On your phone browser:**

1. Go to: https://neynar.com

2. Sign up (free)

3. Go to Dashboard

4. Copy your API key

5. **Add to your notes:**
    ```
    NEYNAR_API_KEY=your_key_here
    ```

✅ Done with Neynar!

---

## 📋 STEP 2: CREATE GITHUB ACCOUNT (2 minutes)

**If you don't have GitHub:**

1. Go to: https://github.com/signup

2. Enter email

3. Create password

4. Choose username

5. Verify email

✅ Done!

---

## 📋 STEP 3: GET BOT FILES TO GITHUB (5 minutes)

### Method 1: Use My Pre-Made Template

**I'll create a template repository for you!**

After I create it, I'll give you a link like:
`https://github.com/YOUR_USERNAME/baseapp-bot`

You just need to:
1. Click "Use this template"
2. Create your own copy
3. Done!

### Method 2: Manual Upload (If needed)

1. Download the ZIP file I give you

2. Go to: https://github.com/new

3. Create repository:
   - Name: `baseapp-bot`
   - Private
   - Click "Create repository"

4. On the repository page:
   - Click "uploading an existing file"
   - Unzip the bot files
   - Drag and drop files one by one
   - Or upload the whole folder

5. Click "Commit changes"

✅ Bot files are on GitHub!

---

## 📋 STEP 4: DEPLOY TO RAILWAY (5 minutes)

**On your phone browser:**

1. Go to: https://railway.app

2. Click "Start a New Project"

3. Click "Login with GitHub"

4. Authorize Railway

5. Click "New Project"

6. Click "Deploy from GitHub repo"

7. Select your `baseapp-bot` repository

8. Railway will start building!

9. Wait for build to complete (2-3 minutes)

✅ Bot is deploying!

---

## 📋 STEP 5: CONFIGURE BOT (3 minutes)

**In Railway dashboard (on your phone):**

1. Click on your bot service

2. Click "Variables" tab

3. Click "New Variable"

4. Add ALL these variables (copy from your notes):

**Add one by one:**

```
Name: TWITTER_API_KEY
Value: [paste your key]
[Click Add]

Name: TWITTER_API_SECRET  
Value: [paste your secret]
[Click Add]

Name: TWITTER_ACCESS_TOKEN
Value: [paste your token]
[Click Add]

Name: TWITTER_ACCESS_TOKEN_SECRET
Value: [paste your secret]
[Click Add]

Name: ANTHROPIC_API_KEY
Value: sk-ant-[paste your key]
[Click Add]

Name: NEYNAR_API_KEY
Value: [paste your key]
[Click Add]

Name: MINIAPP_URL
Value: https://baseapp-reward-dashboard.vercel.app
[Click Add]

Name: DATA_DIR
Value: ./data
[Click Add]
```

5. Railway will auto-restart your bot

6. Click "Deployments" tab

7. Click on the latest deployment

8. Click "View Logs"

✅ Check if bot is running!

---

## 📋 STEP 6: VERIFY BOT IS WORKING

**Check the logs in Railway:**

You should see:
```
🤖 BaseApp Intelligent Twitter Bot Starting...

🔄 Loading data from Vercel...
📥 Fetching data/overview.json from Vercel...
✅ Saved overview.json
📥 Fetching data/leaderboard_all_time.json from Vercel...
✅ Saved leaderboard_all_time.json
...

✅ Data loaded successfully
   - Total users: 17,084
   - All-time rewards: $454,557

✅ Authenticated as @your_bot_name

👂 Listening for mentions...
```

**If you see this, bot is LIVE!** 🎉

---

## 📋 STEP 7: TEST YOUR BOT

1. Open Twitter app on your phone

2. Tweet: `@your_bot_name show stats for femiii.base.eth`

3. Wait 60 seconds

4. Your bot should reply!

✅ **IT WORKS!** 🎉

---

## 💰 COST

- Railway: $5/month
- Anthropic API: ~$1-2/month
- **Total: ~$6-7/month**

Railway gives $5 free credit to start!

---

## 🔧 TROUBLESHOOTING

### "Build failed"

**Check:**
1. Are all files uploaded to GitHub?
2. Is `package.json` present?

**Fix:**
- Re-upload files
- Click "Redeploy" in Railway

---

### "Bot not responding"

**Check:**
1. Is bot running? (Check logs)
2. Are Twitter API permissions "Read and Write"?
3. Are all environment variables set?

**Fix:**
1. Go to Railway → Variables → Verify all are set
2. Go to Twitter Dev Portal → Settings → Change to "Read and Write"
3. Regenerate Access Token
4. Update in Railway
5. Redeploy

---

### "Can't see logs"

**Check:**
1. Go to Railway dashboard
2. Click your bot service
3. Click "Deployments"
4. Click latest deployment
5. Click "View Logs"

---

### "Error loading data"

**Check:**
1. Is `MINIAPP_URL` correct?
2. Is your Vercel deployment live?

**Fix:**
1. Check Vercel: https://baseapp-reward-dashboard.vercel.app/data/overview.json
2. Should show JSON data
3. Update `MINIAPP_URL` in Railway if wrong

---

## 📝 MANAGING YOUR BOT

### View Logs (Phone)

1. Open Railway app: https://railway.app
2. Click your project
3. Click bot service
4. Click "Deployments"
5. Click "View Logs"

### Restart Bot

1. Railway dashboard
2. Click bot service
3. Click "..." (three dots)
4. Click "Restart"

### Update Bot Code

1. Edit files on GitHub (use GitHub mobile app)
2. Commit changes
3. Railway auto-deploys!

### Stop Bot

1. Railway dashboard
2. Click bot service  
3. Click "..." (three dots)
4. Click "Delete Service"

---

## 📊 MONITORING

### Check if Bot is Live

1. Railway → Logs
2. Should see "Listening for mentions..."

### Check Data Freshness

In logs, look for:
```
Last updated: 2026-02-07T18:30:00.000Z
```

### Check Bot Responding

1. Tweet at your bot
2. Check if it replies within 60 seconds

---

## 🔄 WEEKLY WORKFLOW

### Your Miniapp Update (As usual):

```
1. Update your miniapp data
2. Push to GitHub
3. Vercel deploys
```

### Bot (Automatic):

```
Within 6 hours:
→ Bot auto-fetches new data
→ Updates cache
→ Keeps responding
```

**No manual work!** 🎉

---

## 🆘 NEED HELP?

### Common Issues:

**"Can't download files on phone"**
→ Use GitHub upload method above

**"Don't have PC"**
→ Everything can be done on phone!

**"Don't know how to code"**
→ No coding needed! Just follow steps

**"Railway asking for payment"**
→ Add card, they give $5 free credit first

**"Bot stopped working"**
→ Check Railway logs for errors
→ Restart bot in Railway dashboard

---

## ✅ CHECKLIST

Before going live, verify:

- [ ] Twitter API keys saved
- [ ] Anthropic API key saved
- [ ] Neynar API key saved (optional)
- [ ] GitHub account created
- [ ] Bot files on GitHub
- [ ] Railway account created
- [ ] Bot deployed to Railway
- [ ] All environment variables added
- [ ] Bot logs show "Listening for mentions"
- [ ] Test tweet sent
- [ ] Bot replied to test tweet

**All checked? YOU'RE LIVE!** 🎉

---

## 🎯 SUMMARY

**What you did:**
1. ✅ Got API keys (15 min)
2. ✅ Created GitHub account (2 min)
3. ✅ Uploaded bot to GitHub (5 min)
4. ✅ Deployed to Railway (5 min)
5. ✅ Configured variables (3 min)
6. ✅ Verified bot is working (2 min)

**Total time: ~30 minutes**

**Result:**
- ✅ Bot running 24/7
- ✅ Auto-syncs data from Vercel
- ✅ Responds to Twitter mentions
- ✅ Shows real user stats
- ✅ Zero maintenance needed

**Cost: $6-7/month**

---

## 🚀 YOU DID IT!

Your bot is now:
- ✅ Live on Railway
- ✅ Responding to mentions
- ✅ Auto-syncing from Vercel
- ✅ Running 24/7

**Congratulations!** 🎉

---

## 📱 NEXT STEPS

1. **Announce your bot:**
   - Tweet about it
   - Tell your community
   - Share in Discord

2. **Monitor for a day:**
   - Check Railway logs
   - See if bot responds
   - Verify data is current

3. **Enjoy!**
   - Bot runs automatically
   - Updates data itself
   - Responds to users

**You're done!** 🎉

---

## 💡 TIPS

- Check logs daily for first week
- Monitor API usage in dashboards
- Keep API keys secret (never share)
- Set up billing alerts in Railway
- Restart bot if it seems slow

---

**Questions? Check the logs first!**

Everything you need is in Railway → Deployments → View Logs

**Happy botting!** 🤖✨
