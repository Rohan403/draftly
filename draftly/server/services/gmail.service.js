const { google } = require('googleapis');
const { createOAuthClient } = require('../config/google');
const { encrypt, decrypt } = require('./crypto.service');
const User = require('../models/User.model');

// --- helpers ---

function headerMap(headers) {
  return headers.reduce((acc, h) => {
    acc[h.name.toLowerCase()] = h.value;
    return acc;
  }, {});
}

function decodeBody(data) {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function extractBody(payload, mimeType) {
  if (payload.mimeType === mimeType && payload.body?.data) {
    return decodeBody(payload.body.data);
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      const found = extractBody(part, mimeType);
      if (found) return found;
    }
  }
  return null;
}

// Step 7: exponential back-off retry (skips retry on 401 — expired/revoked token)
async function withRetry(fn, maxAttempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const status = err.status || err.code || err.response?.status;
      if (status === 401 || status === 403) throw err;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
      }
    }
  }
  throw lastError;
}

function buildAuthedClient(user) {
  const client = createOAuthClient();
  client.setCredentials({
    access_token: decrypt(user.tokens.access_token),
    refresh_token: user.tokens.refresh_token ? decrypt(user.tokens.refresh_token) : null,
    expiry_date: user.tokens.expiry_date,
  });

  // Step 7: persist refreshed tokens back to DB automatically
  client.on('tokens', async (newTokens) => {
    const update = { 'tokens.expiry_date': newTokens.expiry_date };
    if (newTokens.access_token) update['tokens.access_token'] = encrypt(newTokens.access_token);
    if (newTokens.refresh_token) update['tokens.refresh_token'] = encrypt(newTokens.refresh_token);
    await User.findByIdAndUpdate(user._id, { $set: update });
  });

  return client;
}

// --- Step 2: fetch inbox emails ---
async function fetchRecentEmails(user, maxResults = 20) {
  const auth = buildAuthedClient(user);
  const gmail = google.gmail({ version: 'v1', auth });

  return withRetry(async () => {
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      maxResults,
      q: 'in:inbox',
    });

    const messages = listRes.data.messages || [];
    const emails = [];

    for (const msg of messages) {
      const msgRes = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'full',
      });

      const { payload, snippet, threadId, labelIds } = msgRes.data;
      const h = headerMap(payload.headers);

      emails.push({
        gmailMessageId: msg.id,
        messageId: h['message-id'] || '',
        threadId,
        subject: h['subject'] || '(no subject)',
        from: h['from'] || '',
        to: (h['to'] || '').split(',').map((s) => s.trim()).filter(Boolean),
        date: h['date'] ? new Date(h['date']) : new Date(),
        snippet: snippet || '',
        bodyText: extractBody(payload, 'text/plain') || '',
        bodyHtml: extractBody(payload, 'text/html') || '',
        labels: labelIds || [],
        isRead: !(labelIds || []).includes('UNREAD'),
        inReplyToHeader: h['in-reply-to'] || '',
        referencesHeader: h['references'] || '',
      });
    }

    return emails;
  });
}

// --- Step 4: fetch sent emails for style learning ---
async function fetchSentEmails(user, maxResults = 15) {
  const auth = buildAuthedClient(user);
  const gmail = google.gmail({ version: 'v1', auth });

  return withRetry(async () => {
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      maxResults,
      q: 'in:sent',
    });

    const messages = listRes.data.messages || [];
    const samples = [];

    for (const msg of messages) {
      const msgRes = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'full',
      });
      const body = extractBody(msgRes.data.payload, 'text/plain');
      if (body && body.trim()) samples.push(body.trim());
    }

    return samples;
  });
}

// --- Step 3: get thread messages for AI context ---
async function getThreadMessages(user, threadId) {
  const auth = buildAuthedClient(user);
  const gmail = google.gmail({ version: 'v1', auth });

  return withRetry(async () => {
    const res = await gmail.users.threads.get({
      userId: 'me',
      id: threadId,
      format: 'full',
    });

    return (res.data.messages || []).map((msg) => {
      const h = headerMap(msg.payload.headers);
      const body = extractBody(msg.payload, 'text/plain') || '';
      return `From: ${h['from'] || ''}\nDate: ${h['date'] || ''}\n\n${body.substring(0, 800)}`;
    });
  });
}

// --- Step 6: send reply via Gmail with thread headers ---
async function sendReply(user, { to, subject, bodyText, inReplyTo, references, threadId }) {
  const auth = buildAuthedClient(user);
  const gmail = google.gmail({ version: 'v1', auth });

  const replySubject = subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`;
  const refs = references ? `${references} ${inReplyTo}`.trim() : inReplyTo;

  const rawMessage = [
    `From: ${user.email}`,
    `To: ${to}`,
    `Subject: ${replySubject}`,
    `In-Reply-To: ${inReplyTo}`,
    `References: ${refs}`,
    `Content-Type: text/plain; charset=utf-8`,
    `MIME-Version: 1.0`,
    '',
    bodyText,
  ].join('\r\n');

  const encoded = Buffer.from(rawMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return withRetry(async () => {
    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encoded, threadId },
    });
    return res.data;
  });
}

module.exports = { fetchRecentEmails, fetchSentEmails, getThreadMessages, sendReply };
