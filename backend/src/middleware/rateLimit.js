import rateLimit from 'express-rate-limit';

/**
 * Prevents DDoS and brute-force attacks by limiting IP request frequency.
 */
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per window
    message: { error: 'Too many requests from this IP, please try again later.' }
});

export const rateLimitMiddleware = (req, res, next) => {
    // Exclude static files from rate limiting if needed
    if (req.path.startsWith('/index.html') || req.path === '/') {
        return next();
    }
    return limiter(req, res, next);
};
