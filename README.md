# Habla

Habla is a Nostr-based long-form publishing app for writing, editing, sharing, and managing articles with your own keys.

## Features

- Long-form article publishing on Nostr
- Draft management in the editor
- Published article editing and deletion support
- AI-assisted drafting from the editor
- Section-level AI rewrites, concise edits, and expansion for selected text or blocks
- Per-account AI provider settings for OpenAI and Groq
- Nostr profile, relay, and account management
- TailwindCSS-based UI with React Router SSR

## Getting Started

### Install

```bash
npm install
```

### Run locally

```bash
npm run dev
```

The app will be available at `http://localhost:5173`.

### Build

```bash
npm run build
```

## Notes

- AI draft settings are stored locally per account in the browser.
- Section-scoped AI actions only replace the selected range or current block.
- Published article deletion publishes a NIP-09 deletion event to your relays.

## Deployment

Build the app and deploy the generated `build/` output with a Node-compatible host.

---

Built with React Router, TailwindCSS, Nostr, and Applesauce.
