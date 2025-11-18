import fs from 'fs'
import chalk from 'chalk'

/* ============== BOT INFO ============== */
global.mode = true // true = public, false = self
global.autoread = true
global.gcOnly = false
global.pairing = 'YAMZZOFC'

global.ownerNumber = ['628567858991']
global.ownerName = 'YamzzOfficial'
global.botName = 'Yamz Bot Store'

/* ============== KEY CASHIFY ============== */
// Ambil apikey di web https://cashify.my.id/
global.cashifyLicenseKey = 'cashify_2aac2c8e7324765b7642c06c045973f7ab74d1a94a686e52f0ad8077b94090d5' 
global.cashifyQrisId = 'cb7e0bad-4845-449c-b22c-7e9d93e256b6'

/* ============== MESSAGE ============== */
global.mess = {
  success: '✅ Success!',
  admin: '[ !! ] *Access Denied*\nFeature For Admins Only',
  botAdmin: '[ !! ] *Access Denied*\nBot Must Be Admins',
  creator: '[ !! ] *Access Denied*\nFeature For Owner Only',
  group: '[ !! ] *Access Denied*\nFeature For Group Only',
  private: '[ !! ] *Access Denied*\nFeature For Private Only',
  wait: '⏳In Proces Please Wait',
  error: '[ !! ] *Error Please Report Owner*'
}

/* ============== AUTO RELOAD ============== */
const file = new URL(import.meta.url).pathname
fs.watchFile(file, () => {
fs.unwatchFile(file)
console.log(chalk.redBright(`🔄 settings.js updated`))
import(`${import.meta.url}?update=${Date.now()}`)
})