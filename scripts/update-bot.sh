#!/bin/bash

# Quick Data Update Script
# Run this after you update your miniapp data

echo "🔄 BaseApp Bot - Quick Data Update"
echo "=================================="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration (EDIT THESE)
BOT_SERVER="root@your-bot-server-ip"
BOT_PATH="/root/baseapp-intelligent-bot"

echo "📍 Bot Server: $BOT_SERVER"
echo "📁 Bot Path: $BOT_PATH"
echo ""

# Option 1: Local bot (if running on same machine)
if [ "$1" == "local" ]; then
    echo "🏠 Updating local bot..."
    npm run update-data
    
    if [ $? -eq 0 ]; then
        echo ""
        echo -e "${GREEN}✅ Local bot data updated successfully!${NC}"
    else
        echo ""
        echo -e "${YELLOW}❌ Failed to update local bot data${NC}"
        exit 1
    fi
    
# Option 2: Remote bot via SSH
else
    echo "🌐 Updating remote bot..."
    ssh $BOT_SERVER << EOF
        cd $BOT_PATH
        npm run update-data
        
        # Restart bot if using PM2
        pm2 restart baseapp-bot 2>/dev/null || echo "PM2 not found, skipping restart"
        
        # Show status
        echo ""
        echo "📊 Bot Status:"
        pm2 list | grep baseapp-bot 2>/dev/null || echo "Bot not running with PM2"
EOF

    if [ $? -eq 0 ]; then
        echo ""
        echo -e "${GREEN}✅ Remote bot data updated successfully!${NC}"
        echo ""
        echo "💡 Tip: Check bot logs with: ssh $BOT_SERVER 'pm2 logs baseapp-bot'"
    else
        echo ""
        echo -e "${YELLOW}❌ Failed to update remote bot data${NC}"
        exit 1
    fi
fi

echo ""
echo "🎉 Done!"
