# Contributing to SHARKPLANE

Thanks for wanting to help the shark eat more planes.

## Setup

```sh
npm ci
npm run dev        # http://localhost:5995
npm run lint
npm test           # unit tests (vitest)
npm run build      # static export to out/
npm run e2e        # headless gameplay run against out/ (needs Chrome)
```

## Ground rules

- Everything is procedural — no binary art/audio assets. Keep it that way unless discussed in an issue first.
- Keep modules focused: `lib/engine.ts` is the phase machine; systems live in their own files.
- Run `npm run lint && npm test && npm run build` before opening a PR. CI runs the same.
- Gameplay tuning changes should say *what felt wrong* and *what number you changed*.
- Use conventional commit messages (`feat:`, `fix:`, `perf:`, `docs:`, `chore:`).

## Reporting bugs

Use the bug template. Include browser, GPU (from `chrome://gpu`), and whether Quality was High or Low.
