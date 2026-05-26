const mongoose = require('mongoose');

// Status lifecycle: pending → approved → sent  |  pending → rejected
const DRAFT_STATUSES = ['pending', 'approved', 'rejected', 'sent'];
const DRAFT_TONES = ['formal', 'friendly', 'concise', 'professional', 'casual'];

const draftSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    emailId: { type: mongoose.Schema.Types.ObjectId, ref: 'Email' },
    subject: String,
    to: String,
    bodyText: String,
    status: { type: String, enum: DRAFT_STATUSES, default: 'pending' },
    tone: { type: String, enum: DRAFT_TONES, default: 'professional' },
    // AI generation metadata
    aiModel: String,
    promptTokens: Number,
    completionTokens: Number,
    // Step 4: tracks whether user has edited the AI draft
    userEdited: { type: Boolean, default: false },
    // Step 6: threading headers required for Gmail In-Reply-To / References
    threadId: String,
    inReplyTo: String,
    references: String,
    // Step 6: idempotency key to prevent duplicate sends
    idempotencyKey: { type: String, unique: true, sparse: true },
    // Step 6: Gmail message ID after successful send
    gmailSentMessageId: String,
    sentAt: Date,
  },
  { timestamps: true }
);

module.exports = mongoose.model('Draft', draftSchema);
