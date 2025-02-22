import Anthropic from "@anthropic-ai/sdk";
import {
  BedrockRuntimeClient,
  InvokeModelWithResponseStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";
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
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Safari/605.1.15",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
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
    return this.cookieJar.get(domain) || "";
  }

  private updateCookies(url: string, setCookieHeader: string | null): void {
    if (!setCookieHeader) return;

    const domain = new URL(url).hostname;
    const currentCookies = this.cookieJar.get(domain) || "";

    // Handle single cookie header
    const cookieValue = setCookieHeader.split(";")[0]; // Get only the name=value part

    this.cookieJar.set(
      domain,
      currentCookies ? `${currentCookies}; ${cookieValue}` : cookieValue,
    );
  }

  public async fetch(
    url: string,
    options: RequestInit = {},
  ): Promise<Response> {
    const headers = {
      "User-Agent": this.currentUserAgent,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
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
  useBedrock?: boolean;
  debug?: boolean;
  useBlessed?: boolean;
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
  private logDebug(message: string, data?: any): void {
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
          content:
            debugMessage + (data ? "\n" + JSON.stringify(data, null, 2) : ""),
        });
      }
    }
  }
  private client: Anthropic;
  private bedrockClient: BedrockRuntimeClient;
  private messages: ConversationMessage[] = [];
  private tools: Record<string, ToolResult> = {};
  private model: string;
  private configDir: string;
  private maxRecentImages: number;
  private systemPromptSuffix: string;
  private isRunning: boolean = false;
  private pendingToolUseIds: string[] = [];
  private browser: StealthBrowser;
  private useBedrock: boolean;
  private useBlessed: boolean;
  private debug: boolean;

  constructor(options: ShellOptions = {}) {
    super();
    this.configDir = path.join(homedir(), ".anthropic");

    // If AWS credentials are available and useBedrock is true, default to Bedrock
    const hasAwsCredentials =
      AWS_CONFIG.accessKeyId && AWS_CONFIG.secretAccessKey && AWS_CONFIG.region;

    this.useBedrock = Boolean(hasAwsCredentials);

    // Set model based on client type
    if (this.useBedrock) {
      this.model = options.model || DEFAULT_BEDROCK_MODEL;
      this.bedrockClient = new BedrockRuntimeClient({
        credentials: {
          accessKeyId: AWS_CONFIG.accessKeyId!,
          secretAccessKey: AWS_CONFIG.secretAccessKey!,
        },
        region: AWS_CONFIG.region,
      });
    } else {
      this.model = options.model || DEFAULT_MODEL;
      const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
      if (apiKey) {
        this.client = new Anthropic({ apiKey });
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
  public async stealthFetch(
    url: string,
    options: RequestInit = {},
  ): Promise<Response> {
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
    if (this.useBedrock) {
      if (!this.bedrockClient) {
        throw new Error(
          "AWS credentials not found. Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_DEFAULT_REGION environment variables.",
        );
      }
      return;
    }

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
  private async *processBedrockStream(
    messages: any[],
  ): AsyncGenerator<any, void, unknown> {
    const input = {
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 4096,
      messages: messages,
      system: this.getSystemPrompt(),
    };
    this.logDebug("Input", input);

    const command = new InvokeModelWithResponseStreamCommand({
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
          } else if (
            parsed.type === "content_block_delta" ||
            parsed.type === "content_block" ||
            parsed.type === "message_delta"
          ) {
            const text =
              parsed.type === "content_block_delta"
                ? parsed.delta?.text || ""
                : parsed.type === "message_delta"
                  ? parsed.delta?.text || ""
                  : parsed.text || "";
            fullMessage += text;

            // Emit just the new fragment to append
            this.emit("append_message", {
              role: "assistant",
              content: text,
            });

            // Yield delta for stream consumers
            yield {
              type: "content_block_delta",
              delta: {
                type: "text_delta",
                text: text,
              },
              index: parsed.index || 0,
            };
          } else if (parsed.type === "error") {
            throw new Error(
              `Bedrock error: ${parsed.error || "Unknown error"}`,
            );
          } else if (parsed.type === "tool_calls") {
            // Format tool calls like Anthropic API
            yield {
              type: "tool_calls",
              tool_calls: parsed.tool_calls.map((tool: any) => ({
                id: tool.id,
                type: tool.type,
                parameters: tool.parameters,
              })),
            };
          } else if (parsed.type === "tool_results") {
            yield {
              type: "tool_results",
              tool_results: parsed.tool_results,
            };
          }
        }
      }

      // Add the complete message to conversation history
      if (fullMessage) {
        const message: any = {
          role: "assistant",
          content: fullMessage,
        };
        this.logDebug("Message", message);
        this.messages.push(message);
      }

      // Explicitly yield a completion event
      yield { type: "message_stop" };
    } catch (error) {
      this.logDebug("Bedrock stream error", {
        error: error.message,
        name: error.name,
        stack: error.stack,
        details: error,
      });
      throw new Error(`Bedrock stream error: ${error.message}`);
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
    this.logDebug("Setting tool result", { toolId, result });
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
        spinner = ora("Claude is thinking...").start();
      }

      let currentMessage = "";

      const mappedMessages = this.messages.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })) as any[];

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
        const event = chunk as StreamEvent;

        // Handle stream start
        if (event.type === "message_start") {
          if (spinner) spinner.text = "Claude is processing...";
          continue;
        }

        // Handle stream stop
        if (event.type === "message_stop") {
          if (spinner) spinner.succeed("Claude finished responding");
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
          currentMessage += event.delta.text;
          if (spinner) spinner.text = `Claude: ${currentMessage.slice(-50)}...`;
          // Emit each delta chunk as it arrives for real-time display
          this.emit("message", {
            role: "assistant",
            content: event.delta.text,
          });
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

          if (spinner) spinner.text = "Claude is using tools...";
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

      if (spinner) spinner.stop();
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
