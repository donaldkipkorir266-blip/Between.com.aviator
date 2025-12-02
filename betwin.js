
// betwin.js - COMPLETE SINGLE FILE BETTING MVP
// Brand: BetWin.com
// Owner M-Pesa: (Hidden internally)
// Safe Note: Simulated system for development ONLY. No real money.

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'betwin_secret_2025';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'betwinadmin';

app.use(bodyParser.json());
app.use(express.static(__dirname));

// --- SQLite setup ---
const DB_PATH = path.join(__dirname, 'betwin.sqlite');
const db = new sqlite3.Database(DB_PATH);

const initSql = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  email TEXT UNIQUE,
  password_hash TEXT,
  balance REAL DEFAULT 0,
  last_active DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS bets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  stake REAL,
  odd REAL,
  status TEXT,
  payout REAL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  type TEXT,
  amount REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  note TEXT
);
`;
db.exec(initSql);

// --- Helper functions ---
const run = (sql, params=[]) => new Promise((res, rej) => db.run(sql, params, function(err){ if(err) return rej(err); res({ id: this.lastID, changes: this.changes }); }));
const get = (sql, params=[]) => new Promise((res, rej) => db.get(sql, params, (err,row)=>{if(err) return rej(err); res(row); }));
const all = (sql, params=[]) => new Promise((res, rej) => db.all(sql, params, (err,rows)=>{if(err) return rej(err); res(rows); }));

const authMiddleware = async (req,res,next)=>{
    const auth = req.headers.authorization;
    if(!auth) return res.status(401).json({error:'Missing auth'});
    const token = auth.split(' ')[1];
    try {
        const payload = jwt.verify(token, JWT_SECRET);
        const user = await get('SELECT id,name,email,balance FROM users WHERE id=?',[payload.id]);
        if(!user) return res.status(401).json({error:'User not found'});
        // update last active
        await run('UPDATE users SET last_active=CURRENT_TIMESTAMP WHERE id=?',[user.id]);
        req.user = user;
        next();
    } catch(e){ return res.status(401).json({error:'Invalid token'}); }
};

// --- API Routes ---

// Register
app.post('/api/register', async (req,res)=>{
    const {name,email,password}=req.body;
    if(!email||!password) return res.status(400).json({error:'email & password required'});
    const hash = await bcrypt.hash(password,10);
    try{
        const r = await run('INSERT INTO users (name,email,password_hash,balance) VALUES (?,?,?,?)',[name||'User',email,hash,0]);
        const user = await get('SELECT id,name,email,balance FROM users WHERE id=?',[r.id]);
        const token = jwt.sign({id:user.id},JWT_SECRET);
        res.json({user,token});
    }catch(err){ res.status(400).json({error:String(err)}); }
});

// Login
app.post('/api/login', async (req,res)=>{
    const {email,password}=req.body;
    const user = await get('SELECT id,name,email,password_hash,balance FROM users WHERE email=?',[email]);
    if(!user) return res.status(400).json({error:'invalid credentials'});
    const ok = await bcrypt.compare(password,user.password_hash);
    if(!ok) return res.status(400).json({error:'invalid credentials'});
    const token = jwt.sign({id:user.id},JWT_SECRET);
    res.json({user:{id:user.id,name:user.name,email:user.email,balance:user.balance},token});
});

// Deposit (simulate)
app.post('/api/deposit', authMiddleware, async (req,res)=>{
    const {amount} = req.body;
    if(!amount||amount<=0) return res.status(400).json({error:'invalid amount'});
    await run('UPDATE users SET balance = balance + ? WHERE id=?',[amount,req.user.id]);
    await run('INSERT INTO transactions (user_id,type,amount,note) VALUES (?,?,?,?)',[req.user.id,'deposit',amount,'Simulated deposit']);
    const user = await get('SELECT id,name,email,balance FROM users WHERE id=?',[req.user.id]);
    res.json({message:'deposit simulated',balance:user.balance});
});

// Withdraw (simulate)
app.post('/api/withdraw', authMiddleware, async (req,res)=>{
    const {amount}=req.body;
    if(!amount||amount<=0) return res.status(400).json({error:'invalid amount'});
    const user = await get('SELECT balance FROM users WHERE id=?',[req.user.id]);
    if(user.balance<amount) return res.status(400).json({error:'insufficient balance'});
    await run('UPDATE users SET balance = balance - ? WHERE id=?',[amount,req.user.id]);
    await run('INSERT INTO transactions (user_id,type,amount,note) VALUES (?,?,?,?)',[req.user.id,'withdraw',amount,'Simulated withdrawal']);
    const u = await get('SELECT id,balance FROM users WHERE id=?',[req.user.id]);
    res.json({message:'withdraw simulated',balance:u.balance});
});

// Place bet
app.post('/api/bet', authMiddleware, async (req,res)=>{
    const {stake,odd} = req.body;
    if(!stake||stake<=0||!odd||odd<=1) return res.status(400).json({error:'invalid stake or odd'});
    const user = await get('SELECT balance FROM users WHERE id=?',[req.user.id]);
    if(user.balance<stake) return res.status(400).json({error:'insufficient balance'});
    await run('UPDATE users SET balance = balance - ? WHERE id=?',[stake,req.user.id]);
    const r = await run('INSERT INTO bets (user_id,stake,odd,status) VALUES (?,?,?,?)',[req.user.id,stake,odd,'pending']);
    await run('INSERT INTO transactions (user_id,type,amount,note) VALUES (?,?,?,?)',[req.user.id,'bet',-stake,`Bet id ${r.id}`]);
    const bet = await get('SELECT * FROM bets WHERE id=?',[r.id]);
    res.json({message:'bet placed',bet});
});

// Admin resolve bet (simulate)
app.post('/api/admin/resolve', async (req,res)=>{
    const {betId,result,adminPass}=req.body;
    if(adminPass!==ADMIN_PASSWORD) return res.status(401).json({error:'not allowed'});
    const bet = await get('SELECT * FROM bets WHERE id=?',[betId]);
    if(!bet) return res.status(404).json({error:'bet not found'});
    if(bet.status!=='pending') return res.status(400).json({error:'bet already resolved'});
    if(result==='won'){
        const payout = Number(bet.stake)*Number(bet.odd);
        await run('UPDATE bets SET status=?,payout=? WHERE id=?',['won',payout,betId]);
        await run('UPDATE users SET balance = balance + ? WHERE id=?',[payout,bet.user_id]);
        await run('INSERT INTO transactions (user_id,type,amount,note) VALUES (?,?,?,?)',[bet.user_id,'payout',payout,`Payout for bet ${betId}`]);
        return res.json({message:'bet marked won',payout});
    }else{
        await run('UPDATE bets SET status=? WHERE id=?',['lost',betId]);
        return res.json({message:'bet marked lost'});
    }
});

// Balance
app.get('/api/balance', authMiddleware, async (req,res)=>{
    const user = await get('SELECT id,name,email,balance FROM users WHERE id=?',[req.user.id]);
    res.json({user});
});

// List bets
app.get('/api/mybets', authMiddleware, async (req,res)=>{
    const bets = await all('SELECT * FROM bets WHERE user_id=? ORDER BY created_at DESC',[req.user.id]);
    res.json({bets});
});

// List active players (last 1 min)
app.get('/api/active-players', async (req,res)=>{
    const users = await all("SELECT name,balance,last_active FROM users WHERE last_active >= datetime('now','-1 minute') ORDER BY last_active DESC");
    res.json({players: users});
});

// Frontend
app.get('/', (req,res)=>{
    res.sendFile(path.join(__dirname,'index.html'));
});

app.listen(PORT,()=>console.log(`BetWin.com dev prototype running at http://localhost:${PORT}`));
