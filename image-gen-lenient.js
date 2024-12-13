import { GoogleGenerativeAI } from "@google/generative-ai";
import { createCanvas, ImageData } from 'canvas';
import { promises as fs } from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const IMAGE_WIDTH = 256;
const IMAGE_HEIGHT = 256;
const SAVE_INTERVAL = 10;

// Simplified PNG parsing with very lenient settings
function parsePngBuffer(buffer) {
    return new Promise((resolve, reject) => {
        try {
            const png = new PNG({
                filterType: -1,  // Auto-detect filter
                checkCRC: false, // Skip CRC checks
                skipRescale: true,
                fixTransparency: true,
                colorType: 6,  // Force RGBA
                inputHasAlpha: true,
                inputColorType: 6,
                deflateStrategy: 3,  // More permissive deflate
                deflateLevel: 0,     // Fastest compression
            });

            // Just try to get any valid pixel data
            png.on('parsed', function() {
                if (this.data && this.data.length >= IMAGE_WIDTH * 4) {
                    // If we got more data than expected, just take what we need
                    const validData = this.data.slice(0, IMAGE_WIDTH * 4);
                    resolve({ data: validData, width: IMAGE_WIDTH, height: 1 });
                } else {
                    reject(new Error('Insufficient pixel data'));
                }
            });

            // Don't let errors stop us
            png.on('error', (error) => {
                console.warn('PNG warning (non-fatal):', error.message);
            });

            // Quick timeout
            const parseTimeout = setTimeout(() => {
                reject(new Error('PNG parsing timeout'));
            }, 2000);

            png.parse(buffer, (error) => {
                clearTimeout(parseTimeout);
                if (error) {
                    console.warn('Parsing warning:', error.message);
                }
            });

        } catch (error) {
            reject(error);
        }
    });
}

async function processRow(base64String, ctx, y, prevRowBase64) {
    try {
        // Create a fallback row
        const fallbackImageData = ctx.createImageData(IMAGE_WIDTH, 1);
        // Fill with white pixels
        for (let i = 0; i < fallbackImageData.data.length; i += 4) {
            fallbackImageData.data[i] = 255;     // R
            fallbackImageData.data[i + 1] = 255; // G
            fallbackImageData.data[i + 2] = 255; // B
            fallbackImageData.data[i + 3] = 255; // A
        }

        if (!base64String) {
            ctx.putImageData(fallbackImageData, 0, y);
            return null;
        }

        // Basic base64 cleanup
        const cleaned = base64String.trim()
            .replace(/^["']|["']$/g, '')
            .replace(/^data:image\/png;base64,/, '')
            .replace(/[\r\n\s]/g, '')
            .replace(/[^A-Za-z0-9+/=]/g, '');

        if (!cleaned) {
            ctx.putImageData(fallbackImageData, 0, y);
            return null;
        }

        try {
            const buffer = Buffer.from(cleaned, 'base64');
            const png = await parsePngBuffer(buffer);
            
            // Create ImageData from the parsed pixels
            const imageData = new ImageData(
                new Uint8ClampedArray(png.data),
                IMAGE_WIDTH,
                1
            );
            
            ctx.putImageData(imageData, 0, y);
            return cleaned;
        } catch (error) {
            console.warn(`Row processing warning: ${error.message}`);
            ctx.putImageData(fallbackImageData, 0, y);
            return prevRowBase64;
        }
    } catch (error) {
        console.warn(`Row ${y + 1} fallback triggered:`, error.message);
        const fallbackImageData = ctx.createImageData(IMAGE_WIDTH, 1);
        for (let i = 0; i < fallbackImageData.data.length; i += 4) {
            fallbackImageData.data[i] = 255;
            fallbackImageData.data[i + 1] = 255;
            fallbackImageData.data[i + 2] = 255;
            fallbackImageData.data[i + 3] = 255;
        }
        ctx.putImageData(fallbackImageData, 0, y);
        return prevRowBase64;
    }
}

async function generateRow(chatSession, rowNum, totalRows, userStory, timeout, previousRow = null) {
    const prompt = `Generate a single row of pixels (${IMAGE_WIDTH}x1) for row ${rowNum} of ${totalRows} of "${userStory}". 
Return ONLY a base64 encoded PNG image with a single row of RGBA pixels.${previousRow ? ` Use this previous row's colors for continuity: ${previousRow}` : ''}`;

    const result = await Promise.race([
        chatSession.sendMessage(prompt),
        new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), timeout * 1000)
        )
    ]);

    return result.response.text().trim();
}

async function run() {
    const userStory = "a majestic mountain landscape";
    const previewPath = path.join(__dirname, 'preview.png');
    const filePath = path.join(__dirname, 'generated_image.png');

    // Initialize canvas
    const canvas = createCanvas(IMAGE_WIDTH, IMAGE_HEIGHT);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);

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
            topP: 0.8,
            topK: 40,
            maxOutputTokens: 1024,
        }
    });

    let prevRowBase64 = null;
    console.log("Starting image generation process...");
    const startTime = performance.now();

    try {
        for (let i = 0; i < IMAGE_HEIGHT; i++) {
            const rowStartTime = performance.now();
            console.log(`Generating row ${i + 1}...`);
            
            let base64String = '';
            try {
                base64String = await generateRow(chatSession, i + 1, IMAGE_HEIGHT, userStory, 30, prevRowBase64);
                prevRowBase64 = await processRow(base64String, ctx, i, prevRowBase64);
                
                const rowEndTime = performance.now();
                console.log(`Row ${i + 1} generated in ${((rowEndTime - rowStartTime) / 1000).toFixed(2)}s`);
                
                // Save preview periodically
                if (i % SAVE_INTERVAL === 0 || i === IMAGE_HEIGHT - 1) {
                    await fs.writeFile(previewPath, canvas.toBuffer('image/png'));
                    console.log(`Progress saved at row ${i + 1}`);
                }
            } catch (error) {
                console.warn(`Row ${i + 1} error (continuing):`, error.message);
                await processRow(null, ctx, i, prevRowBase64);
            }

            if (global.gc) global.gc();
        }

        // Save final image
        await fs.writeFile(filePath, canvas.toBuffer('image/png'));
        
        const endTime = performance.now();
        console.log(`Total time: ${((endTime - startTime) / 1000).toFixed(2)} seconds`);
    } catch (error) {
        console.error("Fatal error:", error);
        // Try to save what we have
        await fs.writeFile(filePath, canvas.toBuffer('image/png'));
        throw error;
    }
}

run().catch(console.error);
