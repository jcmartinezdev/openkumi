// One server for a person's data. A second one started on it would, before it found the port
// taken, tidy up after a stop that never happened: mark what the first is still doing as stopped,
// and take the changes its bots are making for ones made while no server ran. So this is asked
// before anything else of the server is loaded, the database above all: index.ts loads this first.
import { DATABASE, PERSON, openElsewhere, people } from './config.ts'

if (openElsewhere(DATABASE)) {
  console.error(`\n  ${people().length > 1 ? `${PERSON}’s OpenKumi server` : 'The OpenKumi server'} is already running on this computer: its data is open. This one was not started.\n`)
  process.exit(1)
}
