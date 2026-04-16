module.exports = {
  testEnvironment: 'node',
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'server.js',
    '!tests/**'
  ],
  testMatch: [
    '**/tests/**/*.test.js'
  ],
  verbose: true
};
