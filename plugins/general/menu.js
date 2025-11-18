import fs from 'fs'
import chalk from 'chalk'

let handler = async (m, { fenrys }) => {
  const pluginCount = Object.keys(global.plugins).length
  const featureCount = Object.values(global.plugins)
    .map(p => p.help?.length || 0)
    .reduce((a, b) => a + b, 0)

  const uptime = clockString(process.uptime())
  const ram = (process.memoryUsage().rss / 1024 / 1024).toFixed(0) + 'MB'

  let txt = `
╭───❏  ${global.botName}  ❏───╮
│👤 Owner   : ${global.ownerName}
│📞 Contact : wa.me/${global.ownerNumber[0]}
│📦 Plugins : ${pluginCount}
│💡 Features: ${featureCount}
│🟢 Mode    : ${global.mode ? 'Public' : 'Self'}
│⏱ Uptime  : ${uptime}
│💾 RAM     : ${ram}
╰────────────────────────────╯

Halo @${m.sender.split("@")[0]}, berikut fitur yang tersedia di ${global.botName}.

📚 Daftar Perintah
`

  const categories = {}
  for (const plugin of Object.values(global.plugins)) {
    const tag = plugin.tags?.[0] || 'other'
    const cmds = plugin.help || []
    if (!categories[tag]) categories[tag] = []
    cmds.forEach(cmd => categories[tag].push(cmd))
  }

  for (const [tag, cmds] of Object.entries(categories)) {
    if (cmds.length === 0) continue 
    txt += `\n🎯 ${tag.toUpperCase()} (${cmds.length})\n`
    txt += cmds.map(c => `  ↳ ${c}`).join('\n')
  }

  await fenrys.sendMessage(
    m.chat,
    {
      text: txt,
      contextInfo: { mentionedJid: [m.sender] }
    },
    { quoted: m }
  )
}

function clockString(sec) {
  sec = Math.floor(sec)
  const h = String(Math.floor(sec / 3600)).padStart(2, '0')
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0')
  const s = String(sec % 60).padStart(2, '0')
  return `${h}:${m}:${s}`
}

handler.help = ['menu', 'help']
handler.tags = ['general']
handler.command = /^(menu|help)$/i

export default handler