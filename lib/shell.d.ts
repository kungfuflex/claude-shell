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
    private browser;
    constructor(options?: ShellOptions);
    /**
     * Perform a stealth browser fetch request
     * @param url The URL to fetch
     * @param options Optional fetch options
     * @returns Promise<Response>
     */
    stealthFetch(url: string, options?: RequestInit): Promise<Response>;
    /**
     * Perform a Google search with stealth browser
     * @param query The search query
     * @returns Promise<string> The search results HTML
     */
    googleSearch(query: string): Promise<string>;
    private ensureClient;
    private loadFromStorage;
    private saveToStorage;
    setToolResult(result: ToolResult, toolId?: string): void;
    private maybeAddInterruptionBlocks;
    processMessage(message: string): Promise<void>;
    private getSystemPrompt;
}
export {};
