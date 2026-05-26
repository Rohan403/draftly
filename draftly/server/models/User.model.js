const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    googleId: { type: String, required: true, unique: true },
    email: { type: String, required: true },
    name: String,
    picture: String,
    // Step 7: tokens stored AES-256-GCM encrypted at rest
    tokens: {
      access_token: String,
      refresh_token: String,
      expiry_date: Number,
    },
    // Step 4: writing samples fetched from sent emails for few-shot AI prompting
    sentEmailSamples: { type: [String], default: [] },
    styleProfile: {
      tone: { type: String, default: 'professional' },
      averageSentenceLength: Number,
      commonPhrases: [String],
      signatureStyle: String,
      analyzedAt: Date,
    },
    // Step 7: flag set when token refresh fails so the app can surface a warning
    tokenExpired: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
