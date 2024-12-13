const {
    GoogleGenerativeAI,
    HarmCategory,
    HarmBlockThreshold,
} = require("@google/generative-ai");
const { createCanvas, loadImage, Image } = require('canvas');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

// Constants
const INITIAL_TIMEOUT = 30;
const MAX_RETRIES = 3;
const BACKOFF_MULTIPLIER = 2;
const IMAGE_WIDTH = 256;
const IMAGE_HEIGHT = 256;
const SAVE_INTERVAL = 10;

// Data storage structure
let generationData = {
    metadata: {
        startTime: null,
        endTime: null,
        userStory: "",
        imageWidth: IMAGE_WIDTH,
        imageHeight: IMAGE_HEIGHT,
    },
    rows: []
};

async function saveGenerationData() {
    const dataFile = path.join(__dirname, 'generation_data.json');
    await fs.writeFile(dataFile, JSON.stringify(generationData, null, 2));
}

async function saveDatasetEntry(rowData) {
    const datasetFile = path.join(__dirname, 'generation_dataset.jsonl');
    const entry = {
        timestamp: new Date().toISOString(),
        ...rowData
    };
    await fs.appendFile(datasetFile, JSON.stringify(entry) + '\n');
}

async function updateImagePreview(canvas, previewPath) {
    const imageBuffer = canvas.toBuffer('image/png');
    await fs.writeFile(previewPath, imageBuffer);
}

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
    try {
        const buffer = Buffer.from(base64String, 'base64');
        
        if (!await validatePngData(buffer)) {
            throw new Error('Invalid PNG data');
        }

        const tempCanvas = createCanvas(IMAGE_WIDTH, 1);
        const tempCtx = tempCanvas.getContext('2d');
        const imageData = tempCtx.createImageData(IMAGE_WIDTH, 1);
        
        const uint8Array = new Uint8Array(buffer);
        const dataView = new DataView(uint8Array.buffer);
        
        let offset = 8;
        const chunkLength = dataView.getUint32(offset);
        const pixelDataStart = offset + 8 + chunkLength + 4;
        const pixelData = uint8Array.slice(pixelDataStart, pixelDataStart + IMAGE_WIDTH * 4);
        
        for (let i = 0; i < IMAGE_WIDTH * 4; i++) {
            imageData.data[i] = pixelData[i] || 255;
        }
        
        ctx.putImageData(imageData, 0, y);
        
        tempCanvas.width = 0;
        tempCanvas.height = 0;
        
        if (global.gc) {
            global.gc();
        }
        
        return base64String;
    } catch (error) {
        console.warn(`Warning: Row ${y + 1} processing failed:`, error.message);
        
        if (prevRowBase64) {
            try {
                return await processRow(prevRowBase64, ctx, y, null);
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
    if (typeof process !== 'undefined') {
        const maxOldSpaceSize = 512;
        if (process.execArgv.indexOf(`--max-old-space-size=${maxOldSpaceSize}`) === -1) {
            process.execArgv.push(`--max-old-space-size=${maxOldSpaceSize}`);
        }
    }

    const userStory = "a majestic mountain landscape";
    const fileName = 'generated_image.png';
    const previewPath = path.join(__dirname, 'preview.png');
    const filePath = path.join(__dirname, fileName);

    // Initialize generation data
    generationData.metadata.startTime = new Date().toISOString();
    generationData.metadata.userStory = userStory;

    // Initialize canvas
    const canvas = createCanvas(IMAGE_WIDTH, IMAGE_HEIGHT);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);

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

    const chatSession = model.startChat({
        generationConfig,
        history: [{ role: 'user', parts: [{ text: systemPrompt }] }],
    });

    let prevRowBase64 = "";
    console.log("Starting image generation process...");
    const startTime = performance.now();

    try {
        for (let i = 0; i < IMAGE_HEIGHT; i++) {
            const rowStartTime = performance.now();
            console.log(`Generating row ${i + 1}...`);
            
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
                const rowEndTime = performance.now();
                const timeTaken = (rowEndTime - rowStartTime) / 1000;
                
                base64String = cleanBase64Response(base64String);
                prevRowBase64 = await processRow(base64String, ctx, i, prevRowBase64);

                // Save row data
                const rowData = {
                    row: i + 1,
                    timeTaken,
                    timestamp: new Date().toISOString(),
                    success: true,
                    retries,
                    base64Data: base64String
                };

                generationData.rows.push(rowData);
                await saveDatasetEntry(rowData);

                console.log(`Row ${i + 1} generated in ${timeTaken.toFixed(2)}s`);

                // Update preview at intervals
                if (i % SAVE_INTERVAL === 0 || i === IMAGE_HEIGHT - 1) {
                    await updateImagePreview(canvas, previewPath);
                    await saveGenerationData();
                    console.log(`Progress saved at row ${i + 1}`);
                }
            }

            if (global.gc) {
                global.gc();
            }
        }

        const endTime = performance.now();
        generationData.metadata.endTime = new Date().toISOString();
        
        // Save final image and data
        const imageBuffer = canvas.toBuffer('image/png');
        await fs.writeFile(filePath, imageBuffer);
        await saveGenerationData();
        
        console.log(`Total time: ${((endTime - startTime) / 1000).toFixed(2)} seconds`);
    } catch (error) {
        console.error("Fatal error:", error);
        const endTime = performance.now();
        generationData.metadata.endTime = new Date().toISOString();
        await saveGenerationData();
        console.log(`Terminated after: ${((endTime - startTime) / 1000).toFixed(2)} seconds`);
    }
}

run().catch(console.error);