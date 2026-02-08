import fs from 'fs/promises';
import path from 'path';

const MINIAPP_URL = process.env.MINIAPP_URL || 'https://baseapp-reward-dashboard.vercel.app';
const DATA_DIR = './data';
const BACKUP_DIR = './data/backups';

/**
 * Fetch JSON file from the miniapp
 */
async function fetchDataFile(filename) {
  try {
    const url = `${MINIAPP_URL}/${filename}`;
    console.log(`📥 Fetching ${filename}...`);
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Validate data
    if (!data || Object.keys(data).length === 0) {
      throw new Error('Received empty data');
    }
    
    return data;
  } catch (error) {
    console.error(`❌ Error fetching ${filename}:`, error.message);
    return null;
  }
}

/**
 * Backup existing data before updating
 */
async function backupData() {
  try {
    await fs.mkdir(BACKUP_DIR, { recursive: true });
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(BACKUP_DIR, timestamp);
    await fs.mkdir(backupPath, { recursive: true });
    
    const files = await fs.readdir(DATA_DIR);
    
    for (const file of files) {
      if (file.endsWith('.json')) {
        const sourcePath = path.join(DATA_DIR, file);
        const destPath = path.join(backupPath, file);
        await fs.copyFile(sourcePath, destPath);
      }
    }
    
    console.log(`💾 Backed up to ${backupPath}`);
    
    // Clean old backups (keep last 5)
    const backups = await fs.readdir(BACKUP_DIR);
    if (backups.length > 5) {
      const sorted = backups.sort().slice(0, -5);
      for (const old of sorted) {
        await fs.rm(path.join(BACKUP_DIR, old), { recursive: true });
      }
    }
    
    return true;
  } catch (error) {
    console.error('⚠️  Backup failed:', error.message);
    return false;
  }
}

/**
 * Validate data integrity
 */
function validateData(filename, data) {
  switch (filename) {
    case 'data/overview.json':
      return data.all_time && data.latest_week;
    
    case 'data/leaderboard_all_time.json':
      return Array.isArray(data.rows) && data.rows.length > 0;
    
    case 'data/leaderboard_weekly_latest.json':
      return Array.isArray(data.rows) && data.rows.length > 0;
    
    case 'data/farcaster_map.json':
      return Object.keys(data).length > 0;
    
    default:
      return true;
  }
}

/**
 * Download all data files
 */
async function downloadAllData() {
  console.log('🔄 Starting data sync from miniapp...\\n');
  console.log(`📍 Source: ${MINIAPP_URL}\\n`);

  // Ensure data directory exists
  await fs.mkdir(DATA_DIR, { recursive: true });

  // Backup existing data
  await backupData();

  const files = [
    'data/overview.json',
    'data/leaderboard_all_time.json',
    'data/leaderboard_weekly_latest.json',
    'data/farcaster_map.json',
  ];

  let successCount = 0;
  let failCount = 0;

  for (const file of files) {
    const data = await fetchDataFile(file);
    
    if (data) {
      // Validate data
      if (!validateData(file, data)) {
        console.error(`❌ Validation failed for ${file}`);
        failCount++;
        continue;
      }
      
      const filename = path.basename(file);
      const filepath = path.join(DATA_DIR, filename);
      
      await fs.writeFile(filepath, JSON.stringify(data, null, 2));
      console.log(`✅ Saved ${filename}`);
      
      // Log some stats
      if (file.includes('overview')) {
        console.log(`   • All-time: $${data.all_time.total_usdc} (${data.all_time.unique_users} users)`);
        console.log(`   • This week: $${data.latest_week.total_usdc} (${data.latest_week.unique_users} users)`);
      } else if (file.includes('leaderboard')) {
        console.log(`   • ${data.rows.length} users in leaderboard`);
      } else if (file.includes('farcaster_map')) {
        console.log(`   • ${Object.keys(data).length} users mapped`);
      }
      
      successCount++;
    } else {
      failCount++;
    }
  }

  console.log('\\n' + '─'.repeat(50));
  console.log(`📊 Sync Summary:`);
  console.log(`   ✅ Success: ${successCount}/${files.length}`);
  console.log(`   ❌ Failed: ${failCount}/${files.length}`);
  
  if (failCount > 0) {
    console.log('\\n⚠️  Some files failed to sync. Check your miniapp URL and network connection.');
    process.exit(1);
  } else {
    console.log('\\n✨ Data sync complete! Bot will use updated data on next reload.');
  }
  
  // Write sync timestamp
  await fs.writeFile(
    path.join(DATA_DIR, 'last_sync.json'),
    JSON.stringify({
      timestamp: new Date().toISOString(),
      source: MINIAPP_URL,
      success: successCount,
      failed: failCount,
    }, null, 2)
  );
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  downloadAllData().catch((error) => {
    console.error('\\n💥 Fatal error:', error);
    process.exit(1);
  });
}

export { downloadAllData };
