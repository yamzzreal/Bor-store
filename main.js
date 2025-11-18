/* ============================================================
   FENRYS BOT — MAIN CLEAN VERSION
   Creator: Juna | 2025
============================================================ */

import fs from "fs";
import path, { join } from "path";
import syntaxError from "syntax-error";
import chalk from "chalk";
import { getGroupAdmins } from "./lib/myfunc.js";

const PLUGIN_DIR = "./plugins";
const JS = f => /\.js$/i.test(f);

global.plugins ||= {};

// ===============================
// PRELOAD PLUGINS (CHECK SYNTAX)
// ===============================
export async function preflightPlugins({
  verbose = true,
  failFast = true
} = {}) {
  const start = Date.now();
  let loaded = 0;
  let errors = 0;

  const ok = x => chalk.green(x);
  const bad = x => chalk.red(x);
  const info = x => chalk.cyan(x);

  const importFresh = async file =>
    import(path.resolve(file).replace(/\\/g, "/") + "?check=" + Date.now());

  async function scan(dir) {
    if (!fs.existsSync(dir)) return;

    for (const file of fs.readdirSync(dir)) {
      const full = join(dir, file);
      const stat = fs.statSync(full);

      if (stat.isDirectory()) {
        await scan(full);
      } else if (stat.isFile() && JS(file)) {
        const err = syntaxError(fs.readFileSync(full), file, {
          sourceType: "module",
          allowAwaitOutsideFunction: true
        });

        if (err) {
          errors++;
          if (verbose) console.log(bad("✗ " + full + " — " + err));
          if (failFast) return;
          continue;
        }

        try {
          const mod = await importFresh(full);
          const plugin = mod.default;

          if (!plugin || (typeof plugin !== "function" && typeof plugin !== "object")) {
            throw new Error("export default invalid");
          }

          const hasCommand = typeof plugin?.command !== "undefined";
          const hasBefore = typeof plugin?.before === "function";

          if (!hasCommand && !hasBefore) {
            throw new Error('missing "command" or "before"');
          }

          loaded++;
          if (verbose) console.log(ok("✓ " + full));
        } catch (e) {
          errors++;
          if (verbose) console.log(bad("✗ " + full + " — ImportError: " + e.message));
          if (failFast) return;
        }
      }
    }
  }

  if (verbose) console.log(info(`\n🔍 Preflight scan "${PLUGIN_DIR}"\n`));

  await scan(PLUGIN_DIR);

  const ms = Date.now() - start;

  if (verbose) {
    console.log("\n──────── SUMMARY ────────");
    console.log("Loaded :", loaded);
    console.log("Errors :", errors);
    console.log("Time   :", ms + " ms");
    console.log("─────────────────────────\n");
  }

  return { ok: errors === 0, loaded, errors, ms };
}

// ===============================
// AUTO LOAD PLUGINS
// ===============================
async function importFresh(file) {
  return import(path.resolve(file).replace(/\\/g, "/") + "?update=" + Date.now());
}

async function loadPlugin(file) {
  try {
    const mod = await importFresh(file);
    global.plugins[file] = mod.default;
  } catch {
    delete global.plugins[file];
  }
}

async function loadAllRecursive(dir = PLUGIN_DIR) {
  if (!fs.existsSync(dir)) return;

  for (const file of fs.readdirSync(dir)) {
    const full = join(dir, file);
    const stat = fs.statSync(full);

    if (stat.isDirectory()) {
      await loadAllRecursive(full);
    } else if (JS(file)) {
      await loadPlugin(full);
    }
  }
}

await loadAllRecursive();

// Watch plugin folder for changes
fs.watch(PLUGIN_DIR, { recursive: true }, async (event, filename) => {
  if (!JS(filename)) return;

  const full = join(PLUGIN_DIR, filename);
  const resolved = path.resolve(full).replace(/\\/g, "/");

  if (!fs.existsSync(full)) {
    delete global.plugins[resolved];
    console.log(chalk.redBright("- Removed " + filename));
    return;
  }

  let data;
  try {
    data = fs.readFileSync(full);
  } catch (e) {
    if (e.code === "ENOENT") {
      delete global.plugins[resolved];
      return;
    }
    throw e;
  }

  const err = syntaxError(data, filename, {
    sourceType: "module",
    allowAwaitOutsideFunction: true
  });

  if (err) {
    console.log(chalk.red("✗ Syntax error " + filename + "\n" + err));
    return;
  }

  await loadPlugin(full);
  console.log(chalk.green("✓ Reloaded " + filename));
});

// ===============================
// Route / Command Handler
// ===============================
function pickBody(msg) {
  return (
    msg?.text ||
    msg?.message?.conversation ||
    msg?.message?.extendedTextMessage?.text ||
    msg?.message?.imageMessage?.caption ||
    msg?.message?.videoMessage?.caption ||
    ""
  );
}

export default async function router(conn, msg) {
  const text = pickBody(msg);
  if (!text) return;

  const [cmd, ...args] = text.trim().split(/\s+/);
  const command = (cmd || "").toLowerCase();
  const chat = msg.chat;
  const isGroup = chat?.endsWith("@g.us");

  // Match plugin
  const plugin = Object.values(global.plugins).find(p => {
    const cmd = p?.command;

    if (cmd instanceof RegExp) return cmd.test(command);
    if (Array.isArray(cmd)) {
      return cmd.some(x =>
        x instanceof RegExp ? x.test(command) : String(x).toLowerCase() === command
      );
    }
    return typeof cmd === "string" && cmd.toLowerCase() === command;
  });

  if (!plugin) return;

  const metadata = msg.isGroup ? await conn.groupMetadata(chat).catch(() => ({})) : {};
  const participants = msg.isGroup ? metadata.participants || [] : [];
  const admins = msg.isGroup ? getGroupAdmins(participants) : [];

  const extractJID = str => {
    if (typeof str !== "string") return "";
    const match = str.match(/(\d{5,})/);
    return match ? match[1] + "@s.whatsapp.net" : "";
  };

  const sender = extractJID(msg.sender);
  const bot = extractJID(conn.user?.id || "");
  const senderIsAdmin = msg.isGroup ? admins.includes(sender) : false;
  const botIsAdmin = msg.isGroup ? admins.includes(bot) : false;

  const realJid =
    msg.key?.participant ||
    msg.key?.participantAlt ||
    msg.key?.remoteJid ||
    msg.key?.remoteJidAlt;

  const decodedBot = await conn.decodeJid(conn.user.id);
  const isBotOwner = [decodedBot, ...global.ownerNumber]
    .map(x => x.replace(/[^0-9]/g, "") + "@s.whatsapp.net")
    .includes(realJid);

  if (plugin.owner && !isBotOwner) {
    return conn.sendMessage(chat, { text: global.mess.creator }, { quoted: msg });
  }

  if (plugin.group && !isGroup) {
    return conn.sendMessage(chat, { text: global.mess.group }, { quoted: msg });
  }

  if (plugin.admin && !senderIsAdmin) {
    return conn.sendMessage(chat, { text: global.mess.admin }, { quoted: msg });
  }

  if (plugin.botAdmin && !botIsAdmin) {
    return conn.sendMessage(chat, { text: global.mess.botAdmin }, { quoted: msg });
  }

  const ctx = {
    fenrys: conn,
    conn,
    args,
    text: args.join(" "),
    participants,
    command
  };

  try {
    if (typeof plugin === "function") {
      await plugin.call(conn, msg, ctx);
    } else if (typeof plugin?.default === "function") {
      await plugin.default.call(conn, msg, ctx);
    } else {
      await plugin?.call?.(conn, msg, ctx);
    }
  } catch (e) {
    console.error("Plugin error:", e);
    await conn.sendMessage(chat, { text: "⚠️ Terjadi kesalahan." }, { quoted: msg });
  }
}

// Auto Reload for main.js
const file = import.meta.url;
fs.watchFile(new URL(file), () => {
  fs.unwatchFile(new URL(file));
  console.log(chalk.green("🔄 Update " + file));
  process.exit(0);
});