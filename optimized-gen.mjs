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
    if (!response || typeof response !== 'string') {
        console.warn('Invalid response type');
        return '';
    }

    try {
        // Remove any non-base64 characters and ensure proper base64 format
        let cleaned = response.trim()
            .replace(/^["']|["']$/g, '')  // Remove quotes
            .replace(/^data:image\/png;base64,/, '')  // Remove data URI prefix
            .replace(/[\r\n\s]/g, '')  // Remove whitespace
            .replace(/[^A-Za-z0-9+/=]/g, '');  // Keep only valid base64 chars
        
        // Validate minimum length for a PNG in base64
        if (cleaned.length < 100) { // Increased minimum size for valid PNG
            console.warn('Base64 string too short');
            return '';
        }

        // Ensure proper base64 padding
        const padding = cleaned.length % 4;
        if (padding) {
            cleaned += '='.repeat(4 - padding);
        }

        // Validate base64 format and PNG structure
        const decoded = Buffer.from(cleaned, 'base64');
        if (decoded.length < 67) { // Minimum size for valid PNG with IHDR
            console.warn('Decoded PNG data too small');
            return '';
        }

        // Verify PNG signature
        const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
        if (Buffer.compare(decoded.slice(0, 8), pngSignature) !== 0) {
            console.warn('Invalid PNG signature');
            return '';
        }

        // Verify IHDR chunk
        const ihdrLength = decoded.readUInt32BE(8);
        if (ihdrLength !== 13) {
            console.warn('Invalid IHDR chunk length');
            return '';
        }

        return cleaned;
    } catch (error) {
        console.warn('Base64/PNG validation error:', error.message);
        return '';
    }
}
// Function to parse a PNG buffer with validation
function parsePngBuffer(buffer) {
    return new Promise((resolve, reject) => {
        try {
            // Validate PNG signature
            const pngHeader = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
            if (buffer.slice(0, 8).compare(pngHeader) !== 0) {
                reject(new Error('Invalid PNG signature'));
                return;
            }

            // Create a new PNG instance with strict parsing
            const png = new PNG({
                filterType: 4,  // Paeth filter
                checkCRC: true,  // Enable CRC checks
                skipRescale: true,
                fixTransparency: true,
                colorType: 6,  // RGBA
                inputHasAlpha: true,
                inputColorType: 6,
                deflateLevel: 9,  // Maximum compression
                deflateStrategy: 3,  // RLE strategy
                filterType: 4  // Paeth filter
            });
            
            let hasIHDR = false;
            let hasIDAT = false;
            let hasIEND = false;
            
            // Add chunk handler to validate chunk types
            png.on('metadata', (metadata) => {
                hasIHDR = true;
                if (metadata.width !== IMAGE_WIDTH || metadata.height !== 1) {
                    reject(new Error(`Invalid dimensions: ${metadata.width}x${metadata.height}`));
                }
            });
            
            png.on('data', () => {
                hasIDAT = true;
            });
            
            png.on('end', () => {
                hasIEND = true;
            });
            
            // Add error handler
            png.on('error', (error) => {
                reject(new Error(`PNG parsing error: ${error.message}`));
            });
            
            // Add parsing complete handler
            png.on('parsed', function() {
                if (!hasIHDR || !hasIDAT || !hasIEND) {
                    reject(new Error('Missing required PNG chunks'));
                    return;
                }
                
                if (this.width !== IMAGE_WIDTH || this.height !== 1) {
                    reject(new Error(`Invalid dimensions: ${this.width}x${this.height}`));
                    return;
                }
                
                // Ensure we have valid RGBA data
                if (!this.data || this.data.length !== IMAGE_WIDTH * 4) {
                    reject(new Error('Invalid pixel data'));
                    return;
                }
                
                resolve(this);
            });
            
            // Start parsing with timeout
            const parseTimeout = setTimeout(() => {
                reject(new Error('PNG parsing timeout'));
            }, 5000);
            
            png.parse(buffer, (error) => {
                clearTimeout(parseTimeout);
                if (error) {
                    reject(error);
                }
            });
            
        } catch (error) {
            reject(new Error(`PNG initialization error: ${error.message}`));
        }
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

        // Clean and validate base64 string
        const cleanedBase64 = cleanBase64Response(base64String);
        if (!cleanedBase64) {
            console.warn('Invalid base64 data');
            ctx.putImageData(fallbackImageData, 0, y);
            return null;
        }

        const buffer = Buffer.from(cleanedBase64, 'base64');
        
        // Validate minimum PNG size
        if (buffer.length < 40) { // Minimum size for a valid PNG
            console.warn('PNG data too small');
            ctx.putImageData(fallbackImageData, 0, y);
            return null;
        }

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
            return prevRowBase64 || null;
        }

        // Additional dimension validation
        if (png.width !== IMAGE_WIDTH || png.height !== 1) {
            console.warn(`Invalid dimensions: ${png.width}x${png.height}`);
            ctx.putImageData(fallbackImageData, 0, y);
            return prevRowBase64 || null;
        }

        const imageData = new ImageData(new Uint8ClampedArray(png.data), png.width, png.height);
        ctx.putImageData(imageData, 0, y);
        
        if (global.gc) {
            global.gc();
        }

        return cleanedBase64;
    } catch (error) {
        console.warn(`Row ${y + 1} processing failed:`, error.message);
        const fallbackImageData = await createWhiteRowImageData();
        ctx.putImageData(fallbackImageData, 0, y);
        return prevRowBase64 || null;
    }
}

async function generateRow(chatSession, rowNum, totalRows, userStory, timeout, previousRow = null) {
    let prompt = `Generate a single row of pixels (${IMAGE_WIDTH}x1) for row ${rowNum} of ${totalRows} of "${userStory}". 
Return ONLY a base64 encoded PNG image that is exactly ${IMAGE_WIDTH} pixels wide and 1 pixel tall.
The response must:
1. Be ONLY the raw base64 string
2. NOT include 'data:image/png;base64,' prefix
3. NOT have any quotes, formatting, or additional text
4. Be a valid RGBA PNG with these exact chunks in order:
   - PNG signature: exactly 89 50 4E 47 0D 0A 1A 0A
   - IHDR chunk (length=13):
     * width=${IMAGE_WIDTH} (4 bytes)
     * height=1 (4 bytes)
     * bit depth=8 (1 byte)
     * color type=6 (1 byte, RGBA)
     * compression=0 (1 byte, DEFLATE)
     * filter=4 (1 byte, Paeth)
     * interlace=0 (1 byte, none)
   - Single IDAT chunk with:
     * DEFLATE compressed RGBA data
     * Maximum compression level
     * RLE strategy
   - IEND chunk: exactly 00 00 00 00 49 45 4E 44 AE 42 60 82
5. Use these exact settings:
   - No interlacing
   - No color palette
   - No ancillary chunks
   - Paeth filtering only
   - Maximum DEFLATE compression`;
    
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
The base64 string must represent a valid PNG image with dimensions ${IMAGE_WIDTH}x1 pixels.
The PNG must be properly formatted with EXACTLY these chunks in order:
1. PNG signature (89 50 4E 47 0D 0A 1A 0A)
2. IHDR chunk with:
   - Width = ${IMAGE_WIDTH}
   - Height = 1
   - Bit depth = 8
   - Color type = 6 (RGBA)
   - Compression = 0 (DEFLATE)
   - Filter = 0 (None)
   - Interlace = 0 (None)
3. Single IDAT chunk with zlib-compressed RGBA pixel data
4. IEND chunk
Do not include any other chunks. The response must be a complete, valid PNG.`;


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
