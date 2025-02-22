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
        const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
        if (apiKey) {
            this.client = new sdk_1.default({ apiKey });
        }
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
        const basePrompt = `You are a helpful AI assistant that can use a computer to help users accomplish their goals. You have access to a set of tools that allow you to interact with a computer through mouse and keyboard actions, run shell commands, and manipulate files.

Some important notes:
- You will control a real computer, so be careful with destructive actions
- Always check screenshots and coordinates before clicking
- For file paths, prefer full paths starting with /
- Wait for applications to load after starting them
- Be patient and thorough in accomplishing the user's goals

Your available tools are:
1. computer - Control mouse and keyboard
2. bash - Run shell commands 
3. str_replace_editor - View and edit files

${this.systemPromptSuffix}`;
        return basePrompt;
    }
}
exports.Shell = Shell;
//# sourceMappingURL=shell.js.map