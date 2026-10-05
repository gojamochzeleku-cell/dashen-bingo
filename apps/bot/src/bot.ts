import "./dummy_server";
import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import { getOrCreateUser, getUserBalance } from './lib/database';
import pool from './lib/database';

dotenv.config({ path: '../../.env' });

const token = process.env.TELEGRAM_BOT_TOKEN!;
const miniAppUrl = process.env.MINI_APP_URL || 'https://example.com';
const SUPPORT = process.env.SUPPORT_USERNAME || 'DashenBingo';
const HOUSE_CBE = process.env.HOUSE_CBE || '1000092169522';
const HOUSE_CBE_BIRR = process.env.HOUSE_CBE_BIRR || '0911073015';
const HOUSE_TELEBIRR = process.env.HOUSE_TELEBIRR || '0911073015';
const HOUSE_NAME = process.env.HOUSE_NAME || 'Yohannes Berhan';
const API_URL = 'http://localhost:3000';
const MIN_WITHDRAW = 100;
const KEEP_IN_WALLET = 100;

const bot = new TelegramBot(token, { polling: true });
console.log('🤖 [BOT] Dashen Bingo Bot is starting...');

const menuKeyboard = {
  keyboard: [
    [{ text: '💰 Wallet' }, { text: '🎮 Play Bingo' }],
    [{ text: '⬆️ Deposit' }, { text: '⬇️ Withdraw' }],
    [{ text: '🆘 Support' }]
  ],
  resize_keyboard: true,
  is_persistent: true
};

const cancelKb = { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'cancel_action' }]] };
const METHOD_LABEL: Record<string, string> = { CBE: '🏦 CBE Bank', CBE_BIRR: '📱 CBE Birr', TELEBIRR: '📞 TeleBirr' };

// 🧠 BULLETPROOF STATE MACHINE
interface UserState {
  action: 'withdraw' | 'deposit';
  step: number;
  data: any;
}
const states: Record<number, UserState> = {};

function clearState(tgId: number) { delete states[tgId]; }

async function hasSharedContact(tgId: number): Promise<boolean> {
  try {
    const res = await pool.query('SELECT shared_contact FROM users WHERE telegram_id = $1', [tgId]);
    return res.rows.length > 0 && !!res.rows[0].shared_contact;
  } catch { return false; }
}

function showMainMenu(chatId: number) {
  bot.sendMessage(chatId, '🏠 *Main Menu*', { parse_mode: 'Markdown', reply_markup: menuKeyboard });
  bot.sendMessage(chatId, 'Tap below to play:', { reply_markup: { inline_keyboard: [[{ text: '🚀 Open Bingo Game', web_app: { url: miniAppUrl } }]] } });
}

// ============ CORE COMMANDS ============
bot.onText(/^\/start/, async (msg) => {
  const chatId = msg.chat.id, tgId = msg.from.id;
  clearState(tgId); // Reset any stuck wizards
  try { await getOrCreateUser(tgId, msg.from.username || '', msg.from.first_name || 'Player'); } catch {}
  if (await hasSharedContact(tgId)) showMainMenu(chatId);
  else bot.sendMessage(chatId, '👋 *Welcome!*\n\nPlease share your contact to verify your account.', { parse_mode: 'Markdown', reply_markup: { keyboard: [[{ text: '📱 Share My Contact', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true } });
});

bot.onText(/^\/cancel/, (msg) => {
  clearState(msg.from.id);
  bot.sendMessage(msg.chat.id, '❌ Action cancelled.', { reply_markup: menuKeyboard });
});

bot.on('contact', async (msg) => {
  await pool.query('UPDATE users SET shared_contact = TRUE, phone_number = $1 WHERE telegram_id = $2', [msg.contact.phone_number, msg.from.id]);
  bot.sendMessage(msg.chat.id, '✅ Account verified!', { reply_markup: { remove_keyboard: true } });
  showMainMenu(msg.chat.id);
});

bot.onText(/^\/balance|💰 Wallet/, async (msg) => {
  clearState(msg.from.id);
  try {
    const u = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [msg.from.id]);
    if (u.rows.length > 0) {
      const bal = await getUserBalance(u.rows[0].id);
      bot.sendMessage(msg.chat.id, '💰 *Wallet*\n\nBalance: *' + Math.floor(bal) + ' ETB*', { parse_mode: 'Markdown', reply_markup: menuKeyboard });
    }
  } catch {}
});

// ============ DEPOSIT FLOW ============
bot.onText(/^\/deposit|⬆️ Deposit/, (msg) => {
  clearState(msg.from.id);
  bot.sendMessage(msg.chat.id, '⬆️ *Choose Deposit Method*', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
    [{ text: '🏦 CBE Bank', callback_data: 'dep:CBE' }],
    [{ text: '📱 CBE Birr', callback_data: 'dep:CBE_BIRR' }],
    [{ text: '📞 TeleBirr', callback_data: 'dep:TELEBIRR' }]
  ]}});
});

// ============ WITHDRAW FLOW (STEP 1) ============
bot.onText(/^\/withdraw|⬇️ Withdraw/, (msg) => {
  const tgId = msg.from.id;
  clearState(tgId);
  states[tgId] = { action: 'withdraw', step: 1, data: {} };
  bot.sendMessage(msg.chat.id, '⬇️ *Withdraw Funds*\n\n*Step 1/4:* Choose your payout method:', { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [
    [{ text: '🏦 CBE Bank', callback_data: 'wdm:CBE' }],
    [{ text: '📱 CBE Birr', callback_data: 'wdm:CBE_BIRR' }],
    [{ text: '📞 TeleBirr', callback_data: 'wdm:TELEBIRR' }],
    [{ text: '❌ Cancel', callback_data: 'cancel_action' }]
  ]}});
});

// ============ CALLBACK HANDLER (Buttons) ============
bot.on('callback_query', async (q) => {
  const data = q.data || '';
  const chatId = q.message?.chat.id;
  const tgId = q.from.id;
  if (!chatId) return;

  if (data === 'cancel_action') {
    clearState(tgId);
    bot.answerCallbackQuery(q.id);
    bot.deleteMessage(chatId, q.message!.message_id).catch(() => {});
    bot.sendMessage(chatId, '❌ Cancelled.', { reply_markup: menuKeyboard });
    return;
  }

  if (data.startsWith('dep:')) {
    const method = data.split(':')[1];
    states[tgId] = { action: 'deposit', step: 1, data: { method } };
    let details = method === 'CBE' ? `🏦 *CBE Bank*\nAccount: \`${HOUSE_CBE}\`\nName: *${HOUSE_NAME}*` :
                  method === 'CBE_BIRR' ? `📱 *CBE Birr*\nPhone: \`${HOUSE_CBE_BIRR}\`\nName: *${HOUSE_NAME}*` :
                  `📞 *TeleBirr*\nPhone: \`${HOUSE_TELEBIRR}\`\nName: *${HOUSE_NAME}*`;
    bot.answerCallbackQuery(q.id);
    bot.sendMessage(chatId, details + '\n\nSend money, then *forward the exact SMS* here.\n❓ Issues? @' + SUPPORT, { parse_mode: 'Markdown', reply_markup: cancelKb });
  }
  
  else if (data.startsWith('wdm:')) {
    const method = data.split(':')[1];
    states[tgId] = { action: 'withdraw', step: 2, data: { method } };
    bot.answerCallbackQuery(q.id);
    bot.sendMessage(chatId, `*Step 2/4:* Send your *account number*${method !== 'CBE' ? ' (phone number)' : ''}:`, { parse_mode: 'Markdown', reply_markup: cancelKb });
  }

  else if (data === 'wd_confirm_yes') {
    bot.answerCallbackQuery(q.id);
    const st = states[tgId];
    if (!st || st.action !== 'withdraw' || st.step !== 5) {
      clearState(tgId);
      bot.sendMessage(chatId, 'Session expired. Start again with /withdraw', { reply_markup: menuKeyboard });
      return;
    }
    
    // Fire to backend
    try {
      const res = await fetch(API_URL + '/api/tx/withdraw/request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId: tgId, amount: st.data.amount, method: st.data.method, accountNumber: st.data.account, accountName: st.data.name })
      });
      const d = await res.json();
      clearState(tgId);
      if (d.success) {
        bot.sendMessage(chatId,
          `✅ *Withdrawal Requested!*\n\nAmount: *${d.amount} ETB*\nTo: ${METHOD_LABEL[st.data.method]} \`${st.data.account}\`\nNew Balance: *${Math.floor(d.newBalance)} ETB*\n\n⏱️ Your money will be sent shortly once admin confirms.`,
          { parse_mode: 'Markdown', reply_markup: menuKeyboard });
      } else {
        bot.sendMessage(chatId, '❌ ' + (d.error || 'Failed to process'), { reply_markup: menuKeyboard });
      }
    } catch (e: any) {
      bot.sendMessage(chatId, '❌ Network error: ' + e.message);
    }
  }
  else if (data === 'wd_confirm_no') {
    clearState(tgId);
    bot.answerCallbackQuery(q.id);
    bot.deleteMessage(chatId, q.message!.message_id).catch(() => {});
    bot.sendMessage(chatId, '❌ Withdrawal cancelled.', { reply_markup: menuKeyboard });
  }
});

// ============ TEXT MESSAGE HANDLER (Wizard Steps + SMS) ============
bot.on('message', async (msg: any) => {
  if (!msg.text || msg.contact) return;
  const t = msg.text.trim();
  const tgId = msg.from.id;
  const chatId = msg.chat.id;
  
  // Ignore menu buttons if not in a state
  if (['💰 Wallet', '🎮 Play Bingo', '⬆️ Deposit', '⬇️ Withdraw', '🆘 Support'].includes(t)) return;

  const st = states[tgId];
  if (!st) return; // Not in a wizard, ignore

  // === WITHDRAW WIZARD ===
  if (st.action === 'withdraw') {
    if (st.step === 2) { // Waiting for Account Number
      st.data.account = t;
      st.step = 3;
      bot.sendMessage(chatId, '*Step 3/4:* Send the *account holder full name*:', { parse_mode: 'Markdown', reply_markup: cancelKb });
      return;
    }
    if (st.step === 3) { // Waiting for Name
      st.data.name = t;
      try {
        const u = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [tgId]);
        const bal = await getUserBalance(u.rows[0].id);
        const max = bal - KEEP_IN_WALLET;
        if (max < MIN_WITHDRAW) {
          clearState(tgId);
          bot.sendMessage(chatId, `❌ *Insufficient balance.*\n\nMin: *${MIN_WITHDRAW} ETB*\nMust keep: *${KEEP_IN_WALLET} ETB*\nYour balance: *${Math.floor(bal)} ETB*`, { parse_mode: 'Markdown', reply_markup: menuKeyboard });
          return;
        }
        st.data.max = max;
        st.step = 4;
        bot.sendMessage(chatId, `*Step 4/4:* Send the *amount* to withdraw.\n\nMin: *${MIN_WITHDRAW} ETB*\nMax: *${Math.floor(max)} ETB*`, { parse_mode: 'Markdown', reply_markup: cancelKb });
      } catch (e) { clearState(tgId); bot.sendMessage(chatId, '❌ Error checking balance.'); }
      return;
    }
    if (st.step === 4) { // Waiting for Amount
      const amt = parseFloat(t.replace(/,/g, '.'));
      if (isNaN(amt)) { bot.sendMessage(chatId, '❌ Please send a valid number:'); return; }
      if (amt < MIN_WITHDRAW) { bot.sendMessage(chatId, `❌ Minimum is *${MIN_WITHDRAW} ETB*. Try again:`, { parse_mode: 'Markdown' }); return; }
      if (amt > st.data.max) { bot.sendMessage(chatId, `❌ Maximum is *${Math.floor(st.data.max)} ETB*. Try again:`, { parse_mode: 'Markdown' }); return; }
      
      st.data.amount = amt;
      st.step = 5;
      bot.sendMessage(chatId,
        `🧾 *Confirm Withdrawal*\n\nMethod: ${METHOD_LABEL[st.data.method]}\nAccount: \`${st.data.account}\`\nName: ${st.data.name}\nAmount: *${amt} ETB*\n\nIs everything correct?`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[
          { text: '✅ Confirm', callback_data: 'wd_confirm_yes' },
          { text: '❌ Cancel', callback_data: 'wd_confirm_no' }
        ]]}});
      return;
    }
  }

  // === DEPOSIT SMS HANDLER ===
  if (st.action === 'deposit' && st.step === 1) {
    try {
      const res = await fetch(API_URL + '/api/tx/deposit/submit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramId: tgId, smsText: t, method: st.data.method })
      });
      const d = await res.json();
      if (d.success) {
        bot.sendMessage(chatId, `✅ *Deposit Received!*\n\nAmount: *${d.amount} ETB*\nRef: \`${d.reference}\`\n\n⏱️ Credited within 5 mins after admin approval.`, { parse_mode: 'Markdown', reply_markup: menuKeyboard });
        clearState(tgId);
      } else if (d.error === 'duplicate SMS') {
        bot.sendMessage(chatId, `⚠️ *${d.message || 'Already submitted.'}*`, { parse_mode: 'Markdown' });
      } else {
        bot.sendMessage(chatId, `❌ Could not parse SMS.\n\nPlease forward the *exact bank confirmation SMS*.\n❓ Help: @${SUPPORT}`, { parse_mode: 'Markdown' });
      }
    } catch (e: any) { bot.sendMessage(chatId, '❌ Error: ' + e.message); }
  }
});

bot.onText(/^🆘 Support/, (msg) => {
  clearState(msg.from.id);
  bot.sendMessage(msg.chat.id, `🆘 *Need Help?*\n\nContact: @${SUPPORT}`, { parse_mode: 'Markdown' });
});

bot.onText(/^🎮 Play Bingo/, (msg) => {
  clearState(msg.from.id);
  bot.sendMessage(msg.chat.id, '🎲 Ready to play?', { reply_markup: { inline_keyboard: [[{ text: '🚀 Open Bingo Game', web_app: { url: miniAppUrl } }]] } });
});

console.log('✅ [BOT] Bulletproof Withdrawal Wizard Active!');
