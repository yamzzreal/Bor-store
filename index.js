/* ============================================================
   FENRYS BOT — INDEX CLEAN VERSION
   Creator: Juna | 2025
============================================================ */

import "./settings.js";
import fs from "fs-extra";
import path from "path";
import chalk from "chalk";
import pino from "pino";
import NodeCache from "node-cache";
import readline from "readline";
import PhoneNumber from "awesome-phonenumber";
import { Boom } from "@hapi/boom";

import {
  generateProfilePicture,
  removeEmojis,
  smsg,
  sleep,
  runtime,
  fetchJson,
  getBuffer,
  parseMention,
  getRandom,
  getGroupAdmins
} from "./lib/myfunc.js";

import {
  makeWASocket,
  Browsers,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  jidDecode
} from "@whiskeysockets/baileys";

import { setup } from "./handler.js";
import { preflightPlugins } from "./main.js";

// ===============================
// Basic Settings
// ===============================
const sessionName = "session";
const usePairingCode = true;

// ===============================
// Simple Data Store (Contacts & Chats)
// ===============================
function createLiteStore() {
  const data = {
    contacts: {},
    chats: {}
  };

  return {
    get contacts() {
      return data.contacts;
    },

    bind(socket) {
      socket.ev.on("messages.upsert", (messages = []) => {
        for (const msg of messages) {
          const jid = msg.id || msg.jid;
          if (!jid) continue;

          data.contacts[jid] = {
            ...(data.contacts[jid] || {}),
            ...msg
          };
        }
      });

      socket.ev.on("contacts.update", (updates = []) => {
        for (const u of updates) {
          const jid = u.id || u.jid;
          if (!jid) continue;

          data.contacts[jid] = {
            ...(data.contacts[jid] || {}),
            ...u
          };
        }
      });
    },

    readFromFile(file) {
      try {
        const json = fs.readJsonSync(file);
        Object.assign(data, json);
      } catch { }
    },

    writeToFile(file) {
      try {
        fs.writeJsonSync(file, data, { spaces: 2 });
      } catch { }
    }
  };
}

const store = createLiteStore();

// ===============================
// Start Bot
// ===============================
async function startFenrys() {
  console.log(chalk.cyan("🔄 Starting Fenrys Bot..."));

  await preflightPlugins();

  const { state, saveCreds } = await useMultiFileAuthState("./" + sessionName);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: pino({ level: "silent" }),
    printQRInTerminal: !usePairingCode,
    browser: Browsers.ubuntu("Chrome"),
    auth: state,
    msgRetryCounterCache: new NodeCache()
  });

  store.bind(sock.ev);
  setup(sock);

  // Pairing code
  if (usePairingCode && !sock.authState.creds.registered) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const ask = q => new Promise(res => rl.question(q, res));

    console.log(chalk.magenta("\nMasukkan nomor WhatsApp (contoh: 628xxxxx)"));
    const phone = await ask("Nomor: ");
    const code = await sock.requestPairingCode(phone, global.botName);

    console.log(chalk.green("\n✅ Kode pairing: " + chalk.bold(code) + "\n"));
    rl.close();
  }

  sock.ev.on("creds.update", saveCreds);

  // Decode JID
  sock.decodeJid = jid => {
    if (!jid) return jid;
    if (/:\d+@/gi.test(jid)) {
      const decoded = jidDecode(jid) || {};
      if (decoded.user && decoded.server) {
        return decoded.user + "@" + decoded.server;
      }
      return jid;
    }
    return jid;
  };

  // Contact update
  sock.ev.on("contacts.update", updates => {
    for (const u of updates) {
      const jid = sock.decodeJid(u.id);
      if (!jid) continue;

      store.contacts[jid] = {
        ...(store.contacts[jid] || {}),
        id: jid,
        name: u.verifiedName || store.contacts[jid]?.name || jid
      };
    }
  });

  sock.getName = async (jid, withoutTag = false) => {
    const id = sock.decodeJid(jid);

    const contact = store.contacts[id] || {};
    if (id.endsWith("@s.whatsapp.net")) {
      if (!contact.name && !contact.verifiedName) {
        const meta = await sock.getNumber(id).catch(() => ({}));
        return meta?.name || PhoneNumber("+" + id.replace("@s.whatsapp.net", "")).getNumber("international");
      }
      return contact.name || contact.verifiedName;
    }

    return contact.name || contact.verifiedName || PhoneNumber("+" + jid.replace("@s.whatsapp.net", "")).getNumber("international");
  };

  console.log(chalk.green("\n============== " + global.botName + " =============="));
  console.log(chalk.yellow("Mode     :"), chalk.green(usePairingCode ? "Pairing" : "QR"));
  console.log(chalk.yellow("Hot Reload:"), chalk.green("ON"));
  console.log(chalk.green("============================================\n"));

  // Connection handler
  sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
    if (connection === "open") {
      console.log(chalk.green("✅ Connected to WhatsApp!\n"));
    } else if (connection === "close") {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      console.log(chalk.red(`❌ Connection closed (${code}), restarting...`));
      await sleep(2000);
      startFenrys();
    }
  });

  // Message handler
  sock.ev.on("messages.upsert", async ({ messages }) => {
    for (const msg of messages || []) {
      if (!msg.message) continue;
      if (msg.message?.conversation === "status@broadcast") continue;

      const { default: handler } = await import("./handler.js");
      handler(sock, msg, store);
    }
  });
}

startFenrys();

// Auto Reload
const file = import.meta.url;
fs.watchFile(new URL(file), () => {
  fs.unwatchFile(new URL(file));
  console.log(chalk.green("🔄 Update " + file));
  process.exit(0);
});