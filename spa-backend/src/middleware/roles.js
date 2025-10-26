// src/middleware/roles.js
module.exports = (allowed = []) => {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ msg: 'No user' });
    if (allowed.includes(req.user.role)) return next();
    return res.status(403).json({ msg: 'Forbidden' });
  };
};
