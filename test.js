import Anthropic from '@anthropic-ai/sdk';
import { TwitterApi } from 'twitter-api-v2';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

const colors = {
  reset: '\\x1b[0m',
  green: '\\x1b[32m',
  red: '\\x1b[31m',
  yellow: '\\x1b[33m',
  cyan: '\\x1b[36m',
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

async function testTwitterAuth() {
  log('\\n🔐 Testing Twitter Authentication...', colors.cyan);
  
  try {
    const client = new TwitterApi({
      appKey: process.env.TWITTER_API_KEY,
      appSecret: process.env.TWITTER_API_SECRET,
      accessToken: process.env.TWITTER_ACCESS_TOKEN,
      accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
    });

    const me = await client.v2.me();
    log(`✅ Authenticated as @${me.data.username}`, colors.green);
    return true;
  } catch (error) {
    log(`❌ Failed: ${error.message}`, colors.red);
    return false;
  }
}

async function testAnthropicAuth() {
  log('\\n🤖 Testing Anthropic API...', colors.cyan);
  
  try {
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 50,
      messages: [{ role: 'user', content: 'Say hello!' }],
    });

    log(`✅ Success! Response: "${message.content[0].text}"`, colors.green);
    return true;
  } catch (error) {
    log(`❌ Failed: ${error.message}`, colors.red);
    return false;
  }
}

async function testNeynarAuth() {
  log('\\n🎭 Testing Neynar API...', colors.cyan);
  
  if (!process.env.NEYNAR_API_KEY) {
    log('⚠️  Neynar API key not set (optional)', colors.yellow);
    return true;
  }

  try {
    const response = await fetch(
      'https://api.neynar.com/v2/farcaster/user/bulk?fids=3',
      {
        headers: {
          'accept': 'application/json',
          'api_key': process.env.NEYNAR_API_KEY,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    log(`✅ Success! Fetched user: ${data.users[0].username}`, colors.green);
    return true;
  } catch (error) {
    log(`❌ Failed: ${error.message}`, colors.red);
    return false;
  }
}

async function testDataFiles() {
  log('\\n📁 Testing Data Files...', colors.cyan);
  
  const dataDir = process.env.DATA_DIR || './data';
  const requiredFiles = [
    'overview.json',
    'leaderboard_all_time.json',
    'leaderboard_weekly_latest.json',
    'farcaster_map.json',
  ];

  let allPresent = true;

  for (const file of requiredFiles) {
    try {
      const filepath = path.join(dataDir, file);
      await fs.access(filepath);
      const content = await fs.readFile(filepath, 'utf-8');
      const data = JSON.parse(content);
      
      log(`✅ ${file}: Found (${Object.keys(data).length} keys)`, colors.green);
    } catch (error) {
      log(`❌ ${file}: Missing or invalid!`, colors.red);
      allPresent = false;
    }
  }

  if (!allPresent) {
    log('\\n💡 Run `npm run update-data` to download data files', colors.yellow);
  }

  return allPresent;
}

async function testUserLookup() {
  log('\\n🔍 Testing User Lookup...', colors.cyan);
  
  try {
    const dataDir = process.env.DATA_DIR || './data';
    const farcasterMap = JSON.parse(
      await fs.readFile(path.join(dataDir, 'farcaster_map.json'), 'utf-8')
    );

    // Test lookup by username
    const testUsername = 'femiii.base.eth';
    let found = false;

    for (const [address, userData] of Object.entries(farcasterMap)) {
      if (userData.username === testUsername) {
        log(`✅ Found user: ${userData.display_name} (@${userData.username})`, colors.green);
        log(`   Address: ${address}`, colors.yellow);
        log(`   Followers: ${userData.follower_count}`, colors.yellow);
        found = true;
        break;
      }
    }

    return found;
  } catch (error) {
    log(`❌ Failed: ${error.message}`, colors.red);
    return false;
  }
}

async function testQueryParsing() {
  log('\\n🧠 Testing Query Parsing...', colors.cyan);
  
  try {
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    const testQueries = [
      'show stats for femiii.base.eth',
      'top 10 this week',
      'how much total rewards distributed?',
    ];

    for (const query of testQueries) {
      log(`\\n   Query: "${query}"`, colors.yellow);
      
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 200,
        system: 'Parse queries and respond with JSON only.',
        messages: [{ role: 'user', content: `Parse: "${query}"` }],
      });

      log(`   Response: ${response.content[0].text.substring(0, 60)}...`, colors.green);
    }

    log('\\n✅ Query parsing working!', colors.green);
    return true;
  } catch (error) {
    log(`❌ Failed: ${error.message}`, colors.red);
    return false;
  }
}

async function runAllTests() {
  log('\\n' + '='.repeat(70), colors.cyan);
  log('🧪 BaseApp Intelligent Bot - Test Suite', colors.cyan);
  log('='.repeat(70), colors.cyan);

  const results = [];

  results.push({ name: 'Twitter API', pass: await testTwitterAuth() });
  results.push({ name: 'Anthropic API', pass: await testAnthropicAuth() });
  results.push({ name: 'Neynar API', pass: await testNeynarAuth() });
  results.push({ name: 'Data Files', pass: await testDataFiles() });
  results.push({ name: 'User Lookup', pass: await testUserLookup() });
  results.push({ name: 'Query Parsing', pass: await testQueryParsing() });

  log('\\n' + '='.repeat(70), colors.cyan);
  log('📊 Test Results', colors.cyan);
  log('='.repeat(70), colors.cyan);

  results.forEach(({ name, pass }) => {
    const icon = pass ? '✅' : '❌';
    const color = pass ? colors.green : colors.red;
    log(`${icon} ${name}`, color);
  });

  const allPassed = results.every(r => r.pass);

  log('\\n' + '='.repeat(70), colors.cyan);

  if (allPassed) {
    log('🎉 All tests passed! Bot is ready to run.', colors.green);
    log('\\nStart your bot: npm start', colors.cyan);
  } else {
    log('⚠️  Some tests failed. Please fix the issues above.', colors.red);
  }

  log('='.repeat(70) + '\\n', colors.cyan);
}

runAllTests().catch(console.error);
