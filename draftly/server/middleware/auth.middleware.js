function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Unauthorized — please log in via /auth/google' });
  }
  next();
}

module.exports = { requireAuth };
