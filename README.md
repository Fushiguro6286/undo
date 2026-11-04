# Undo

**Agents are buying from your store. When one goes wrong, who's at fault?**

Undo compares what the person approved on PayPal (the Intent Record, hashed into the order's `custom_id`), what the PayPal order says was bought, and what actually arrived (a photo with a one-time challenge code). A deterministic fault engine decides who is at fault (merchant, carrier, agent, buyer or unclear), the merchant's own policy produces the allowed remedies, and money moves only through the PayPal sandbox.

Live demo (PayPal sandbox only): https://undo-nu.vercel.app

> Full README (architecture, PayPal APIs, AI models, setup, judge mode) lands on Day 12.

## Use Claude Desktop as the buyer's agent (MCP)

Undo runs an MCP server at `https://undo-nu.vercel.app/mcp` (streamable HTTP, no login). It has five tools:

| Tool | What it does |
|---|---|
| `propose_purchase(request)` | Turns "sky-blue tee, size M, under $35, by Friday" into limits and lists matching items |
| `get_approval_link(mode, limits, cart / agent_pick_sku)` | Creates the PayPal order and returns PayPal's approval URL. Consent happens only on PayPal |
| `open_claim(order_id, type, description)` | Returns a one-time challenge code and a photo upload link |
| `claim_status(claim_id)` | The fault ruling and the remedies the store's rules allow |
| `choose_remedy(claim_id, option_id, amount?)` | Picks one rule-made remedy; invented options or amounts are rejected |

No tool can approve a purchase, record consent or move money directly.

### Option A: custom connector (simplest)

1. Claude Desktop → **Settings → Connectors → Add custom connector**.
2. Name: `Undo`. URL: `https://undo-nu.vercel.app/mcp`. Save, and enable it in a chat.

### Option B: config file (needs Node.js 18+)

Claude Desktop → **Settings → Developer → Edit Config**, then add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "undo": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://undo-nu.vercel.app/mcp"]
    }
  }
}
```

Restart Claude Desktop. The tools appear under the tools icon in a new chat.

### Try it

1. "Buy me a sky-blue tee, size M, under $35, by Friday. I want to approve the exact item." → open the approval link, log in with a sandbox buyer account, approve.
2. Or: "Use my agent budget: up to $35 for a blue tee, size M, by Friday, and pick it yourself." (DELEGATED: you approve the ceiling and limits; the agent's pick is bought at its real price.)
3. "The tee arrived in navy. Open a claim." → open the upload link, photograph the item with the code written on paper (sample photos: `/samples/wrong-color.jpg`).
4. "What are my options?" → "Take the keep-it refund."

## License

MIT
