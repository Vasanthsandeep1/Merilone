'use strict';
// Shared chat history for every AI chat surface in the portal (Distributor
// Recommendation, drafting a letter in Agreement, revising one letter). A session
// is a feature name + optional refId (e.g. a letter id, so each letter's "revise"
// chat is its own thread) + the message list + any feature-specific context to
// restore (filters, last results, …). Rows expire 7 days after their last message —
// checked on every read and swept opportunistically on write, so the table never
// keeps more than about a week of chat.
const { Op } = require('sequelize');
const { AiChatSession } = require('../models');

const EXPIRY_DAYS = 7;
const cutoff = () => new Date(Date.now() - EXPIRY_DAYS * 86400000);

const summary = (s) => {
  const msgs = Array.isArray(s.messages) ? s.messages : [];
  const last = msgs[msgs.length - 1];
  return {
    id: s.id, feature: s.feature, refId: s.refId, title: s.title || 'Untitled chat',
    messageCount: msgs.length, preview: last ? String(last.content || '').slice(0, 140) : '',
    createdAt: s.createdAt, updatedAt: s.updatedAt,
  };
};
const full = (s) => ({ id: s.id, feature: s.feature, refId: s.refId, title: s.title, context: s.context || null, messages: s.messages || [], createdAt: s.createdAt, updatedAt: s.updatedAt });

async function purgeExpired(userId) {
  await AiChatSession.destroy({ where: { userId, updatedAt: { [Op.lt]: cutoff() } } });
}

// @route GET /api/ai-chats?feature=&refId=&limit= — history list for the History panel
exports.list = async (req, res) => {
  try {
    const { feature, refId } = req.query;
    if (!feature) return res.status(400).json({ success: false, message: 'feature is required' });
    await purgeExpired(req.user.id);
    const where = { userId: req.user.id, feature, updatedAt: { [Op.gte]: cutoff() } };
    if (refId !== undefined) where.refId = refId || null;
    const rows = await AiChatSession.findAll({ where, order: [['updatedAt', 'DESC']], limit: Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 30)) });
    res.json({ success: true, data: rows.map(summary), expiryDays: EXPIRY_DAYS });
  } catch (err) {
    console.error('ai chat list error:', err);
    res.status(500).json({ success: false, message: 'Failed to load chat history' });
  }
};

// @route GET /api/ai-chats/latest?feature=&refId= — for auto-restoring on page load; null if none / expired
exports.latest = async (req, res) => {
  try {
    const { feature, refId } = req.query;
    if (!feature) return res.status(400).json({ success: false, message: 'feature is required' });
    const where = { userId: req.user.id, feature, updatedAt: { [Op.gte]: cutoff() } };
    if (refId !== undefined) where.refId = refId || null;
    const row = await AiChatSession.findOne({ where, order: [['updatedAt', 'DESC']] });
    res.json({ success: true, data: row ? full(row) : null, expiryDays: EXPIRY_DAYS });
  } catch (err) {
    console.error('ai chat latest error:', err);
    res.status(500).json({ success: false, message: 'Failed to load the last chat' });
  }
};

// @route GET /api/ai-chats/:id
exports.get = async (req, res) => {
  try {
    const row = await AiChatSession.findOne({ where: { id: req.params.id, userId: req.user.id, updatedAt: { [Op.gte]: cutoff() } } });
    if (!row) return res.status(404).json({ success: false, message: 'This chat has expired or does not exist.' });
    res.json({ success: true, data: full(row) });
  } catch (err) {
    console.error('ai chat get error:', err);
    res.status(500).json({ success: false, message: 'Failed to load chat' });
  }
};

const titleFrom = (messages) => {
  const firstUser = (messages || []).find((m) => m.role === 'user');
  return firstUser ? String(firstUser.content || '').slice(0, 80) : 'Untitled chat';
};

// @route POST /api/ai-chats  { feature, refId?, title?, context?, messages? }
exports.create = async (req, res) => {
  try {
    const { feature, refId, title, context, messages } = req.body || {};
    if (!feature) return res.status(400).json({ success: false, message: 'feature is required' });
    purgeExpired(req.user.id).catch(() => {});
    const row = await AiChatSession.create({
      userId: req.user.id, feature, refId: refId || null,
      title: (title || titleFrom(messages)).slice(0, 300), context: context || null, messages: Array.isArray(messages) ? messages : [],
    });
    res.status(201).json({ success: true, data: full(row) });
  } catch (err) {
    console.error('ai chat create error:', err);
    res.status(500).json({ success: false, message: 'Failed to start chat history' });
  }
};

// @route PUT /api/ai-chats/:id  { title?, context?, messages? } — replaces the message
// list / context with the client's current state (the client always holds the full
// conversation, so this is a snapshot save rather than an append).
exports.update = async (req, res) => {
  try {
    const row = await AiChatSession.findOne({ where: { id: req.params.id, userId: req.user.id } });
    if (!row) return res.status(404).json({ success: false, message: 'Chat not found' });
    const { title, context, messages } = req.body || {};
    if (Array.isArray(messages)) row.messages = messages;
    if (context !== undefined) row.context = context;
    if (title !== undefined) row.title = String(title).slice(0, 300);
    else if (!row.title) row.title = titleFrom(row.messages);
    await row.save(); // bumps updated_at, which is the session's expiry clock
    res.json({ success: true, data: full(row) });
  } catch (err) {
    console.error('ai chat update error:', err);
    res.status(500).json({ success: false, message: 'Failed to save chat' });
  }
};

// @route DELETE /api/ai-chats/:id
exports.remove = async (req, res) => {
  try {
    const n = await AiChatSession.destroy({ where: { id: req.params.id, userId: req.user.id } });
    if (!n) return res.status(404).json({ success: false, message: 'Chat not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('ai chat delete error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete chat' });
  }
};
