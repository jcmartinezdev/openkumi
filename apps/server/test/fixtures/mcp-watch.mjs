// An MCP server over stdio for the tests of watches: a list of items kept in a file the test
// rewrites, a tool that reads it and says it only reads, and one that adds to it and does not.
// Usage: mcp-watch.mjs <file>. The file holds what `list_items` gives back; `{"fail": "why"}` in it
// makes the tool fail, and text that is not JSON is given back as it is.
import fs from 'node:fs'
import readline from 'node:readline'

const file = process.argv[2]
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n')
const none = { type: 'object', properties: {} }

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  if (msg.id === undefined) return // a notification
  const { id, method, params } = msg
  if (method === 'initialize') {
    send({ id, result: { protocolVersion: params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'shelf', version: '1.0.0' } } })
  } else if (method === 'tools/list') {
    send({
      id,
      result: {
        tools: [
          { name: 'list_items', description: 'List the items on the shelf', inputSchema: { type: 'object', properties: { shelf: { type: 'string' } } }, annotations: { readOnlyHint: true } },
          { name: 'add_item', description: 'Put an item on the shelf', inputSchema: none },
          // Says nothing about itself: the superpower's manifest lists it as one that only reads.
          { name: 'count_items', description: 'Count the items on the shelf', inputSchema: none },
        ],
      },
    })
  } else if (method === 'tools/call') {
    const text = fs.readFileSync(file, 'utf8')
    let failure
    try {
      failure = JSON.parse(text).fail
    } catch {
      // Not JSON: given back as it is.
    }
    if (failure) send({ id, result: { isError: true, content: [{ type: 'text', text: failure }] } })
    else if (params.name === 'count_items') send({ id, result: { content: [{ type: 'text', text: String((JSON.parse(text).items ?? []).length) }] } })
    else send({ id, result: { content: [{ type: 'text', text }] } })
  } else if (method === 'ping') {
    send({ id, result: {} })
  } else {
    send({ id, error: { code: -32601, message: `Method not found: ${method}` } })
  }
})
