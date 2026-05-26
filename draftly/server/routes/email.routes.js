const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth.middleware');
const User = require('../models/User.model');
const Email = require('../models/Email.model');
const { fetchRecentEmails, fetchSentEmails } = require('../services/gmail.service');
const { log } = require('../utils/logger');

// GET /emails/fetch — Step 2: pull inbox emails from Gmail, upsert into DB
router.get('/fetch', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    const maxResults = Math.min(parseInt(req.query.limit) || 20, 50);

    const rawEmails = await fetchRecentEmails(user, maxResults);

    const saved = [];
    for (const e of rawEmails) {
      const doc = await Email.findOneAndUpdate(
        { userId: user._id, gmailMessageId: e.gmailMessageId },
        { $set: { ...e, userId: user._id } },
        { upsert: true, new: true }
      );
      saved.push(doc);
    }

    await log({
      userId: user._id,
      action: 'EMAIL_FETCH',
      resource: 'Email',
      message: `Fetched and stored ${saved.length} emails`,
    });

    res.json({ fetched: saved.length, emails: saved });
  } catch (err) {
    // Step 7: flag expired tokens so client can surface a warning
    if (err.status === 401 || err.code === 401) {
      await User.findByIdAndUpdate(req.session.userId, { tokenExpired: true });
      return res.status(401).json({ error: 'Gmail token expired — please re-authenticate at /auth/google' });
    }
    await log({ userId: req.session.userId, action: 'EMAIL_FETCH_ERROR', level: 'error', message: err.message });
    res.status(500).json({ error: err.message });
  }
});

// GET /emails/sync-style — Step 4: fetch sent emails and store as style samples
router.get('/sync-style', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    const samples = await fetchSentEmails(user, 15);

    await User.findByIdAndUpdate(user._id, {
      sentEmailSamples: samples,
      'styleProfile.analyzedAt': new Date(),
    });

    await log({
      userId: user._id,
      action: 'STYLE_SYNC',
      resource: 'User',
      resourceId: user._id.toString(),
      message: `Stored ${samples.length} sent-email samples for style learning`,
    });

    res.json({ samplesStored: samples.length });
  } catch (err) {
    if (err.status === 401 || err.code === 401) {
      await User.findByIdAndUpdate(req.session.userId, { tokenExpired: true });
      return res.status(401).json({ error: 'Gmail token expired — please re-authenticate at /auth/google' });
    }
    await log({ userId: req.session.userId, action: 'STYLE_SYNC_ERROR', level: 'error', message: err.message });
    res.status(500).json({ error: err.message });
  }
});

// GET /emails — list stored emails (paginated)
router.get('/', requireAuth, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);

    const emails = await Email.find({ userId: req.session.userId })
      .sort({ date: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('-bodyHtml');

    const total = await Email.countDocuments({ userId: req.session.userId });

    res.json({ total, page, limit, emails });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /emails/:id — single stored email
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const email = await Email.findOne({ _id: req.params.id, userId: req.session.userId });
    if (!email) return res.status(404).json({ error: 'Email not found' });
    res.json({ email });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
