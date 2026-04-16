const rateLimit = require('express-rate-limit');

/**
 * Rate limiting middleware
 * Limits each IP to 100 requests per 15 minutes
 */
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: 'Too many requests from this IP, please try again later.'
});

/**
 * Apply rate limiting selectively (exclude health check and static files)
 */
const rateLimitMiddleware = (req, res, next) => {
  if (req.path === '/health' || req.path.startsWith('/index.html') || req.path === '/') {
    return next();
  }
  return limiter(req, res, next);
};

module.exports = rateLimitMiddleware;
