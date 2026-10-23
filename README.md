# Stickupkids

A top-down tactical heist game set on a British estate at night. You plan a raid on a blueprint of the house, draw each crew member's route, sync them with go codes, then watch it play out in real time with pause.

This is the first playable slice, built in [Babylon.js](https://www.babylonjs.com/) with TypeScript and Vite. One job (a mid-terrace on the Harrow Road estate), four crew, four enemies, placeholder low-poly geometry.

## Play it

```sh
npm install
npm run dev
```

Then open http://localhost:5173. Chrome, Edge, Firefox and Safari all work; it needs WebGL.

To build a static copy for any web host: `npm run build`, then serve the `dist` folder (`npm run preview` does this locally). Once GitHub Pages is switched on (Settings > Pages > Source: GitHub Actions), every push to `main` publishes the game there.

## How to play

| Input | Planning | Raid |
|---|---|---|
| `1` to `4` or click a card | Pick a crew member | Pick a crew member |
| Click / drag on the map | Add waypoints to their route | While paused, give them a new route |
| Click a waypoint | Select it (drag to move it) | |
| Right click, `Backspace` | Remove the selected point | |
| `A`, `B`, `C` | Hold the selected point until that go code | Call the go code |
| `K` | Kick locked doors after the selected point | |
| `Enter` or **Go** | Start the raid | |
| `Space` | | Pause and resume |
| `F` | | Speed 1x, 2x, 4x |
| `V` or the car button | | Drive off with whoever is at the van |

Locked doors are picked by default (quiet, slow; Kemi the Creeper is fastest). Kicking is fast but loud: it starts the police clock and brings guards running. Anyone who walks up on an unaware enemy holds them up (Taz the Talker is quickest); an enemy who clocks you first goes hostile, shouts for the others and starts the backup clock. Loot is bagged by walking next to it. Get everyone to the getaway zone by the van before the police arrive. **Load a sample plan** on the title screen shows a quiet run.

## Code layout

```
src/sim/       Game rules, no engine code: level data, grid, pathfinding,
               line of sight, crew and enemy behaviour, clocks, outcome.
src/render/    Babylon.js view: scene, lighting, blueprint post-process,
               actors, vision cones, paths and markers.
src/ui/        HTML HUD (crew cards, clocks, loot, tool bar, results).
src/main.ts    Game flow and input.
tests/         Simulation tests (node --test).
scripts/       Headless browser smoke test and screenshots (Playwright).
```

The simulation is engine-agnostic, so the rules can be tested without a browser and the renderer could be swapped later.

## Tests

```sh
npm test                                   # simulation tests
npm run dev &                              # then, with Chromium available:
node scripts/smoke.mjs http://localhost:5173/
node scripts/screenshots.mjs http://localhost:5173/ shots
```

The smoke test drives the game with a real mouse and keyboard in headless Chromium: it draws a route, sets a go code, starts the raid, calls the code and pauses.

## Art direction

Colours and HUD layout follow the project style guide: night base `#0B1220`, moonlight `#3A6FD8`, sodium streetlights `#FF9A2E`, blueprint wash `#1E4F8F`, crew slots cyan `#22E3FF`, magenta `#FF2D9B`, lime `#A6FF2E` and amber `#FFB020`, red `#FF3B4E` for enemies only, and `#3DFFA2` for loot.
