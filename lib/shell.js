"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Shell = void 0;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const dotenv = __importStar(require("dotenv"));
const events_1 = require("events");
const fs_1 = require("fs");
const path = __importStar(require("path"));
const os_1 = require("os");
const ora_1 = __importDefault(require("ora"));
dotenv.config();
class StealthBrowser {
    constructor() {
        this.cookieJar = new Map();
        this.userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Safari/605.1.15',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        ];
        this.currentUserAgent = this.getRandomUserAgent();
    }
    getRandomUserAgent() {
        const index = Math.floor(Math.random() * this.userAgents.length);
        return this.userAgents[index];
    }
    rotateUserAgent() {
        this.currentUserAgent = this.getRandomUserAgent();
    }
    getCookiesForDomain(url) {
        const domain = new URL(url).hostname;
        return this.cookieJar.get(domain) || '';
    }
    updateCookies(url, setCookieHeader) {
        if (!setCookieHeader)
            return;
        const domain = new URL(url).hostname;
        const currentCookies = this.cookieJar.get(domain) || '';
        // Handle single cookie header
        const cookieValue = setCookieHeader.split(';')[0]; // Get only the name=value part
        this.cookieJar.set(domain, currentCookies ? `${currentCookies}; ${cookieValue}` : cookieValue);
    }
    async fetch(url, options = {}) {
        const headers = {
            'User-Agent': this.currentUserAgent,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Cookie': this.getCookiesForDomain(url),
            ...options.headers,
        };
        const response = await fetch(url, {
            ...options,
            headers,
        });
        // Update cookies from response
        const setCookieHeader = response.headers.get('set-cookie');
        this.updateCookies(url, setCookieHeader);
        // Rotate user agent occasionally (20% chance)
        if (Math.random() < 0.2) {
            this.rotateUserAgent();
        }
        return response;
    }
    async searchGoogle(query) {
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
        try {
            const response = await this.fetch(searchUrl);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return await response.text();
        }
        catch (error) {
            throw new Error(`Failed to search Google: ${error.message}`);
        }
    }
}
const DEFAULT_MODEL = "claude-3-5-sonnet-20241022";
const INTERRUPT_TEXT = "(user stopped or interrupted and wrote the following)";
const INTERRUPT_TOOL_ERROR = "human stopped or interrupted tool execution";
class Shell extends events_1.EventEmitter {
    constructor(options = {}) {
        super();
        this.messages = [];
        this.tools = {};
        this.isRunning = false;
        this.pendingToolUseIds = [];
        this.configDir = path.join((0, os_1.homedir)(), ".anthropic");
        this.model = options.model || DEFAULT_MODEL;
        this.maxRecentImages = options.maxRecentImages || 3;
        this.systemPromptSuffix = options.systemPromptSuffix || "";
        this.browser = new StealthBrowser();
        const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
        if (apiKey) {
            this.client = new sdk_1.default({ apiKey });
        }
    }
    /**
     * Perform a stealth browser fetch request
     * @param url The URL to fetch
     * @param options Optional fetch options
     * @returns Promise<Response>
     */
    async stealthFetch(url, options = {}) {
        return this.browser.fetch(url, options);
    }
    /**
     * Perform a Google search with stealth browser
     * @param query The search query
     * @returns Promise<string> The search results HTML
     */
    async googleSearch(query) {
        return this.browser.searchGoogle(query);
    }
    async ensureClient() {
        if (!this.client) {
            const apiKey = await this.loadFromStorage("api_key");
            if (!apiKey) {
                throw new Error("No API key provided. Set ANTHROPIC_API_KEY environment variable or provide it via options.");
            }
            this.client = new sdk_1.default({ apiKey });
        }
    }
    async loadFromStorage(filename) {
        try {
            const filePath = path.join(this.configDir, filename);
            const data = await fs_1.promises.readFile(filePath, "utf-8");
            return data.trim();
        }
        catch {
            return null;
        }
    }
    async saveToStorage(filename, data) {
        try {
            await fs_1.promises.mkdir(this.configDir, { recursive: true });
            const filePath = path.join(this.configDir, filename);
            await fs_1.promises.writeFile(filePath, data);
            await fs_1.promises.chmod(filePath, 0o600);
        }
        catch (error) {
            console.error("Error saving to storage:", error);
        }
    }
    setToolResult(result, toolId) {
        if (toolId) {
            this.tools[toolId] = result;
        }
        this.emit("message", { role: "tool", content: result });
    }
    maybeAddInterruptionBlocks() {
        if (!this.isRunning || this.pendingToolUseIds.length === 0) {
            return [];
        }
        const result = [];
        // Handle any pending tool uses that were interrupted
        for (const toolId of this.pendingToolUseIds) {
            this.tools[toolId] = { error: INTERRUPT_TOOL_ERROR };
            result.push({
                type: "tool_result",
                tool_use_id: toolId,
                content: INTERRUPT_TOOL_ERROR,
                is_error: true,
            });
        }
        this.pendingToolUseIds = [];
        result.push({
            type: "text",
            text: INTERRUPT_TEXT,
        });
        return result;
    }
    async processMessage(message) {
        if (this.isRunning) {
            throw new Error("Another message is already being processed");
        }
        try {
            await this.ensureClient();
            this.isRunning = true;
            // Add user message
            this.emit("message", { role: "user", content: message });
            const blocks = [
                ...this.maybeAddInterruptionBlocks(),
                { type: "text", text: message },
            ];
            this.messages.push({
                role: "user",
                content: blocks,
            });
            // Start message stream
            const spinner = (0, ora_1.default)("Claude is thinking...").start();
            let currentMessage = "";
            const stream = await this.client.messages.create({
                model: this.model,
                max_tokens: 4096,
                messages: this.messages.map((msg) => ({
                    role: msg.role,
                    content: msg.content,
                })),
                stream: true,
                system: this.getSystemPrompt(),
            });
            for await (const chunk of stream) {
                const event = chunk;
                if (event.type === "message_start") {
                    continue;
                }
                if (event.type === "content_block_start") {
                    if (currentMessage) {
                        this.emit("message", {
                            role: "assistant",
                            content: currentMessage,
                        });
                        currentMessage = "";
                    }
                    continue;
                }
                if (event.type === "content_block_delta" && event.delta?.text) {
                    currentMessage += event.delta.text;
                    spinner.text = `Claude: ${currentMessage.slice(-50)}...`;
                }
                if (event.usage_info) {
                    continue;
                }
                if (event.error) {
                    throw new Error(String(event.error));
                }
                if (event.tool_calls && Array.isArray(event.tool_calls)) {
                    if (currentMessage) {
                        this.emit("message", {
                            role: "assistant",
                            content: currentMessage,
                        });
                        currentMessage = "";
                    }
                    for (const tool of event.tool_calls) {
                        this.pendingToolUseIds.push(tool.id);
                        this.emit("toolUse", {
                            type: "tool_use",
                            name: tool.type,
                            parameters: tool.parameters,
                        });
                    }
                }
                if (event.tool_results && Array.isArray(event.tool_results)) {
                    for (const result of event.tool_results) {
                        const idx = this.pendingToolUseIds.indexOf(result.id);
                        if (idx > -1) {
                            this.pendingToolUseIds.splice(idx, 1);
                        }
                    }
                }
            }
            if (currentMessage) {
                this.emit("message", {
                    role: "assistant",
                    content: currentMessage,
                });
                this.messages.push({
                    role: "assistant",
                    content: currentMessage,
                });
            }
            spinner.stop();
        }
        catch (error) {
            this.emit("error", error);
        }
        finally {
            this.isRunning = false;
        }
    }
    getSystemPrompt() {
        const basePrompt = `You are a helpful AI assistant that can use a computer to help users accomplish their goals. You have access to a set of tools that allow you to interact with a computer through mouse and keyboard actions, run shell commands, manipulate files, and perform web searches.

Some important notes:
- You will control a real computer, so be careful with destructive actions
- Always check screenshots and coordinates before clicking
- For file paths, prefer full paths starting with /
- Wait for applications to load after starting them
- Be patient and thorough in accomplishing the user's goals
- You can search the web for up-to-date information using the stealthFetch and googleSearch methods
- Web searches are done with a stealth browser that simulates real user behavior and manages cookies

Your available tools are:
1. computer - Control mouse and keyboard
2. bash - Run shell commands 
3. str_replace_editor - View and edit files
4. stealthFetch - Fetch web content with browser-like behavior
5. googleSearch - Search Google with stealth browser

${this.systemPromptSuffix}`;
        return basePrompt;
    }
}
exports.Shell = Shell;
//# sourceMappingURL=shell.js.map