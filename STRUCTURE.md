# Project Structure

This project follows a modular, maintainable architecture with clear separation of concerns.

```
/
├── .github/                  # GitHub workflows and CI/CD
│   └── workflows/
├── app/                      # API server and web UI
│   ├── src/
│   │   ├── api/              # Route handlers/controllers
│   │   │   ├── system.js     # Health check, setup
│   │   │   ├── users.js      # User management routes
│   │   │   └── complaints.js # Complaint CRUD routes
│   │   ├── services/         # Business logic and Fabric interaction
│   │   │   └── fabricService.js
│   │   ├── utils/            # Utility functions
│   │   │   └── validation.js # Input validation
│   │   ├── middleware/       # Express middleware
│   │   │   ├── security.js   # Helmet security config
│   │   │   └── rateLimit.js  # Rate limiting
│   │   ├── config/           # Configuration
│   │   │   └── index.js      # Environment variables
│   │   ├── web/              # Static web UI
│   │   │   └── index.html
│   │   └── server.js         # Main Express app
│   ├── tests/                # Unit and integration tests
│   │   └── validation.test.js
│   ├── wallet/               # Fabric user identities (gitignored in production)
│   ├── server.js             # Entry point (delegates to src/server.js)
│   ├── preflight.js          # Environment check script
│   ├── package.json
│   └── jest.config.js
├── chaincode/
│   └── complaint-js/
│       ├── src/
│       │   └── index.js      # Smart contract implementation
│       ├── tests/
│       │   └── complaint.test.js
│       ├── package.json
│       └── jest.config.js
├── docs/                     # Documentation
│   ├── API.md
│   ├── SETUP.md
│   ├── QUICKSTART.md
│   ├── PRODUCTION.md
│   └── IMPROVEMENTS.md
├── scripts/                  # Utility scripts (deployment, etc.)
├── README.md
├── STRUCTURE.md              # This file
├── SUMMARY.md
├── CHANGELOG.md
├── CONTRIBUTING.md
├── LICENSE
└── .env.example
```

## Key Principles

### Separation of Concerns
- **API Routes** (`src/api/`): Handle HTTP requests/responses, validation, error handling
- **Services** (`src/services/`): Business logic, Fabric network interaction, wallet management
- **Middleware** (`src/middleware/`): Reusable Express middleware (security, rate limiting)
- **Config** (`src/config/`): Centralized configuration and environment variables
- **Utils** (`src/utils/`): Pure utility functions (validation, formatting, etc.)

### Modularity
Each module exports specific functions and can be tested independently. Routes import from services, services handle business logic, and utilities provide helpers.

### Scalability
The structure supports growth:
- Add new routes in `src/api/`
- Add new services in `src/services/`
- Add new middleware in `src/middleware/`
- Documentation stays organized in `docs/`

### Maintainability
- Clear folder hierarchy makes navigation intuitive
- Single responsibility per module
- Consistent naming conventions
- Easy to onboard new developers
