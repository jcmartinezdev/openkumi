#!/usr/bin/env node
// Stands in for Tailscale's own program in tests: `status --json` says this computer is on a tailnet.
if (process.argv[2] === 'status') {
  console.log(JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'test-mac.tail0000.ts.net.', TailscaleIPs: ['100.101.102.103', 'fd7a:115c:a1e0::1'] } }))
}
