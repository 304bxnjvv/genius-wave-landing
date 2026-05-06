const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const morgan = require('morgan')
const path = require('path')
const Database = require('better-sqlite3')

// --- Database Setup ---
const db = new Database(path.join(__dirname, 'data', 'tracking.db'))
db.pragma('journal_mode = WAL')
db.pragma('busy_timeout = 5000')

db.exec(`
  CREATE TABLE IF NOT EXISTS clicks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign TEXT,
    adset TEXT,
    ad TEXT,
    fbclid TEXT,
    ip TEXT,
    user_agent TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    campaign TEXT,
    source TEXT,
    ip TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_clicks_campaign ON clicks(campaign);
  CREATE INDEX IF NOT EXISTS idx_clicks_created ON clicks(created_at);
  CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);
`)

// --- Express App ---
const app = express()
const PORT = process.env.PORT || 3000

app.use(helmet({
  contentSecurityPolicy: false, // Allow Tailwind CDN
  crossOriginEmbedderPolicy: false
}))
app.use(cors())
app.use(express.json())
app.use(morgan('combined'))

// --- Click Tracking & Redirect ---
app.get('/go', (req, res) => {
  const { tid, campaign, adset, ad, fbclid } = req.query

  // Log click
  try {
    db.prepare(`
      INSERT INTO clicks (campaign, adset, ad, fbclid, ip, user_agent)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      campaign || 'direct',
      adset || 'unknown',
      ad || 'unknown',
      fbclid || tid || '',
      req.ip,
      req.headers['user-agent'] || ''
    )
  } catch (err) {
    console.error('[click] db error:', err.message)
  }

  // Redirect to ClickBank hoplink
  const hoplink = `https://9ac670avmush5vb6fjleuw-u8a.hop.clickbank.net/?&traffic_source=facebook&traffic_type=paid&campaign=${campaign || 'gw_focus'}&creative=${ad || 'gw_focus1'}&ad=${adset || 'gw_focus1'}&extclid=${fbclid || tid || ''}`
  res.redirect(301, hoplink)
})

// --- Email Capture ---
app.post('/api/subscribe', (req, res) => {
  const { email, campaign } = req.body

  if (!email || !email.includes('@')) {
    return res.status(400).json({ ok: false, error: 'Valid email required' })
  }

  try {
    db.prepare(`
      INSERT INTO leads (email, campaign, source, ip)
      VALUES (?, ?, ?, ?)
    `).run(email, campaign || 'direct', 'landing_page', req.ip)

    console.log(`[lead] new subscriber: ${email}`)
    res.json({ ok: true, message: 'Subscribed successfully' })
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.json({ ok: true, message: 'Already subscribed' })
    }
    console.error('[lead] db error:', err.message)
    res.status(500).json({ ok: false, error: 'Server error' })
  }
})

// --- Meta CAPI Bridge (Server-Side Pixel) ---
app.post('/api/fb-event', express.json(), (req, res) => {
  const { fbc, fbp, event_name } = req.body
  console.log(`[fb-event] ${event_name} — fbc:${fbc || 'none'} fbp:${fbp || 'none'}`)
  // In production: send to Facebook CAPI endpoint
  // fetch(`https://graph.facebook.com/v18.0/${PIXEL_ID}/events?access_token=${TOKEN}`, ...)
  res.json({ ok: true })
})

// --- Stats Endpoint ---
app.get('/api/stats', (_req, res) => {
  const totalClicks = db.prepare('SELECT COUNT(*) as cnt FROM clicks').get()
  const totalLeads = db.prepare('SELECT COUNT(*) as cnt FROM leads').get()
  const todayClicks = db.prepare("SELECT COUNT(*) as cnt FROM clicks WHERE date(created_at) = date('now')").get()
  const todayLeads = db.prepare("SELECT COUNT(*) as cnt FROM leads WHERE date(created_at) = date('now')").get()

  res.json({
    ok: true,
    clicks_total: totalClicks.cnt,
    clicks_today: todayClicks.cnt,
    leads_total: totalLeads.cnt,
    leads_today: todayLeads.cnt
  })
})

// --- Static Landing Page ---
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache')
    }
  }
}))

// --- Start ---
app.listen(PORT, () => {
  console.log(`🧠 Genius Wave Landing Page running on http://localhost:${PORT}`)
  console.log(`   Click tracking: http://localhost:${PORT}/go`)
  console.log(`   Stats: http://localhost:${PORT}/api/stats`)
})
