# claude-shell

A CLI tool for controlling your computer using Claude AI, with capabilities for web browsing, file manipulation, and system interaction.

## ⚠️ Security Warning

Never provide access to sensitive accounts or data, as malicious web content can potentially hijack Claude's behavior. The tool has full access to:
- Execute shell commands 
- Control mouse and keyboard
- Read and modify files
- Access web content

Use in a controlled environment and carefully review any destructive actions before confirming.

## Installation

```bash
npm install -g claude-shell
# or
pnpm add -g claude-shell
```

## Setup

The tool requires either an Anthropic API key or AWS Bedrock credentials.

### Option 1: Anthropic API Key
```bash
export ANTHROPIC_API_KEY="your-key-here"
```

### Option 2: AWS Bedrock
```bash
export AWS_ACCESS_KEY_ID="your-key"
export AWS_SECRET_ACCESS_KEY="your-secret"
export AWS_DEFAULT_REGION="your-region"
```

## Usage

```bash
claude-shell [options]

Options:
  -k, --api-key <key>        Anthropic API key
  -m, --model <model>        Model to use (default: claude-3-5-sonnet-20241022)
  -s, --system-prompt <str>  Additional system prompt instructions  
  -i, --max-images <num>     Maximum number of recent images to include (default: 3)
  -d, --debug               Enable debug mode with detailed logging
  -b, --blessed            Use blessed UI interface instead of readline
  -h, --help              Display help information
```

## Features

- **Natural Language Control**: Control your computer through conversational commands
- **System Interaction**: Execute shell commands and control mouse/keyboard
- **File Management**: View and edit files with natural language instructions
- **Web Interaction**: Browse websites and perform searches with stealth browser capabilities
- **Two UI Modes**:
  - Traditional readline interface (default)
  - Full-screen blessed interface with rich formatting (`-b` flag)

## Examples

```bash
# Start with default settings
claude-shell

# Use blessed UI with debug logging
claude-shell -b -d

# Use custom model and system prompt
claude-shell -m claude-3-5-opus-20240229 -s "Focus on automation tasks"
```

## License

ISC License

