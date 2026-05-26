const mongoose = require('mongoose');

const emailSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    gmailMessageId: { type: String, required: true },
    // RFC 2822 Message-Id header — used as In-Reply-To when generating a reply
    messageId: { type: String, default: '' },
    threadId: String,
    subject: String,
    from: String,
    to: [String],
    date: Date,
    snippet: String,
    bodyText: String,
    bodyHtml: String,
    labels: [String],
    isRead: { type: Boolean, default: false },
    // Step 6: original thread headers preserved for reply chaining
    inReplyToHeader: { type: String, default: '' },
    referencesHeader: { type: String, default: '' },
  },
  { timestamps: true }
);

emailSchema.index({ userId: 1, gmailMessageId: 1 }, { unique: true });

module.exports = mongoose.model('Email', emailSchema);
