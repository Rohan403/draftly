# Draftly — Gmail AI Reply Agent

Draftly is a Node.js backend that connects to your Gmail account, reads incoming emails, and uses the Google Gemini API to generate context-aware reply drafts that match your personal writing style. You review and approve every draft before anything is sent.

---

## How It Works

```
Gmail Inbox → Fetch Emails → AI Draft Generation → You Review → Approve → Send
                                     ↑
                          Your sent emails (style learning)
```

1. You authenticate with Google — Draftly gets read + send access to your Gmail
2. You fetch your inbox — emails are stored in MongoDB
3. You sync your writing style — Draftly reads your last 15 sent emails as examples
4. You generate a draft — Gemini reads the email, your thread history, and your style samples, then writes a reply
5. You review and approve (or edit/reject) the draft
6. You send — Draftly sends via Gmail API, preserving thread integrity

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js + Express.js |
| Database | MongoDB + Mongoose |
| Email | Gmail API (OAuth2) |
| AI | Google Gemini (`gemini-1.5-flash`) — free tier |
| Auth | Google OAuth2 + express-session |
| Security | AES-256-GCM token encryption |

---

## Project Structure

```
draftly/
├── .gitignore
└── server/
    ├── index.js                  ← Express app entry point
    ├── package.json
    ├── .env.example              ← All required env variables
    ├── config/
    │   ├── db.js                 ← MongoDB connection
    │   └── google.js             ← OAuth2 client + Gmail scopes
    ├── models/
    │   ├── User.model.js         ← Google profile + encrypted tokens + style samples
    │   ├── Email.model.js        ← Fetched Gmail messages
    │   ├── Draft.model.js        ← AI drafts + status lifecycle
    │   └── Log.model.js          ← Full audit trail
    ├── routes/
    │   ├── auth.routes.js        ← Step 1: Google OAuth flow
    │   ├── email.routes.js       ← Steps 2 & 4: fetch + style sync
    │   └── draft.routes.js       ← Steps 3, 5, 6: generate, review, send
    ├── services/
    │   ├── gmail.service.js      ← Gmail API wrapper (fetch, send, retry logic)
    │   ├── ai.service.js         ← Google Gemini integration
    │   └── crypto.service.js     ← AES-256-GCM token encryption/decryption
    ├── middleware/
    │   └── auth.middleware.js    ← Session-based route protection
    └── utils/
        └── logger.js             ← Writes audit logs to MongoDB
```

---

## Getting Started

### Prerequisites

- Node.js 18+
- MongoDB running locally or a MongoDB Atlas URI
- A Google Cloud project with the Gmail API enabled
- A Google Gemini API key (free — get it at [aistudio.google.com](https://aistudio.google.com))

### 1. Clone and install

```bash
cd draftly/server
npm install
```

### 2. Set up environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in each value (see the [Environment Variables](#environment-variables) section below).

### 3. Start the server

```bash
# Development (auto-restarts on file changes)
npm run dev

# Production
npm start
```

The server runs on `http://localhost:3000` by default.

---

## Environment Variables

| Variable | Description | How to get it |
|---|---|---|
| `PORT` | Port the server listens on | Default: `3000` |
| `SESSION_SECRET` | Signs session cookies | Run: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `MONGO_URI` | MongoDB connection string | Local: `mongodb://localhost:27017/draftly` or your Atlas URI |
| `GOOGLE_CLIENT_ID` | Google OAuth2 client ID | [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials |
| `GOOGLE_CLIENT_SECRET` | Google OAuth2 client secret | Same as above |
| `GOOGLE_REDIRECT_URI` | OAuth2 callback URL | Set to `http://localhost:3000/auth/google/callback` for local dev |
| `GEMINI_API_KEY` | Google Gemini API key (free) | [aistudio.google.com](https://aistudio.google.com) → Get API key |
| `ENCRYPTION_KEY` | AES-256 key for token encryption (64 hex chars) | Run: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

> **Never commit your `.env` file.** It is already in `.gitignore`.

---

## Setting Up Google OAuth2

1. Go to [Google Cloud Console](https://console.cloud.google.com) and create a project
2. Enable the **Gmail API** under APIs & Services → Library
3. Go to APIs & Services → **OAuth consent screen** → configure it (External, add your email as a test user)
4. Go to APIs & Services → **Credentials** → Create Credentials → OAuth 2.0 Client ID
5. Set Application type to **Web application**
6. Add `http://localhost:3000/auth/google/callback` to Authorized redirect URIs
7. Copy the Client ID and Client Secret into your `.env`

---

## API Reference

### Authentication

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/auth/google` | Redirect to Google login |
| `GET` | `/auth/google/callback` | OAuth2 callback (handled automatically) |
| `GET` | `/auth/me` | Get current logged-in user |
| `GET` | `/auth/logout` | Log out and destroy session |

### Emails

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/emails/fetch` | Pull latest emails from Gmail into the database |
| `GET` | `/emails/sync-style` | Fetch your sent emails for AI style learning |
| `GET` | `/emails` | List all stored emails (paginated) |
| `GET` | `/emails/:id` | Get a single email |

**Query params for `GET /emails`:** `?page=1&limit=20`

**Query params for `GET /emails/fetch`:** `?limit=20` (max 50)

### Drafts

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/drafts/tones` | List supported tone options |
| `POST` | `/drafts/generate/:emailId` | Generate an AI draft for an email |
| `GET` | `/drafts` | List all drafts |
| `GET` | `/drafts/:id` | View a single draft |
| `PATCH` | `/drafts/:id/edit` | Edit the draft body |
| `PATCH` | `/drafts/:id/approve` | Approve a draft for sending |
| `DELETE` | `/drafts/:id/reject` | Reject a draft |
| `POST` | `/drafts/:id/send` | Send an approved draft via Gmail |

**Query params for `GET /drafts`:** `?status=pending&page=1&limit=20`

**Body for `POST /drafts/generate/:emailId`:**
```json
{ "tone": "formal" }
```
Supported tones: `formal`, `friendly`, `concise`, `professional` (default), `casual`

Each tone changes the AI's greeting style, vocabulary, contraction usage, sentence length, and sign-off to match the requested register.

### Draft Status Lifecycle

```
pending ──► approved ──► sent
   │
   └──► rejected
```

- Editing an `approved` draft resets it to `pending`
- Only `approved` drafts can be sent
- Sending is idempotent — calling send twice on the same draft returns a `409`

---

## Typical Usage Flow

```bash
# 1. Log in
GET /auth/google
# → browser opens, you approve, session is set

# 2. Sync your writing style (do this once)
GET /emails/sync-style

# 3. Fetch your inbox
GET /emails/fetch

# 4. Pick an email to reply to
GET /emails

# 5. Generate a draft
POST /drafts/generate/<emailId>

# 6. Review it
GET /drafts/<draftId>

# 7a. Approve and send
PATCH /drafts/<draftId>/approve
POST  /drafts/<draftId>/send

# 7b. Or edit first, then approve
PATCH /drafts/<draftId>/edit    { "bodyText": "..." }
PATCH /drafts/<draftId>/approve
POST  /drafts/<draftId>/send

# 7c. Or reject
DELETE /drafts/<draftId>/reject
```

---

## Security Notes

- **Token encryption** — Gmail OAuth tokens are encrypted with AES-256-GCM before being stored in MongoDB. They are decrypted only inside the Gmail service layer, never exposed via the API.
- **Session cookies** — signed with `SESSION_SECRET`; sessions are stored in MongoDB via `connect-mongo`.
- **No auto-send** — the system never sends anything without an explicit `POST /drafts/:id/send` call from an authenticated session.
- **Audit log** — every action (login, fetch, generate, approve, send, errors) is recorded in the `Logs` collection with timestamps.

---

## Error Handling

- All Gmail API calls retry up to **3 times** with exponential back-off (2s, 4s delay)
- On a `401` from Gmail (expired or revoked token), retries are skipped and the user's `tokenExpired` flag is set in the database — the API returns a clear message to re-authenticate at `/auth/google`
- All errors are written to the `Logs` collection with `level: 'error'`
