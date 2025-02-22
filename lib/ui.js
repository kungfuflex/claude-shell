"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UI = void 0;
const blessed_1 = __importDefault(require("blessed"));
const chalk_1 = __importDefault(require("chalk"));
class ColorFormatter {
    constructor() {
        this.colors = {
            'green': chalk_1.default.green,
            'blue': chalk_1.default.blue,
            'yellow': chalk_1.default.yellow,
            'red': chalk_1.default.red,
            'white': chalk_1.default.white,
            'gray': chalk_1.default.gray,
            'cyan': chalk_1.default.cyan,
            'magenta': chalk_1.default.magenta
        };
        this.styles = {
            'bold': chalk_1.default.bold,
            'dim': chalk_1.default.dim,
            'italic': chalk_1.default.italic,
            'underline': chalk_1.default.underline
        };
    }
    format(text) {
        // Replace color tags with actual colors
        let result = text;
        const colorPattern = /\{([^}]+)\}(.*?)(?:\{\/\}|$)/g;
        return result.replace(colorPattern, (match, style, content) => {
            const styles = style.split('.');
            let formatted = content;
            styles.forEach(s => {
                if (this.colors[s]) {
                    formatted = this.colors[s](formatted);
                }
                else if (this.styles[s]) {
                    formatted = this.styles[s](formatted);
                }
            });
            return formatted;
        });
    }
}
class UI {
    constructor(options = {}) {
        this.options = {
            debug: false,
            readOnly: false,
            ...options
        };
        this.exitHandler = null;
        this.formatter = new ColorFormatter();
        // Create a screen object
        this.screen = blessed_1.default.screen({
            smartCSR: true,
            title: 'Claude Shell',
            autoPadding: true,
            fastCSR: true,
            cursor: {
                artificial: true,
                shape: 'line',
                blink: true,
                color: null
            }
        });
        // Get terminal size and calculate dimensions
        const terminalHeight = process.stdout.rows || 24;
        const inputHeight = 3; // Fixed input height
        const loadingHeight = 1;
        const chatHeight = terminalHeight - inputHeight - loadingHeight - 1; // Use full available height
        // Create chat history box
        this.chatBox = blessed_1.default.box({
            top: 0,
            left: 0,
            width: '100%',
            height: chatHeight,
            scrollable: true,
            alwaysScroll: true,
            scrollbar: {
                ch: '│',
                track: {
                    bg: 'black'
                },
                style: {
                    fg: 7 // white in blessed
                }
            },
            style: {
                fg: 7 // white in blessed
            },
            border: {
                type: 'line',
                fg: 7
            },
            mouse: true,
            keys: true,
            vi: true,
            clickable: true
        });
        // Create input box
        this.inputBox = blessed_1.default.textbox({
            bottom: 0,
            left: 0,
            width: '100%',
            height: inputHeight,
            inputOnFocus: true,
            border: {
                type: 'line',
                fg: 7 // white in blessed
            },
            style: {
                fg: 7 // white in blessed
            },
            mouse: true,
            keys: true,
            vi: true,
            clickable: true
        });
        // Add loading indicator
        this.loadingText = blessed_1.default.text({
            parent: this.screen,
            top: chatHeight,
            left: 'center',
            width: '100%',
            height: 1,
            align: 'center',
            content: this.formatter.format('{yellow}Thinking...{/}'),
            hidden: true
        });
        // Append boxes to screen
        this.screen.append(this.chatBox);
        this.screen.append(this.inputBox);
        // Set key handlers
        this.screen.key(['escape', 'q', 'C-c'], () => {
            if (this.exitHandler) {
                this.exitHandler();
            }
        });
        this.screen.key(['pageup'], () => {
            const height = typeof this.chatBox.height === 'number' ? this.chatBox.height : parseInt(String(this.chatBox.height));
            this.chatBox.scroll(-height);
        });
        this.screen.key(['pagedown'], () => {
            const height = typeof this.chatBox.height === 'number' ? this.chatBox.height : parseInt(String(this.chatBox.height));
            this.chatBox.scroll(height);
        });
        // Set up mouse wheel scrolling
        this.chatBox.on('wheeldown', () => {
            this.chatBox.scroll(1);
            this.screen.render();
        });
        this.chatBox.on('wheelup', () => {
            this.chatBox.scroll(-1);
            this.screen.render();
        });
        // Handle window resize
        this.screen.on('resize', () => this.handleResize());
        // Focus input
        this.inputBox.focus();
        // Initial render
        this.screen.render();
    }
    formatMessage(role, content) {
        const timestamp = new Date().toLocaleTimeString();
        let prefix;
        switch (role) {
            case 'user':
                prefix = this.formatter.format('{green.bold}You{/}');
                break;
            case 'assistant':
                prefix = this.formatter.format('{blue.bold}Claude{/}');
                break;
            case 'system':
                prefix = this.formatter.format('{yellow.bold}System{/}');
                break;
            case 'tool':
                prefix = this.formatter.format('{cyan.bold}Tool{/}');
                break;
            default:
                prefix = this.formatter.format('{white.bold}Unknown{/}');
        }
        return `${prefix} (${timestamp}):\n${content}`;
    }
    wordWrap(text, width) {
        const words = text.split(/\s+/);
        const lines = [];
        let currentLine = [];
        let currentLength = 0;
        words.forEach(word => {
            if (currentLength + word.length + 1 <= width) {
                currentLine.push(word);
                currentLength += word.length + 1;
            }
            else {
                lines.push(currentLine.join(' '));
                currentLine = [word];
                currentLength = word.length;
            }
        });
        if (currentLine.length > 0) {
            lines.push(currentLine.join(' '));
        }
        return lines.join('\n');
    }
    addMessage(role, content) {
        // Handle tool output formatting
        if (role === 'tool' && typeof content === 'object') {
            if (content.output) {
                this.addMessage('tool', `Output: ${content.output}`);
            }
            if (content.error) {
                this.addMessage('tool', `Error: ${content.error}`);
            }
            if (content.base64_image) {
                this.addMessage('tool', 'Screenshot captured');
            }
            return;
        }
        // Get available width for word wrapping
        const chatBoxWidth = typeof this.chatBox.width === 'number' ? this.chatBox.width : parseInt(String(this.chatBox.width));
        const availableWidth = chatBoxWidth - 2;
        // Format and word wrap the message
        const formattedMessage = this.formatMessage(role, this.wordWrap(String(content), availableWidth));
        // Add new message
        this.chatBox.pushLine(formattedMessage);
        if (role !== 'assistant') {
            this.chatBox.pushLine(''); // Empty line for spacing except for assistant's first line
        }
        // Scroll to bottom
        this.chatBox.setScrollPerc(100);
        this.screen.render();
    }
    appendContent(text) {
        // Simply append the new content, preserving linebreaks
        if (text.includes('\n')) {
            // If text contains newlines, append each line separately
            const lines = text.split('\n');
            for (const line of lines) {
                if (line.trim()) {
                    this.chatBox.insertBottom(line);
                }
            }
        }
        else if (text.trim()) {
            // For single-line content, just append it
            this.chatBox.insertBottom(text);
        }
        // Scroll to bottom
        this.chatBox.setScrollPerc(100);
        this.screen.render();
    }
    showLoading() {
        this.loadingText.show();
        this.screen.render();
    }
    hideLoading() {
        this.loadingText.hide();
        this.screen.render();
    }
    clearInput() {
        this.inputBox.setValue('');
        this.screen.render();
    }
    getInput() {
        return this.inputBox.getValue();
    }
    onExit(callback) {
        this.exitHandler = callback;
    }
    onSubmit(callback) {
        this.inputBox.key('enter', async () => {
            const text = this.getInput().trim();
            if (text) {
                this.clearInput();
                callback(text);
            }
            this.inputBox.focus();
        });
    }
    // Handle window resize
    handleResize() {
        // Recalculate dimensions
        const terminalHeight = process.stdout.rows || 24;
        const inputHeight = 3; // Fixed input height
        const loadingHeight = 1;
        const chatHeight = terminalHeight - inputHeight - loadingHeight - 1; // Use full available height
        // Update component sizes
        this.chatBox.height = chatHeight;
        this.inputBox.height = inputHeight;
        this.loadingText.top = chatHeight;
        // Re-render
        this.screen.render();
    }
    destroy() {
        this.screen.destroy();
    }
}
exports.UI = UI;
//# sourceMappingURL=ui.js.map