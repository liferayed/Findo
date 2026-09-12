module.exports = {
  testMatch: ['**/test/integration/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/', 'chatTransactionCapture.integration.test.js'],
  testTimeout: 20000,
  forceExit: true,
};
