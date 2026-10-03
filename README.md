═══════════════════════════════════════════════════════
       STEVE_AI v2 — JAVA EDITION SETUP GUIDE
       AI Brain + Memory + Learning + PVP
═══════════════════════════════════════════════════════


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 WHAT'S NEW IN V2
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ REAL AI BRAIN — powered by Claude API
   Bot actually thinks, plans, and understands you

✅ MEMORY SYSTEM — saved in steve_memory.json
   Bot remembers you between sessions
   Knows your playstyle, mood, favorite weapons
   Remembers epic moments you shared

✅ LEARNS YOUR STYLE
   Watches how you play and adapts
   Detects if you're a fighter, miner, explorer
   Adjusts tone based on your mood

✅ UNDERSTANDS BAD TYPING
   "les go fihgt" → understands = let's go fight
   Short messages, slang, anything — AI gets it

✅ PERSONALITY
   Hypes you up, worries when you're low HP
   Brings up shared memories naturally
   Says random friend-like things while following you
   Has inside jokes, remembers what you told it

✅ NATURAL COMMANDS
   "follow me" = !follow
   "go fight" = !pvp
   "find diamonds" = !mine
   No need to remember exact commands


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 STEP 1 — INSTALL NODE.JS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

→ Go to https://nodejs.org
→ Download LTS version → Install
→ Verify: open CMD and type:  node --version


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 STEP 2 — EDIT bot.js
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Open bot.js in Notepad or VS Code and change:

  ownerName: 'YourNameHere'   ← Your EXACT Minecraft username

  host: 'localhost'            ← Server IP or 'localhost'
  port: 25565                  ← Server port
  version: '1.20.1'           ← Your Minecraft version EXACTLY

  claudeApiKey: 'YOUR_CLAUDE_API_KEY_HERE'
  ← Get this from console.anthropic.com (free account)
  ← Bot works WITHOUT this but AI won't think smart
     (it uses built-in fallback responses instead)


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 STEP 3 — GET CLAUDE API KEY (optional but recommended)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Go to https://console.anthropic.com
2. Sign up (free)
3. Go to "API Keys" → Create Key
4. Copy the key (starts with sk-ant-...)
5. Paste it in bot.js:  claudeApiKey: 'sk-ant-...'

Without the key: bot still works, fights, follows — 
just uses pre-written responses instead of thinking.

With the key: bot actually THINKS, understands anything
you type, has real personality, remembers you deeply.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 STEP 4 — INSTALL & RUN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Put the steve-ai-v2 folder on your PC (e.g. Desktop)

Open Command Prompt in that folder:
  → Shift + Right-click → "Open PowerShell here"

Install:
  npm install

Run:
  node bot.js

Bot joins your world automatically!


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 COMMANDS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Type in Minecraft chat:

  !help                → All commands
  !follow              → Bot follows you
  !stop                → Bot stays
  !come                → Bot comes to you
  !pvp                 → PVP mode: hunts players+mobs
  !guard               → Protects you from mobs
  !mine                → Auto-mines best ores nearby
  !attack <name>       → Attack specific player
  !status              → Mode, HP, session info
  !hp                  → Health and food
  !inv                 → Inventory
  !remember <fact>     → Teach bot something about you
                          e.g. "!remember I love diamonds"
                          e.g. "!remember my name is Raj"

Natural language also works:
  "follow me bro"
  "lets go pvp"
  "find some diamonds"
  "protect me"
  "come here"
  "I like swords"
  Anything — AI understands!


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 MEMORY SYSTEM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Bot saves a file called steve_memory.json
It stores:
  - Your playstyle (fighter, miner, explorer...)
  - Your favorite weapons
  - Your mood patterns
  - Things you told it (!remember)
  - Epic moments (surviving low HP fights, etc.)
  - Session count (how many times you played together)
  - Inside jokes and shared history

Every session the bot greets you differently based
on your history. The more you play, the better it
knows you!

To reset memory: delete steve_memory.json


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 TIPS TO GET THE BEST EXPERIENCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Use !remember to teach the bot about you:
   !remember I always use sword not axe
   !remember I hate creepers
   !remember my favorite biome is jungle

2. Just CHAT with it naturally — it responds like a friend

3. The bot gets smarter each session — play regularly!

4. In PVP, stand near it — it fights with you, not for you

5. Give it good weapons — drop them on the ground, it picks up


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 TROUBLESHOOTING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Bot won't connect:
  → Check host, port, version in bot.js
  → Make sure server is running
  → For LAN: open world to LAN in Minecraft first

AI responses seem dumb:
  → Add Claude API key in bot.js (see Step 3)

Bot doesn't follow me:
  → Check ownerName matches your EXACT username

"Cannot find module" error:
  → Run npm install again

Bot keeps disconnecting:
  → Normal — it auto-reconnects in 5 seconds
