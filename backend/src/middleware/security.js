import helmet from 'helmet';

/**
 * Configures Helmet to set secure HTTP headers.
 * Protects against XSS, clickjacking, and other cross-site injections.
 */
export const securityMiddleware = helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:"],
            connectSrc: ["'self'"]
        }
    }
});
