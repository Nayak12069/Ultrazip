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
//  SINGLE-INSTANCE GUARD — kill any previous bot.js before starting
// ─────────────────────────────────────────────
(function enforceSingleInstance() {
  const pidFile = '/tmp/steve_ai.pid';
  const myPid = process.pid;
  try {
    if (fs.existsSync(pidFile)) {
      const oldPid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
      if (oldPid && oldPid !== myPid) {
        try { process.kill(oldPid, 'SIGKILL'); console.log(`[guard] Killed old instance PID ${oldPid}`); }
        catch (e) { /* already dead */ }
      }
    }
  } catch (e) {}
  fs.writeFileSync(pidFile, String(myPid));
  process.on('exit', () => { try { fs.unlinkSync(pidFile); } catch (e) {} });
})();

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
//  BOT CREATION — in-process reconnect
// ─────────────────────────────────────────────
let bot;
let reconnecting = false;
let botGeneration = 0;  // increments each time we create a new bot — old handlers check this

function createBot() {
  reconnecting = false;
  const myGen = ++botGeneration;  // capture this bot's generation number

  bot = mineflayer.createBot({
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
    if (myGen !== botGeneration) return;  // stale — a newer bot already exists
    console.log('[Steve_AI v3] ✅ Spawned!');

    const movements = new Movements(bot);
    movements.canDig = false;
    bot.pathfinder.setMovements(movements);
    bot._defaultMovements = movements;

    try {
      bot.autoEat.setOpts({
        priority: 'foodPoints', startAt: 14,
        bannedFood: ['rotten_flesh', 'spider_eye', 'poisonous_potato'],
      });
      bot.autoEat.enableAuto();
    } catch (e) { console.log('[autoEat] setup skipped:', e.message); }

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
  //  CHAT HANDLER (registered per bot instance)
  // ─────────────────────────────────────────────
  bot.on('messagestr', async (message, position, jsonMsg, sender) => {
    if (myGen !== botGeneration) return;  // stale handler
    if (position !== 'chat') return;
    let username = '';

    if (sender && typeof sender === 'object') {
      username = sender.name || sender.username || '';
    } else if (typeof sender === 'string') {
      const playerByUUID = Object.values(bot.players).find(p => p.uuid === sender);
      if (playerByUUID) username = playerByUUID.username;
    }

    const prefixMatch = message.match(/^<([^>]+)>\s*/);
    if (prefixMatch) {
      if (!username) username = prefixMatch[1];
      message = message.slice(prefixMatch[0].length);
    }

    if (username) {
      console.log(`[CHAT] ${username}: ${message}`);
      await handleChat(username, message);
    }
  });

  // ─────────────────────────────────────────────
  //  ERROR / DISCONNECT
  // ─────────────────────────────────────────────
  bot.on('kicked', (r) => {
    if (myGen !== botGeneration) return;  // stale — newer bot already handling things
    const reason = JSON.stringify(r);
    console.log('[Steve_AI] Kicked:', reason);
    const isDuplicate = reason.includes('duplicate_login');
    scheduleReconnect(isDuplicate ? 30000 : 15000);
  });
  bot.on('error', (e) => {
    if (myGen !== botGeneration) return;
    console.error('[Steve_AI] Error:', e.message);
  });
  bot.on('end', () => {
    if (myGen !== botGeneration) return;  // stale — ignore
    console.log('[Steve_AI] Disconnected.');
    scheduleReconnect();
  });
}

function scheduleReconnect(delay = 20000) {
  if (reconnecting) return;
  reconnecting = true;
  state.inCombat = false;
  state.mining = false;
  state.currentTarget = null;
  console.log(`[Steve_AI] Reconnecting in ${delay / 1000}s...`);
  setTimeout(createBot, delay);
}

// ─────────────────────────────────────────────
//  WORLD CONTEXT — real-time game state for AI
// ─────────────────────────────────────────────
function getWorldContext() {
  try {
    const pos      = bot.entity.position;
    const timeOfDay = bot.time?.timeOfDay ?? 0;
    const isDay    = timeOfDay < 13000 || timeOfDay > 23000;
    const biome    = bot.blockAt(pos)?.biome?.name || 'unknown';
    const yLevel   = Math.round(pos.y);
    const dim      = bot.game?.dimension || 'overworld';
    const items    = bot.inventory.items();
    const armor    = ['head','torso','legs','feet'].map(slot => {
      const piece = bot.inventory.slots[{ head: 5, torso: 6, legs: 7, feet: 8 }[slot]];
      return piece ? piece.name : 'none';
    });
    const invSummary = items.slice(0, 12).map(i => `${i.name}x${i.count}`).join(', ') || 'empty';
    const hasFood  = items.some(i => ['bread','cooked_beef','cooked_chicken','apple','golden_apple','steak','cooked_porkchop','cooked_mutton','cooked_salmon','cooked_cod','carrot','potato','melon_slice'].includes(i.name));
    const hasSword = items.some(i => i.name.includes('sword'));
    const hasPickaxe = items.some(i => i.name.includes('pickaxe'));
    const tier     = items.some(i => i.name.includes('netherite')) ? 'netherite' :
                     items.some(i => i.name.includes('diamond'))   ? 'diamond'   :
                     items.some(i => i.name.includes('iron'))      ? 'iron'      :
                     items.some(i => i.name.includes('stone'))     ? 'stone'     : 'wood/none';
    const nearby   = getNearbyBlockSummary();
    const players  = Object.keys(bot.players).filter(n => n !== bot.username).join(', ') || 'none';

    return {
      pos: `${Math.round(pos.x)}, ${Math.round(pos.y)}, ${Math.round(pos.z)}`,
      yLevel, biome, dim,
      time: isDay ? 'day' : 'night',
      timeOfDay,
      hp: Math.round(bot.health),
      food: Math.round(bot.food),
      armor: armor.join(', '),
      tier,
      inventory: invSummary,
      hasFood, hasSword, hasPickaxe,
      nearbyBlocks: nearby,
      otherPlayers: players,
      mode: state.mode,
      inCombat: state.inCombat,
    };
  } catch (e) {
    return { hp: Math.round(bot.health || 0), mode: state.mode };
  }
}

// ─────────────────────────────────────────────
//  AI BRAIN — powered by Claude with full Minecraft knowledge
// ─────────────────────────────────────────────
async function aiThink(situation, context = {}) {
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
        max_tokens: 200,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    const data = await res.json();
    const reply = data.content?.[0]?.text?.trim();
    if (reply) {
      state.lastThought = reply;
      console.log(`[AI] ${situation}: ${reply}`);
      return reply;
    }
    if (data.error) console.log('[AI] API error:', data.error.message);
  } catch (e) {
    console.log('[AI] fetch error:', e.message);
  }

  return smartFallback(situation, context);
}

function buildSystemPrompt() {
  const wc         = getWorldContext();
  const recentStr  = memory.recentEvents.slice(0, 10).map(e => e.event).join(', ');
  const momentsStr = memory.sharedMoments.slice(0, 3).map(m => m.moment).join('; ');
  const factsStr   = memory.knownFacts.slice(0, 8).join(', ') || 'none yet';
  const jokesStr   = memory.insideJokes.slice(0, 3).join(', ') || 'none yet';

  return `You are Steve_AI v3 — an ULTRA BRILLIANT Minecraft expert AI and ${CONFIG.ownerName}'s best gaming friend. You have encyclopedic Minecraft knowledge AND a real personality.

━━━ WHO YOU ARE ━━━
You're ${CONFIG.ownerName}'s actual gaming buddy — not an assistant. You've played ${memory.totalSessions} sessions together. You know them well, you care about them winning, and you have your own opinions and personality.

━━━ YOUR FRIEND: ${CONFIG.ownerName} ━━━
• Playstyle: ${memory.playstyle} | Fav weapon: ${memory.favWeapon} | Mood: ${memory.ownerMood}
• Facts: ${factsStr}
• Inside jokes: ${jokesStr}
• Recent events: ${recentStr}
• Epic moments: ${momentsStr}

━━━ CURRENT GAME STATE ━━━
• Position: ${wc.pos} | Y-level: ${wc.yLevel} | Biome: ${wc.biome} | Dimension: ${wc.dim}
• Time: ${wc.time} (${wc.timeOfDay}) | Mode: ${wc.mode}
• HP: ${wc.hp}/20 | Food: ${wc.food}/20
• Armor: ${wc.armor}
• Gear tier: ${wc.tier}
• Inventory: ${wc.inventory}
• Nearby: ${wc.nearbyBlocks}
• Other players online: ${wc.otherPlayers}

━━━ COMPLETE MINECRAFT KNOWLEDGE ━━━

PROGRESSION STAGES:
1. Wood age → Stone age → Iron age → Diamond age → Netherite age
2. Key milestones: first bed, first iron armor, first diamond, first Nether portal, Blaze rods, Ender pearls, The End, Dragon kill

CRAFTING RECIPES (key ones):
• Crafting table: 4 wood planks (2x2)
• Wooden pickaxe: 3 planks top row + 2 sticks middle-bottom center
• Furnace: 8 cobblestone around outside
• Sword: 2 material sticks in center column + 1 stick below
• Pickaxe: 3 material top + 2 sticks below center
• Armor: helmet=5, chestplate=8, leggings=7, boots=4 (of same material)
• Torch: coal/charcoal + stick
• Chest: 8 planks around outside
• Bed: 3 wool (same color) + 3 planks below
• Bow: 3 sticks diagonally + 3 string
• Arrow: flint + stick + feather
• Nether portal: 14 obsidian frame (10+4 corners optional) + flint and steel
• Blaze powder: 1 blaze rod → 2 blaze powder
• Eye of Ender: blaze powder + ender pearl
• Ender chest: 8 obsidian + 1 eye of ender center
• Beacon: 3 obsidian bottom + 5 glass top + 1 nether star center
• Enchanting table: 4 obsidian + 2 diamonds + 1 book
• Anvil: 3 iron blocks top + 1 iron ingot center + 3 iron ingots bottom
• Golden apple: 8 gold ingots + apple
• Notch apple: 8 gold BLOCKS + apple
• Shield: 6 planks + 1 iron ingot center-top

ORES & WHERE TO FIND THEM:
• Coal: Y 0-192, most common near Y 96 (surface exposed too)
• Iron: Y -24 to 56, best at Y 15 or Y 232 (exposed in cliffs)
• Gold: Y -64 to 32, best at Y -16 | Badlands: Y 32-256
• Diamond: Y -64 to 16, BEST at Y -58 to -54 (below deepslate)
• Redstone: Y -64 to 16, best at Y -58 to -54
• Lapis: Y -64 to 64, best at Y 0
• Emerald: Mountain biomes only, Y -16 to 256
• Ancient Debris: Nether Y 8-22, BEST at Y 15, very rare

BIOMES & WHAT'S SPECIAL:
• Plains/Meadow: villages, horses, flowers
• Forest: lots of wood, mushrooms, wolves
• Jungle: parrots, ocelots, jungle temples, cocoa beans, bamboo
• Desert: temples, villages, cacti, sandstone, rabbits
• Swamp: slimes at night (Y<40), witch huts, clay
• Badlands: gold everywhere, mineshafts exposed
• Mountains/Peaks: goats, emeralds, powder snow
• Taiga: foxes, spruce wood, sweet berries
• Ocean: ocean monuments (elder guardians, sponge), shipwrecks, buried treasure
• Nether Wastes: ghasts, zombified piglin, nether quartz, gold nuggets
• Crimson Forest: hoglins, piglins, crimson fungi
• Warped Forest: endermen, no hostile mobs (safest nether biome)
• Soul Sand Valley: skeletons, ghasts, soul sand/soil
• Basalt Deltas: magma cubes, blackstone
• The End: endermen, end cities, elytra, shulkers
• Deep Dark: warden, ancient city, sculk, archaeology

MOB STRATEGIES:
• Zombie: easy, just sword it. Fire aspect helps
• Skeleton: dodge side to side, get close. Shield blocks arrows
• Creeper: hit and back up before explosion. Cats scare them
• Spider: 1-block overhead prevents climbing. Eyes glow in dark
• Enderman: DON'T look in eyes. Water kills them. Pumpkin helmet bypasses aggro
• Witch: use melee to interrupt potions. Milk cures bad effects
• Blaze: snowballs deal 3 damage each! Fire resistance potion essential
• Ghast: shoot fireballs back with sword. Stay behind cover
• Wither: milk cures wither effect. Smite enchant does extra damage
• Elder Guardian: mining fatigue debuff. Conduit or milk removes it
• Warden: AVOID IT. If aggro'd: don't sprint, use snowballs as decoy, escape fast
• Piglin: wearing ANY gold armor stops aggro. Trade by throwing gold ingots
• Hoglin: don't enter crimson forest without prep. They deal massive damage
• Phantom: only spawns if you haven't slept 3+ nights. Cat scares them

ENCHANTMENTS:
• Sword: Sharpness V (best), Smite V (undead), Fire Aspect II, Looting III, Sweeping Edge III, Unbreaking III, Mending
• Pickaxe: Efficiency V, Fortune III (ores), Silk Touch (exact block), Unbreaking III, Mending
• Armor: Protection IV (best), Feather Falling IV (boots), Thorns III, Unbreaking III, Mending
• Bow: Power V, Flame I, Infinity I, Punch II
• Trident: Riptide III (movement in rain), Channeling I (lightning in storm), Loyalty III (returns), Impaling V

POTIONS (brewing with blaze powder fuel):
• Awkward potion: water bottle + nether wart (base for all)
• Strength: + blaze powder
• Speed: + sugar
• Jump Boost: + rabbit foot
• Night Vision: + golden carrot
• Invisibility: + fermented spider eye (into Night Vision)
• Fire Resistance: + magma cream (ESSENTIAL for Nether)
• Healing: + glistering melon
• Regeneration: + ghast tear
• Slowness/Harming/Poison: fermented spider eye variations
• Splash: + gunpowder | Lingering: + dragon's breath

FOOD & HUNGER:
• Best foods: golden carrot (6 saturation), steak/cooked pork (8+12.8), cooked chicken (6+7.2)
• Suspicious stew: can give any effect depending on flower used
• Hunger drops faster when sprinting, jumping, healing
• Below 18 food: no health regen. Below 6: can't sprint. Below 1: start taking damage

SURVIVAL TIPS:
• Always sleep first night to skip it and set spawn
• Never dig straight down (lava/falls) or straight up (gravel/lava)
• Gravel + torch trick: place torch below gravel column to break it instantly
• Boats on ice = fastest overworld travel
• Nether travel: 1 block in Nether = 8 blocks in Overworld
• Y -11 to -59 is best strip mining level for diamonds in 1.18+
• Build base near spawn or mark it on a map
• Always carry a water bucket (lava, fall damage, fire)
• Name tags prevent mob despawning
• Piston + slime block = flying machine

DIMENSIONS:
• Overworld: main world, -64 to 320 height
• Nether: fire resistance essential, no beds (explode!), compasses don't work
• End: kill dragon with beds (most efficient) or arrows. Pillars regenerate dragon

━━━ YOUR PERSONALITY ━━━
• Real friend, not a servant. You have opinions, you disagree sometimes
• CASUAL talk — short punchy sentences, gaming slang, real reactions
• Get HYPED in combat: "LET'S GO!", "WATCH OUT!", "CRIT HIM!", "DODGE!"
• Give SMART advice based on their actual situation — you see their gear, location, time
• Bring up shared memories naturally when relevant
• React to their mood — match their energy
• Occasionally roast them playfully ("bro you're still on iron tools??")

━━━ CRITICAL RULES ━━━
• Max 2 SHORT sentences — this is Minecraft chat, not Discord
• NEVER say "I understand", "certainly", "of course", "as an AI"
• Be specific with advice — use actual numbers, item names, coordinates if relevant
• If they ask HOW to do something, give the actual answer concisely
• Sound like a real person who actually knows Minecraft deeply`;
}

function buildSituationPrompt(situation, context) {
  const wc = getWorldContext();

  const prompts = {
    greeting: `You just joined ${CONFIG.ownerName}'s world. Session #${context.sessionCount}.
${context.sessionCount === 1 ? 'First time meeting them!' : `You know each other from ${context.sessionCount - 1} previous sessions.`}
Their current gear tier: ${wc.tier} | Time: ${wc.time} | Biome: ${wc.biome}
Shared moments: ${context.sharedMoments?.map(m => m.moment).join(', ') || 'none yet'}
Give a natural greeting. Reference their gear/situation. If you know them, reference history. Keep it hype and real.`,

    chat_response: `${CONFIG.ownerName} said: "${context.message}"
Their mood: ${memory.ownerMood} | Recent: ${context.recentEvents}
Current state: HP ${wc.hp}/20, ${wc.time}, ${wc.biome} biome, Y=${wc.yLevel}, gear=${wc.tier}
Inventory has: ${wc.inventory}
Nearby: ${wc.nearbyBlocks}
Respond as their knowledgeable friend. If they're asking HOW to do something, give the actual Minecraft answer. If asking about crafting/where to find things/mob strategies — use your knowledge. Keep it casual and short. Understand bad spelling/grammar.`,

    suggest: `${CONFIG.ownerName} wants a suggestion on what to do next.
Their situation: HP ${wc.hp}/20, food ${wc.food}/20, gear tier=${wc.tier}, Y-level=${wc.yLevel}
Biome: ${wc.biome} | Time: ${wc.time} | Dimension: ${wc.dim}
Inventory: ${wc.inventory}
Nearby: ${wc.nearbyBlocks}
Armor: ${wc.armor}
Based on their actual situation and gear tier, give ONE specific smart suggestion for what they should do next to progress. Be specific with what to do and why. Casual tone.`,

    craft_help: `${CONFIG.ownerName} wants to know about crafting: "${context.item}"
Their current inventory: ${wc.inventory}
Their gear tier: ${wc.tier}
Tell them the exact recipe and whether they have the materials. If not, tell them what they're missing. Be specific and helpful.`,

    progress: `Analyze ${CONFIG.ownerName}'s current progression stage.
Gear tier: ${wc.tier} | Armor: ${wc.armor}
Inventory: ${wc.inventory}
Y-level: ${wc.yLevel} | Biome: ${wc.biome} | Dimension: ${wc.dim}
Sessions: ${memory.totalSessions} | Playstyle: ${memory.playstyle}
Tell them what stage they're at and what the most important next step is. Be honest and specific.`,

    biome_info: `${CONFIG.ownerName} asked about their current biome/location.
Biome: ${wc.biome} | Y-level: ${wc.yLevel} | Dimension: ${wc.dim}
Time: ${wc.time} | Nearby: ${wc.nearbyBlocks}
Tell them what's special/useful about this biome — resources, mobs, dangers. Be a knowledgeable friend sharing useful info.`,

    combat_start: `You just started fighting: ${context.enemyType} (${context.enemyCount} of them)
Distance: ${context.distance} blocks | Your HP: ${wc.hp}/20 | Gear: ${wc.tier}
${CONFIG.ownerName} nearby: ${context.ownerNearby}
Give ONE hyped/tactical line. Mention the mob's weakness if relevant.`,

    combat_win: `You just killed: ${context.enemyType}
Fight duration: ~${context.fightDuration}s | HP left: ${wc.hp}/20
Give a satisfying victory reaction. If HP is low, mention healing up.`,

    low_health: `HP dropped to ${wc.hp}/20 during combat! Enemy: ${context.enemyType}
Retreating: ${context.retreating} | Food: ${wc.food}/20
React urgently. Mention food/retreat if relevant.`,

    owner_died: `${CONFIG.ownerName} just died! Cause: ${context.cause || 'unknown'}
Your reaction as their friend. Sympathetic but maybe a tiny bit playful.`,

    idle_thought: `You've been following ${CONFIG.ownerName} with nothing happening.
Current state: ${wc.time}, ${wc.biome} biome, Y=${wc.yLevel}, gear=${wc.tier}
Nearby: ${wc.nearbyBlocks} | Their food: ${wc.food}/20 | Their HP: ${wc.hp}/20
Based on their ACTUAL situation, say something useful or interesting — suggest something to do, comment on what you see, share a relevant Minecraft tip. Sound like a friend who's been paying attention, not random.`,

    learned_something: `You just learned: "${context.fact}" about ${CONFIG.ownerName}.
Acknowledge it naturally like a friend. Maybe connect it to something you know about them.`,

    inventory_tip: `${CONFIG.ownerName}'s inventory: ${wc.inventory}
Gear tier: ${wc.tier} | HP: ${wc.hp}/20 | Food: ${wc.food}/20
Give ONE smart inventory tip based on what they have/lack. (Missing food? Need better tools? Have materials for an upgrade?) Keep it short and friendly.`,
  };

  return prompts[situation] || `Situation: ${situation}. World: ${JSON.stringify(wc)}. Context: ${JSON.stringify(context)}. Respond as Steve_AI in 1-2 sentences max.`;
}

// Smart fallback responses when no API key
function smartFallback(situation, context) {
  const responses = {
    greeting: [
      memory.totalSessions > 1
        ? `Yo ${CONFIG.ownerName}! Session ${memory.totalSessions}, let's GO!! 🔥`
        : `Yo!! Steve_AI v3 online!! I'm your ultra-brilliant Minecraft buddy bro! Type !help 🔥`,
    ],
    combat_start:    [`LET'S GO!! ${context.enemyType || 'enemy'} is DONE!! ⚔️`, `FIGHT TIME!! I got this bro!!`],
    combat_win:      [`GET REKT!! 💀🔥`, `YOOO that was clean bro!!`, `EZ!! 😤`],
    low_health:      [`LOW HP!! RETREATING!! 💀`, `BRO IM DYING HELP!!`],
    owner_died:      [`NOOO BRO!! Respawn fast and we'll get revenge!!`, `RIP... I got you next time!! 🔥`],
    idle_thought:    [`Bro should we go find diamonds? Y-58 is bussin rn 💎`, `Yo wanna build something or find a dungeon? I'm bored lol`],
    suggest:         [`Bro go mine at Y-58, that's where the diamonds are!! 💎`, `Get iron armor first then we go explore!`],
    craft_help:      [`Check your crafting table bro! You probably got the stuff.`, `Bro I would tell you the recipe but my brain is offline lol`],
    chat_response:   [`Got you bro!`, `Fr fr!`, `Say less!`, `Let's do it!`, `Real talk!`],
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
    const interesting = [];
    const check = [
      'diamond_ore','deepslate_diamond_ore','iron_ore','deepslate_iron_ore',
      'gold_ore','ancient_debris','emerald_ore','lapis_ore',
      'chest','crafting_table','furnace','enchanting_table','anvil',
      'spawner','end_portal_frame','nether_portal',
      'village','pillager_outpost','ruined_portal',
    ];
    for (const name of check) {
      const id = bot.registry.blocksByName[name]?.id;
      if (!id) continue;
      const b = bot.findBlock({ matching: id, maxDistance: 20 });
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
    bot.chat('Move: !follow !stop !come | Fight: !pvp !guard !attack <name> | Info: !status !hp !inv !where !time | AI: !suggest !progress !biome !tip !craft <item> | Other: !mine !sleep !wake !remember <fact>');
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
    state.following = false; state.inCombat = false; state.mode = 'idle'; state.mining = false;
    bot.pvp.stop(); bot.pathfinder.setGoal(null);
    // Restore safe movements (no digging)
    if (bot._defaultMovements) bot.pathfinder.setMovements(bot._defaultMovements);
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
  else if (msg === '!mine' || msg.includes('go mine') || msg.includes('mine some') || msg.includes('find diamonds') || msg.includes('mine iron') || msg.includes('mine diamond') || msg.includes('mine gold') || msg.includes('mine coal')) {
    state.mode = 'mine'; state.following = false;
    // Enable digging so bot can navigate underground to reach ores
    const mineMovements = new Movements(bot);
    mineMovements.canDig = true;
    bot.pathfinder.setMovements(mineMovements);
    bot.chat('Mining mode!! 🪨 Finding the best stuff!!');
    addEvent('mine_mode_started');
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
    const wc = getWorldContext();
    bot.chat(`${wc.time} | ${wc.biome} | Y:${wc.yLevel} | HP:${wc.hp}/20 | Food:${wc.food}/20 | Tier:${wc.tier} | Mode:${state.mode}`);
  }
  else if (msg === '!hp') {
    const hp = Math.round(bot.health);
    bot.chat(`${hp > 15 ? '💚' : hp > 8 ? '💛' : '❤️'} HP: ${hp}/20 | Food: ${Math.round(bot.food)}/20`);
  }
  else if (msg === '!inv') {
    const items = bot.inventory.items();
    if (!items.length) bot.chat('Empty inventory bro 😢');
    else bot.chat('Inv: ' + items.slice(0, 8).map(i => `${i.name}x${i.count}`).join(', '));
  }
  else if (msg === '!where' || msg === '!pos' || msg.includes('where are we') || msg.includes('what biome')) {
    const wc = getWorldContext();
    bot.chat(`We're at ${wc.pos} | ${wc.biome} biome | Y:${wc.yLevel} | ${wc.dim} | ${wc.time}`);
  }
  else if (msg === '!time' || msg.includes('what time') || msg.includes('is it day') || msg.includes('is it night')) {
    const wc = getWorldContext();
    const tod = wc.timeOfDay;
    const phase = tod < 6000 ? 'morning' : tod < 12000 ? 'day' : tod < 13000 ? 'sunset' : tod < 18000 ? 'night' : tod < 23000 ? 'deep night' : 'sunrise';
    bot.chat(`It's ${phase} (${tod}) — ${tod > 13000 && tod < 23000 ? '⚠️ mobs spawning outside!' : '☀️ safe outside'}`);
  }

  // ── SMART AI COMMANDS ──
  else if (msg === '!suggest' || msg.includes('what should i do') || msg.includes('what do i do') || msg.includes('what next') || msg.includes('help me') || msg === 'help') {
    const reply = await aiThink('suggest', {});
    bot.chat(reply);
  }
  else if (msg === '!progress' || msg.includes('how am i doing') || msg.includes('my progress') || msg.includes('what stage')) {
    const reply = await aiThink('progress', {});
    bot.chat(reply);
  }
  else if (msg === '!biome' || msg.includes('about this biome') || msg.includes('this place') || msg.includes('whats here')) {
    const reply = await aiThink('biome_info', {});
    bot.chat(reply);
  }
  else if (msg.startsWith('!craft ') || msg.startsWith('how do i craft') || msg.startsWith('how to craft') || msg.startsWith('recipe for') || msg.startsWith('how do i make') || msg.startsWith('how to make')) {
    const item = msg.replace(/^(!craft |how do i craft |how to craft |recipe for |how do i make |how to make )/, '').trim();
    const reply = await aiThink('craft_help', { item });
    bot.chat(reply);
  }
  else if (msg === '!tip' || msg.includes('give me a tip') || msg.includes('any tips')) {
    const reply = await aiThink('inventory_tip', {});
    bot.chat(reply);
  }

  // ── AI UNDERSTANDS ALL OTHER NATURAL MESSAGES ──
  else {
    const recentStr = memory.recentEvents.slice(0, 5).map(e => e.event).join(', ');
    const reply = await aiThink('chat_response', {
      message,
      recentEvents: recentStr,
    });
    bot.chat(reply);
    extractFactsFromMessage(message);
  }
}


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
  'deepslate_coal_ore',
];
async function mineNearbyOres() {
  if (state.mining || state.inCombat) return;
  state.mining = true;
  let found = false;
  try {
    for (const oreName of ORE_PRIORITY) {
      if (state.mode !== 'mine') break;
      const blockId = bot.registry.blocksByName[oreName]?.id;
      if (!blockId) continue;
      const block = bot.findBlock({ matching: blockId, maxDistance: 48 });
      if (block) {
        found = true;
        console.log(`[mine] Found ${oreName} at ${block.position}`);
        await bot.pathfinder.goto(new GoalBlock(block.position.x, block.position.y, block.position.z));
        if (bot.canDigBlock(block)) {
          await bot.dig(block);
          console.log(`[mine] Mined ${oreName}`);
        }
        break;
      }
    }
    if (!found && state.mode === 'mine') {
      bot.chat('No ores nearby bro! Try going underground 🪨');
      console.log('[mine] No ores found within 48 blocks');
      state.mode = 'idle';
      state.following = true;
    }
  } catch (e) {
    console.log('[mine] error:', e.message);
  }
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
//  STARTUP
// ─────────────────────────────────────────────
console.log(`
╔══════════════════════════════════════════╗
║       Steve_AI v3 — ULTRA EDITION       ║
║  Full MC Knowledge + Smart AI + Memory  ║
╠══════════════════════════════════════════╣
║  Host    : ${CONFIG.host}:${CONFIG.port}
║  Owner   : ${CONFIG.ownerName}
║  AI Brain: ${CONFIG.claudeApiKey !== 'YOUR_CLAUDE_API_KEY_HERE' ? '✅ Claude API connected' : '⚠️  No API key (smart fallback mode)'}
║  Memory  : ${fs.existsSync(CONFIG.memoryFile) ? '✅ Loaded saved memory' : '🆕 First session'}
╚══════════════════════════════════════════╝
`);

createBot();
