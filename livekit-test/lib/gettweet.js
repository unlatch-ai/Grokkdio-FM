/**
 * Tweet Screenshot Utility
 * Captures a tweet as a PNG image for overlay display
 */

import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Default output directory
const DEFAULT_OUTPUT_DIR = path.join(__dirname, "..", "media");

/**
 * Capture a tweet as a PNG screenshot
 * @param {string} tweetUrl - Full Twitter/X URL
 * @param {object} options - Options
 * @param {string} options.outputDir - Output directory (default: ./media)
 * @param {string} options.background - Background color (default: transparent)
 * @param {boolean} options.darkMode - Use dark theme (default: true)
 * @returns {Promise<string>} Path to the saved PNG
 */
export async function captureTweet(tweetUrl, options = {}) {
  const {
    outputDir = DEFAULT_OUTPUT_DIR,
    background = "transparent",
    darkMode = true,
  } = options;

  // Extract tweet ID from URL
  const urlParts = tweetUrl.split("/");
  const tweetId = urlParts.pop().split("?")[0]; // Remove query params
  const outputPath = path.join(outputDir, `tweet-${tweetId}.png`);

  console.log(`📸 Capturing tweet: ${tweetUrl}`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();

    await page.setViewport({
      width: 600,
      height: 2000,
      deviceScaleFactor: 2, // Retina quality
    });

    const modeAttr = darkMode ? ' data-theme="dark"' : "";
    const bgStyle = background === "transparent" ? "transparent" : background;

    const htmlContent = `
<!doctype html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      background: ${bgStyle}; 
      display: flex; 
      justify-content: center; 
      padding: 20px;
    }
    .twitter-tweet { 
      margin: 0 !important; 
    }
    iframe#twitter-widget-0 { 
      width: 550px !important;
    }
  </style>
</head>
<body>
  <blockquote class="twitter-tweet"${modeAttr}>
    <a href="${tweetUrl}"></a>
  </blockquote>
  <script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>
</body>
</html>`;

    await page.setContent(htmlContent, { waitUntil: "networkidle0" });

    // Wait for Twitter widget to load
    try {
      await page.waitForSelector("iframe#twitter-widget-0", { timeout: 15000 });
    } catch (err) {
      throw new Error("Tweet failed to load - may be deleted or protected");
    }

    // Give widget time to fully render
    await new Promise((r) => setTimeout(r, 2000));

    // Get the iframe and its content
    const tweetFrame = await page.$("iframe#twitter-widget-0");
    if (!tweetFrame) {
      throw new Error("Could not find tweet widget");
    }

    const frame = await tweetFrame.contentFrame();
    const tweetElement =
      (await frame.$("article")) || (await frame.$("div#app"));

    if (!tweetElement) {
      throw new Error("Could not find tweet content");
    }

    const boundingBox = await tweetElement.boundingBox();

    // Take screenshot of just the tweet
    await tweetFrame.screenshot({
      path: outputPath,
      clip: {
        x: 0,
        y: 0,
        width: boundingBox.width + 40,
        height: Math.min(boundingBox.height + 40, 1200), // Cap height
      },
      omitBackground: background === "transparent",
    });

    console.log(`✅ Tweet saved: ${outputPath}`);
    return outputPath;
  } finally {
    await browser.close();
  }
}

/**
 * Capture tweet and schedule deletion after display
 * @param {string} tweetUrl - Tweet URL
 * @param {number} deleteAfterMs - Delete file after this many ms (default: 30000)
 * @param {object} options - Capture options
 * @returns {Promise<{path: string, cleanup: Function}>}
 */
export async function captureTweetTemporary(
  tweetUrl,
  deleteAfterMs = 30000,
  options = {}
) {
  const imagePath = await captureTweet(tweetUrl, options);

  const cleanup = () => {
    try {
      if (fs.existsSync(imagePath)) {
        fs.unlinkSync(imagePath);
        console.log(`🗑️  Deleted tweet image: ${path.basename(imagePath)}`);
      }
    } catch (err) {
      console.error("Error deleting tweet image:", err.message);
    }
  };

  // Schedule automatic cleanup
  setTimeout(cleanup, deleteAfterMs);

  return { path: imagePath, cleanup };
}

// CLI support
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const urlArg = args.find((v) => v.includes("url="));

  if (urlArg) {
    const tweetUrl = urlArg.replace("url=", "");
    const darkMode = args.includes("--dark") || !args.includes("--light");
    const bgArg = args.find((v) => v.includes("bg="));
    const background = bgArg ? bgArg.replace("bg=", "") : "transparent";

    captureTweet(tweetUrl, { darkMode, background })
      .then((path) => console.log(`Done: ${path}`))
      .catch((err) => {
        console.error("Error:", err.message);
        process.exit(1);
      });
  } else {
    console.log(
      "Usage: node gettweet.js url=<tweet_url> [--dark|--light] [bg=<color>]"
    );
    console.log(
      "Example: node gettweet.js url=https://twitter.com/user/status/123456789"
    );
  }
}

export default { captureTweet, captureTweetTemporary };
