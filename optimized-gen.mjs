import { GoogleGenerativeAI } from '@google/generative-ai';
import { createCanvas } from 'canvas';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Constants
const INITIAL_TIMEOUT = 20;
const MAX_RETRIES = 4;
const BACKOFF_MULTIPLIER = 1.5;
const ROW_CACHE_SIZE = 5;
const IMAGE_WIDTH = 256;
const IMAGE_HEIGHT = 256;

class RowGenerator {
    constructor(width, height, userStory) {
        this.width = width;
        this.height = height;
        this.userStory = userStory;
        this.rowCache = new Map();
        this.canvas = createCanvas(width, height);
        this.ctx = this.canvas.getContext('2d');
        this.failedRows = new Set();
        
        // Initialize with white background
        this.ctx.fillStyle = 'white';
        this.ctx.fillRect(0, 0, width, height);
    }

    async initializeAPI() {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            throw new Error("GEMINI_API_KEY environment variable not set");
        }

        const genAI = new GoogleGenerativeAI(apiKey);
        this.model = genAI.getGenerativeModel({
            model: "gemini-1.5-flash",
            generationConfig: {
                temperature: 0.35,
                topP: 0.8,
                topK: 40,
                maxOutputTokens: 2048, // Increased for larger responses
            }
        });

        // Initialize chat with clearer system prompt
        this.chatSession = this.model.startChat({
            history: [{
                role: 'user',
                parts: [{
                    text: `You are an image generator creating pixel data for ${this.width}x1 rows of an image.
                          For each row request, generate an array of ${this.width} RGB pixel values.
                          Each pixel should be an array of 3 numbers between 0-255 for [R,G,B].
                          Format the response as a JSON array of pixel arrays.
                          Example format for 4 pixels: [[255,0,0],[0,255,0],[0,0,255],[255,255,255]]`
                }]
            }]
        });
    }

    async getRowContext(rowNum) {
        const context = {
            previousRows: []
        };

        // Get up to ROW_CACHE_SIZE previous rows
        for (let i = Math.max(0, rowNum - ROW_CACHE_SIZE); i < rowNum; i++) {
            if (this.rowCache.has(i)) {
                context.previousRows.push({
                    rowNum: i,
                    data: this.rowCache.get(i)
                });
            }
        }

        return context;
    }

    buildRowPrompt(rowNum, context) {
        let prompt = `Generate row ${rowNum + 1} of ${this.height} for "${this.userStory}".
                     You must return EXACTLY ${this.width} pixels as a JSON array.
                     Each pixel must be [R,G,B] where R,G,B are integers 0-255.
                     Format: [[R,G,B],[R,G,B],...] with exactly ${this.width} [R,G,B] arrays.
                     Do not include any text, markdown, or explanation - just the JSON array.`;
        
        if (context.previousRows.length > 0) {
            prompt += ` Ensure colors flow smoothly from the previous row.`;
        }
        
        return prompt;
    }
    
    cleanModelResponse(response) {
        // First remove any markdown and get just the array content
        let cleaned = response.replace(/```(?:json)?\n?/g, '')
                            .replace(/```\n?/g, '')
                            .trim();
        
        // Extract just the array portion using a more precise regex
        const arrayMatch = cleaned.match(/\[\s*\[(?:\s*\[\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\](?:\s*,\s*)?)*\s*\]\s*\]/);
        if (!arrayMatch) {
            throw new Error('No valid array structure found in response');
        }
        cleaned = arrayMatch[0];
        
        // Fix any truncated arrays by ensuring proper closure
        let openBrackets = (cleaned.match(/\[/g) || []).length;
        let closeBrackets = (cleaned.match(/\]/g) || []).length;
        
        if (openBrackets !== closeBrackets) {
            throw new Error('Malformed array structure - mismatched brackets');
        }
        
        return cleaned;
    }

    validatePixelData(pixelData) {
        if (!Array.isArray(pixelData)) {
            throw new Error('Pixel data must be an array');
        }
        
        // Handle nested array structure variations
        if (Array.isArray(pixelData[0]) && Array.isArray(pixelData[0][0])) {
            pixelData = pixelData[0]; // Unwrap extra layer
        }
        
        if (pixelData.length !== this.width) {
            // If we have too few pixels, pad with the last valid pixel
            if (pixelData.length < this.width) {
                const lastPixel = pixelData[pixelData.length - 1] || [255, 255, 255];
                while (pixelData.length < this.width) {
                    pixelData.push([...lastPixel]);
                }
            } else {
                // If we have too many pixels, truncate
                pixelData = pixelData.slice(0, this.width);
            }
        }
        
        // Validate and sanitize each pixel
        return pixelData.map((pixel, index) => {
            if (!Array.isArray(pixel) || pixel.length !== 3) {
                // If pixel is invalid, use previous valid pixel or white
                const prevPixel = pixelData[index - 1] || [255, 255, 255];
                return [...prevPixel];
            }
            
            // Convert and clamp RGB values
            return pixel.map(value => {
                const num = parseInt(value);
                if (isNaN(num)) {
                    return 255; // Default to white for invalid values
                }
                return Math.max(0, Math.min(255, num));
            });
        });
    }


    async generateRow(rowNum, timeout = INITIAL_TIMEOUT) {
        const context = await this.getRowContext(rowNum);
        const prompt = this.buildRowPrompt(rowNum, context);
        
        try {
            const result = await Promise.race([
                this.chatSession.sendMessage(prompt),
                new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Timeout')), timeout * 1000)
                )
            ]);
            
            const response = result.response.text();
            const cleanedResponse = this.cleanModelResponse(response);
            
            let pixelData;
            try {
                pixelData = JSON.parse(cleanedResponse);
            } catch (error) {
                 throw new Error(`Invalid JSON response after cleaning: ${error.message}\nCleaned response: ${cleanedResponse}`);
            }
            
            // Validate and sanitize the pixel data
            const validatedPixelData = this.validatePixelData(pixelData);
            
            return validatedPixelData;
            
        } catch (error) {
            throw new Error(`Row ${rowNum + 1} generation failed: ${error.message}`);
        }
    }

    async generateRowWithRetry(rowNum) {
        let timeout = INITIAL_TIMEOUT;
        let lastError = null;

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                const pixelData = await this.generateRow(rowNum, timeout);
                await this.processAndCacheRow(rowNum, pixelData);
                return pixelData;
            } catch (error) {
                console.warn(`Attempt ${attempt + 1} failed for row ${rowNum}:`, error.message);
                lastError = error;
                timeout *= BACKOFF_MULTIPLIER;
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
        }

        this.failedRows.add(rowNum);
        throw lastError;
    }

    async processAndCacheRow(rowNum, pixelData) {
        try {
            const imageData = this.ctx.createImageData(this.width, 1);
            
            // Convert RGB arrays to ImageData
            for (let x = 0; x < this.width; x++) {
                const pixel = pixelData[x];
                const i = x * 4;
                imageData.data[i] = pixel[0];     // R
                imageData.data[i + 1] = pixel[1]; // G
                imageData.data[i + 2] = pixel[2]; // B
                imageData.data[i + 3] = 255;      // A (fully opaque)
            }
            
            this.ctx.putImageData(imageData, 0, rowNum);
            this.rowCache.set(rowNum, pixelData);
            
            // LRU cache management
            if (this.rowCache.size > ROW_CACHE_SIZE) {
                const oldestKey = this.rowCache.keys().next().value;
                this.rowCache.delete(oldestKey);
            }
            
            if (rowNum % 10 === 0) {
                console.log(`Successfully generated row ${rowNum + 1}`);
            }
        } catch (error) {
            throw new Error(`Row processing failed: ${error.message}`);
        }
    }

    async saveImage(filePath) {
        const buffer = this.canvas.toBuffer('image/png');
        await fs.writeFile(filePath, buffer);
    }
}

// Main execution
async function run() {
    const userStory = "a majestic mountain landscape";
    const generator = new RowGenerator(IMAGE_WIDTH, IMAGE_HEIGHT, userStory);
    
    console.log("Initializing API...");
    await generator.initializeAPI();
    
    console.log("Starting image generation...");
    const startTime = performance.now();
    
    try {
        for (let i = 0; i < IMAGE_HEIGHT; i++) {
            console.log(`Generating row ${i + 1}/${IMAGE_HEIGHT}...`);
            await generator.generateRowWithRetry(i);
            
            if (global.gc) {
                global.gc();
            }
        }
        
        const filePath = path.join(__dirname, 'generated_image.png');
        await generator.saveImage(filePath);
        
        const endTime = performance.now();
        console.log(`Generation complete! Total time: ${((endTime - startTime) / 1000).toFixed(2)} seconds`);
    } catch (error) {
        console.error("Fatal error:", error);
    }
}

run().catch(console.error);