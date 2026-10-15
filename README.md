# Switchyard

[![Made with pollinations.ai](https://raw.githubusercontent.com/pollinations/pollinations/main/packages/ui/src/brand/badge-made-with.svg)](https://pollinations.ai/?ref=badge)

Six trolley dilemmas. Choose first, compare with Jev, then reverse only the order of the outcome descriptions. There is no moral score, and model probabilities are not probabilities of moral correctness.

**App:** https://saauf.github.io/switchyard/

Built for [Pollinations quest #17647](https://github.com/pollinations/pollinations/issues/17647). Inspired by Zach Landes’ [Jev Meets the Trolley Problem](https://zachlandes.com/trolley-problem/) and [trolley-bench](https://github.com/zachlandes/trolley-bench). The prompts here are new; no published benchmark answers are reused.

## Run locally

Node.js 22+ and Python 3 are sufficient. There are no package dependencies.

```sh
npm test
npm run build
npm run dev
```

Open http://127.0.0.1:4173/. `build.mjs` creates a static `dist/` directory. GitHub Pages serves that directory from the `gh-pages` branch. When deploying elsewhere, update the site URL in `build.mjs` and `CLIENT_ID` in `src/auth.mjs` together.

## Pollen and sign-in

Practice mode is free and sends no decision requests. Live mode calls Pollinations’ `POST /alpha/decisions` with `typesafe/jev-1.13`, which currently requires **Paid Pollen**. The app does not buy Pollen, top up balances, or run background generations. Each Ask or Reverse click sends one request, with no automatic retries. Listed input-token pricing is fetched from `/models`.

Sign-in uses OAuth authorization code with S256 PKCE and a hosted [client metadata document](https://saauf.github.io/switchyard/client-metadata.json). No shared developer key is embedded. The request limits generation to Jev, requests no account scopes, and asks for a 0.1-Pollen cap for one day. The user reviews the final permissions and limits on Pollinations.

The access token stays in memory and is forgotten on reload or disconnect. Disconnect does not revoke the remote key; the dialog links to Pollinations’ key dashboard for revocation. Pending OAuth state and the verifier are kept in session storage for the callback, then removed. Choices and returned decisions remain in this tab’s session storage. The exported session contains prompts, choices, and returned decisions, never credentials.

## Verification

The test suite checks the unchanged facts under order reversal, empty-track and server outcomes, native response parsing, actual HTTP request encoding against a local fixture, payment/auth/rate-limit failures, PKCE, callback rejection, token exchange, and credential-free export. All generation and token responses in automated tests are local fixtures, not live Jev results. Browser checks cover the six-round practice path, JSON download, restart, responsive layout, invalid callback rejection, and the deployed app’s real Pollinations consent screen and decline callback. The consent screen recognized the hosted client metadata and displayed Jev-only access, a 0.1-Pollen cap, and one-day expiry. No access was granted.

No live Jev request was made during development because it is Paid-Pollen-only. A visitor with Paid Pollen can verify sign-in, Ask, Reverse, and export. The UI never substitutes test answers for real model answers.
