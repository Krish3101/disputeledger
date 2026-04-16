# Contributing to Complaint Fabric Starter

Thank you for your interest in contributing! This document provides guidelines for contributing to this project.

## Development Setup

1. Fork and clone the repository
2. Install dependencies:
   ```bash
   cd app && npm install
   cd ../chaincode/complaint-js && npm install
   ```
3. Set up your development environment following the README

## Code Style

- Use ESLint for linting JavaScript code
- Follow existing code conventions
- Add JSDoc comments for functions
- Write meaningful commit messages

## Testing

- Add tests for new features
- Ensure all tests pass before submitting PR
- Run linter: `npm run lint`
- Run tests: `npm test`

## Pull Request Process

1. Create a feature branch from `main`
2. Make your changes with clear, descriptive commits
3. Add tests for new functionality
4. Update documentation as needed
5. Ensure all tests pass
6. Submit a pull request with a clear description

## Reporting Issues

- Use the GitHub issue tracker
- Provide detailed reproduction steps
- Include environment details (OS, Node version, etc.)
- Add relevant logs or error messages

## Code of Conduct

- Be respectful and inclusive
- Welcome newcomers
- Focus on constructive feedback
