const {
    GoogleGenerativeAI,
    HarmCategory,
    HarmBlockThreshold,
} = require("@google/generative-ai");
const { createCanvas, loadImage, Image } = require('canvas');
global.Image = Image;

const INITIAL_TIMEOUT = 30; // 30 seconds initial timeout
const MAX_RETRIES = 3;
const BACKOFF_MULTIPLIER = 2;
const fs = require('fs');
const path = require('path');
require('dotenv').config();

function logToJsonl(data) {
    const logFile = path.join(__dirname, 'generation_log.jsonl');
    const logEntry = {
        timestamp: new Date().toISOString(),
        ...data
    };
    fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
}

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
    console.error("Error: GEMINI_API_KEY environment variable not set. Please set it in your .env file.");
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);

const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
});

const generationConfig = {
    temperature: 0.4,  // Reduce from 0.7 to get more consistent outputs
    topP: 0.8,
    topK: 40,
    maxOutputTokens: 1024,  // Reduce since we only need one row of pixels
};

const imageWidth = 256; // Define the desired image dimensions
const imageHeight = 256;

const systemPrompt = `You are an image generator that creates base64 encoded PNG data for single pixel rows.
Each row must be exactly ${imageWidth} pixels wide and 1 pixel tall.
Output ONLY the raw base64 string with no formatting, quotes, or additional text.
Do not include any prefix like 'data:image/png;base64,'.
The base64 string must represent a valid PNG image with dimensions ${imageWidth}x1 pixels.
Ensure the output is a complete, valid PNG file encoded in base64.`;

function debugBase64Response(response, rowNum) {
    console.log(`\nRow ${rowNum} raw response length: ${response.length}`);
    try {
        const decoded = Buffer.from(response, 'base64');
        console.log(`Decoded length: ${decoded.length} bytes`);
        console.log(`PNG header check:`, [...decoded.slice(0, 8)].map(b => b.toString(16).padStart(2, '0')).join(' '));
        return decoded.length > 8 && 
               decoded[0] === 0x89 && 
               decoded[1] === 0x50 && // P
               decoded[2] === 0x4E && // N
               decoded[3] === 0x47;   // G
    } catch (e) {
        console.log('Failed to decode as base64:', e.message);
        return false;
    }
}

function cleanBase64Response(response) {
    // Remove any non-base64 characters and common wrapping text
    let cleaned = response.replace(/^["']|["']$/g, '') // Remove quotes
                         .replace(/^data:image\/png;base64,/, '') // Remove data URL prefix
                         .replace(/[\r\n\s]/g, '') // Remove whitespace
                         .replace(/[^A-Za-z0-9+/=]/g, ''); // Remove any invalid base64 chars
    return cleaned;
}

async function run() {
    function isValidBase64(str) {
        // Check if string exists and has valid base64 characters
        if (!str || !/^[A-Za-z0-9+/]*={0,2}$/.test(str)) {
            return false;
        }

        try {
            // Decode and check if it's actually a PNG
            const buffer = Buffer.from(str, 'base64');
            // PNG files start with these bytes
            const pngSignature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
            return buffer.length > 8 && 
                   pngSignature.every((byte, i) => buffer[i] === byte);
        } catch (err) {
            return false;
        }
    }

    const chatSession = model.startChat({
        generationConfig,
        history: [{
          role: 'user',
          parts: [{ text: systemPrompt }]
        }],
    });

    const userStory = "a majestic mountain landscape"; // Define the user story here.
    const fileName = 'generated_image.png';
    const filePath = path.join(__dirname, fileName)


    // Initialize canvas with white background
    const canvas = createCanvas(imageWidth, imageHeight);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, imageWidth, imageHeight);


    let prevRowBase64 = "";
    console.log("Starting image generation process...");
    const startTime = performance.now();
    try {
        for (let i = 0; i < imageHeight; i++) {
                const prompt = `Generate a single row of pixels (${imageWidth}x1) for row ${i+1} of ${imageHeight} of "${userStory}". 
The row should be part of a coherent ${imageWidth}x${imageHeight} final image.
Return only the raw base64 PNG data.`;
                console.log(`Generating row ${i + 1}...`);
                
                const messageStartTime = performance.now();
                let timeout = INITIAL_TIMEOUT;
                let retries = 0;
                let success = false;
                let result;

                while (retries < MAX_RETRIES && !success) {
                    try {
                        result = await Promise.race([
                            chatSession.sendMessage(prompt),
                            new Promise((_, reject) => 
                                setTimeout(() => reject(new Error('Timeout')), timeout * 1000)
                            )
                        ]);
                        success = true;
                    } catch (error) {
                        retries++;
                        if (retries < MAX_RETRIES) {
                            console.warn(`Attempt ${retries} timed out after ${timeout}s, waiting before retry...`);
                            await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second pause between retries
                            timeout *= BACKOFF_MULTIPLIER;
                        } else {
                            console.warn("Max retries reached - using previous row or blank");
                            if (prevRowBase64) {
                                try {
                                    const image = await loadImage(`data:image/png;base64,${prevRowBase64}`);
                                    ctx.drawImage(image, 0, i, imageWidth, 1);
                                } catch {
                                    ctx.fillStyle = 'white';
                                    ctx.fillRect(0, i, imageWidth, 1);
                                }
                            } else {
                                ctx.fillStyle = 'white';
                                ctx.fillRect(0, i, imageWidth, 1);
                            }
                            break;
                        }
                    }
                }
                
                if (success) {
                    const messageEndTime = performance.now();
                    console.log(`Row ${i+1} sent and received. Time taken: ${((messageEndTime - messageStartTime) / 1000).toFixed(2)} seconds`);

                    let base64String = result.response.text().trim();
                    console.log(`Raw response for row ${i+1} (first 50 chars): "${base64String.substring(0, 50)}..."`);
                    
                    // Log the conversation data
                    logToJsonl({
                        row: i + 1,
                        prompt: prompt,
                        rawResponse: base64String,
                        timeTaken: ((messageEndTime - messageStartTime) / 1000).toFixed(2)
                    });
                
                    // Clean and validate the base64 string
                    base64String = cleanBase64Response(base64String);
                    const isValidPNG = debugBase64Response(base64String, i+1);
                
                    if (base64String && isValidPNG) {
                        try {
                            const dataUrl = `data:image/png;base64,${base64String}`;
                            const image = await loadImage(dataUrl);
                            
                            if (image.width === imageWidth && image.height === 1) {
                                // Draw the image and immediately clear references
                                ctx.drawImage(image, 0, i, imageWidth, 1);
                                prevRowBase64 = base64String;
                                console.log(`Successfully processed row ${i+1}`);
                                
                                // Clear references to help garbage collection
                                image.src = '';
                                if (global.gc) global.gc();
                            } else {
                                throw new Error(`Invalid dimensions: ${image.width}x${image.height}`);
                            }
                        } catch (imgError) {
                            console.warn(`Warning: Could not process row ${i+1}: ${imgError.message}`);
                            logToJsonl({
                                row: i + 1,
                                error: imgError.message,
                                type: 'image_processing_error'
                            });
                            ctx.fillStyle = 'white';
                            ctx.fillRect(0, i, imageWidth, 1);
                        }
                    } else {
                        console.warn(`Warning: Invalid base64 for row ${i+1}, using blank row`);
                        ctx.fillStyle = 'white';
                        ctx.fillRect(0, i, imageWidth, 1);
                    }

                    // Save progress every 10 rows
                    if (i % 10 === 0 || i === imageHeight - 1) {
                        const imageBuffer = canvas.toBuffer('image/png');
                        fs.writeFileSync(filePath, imageBuffer);
                        console.log(`Progress saved at row ${i+1}`);
                    }
                }
            }
        console.log("All Rows Generated");

        const endTime = performance.now();
        console.log(`Total execution time: ${((endTime - startTime) / 1000).toFixed(2)} seconds`);
    } catch (error) {
        console.error("Fatal error during image generation:", error);
        const endTime = performance.now();
        console.log(`Execution terminated after: ${((endTime - startTime) / 1000).toFixed(2)} seconds`);
    }
}

run();
