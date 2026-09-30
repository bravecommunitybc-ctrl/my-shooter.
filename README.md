# Vantage

Browser-based tactical 5v5 first-person shooter with bots: rounds, bomb plant/defuse, economy.
Everything is original: the map *Quarry*, weapons (Hornet P9, Kestrel AR-7, Longbow SR, Talon),
procedural textures and synthesised audio.

```bash
npm install && npm run dev
```

Open http://localhost:5173 and click **Играть**.

| Key | Action |
| --- | --- |
| WASD | move |
| Mouse | aim / fire, RMB: scope (Longbow) or heavy stab (Talon) |
| Shift | walk (silent) |
| Ctrl / C | crouch (C works everywhere; Ctrl+W can close the tab outside fullscreen) |
| Space | jump |
| R | reload |
| 1 / 2 / 3, Q | weapons, last weapon |
| B | buy menu |
| E (hold) | plant / defuse |
| Tab | scoreboard |
| Esc | pause and settings |

Rules: 1:55 rounds, 15 s buy phase, the Pulse Charge detonates 40 s after the plant,
defusing takes 10 s (5 s with a kit), first to 13 wins, sides swap after round 12.

See `CLAUDE.md` for the architecture.
