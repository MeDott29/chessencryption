import { GoogleGenerativeAI } from "@google/generative-ai";
import { createCanvas } from 'canvas';
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
    timeout: 30, // seconds
    retries: 3,
    saveInterval: 10
};

// Initialize the canvas
function initializeCanvas() {
    const canvas = createCanvas(CONFIG.width, CONFIG.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, CONFIG.width, CONFIG.height);
    return { canvas, ctx };
}

// Clean and validate base64 PNG data
function validateBase64PNG(base64String) {
    if (!base64String) return '';
    
    try {
        // Clean the string
        const cleaned = base64String.trim()
            .replace(/^["']|["']$/g, '')
            .replace(/^data:image\/png;base64,/, '')
            .replace(/[\r\n\s]/g, '')
            .replace(/[^A-Za-z0-9+/=]/g, '');

        // Validate PNG data
        const buffer = Buffer.from(cleaned, 'base64');
        const pngHeader = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
        
        if (buffer.length < 67 || Buffer.compare(buffer.slice(0, 8), pngHeader) !== 0) {
            return '';
        }

        return cleaned;
    } catch (error) {
        console.warn('PNG validation error:', error.message);
        return '';
    }
}

// Process a single row of the image
async function processImageRow(base64String, ctx, y) {
    try {
        const cleanedBase64 = validateBase64PNG(base64String);
        if (!cleanedBase64) {
            console.warn(`Invalid PNG data for row ${y}, using fallback white row`);
            const whiteRow = ctx.createImageData(CONFIG.width, 1);
            for (let i = 0; i < whiteRow.data.length; i += 4) {
                whiteRow.data[i] = 255;     // R
                whiteRow.data[i + 1] = 255; // G
                whiteRow.data[i + 2] = 255; // B
                whiteRow.data[i + 3] = 255; // A
            }
            ctx.putImageData(whiteRow, 0, y);
            return null;
        }

        return new Promise((resolve, reject) => {
            const png = new PNG({
                filterType: -1,
                inputColorType: 6,
                checkCRC: false
            });

            const buffer = Buffer.from(cleanedBase64, 'base64');
            
            png.on('error', (error) => {
                console.warn(`PNG parsing error for row ${y}:`, error.message);
                reject(error);
            });

            png.parse(buffer, (error, data) => {
                if (error) {
                    reject(error);
                    return;
                }
                
                if (!data || data.width !== CONFIG.width || data.height !== 1) {
                    reject(new Error('Invalid dimensions'));
                    return;
                }

                try {
                    const imageData = new ImageData(
                        new Uint8ClampedArray(data.data),
                        data.width,
                        data.height
                    );
                    ctx.putImageData(imageData, 0, y);
                    resolve(cleanedBase64);
                } catch (err) {
                    reject(err);
                }
            });
        });
    } catch (error) {
        console.warn(`Row ${y} processing failed:`, error.message);
        const whiteRow = ctx.createImageData(CONFIG.width, 1);
        for (let i = 0; i < whiteRow.data.length; i += 4) {
            whiteRow.data[i] = 255;     // R
            whiteRow.data[i + 1] = 255; // G
            whiteRow.data[i + 2] = 255; // B
            whiteRow.data[i + 3] = 255; // A
        }
        ctx.putImageData(whiteRow, 0, y);
        return null;
    }
}

// Generate a single row using Gemini API
async function generateRow(chatSession, rowNum, totalRows, prompt) {
    const rowPrompt = `Generate a single row of pixels (${CONFIG.width}x1) for row ${rowNum} of ${totalRows} of "${prompt}".
Return ONLY a valid base64 encoded PNG image string that meets these requirements:
- Image must be exactly ${CONFIG.width}x1 pixels in RGBA format
- Do not include any markdown formatting
- Do not include "image" prefix
- Image must be exactly ${CONFIG.width}x1 pixels in RGBA format
- PNG must include all required PNG chunks (IHDR, IDAT, IEND)
- PNG must be properly compressed and encoded
- Do not include any markdown formatting
- Do not include "image" prefix
- Do not include any explanation text
- The string should only contain valid base64 characters (A-Z, a-z, 0-9, +, /, and = for padding)
- The output should be a single continuous line of base64 characters
- The response should contain nothing but the base64 string`;

    const result = await Promise.race([
        chatSession.sendMessage(rowPrompt),
        new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), CONFIG.timeout * 1000)
        )
    ]);

    const text = result.response.text().trim();
    if (!text || text.includes('\n') || text.includes(' ')) {
        throw new Error('Invalid response format');
    }
    return text;
}

// Main function
async function generateImage(prompt = "a majestic mountain landscape") {
    // Initialize API
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error("GEMINI_API_KEY environment variable not set");
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
    const chatSession = model.startChat({
        generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 1024,
        }
    });

    // Initialize canvas
    const { canvas, ctx } = initializeCanvas();
    const startTime = performance.now();

    try {
        // Generate image row by row
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
                    console.warn(`Attempt ${attempts} failed:`, error.message);
                    console.warn('Error details:', error);
                    await new Promise(resolve => setTimeout(resolve, 2000 * attempts)); // Exponential backoff
                }
            }

            // Save progress periodically
            if (y % CONFIG.saveInterval === 0 || y === CONFIG.height - 1) {
                const imageBuffer = canvas.toBuffer('image/png');
                await fs.writeFile(
                    path.join(__dirname, 'preview.png'),
                    imageBuffer
                );
            }
        }

        // Save final image
        const imageBuffer = canvas.toBuffer('image/png');
        await fs.writeFile(
            path.join(__dirname, 'generated_image.png'),
            imageBuffer
        );

        const totalTime = (performance.now() - startTime) / 1000;
        console.log(`Image generation completed in ${totalTime.toFixed(2)} seconds`);

    } catch (error) {
        console.error("Fatal error:", error);
        throw error;
    }
}

// Run the program
generateImage()
    .catch(error => {
        console.error("Program failed:", error);
        process.exit(1);
    });
