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
const client_bedrock_runtime_1 = require("@aws-sdk/client-bedrock-runtime");
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
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Safari/605.1.15",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
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
        return this.cookieJar.get(domain) || "";
    }
    updateCookies(url, setCookieHeader) {
        if (!setCookieHeader)
            return;
        const domain = new URL(url).hostname;
        const currentCookies = this.cookieJar.get(domain) || "";
        // Handle single cookie header
        const cookieValue = setCookieHeader.split(";")[0]; // Get only the name=value part
        this.cookieJar.set(domain, currentCookies ? `${currentCookies}; ${cookieValue}` : cookieValue);
    }
    async fetch(url, options = {}) {
        const headers = {
            "User-Agent": this.currentUserAgent,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
            "Accept-Encoding": "gzip, deflate, br",
            DNT: "1",
            Connection: "keep-alive",
            "Upgrade-Insecure-Requests": "1",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1",
            Cookie: this.getCookiesForDomain(url),
            ...options.headers,
        };
        const response = await fetch(url, {
            ...options,
            headers,
        });
        // Update cookies from response
        const setCookieHeader = response.headers.get("set-cookie");
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
const DEFAULT_BEDROCK_MODEL = "us.anthropic.claude-3-5-sonnet-20241022-v2:0";
const INTERRUPT_TEXT = "(user stopped or interrupted and wrote the following)";
const INTERRUPT_TOOL_ERROR = "human stopped or interrupted tool execution";
// AWS Bedrock configuration
const AWS_CONFIG = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_DEFAULT_REGION,
};
class Shell extends events_1.EventEmitter {
    logDebug(message, data) {
        if (this.debug) {
            const timestamp = new Date().toISOString();
            const debugMessage = `[DEBUG ${timestamp}] ${message}`;
            if (!this.useBlessed) {
                console.log("\x1b[36m%s\x1b[0m", debugMessage); // Cyan color
                if (data !== undefined) {
                    console.log("\x1b[36m%s\x1b[0m", JSON.stringify(data, null, 2));
                }
            }
            // In blessed mode, emit as a message instead
            else {
                this.emit("message", {
                    role: "system",
                    content: debugMessage + (data ? "\n" + JSON.stringify(data, null, 2) : ""),
                });
            }
        }
    }
    parseToolCallFromText(text) {
        // Common patterns for command-like responses
        const bashPattern = /```(?:bash|shell)?\s*\n?(.*?)\n?```|^\$\s*(.*?)$|^>\s*(.*?)$/m;
        const match = text.match(bashPattern);
        if (match) {
            const command = (match[1] || match[2] || match[3]).trim();
            if (command) {
                return {
                    detected: true,
                    toolCall: {
                        id: `auto-${Date.now()}`,
                        type: 'bash',
                        parameters: {
                            command: command
                        }
                    }
                };
            }
        }
        return { detected: false };
    }
    constructor(options = {}) {
        super();
        this.messages = [];
        this.tools = {};
        this.isRunning = false;
        this.pendingToolUseIds = [];
        this.configDir = path.join((0, os_1.homedir)(), ".anthropic");
        // If AWS credentials are available and useBedrock is true, default to Bedrock
        const hasAwsCredentials = AWS_CONFIG.accessKeyId && AWS_CONFIG.secretAccessKey && AWS_CONFIG.region;
        this.useBedrock = Boolean(hasAwsCredentials);
        // Set model based on client type
        if (this.useBedrock) {
            this.model = options.model || DEFAULT_BEDROCK_MODEL;
            this.bedrockClient = new client_bedrock_runtime_1.BedrockRuntimeClient({
                credentials: {
                    accessKeyId: AWS_CONFIG.accessKeyId,
                    secretAccessKey: AWS_CONFIG.secretAccessKey,
                },
                region: AWS_CONFIG.region,
            });
        }
        else {
            this.model = options.model || DEFAULT_MODEL;
            const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
            if (apiKey) {
                this.client = new sdk_1.default({ apiKey });
            }
        }
        this.maxRecentImages = options.maxRecentImages || 3;
        this.systemPromptSuffix = options.systemPromptSuffix || "";
        this.debug = options.debug || false;
        this.useBlessed = options.useBlessed || false;
        this.browser = new StealthBrowser();
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
        if (this.useBedrock) {
            if (!this.bedrockClient) {
                throw new Error("AWS credentials not found. Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_DEFAULT_REGION environment variables.");
            }
            return;
        }
        if (!this.client) {
            const apiKey = await this.loadFromStorage("api_key");
            if (!apiKey) {
                throw new Error("No API key provided. Set ANTHROPIC_API_KEY environment variable or provide it via options.");
            }
            this.client = new sdk_1.default({ apiKey });
        }
    }
    async *processBedrockStream(messages) {
        const input = {
            anthropic_version: "bedrock-2023-05-31",
            max_tokens: 4096,
            messages: messages,
            system: this.getSystemPrompt(),
        };
        this.logDebug("Input", input);
        const command = new client_bedrock_runtime_1.InvokeModelWithResponseStreamCommand({
            modelId: this.model,
            contentType: "application/json",
            accept: "application/json",
            body: JSON.stringify(input),
        });
        try {
            this.logDebug("Sending Bedrock command", command);
            const response = await this.bedrockClient.send(command);
            const stream = response.body;
            this.logDebug("Response headers", response.$metadata);
            this.logDebug("Stream object initialized", {
                hasStream: !!stream,
                streamType: stream ? typeof stream : "undefined",
                streamProperties: stream ? Object.keys(stream) : [],
            });
            if (!stream) {
                throw new Error("No stream received from Bedrock");
            }
            let fullMessage = "";
            let hasStarted = false;
            for await (const chunk of stream) {
                if (chunk.chunk?.bytes) {
                    const decodedChunk = new TextDecoder().decode(chunk.chunk.bytes);
                    const parsed = JSON.parse(decodedChunk);
                    this.logDebug("Stream chunk received", parsed); // Add logging for each chunk
                    if (parsed.type === "message_start") {
                        if (!hasStarted) {
                            hasStarted = true;
                            yield { type: "message_start" };
                            // Initialize the message content structure like Anthropic API
                            yield {
                                type: "content_block_start",
                                content_block: { type: "text", text: "" },
                            };
                            // Emit initial message to establish the timestamp
                            this.emit("message", {
                                role: "assistant",
                                content: "",
                            });
                        }
                    }
                    else if (parsed.type === "content_block_delta" ||
                        parsed.type === "content_block" ||
                        parsed.type === "message_delta") {
                        const text = parsed.type === "content_block_delta"
                            ? parsed.delta?.text || ""
                            : parsed.type === "message_delta"
                                ? parsed.delta?.text || ""
                                : parsed.text || "";
                        fullMessage += text;
                        // Emit just the new fragment to append
                        // Just append the raw text without role/formatting
                        this.emit("append_content", text);
                        // Yield delta for stream consumers
                        yield {
                            type: "content_block_delta",
                            delta: {
                                type: "text_delta",
                                text: text,
                            },
                            index: parsed.index || 0,
                        };
                    }
                    else if (parsed.type === "error") {
                        throw new Error(`Bedrock error: ${parsed.error || "Unknown error"}`);
                    }
                    else if (parsed.type === "tool_calls") {
                        // Format tool calls like Anthropic API
                        yield {
                            type: "tool_calls",
                            tool_calls: parsed.tool_calls.map((tool) => ({
                                id: tool.id,
                                type: tool.type,
                                parameters: tool.parameters,
                            })),
                        };
                    }
                    else if (parsed.type === "tool_results") {
                        yield {
                            type: "tool_results",
                            tool_results: parsed.tool_results,
                        };
                    }
                }
            }
            // Add the complete message to conversation history
            if (fullMessage) {
                const message = {
                    role: "assistant",
                    content: fullMessage,
                };
                this.logDebug("Message", message);
                this.messages.push(message);
            }
            // Explicitly yield a completion event
            yield { type: "message_stop" };
        }
        catch (error) {
            this.logDebug("Bedrock stream error", {
                error: error.message,
                name: error.name,
                stack: error.stack,
                details: error,
            });
            throw new Error(`Bedrock stream error: ${error.message}`);
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
        this.logDebug("Setting tool result", { toolId, result });
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
            this.logDebug("Processing new message", { message });
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
            let spinner;
            if (!this.useBlessed) {
                spinner = (0, ora_1.default)("Claude is thinking...").start();
            }
            let currentMessage = "";
            const mappedMessages = this.messages.map((msg) => ({
                role: msg.role,
                content: msg.content,
            }));
            const stream = this.useBedrock
                ? await this.processBedrockStream(mappedMessages)
                : await this.client.messages.create({
                    model: this.model,
                    max_tokens: 4096,
                    messages: mappedMessages,
                    stream: true,
                    system: this.getSystemPrompt(),
                });
            for await (const chunk of stream) {
                const event = chunk;
                // Handle stream start
                if (event.type === "message_start") {
                    if (spinner)
                        spinner.text = "Claude is processing...";
                    continue;
                }
                // Handle stream stop
                if (event.type === "message_stop") {
                    if (spinner)
                        spinner.succeed("Claude finished responding");
                    break;
                }
                // Handle content blocks
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
                    const deltaText = event.delta.text;
                    currentMessage += deltaText;
                    // Check if this delta completes a command pattern
                    const { detected, toolCall } = this.parseToolCallFromText(currentMessage);
                    if (detected && toolCall) {
                        // Clear the current message since we're handling it as a tool call
                        currentMessage = "";
                        if (spinner)
                            spinner.text = "Claude is using tools...";
                        this.pendingToolUseIds.push(toolCall.id);
                        // Emit the parsed command as a tool use
                        this.emit("toolUse", {
                            type: "tool_use",
                            name: toolCall.type,
                            parameters: toolCall.parameters,
                            toolId: toolCall.id
                        });
                    }
                    else {
                        // Handle as regular message content
                        if (spinner)
                            spinner.text = `Claude: ${currentMessage.slice(-50)}...`;
                        // Emit each delta chunk as it arrives for real-time display
                        this.emit("message", {
                            role: "assistant",
                            content: event.delta.text
                        });
                    }
                }
                if (event.usage_info) {
                    continue;
                }
                if (event.error) {
                    spinner.fail(`Error: ${String(event.error)}`);
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
                    if (spinner)
                        spinner.text = "Claude is using tools...";
                    for (const tool of event.tool_calls) {
                        this.logDebug("Tool invocation", {
                            toolId: tool.id,
                            type: tool.type,
                            parameters: tool.parameters,
                        });
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
            if (spinner)
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