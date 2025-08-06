// MCQHelper.ts - Handles MCQ detection and answer overlay
import { BrowserWindow, screen } from "electron"
import * as axios from "axios"
import { ScreenshotHelper } from "./ScreenshotHelper"
import { configHelper } from "./ConfigHelper"

interface GeminiMessage {
  role: string;
  parts: Array<{
    text?: string;
    inlineData?: {
      mimeType: string;
      data: string;
    }
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

  /**
   * Capture screen and analyze MCQ, then show answer overlay
   */
  public async captureMCQAndShowAnswer(): Promise<void> {
    try {
      console.log("Starting MCQ capture and analysis...");
      
      // Hide main window if visible
      const mainWindow = this.getMainWindow();
      let wasMainWindowVisible = false;
      if (mainWindow && !mainWindow.isDestroyed()) {
        wasMainWindowVisible = mainWindow.isVisible();
        if (wasMainWindowVisible) {
          mainWindow.hide();
        }
      }

      // Hide overlay window if it exists
      this.hideOverlay();

      // Wait a moment for windows to hide
      await new Promise(resolve => setTimeout(resolve, 500));

      // Take screenshot
      const screenshotPath = await this.screenshotHelper.takeScreenshot(
        () => {}, // No hide function needed as we already hid windows
        () => {}  // No show function needed
      );

      console.log("Screenshot taken:", screenshotPath);

      // Analyze the screenshot for MCQ
      const answer = await this.analyzeMCQ(screenshotPath);
      
      if (answer) {
        console.log("MCQ answer found:", answer);
        // Show the answer overlay
        await this.showAnswerOverlay(answer);
      } else {
        console.log("No MCQ detected in screenshot");
      }

      // Restore main window visibility if it was visible before
      if (wasMainWindowVisible && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
      }

    } catch (error) {
      console.error("Error in MCQ capture and analysis:", error);
    }
  }

  /**
   * Analyze screenshot for MCQ and return the answer
   */
  private async analyzeMCQ(screenshotPath: string): Promise<string | null> {
    try {
      const config = configHelper.loadConfig();
      
      if (!config.apiKey) {
        console.error("No API key configured");
        return null;
      }

      // Read screenshot data
      const fs = require('fs');
      const screenshotData = fs.readFileSync(screenshotPath).toString('base64');

      const prompt = `
You are an expert at analyzing multiple choice questions (MCQs). 

Analyze this screenshot and:
1. Look for any multiple choice question with options like a), b), c), d) or A), B), C), D) or 1), 2), 3), 4)
2. If you find an MCQ, provide the correct answer
3. Respond ONLY with the answer letter/number (like "b" or "B" or "2")
4. If no MCQ is found, respond with "NO_MCQ"

Important: Your response should be EXACTLY one character (the answer) or "NO_MCQ". Nothing else.
`;

      // Use Gemini API to analyze the screenshot
      const geminiMessages: GeminiMessage[] = [
        {
          role: "user",
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: "image/png",
                data: screenshotData
              }
            }
          ]
        }
      ];

      const response = await axios.default.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${config.apiKey}`,
        {
          contents: geminiMessages,
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 50
          }
        }
      );

      const responseData = response.data as GeminiResponse;
      
      if (!responseData.candidates || responseData.candidates.length === 0) {
        console.error("Empty response from Gemini API");
        return null;
      }
      
      const responseText = responseData.candidates[0].content.parts[0].text.trim();
      console.log("Gemini response:", responseText);

      if (responseText === "NO_MCQ") {
        return null;
      }

      // Extract single character answer
      const match = responseText.match(/[abcdABCD1234]/);
      return match ? match[0].toLowerCase() : null;

    } catch (error) {
      console.error("Error analyzing MCQ:", error);
      return null;
    }
  }

  /**
   * Show answer overlay at top-left corner with screen capture protection
   */
  private async showAnswerOverlay(answer: string): Promise<void> {
    try {
      // Hide any existing overlay
      this.hideOverlay();

      const primaryDisplay = screen.getPrimaryDisplay();
      const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

      // Create overlay window with maximum screen capture protection
      this.overlayWindow = new BrowserWindow({
        width: 100,
        height: 50,
        x: 20, // Top-left corner with small margin
        y: 20,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        focusable: false,
        resizable: false,
        movable: false,
        show: false,
        hasShadow: false,
        opacity: 0.8, // Slightly transparent to look like system UI
        backgroundColor: "#80808020", // Very light gray
        type: "panel",
        paintWhenInitiallyHidden: true,
        titleBarStyle: "hidden",
        enableLargerThanScreen: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          scrollBounce: true,
          backgroundThrottling: false
        }
      });

      // Enhanced screen capture resistance - same as main window
      this.overlayWindow.setContentProtection(true);
      this.overlayWindow.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true
      });
      this.overlayWindow.setAlwaysOnTop(true, "screen-saver", 1);

      // Additional screen capture resistance settings
      if (process.platform === "darwin") {
        // Prevent window from being captured in screenshots
        this.overlayWindow.setHiddenInMissionControl(true);
        this.overlayWindow.setWindowButtonVisibility(false);
        this.overlayWindow.setBackgroundColor("#00000000");

        // Prevent window from being included in window switcher
        this.overlayWindow.setSkipTaskbar(true);

        // Disable window shadow
        this.overlayWindow.setHasShadow(false);
      }

      // Prevent the window from being captured by screen recording
      this.overlayWindow.webContents.setBackgroundThrottling(false);
      this.overlayWindow.webContents.setFrameRate(60);

      // Create HTML content for the overlay with screen capture protection
      const overlayHTML = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: rgba(128, 128, 128, 0.1); /* Very light gray transparent background */
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      /* Additional protection against screen capture */
      -webkit-user-select: none;
      -moz-user-select: none;
      -ms-user-select: none;
      user-select: none;
      -webkit-touch-callout: none;
      -webkit-tap-highlight-color: transparent;
    }
    .answer {
      /* Make it look like a system-level overlay */
      background: rgba(128, 128, 128, 0.15); /* Light gray that appears as system UI */
      color: rgba(64, 64, 64, 0.9); /* Subtle dark text */
      font-size: 16px;
      font-weight: normal;
      padding: 8px 12px;
      border-radius: 4px;
      border: 1px solid rgba(128, 128, 128, 0.2);
      backdrop-filter: blur(1px);
      -webkit-backdrop-filter: blur(1px);
      /* Additional screen capture protection */
      -webkit-user-select: none;
      -moz-user-select: none;
      -ms-user-select: none;
      user-select: none;
      pointer-events: none;
    }
    
    /* Hide from screenshot tools */
    @media screen and (min-resolution: 192dpi) {
      .answer {
        opacity: 0.8;
      }
    }
    
    /* Additional protection */
    .answer::before {
      content: '';
      position: absolute;
      top: -10px;
      left: -10px;
      right: -10px;
      bottom: -10px;
      background: transparent;
      pointer-events: none;
    }
  </style>
  <script>
    // Additional protection against screenshot detection
    document.addEventListener('DOMContentLoaded', function() {
      // Disable right-click
      document.addEventListener('contextmenu', function(e) {
        e.preventDefault();
        return false;
      });
      
      // Disable text selection
      document.addEventListener('selectstart', function(e) {
        e.preventDefault();
        return false;
      });
      
      // Disable drag
      document.addEventListener('dragstart', function(e) {
        e.preventDefault();
        return false;
      });
      
      // Monitor for screenshot attempts (basic detection)
      document.addEventListener('keydown', function(e) {
        // Hide on common screenshot shortcuts
        if ((e.ctrlKey && e.shiftKey && e.key === 'S') || 
            (e.metaKey && e.shiftKey && e.key === '4') ||
            (e.key === 'PrintScreen')) {
          document.body.style.opacity = '0';
          setTimeout(() => {
            document.body.style.opacity = '1';
          }, 1000);
        }
      });
      
      // Make the overlay blend in more by changing appearance periodically
      let blendCounter = 0;
      setInterval(() => {
        const answerElement = document.querySelector('.answer');
        if (answerElement) {
          blendCounter++;
          // Subtle variations to make it look more like system UI
          const opacity = 0.7 + (Math.sin(blendCounter * 0.1) * 0.1);
          const bgOpacity = 0.05 + (Math.sin(blendCounter * 0.15) * 0.02);
          answerElement.style.opacity = opacity.toString();
          answerElement.style.backgroundColor = \`rgba(128, 128, 128, \${bgOpacity})\`;
        }
      }, 500);
    });
  </script>
</head>
<body>
  <div class="answer">${answer.toUpperCase()}</div>
</body>
</html>

`;
      // Load the HTML content
      await this.overlayWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(overlayHTML)}`);

      // Show the overlay with additional protection
      this.overlayWindow.showInactive(); // Use showInactive to prevent focus
      this.overlayWindow.setAlwaysOnTop(true, 'screen-saver', 1);
      
      // Set additional protection after showing
      this.overlayWindow.setContentProtection(true);
      this.overlayWindow.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true
      });

      console.log(`Answer overlay shown: ${answer.toUpperCase()}`);

      // Auto-hide after 3 seconds (increased time since it's more subtle now)
      setTimeout(() => {
        this.hideOverlay();
      }, 3000);

    } catch (error) {
      console.error("Error showing answer overlay:", error);
    }
  }

  /**
   * Hide the answer overlay
   */
  public hideOverlay(): void {
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.close();
      this.overlayWindow = null;
      console.log("Answer overlay hidden");
    }
  }

  /**
   * Get the main window reference
   */
  private getMainWindow(): BrowserWindow | null {
    const allWindows = BrowserWindow.getAllWindows();
    return allWindows.find(window => 
      !window.isDestroyed() && 
      (window.webContents.getURL().includes('localhost') || window.webContents.getURL().includes('file:'))
    ) || null;
  }

  /**
   * Cleanup resources
   */
  public cleanup(): void {
    this.hideOverlay();
  }
}