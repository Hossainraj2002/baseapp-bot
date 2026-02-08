# Deployment Guide 🚀

Complete guide to deploy your BaseApp Intelligent Bot to production.

## Quick Deploy - Railway (Easiest)

### Prerequisites
- GitHub account
- Railway account (https://railway.app)
- All your API keys ready

### Steps

1. **Push to GitHub**

```bash
cd baseapp-intelligent-bot
git init
git add .
git commit -m "Initial commit: BaseApp intelligent bot"
git remote add origin https://github.com/YOUR_USERNAME/baseapp-bot.git
git push -u origin main
```

2. **Deploy on Railway**

- Go to https://railway.app
- Click "New Project"
- Select "Deploy from GitHub repo"
- Choose your repository
- Railway will auto-detect Node.js

3. **Add Environment Variables**

In Railway dashboard → Variables tab, add:

```
TWITTER_API_KEY=your_key
TWITTER_API_SECRET=your_secret
TWITTER_ACCESS_TOKEN=your_token
TWITTER_ACCESS_TOKEN_SECRET=your_token_secret
ANTHROPIC_API_KEY=sk-ant-xxxxx
NEYNAR_API_KEY=your_neynar_key
DATA_DIR=/app/data
MINIAPP_URL=https://baseapp-reward-dashboard.vercel.app
```

4. **Configure Data Updates**

Railway doesn't have built-in cron, so add a simple scheduler:

Create `scheduler.js`:

```javascript
import { downloadAllData } from './scripts/fetch-data.js';

// Update data every 6 hours
setInterval(async () => {
  console.log('🔄 Updating data...');
  await downloadAllData();
}, 6 * 60 * 60 * 1000);

// Initial download
downloadAllData();
```

Update `bot.js` to import scheduler before running.

5. **Deploy**

Railway automatically deploys! Check logs:
- Click on your service
- View "Deployments"
- Check logs for "Bot authenticated"

**Cost**: $5/month (Starter plan) + usage

---

## DigitalOcean Droplet (More Control)

### 1. Create Droplet

- Go to https://digitalocean.com
- Create Droplet
- Choose: Ubuntu 22.04, Basic Plan ($6/month)
- Select region closest to you

### 2. SSH and Setup

```bash
# SSH into droplet
ssh root@your_droplet_ip

# Update system
apt update && apt upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git

# Install PM2 globally
npm install -g pm2
```

### 3. Deploy Bot

```bash
# Clone your repository
git clone https://github.com/YOUR_USERNAME/baseapp-bot.git
cd baseapp-bot

# Install dependencies
npm install

# Create .env file
nano .env
# (paste your environment variables)

# Download initial data
npm run update-data

# Start bot with PM2
pm2 start bot.js --name baseapp-bot

# Configure PM2 to start on boot
pm2 startup
pm2 save

# Check status
pm2 status
pm2 logs baseapp-bot
```

### 4. Set Up Data Auto-Update

```bash
# Create update script
cat > /root/update-bot-data.sh << 'EOF'
#!/bin/bash
cd /root/baseapp-bot
npm run update-data
EOF

# Make executable
chmod +x /root/update-bot-data.sh

# Add to crontab (every 6 hours)
crontab -e
# Add this line:
0 */6 * * * /root/update-bot-data.sh >> /root/bot-updates.log 2>&1
```

### 5. Monitoring

```bash
# View logs
pm2 logs baseapp-bot

# Restart bot
pm2 restart baseapp-bot

# Monitor resources
pm2 monit

# Check cron logs
tail -f /root/bot-updates.log
```

**Cost**: $6/month

---

## Heroku (Alternative)

### 1. Setup

```bash
# Install Heroku CLI
curl https://cli-assets.heroku.com/install.sh | sh

# Login
heroku login

# Create app
heroku create baseapp-intelligent-bot

# Add Node.js buildpack
heroku buildpacks:add heroku/nodejs
```

### 2. Configure

```bash
# Set environment variables
heroku config:set TWITTER_API_KEY=your_key
heroku config:set TWITTER_API_SECRET=your_secret
heroku config:set TWITTER_ACCESS_TOKEN=your_token
heroku config:set TWITTER_ACCESS_TOKEN_SECRET=your_token_secret
heroku config:set ANTHROPIC_API_KEY=sk-ant-xxxxx
heroku config:set NEYNAR_API_KEY=your_neynar_key
heroku config:set DATA_DIR=/app/data
heroku config:set MINIAPP_URL=https://baseapp-reward-dashboard.vercel.app
```

### 3. Create Procfile

```bash
echo "worker: node bot.js" > Procfile
```

### 4. Deploy

```bash
git add .
git commit -m "Deploy to Heroku"
git push heroku main

# Scale worker
heroku ps:scale worker=1

# View logs
heroku logs --tail
```

### 5. Set Up Scheduler

```bash
# Add scheduler addon
heroku addons:create scheduler:standard

# Open scheduler dashboard
heroku addons:open scheduler

# Add job:
# Command: npm run update-data
# Frequency: Every 6 hours
```

**Cost**: $7/month (Eco dynos) + $5/month (scheduler)

---

## AWS EC2 (Enterprise)

### 1. Launch EC2 Instance

- Go to AWS Console → EC2
- Launch Instance
- Choose: Ubuntu 22.04
- Instance type: t3.micro ($8/month)
- Configure security group: Allow SSH (22), HTTPS (443)

### 2. Connect and Setup

```bash
# SSH
ssh -i your-key.pem ubuntu@ec2-ip-address

# Update and install
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt-get install -y nodejs git

# Install PM2
sudo npm install -g pm2
```

### 3. Deploy (same as DigitalOcean steps 3-5)

### 4. Set Up CloudWatch (Optional)

Monitor logs and metrics in AWS CloudWatch for better visibility.

**Cost**: ~$8-15/month depending on usage

---

## Docker Deployment

### 1. Create Dockerfile

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

# Download data on build
RUN npm run update-data || true

CMD ["node", "bot.js"]
```

### 2. Create docker-compose.yml

```yaml
version: '3.8'

services:
  bot:
    build: .
    restart: unless-stopped
    env_file: .env
    volumes:
      - ./data:/app/data
    environment:
      - NODE_ENV=production
```

### 3. Deploy

```bash
# Build and run
docker-compose up -d

# View logs
docker-compose logs -f

# Restart
docker-compose restart

# Stop
docker-compose down
```

### 4. Deploy to Any Cloud

You can deploy this Docker image to:
- AWS ECS/Fargate
- Google Cloud Run
- Azure Container Instances
- DigitalOcean App Platform

---

## Monitoring & Maintenance

### Health Checks

Add health check endpoint (add to bot.js):

```javascript
import express from 'express';

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    processedTweets: processedTweets.size,
    dataAge: (Date.now() - dataCache.lastUpdated?.getTime()) / 1000,
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, () => {
  console.log(`Health check server running on port ${PORT}`);
});
```

### Logging

Set up structured logging:

```javascript
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
    new winston.transports.Console({
      format: winston.format.simple(),
    }),
  ],
});

// Use instead of console.log
logger.info('Bot started');
logger.error('Error occurred', { error: err });
```

### Alerts

Set up alerts for:
- Bot crashes
- Data update failures
- API rate limits
- High error rates

Options:
- **Uptime Robot** - Free uptime monitoring
- **Sentry** - Error tracking
- **PagerDuty** - On-call alerts
- **Discord webhooks** - Quick notifications

Example Discord webhook:

```javascript
async function sendAlert(message) {
  await fetch(process.env.DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: `🚨 Bot Alert: ${message}`,
    }),
  });
}

// Use in error handlers
try {
  await processMentions();
} catch (error) {
  await sendAlert(`Error processing mentions: ${error.message}`);
  throw error;
}
```

---

## Backup & Recovery

### Automated Backups

```bash
# Backup script
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
tar -czf backups/bot-backup-$DATE.tar.gz \
  data/ \
  .env \
  bot.js \
  package.json

# Keep only last 7 days
find backups/ -name "bot-backup-*.tar.gz" -mtime +7 -delete
```

Add to crontab:
```bash
0 2 * * * /path/to/backup-script.sh
```

### Recovery

```bash
# Extract backup
tar -xzf backups/bot-backup-YYYYMMDD_HHMMSS.tar.gz

# Restart bot
pm2 restart baseapp-bot
```

---

## Scaling

### Multiple Bot Instances

For high traffic, run multiple instances:

```javascript
// Use Redis for shared state
import Redis from 'ioredis';
const redis = new Redis(process.env.REDIS_URL);

// Store processed tweets in Redis
async function isProcessed(tweetId) {
  return await redis.get(`tweet:${tweetId}`) !== null;
}

async function markProcessed(tweetId) {
  await redis.set(`tweet:${tweetId}`, '1', 'EX', 86400); // 24h TTL
}
```

Deploy multiple instances behind a load balancer.

---

## Security

### Best Practices

1. **Never commit secrets**
   - Use `.env` for all keys
   - Add `.env` to `.gitignore`
   - Use Railway/Heroku secrets

2. **Rotate keys regularly**
   - Change API keys every 90 days
   - Update in all environments

3. **Limit permissions**
   - Twitter: Only "Read and Write"
   - AWS: Minimum IAM permissions
   - File system: Restrict access

4. **Monitor for abuse**
   - Track unusual activity
   - Set rate limits
   - Log all API calls

5. **Keep dependencies updated**
   ```bash
   npm audit
   npm update
   ```

---

## Troubleshooting Deployments

### Railway Issues

**Problem**: Build fails
- Check Node.js version (should be 20+)
- Verify package.json is valid
- Check build logs for errors

**Problem**: Bot doesn't start
- Check environment variables are set
- View logs in Railway dashboard
- Verify data directory exists

### DigitalOcean Issues

**Problem**: Can't SSH
- Check security group allows port 22
- Verify SSH key is correct
- Try using password if key fails

**Problem**: Out of memory
- Upgrade to larger droplet
- Optimize data loading
- Clear old logs

### General Issues

**Problem**: Bot stops after a while
- Use PM2 or systemd for auto-restart
- Check for memory leaks
- Monitor system resources

**Problem**: Data not updating
- Check cron job is running: `crontab -l`
- Verify fetch-data.js works: `npm run update-data`
- Check network connectivity

---

## Cost Comparison

| Platform | Monthly Cost | Pros | Cons |
|----------|-------------|------|------|
| Railway | $5-10 | Easiest, auto-deploy | Limited free tier |
| DigitalOcean | $6 | Full control, predictable | Manual setup |
| Heroku | $12 | Easy, add-ons | More expensive |
| AWS EC2 | $8-15 | Scalable, reliable | Complex setup |
| Docker (self-hosted) | $0-6 | Portable, flexible | Need hosting |

**Recommendation**: Start with Railway for ease, migrate to DigitalOcean if you need more control.

---

## Next Steps After Deployment

1. **Test thoroughly**
   - Tweet @ your bot with various queries
   - Check all response types work
   - Verify data is accurate

2. **Monitor for 24 hours**
   - Watch logs for errors
   - Check API usage
   - Verify data updates

3. **Announce your bot**
   - Tweet about it
   - Share in communities
   - Get feedback

4. **Iterate and improve**
   - Add requested features
   - Fix bugs
   - Optimize performance

---

**Your bot is production-ready!** 🎉

Choose your deployment platform and follow the guide above. You'll be live in minutes!
