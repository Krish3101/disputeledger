const { loadCCP, enrollAdmin } = require('../services/fabricService');

/**
 * POST /setup
 * Enrolls the admin user
 */
async function setup(req, res) {
  try {
    const ccp = loadCCP();
    await enrollAdmin(ccp);
    res.json({ ok: true, message: 'Admin enrolled successfully. You can now register users.' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}

/**
 * GET /health
 * Health check endpoint
 */
function health(req, res) {
  res.json({ ok: true });
}

module.exports = {
  setup,
  health,
};
