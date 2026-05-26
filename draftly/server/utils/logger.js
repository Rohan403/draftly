const Log = require('../models/Log.model');

async function log({ userId, action, resource, resourceId, meta, level = 'info', message }) {
  try {
    await Log.create({ userId, action, resource, resourceId, meta, level, message });
  } catch (err) {
    console.error('Logger failed to write to DB:', err.message);
  }
}

module.exports = { log };
