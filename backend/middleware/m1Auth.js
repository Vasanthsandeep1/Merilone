const jwt = require('jsonwebtoken');
const { M1User } = require('../models');

// Meril One app tokens are signed with their own key (derived from
// JWT_SECRET), so the portal's `protect` middleware rejects them and an app
// user can never reach portal data — and portal tokens don't work here.
const M1_SECRET = () => `${process.env.JWT_SECRET}::meril-one-app`;

const signM1Token = (user) => jwt.sign({ uid: user.id, role: user.role }, M1_SECRET(), { expiresIn: '60d' });

// requireRole: 'customer' | 'engineer' | undefined (either)
const m1Protect = (requireRole) => async (req, res, next) => {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return res.status(401).json({ success: false, message: 'Please log in' });
  try {
    const decoded = jwt.verify(h.slice(7), M1_SECRET());
    if (requireRole && decoded.role !== requireRole) return res.status(403).json({ success: false, message: 'Not allowed for this account' });
    const user = await M1User.findByPk(decoded.uid);
    if (!user) return res.status(401).json({ success: false, message: 'Account not found, please log in again' });
    // Engineers work only while their company keeps them Active in B2G.
    if (user.role === 'engineer') {
      const { b2gEngineerByPhone } = require('../utils/oemEngineers');
      if (!(await b2gEngineerByPhone(user.phone))) {
        if (user.isAvailable) { user.isAvailable = false; await user.save(); }
        return res.status(401).json({ success: false, message: 'Your service engineer access has been removed. Please contact your company.' });
      }
    }
    req.m1User = user;
    return next();
  } catch {
    return res.status(401).json({ success: false, message: 'Session expired, please log in again' });
  }
};

module.exports = { signM1Token, m1Protect };
