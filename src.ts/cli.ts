#!/usr/bin/env node

import { program } from "commander";
import inquirer from "inquirer";
import chalk from "chalk";
import { promises as fs } from "fs";
import { Shell } from "./shell.js";
import { UI } from "./ui.js";

// Constants
const WARNING_TEXT =
  "⚠️ Security Alert: Never provide access to sensitive accounts or data, as malicious web content can hijack Claude's behavior";

async function main() {
  // Setup CLI program
  program
    .name("claude-shell")
    .description("CLI tool for controlling computer using Claude AI")
    .option("-k, --api-key <key>", "Anthropic API key")
    .option(
      "-m, --model <model>",
      "Model to use (default: claude-3-5-sonnet-20241022)",
    )
    .option(
      "-s, --system-prompt <prompt>",
      "Additional system prompt instructions",
    )
    .option(
      "-i, --max-images <number>",
      "Maximum number of recent images to include",
      "3",
    )
    .option("-d, --debug", "Enable debug mode with detailed logging", false)
    .option(
      "-b, --blessed",
      "Use blessed UI interface instead of readline",
      false,
    )
    .parse(process.argv);

  const options = program.opts();

  // Initialize Shell
  const shell = new Shell({
    apiKey: options.apiKey,
    model: options.model,
    systemPromptSuffix: options.systemPrompt,
    maxRecentImages: parseInt(options.maxImages),
    debug: options.debug,
    useBlessed: options.blessed,
  });

  // Setup event handlers
  if (!options.blessed) {
    shell.on("message", ({ role, content }) => {
      switch (role) {
        case "user":
          console.log(chalk.blue("You:"), content);
          break;
        case "assistant":
          console.log(chalk.green("Claude:"), content);
          break;
        case "tool":
          const result = content as {
            output?: string;
            error?: string;
            base64_image?: string;
          };
          if (result.output) {
            console.log(chalk.cyan("Tool Output:"), result.output);
          }
          if (result.error) {
            console.log(chalk.red("Tool Error:"), result.error);
          }
          if (result.base64_image) {
            console.log(chalk.yellow("Screenshot captured"));
          }
          break;
      }
    });
  }

  if (!options.blessed) {
    shell.on("error", (error) => {
      console.error(chalk.red("Error:"), error.message);
    });
  }

  // Handle tool use events by delegating to the appropriate handler
  shell.on("toolUse", async (tool) => {
    let result;

    switch (tool.name) {
      case "computer":
        result = await handleComputerTool(tool.parameters);
        break;
      case "bash":
        result = await handleBashTool(tool.parameters);
        break;
      case "str_replace_editor":
        result = await handleEditorTool(tool.parameters);
        break;
      default:
        result = { error: `Unknown tool: ${tool.name}` };
    }

    shell.setToolResult(result);
  });

  if (options.blessed) {
    // Initialize blessed UI
    const ui = new UI({ debug: options.debug });

    // Show warning
    ui.addMessage("system", WARNING_TEXT);

    // Setup UI event handlers
    ui.onSubmit(async (text) => {
      if (text.toLowerCase() === "exit" || text.toLowerCase() === "quit") {
        process.exit(0);
      }
      ui.showLoading();
      await shell.processMessage(text);
      ui.hideLoading();
    });

    // Handle shell events in UI
    shell.on("message", ({ role, content }) => {
      ui.addMessage(role, content);
    });

    shell.on("append_content", (text) => {
      ui.appendContent(text);
    });

    shell.on("error", (error) => {
      ui.addMessage("system", chalk.red("Error: " + error.message));
    });
  } else {
    // Use traditional readline interface
    console.log(chalk.yellow(WARNING_TEXT));
    console.log();

    // Interactive prompt loop
    while (true) {
      const { prompt } = await inquirer.prompt([
        {
          type: "input",
          name: "prompt",
          message: "Enter your request (or Ctrl+C to exit):",
          validate: (input) =>
            input.trim().length > 0 || "Please enter a request",
        },
      ]);

      if (prompt.toLowerCase() === "exit" || prompt.toLowerCase() === "quit") {
        break;
      }

      await shell.processMessage(prompt);
    }
  }
}

// Tool handlers
async function handleComputerTool(params: any) {
  const { exec } = require("child_process");
  const xdoCommand = buildXdoCommand(params);

  if (params.action === "screenshot") {
    // For screenshots, use imagemagick's import command
    return new Promise((resolve) => {
      exec(
        "DISPLAY=:1 import -window root /tmp/screenshot.png",
        async (error: Error) => {
          if (error) {
            resolve({ error: error.message });
            return;
          }

          try {
            const imageData = await fs.readFile("/tmp/screenshot.png");
            const base64Image = imageData.toString("base64");
            resolve({ base64_image: base64Image });
          } catch (err) {
            resolve({ error: "Failed to capture screenshot" });
          }
        },
      );
    });
  }

  return new Promise((resolve) => {
    exec(
      `DISPLAY=:1 xdotool ${xdoCommand}`,
      (error: Error, stdout: string, stderr: string) => {
        if (error) {
          resolve({ error: error.message });
        } else if (stderr) {
          resolve({ error: stderr });
        } else {
          resolve({ output: stdout || "Action completed successfully" });
        }
      },
    );
  });
}

function buildXdoCommand(params: any): string {
  const { action, coordinate, text } = params;

  switch (action) {
    case "mouse_move":
      return `mousemove ${coordinate[0]} ${coordinate[1]}`;
    case "left_click":
      return "click 1";
    case "right_click":
      return "click 3";
    case "middle_click":
      return "click 2";
    case "double_click":
      return "click --repeat 2 1";
    case "left_click_drag":
      return `mousedown 1 mousemove ${coordinate[0]} ${coordinate[1]} mouseup 1`;
    case "key":
      return `key ${text}`;
    case "type":
      return `type ${JSON.stringify(text)}`; // Use JSON.stringify to handle special characters
    case "cursor_position":
      return "getmouselocation";
    default:
      throw new Error(`Unknown computer action: ${action}`);
  }
}

async function handleBashTool(params: any) {
  const { spawn } = require("child_process");

  return new Promise((resolve) => {
    if (params.restart === true) {
      resolve({ output: "Tool restarted" });
      return;
    }

    const process = spawn("bash", ["-c", params.command]);
    let stdout = "";
    let stderr = "";

    process.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    process.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    process.on("close", (code: number) => {
      if (code !== 0) {
        resolve({ error: stderr || "Command failed" });
      } else {
        resolve({ output: stdout || stderr });
      }
    });

    // Set a timeout to kill long-running processes
    setTimeout(() => {
      process.kill();
      resolve({ error: "Command timed out after 30 seconds" });
    }, 30000);
  });
}

async function handleEditorTool(params: any) {
  const {
    command,
    path,
    file_text,
    old_str,
    new_str,
    insert_line,
    view_range,
  } = params;

  try {
    switch (command) {
      case "view": {
        const content = await fs.readFile(path, "utf-8");
        if (view_range) {
          const lines = content.split("\n");
          const [start, end] = view_range;
          return {
            output: lines.slice(start - 1, end).join("\n"),
          };
        }
        return { output: content };
      }

      case "create":
        await fs.writeFile(path, file_text);
        return { output: `File created: ${path}` };

      case "str_replace": {
        const content = await fs.readFile(path, "utf-8");
        if (!content.includes(old_str)) {
          return { error: "Old string not found in file" };
        }
        const newContent = content.replace(old_str, new_str || "");
        await fs.writeFile(path, newContent);
        return { output: `File updated: ${path}` };
      }

      case "insert": {
        const content = await fs.readFile(path, "utf-8");
        const lines = content.split("\n");
        lines.splice(insert_line, 0, new_str);
        await fs.writeFile(path, lines.join("\n"));
        return { output: `Content inserted at line ${insert_line}` };
      }

      case "undo_edit":
        // In a real implementation, you'd want to maintain an undo history
        return { error: "Undo not implemented" };

      default:
        return { error: `Unknown editor command: ${command}` };
    }
  } catch (error: any) {
    return { error: error.message };
  }
}

export async function run() {
  let usingBlessed = false;

  // Register signal handlers
  const signalHandler = () => {
    if (!usingBlessed) {
      console.log(chalk.yellow("\nGoodbye!"));
      process.exit(0);
    }
  };

  const errorHandler = (error: Error) => {
    if (!usingBlessed) {
      console.error(chalk.red("Uncaught Exception:"), error);
      process.exit(1);
    }
  };

  process.on("SIGINT", signalHandler);
  process.on("uncaughtException", errorHandler);

  // Start the CLI
  try {
    const options = program.opts();
    usingBlessed = options.blessed;
    await main();
  } catch (error) {
    if (!usingBlessed) {
      console.error(chalk.red("Fatal Error:"), error);
      process.exit(1);
    }
  }
}
