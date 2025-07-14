# Contributing to Matter Controller MCP Server

First off, thank you for considering contributing to Matter Controller MCP Server! It's people like you that make the open source community such a fantastic place to learn, inspire, and create.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
- [Development Setup](#development-setup)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Documentation](#documentation)

## Code of Conduct

This project and everyone participating in it is governed by our Code of Conduct. By participating, you are expected to uphold this code. Please report unacceptable behavior to [0x1abin](https://github.com/0x1abin).

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check the existing issues as you might find out that you don't need to create one. When you are creating a bug report, please include as many details as possible:

- **Use a clear and descriptive title**
- **Describe the exact steps to reproduce the problem**
- **Provide specific examples to demonstrate the steps**
- **Describe the behavior you observed after following the steps**
- **Explain which behavior you expected to see instead and why**
- **Include screenshots if applicable**

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion, please include:

- **Use a clear and descriptive title**
- **Provide a step-by-step description of the suggested enhancement**
- **Provide specific examples to demonstrate the steps**
- **Describe the current behavior and explain the behavior you expected to see**
- **Explain why this enhancement would be useful**

### Your First Code Contribution

Unsure where to begin contributing? You can start by looking through these issues:

- **Beginner issues** - issues which should only require a few lines of code
- **Help wanted issues** - issues which should be a bit more involved than beginner issues

### Pull Requests

- Fill in the required template
- Do not include issue numbers in the PR title
- Follow the TypeScript and JavaScript styleguides
- Include thoughtfully-worded, well-structured tests
- Document new code based on the Documentation Styleguide
- End all files with a newline

## Development Setup

### Prerequisites

- Node.js 18 or higher
- npm or yarn
- Git

### Setup Instructions

1. **Fork and clone the repository**
   ```bash
   git clone https://github.com/your-username/matter-controller-mcp.git
   cd matter-controller-mcp
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Build the project**
   ```bash
   npm run build
   ```

4. **Run the development server**
   ```bash
   npm run watch
   ```

### Development Environment

- **Code Editor**: We recommend VS Code with TypeScript extensions
- **Node Version**: Use Node.js 18+ (check with `node --version`)
- **Package Manager**: Use npm (included with Node.js)

## Pull Request Process

1. **Create a feature branch** from `main`
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** following the coding standards

3. **Test your changes** thoroughly
   ```bash
   npm run build
   npm run start  # Test the server
   ```

4. **Commit your changes** with a clear commit message
   ```bash
   git commit -m "Add feature: your feature description"
   ```

5. **Push to your fork**
   ```bash
   git push origin feature/your-feature-name
   ```

6. **Create a Pull Request** on GitHub

### PR Requirements

- [ ] All tests pass
- [ ] Code follows the project's coding standards
- [ ] Documentation is updated if needed
- [ ] PR description clearly describes the changes
- [ ] Commits have clear, descriptive messages

## Coding Standards

### TypeScript Guidelines

- **Use strict typing**: All functions and variables should be properly typed
- **ES Modules**: Use ES modules with `.js` extension in import paths
- **Async/Await**: Prefer async/await over callbacks and Promise chains
- **Error Handling**: Use try/catch blocks with clear error messages

### Code Style

- **Indentation**: Use 2 spaces for indentation
- **Line Length**: Maximum 120 characters per line
- **Naming Conventions**:
  - `camelCase` for variables and functions
  - `PascalCase` for types and classes
  - `UPPER_CASE` for constants
- **Comments**: Use JSDoc comments for functions and classes

### Example Code Structure

```typescript
/**
 * Handle device commissioning with proper error handling
 * @param args - Commission device arguments
 * @returns Promise with commission result
 */
async function handleCommissionDevice(args: CommissionDeviceArgs): Promise<CommissionResult> {
    try {
        const validatedArgs = CommissionDeviceSchema.parse(args);
        
        // Implementation here
        
        return {
            success: true,
            nodeId: nodeIdString
        };
    } catch (error) {
        logger.error('Failed to commission device:', error);
        throw new McpError(ErrorCode.InternalError, `Commission failed: ${error}`);
    }
}
```

## Testing

### Manual Testing

1. **Build the project**
   ```bash
   npm run build
   ```

2. **Test different transports**
   ```bash
   # Test stdio transport
   npm run start
   
   # Test SSE transport
   npm run start:sse
   
   # Test streamable HTTP transport
   npm run start:streamableHttp
   ```

3. **Test with MCP client** (e.g., Claude Desktop)

### Test Checklist

- [ ] All MCP tools work correctly
- [ ] Device commissioning works
- [ ] Device control functions work
- [ ] Error handling is proper
- [ ] No memory leaks or resource issues

## Documentation

### Code Documentation

- Use JSDoc comments for all public functions
- Include parameter types and return types
- Provide usage examples where helpful

### README Updates

- Update the README.md if you add new features
- Include usage examples for new functionality
- Update the API documentation section

### Commit Messages

Use clear, descriptive commit messages:

```
Add device decommissioning functionality

- Implement decommission_device tool
- Add proper cleanup for device connections
- Update documentation with decommission examples
```

## Release Process

1. **Version Bump**: Update version in `package.json`
2. **Changelog**: Update `CHANGELOG.md` with new features
3. **Build**: Run `npm run build` to ensure everything compiles
4. **Test**: Test all functionality thoroughly
5. **Tag**: Create a git tag for the release
6. **Publish**: Publish to npm if you have permissions

## Getting Help

- **GitHub Issues**: For bugs and feature requests
- **GitHub Discussions**: For general questions and discussions
- **Email**: Contact the maintainer directly for security issues

## Recognition

Contributors will be recognized in the project's README and release notes. We appreciate all contributions, no matter how small!

## License

By contributing to Matter Controller MCP Server, you agree that your contributions will be licensed under the MIT License. 