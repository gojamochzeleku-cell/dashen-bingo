-- DASHEN BINGO DATABASE SCHEMA
-- This file will be used to create tables in your Neon PostgreSQL database.

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    telegram_id BIGINT UNIQUE NOT NULL,
    username VARCHAR(255),
    first_name VARCHAR(255),
    role VARCHAR(50) DEFAULT 'PLAYER',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Wallets Table (Ledger system for safety)
CREATE TABLE IF NOT EXISTS wallets (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    balance NUMERIC(15, 2) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Wallet Ledger (Audit trail for every transaction - NO direct balance edits)
CREATE TABLE IF NOT EXISTS wallet_ledger (
    id SERIAL PRIMARY KEY,
    wallet_id INT REFERENCES wallets(id) ON DELETE CASCADE,
    amount NUMERIC(15, 2) NOT NULL,
    type VARCHAR(50) NOT NULL, -- 'DEPOSIT', 'WITHDRAWAL', 'GAME_FEE', 'PRIZE', 'BOT_FEE'
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Games Table (The server-controlled game state)
CREATE TABLE IF NOT EXISTS games (
    id SERIAL PRIMARY KEY,
    state VARCHAR(50) DEFAULT 'WAITING', -- WAITING, CARD_SELECTION, CALLING, COMPLETED
    fee_tier INT DEFAULT 10,
    total_cards_sold INT DEFAULT 0,
    prize_pool NUMERIC(15, 2) DEFAULT 0.00,
    commission NUMERIC(15, 2) DEFAULT 0.00,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Bingo Cards Template (The 400 immutable cards)
CREATE TABLE IF NOT EXISTS bingo_cards (
    id SERIAL PRIMARY KEY,
    grid_number INT UNIQUE NOT NULL,
    card_data JSONB NOT NULL, -- Stores the 5x5 grid numbers
    is_active BOOLEAN DEFAULT true
);

-- 6. Game Cards (Player's specific purchase in a specific game)
CREATE TABLE IF NOT EXISTS game_cards (
    id SERIAL PRIMARY KEY,
    game_id INT REFERENCES games(id) ON DELETE CASCADE,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    bingo_card_id INT REFERENCES bingo_cards(id),
    fee_paid NUMERIC(15, 2) NOT NULL,
    is_winner BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
