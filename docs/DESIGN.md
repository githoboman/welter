# PrizeRail Frontend Design

Status: frontend foundation implemented against the frozen post-fix protocol and evidence contract as of 2026-09-10.

## Product direction

PrizeRail is a settlement surface for on-chain tournaments, not a generic Web3 dashboard. The interface leads with the
actual loop:

```text
source result -> Attestcoin proof -> Creditcoin verification -> settlement -> winner payout
```

The visual direction is calm, evidence-forward, and game-native without making a financial or fairness claim. The
homepage is an entry point into the evidence and workspace routes, not a marketing-only landing page.

The fixed limitation copy is:

> PrizeRail proves and settles the result recorded by the source game. It does not claim to detect off-chain cheating.

## Daybreak reference audit

The requested reference routes were:

| Route | Intended audit focus | What was available in this environment | PrizeRail translation |
|---|---|---|---|
| `https://www.daybreakcircles.lol/` | Landing-to-app transition and visual hierarchy | DNS resolution failed from the execution environment; no visual observation is claimed. | Product entry point with a direct evidence action and a compact settlement path. |
| `/app/profile` | Settings, identity, and configuration density | DNS resolution failed; no route observation is claimed. | Profile/settings route exposes chain configuration, role boundaries, and data modes. |
| `/app/launch` | Creation flow and progressive disclosure | DNS resolution failed; no route observation is claimed. | Launch route is a read-only policy preview with wallet action deferred until browser API/wallet integration is enabled. |
| `/app/groups` | List composition and empty states | DNS resolution failed; no route observation is claimed. | Tournaments route uses one archived evidence item plus an honest empty live-index state. |
| `/app/holdings` | Summary and holdings density | DNS resolution failed; no route observation is claimed. | Overview uses evidence-derived source/settlement/proof metrics, never fabricated balances. |

The repository reference `https://github.com/ronkenx9/daybreak` was likewise not reachable because outbound DNS was
unavailable. This is recorded as an audit limitation rather than an invented observation.

The implementation adapts only the interaction patterns requested in the brief: a compact application shell, a quiet
left rail, strong display type, restrained bordered surfaces, explicit empty states, responsive mobile navigation,
progressive evidence disclosure, and visible status labels. It rejects Daybreak semantics, names, copy, characters,
logos, assets, code, runtime dependencies, and business concepts. PrizeRail uses its own vocabulary: tournaments,
source results, proof, settlement, payout, replay, refund, and recovery.

## Tokens and surfaces

- **Ink:** `#132238` for high-trust primary text and the source-result hero.
- **Porcelain:** `#f4f6f8` for the reading canvas.
- **White:** `#ffffff` for framed evidence and tool surfaces.
- **Cobalt:** `#2757d9` for actions and verified progression.
- **Mint:** `#1f866d` for successful evidence and settled states.
- **Amber:** `#a86118` for trust limitations and unavailable infrastructure.
- **Brick:** `#ad3d3d` for failed or rejected evidence.
- **Slate:** `#657286` for secondary copy and unknown values.

The palette is deliberately multi-hue. There are no gradients, decorative orbs, bokeh blobs, fake charts, or AI-created
images. Pages use full-width bands and a constrained content width. Cards are reserved for repeated evidence, a tournament
row, or a genuinely framed tool. Cards do not nest inside cards. Corners are restrained (`4px` to `8px`), with borders
doing most of the grouping work.

## Controls and status

Text buttons are used for explicit commands. Familiar actions use small symbol buttons (`⧉` copy, `↗` external link,
`☰` mobile navigation) with accessible labels and titles. There is no icon dependency in the repository, so the foundation
avoids invented icon illustrations and uses readable symbols.

`PASS`, `FAIL`, and `UNKNOWN` are separate visual outcomes. `UNKNOWN` is neutral and retryable; it is never rendered as a
business failure. `LIVE`, `HISTORICAL VERIFIED RUN`, and `DEVELOPMENT FIXTURE` are separate mode badges on every
data-bearing surface. Historical evidence is always named as archived and is never presented as a connected wallet or a
live asynchronous job.

## Responsive and accessibility behavior

- Semantic landmarks, a skip link, `aria-current`, labels, and visible `:focus-visible` rings are included.
- Status text is written as words and does not rely on color alone.
- Interactive targets are at least 44px high in the primary controls.
- The app rail becomes a keyboard-accessible toggle on narrow screens.
- Long hashes wrap safely or provide a copy action; no evidence table requires horizontal scrolling.
- `prefers-reduced-motion: reduce` disables transitions and smooth scrolling.
- Desktop, tablet, and narrow mobile layouts collapse grids instead of shrinking text to viewport units.

## Copy voice and placeholder policy

Copy is plain, precise, and honest: “Result verified on Creditcoin,” “Attestation is still pending,” “Replay rejected,”
and “The chain response is unavailable. Try again.” The foundation does not promise instant payout, a fixed attestation
time, anti-cheat protection, source-game fairness, or production custody.

No image placeholder is used. The product does not need an image to communicate the settlement path, and adding a
decorative asset would imply a brand or partner relationship that does not exist. If a future route requires a meaningful
image slot, it must be centralized behind an asset boundary and documented in `docs/UI-IMPLEMENTATION.md` before use.

## Prohibited patterns

Do not reintroduce generic exchange dashboards, fake activity graphs, fake balances, glowing futuristic effects, card
stacks without a protocol concept, source-game fairness claims, or live-looking pending proof states without a worker/API
record. The frontend must remain a presentation layer over typed chain/evidence facts.
