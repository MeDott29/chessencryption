import { GoogleGenerativeAI } from "@google/generative-ai";
import { createCanvas, ImageData } from 'canvas';
import { promises as fs } from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Basic setup
dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const CONFIG = {
    width: 256,
    height: 256,
    timeout: 30,
    retries: 3,
    saveInterval: 10
};

function initializeCanvas() {
    const canvas = createCanvas(CONFIG.width, CONFIG.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, CONFIG.width, CONFIG.height);
    return { canvas, ctx };
}

function createWhiteRow() {
    const data = new Uint8ClampedArray(CONFIG.width * 4);
    for (let i = 0; i < data.length; i += 4) {
        data[i] = 255;     // R
        data[i + 1] = 255; // G
        data[i + 2] = 255; // B
        data[i + 3] = 255; // A
    }
    return new ImageData(data, CONFIG.width, 1);
}

function createNewPNG() {
    const png = new PNG({
        width: CONFIG.width,
        height: 1,
        colorType: 6,
        bitDepth: 8,
        filterType: -1,
        deflateLevel: 9,
        deflateStrategy: 3,
        checkCRC: false
    });
    
    // Initialize with white pixels
    for (let i = 0; i < png.data.length; i += 4) {
        png.data[i] = 255;     // R
        png.data[i + 1] = 255; // G
        png.data[i + 2] = 255; // B
        png.data[i + 3] = 255; // A
    }
    
    return png;
}

function validateBase64PNG(base64String) {
    if (!base64String) return null;
    
    try {
        // Clean the string
        let cleaned = base64String.trim()
            .replace(/^["']|["']$/g, '')
            .replace(/^data:image\/png;base64,/, '')
            .replace(/[\r\n\s]/g, '')
            .replace(/[^A-Za-z0-9+/=]/g, '');

        // Add padding if needed
        const padding = cleaned.length % 4;
        if (padding) {
            cleaned += '='.repeat(4 - padding);
        }

        const buffer = Buffer.from(cleaned, 'base64');
        if (buffer.length < 8) {
            console.warn('Buffer too small');
            return null;
        }

        return buffer;
    } catch (error) {
        console.warn('Base64 validation error:', error.message);
        return null;
    }
}

async function processImageRow(base64String, ctx, y) {
    try {
        const buffer = validateBase64PNG(base64String);
        if (!buffer) {
            console.warn('Invalid base64 data for row', y);
            const whiteRow = createWhiteRow();
            ctx.putImageData(whiteRow, 0, y);
            return;
        }

        const png = createNewPNG();

        // Try to copy color data from the buffer
        try {
            const dataStart = buffer.indexOf('IDAT');
            if (dataStart > 0) {
                const dataLength = buffer.readUInt32BE(dataStart - 4);
                const colorData = buffer.slice(dataStart + 4, dataStart + 4 + dataLength);
                for (let i = 0; i < Math.min(colorData.length, png.data.length); i++) {
                    png.data[i] = colorData[i];
                }
            } else {
                // If no IDAT chunk found, try to use raw data
                for (let i = 0; i < Math.min(buffer.length, png.data.length); i++) {
                    png.data[i] = buffer[i];
                }
            }
        } catch (error) {
            console.warn('Error copying color data:', error.message);
        }

        // Create ImageData from PNG data
        const imageData = new ImageData(
            new Uint8ClampedArray(png.data),
            CONFIG.width,
            1
        );
        
        ctx.putImageData(imageData, 0, y);

    } catch (error) {
        console.warn(`Row ${y} processing failed:`, error.message);
        const whiteRow = createWhiteRow();
        ctx.putImageData(whiteRow, 0, y);
    }
}

async function generateRow(chatSession, rowNum, totalRows, prompt) {
    const rowPrompt = `Generate a single row of pixels (${CONFIG.width}x1) for row ${rowNum} of ${totalRows} of "${prompt}".
Return ONLY a base64 encoded PNG image string, ${CONFIG.width}x1 pixels, RGBA format.
No explanations, no formatting, just the raw base64 string.`;

    const result = await Promise.race([
        chatSession.sendMessage(rowPrompt),
        new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), CONFIG.timeout * 1000)
        )
    ]);

    return result.response.text().trim();
}

async function generateImage(prompt = "a majestic mountain landscape") {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error("GEMINI_API_KEY environment variable not set");
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ 
        model: "gemini-2.0-flash-exp",
        generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 1024,
        }
    });
    
    const chatSession = model.startChat();
    const { canvas, ctx } = initializeCanvas();
    const startTime = performance.now();

    try {
        for (let y = 0; y < CONFIG.height; y++) {
            console.log(`Generating row ${y + 1}/${CONFIG.height}...`);
            
            let success = false;
            let attempts = 0;

            while (!success && attempts < CONFIG.retries) {
                try {
                    const base64String = await generateRow(
                        chatSession, 
                        y + 1, 
                        CONFIG.height, 
                        prompt
                    );
                    await processImageRow(base64String, ctx, y);
                    success = true;
                } catch (error) {
                    attempts++;
                    console.warn(`Attempt ${attempts} failed for row ${y + 1}:`, error.message);
                    if (attempts < CONFIG.retries) {
                        await new Promise(resolve => setTimeout(resolve, 2000 * attempts));
                    }
                }
            }

            if (y % CONFIG.saveInterval === 0 || y === CONFIG.height - 1) {
                const imageBuffer = canvas.toBuffer('image/png');
                await fs.writeFile(path.join(__dirname, 'preview.png'), imageBuffer);
                console.log(`Progress saved at row ${y + 1}`);
            }
        }

        const imageBuffer = canvas.toBuffer('image/png');
        await fs.writeFile(path.join(__dirname, 'generated_image.png'), imageBuffer);

        const totalTime = (performance.now() - startTime) / 1000;
        console.log(`Image generation completed in ${totalTime.toFixed(2)} seconds`);

    } catch (error) {
        console.error("Fatal error:", error);
        throw error;
    }
}

generateImage().catch(error => {
    console.error("Program failed:", error);
    process.exit(1);
});
