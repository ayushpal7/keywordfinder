# KeywordFinder — Free Keyword Research Tool

A 100% free keyword research tool powered by AI. No sign-up, no limits, no credit card.

## 🔐 API Key Security
Your Anthropic API key lives ONLY in Vercel's environment variables — never in the frontend HTML.
Users cannot see it. Ever.

## 🚀 Deploy in 5 Steps (Free on Vercel)

### Step 1 — Get your Anthropic API Key
1. Go to https://console.anthropic.com
2. Click "API Keys" → "Create Key"
3. Copy the key (starts with `sk-ant-...`)

### Step 2 — Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit"
# Create a repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/keywordfinder.git
git push -u origin main
```

### Step 3 — Deploy to Vercel (free)
1. Go to https://vercel.com → Sign up free (use GitHub login)
2. Click "Add New Project"
3. Import your GitHub repo
4. Click "Deploy" — takes 60 seconds

### Step 4 — Add your API Key (CRITICAL)
1. In Vercel dashboard → Your Project → Settings → Environment Variables
2. Add: Name = `ANTHROPIC_API_KEY`, Value = your key from Step 1
3. Click "Save" → then "Redeploy"

### Step 5 — Add your custom domain
1. Buy domain from Namecheap.com (~$10-30/yr)
2. In Vercel → Project → Settings → Domains → Add Domain
3. Follow DNS instructions (5 min setup)
4. Done! Your tool is live at yourdomain.com 🎉

## 📁 File Structure
```
/
├── index.html          ← Main website (frontend)
├── api/
│   └── keywords.js     ← Serverless proxy (hides API key)
├── vercel.json         ← Vercel config
└── README.md
```

## 💡 Domain Recommendations (in order)
1. keywordfinder.io  — best for ranking (exact match keyword)
2. kwfinder.net      — short, memorable
3. freekwresearch.com — SEO-rich name
4. keywordiq.io     — modern techy feel

Buy from: namecheap.com (cheapest) or cloudflare.com/registrar (at-cost)

## 🆓 Total Cost
- Hosting (Vercel): FREE
- Domain: ~$10-30/year
- API costs: ~$0.003 per search (very cheap, ~333 searches per $1)

## 💰 How to Monetize Later
- Add Google AdSense (free to join) — earn from ads
- Add affiliate links to Ahrefs/SEMrush (they pay 20-40% commission)
- Offer a "Pro" plan with extra features using Stripe
