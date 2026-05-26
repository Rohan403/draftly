const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth.middleware');
const User = require('../models/User.model');
const Email = require('../models/Email.model');
const Draft = require('../models/Draft.model');
const { getThreadMessages, sendReply } = require('../services/gmail.service');
const { generateDraft, SUPPORTED_TONES } = require('../services/ai.service');
const { log } = require('../utils/logger');

// GET /drafts/tones — list supported tone options
router.get('/tones', requireAuth, (_req, res) => {
  res.json({ tones: SUPPORTED_TONES });
});

// POST /drafts/generate/:emailId — Step 3: AI draft generation
// Body: { tone?: 'formal' | 'friendly' | 'concise' | 'professional' | 'casual' }
router.post('/generate/:emailId', requireAuth, async (req, res) => {
  try {
    const tone = req.body?.tone || 'professional';
    if (!SUPPORTED_TONES.includes(tone)) {
      return res.status(400).json({
        error: `Invalid tone "${tone}". Supported tones: ${SUPPORTED_TONES.join(', ')}`,
      });
    }

    const email = await Email.findOne({ _id: req.params.emailId, userId: req.session.userId });
    if (!email) return res.status(404).json({ error: 'Email not found' });

    const user = await User.findById(req.session.userId);

    // Get full thread history so the AI understands the conversation context
    const threadContext = email.threadId
      ? await getThreadMessages(user, email.threadId)
      : [];

    // Pass stored sent-email samples as few-shot style examples + chosen tone
    const { bodyText, model, promptTokens, completionTokens } = await generateDraft({
      emailBody: email.bodyText || email.snippet,
      threadContext,
      styleSamples: user.sentEmailSamples || [],
      senderName: user.name || user.email,
      tone,
    });

    const draft = await Draft.create({
      userId: user._id,
      emailId: email._id,
      subject: email.subject,
      to: email.from,
      bodyText,
      status: 'pending',
      tone,
      aiModel: model,
      promptTokens,
      completionTokens,
      threadId: email.threadId,
      inReplyTo: email.messageId,
      references: email.referencesHeader
        ? `${email.referencesHeader} ${email.messageId}`.trim()
        : email.messageId,
      idempotencyKey: crypto.randomUUID(),
    });

    await log({
      userId: user._id,
      action: 'DRAFT_GENERATED',
      resource: 'Draft',
      resourceId: draft._id.toString(),
      meta: { model, tone, promptTokens, completionTokens },
      message: `AI draft generated for email "${email.subject}" (tone: ${tone})`,
    });

    res.status(201).json({ draft });
  } catch (err) {
    await log({ userId: req.session.userId, action: 'DRAFT_GENERATE_ERROR', level: 'error', message: err.message });
    res.status(500).json({ error: err.message });
  }
});

// GET /drafts — Step 5: list all drafts for current user
router.get('/', requireAuth, async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = { userId: req.session.userId };
    if (status) filter.status = status;

    const drafts = await Draft.find(filter)
      .sort({ createdAt: -1 })
      .skip((Math.max(parseInt(page), 1) - 1) * Math.min(parseInt(limit), 50))
      .limit(Math.min(parseInt(limit), 50))
      .populate('emailId', 'subject from date');

    const total = await Draft.countDocuments(filter);
    res.json({ total, drafts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /drafts/:id — Step 5: view single draft
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const draft = await Draft.findOne({ _id: req.params.id, userId: req.session.userId }).populate(
      'emailId',
      'subject from to date bodyText'
    );
    if (!draft) return res.status(404).json({ error: 'Draft not found' });
    res.json({ draft });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /drafts/:id/edit — Step 5: human edits the draft body
router.patch('/:id/edit', requireAuth, async (req, res) => {
  try {
    const { bodyText } = req.body;
    if (!bodyText || typeof bodyText !== 'string') {
      return res.status(400).json({ error: 'bodyText is required' });
    }

    const draft = await Draft.findOne({ _id: req.params.id, userId: req.session.userId });
    if (!draft) return res.status(404).json({ error: 'Draft not found' });
    if (draft.status === 'sent') return res.status(400).json({ error: 'Cannot edit a sent draft' });
    if (draft.status === 'rejected') return res.status(400).json({ error: 'Cannot edit a rejected draft' });

    draft.bodyText = bodyText;
    draft.userEdited = true;
    // If previously approved, editing resets to pending for re-review
    if (draft.status === 'approved') draft.status = 'pending';
    await draft.save();

    await log({
      userId: req.session.userId,
      action: 'DRAFT_EDITED',
      resource: 'Draft',
      resourceId: draft._id.toString(),
      message: 'User edited draft body',
    });

    res.json({ draft });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /drafts/:id/approve — Step 5: approve draft for sending
router.patch('/:id/approve', requireAuth, async (req, res) => {
  try {
    const draft = await Draft.findOne({ _id: req.params.id, userId: req.session.userId });
    if (!draft) return res.status(404).json({ error: 'Draft not found' });
    if (draft.status !== 'pending') {
      return res.status(400).json({ error: `Cannot approve a draft with status "${draft.status}"` });
    }

    draft.status = 'approved';
    await draft.save();

    await log({
      userId: req.session.userId,
      action: 'DRAFT_APPROVED',
      resource: 'Draft',
      resourceId: draft._id.toString(),
      message: `Draft approved: "${draft.subject}"`,
    });

    res.json({ draft });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /drafts/:id/reject — Step 5: reject draft
router.delete('/:id/reject', requireAuth, async (req, res) => {
  try {
    const draft = await Draft.findOne({ _id: req.params.id, userId: req.session.userId });
    if (!draft) return res.status(404).json({ error: 'Draft not found' });
    if (draft.status === 'sent') return res.status(400).json({ error: 'Cannot reject a sent draft' });

    draft.status = 'rejected';
    await draft.save();

    await log({
      userId: req.session.userId,
      action: 'DRAFT_REJECTED',
      resource: 'Draft',
      resourceId: draft._id.toString(),
      message: `Draft rejected: "${draft.subject}"`,
    });

    res.json({ message: 'Draft rejected', draft });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /drafts/:id/send — Step 6: send approved draft via Gmail
router.post('/:id/send', requireAuth, async (req, res) => {
  try {
    const draft = await Draft.findOne({ _id: req.params.id, userId: req.session.userId });
    if (!draft) return res.status(404).json({ error: 'Draft not found' });
    if (draft.status !== 'approved') {
      return res.status(400).json({ error: 'Only approved drafts can be sent' });
    }

    // Step 6: idempotency check — prevent duplicate sends
    if (draft.gmailSentMessageId) {
      return res.status(409).json({
        error: 'This draft has already been sent',
        gmailSentMessageId: draft.gmailSentMessageId,
      });
    }

    const user = await User.findById(req.session.userId);

    const sentMessage = await sendReply(user, {
      to: draft.to,
      subject: draft.subject,
      bodyText: draft.bodyText,
      inReplyTo: draft.inReplyTo,
      references: draft.references,
      threadId: draft.threadId,
    });

    draft.status = 'sent';
    draft.gmailSentMessageId = sentMessage.id;
    draft.sentAt = new Date();
    await draft.save();

    await log({
      userId: user._id,
      action: 'DRAFT_SENT',
      resource: 'Draft',
      resourceId: draft._id.toString(),
      meta: { gmailSentMessageId: sentMessage.id, threadId: draft.threadId },
      message: `Reply sent for "${draft.subject}"`,
    });

    res.json({ message: 'Reply sent successfully', draft });
  } catch (err) {
    const isTokenError = err.status === 401 || err.code === 401;
    if (isTokenError) {
      await User.findByIdAndUpdate(req.session.userId, { tokenExpired: true });
    }
    await log({
      userId: req.session.userId,
      action: 'DRAFT_SEND_ERROR',
      level: 'error',
      message: err.message,
      meta: { draftId: req.params.id },
    });
    const status = isTokenError ? 401 : 500;
    res.status(status).json({ error: err.message });
  }
});

module.exports = router;
