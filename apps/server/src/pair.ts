// Prints a code for pairing another computer with the server running here: npm run pair
import os from 'node:os'
import { PORT, accessToken } from './config.ts'

const res = await fetch(`http://127.0.0.1:${PORT}/api/pairing`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken()}` } }).catch(() => null)
if (!res?.ok) {
  console.error(`The OpenKumi server is not running on port ${PORT}. Start it with "npm run server".`)
  process.exit(1)
}
const { code } = await res.json()
const addresses = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => `${i!.address}:${PORT}`)
console.log(`\n  Pairing code:  ${code}`)
console.log(`  Address:       ${addresses.join('  or  ') || '(this computer is not on a network)'}`)
console.log('\n  In the OpenKumi app on the other computer: Settings > Environments > Add environment.')
console.log('  The code works once, for the next 10 minutes.\n')
