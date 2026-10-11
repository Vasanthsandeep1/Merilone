const jwt = require('jsonwebtoken');
const { User } = require('../models');
require('dotenv').config();

// Verifies the JWT sent in the Authorization header (Bearer token)
const protect = (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Attach decoded user info to the request object
      req.user = decoded; // { id, iat, exp }
      return next();
    } catch (error) {
      return res.status(401).json({ message: 'Not authorized, token failed or expired' });
    }
  }

  if (!token) {
    return res.status(401).json({ message: 'Not authorized, no token provided' });
  }
};

// Verifies JWT and ensures the user is an engineer
const protectEngineer = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Fetch full user to check userType
      const user = await User.findByPk(decoded.id, {
        attributes: ['id', 'name', 'email', 'phone', 'userType', 'district', 'employeeId']
      });

      if (!user) {
        return res.status(401).json({ message: 'User not found' });
      }

      if (user.userType !== 'engineer') {
        return res.status(403).json({ message: 'Access denied. Engineers only.' });
      }

      req.user = { id: user.id, userType: user.userType, district: user.district };
      return next();
    } catch (error) {
      return res.status(401).json({ message: 'Not authorized, token failed or expired' });
    }
  }

  if (!token) {
    return res.status(401).json({ message: 'Not authorized, no token provided' });
  }
};

// Restricts access to specific userType values. Must run after `protect`.
// Re-fetches userType from the DB rather than trusting the JWT payload,
// since a user's role can change after a token was already issued.
const authorize = (...allowedRoles) => async (req, res, next) => {
  try {
    const user = await User.findByPk(req.user.id, {
      attributes: ['id', 'userType', 'isActive', 'moduleAccess']
    });

    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    if (!allowedRoles.includes(user.userType)) {
      return res.status(403).json({ message: 'Access denied for this role' });
    }

    req.user.userType = user.userType;
    req.user.moduleAccess = user.moduleAccess;
    return next();
  } catch (error) {
    return res.status(500).json({ message: 'Authorization check failed', error: error.message });
  }
};

// Real API-level enforcement of an HR-provisioned employee login's module
// scope — the Sidebar hiding a nav group is cosmetic on its own; this is what
// actually stops a Sales-only employee login from hitting Finance/HR/etc.
// endpoints directly. Chain AFTER authorize(...roles, 'employee', 'freelancer')
// on any Sales/Finance/Inventory/HR route group. Every other allowed
// userType (admin, distributor, finance_admin, hr_admin, ...) passes through
// unrestricted — this only ever narrows 'employee' and 'freelancer' logins.
// An approved freelancer's moduleAccess is set to their single
// freelancerModule at approval time (see freelancerController.js), so this
// applies to them identically to a department-scoped employee login.
const authorizeModule = (moduleKey) => (req, res, next) => {
  if (req.user.userType !== 'employee' && req.user.userType !== 'freelancer') return next();
  const access = (req.user.moduleAccess || '').split(',').filter(Boolean);
  if (!access.includes(moduleKey)) {
    return res.status(403).json({ message: `Your login does not have access to the ${moduleKey} module` });
  }
  return next();
};

// Like `authorize`, but verifies the JWT itself first rather than assuming
// `protect` already ran — lets a single route accept a role list that spans
// both engineer and admin-type users, which `protect`+`authorize` can't do
// since `protect` doesn't fetch userType and `protectEngineer` hard-rejects non-engineers.
const protectRoles = (...allowedRoles) => async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      const user = await User.findByPk(decoded.id, {
        attributes: ['id', 'name', 'email', 'userType', 'district']
      });

      if (!user) {
        return res.status(401).json({ message: 'User not found' });
      }

      if (!allowedRoles.includes(user.userType)) {
        return res.status(403).json({ message: 'Access denied for this role' });
      }

      req.user = { id: user.id, userType: user.userType, district: user.district };
      return next();
    } catch (error) {
      return res.status(401).json({ message: 'Not authorized, token failed or expired' });
    }
  }

  return res.status(401).json({ message: 'Not authorized, no token provided' });
};

module.exports = { protect, protectEngineer, authorize, protectRoles, authorizeModule };
