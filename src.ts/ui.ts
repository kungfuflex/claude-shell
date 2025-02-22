import blessed from "blessed";
import chalk from "chalk";

class ColorFormatter {
  private colors: Record<string, any>;
  private styles: Record<string, any>;

  constructor() {
    this.colors = {
      green: chalk.green,
      blue: chalk.blue,
      yellow: chalk.yellow,
      red: chalk.red,
      white: chalk.white,
      gray: chalk.gray,
      cyan: chalk.cyan,
      magenta: chalk.magenta,
    };

    this.styles = {
      bold: chalk.bold,
      dim: chalk.dim,
      italic: chalk.italic,
      underline: chalk.underline,
    };
  }

  format(text: string): string {
    // Replace color tags with actual colors
    let result = text;
    const colorPattern = /\{([^}]+)\}(.*?)(?:\{\/\}|$)/g;

    return result.replace(colorPattern, (match, style, content) => {
      const styles = style.split(".");
      let formatted = content;

      styles.forEach((s) => {
        if (this.colors[s]) {
          formatted = this.colors[s](formatted);
        } else if (this.styles[s]) {
          formatted = this.styles[s](formatted);
        }
      });

      return formatted;
    });
  }
}

export interface UIOptions {
  debug?: boolean;
  readOnly?: boolean;
}

export class UI {
  private screen: blessed.Widgets.Screen;
  private chatBox: blessed.Widgets.BoxElement;
  private inputBox: blessed.Widgets.TextboxElement;
  private loadingText: blessed.Widgets.TextElement;
  private formatter: ColorFormatter;
  private exitHandler: (() => void) | null;
  private options: UIOptions;

  constructor(options: UIOptions = {}) {
    this.options = {
      debug: false,
      readOnly: false,
      ...options,
    };

    this.exitHandler = null;
    this.formatter = new ColorFormatter();

    // Create a screen object
    this.screen = blessed.screen({
      smartCSR: true,
      title: "Claude Shell",
      autoPadding: true,
      fastCSR: true,
      cursor: {
        artificial: true,
        shape: "line",
        blink: true,
        color: null,
      },
    });

    // Get terminal size and calculate dimensions
    const terminalHeight = process.stdout.rows || 24;
    const inputHeight = 3; // Fixed input height
    const loadingHeight = 1;
    const chatHeight = terminalHeight - inputHeight - loadingHeight - 1; // Use full available height

    // Create chat history box
    this.chatBox = blessed.box({
      top: 0,
      left: 0,
      width: "100%",
      height: chatHeight,
      scrollable: true,
      alwaysScroll: true,
      scrollbar: {
        ch: "│",
        track: {
          bg: "black",
        },
        style: {
          fg: 7, // white in blessed
        },
      },
      style: {
        fg: 7, // white in blessed
      },
      border: {
        type: "line",
        fg: 7,
      },
      mouse: true,
      keys: true,
      vi: true,
      clickable: true,
    });

    // Create input box
    this.inputBox = blessed.textbox({
      bottom: 0,
      left: 0,
      width: "100%",
      height: inputHeight,
      inputOnFocus: true,
      border: {
        type: "line",
        fg: 7, // white in blessed
      },
      style: {
        fg: 7, // white in blessed
      },
      mouse: true,
      keys: true,
      vi: true,
      clickable: true,
    });

    // Add loading indicator
    this.loadingText = blessed.text({
      parent: this.screen,
      top: chatHeight,
      left: "center",
      width: "100%",
      height: 1,
      align: "center",
      content: this.formatter.format("{yellow}Thinking...{/}"),
      hidden: true,
    });

    // Append boxes to screen
    this.screen.append(this.chatBox);
    this.screen.append(this.inputBox);

    // Set key handlers
    this.screen.key(["escape", "q", "C-c"], () => {
      if (this.exitHandler) {
        this.exitHandler();
      }
    });
    this.screen.key(["pageup"], () => {
      const height =
        typeof this.chatBox.height === "number"
          ? this.chatBox.height
          : parseInt(String(this.chatBox.height));
      this.chatBox.scroll(-height);
    });
    this.screen.key(["pagedown"], () => {
      const height =
        typeof this.chatBox.height === "number"
          ? this.chatBox.height
          : parseInt(String(this.chatBox.height));
      this.chatBox.scroll(height);
    });

    // Set up mouse wheel scrolling
    this.chatBox.on("wheeldown", () => {
      this.chatBox.scroll(1);
      this.screen.render();
    });

    this.chatBox.on("wheelup", () => {
      this.chatBox.scroll(-1);
      this.screen.render();
    });

    // Handle window resize
    this.screen.on("resize", () => this.handleResize());

    // Focus input
    this.inputBox.focus();

    // Initial render
    this.screen.render();
  }

  private formatMessage(role: string, content: string): string {
    const timestamp = new Date().toLocaleTimeString();
    let prefix;

    switch (role) {
      case "user":
        prefix = this.formatter.format("{green.bold}You{/}");
        break;
      case "assistant":
        prefix = this.formatter.format("{blue.bold}Claude{/}");
        break;
      case "system":
        prefix = this.formatter.format("{yellow.bold}System{/}");
        break;
      case "tool":
        prefix = this.formatter.format("{cyan.bold}Tool{/}");
        break;
      default:
        prefix = this.formatter.format("{white.bold}Unknown{/}");
    }

    return `${prefix} (${timestamp}):\n${content}`;
  }

  private wordWrap(text: string, width: number): string {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let currentLine: string[] = [];
    let currentLength = 0;

    words.forEach((word) => {
      if (currentLength + word.length + 1 <= width) {
        currentLine.push(word);
        currentLength += word.length + 1;
      } else {
        lines.push(currentLine.join(" "));
        currentLine = [word];
        currentLength = word.length;
      }
    });

    if (currentLine.length > 0) {
      lines.push(currentLine.join(" "));
    }

    return lines.join("\n");
  }

  addMessage(
    role: string,
    content: string | any,
    isAppend: boolean = false,
  ): void {
    // Handle tool output formatting
    if (role === "tool" && typeof content === "object") {
      if (content.output) {
        this.addMessage("tool", `Output: ${content.output}`);
      }
      if (content.error) {
        this.addMessage("tool", `Error: ${content.error}`);
      }
      if (content.base64_image) {
        this.addMessage("tool", "Screenshot captured");
      }
      return;
    }

    // Get available width for word wrapping
    const chatBoxWidth =
      typeof this.chatBox.width === "number"
        ? this.chatBox.width
        : parseInt(String(this.chatBox.width));
    const availableWidth = chatBoxWidth - 2;

    // Format and word wrap the message
    const formattedMessage = this.formatMessage(
      role,
      this.wordWrap(String(content), availableWidth),
    );

    if (!isAppend) {
      // Add new message
      this.chatBox.pushLine(formattedMessage);
      if (role !== "assistant") {
        this.chatBox.pushLine(""); // Empty line for spacing except for assistant's first line
      }
    } else {
      // Simply append the new content
      const wrappedContent = this.wordWrap(
        content,
        typeof this.chatBox.width === "number"
          ? this.chatBox.width - 2
          : parseInt(String(this.chatBox.width)) - 2,
      );
      const newLines = wrappedContent.split("\n");

      // Write each new line directly to the box
      for (const line of newLines) {
        if (line.trim()) {
          // Only write non-empty lines
          this.chatBox.insertBottom(line);
        }
      }

      // Make sure we're still at the bottom
      this.chatBox.setScrollPerc(100);
    }

    // Scroll to bottom
    this.chatBox.setScrollPerc(100);
    this.screen.render();
  }

  showLoading(): void {
    this.loadingText.show();
    this.screen.render();
  }

  hideLoading(): void {
    this.loadingText.hide();
    this.screen.render();
  }

  clearInput(): void {
    this.inputBox.setValue("");
    this.screen.render();
  }

  getInput(): string {
    return this.inputBox.getValue();
  }

  onExit(callback: () => void): void {
    this.exitHandler = callback;
  }

  onSubmit(callback: (text: string) => void): void {
    this.inputBox.key("enter", async () => {
      const text = this.getInput().trim();
      if (text) {
        this.clearInput();
        callback(text);
      }
      this.inputBox.focus();
    });
  }

  // Handle window resize
  private handleResize(): void {
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

  destroy(): void {
    this.screen.destroy();
  }
}
