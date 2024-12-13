import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import { createCanvas, loadImage, Image, ImageData } from 'canvas';
import { promises as fs } from 'fs';
import path from 'path';
import pLimit from 'p-limit';
import { PNG } from 'pngjs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

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
    // Remove any non-base64 characters and ensure proper base64 format
    let cleaned = response.trim()
        .replace(/^["']|["']$/g, '')  // Remove quotes
        .replace(/^data:image\/png;base64,/, '')  // Remove data URI prefix
        .replace(/[\r\n\s]/g, '')  // Remove whitespace
        .replace(/[^A-Za-z0-9+/=]/g, '');  // Keep only valid base64 chars
    
    // Ensure proper base64 padding
    const padding = cleaned.length % 4;
    if (padding) {
        cleaned += '='.repeat(4 - padding);
    }
    
    return cleaned;
}
// Function to parse a PNG buffer
function parsePngBuffer(buffer) {
    return new Promise((resolve, reject) => {
        new PNG().parse(buffer, (error, png) => {
            if (error) {
                reject(error);
                return;
            }
           
            resolve(png);
        });
    });
}
async function createWhiteRowImageData() {
        const tempCanvas = createCanvas(IMAGE_WIDTH, 1);
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.fillStyle = 'white';
        tempCtx.fillRect(0,0,IMAGE_WIDTH,1)
        return tempCtx.getImageData(0, 0, IMAGE_WIDTH, 1);

}
async function processRow(base64String, ctx, y, prevRowBase64) {
    try {
        // Create a white row as fallback
        const fallbackImageData = await createWhiteRowImageData();
        
        if (!base64String) {
            ctx.putImageData(fallbackImageData, 0, y);
            return null;
        }

        const buffer = Buffer.from(base64String, 'base64');
        
        // Early validation of PNG header
        const pngHeader = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
        if (buffer.slice(0, 8).compare(pngHeader) !== 0) {
            console.warn('Invalid PNG header');
            ctx.putImageData(fallbackImageData, 0, y);
            return null;
        }

        let png;
        try {
            png = await parsePngBuffer(buffer);
        } catch (error) {
            console.warn(`PNG parsing error:`, error.message);
            ctx.putImageData(fallbackImageData, 0, y);
            return null;
        }

        if (png.width !== IMAGE_WIDTH || png.height !== 1) {
            console.warn(`Invalid dimensions: ${png.width}x${png.height}`);
            ctx.putImageData(fallbackImageData, 0, y);
            return null;
        }

        const imageData = new ImageData(new Uint8ClampedArray(png.data), png.width, png.height);
        ctx.putImageData(imageData, 0, y);
        
        if (global.gc) {
            global.gc();
        }

        return base64String;
    } catch (error) {
        console.warn(`Warning: Row ${y + 1} processing failed:`, error.message);

        if (prevRowBase64) {
          try {
              return await processRow(prevRowBase64, ctx, y, null);
          } catch (retryError) {
              console.warn(`Fallback failed - using white pixel row`, retryError)
          }
      }

        // Create and draw a white row to fallback
        const fallbackImageData = await createWhiteRowImageData();
        ctx.putImageData(fallbackImageData, 0, y);
        
        return null;
    }
}

async function generateRow(chatSession, rowNum, totalRows, userStory, timeout, previousRow = null) {
    let prompt = `Generate a single row of pixels (${IMAGE_WIDTH}x1) for row ${rowNum} of ${totalRows} of "${userStory}". 
Return ONLY a base64 encoded PNG image that is exactly ${IMAGE_WIDTH} pixels wide and 1 pixel tall.
The response must:
1. Be ONLY the raw base64 string
2. NOT include 'data:image/png;base64,' prefix
3. NOT have any quotes, formatting, or additional text
4. Represent a valid PNG file with dimensions ${IMAGE_WIDTH}x1`;
    
    if (previousRow) {
        prompt += ` Use this previous row's colors for continuity: ${previousRow}`;
    }


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
        model: "gemini-2.0-flash-exp",
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

        const logMemoryUsage = () => {
        const used = process.memoryUsage();
        console.log('Memory usage:',
            Object.entries(used).map(([key, val]) => 
                `${key}: ${Math.round(val / 1024 / 1024 * 100) / 100} MB`
            ).join(', ')
        );
    };

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
                    base64String = await generateRow(chatSession, i + 1, IMAGE_HEIGHT, userStory, timeout, prevRowBase64);
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
                
               try {
                prevRowBase64 = await processRow(base64String, ctx, i, prevRowBase64);
                } catch(error) {
                   console.warn(`Fatal processing error, row ${i + 1}`, error)
                   // Note that the fallback has already taken place in processRow, so nothing to do here
                }
                

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
                logMemoryUsage();

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
