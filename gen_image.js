const {
    GoogleGenerativeAI,
    HarmCategory,
    HarmBlockThreshold,
} = require("@google/generative-ai");
const { createCanvas, loadImage, Image } = require('canvas');
const fs = require('fs').promises;  // Use promise-based fs
const path = require('path');
require('dotenv').config();

// Constants
const INITIAL_TIMEOUT = 30;
const MAX_RETRIES = 3;
const BACKOFF_MULTIPLIER = 2;
const IMAGE_WIDTH = 256;
const IMAGE_HEIGHT = 256;
const SAVE_INTERVAL = 10;  // Save every 10 rows

async function logToJsonl(data) {
    const logFile = path.join(__dirname, 'generation_log.jsonl');
    const logEntry = {
        timestamp: new Date().toISOString(),
        ...data
    };
    await fs.appendFile(logFile, JSON.stringify(logEntry) + '\n');
}

// Initialize API
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.error("Error: GEMINI_API_KEY environment variable not set");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
});

const generationConfig = {
    temperature: 0.4,
    topP: 0.8,
    topK: 40,
    maxOutputTokens: 1024,
};

const systemPrompt = `You are an image generator that creates base64 encoded PNG data for single pixel rows.
Each row must be exactly ${IMAGE_WIDTH} pixels wide and 1 pixel tall.
Output ONLY the raw base64 string with no formatting, quotes, or additional text.
Do not include any prefix like 'data:image/png;base64,'.
The base64 string must represent a valid PNG image with dimensions ${IMAGE_WIDTH}x1 pixels.`;

function cleanBase64Response(response) {
    return response.replace(/^["']|["']$/g, '')
                  .replace(/^data:image\/png;base64,/, '')
                  .replace(/[\r\n\s]/g, '')
                  .replace(/[^A-Za-z0-9+/=]/g, '');
}

async function validatePngData(buffer) {
    if (buffer.length <= 8) return false;
    const pngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    return pngSignature.every((byte, i) => buffer[i] === byte);
}

async function processRow(base64String, ctx, y, prevRowBase64) {
    let image = null;
    try {
        // Process in smaller chunks to avoid memory spikes
        const chunkSize = 1024 * 1024; // 1MB chunks
        const buffer = Buffer.from(base64String, 'base64');
        
        // Validate PNG header using only the first chunk
        const firstChunk = buffer.slice(0, Math.min(buffer.length, chunkSize));
        const isValidPng = await validatePngData(firstChunk);
        
        if (!isValidPng) {
            throw new Error('Invalid PNG data');
        }

        // Create a temporary canvas for the row
        const tempCanvas = createCanvas(IMAGE_WIDTH, 1);
        const tempCtx = tempCanvas.getContext('2d');

        // Load image with explicit garbage collection
        image = await loadImage(`data:image/png;base64,${base64String}`);
        
        if (image.width !== IMAGE_WIDTH || image.height !== 1) {
            throw new Error(`Invalid dimensions: ${image.width}x${image.height}`);
        }

        // Draw to temp canvas first
        tempCtx.drawImage(image, 0, 0, IMAGE_WIDTH, 1);
        
        // Copy from temp canvas to main canvas
        ctx.drawImage(tempCanvas, 0, y, IMAGE_WIDTH, 1);
        
        // Cleanup
        image.src = '';
        image = null;
        tempCanvas.width = 0;
        tempCanvas.height = 0;
        
        if (global.gc) {
            global.gc();
        }
        
        return base64String;
    } catch (error) {
        console.warn(`Warning: Row ${y + 1} processing failed:`, error.message);
        
        // Cleanup on error
        if (image) {
            image.src = '';
            image = null;
        }
        
        if (global.gc) {
            global.gc();
        }

        // Try using previous row or fallback to white
        if (prevRowBase64) {
            try {
                const tempCanvas = createCanvas(IMAGE_WIDTH, 1);
                const tempCtx = tempCanvas.getContext('2d');
                
                image = await loadImage(`data:image/png;base64,${prevRowBase64}`);
                tempCtx.drawImage(image, 0, 0, IMAGE_WIDTH, 1);
                ctx.drawImage(tempCanvas, 0, y, IMAGE_WIDTH, 1);
                
                // Cleanup
                image.src = '';
                image = null;
                tempCanvas.width = 0;
                tempCanvas.height = 0;
                
                if (global.gc) {
                    global.gc();
                }
                
                return prevRowBase64;
            } catch {
                ctx.fillStyle = 'white';
                ctx.fillRect(0, y, IMAGE_WIDTH, 1);
                return null;
            }
        } else {
            ctx.fillStyle = 'white';
            ctx.fillRect(0, y, IMAGE_WIDTH, 1);
            return null;
        }
    }
}

async function generateRow(chatSession, rowNum, totalRows, userStory, timeout) {
    const prompt = `Generate a single row of pixels (${IMAGE_WIDTH}x1) for row ${rowNum} of ${totalRows} of "${userStory}". 
The row should be part of a coherent ${IMAGE_WIDTH}x${totalRows} final image.
Return only the raw base64 PNG data.`;

    const result = await Promise.race([
        chatSession.sendMessage(prompt),
        new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), timeout * 1000)
        )
    ]);

    return result.response.text().trim();
}

async function run() {
    // Set Node.js memory limits
    if (typeof process !== 'undefined') {
        // Limit heap size to 512MB
        const maxOldSpaceSize = 512;
        if (process.execArgv.indexOf(`--max-old-space-size=${maxOldSpaceSize}`) === -1) {
            process.execArgv.push(`--max-old-space-size=${maxOldSpaceSize}`);
        }
    }

    const userStory = "a majestic mountain landscape";
    const fileName = 'generated_image.png';
    const filePath = path.join(__dirname, fileName);

    // Initialize canvas
    const canvas = createCanvas(IMAGE_WIDTH, IMAGE_HEIGHT);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);

    const logMemoryUsage = () => {
        const used = process.memoryUsage();
        console.log('Memory usage:',
            Object.entries(used).map(([key, val]) => 
                `${key}: ${Math.round(val / 1024 / 1024 * 100) / 100} MB`
            ).join(', ')
        );
    };

    const chatSession = model.startChat({
        generationConfig,
        history: [{ role: 'user', parts: [{ text: systemPrompt }] }],
    });

    let prevRowBase64 = "";
    console.log("Starting image generation process...");
    const startTime = performance.now();

    try {
        for (let i = 0; i < IMAGE_HEIGHT; i++) {
            console.log(`Generating row ${i + 1}...`);
            const messageStartTime = performance.now();
            
            let timeout = INITIAL_TIMEOUT;
            let retries = 0;
            let success = false;
            let base64String = '';

            while (retries < MAX_RETRIES && !success) {
                try {
                    base64String = await generateRow(chatSession, i + 1, IMAGE_HEIGHT, userStory, timeout);
                    success = true;
                } catch (error) {
                    retries++;
                    if (retries < MAX_RETRIES) {
                        console.warn(`Attempt ${retries} failed, retrying...`);
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        timeout *= BACKOFF_MULTIPLIER;
                    } else {
                        console.warn("Max retries reached - using previous row or blank");
                        break;
                    }
                }
            }

            if (success) {
                const messageEndTime = performance.now();
                console.log(`Row ${i + 1} generated in ${((messageEndTime - messageStartTime) / 1000).toFixed(2)}s`);

                base64String = cleanBase64Response(base64String);
                prevRowBase64 = await processRow(base64String, ctx, i, prevRowBase64);

                // Log generation data
                await logToJsonl({
                    row: i + 1,
                    timeTaken: ((messageEndTime - messageStartTime) / 1000).toFixed(2)
                });
                logMemoryUsage();

                // Save progress at intervals
                if (i % SAVE_INTERVAL === 0 || i === IMAGE_HEIGHT - 1) {
                    const imageBuffer = canvas.toBuffer('image/png');
                    await fs.writeFile(filePath, imageBuffer);
                    console.log(`Progress saved at row ${i + 1}`);
                }
            }

            // Force garbage collection if available
            if (global.gc) {
                global.gc();
            }
        }

        const endTime = performance.now();
        console.log(`Total time: ${((endTime - startTime) / 1000).toFixed(2)} seconds`);
    } catch (error) {
        console.error("Fatal error:", error);
        const endTime = performance.now();
        console.log(`Terminated after: ${((endTime - startTime) / 1000).toFixed(2)} seconds`);
    }
}

// Run with --expose-gc flag to enable manual garbage collection
run().catch(console.error);
