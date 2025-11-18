/**
 * handler.js
 * CLEAN VERSION (readable)
 * Fenrys Bot — Handler & message utilities
 * Creator: Juna | cleaned 2025
 */

import chalk from "chalk";
import moment from "moment-timezone";
import fs from "fs";
import path from "path";
import PhoneNumber from "awesome-phonenumber";
import { fileTypeFromBuffer } from "file-type";

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
  getGroupAdmins,
} from "./lib/myfunc.js";

import {
  downloadContentFromMessage,
  generateWAMessageFromContent,
  generateWAMessageContent,
  proto,
} from "@whiskeysockets/baileys";

import {
  imageToWebp,
  videoToWebp,
  writeExifImg,
  writeExifVid,
  writeExif,
} from "./lib/exif.js";

import { listAutoResponder } from "./lib/list-responder.js";
import { startSewaWatcher } from "./lib/sewa.js";
import mainRouter from "./main.js"; // router for commands / plugin invocation

// Timezone
moment.tz.setDefault("Asia/Jakarta");

/**
 * Default export: main message handler
 * params:
 *  - conn: baileys socket instance
 *  - rawMessage: raw event message from baileys
 *  - store: local store (contacts, chats, etc.)
 */
export default async function handle(conn, rawMessage, store) {
  try {
    // normalize message (smsg is helper to serialize message)
    rawMessage = rawMessage?.message?.stanzaId ? rawMessage : rawMessage;
    const msg = conn.serializeM ? conn.serializeM(rawMessage) : smsg(conn, rawMessage, store);

    // ignore system/status messages
    if (!msg || msg.message === null || msg.key?.fromMe) return;

    // auto read / auto react to some settings (kept simple here)
    // If global.autoread is configured, mark as read (example)
    if (!msg.isGroup && global?.autoread) {
      try {
        await conn.readMessages([{
          remoteJid: msg.chat,
          id: msg.key?.id,
          participant: msg.key?.participant
        }]);
      } catch (e) { /* ignore */ }
    }

    // Logging: friendly console output
    const chatType = msg.isGroup ? "Group" : "Private";
    const senderName = await conn.getName(msg.sender);
    const time = moment().format("HH:mm:ss");
    console.log(chalk.cyan("\n─────────────── New Message ───────────────"));
    console.log(chalk.gray("• Time  :"), chalk.green(time));
    console.log(chalk.gray("• From  :"), chalk.yellow(senderName || msg.sender));
    console.log(chalk.gray("• Chat  :"), chalk.magenta(chatType), chalk.gray("(" + msg.chat + ")"));
    console.log(chalk.gray("• Type  :"), chalk.green(msg.type || "[UNKNOWN]"));
    console.log(chalk.cyan("───────────────────────────────────────────"));

    // run 'before' hooks (plugins that want to intercept)
    const handledByBefore = await runBeforeHooks(conn, msg);
    if (handledByBefore) return;

    // auto-responder (list based)
    const responded = await listAutoResponder(conn, msg);
    if (responded) return;

    // finally pass to main router (command/plugins)
    await mainRouter(conn, msg);

  } catch (err) {
    console.error("Handler error:", err);
  }
}

/* ================================
   UTILITY: runBeforeHooks
   Run global before-hooks (plugins that export 'before')
   Return true if any hook returned truthy (meaning message handled)
   ================================ */
async function runBeforeHooks(conn, msg) {
  let isAdmin = false;
  let isBotAdmin = false;

  // determine admin flags if group
  if (msg.isGroup) {
    try {
      const meta = await conn.groupMetadata(msg.chat);
      const participants = meta.participants || [];
      const admins = participants.filter(p => p.admin).map(p => p.id);

      isAdmin = admins.includes(msg.sender);
      const myId = conn.user?.id ? conn.decodeJid(conn.user.id) : "";
      isBotAdmin = admins.includes(myId);
    } catch (e) {
      // ignore
    }
  }

  // iterate global plugins and call 'before' if present
  for (const [key, plugin] of Object.entries(global.plugins || {})) {
    try {
      const beforeFn = plugin?.before;
      if (typeof beforeFn === "function") {
        const res = await beforeFn(conn, msg, {
          fenrys: conn,
          isAdmin,
          isBotAdmin,
        });
        if (res) return true; // handled
      }
    } catch (e) {
      console.error("Before hook error:", key, e);
    }
  }
  return false;
}

/* ================================
   Helper: getContactName
   - Accepts jid or phone string, returns readable name (from store or phone)
   ================================ */
export async function getContactName(conn, jidOrNumber, withoutContact = false) {
  const jid = conn.decodeJid ? conn.decodeJid(jidOrNumber) : jidOrNumber;
  const contact = store?.contacts?.[jid] || {};
  if (jid.endsWith("@s.whatsapp.net")) {
    if (!contact.name && !contact.verifiedName) {
      try {
        const meta = await conn.getNumber(jid);
        return meta?.name || PhoneNumber("+" + jid.replace("@s.whatsapp.net", "")).getNumber("international");
      } catch {
        return PhoneNumber("+" + jid.replace("@s.whatsapp.net", "")).getNumber("international");
      }
    }
    return contact.name || contact.verifiedName;
  }
  return contact.name || contact.verifiedName || PhoneNumber("+" + jid.replace("@s.whatsapp.net", "")).getNumber("international");
}

/* ================================
   FILE / MEDIA HELPERS
   - downloadAndSaveMediaMessage
   - downloadToBuffer
   - getFile (get metadata + buffer)
   ================================ */

/**
 * downloadAndSaveMediaMessage(conn, message, filenamePrefix)
 * Downloads content and saves to ./tmp/{filenamePrefix}.{ext}, returns filepath
 */
export async function downloadAndSaveMediaMessage(conn, message, filenamePrefix = "") {
  const msg = message.message ? message : message;
  const mtype = Object.keys(msg.message || {})[0];
  const stream = await downloadContentFromMessage(msg.message[mtype], mtype.replace("Message", ""));
  let buffer = Buffer.from([]);
  for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
  const fileType = await fileTypeFromBuffer(buffer);
  const ext = fileType?.ext || "bin";
  const tmpDir = "./tmp";
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const filepath = path.join(tmpDir, `${filenamePrefix || Date.now()}.${ext}`);
  fs.writeFileSync(filepath, buffer);
  return filepath;
}

/**
 * downloadToBuffer(conn, message)
 * returns Buffer of message media
 */
export async function downloadToBuffer(conn, message) {
  const msg = message.message ? message : message;
  const mtype = Object.keys(msg.message || {})[0];
  const stream = await downloadContentFromMessage(msg.message[mtype], mtype.replace("Message", ""));
  let buffer = Buffer.from([]);
  for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
  return buffer;
}

/**
 * getFile(source, saveIfNeeded = false)
 * Accepts:
 *  - Buffer
 *  - data: URI (data:...;base64,...)
 *  - URL (http(s)://)
 *  - local path
 *
 * Returns:
 *  { res, filename, ext, mime, size, data (Buffer) }
 */
export async function getFile(source, saveIfNeeded = false) {
  let res = null;
  let data = null;
  let filename = null;

  // Buffer
  if (Buffer.isBuffer(source)) {
    data = source;
  }
  // data URI
  else if (typeof source === "string" && /^data:.*?\/.*?;base64,/i.test(source)) {
    data = Buffer.from(source.split(",")[1], "base64");
  }
  // URL
  else if (typeof source === "string" && /^https?:\/\//.test(source)) {
    res = await fetch(source);
    const arrayBuf = await res.arrayBuffer();
    data = Buffer.from(arrayBuf);
  }
  // local file
  else if (typeof source === "string" && fs.existsSync(source)) {
    filename = source;
    data = fs.readFileSync(source);
  } else if (typeof source === "string") {
    // maybe raw text -> convert to buffer
    data = Buffer.from(source);
  } else {
    data = Buffer.from([]);
  }

  const type = (data && data.length) ? (await fileTypeFromBuffer(data)) : null;
  const mime = type?.mime || "application/octet-stream";
  const ext = type?.ext || "bin";
  const size = data ? data.length : 0;

  if (!filename && saveIfNeeded) {
    const tmpDir = "./tmp";
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    filename = path.join(tmpDir, `${Date.now()}.${ext}`);
    fs.writeFileSync(filename, data);
  }

  return {
    res,
    filename,
    ext,
    mime,
    size,
    data
  };
}

/* ================================
   SENDER UTILITIES
   All functions return the result of conn.sendMessage call (Baileys)
   - sendText
   - reply
   - sendImage
   - sendVideo
   - sendAudio
   - sendFile
   - sendSticker (from buffer/url/file)
   - sendImageAsSticker
   - sendButton (basic buttons message)
   - sendList (list message)
   - sendInteractive (generic viewOnce/buttons)
   ================================ */

/**
 * sendText(to, text, quoted?, options?)
 */
export async function sendText(to, text, quoted = null, options = {}) {
  return await conn.sendMessage(to, { text, ...options }, { quoted });
}

/**
 * reply(msg, text, options)
 * convenience wrapper to reply to the same chat as msg
 */
export async function reply(msg, text, quoted = msg, options = {}) {
  return await conn.sendMessage(msg.chat, { text, ...options }, { quoted });
}

/**
 * sendImage(to, src, caption = "", quoted = null, options = {})
 * src can be: buffer, dataURI, URL, filepath
 */
export async function sendImage(to, src, caption = "", quoted = null, options = {}) {
  const file = await getFile(src, true);
  return await conn.sendMessage(to, {
    image: file.data ? file.data : { url: file.filename },
    caption,
    ...options
  }, { quoted });
}

/**
 * sendVideo(to, src, caption = "", quoted = null, gifPlayback = false, options = {})
 */
export async function sendVideo(to, src, caption = "", quoted = null, gifPlayback = false, options = {}) {
  const file = await getFile(src, true);
  return await conn.sendMessage(to, {
    video: file.data ? file.data : { url: file.filename },
    caption,
    gifPlayback,
    ...options
  }, { quoted });
}

/**
 * sendAudio(to, src, quoted = null, ptt = false, options = {})
 */
export async function sendAudio(to, src, quoted = null, ptt = false, options = {}) {
  const file = await getFile(src, true);
  return await conn.sendMessage(to, {
    audio: file.data ? file.data : { url: file.filename },
    ptt,
    ...options
  }, { quoted });
}

/**
 * sendFile(to, src, filename = '', quoted = null, options = {})
 */
export async function sendFile(to, src, filename = "", quoted = null, options = {}) {
  const file = await getFile(src, true);
  const msg = {
    file: file.data ? file.data : { url: file.filename },
    fileName: filename || file.filename || (`file.${file.ext}`),
    mimetype: file.mime,
    ...options
  };
  return await conn.sendMessage(to, msg, { quoted });
}

/**
 * sendSticker(to, src, quoted = null, stickerOptions = {})
 * src: buffer/url/file, stickerOptions supports exif fields like packname/author
 */
export async function sendSticker(to, src, quoted = null, stickerOptions = {}) {
  const file = await getFile(src, true);
  // If webp -> send directly, else convert
  let webpFile;
  if (file.ext === "webp") {
    webpFile = file.filename || file.data;
  } else if (/^image\/|^video\//.test(file.mime)) {
    if (file.mime.startsWith("image/")) {
      webpFile = await imageToWebp(file.data);
    } else {
      webpFile = await videoToWebp(file.data);
    }
  } else {
    // fallback - try imageToWebp (may throw)
    webpFile = await imageToWebp(file.data);
  }

  // apply exif pack/author if requested
  if (stickerOptions?.packname || stickerOptions?.author) {
    if (stickerOptions.isVideo) {
      webpFile = await writeExifVid(webpFile, stickerOptions);
    } else {
      webpFile = await writeExifImg(webpFile, stickerOptions);
    }
  }

  return await conn.sendMessage(to, { sticker: { url: webpFile }, ...stickerOptions }, { quoted });
}

/**
 * sendImageAsSticker(to, src, quoted = null, options = {})
 * convenience wrapper
 */
export async function sendImageAsSticker(to, src, quoted = null, options = {}) {
  options.isVideo = false;
  return await sendSticker(to, src, quoted, options);
}

/* ================================
   INTERACTIVE MESSAGES (buttons / list)
   Basic wrappers to create and send interactive messages
   ================================ */

export async function sendButtons(to, text, footer, buttons = [], quoted = null, options = {}) {
  // buttons: [{buttonId, buttonText:{displayText}, type}]
  const message = {
    text,
    footer,
    buttons,
    ...options
  };
  return await conn.sendMessage(to, message, { quoted });
}

export async function sendList(to, title, description, buttonText, sections = [], quoted = null, options = {}) {
  const listMessage = {
    title,
    description,
    buttonText,
    sections,
    ...options
  };
  return await conn.sendMessage(to, { listMessage }, { quoted });
}

/* ================================
   Helper: sendInteractiveGeneric
   Build complex interactive message using generateWAMessageFromContent
   ================================ */

export async function sendInteractiveGeneric(to, bodyText, footerText = "", buttons = [], quoted = null, extra = {}) {
  // build a buttonsMessage using WA proto helpers
  const buttonMessage = proto.Message.fromObject({
    buttonsMessage: {
      contentText: bodyText,
      footerText: footerText || global.footer || "",
      buttons: buttons.map(b => proto.ButtonsButton.fromObject({
        buttonId: b.id,
        buttonText: { displayText: b.text },
        type: 1
      })),
      headerType: 1
    }
  });

  const waMsg = await generateWAMessageFromContent(to, { buttonsMessage: buttonMessage.buttonsMessage }, { quoted });
  await conn.relayMessage(to, waMsg.message, { messageId: waMsg.key?.id });
  return waMsg;
}

/* ================================
   EXPORTED setup(conn, store)
   - attach helpers to conn object for easier usage throughout project
   ================================ */

export function setup(conn, store) {
  // attach serializer (if not exists)
  if (!conn.serializeM) conn.serializeM = msg => smsg(conn, msg, store);

  // attach helpers so other modules can call like conn.sendText(...)
  conn.getName = async (jid, withoutContact = false) => getContactName(conn, jid, withoutContact);

  conn.downloadAndSaveMediaMessage = async (msg, filenamePrefix = "") => downloadAndSaveMediaMessage(conn, msg, filenamePrefix);
  conn.downloadToBuffer = async msg => downloadToBuffer(conn, msg);
  conn.getFile = async (src, saveIfNeeded = false) => getFile(src, saveIfNeeded);

  conn.sendText = async (to, text, quoted = null, opts = {}) => sendText(to, text, quoted, opts);
  conn.reply = async (msg, text, quoted = msg, opts = {}) => reply(msg, text, quoted, opts);

  conn.sendImage = async (to, src, caption = "", quoted = null, opts = {}) => sendImage(to, src, caption, quoted, opts);
  conn.sendVideo = async (to, src, caption = "", quoted = null, gifPlayback = false, opts = {}) => sendVideo(to, src, caption, quoted, gifPlayback, opts);
  conn.sendAudio = async (to, src, quoted = null, ptt = false, opts = {}) => sendAudio(to, src, quoted, ptt, opts);
  conn.sendFile = async (to, src, filename = "", quoted = null, opts = {}) => sendFile(to, src, filename, quoted, opts);

  conn.sendSticker = async (to, src, quoted = null, stickerOptions = {}) => sendSticker(to, src, quoted, stickerOptions);
  conn.sendImageAsSticker = async (to, src, quoted = null, options = {}) => sendImageAsSticker(to, src, quoted, options);

  conn.sendButtons = async (to, text, footer, buttons = [], quoted = null, options = {}) => sendButtons(to, text, footer, buttons, quoted, options);
  conn.sendList = async (to, title, description, buttonText, sections = [], quoted = null, options = {}) => sendList(to, title, description, buttonText, sections, quoted, options);
  conn.sendInteractiveGeneric = async (to, bodyText, footerText = "", buttons = [], quoted = null, extra = {}) => sendInteractiveGeneric(to, bodyText, footerText, buttons, quoted, extra);

  // start sewa watcher (rental watcher) using provided util
  try {
    startSewaWatcher(conn, { intervalMs: 5000 });
  } catch (e) { /* ignore */ }
}

/* ================================
   Auto-reload support for this file (for dev)
   ================================ */
const file = import.meta.url;
try {
  fs.watchFile(new URL(file), () => {
    fs.unwatchFile(new URL(file));
    console.log(chalk.green("🔄 Update " + file));
    process.exit(0);
  });
} catch (e) {
  // environments that don't support watchFile can ignore
}