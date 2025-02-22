import Anthropic from "@anthropic-ai/sdk";
import * as dotenv from "dotenv";
import { EventEmitter } from "events";
import { promises as fs } from "fs";
import * as path from "path";
import { homedir } from "os";
import ora from "ora";

dotenv.config();

class StealthBrowser {
  private cookieJar: Map<string, string>;
  private userAgents: string[];
  private currentUserAgent: string;

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

  private getRandomUserAgent(): string {
    const index = Math.floor(Math.random() * this.userAgents.length);
    return this.userAgents[index];
  }

  private rotateUserAgent(): void {
    this.currentUserAgent = this.getRandomUserAgent();
  }

  private getCookiesForDomain(url: string): string {
    const domain = new URL(url).hostname;
    return this.cookieJar.get(domain) || '';
  }

  private updateCookies(url: string, setCookieHeader: string | null): void {
    if (!setCookieHeader) return;
    
    const domain = new URL(url).hostname;
    const currentCookies = this.cookieJar.get(domain) || '';
    
    // Handle single cookie header
    const cookieValue = setCookieHeader.split(';')[0]; // Get only the name=value part
    
    this.cookieJar.set(domain, currentCookies ? `${currentCookies}; ${cookieValue}` : cookieValue);
  }

  public async fetch(url: string, options: RequestInit = {}): Promise<Response> {
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

  public async searchGoogle(query: string): Promise<string> {
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    try {
      const response = await this.fetch(searchUrl);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return await response.text();
    } catch (error) {
      throw new Error(`Failed to search Google: ${error.message}`);
    }
  }
}

interface ToolResult {
  output?: string;
  error?: string;
  base64_image?: string;
}

interface Tool {
  type: string;
  name: string;
  parameters: Record<string, any>;
}

export interface ShellOptions {
  apiKey?: string;
  model?: string;
  systemPromptSuffix?: string;
  maxRecentImages?: number;
}

const DEFAULT_MODEL = "claude-3-5-sonnet-20241022";
const INTERRUPT_TEXT = "(user stopped or interrupted and wrote the following)";
const INTERRUPT_TOOL_ERROR = "human stopped or interrupted tool execution";

type StreamEvent = {
  type: string;
  delta?: {
    type: string;
    text?: string;
  };
  error?: string;
  tool_calls?: Array<{
    id: string;
    type: string;
    parameters: Record<string, any>;
  }>;
  tool_results?: Array<{
    id: string;
  }>;
  usage_info?: Record<string, any>;
};

interface ConversationMessage {
  role: "user" | "assistant";
  content: string | any[];
}

export class Shell extends EventEmitter {
  private client: Anthropic;
  private messages: ConversationMessage[] = [];
  private tools: Record<string, ToolResult> = {};
  private model: string;
  private configDir: string;
  private maxRecentImages: number;
  private systemPromptSuffix: string;
  private isRunning: boolean = false;
  private pendingToolUseIds: string[] = [];
  private browser: StealthBrowser;

  constructor(options: ShellOptions = {}) {
    super();
    this.configDir = path.join(homedir(), ".anthropic");
    this.model = options.model || DEFAULT_MODEL;
    this.maxRecentImages = options.maxRecentImages || 3;
    this.systemPromptSuffix = options.systemPromptSuffix || "";
    this.browser = new StealthBrowser();

    const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      this.client = new Anthropic({ apiKey });
    }
  }

  /**
   * Perform a stealth browser fetch request
   * @param url The URL to fetch
   * @param options Optional fetch options
   * @returns Promise<Response>
   */
  public async stealthFetch(url: string, options: RequestInit = {}): Promise<Response> {
    return this.browser.fetch(url, options);
  }

  /**
   * Perform a Google search with stealth browser
   * @param query The search query
   * @returns Promise<string> The search results HTML
   */
  public async googleSearch(query: string): Promise<string> {
    return this.browser.searchGoogle(query);
  }

  private async ensureClient(): Promise<void> {
    if (!this.client) {
      const apiKey = await this.loadFromStorage("api_key");
      if (!apiKey) {
        throw new Error(
          "No API key provided. Set ANTHROPIC_API_KEY environment variable or provide it via options.",
        );
      }
      this.client = new Anthropic({ apiKey });
    }
  }

  private async loadFromStorage(filename: string): Promise<string | null> {
    try {
      const filePath = path.join(this.configDir, filename);
      const data = await fs.readFile(filePath, "utf-8");
      return data.trim();
    } catch {
      return null;
    }
  }

  private async saveToStorage(filename: string, data: string): Promise<void> {
    try {
      await fs.mkdir(this.configDir, { recursive: true });
      const filePath = path.join(this.configDir, filename);
      await fs.writeFile(filePath, data);
      await fs.chmod(filePath, 0o600);
    } catch (error) {
      console.error("Error saving to storage:", error);
    }
  }

  public setToolResult(result: ToolResult, toolId?: string): void {
    if (toolId) {
      this.tools[toolId] = result;
    }
    this.emit("message", { role: "tool", content: result });
  }

  private maybeAddInterruptionBlocks(): any[] {
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

  public async processMessage(message: string): Promise<void> {
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
      const spinner = ora("Claude is thinking...").start();

      let currentMessage = "";

      const stream = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        messages: this.messages.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })) as any[],
        stream: true,
        system: this.getSystemPrompt(),
      });

      for await (const chunk of stream) {
        const event = chunk as StreamEvent;

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
    } catch (error) {
      this.emit("error", error);
    } finally {
      this.isRunning = false;
    }
  }

  private getSystemPrompt(): string {
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
