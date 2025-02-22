import { EventEmitter } from "events";
interface ToolResult {
    output?: string;
    error?: string;
    base64_image?: string;
}
export interface ShellOptions {
    apiKey?: string;
    model?: string;
    systemPromptSuffix?: string;
    maxRecentImages?: number;
}
export declare class Shell extends EventEmitter {
    private client;
    private messages;
    private tools;
    private model;
    private configDir;
    private maxRecentImages;
    private systemPromptSuffix;
    private isRunning;
    private pendingToolUseIds;
    constructor(options?: ShellOptions);
    private ensureClient;
    private loadFromStorage;
    private saveToStorage;
    setToolResult(result: ToolResult, toolId?: string): void;
    private maybeAddInterruptionBlocks;
    processMessage(message: string): Promise<void>;
    private getSystemPrompt;
}
export {};
