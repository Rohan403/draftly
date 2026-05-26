const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const { createOAuthClient, GMAIL_SCOPES } = require('../config/google');
const User = require('../models/User.model');
const { encrypt } = require('../services/crypto.service');
const { log } = require('../utils/logger');

// GET /auth/google — redirect to Google consent screen
router.get('/google', (req, res) => {
  const client = createOAuthClient();
  const url = client.generateAuthUrl({
    access_type: 'offline',
    scope: GMAIL_SCOPES,
    prompt: 'consent', // force refresh_token to be returned every time
  });
  res.redirect(url);
});

// GET /auth/google/callback — exchange code, upsert user, set session
router.get('/google/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.status(400).json({ error: `Google OAuth error: ${error}` });
  if (!code) return res.status(400).json({ error: 'Missing authorization code' });

  try {
    const client = createOAuthClient();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    // Fetch Google profile
    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const { data: profile } = await oauth2.userinfo.get();

    // Step 7: encrypt tokens before persisting
    const encryptedTokens = {
      access_token: encrypt(tokens.access_token),
      refresh_token: tokens.refresh_token ? encrypt(tokens.refresh_token) : undefined,
      expiry_date: tokens.expiry_date,
    };

    const user = await User.findOneAndUpdate(
      { googleId: profile.id },
      {
        $set: {
          email: profile.email,
          name: profile.name,
          picture: profile.picture,
          tokens: encryptedTokens,
          tokenExpired: false,
        },
      },
      { upsert: true, new: true }
    );

    req.session.userId = user._id.toString();

    await log({
      userId: user._id,
      action: 'AUTH_LOGIN',
      resource: 'User',
      resourceId: user._id.toString(),
      message: `${user.email} authenticated via Google OAuth2`,
    });

    res.json({ message: 'Login successful', user: { email: user.email, name: user.name } });
  } catch (err) {
    console.error('OAuth callback error:', err.message);
    res.status(500).json({ error: 'OAuth authentication failed', detail: err.message });
  }
});

// GET /auth/logout — destroy session
router.get('/logout', (req, res) => {
  const userId = req.session?.userId;
  req.session.destroy(async (err) => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    if (userId) {
      await log({ userId, action: 'AUTH_LOGOUT', resource: 'User', resourceId: userId });
    }
    res.json({ message: 'Logged out successfully' });
  });
});

// GET /auth/me — return current session user (no tokens exposed)
router.get('/me', async (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  try {
    const user = await User.findById(req.session.userId).select(
      'email name picture createdAt styleProfile tokenExpired'
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
