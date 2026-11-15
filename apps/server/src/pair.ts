// Prints a code for pairing another computer with the server running here: npm run pair
// (On a server installed on its own, the same thing is "openkumi pair".)
process.argv.splice(2, 0, 'pair')
await import('./cli.ts')

export {}
