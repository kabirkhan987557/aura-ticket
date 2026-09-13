# AuraTicket

## Features
- Ticket panel using `/ticket`
- Minimum invite requirement (default: 5)
- Automatic invite verification using invite tracking
- Low-invite tickets are warned and auto-closed
- Private ticket channels
- HTML transcripts
- Transcript sent to log channel
- Transcript DM to ticket opener
- Ticket deletion after transcript processing

## Setup
1. Install Node.js 20+.
2. Open this folder in Terminal/CMD.
3. Run:
   `npm install`
4. Rename `.env.example` to `.env`.
5. Put your bot token and IDs in `.env`.
6. In Discord Developer Portal enable the **Server Members Intent** and **Guild Invites Intent** if available for your bot.
7. Invite the bot with scopes `bot` and `applications.commands`.
8. Give it permissions including:
   - View Channels
   - Send Messages
   - Read Message History
   - Manage Channels
   - Manage Server (needed for invite fetching)
9. Run:
   `npm start`

## Important invite limitation
Discord does not expose a permanent per-user invite counter. This project tracks invite uses while the bot is online. Invites used before the bot started cannot reliably be reconstructed.

## Payment reset
The project intentionally does NOT fake payment verification. To reset a user's invite count after a confirmed payment, your payment provider must call a secure webhook.

The reset operation is:
`inviteData[userId] = { count: 0 }; saveInvites();`

Add that operation only inside a verified payment-success webhook. Never reset from an unverified screenshot/message.

## Security
Never share your bot token. If it is exposed, regenerate it immediately in the Discord Developer Portal.
