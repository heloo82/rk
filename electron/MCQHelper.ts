// MCQHelper.ts - Handles MCQ detection and answer overlay
import { BrowserWindow, screen } from "electron";
import * as axios from "axios";
import { ScreenshotHelper } from "./ScreenshotHelper";
import { configHelper } from "./ConfigHelper";
import * as fs from "fs";
import * as path from "path";

interface GeminiMessage {
  role: string;
  parts: Array<{
    text?: string;
    inlineData?: {
      mimeType: string;
      data: string;
    };
  }>;
}

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{
        text: string;
      }>;
    };
    finishReason: string;
  }>;
}

export class MCQHelper {
  private overlayWindow: BrowserWindow | null = null;
  private screenshotHelper: ScreenshotHelper;

  constructor(screenshotHelper: ScreenshotHelper) {
    this.screenshotHelper = screenshotHelper;
  }

  public async captureMCQAndShowAnswer(): Promise<void> {
    try {
      console.log("Starting MCQ capture and analysis...");

      // Don't hide/show the main window to prevent focus loss
      // This prevents the "Navigated Away" warning
      this.hideOverlay();
      await new Promise(resolve => setTimeout(resolve, 500));

      const screenshotPath = await this.screenshotHelper.takeScreenshot(() => {}, () => {});
      console.log("Screenshot taken:", screenshotPath);

      let { preview, fullText } = await this.analyzeMCQ(screenshotPath);

      console.log("\n=========== GEMINI RAW OUTPUT ===========\n");
      console.log(fullText || "No response text");
      console.log("\n=========================================\n");

      if (fullText) {
        const logDir = path.join(__dirname, "gemini_logs");
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
        const logFile = path.join(logDir, `gemini_${Date.now()}.txt`);
        fs.writeFileSync(logFile, fullText, "utf-8");
        console.log(`Full response saved to: ${logFile}`);
      }

      await this.showAnswerOverlay(preview || "N");
    } catch (error) {
      console.error("Error in MCQ capture and analysis:", error);
      await this.showAnswerOverlay("N");
    }
  }

  private async analyzeMCQ(
    screenshotPath: string
  ): Promise<{ preview: string | null; fullText: string | null }> {
    try {
      const config = configHelper.loadConfig();
      if (!config.apiKey) {
        console.error("No API key configured");
        return { preview: null, fullText: null };
      }

      const screenshotData = fs.readFileSync(screenshotPath).toString("base64");

      const prompt = `
You are an expert at analyzing multiple choice questions (MCQs).

From the screenshot:
1. Identify ONLY the very first complete MCQ that appears from top to bottom in the image.
2. Extract the full MCQ question text.
3. If the options are not labeled with A, B, C, D or 1, 2, 3, 4, you MUST assign them sequentially (A, B, C, D) before giving the answer.
4. Maintain exactly 4 options.
5. Determine the correct answer and explain your reasoning.
6. Respond in the format:

<MCQ question>
A) <option 1>
B) <option 2>
C) <option 3>
D) <option 4>

<Reasoning and explanation>
ANSWER: <answer letter/number>

If no MCQ is found, respond only with "NO_MCQ".
Do NOT include more than one MCQ in your response.
`;

      const geminiMessages: GeminiMessage[] = [
        {
          role: "user",
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: "image/png",
                data: screenshotData,
              },
            },
          ],
        },
      ];

      const response = await axios.default.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${config.apiKey}`,
        {
          contents: geminiMessages,
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 500,
          },
        }
      );

      const responseData = response.data as GeminiResponse;
      if (!responseData.candidates || responseData.candidates.length === 0) {
        console.error("Empty response from Gemini API");
        return { preview: null, fullText: null };
      }

      const responseText =
        responseData.candidates[0].content.parts[0].text.trim();

      if (responseText === "NO_MCQ") {
        return { preview: null, fullText: responseText };
      }

      const answerMatch = responseText.match(/ANSWER:\s*([A-Da-d1-4])/);
      const answerLetter = answerMatch ? answerMatch[1].toLowerCase() : null;

      let preview: string | null = null;
      if (answerLetter) {
        // Match the correct option text (case-insensitive, handles A) or A. etc.)
        const optionRegex = new RegExp(
          `^${answerLetter}\\)?[.)]?\\s*(.+)$`,
          "im"
        );
        const optionMatch = responseText.match(optionRegex);
        if (optionMatch && optionMatch[1]) {
          const firstTwo = optionMatch[1].trim().substring(0, 2).toLowerCase();
          preview = `${answerLetter}->${firstTwo}`;
        }
      }

      return {
        preview,
        fullText: responseText,
      };
    } catch (error) {
      console.error("Error analyzing MCQ:", error);
      return { preview: null, fullText: null };
    }
  }

  private async showAnswerOverlay(shortOutput: string): Promise<void> {
    try {
      this.hideOverlay();

      const primaryDisplay = screen.getPrimaryDisplay();
      const { height: screenHeight } = primaryDisplay.workAreaSize;

      const overlayX = 20;
      const overlayY = screenHeight - 70;

      const overlayWidth = Math.max(60, shortOutput.length * 14);

      this.overlayWindow = new BrowserWindow({
        width: overlayWidth,
        height: 50,
        x: overlayX,
        y: overlayY,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        focusable: false,
        resizable: false,
        movable: false,
        show: false,
        hasShadow: true,
        opacity: 1.0,
        backgroundColor: "#00FFFFFF",
        type: "panel",
        paintWhenInitiallyHidden: true,
        titleBarStyle: "hidden",
        enableLargerThanScreen: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          scrollBounce: true,
          backgroundThrottling: false,
        },
      });

      this.overlayWindow.setContentProtection(true);
      this.overlayWindow.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
      });
      this.overlayWindow.setAlwaysOnTop(true, "screen-saver", 1);

      const overlayHTML = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      margin: 0;
      padding: 0;
      background: transparent;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      user-select: none;
    }
    .answer {
      background: white;
      color: black;
      font-size: 20px;
      font-weight: bold;
      padding: 6px 10px;
      border-radius: 6px;
      pointer-events: none;
      border: 1px solid #ccc;
    }
  </style>
</head>
<body>
  <div class="answer">${shortOutput.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>
</body>
</html>
`;

      await this.overlayWindow.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(overlayHTML)}`
      );

      this.overlayWindow.showInactive();

      setTimeout(() => {
        this.hideOverlay();
      }, 500); // short display
    } catch (error) {
      console.error("Error showing answer overlay:", error);
    }
  }

  public hideOverlay(): void {
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.close();
      this.overlayWindow = null;
    }
  }

  private getMainWindow(): BrowserWindow | null {
    const allWindows = BrowserWindow.getAllWindows();
    return (
      allWindows.find(
        (window) =>
          !window.isDestroyed() &&
          (window.webContents.getURL().includes("localhost") ||
            window.webContents.getURL().includes("file:"))
      ) || null
    );
  }

  public cleanup(): void {
    this.hideOverlay();
  }
}
