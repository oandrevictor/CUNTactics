# HEXFALL

HEXFALL is a deterministic, turn-based fantasy board battler. Recruit champions, combine matching copies, shape trait bonds, arrange a formation on an 8×6 board, and play through a ten-round campaign.

## Play locally

```bash
npm install
npm run dev
```

Open the local address printed by the development server.

## Game systems

- Gold economy with shop purchases, refreshes, base income, interest, and streak bonuses
- Commander XP, levels, and increasing deployment capacity
- Champion XP, levels, three-copy star upgrades, and stat scaling
- Seven team traits that modify real combat calculations
- Eight champions with distinct targeting rules and mana abilities
- Deterministic turn-by-turn combat with movement, attacks, shields, healing, mana, defeat, and playback controls
- Device-local campaign persistence

## Verification

```bash
npm test
```

The test suite builds the Cloudflare-compatible worker, verifies the rendered game surface, and exercises the seeded game engine’s economy, placement, progression, traits, abilities, combat, and round resolution.
