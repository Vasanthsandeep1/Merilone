// Expo's default Metro setup, plus forwarding of /api and /uploads to the
// B2G backend (see ../../metro.proxy.js), so the app works over Wi-Fi or a tunnel.
const { getDefaultConfig } = require('expo/metro-config');
const { withBackendProxy } = require('../../metro.proxy');

module.exports = withBackendProxy(getDefaultConfig(__dirname));
