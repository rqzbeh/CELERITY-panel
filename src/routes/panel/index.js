/**
 * Panel routes aggregator.
 * Mounts sub-routers for auth, nodes, users, settings, and system.
 */

const express = require('express');
const router = express.Router();

const { checkIpWhitelist, requireAuth } = require('./helpers');

const authRoutes = require('./auth');
const nodesRoutes = require('./nodes');
const usersRoutes = require('./users');
const settingsRoutes = require('./settings');
const systemRoutes = require('./system');

// IP whitelist applies to all panel routes
router.use(checkIpWhitelist);

// Auth routes are public (login, setup, totp, logout)
router.use('/', authRoutes);

// All other routes require authentication
router.use('/', requireAuth, nodesRoutes);
router.use('/', requireAuth, usersRoutes);
router.use('/', requireAuth, settingsRoutes);
router.use('/', requireAuth, systemRoutes);

module.exports = router;
