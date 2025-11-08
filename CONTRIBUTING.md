# Contributing to Super Brainstorm Bot

Thank you for your interest in contributing! This document outlines the development workflow and requirements.

## Development Workflow

### Before Committing

1. **Build and Lint**: Run `npm run build && npm run lint:all` to ensure code compiles and passes linting
2. **Documentation Check**: The pre-commit hook will automatically check if documentation needs updating
3. **Test Changes**: Ensure your changes work as expected

### Documentation Requirements

**MANDATORY**: If you change any code logic, you MUST update the relevant documentation before committing.

#### When to Update Documentation

- **Code Logic Changes**: Any changes to how the bot works, processes messages, or handles commands
- **New Features**: Adding new commands, features, or capabilities
- **Architecture Changes**: Changes to system architecture, component interactions, or data flow
- **Configuration Changes**: Changes to configuration options, defaults, or environment variables
- **API Changes**: Changes to interfaces, types, or public APIs
- **Behavior Changes**: Changes to user-facing behavior or workflows

#### Documentation Files to Update

1. **README.md**: 
   - User-facing features and commands
   - How to use the bot
   - Configuration options
   - Troubleshooting

2. **SETUP.md**:
   - Setup instructions
   - Configuration steps
   - Environment variables
   - Installation procedures

3. **ARCHITECTURE.md**:
   - System architecture
   - Component descriptions
   - Data flow diagrams
   - Technical design decisions
   - Mermaid diagrams

4. **STATUS.md**:
   - Implementation status
   - Completed features
   - Pending tasks

5. **IMPLEMENTATION.md**:
   - Implementation details
   - Technical implementation notes
   - Development guidelines

### Pre-Commit Hook

The pre-commit hook automatically:
1. Builds the project (`npm run build`)
2. Runs all linters (`npm run lint:all`)
3. Checks if documentation is updated (`npm run check:docs`)

**The commit will be blocked if:**
- Code files are changed but no documentation files are updated
- Build fails
- Linting fails

### Bypassing Checks (Not Recommended)

If you absolutely must bypass the documentation check (e.g., for WIP commits), use:
```bash
git commit --no-verify
```

**Warning**: Only use this for work-in-progress commits. All final commits should pass all checks.

## Code Style

- Follow TypeScript best practices
- Use ESLint configuration (run `npm run lint` before committing)
- Follow existing code patterns and conventions
- Add comments for complex logic

## Commit Messages

Use clear, descriptive commit messages:
- Start with a verb (Add, Fix, Update, Remove, etc.)
- Describe what changed and why
- Reference issue numbers if applicable

Examples:
- `Add promise-based planning system`
- `Fix cost tracking calculation`
- `Update documentation for clarification flow`
- `Remove deprecated timeout logic`

## Pull Requests

When creating a pull request:
1. Ensure all checks pass
2. Update all relevant documentation
3. Describe the changes clearly
4. Reference any related issues

## Questions?

If you have questions about contributing, please open an issue or contact the maintainers.

