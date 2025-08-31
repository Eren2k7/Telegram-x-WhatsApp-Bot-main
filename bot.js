const { Telegraf, Markup } = require('telegraf');
const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, makeInMemoryStore, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const fs = require('fs');
const pino = require('pino');
const CONFIG = require('./config');

if (!fs.existsSync('./db')) fs.mkdirSync('./db');
if (!fs.existsSync('./database')) fs.mkdirSync('./database');
if (!fs.existsSync('./rent-session')) fs.mkdirSync('./rent-session');
if (!fs.existsSync('./images')) fs.mkdirSync('./images');

const bot = new Telegraf(CONFIG.token);
const store = makeInMemoryStore({ logger: pino().child({ level: 'silent', stream: 'store' }) });

let userPhoneMap = JSON.parse(fs.readFileSync('./database/user_numbers.json', 'utf-8'));
let premiumUsers = JSON.parse(fs.readFileSync('./database/premium.json', 'utf-8'));
let userSockMap = {};
let pendingRequests = {};

function saveUserNumbers() {
  fs.writeFileSync('./database/user_numbers.json', JSON.stringify(userPhoneMap, null, 2));
}

async function startSock(ctx, userId, phoneNumber) {
  const { state, saveCreds } = await useMultiFileAuthState(`./rent-session/${userId}`);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    auth: state,
    browser: ["Ubuntu", "Chrome", "20.0.04"]
  });

  store.bind(sock.ev);
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr, pairingCode } = update;

    if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode;
      if (reason !== DisconnectReason.loggedOut) {
        await startSock(ctx, userId, phoneNumber);
      }
    }

    if (connection === 'open') {
      ctx.replyWithPhoto({ source: './images/success.png' }, { caption: `✅ Connected successfully to WhatsApp! (User: ${userId})` });
      userSockMap[userId] = sock;
      userPhoneMap[userId] = phoneNumber;
      saveUserNumbers();
      delete pendingRequests[userId];
    }

    if (pairingCode) {
      try {
        await ctx.telegram.sendMessage(
          userId,
          `🔑 Your WhatsApp pairing code for *${phoneNumber}* is:\n\n\`${pairingCode}\`\n\n⏳ Expires in 1 minute.`,
          { parse_mode: 'Markdown' }
        );
      } catch (err) {
        console.error('Failed to send pairing code:', err);
        ctx.reply('⚠️ Unable to send pairing code. Please try again.');
      }
    }
  });

  return sock;
}

// 🟢 /ping command
bot.command('ping', (ctx) => {
  ctx.reply('Pong! ✅ Bot is alive.');
});

// 🟢 /start command
bot.start((ctx) => {
  ctx.replyWithPhoto({ source: './images/welcome.png' }, {
    caption: '🤖 Welcome! This bot helps you pair your WhatsApp number.',
    ...Markup.inlineKeyboard([
      [Markup.button.url('📢 Channel', CONFIG.CHANNEL_INVITE_LINK)],
      [Markup.button.url('💬 Group', CONFIG.GROUP_LINK)]
    ])
  });
});

// 🟢 /menu command
bot.command('menu', (ctx) => {
  ctx.replyWithPhoto({ source: './images/menu.png' }, {
    caption: '📋 Available Commands:\n\n/reqpair <number>\n/listuser\n/deluser <userID>',
    ...Markup.inlineKeyboard([
      [Markup.button.url('📢 Channel', CONFIG.CHANNEL_INVITE_LINK)],
      [Markup.button.url('💬 Group', CONFIG.GROUP_LINK)]
    ])
  });
});

// 🟢 /reqpair command (with owner bypass)
bot.command('reqpair', async (ctx) => {
  const userId = ctx.from.id;

  if (ctx.chat.type !== 'private') {
    ctx.reply('⚠️ This command can only be used in private chat.');
    return;
  }

  // Owners bypass premium requirement
  if (!premiumUsers.includes(userId) && !CONFIG.owner.includes(userId)) {
    ctx.reply('❌ You are not a premium user. Please contact the owner.');
    return;
  }

  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    ctx.reply('⚠️ Please provide your phone number. Example: /reqpair +1234567890');
    return;
  }

  const phoneNumber = args[1];

  if (pendingRequests[userId]) {
    ctx.reply('⏳ Please wait until your current request is processed.');
    return;
  }

  pendingRequests[userId] = true;

  ctx.replyWithPhoto({ source: './images/pair.png' }, { caption: '⏳ Generating pairing code, please wait...' });

  try {
    await startSock(ctx, userId, phoneNumber);
  } catch (err) {
    console.error(err);
    ctx.replyWithPhoto({ source: './images/error.png' }, { caption: '❌ Failed to connect to WhatsApp.' });
    delete pendingRequests[userId];
  }
});

// 🟢 /listuser command
bot.command('listuser', (ctx) => {
  if (!CONFIG.owner.includes(ctx.from.id)) {
    ctx.reply('❌ You are not authorized to use this command.');
    return;
  }

  if (Object.keys(userPhoneMap).length === 0) {
    ctx.reply('📭 No users found.');
    return;
  }

  let message = '📋 List of Users:\n\n';
  for (let [userId, phone] of Object.entries(userPhoneMap)) {
    message += `👤 UserID: \`${userId}\`\n📱 Number: ${phone}\n\n`;
  }

  if (message.length > 4000) {
    const chunks = message.match(/[\s\S]{1,4000}/g);
    chunks.forEach(chunk => ctx.reply(chunk, { parse_mode: 'Markdown' }));
  } else {
    ctx.reply(message, { parse_mode: 'Markdown' });
  }
});

// 🟢 /deluser command
bot.command('deluser', (ctx) => {
  if (!CONFIG.owner.includes(ctx.from.id)) {
    ctx.reply('❌ You are not authorized to use this command.');
    return;
  }

  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    ctx.reply('⚠️ Please provide a user ID. Example: /deluser 123456789');
    return;
  }

  const userId = args[1];
  if (!userPhoneMap[userId]) {
    ctx.reply('❌ User not found.');
    return;
  }

  delete userPhoneMap[userId];
  saveUserNumbers();
  ctx.reply(`✅ User ${userId} has been deleted.`);
});

// Launch bot
bot.launch()
  .then(() => console.log('🤖 Telegram bot is running...'))
  .catch((err) => console.error('❌ Failed to launch bot:', err));

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
