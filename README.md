# Dashen Bingo 🎲

A professional Telegram Bingo game with real-time multiplayer, manual payment gateway, and admin dashboard.

## 🏗️ Architecture

- **Backend API**: Node.js + Express + Socket.IO
- **Frontend**: React + Vite + Tailwind CSS
- **Database**: PostgreSQL (Neon)
- **Bot**: node-telegram-bot-api
- **Deployment**: Render (Backend) + Vercel (Frontend)

## 🚀 Features

- 🎮 Real-time multiplayer Bingo
- 💰 Manual payment gateway (CBE, CBE Birr, TeleBirr)
- 🛡️ Admin dashboard with transaction approval
- 📊 Ledger with daily/weekly/monthly reports
- 🎁 Promotion system (welcome bonus, deposit match, referrals)
- 🔐 Secure wallet system with instant withdrawals

## 📦 Project Structure

telegram-bingo-new/
├── apps/
│   ├── api/          # Backend API (Express + Socket.IO)
│   ├── web/          # Frontend (React + Vite)
│   └── bot/          # Telegram Bot
└── README.md

## 🛠️ Local Development

1. Install dependencies in each app folder
2. Configure .env files from .env.example
3. Start backend, frontend, and bot in separate terminals

## 🌐 Deployment

- **Backend**: Deploy to Render (Web Service)
- **Frontend**: Deploy to Vercel
- **Bot**: Deploy to Render (Background Worker)
- **Database**: Neon PostgreSQL (already cloud-hosted)

## 📝 License

MIT
