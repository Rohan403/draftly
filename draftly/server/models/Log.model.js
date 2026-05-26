const mongoose = require('mongoose');

const logSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    action: { type: String, required: true },
    resource: String,
    resourceId: String,
    meta: mongoose.Schema.Types.Mixed,
    level: { type: String, enum: ['info', 'warn', 'error'], default: 'info' },
    message: String,
  },
  { timestamps: true }
);

module.exports = mongoose.model('Log', logSchema);
