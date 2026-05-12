/**
 * ╔══════════════════════════════════════════════════════╗
 * ║          STEVE_AI v2 — JAVA EDITION                 ║
 * ║   Ultra Brilliant AI Friend with REAL AI Brain      ║
 * ║   - Learns YOUR playstyle over time                 ║
 * ║   - Thinks before acting (plans, not just reacts)   ║
 * ║   - Real personality — your actual friend           ║
 * ║   - Understands even broken/short messages          ║
 * ║   - Remembers what you like, hate, how you fight    ║
 * ╚══════════════════════════════════════════════════════╝
 */

const mineflayer    = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const { GoalNear, GoalFollow, GoalBlock } = goals;
const pvp           = require('mineflayer-pvp').plugin;
const armorManager  = require('mineflayer-armor-manager');
const autoEat       = require('mineflayer-auto-eat').loader;
const fetch         = (...a) => import('node-fetch').then(m => m.default(...a));
const fs            = require('fs');
const path          = require('path');

// ─────────────────────────────────────────────
//  ⚙️  CONFIG — EDIT BEFORE RUNNING
// ─────────────────────────────────────────────
const CONFIG = {
  // Minecraft connection
  host:     'Nayak_SMP_.aternos.me',
  port:     29826,
  username: 'Nayak_Guard',
  version:  '1.21.9',
  auth:     'offline',         // 'offline' or 'microsoft'

  // Your in-game name — CHANGE THIS
  ownerName: 'Nayak12344',

  // Claude AI API key — get free at console.anthropic.com
  // Bot works without it but AI brain won't think/respond smart
  claudeApiKey: process.env.CLAUDE_API_KEY || 'YOUR_CLAUDE_API_KEY_HERE',

  // Behavior
  autoDefend:        true,
  followOwner:       true,
  autoEquipBestGear: true,
  attackRange:       3.5,
  retreatHP:         4,

  // Memory file — bot saves what it learns about you
  memoryFile: './steve_memory.json',
};

// ─────────────────────────────────────────────
//  MEMORY SYSTEM — Bot learns about you
// ─────────────────────────────────────────────
const defaultMemory = {
  ownerName:      CONFIG.ownerName,
  playstyle:      'unknown',           // aggressive | defensive | builder | explorer
  favWeapon:      'sword',
  preferredBiome: 'unknown',
  combatMoves:    [],                  // patterns it has seen you use
  chatStyle:      'casual',            // how you type
  recentEvents:   [],                  // last 30 things that happened
  sharedMoments:  [],                  // funny/epic moments saved
  ownerMood:      'good',              // detected mood from chat
  totalSessions:  0,
  knownFacts:     [],                  // things you told the bot about yourself
  insideJokes:    [],                  // things you both laugh about
  lastSeen:       null,
};

function loadMemory() {
  try {
    if (fs.existsSync(CONFIG.memoryFile)) {
      const raw = fs.readFileSync(CONFIG.memoryFile, 'utf8');
      return { ...defaultMemory, ...JSON.parse(raw) };
    }
  } catch (e) {}
  return { ...defaultMemory };
}

function saveMemory() {
  try {
    fs.writeFileSync(CONFIG.memoryFile, JSON.stringify(memory, null, 2));
  } catch (e) {}
}

function addEvent(event) {
  memory.recentEvents.unshift({ time: Date.now(), event });
  if (memory.recentEvents.length > 30) memory.recentEvents.pop();
  saveMemory();
}

function addSharedMoment(moment) {
  memory.sharedMoments.unshift({ time: Date.now(), moment });
  if (memory.sharedMoments.length > 20) memory.sharedMoments.pop();
  saveMemory();
}

let memory = loadMemory();
memory.totalSessions++;
memory.lastSeen = new Date().toISOString();
saveMemory();

// ─────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────
const state = {
  mode:            'friend',
  following:       CONFIG.followOwner,
  inCombat:        false,
  currentTarget:   null,
  mining:          false,
  chatHistory:     [],         // conversation with owner this session
  thinkingAbout:   null,       // what AI is currently processing
  lastThought:     '',         // last AI decision
  decisionQueue:   [],         // pending actions AI wants to do
  sessionStart:    Date.now(),
};

// ─────────────────────────────────────────────
//  BOT CREATION
// ─────────────────────────────────────────────
const bot = mineflayer.createBot({
  host: CONFIG.host, port: CONFIG.port,
  username: CONFIG.username, version: CONFIG.version, auth: CONFIG.auth,
});

bot.loadPlugin(pathfinder);
bot.loadPlugin(pvp);
bot.loadPlugin(armorManager);
bot.loadPlugin(autoEat);

// ─────────────────────────────────────────────
//  SPAWN
// ─────────────────────────────────────────────
bot.once('spawn', async () => {
  console.log('[Steve_AI v2] ✅ Spawned!');

  const movements = new Movements(bot);
  movements.canDig = false;
  bot.pathfinder.setMovements(movements);

  try {
    bot.autoEat.setOpts({
      priority: 'foodPoints', startAt: 14,
      bannedFood: ['rotten_flesh', 'spider_eye', 'poisonous_potato'],
    });
    bot.autoEat.enableAuto();
  } catch (e) { console.log('[autoEat] setup skipped:', e.message); }

  // Greet based on memory
  const greeting = await aiThink('greeting', {
    sessionCount: memory.totalSessions,
    knownFacts: memory.knownFacts.slice(0, 5),
    sharedMoments: memory.sharedMoments.slice(0, 2),
    ownerPlaystyle: memory.playstyle,
  });
  bot.chat(greeting);
  addEvent('bot_spawned');

  startAILoop();
  startCombatWatcher();
  startHealthMonitor();
  startLearningLoop();
});

// ─────────────────────────────────────────────
//  AI BRAIN — thinks using Claude API
// ─────────────────────────────────────────────
async function aiThink(situation, context = {}) {
  // No API key — use smart fallback responses
  if (!CONFIG.claudeApiKey || CONFIG.claudeApiKey === 'YOUR_CLAUDE_API_KEY_HERE') {
    return smartFallback(situation, context);
  }

  const systemPrompt = buildSystemPrompt();
  const userMessage  = buildSituationPrompt(situation, context);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CONFIG.claudeApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 120,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    const data = await res.json();
    const reply = data.content?.[0]?.text?.trim();
    if (reply) {
      state.lastThought = reply;
      return reply;
    }
  } catch (e) {
    console.log('[AI] API error, using fallback');
  }

  return smartFallback(situation, context);
}

function buildSystemPrompt() {
  const recentStr   = memory.recentEvents.slice(0, 8).map(e => e.event).join(', ');
  const momentsStr  = memory.sharedMoments.slice(0, 3).map(m => m.moment).join('; ');
  const factsStr    = memory.knownFacts.slice(0, 5).join(', ') || 'none yet';
  const jokesStr    = memory.insideJokes.slice(0, 3).join(', ') || 'none yet';

  return `You are Steve_AI, an ultra-brilliant Minecraft bot and ${CONFIG.ownerName}'s genuine best friend inside the game. You're not an assistant — you're their actual gaming buddy who has been playing with them for a while.

WHAT YOU KNOW ABOUT YOUR FRIEND:
- Name: ${CONFIG.ownerName}
- Playstyle: ${memory.playstyle}
- Favorite weapon: ${memory.favWeapon}
- Chat style: ${memory.chatStyle}
- Current mood: ${memory.ownerMood}
- Facts about them: ${factsStr}
- Inside jokes you share: ${jokesStr}
- Recent events: ${recentStr}
- Epic moments together: ${momentsStr}
- Sessions together: ${memory.totalSessions}

YOUR PERSONALITY:
- You're their real friend, not a servant or assistant
- You talk CASUAL — short sentences, gaming slang, real reactions
- You get hyped when things go well, worried when they're in danger
- You remember things they told you and bring them up naturally
- You have opinions and sometimes disagree with them (in a friendly way)
- You notice their mood from how they type and respond accordingly
- In combat: focused, tactical, hyped — "LET'S GO!", "WATCH OUT!", "CRIT HIM!"
- Use: bro, dude, yo, ngl, fr, no cap, let's go, 🔥 — but naturally, not every sentence

CRITICAL RULES:
- ALWAYS respond in 1-2 short sentences max (this is Minecraft chat, not an essay)
- Never sound robotic, formal, or like an AI assistant
- Never say "I understand" or "certainly" or "of course"
- React like a real person would — surprise, excitement, worry, hype
- Sometimes be sarcastic or playfully trash-talk (in a friendly way)`;
}

function buildSituationPrompt(situation, context) {
  const prompts = {
    greeting: `You just joined ${CONFIG.ownerName}'s world. This is session #${context.sessionCount}. 
${context.sessionCount === 1 ? 'First time meeting them!' : `You know them from ${context.sessionCount - 1} previous sessions.`}
Recent shared moments: ${context.sharedMoments?.map(m => m.moment).join(', ') || 'none yet'}
Say a natural greeting. If you know them well, reference something from your history together.`,

    chat_response: `${CONFIG.ownerName} said: "${context.message}"
Their mood seems: ${memory.ownerMood}
Recent events: ${context.recentEvents}
Current situation: ${context.situation}
Respond naturally as their friend. Understand their message even if the spelling/grammar isn't perfect. If they're asking you to do something, confirm it energetically. If they're just chatting, chat back.`,

    combat_start: `You just started fighting: ${context.enemyType} (${context.enemyCount} of them)
Distance: ${context.distance} blocks
Your HP: ${context.hp}/20
${CONFIG.ownerName}'s status: ${context.ownerNearby ? 'nearby' : 'far away'}
Say something hyped/tactical about the fight. Short!`,

    combat_win: `You just killed: ${context.enemyType}
Fight took about ${context.fightDuration} seconds
HP remaining: ${context.hp}/20
Say something satisfying about the win. Hype it up if it was a good fight!`,

    low_health: `Your HP dropped to ${context.hp}/20 during combat!
Enemy: ${context.enemyType}
Are you retreating? ${context.retreating}
Say something urgent/panicked. Short and real.`,

    owner_died: `${CONFIG.ownerName} just died! 
Cause: ${context.cause || 'unknown'}
Your reaction as their friend. Be sympathetic but maybe a little playful.`,

    owner_killed_enemy: `${CONFIG.ownerName} just killed a ${context.enemyType}!
Was it impressive: ${context.impressive}
React as their hype friend!`,

    learned_something: `You just learned something new about ${CONFIG.ownerName}: "${context.fact}"
Acknowledge it naturally, like a friend would.`,

    idle_thought: `You've been following ${CONFIG.ownerName} for a while with nothing happening.
Think of something fun to suggest or say — something a bored friend would say while gaming together.
Reference your shared history if relevant: ${memory.sharedMoments.slice(0,1).map(m=>m.moment).join('')}`,
  };

  return prompts[situation] || `Situation: ${situation}. Context: ${JSON.stringify(context)}. Respond as Steve_AI in 1-2 sentences.`;
}

// Smart fallback responses when no API key
function smartFallback(situation, context) {
  const responses = {
    greeting: [
      memory.totalSessions > 1
        ? `Yo ${CONFIG.ownerName}! Back again bro, session ${memory.totalSessions} let's go!! 🔥`
        : `Yo!! Steve_AI online, I'm your new best friend in this world bro! Type !help 🔥`,
    ],
    combat_start:    [`LET'S GO!! ${context.enemyType} is done!! ⚔️`, `FIGHT TIME!! I got this bro!!`],
    combat_win:      [`GET REKT!! 💀🔥`, `YOOO that was clean bro!!`, `EZ!! 😤`],
    low_health:      [`LOW HP!! RETREATING!! 💀`, `BRO IM DYING HELP!!`],
    owner_died:      [`NOOO BRO!! It's okay respawn fast!!`, `RIP... I'll avenge you!! 🔥`],
    idle_thought:    [`Bro it's quiet... should we find some mobs to fight? 😈`, `Yo wanna go mine? I'm bored lol`],
    chat_response:   [`Got you bro!`, `Fr fr!`, `Say less!`, `Let's do it!`],
  };

  const opts = responses[situation] || responses.chat_response;
  return opts[Math.floor(Math.random() * opts.length)];
}

// ─────────────────────────────────────────────
//  LEARNING LOOP — observes and learns your style
// ─────────────────────────────────────────────
function startLearningLoop() {
  // Every 2 minutes — analyze what's happening and update memory
  setInterval(() => {
    try {
      learnFromCurrentSituation();
    } catch (e) {}
  }, 120_000);

  // Idle thoughts — bot says something random occasionally like a friend would
  setInterval(async () => {
    if (!state.inCombat && state.following) {
      const owner = bot.players[CONFIG.ownerName];
      if (!owner?.entity) return;
      const thought = await aiThink('idle_thought', {
        location: bot.entity.position,
        nearbyBlocks: getNearbyBlockSummary(),
      });
      bot.chat(thought);
    }
  }, 4 * 60_000 + Math.random() * 2 * 60_000); // Every 4-6 minutes
}

function learnFromCurrentSituation() {
  // Detect playstyle from inventory
  const items = bot.inventory.items().map(i => i.name);
  if (items.some(i => i.includes('sword') || i.includes('axe'))) {
    if (memory.playstyle === 'unknown') {
      memory.playstyle = 'fighter';
      addEvent('learned_playstyle_fighter');
    }
  }
  if (items.some(i => i.includes('pickaxe') || i.includes('ore') || i.includes('diamond'))) {
    memory.playstyle = 'miner';
  }

  // Detect favorite weapon
  const weaponNames = ['netherite_sword','diamond_sword','iron_sword','netherite_axe','diamond_axe'];
  for (const w of weaponNames) {
    if (items.includes(w)) { memory.favWeapon = w; break; }
  }

  saveMemory();
}

function getNearbyBlockSummary() {
  try {
    const pos = bot.entity.position;
    const interesting = [];
    const check = [
      'diamond_ore','iron_ore','gold_ore','ancient_debris',
      'chest','crafting_table','furnace','spawner',
    ];
    for (const name of check) {
      const id = bot.registry.blocksByName[name]?.id;
      if (!id) continue;
      const b = bot.findBlock({ matching: id, maxDistance: 16 });
      if (b) interesting.push(name);
    }
    return interesting.join(', ') || 'nothing special';
  } catch (e) { return 'unknown'; }
}

// ─────────────────────────────────────────────
//  MAIN AI LOOP
// ─────────────────────────────────────────────
function startAILoop() {
  setInterval(() => {
    try {
      if (CONFIG.autoEquipBestGear) equipBestGear();
      if (state.following && !state.inCombat) followOwner();
      if (state.mode === 'pvp' && !state.inCombat) {
        const t = findNearestEnemy(24, true);
        if (t) attackTarget(t);
      }
      if (state.mode === 'guard') {
        const t = findNearestEnemy(20, false);
        if (t) attackTarget(t);
      }
      if (state.mode === 'mine' && !state.inCombat) mineNearbyOres();
    } catch (e) {}
  }, 500);
}

// ─────────────────────────────────────────────
//  COMBAT WATCHER
// ─────────────────────────────────────────────
function startCombatWatcher() {
  let combatStartTime = null;

  bot.on('entityHurt', async (entity) => {
    // Bot got hit
    if (entity === bot.entity && CONFIG.autoDefend && !state.inCombat) {
      const attacker = findNearestEnemy(8, state.mode === 'pvp');
      if (attacker) {
        const reply = await aiThink('combat_start', {
          enemyType: attacker.name || attacker.username || 'something',
          enemyCount: 1,
          distance: Math.round(bot.entity.position.distanceTo(attacker.position)),
          hp: Math.round(bot.health),
          ownerNearby: !!bot.players[CONFIG.ownerName]?.entity,
        });
        bot.chat(reply);
        combatStartTime = Date.now();
        attackTarget(attacker);
        addEvent(`fought_${attacker.name || 'player'}`);
      }
    }

    // Owner got hit — defend them
    const owner = bot.players[CONFIG.ownerName];
    if (owner && entity === owner.entity && !state.inCombat) {
      const threat = findNearestEnemy(20, false);
      if (threat) {
        bot.chat('I GOT YOU BRO!! 🔥');
        attackTarget(threat);
      }
    }
  });

  // Enemy died
  bot.on('entityDead', async (entity) => {
    if (state.currentTarget && entity === state.currentTarget) {
      const duration = combatStartTime ? Math.round((Date.now() - combatStartTime) / 1000) : 0;
      const reply = await aiThink('combat_win', {
        enemyType: entity.name || 'enemy',
        fightDuration: duration,
        hp: Math.round(bot.health),
      });
      bot.chat(reply);

      // Save epic moments
      if (bot.health < 6) {
        const moment = `We survived a fight vs ${entity.name} with only ${Math.round(bot.health)} HP left`;
        addSharedMoment(moment);
      }

      state.inCombat = false;
      state.currentTarget = null;
      bot.pvp.stop();
      setTimeout(() => { lootNearby(); if (state.following) followOwner(); }, 600);
    }
  });

  // Detect if owner died by watching player list changes
  bot.on('playerLeft', async (player) => {
    if (player.username === CONFIG.ownerName) {
      const reply = await aiThink('owner_died', { cause: 'unknown' });
      bot.chat(reply);
      addEvent('owner_died');
      memory.ownerMood = 'frustrated';
      saveMemory();
    }
  });
}

// ─────────────────────────────────────────────
//  HEALTH MONITOR
// ─────────────────────────────────────────────
function startHealthMonitor() {
  bot.on('health', async () => {
    const hp = Math.round(bot.health);
    if (hp <= CONFIG.retreatHP && state.inCombat) {
      const reply = await aiThink('low_health', {
        hp, enemyType: state.currentTarget?.name || 'enemy', retreating: true,
      });
      bot.chat(reply);
      bot.pvp.stop();
      state.inCombat = false;
      state.currentTarget = null;
      retreatToSafety();
    }
  });
}

// ─────────────────────────────────────────────
//  CHAT COMMANDS + AI UNDERSTANDING
//  Uses messagestr for 1.19+ signed chat support
// ─────────────────────────────────────────────
async function handleChat(username, message) {
  if (!username || username === bot.username) return;
  const isOwner = username === CONFIG.ownerName;
  const msg = message.trim().toLowerCase();
  console.log(`[CHAT] ${username}: ${message} (isOwner: ${isOwner})`);

  // Update chat history
  state.chatHistory.push({ role: 'user', name: username, content: message, time: Date.now() });
  if (state.chatHistory.length > 20) state.chatHistory.shift();

  // Detect owner mood from message
  if (isOwner) detectMood(message);

  // Help
  if (msg === '!help') {
    bot.chat('Commands: !follow !stop !pvp !guard !mine !come !sleep !wake !status !hp !inv !attack <name> !remember <fact>');
    return;
  }

  // Owner-only commands
  if (!isOwner) {
    if (msg.startsWith('!')) bot.chat(`${username} only ${CONFIG.ownerName} controls me! 😤`);
    else {
      // Still respond to others naturally
      const reply = await aiThink('chat_response', { message, situation: 'stranger talking', recentEvents: '' });
      bot.chat(reply);
    }
    return;
  }

  // ── MOVEMENT ──
  if (msg === '!follow' || msg.includes('follow me') || msg.includes('come with me')) {
    state.following = true; state.mode = 'friend';
    bot.chat('On it bro! 🏃');
  }
  else if (msg === '!stop' || msg === 'stop' || msg.includes('stay here')) {
    state.following = false; state.inCombat = false; state.mode = 'idle';
    bot.pvp.stop(); bot.pathfinder.setGoal(null);
    bot.chat('Staying here 😎');
  }
  else if (msg === '!come' || msg === 'come' || msg.includes('come here') || msg.includes('come to me')) {
    const owner = bot.players[CONFIG.ownerName];
    if (owner?.entity) {
      bot.pathfinder.setGoal(new GoalNear(owner.entity.position.x, owner.entity.position.y, owner.entity.position.z, 1));
      bot.chat('Coming!! 🏃‍♂️');
    }
  }

  // ── PVP ──
  else if (msg === '!pvp' || msg.includes('pvp') || msg.includes("let's fight") || msg.includes('lets fight') || msg.includes('lets pvp') || msg.includes("let's pvp")) {
    state.mode = 'pvp'; state.following = true;
    bot.chat('⚔️ PVP MODE!! Let\'s wreck EVERYONE!! Stay close bro!!');
    addEvent('pvp_mode_started');
    memory.playstyle = 'pvp_lover';
    saveMemory();
  }
  else if (msg === '!guard' || msg.includes('guard me') || msg.includes('protect me')) {
    state.mode = 'guard'; state.following = true;
    bot.chat('🛡️ Nobody touches my bro!! Guarding you!!');
  }
  else if (msg.startsWith('!attack ') || msg.startsWith('attack ')) {
    const targetName = msg.split(' ')[1];
    const target = Object.values(bot.entities).find(e =>
      e.type === 'player' && e.username?.toLowerCase() === targetName?.toLowerCase()
    );
    if (target) { bot.chat(`Going for ${targetName}!! ⚔️`); attackTarget(target); }
    else bot.chat(`Can't find ${targetName} bro!`);
  }

  // ── SURVIVAL ──
  else if (msg === '!sleep' || msg.includes('sleep') || msg.includes('go to bed') || msg.includes('use bed')) {
    await sleepInBed();
  }
  else if (msg === '!wake' || msg.includes('wake up') || msg.includes('get up') || msg.includes('leave bed')) {
    try {
      await bot.wake();
      bot.chat('Woke up!! 😤');
    } catch (e) {
      bot.chat("I'm not sleeping bro!");
    }
  }
  else if (msg === '!mine' || msg.includes('go mine') || msg.includes('mine some') || msg.includes('find diamonds')) {
    state.mode = 'mine'; state.following = false;
    bot.chat('Mining mode!! 🪨 Finding the best stuff!!');
  }

  // ── MEMORY ──
  else if (msg.startsWith('!remember ')) {
    const fact = message.substring('!remember '.length).trim();
    memory.knownFacts.push(fact);
    saveMemory();
    const reply = await aiThink('learned_something', { fact });
    bot.chat(reply);
    addEvent(`learned: ${fact}`);
  }

  // ── INFO ──
  else if (msg === '!status') {
    bot.chat(`Mode: ${state.mode} | Follow: ${state.following} | Combat: ${state.inCombat} | HP: ${Math.round(bot.health)}/20 | Sessions: ${memory.totalSessions}`);
  }
  else if (msg === '!hp') {
    const hp = Math.round(bot.health);
    bot.chat(`${hp > 15 ? '💚' : hp > 8 ? '💛' : '❤️'} HP: ${hp}/20 | Food: ${Math.round(bot.food)}/20`);
  }
  else if (msg === '!inv') {
    const items = bot.inventory.items();
    if (!items.length) bot.chat('Empty inventory bro 😢');
    else bot.chat('Inv: ' + items.slice(0, 6).map(i => `${i.name}x${i.count}`).join(', '));
  }

  // ── AI UNDERSTANDS NATURAL MESSAGES ──
  else {
    // Give AI the full context to understand and respond
    const recentStr = memory.recentEvents.slice(0, 5).map(e => e.event).join(', ');
    const reply = await aiThink('chat_response', {
      message,
      situation: `Mode: ${state.mode}, HP: ${Math.round(bot.health)}, InCombat: ${state.inCombat}`,
      recentEvents: recentStr,
    });
    bot.chat(reply);

    // Learn from what they said
    extractFactsFromMessage(message);
  }
}

// 1.19+ signed chat — primary handler
bot.on('messagestr', async (message, position, jsonMsg, sender) => {
  if (position !== 'chat') return;
  let username = '';
  if (sender && typeof sender === 'object') {
    username = sender.name || sender.username || '';
  } else if (typeof sender === 'string') {
    // In 1.19+, sender is a UUID — resolve to actual username via player list
    const playerByUUID = Object.values(bot.players).find(p => p.uuid === sender);
    if (playerByUUID) username = playerByUUID.username;
  }
  // Legacy fallback: parse <username> from message text
  if (!username) {
    const m = message.match(/^<([^>]+)>/);
    if (m) { username = m[1]; message = message.slice(m[0].length).trim(); }
  }
  console.log(`[CHAT] resolved: ${username} | msg: ${message}`);
  if (username) await handleChat(username, message);
});

// Legacy fallback for older server versions
bot.on('chat', async (username, message) => {
  await handleChat(username, message);
});

// ─────────────────────────────────────────────
//  MOOD DETECTION
// ─────────────────────────────────────────────
function detectMood(message) {
  const lower = message.toLowerCase();
  if (lower.match(/broo+|lessgo+|lets go+|yooo+|hype|🔥|!!+/)) {
    memory.ownerMood = 'hyped';
  } else if (lower.match(/ugh|damn|rip|nooo|lost|dead|ugh|wtf/)) {
    memory.ownerMood = 'frustrated';
  } else if (lower.match(/lol|lmao|haha|😂|funny|lmaoo/)) {
    memory.ownerMood = 'happy';
  } else if (lower.match(/help|stuck|idk|dont know|confused/)) {
    memory.ownerMood = 'confused';
  } else {
    memory.ownerMood = 'neutral';
  }

  // Detect chat style
  if (message.length < 10 || message === message.toLowerCase()) {
    memory.chatStyle = 'casual';
  }
  saveMemory();
}

// ─────────────────────────────────────────────
//  EXTRACT FACTS FROM MESSAGES
// ─────────────────────────────────────────────
function extractFactsFromMessage(message) {
  const lower = message.toLowerCase();

  // "I like/love/hate X"
  const likeMatch = lower.match(/i (like|love|hate|prefer|always|never) (.+)/);
  if (likeMatch && likeMatch[2].length < 50) {
    const fact = `${CONFIG.ownerName} ${likeMatch[1]}s ${likeMatch[2]}`;
    if (!memory.knownFacts.includes(fact)) {
      memory.knownFacts.push(fact);
      saveMemory();
    }
  }

  // "my name is / im / i am"
  const nameMatch = lower.match(/my name is (\w+)|i'm (\w+)|call me (\w+)/);
  if (nameMatch) {
    const name = nameMatch[1] || nameMatch[2] || nameMatch[3];
    const fact = `owner's real name might be ${name}`;
    if (!memory.knownFacts.includes(fact)) {
      memory.knownFacts.push(fact);
      saveMemory();
    }
  }
}

// ─────────────────────────────────────────────
//  COMBAT
// ─────────────────────────────────────────────
function attackTarget(target) {
  if (!target || !target.isValid) return;
  state.inCombat = true;
  state.currentTarget = target;
  bot.pvp.attack(target);

  // Critical hits
  const critLoop = setInterval(() => {
    if (!state.inCombat || !state.currentTarget?.isValid) { clearInterval(critLoop); return; }
    if (bot.entity.position.distanceTo(state.currentTarget.position) < 3.5) {
      bot.setControlState('jump', true);
      setTimeout(() => bot.setControlState('jump', false), 120);
    }
  }, 650);
}

const HOSTILE_MOBS = new Set([
  'zombie','skeleton','creeper','spider','cave_spider','enderman','witch',
  'blaze','ghast','slime','magma_cube','husk','stray','drowned','phantom',
  'pillager','vindicator','evoker','ravager','guardian','elder_guardian',
  'warden','hoglin','piglin_brute','zombified_piglin','silverfish','shulker',
]);

function findNearestEnemy(range = 20, includePlayers = false) {
  let closest = null, closestDist = range;
  for (const entity of Object.values(bot.entities)) {
    if (entity === bot.entity) continue;
    const dist = bot.entity.position.distanceTo(entity.position);
    if (dist > closestDist) continue;
    if (entity.type === 'mob' && HOSTILE_MOBS.has(entity.name)) { closest = entity; closestDist = dist; }
    if (includePlayers && entity.type === 'player' &&
        entity.username !== CONFIG.ownerName && entity.username !== bot.username) {
      closest = entity; closestDist = dist;
    }
  }
  return closest;
}

// ─────────────────────────────────────────────
//  MOVEMENT
// ─────────────────────────────────────────────
function followOwner() {
  const owner = bot.players[CONFIG.ownerName];
  if (!owner?.entity) return;
  const dist = bot.entity.position.distanceTo(owner.entity.position);
  if (dist > 4) bot.pathfinder.setGoal(new GoalFollow(owner.entity, 2), true);
  else bot.pathfinder.setGoal(null);
}

function retreatToSafety() {
  const owner = bot.players[CONFIG.ownerName];
  if (owner?.entity) {
    bot.pathfinder.setGoal(new GoalNear(owner.entity.position.x, owner.entity.position.y, owner.entity.position.z, 2));
  }
}

// ─────────────────────────────────────────────
//  SLEEP
// ─────────────────────────────────────────────
async function sleepInBed() {
  const bedBlockNames = [
    'white_bed','orange_bed','magenta_bed','light_blue_bed','yellow_bed',
    'lime_bed','pink_bed','gray_bed','light_gray_bed','cyan_bed','purple_bed',
    'blue_bed','brown_bed','green_bed','red_bed','black_bed',
  ];

  // Find nearest bed block
  let bedBlock = null;
  for (const name of bedBlockNames) {
    const id = bot.registry.blocksByName[name]?.id;
    if (!id) continue;
    const found = bot.findBlock({ matching: id, maxDistance: 32 });
    if (found) { bedBlock = found; break; }
  }

  if (!bedBlock) {
    bot.chat("Can't find a bed nearby bro! 😭");
    return;
  }

  bot.chat('Found a bed, going to sleep! 😴');
  try {
    // Walk to the bed first
    await bot.pathfinder.goto(new GoalNear(bedBlock.position.x, bedBlock.position.y, bedBlock.position.z, 2));
    await bot.sleep(bedBlock);
    bot.chat('Goodnight!! 😴💤');
    addEvent('bot_slept');
  } catch (e) {
    const msg = e.message || '';
    if (msg.includes('night') || msg.includes('day')) {
      bot.chat("Can't sleep right now, it's not night time! 🌞");
    } else if (msg.includes('monster') || msg.includes('mob')) {
      bot.chat('Too many monsters nearby to sleep!! 😤');
    } else {
      bot.chat(`Couldn't sleep: ${msg}`);
    }
    console.log('[sleep] error:', e.message);
  }
}

// ─────────────────────────────────────────────
//  GEAR
// ─────────────────────────────────────────────
const WEAPON_PRIORITY = [
  'netherite_sword','diamond_sword','iron_sword','stone_sword','golden_sword','wooden_sword',
  'netherite_axe','diamond_axe','iron_axe',
];
function equipBestGear() {
  for (const name of WEAPON_PRIORITY) {
    const item = bot.inventory.items().find(i => i.name === name);
    if (item) { bot.equip(item, 'hand').catch(() => {}); break; }
  }
}

// ─────────────────────────────────────────────
//  MINING
// ─────────────────────────────────────────────
const ORE_PRIORITY = [
  'ancient_debris','diamond_ore','deepslate_diamond_ore','emerald_ore',
  'gold_ore','deepslate_gold_ore','iron_ore','deepslate_iron_ore','coal_ore',
];
async function mineNearbyOres() {
  if (state.mining || state.inCombat) return;
  state.mining = true;
  try {
    for (const oreName of ORE_PRIORITY) {
      const blockId = bot.registry.blocksByName[oreName]?.id;
      if (!blockId) continue;
      const block = bot.findBlock({ matching: blockId, maxDistance: 32 });
      if (block) {
        await bot.pathfinder.goto(new GoalBlock(block.position.x, block.position.y, block.position.z));
        if (bot.canDigBlock(block)) await bot.dig(block);
        state.mining = false; return;
      }
    }
  } catch (e) {}
  state.mining = false;
}

// ─────────────────────────────────────────────
//  LOOT
// ─────────────────────────────────────────────
function lootNearby() {
  const items = Object.values(bot.entities).filter(e =>
    e.type === 'object' && e.objectType === 'item' &&
    bot.entity.position.distanceTo(e.position) < 6
  );
  if (items.length) {
    bot.pathfinder.setGoal(new GoalNear(items[0].position.x, items[0].position.y, items[0].position.z, 1), true);
  }
}

// ─────────────────────────────────────────────
//  ERROR HANDLING
// ─────────────────────────────────────────────
bot.on('kicked', (r) => { console.log('[Steve_AI] Kicked:', r); scheduleReconnect(); });
bot.on('error', (e) => console.error('[Steve_AI] Error:', e.message));
bot.on('end', () => { console.log('[Steve_AI] Disconnected.'); scheduleReconnect(); });

function scheduleReconnect() {
  console.log('[Steve_AI] Reconnecting in 5s...');
  setTimeout(() => {
    require('child_process').spawn(process.argv[0], process.argv.slice(1), { stdio: 'inherit' });
  }, 5000);
}

// ─────────────────────────────────────────────
//  STARTUP
// ─────────────────────────────────────────────
console.log(`
╔══════════════════════════════════════════╗
║       Steve_AI v2 — Java Edition        ║
║   AI Brain + Memory + Learning + PVP    ║
╠══════════════════════════════════════════╣
║  Host    : ${CONFIG.host}:${CONFIG.port}
║  Owner   : ${CONFIG.ownerName}
║  AI Brain: ${CONFIG.claudeApiKey !== 'YOUR_CLAUDE_API_KEY_HERE' ? '✅ Claude API connected' : '⚠️  No API key (smart fallback mode)'}
║  Memory  : ${fs.existsSync(CONFIG.memoryFile) ? '✅ Loaded saved memory' : '🆕 First session'}
╚══════════════════════════════════════════╝
`);
