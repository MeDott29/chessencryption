const fs = require('node:fs/promises');
const { createCanvas, loadImage } = require('canvas');
const GIFEncoder = require('gifencoder');
const { Image } = require('canvas');

function validateAndNormalizeBase64(base64String) {
    try {
        // Clean up the string
        let cleaned = base64String
            .replace(/^```[\w]*\n|```$/g, '')  // Remove code blocks
            .replace(/^data:image\/\w+;base64,/, '')  // Remove data URI prefix
            .replace(/[\n\r\s]/g, '')  // Remove all whitespace, newlines
            .trim();

        // Check if it's valid base64
        if (!/^[A-Za-z0-9+/]+[=]{0,2}$/.test(cleaned)) {
            console.error('Invalid base64 characters detected');
            return null;
        }

        // Check for reasonable length (assuming 64x64 PNG, should be at least a few KB)
        if (cleaned.length < 1000) {
            console.error('Base64 string suspiciously short:', cleaned.length);
            return null;
        }

        // Try decoding to verify it's valid base64
        try {
            atob(cleaned);
        } catch (e) {
            console.error('Base64 decode failed:', e);
            return null;
        }

        return cleaned;
    } catch (error) {
        console.error('Error in validateAndNormalizeBase64:', error);
        return null;
    }
}

async function base64ToImage(base64String) {
    try {
        // Validate and normalize the base64 string
        const validatedBase64 = validateAndNormalizeBase64(base64String);
        if (!validatedBase64) {
            throw new Error('Invalid base64 data');
        }

        // Create proper data URI
        const base64Data = `data:image/png;base64,${validatedBase64}`;

        return new Promise((resolve, reject) => {
            const img = new Image();
            
            const timeout = setTimeout(() => {
                reject(new Error('Image loading timed out'));
            }, 5000);

            img.onload = () => {
                clearTimeout(timeout);
                // Verify image dimensions
                if (img.width === 0 || img.height === 0) {
                    reject(new Error('Invalid image dimensions'));
                    return;
                }
                resolve(img);
            };

            img.onerror = (err) => {
                clearTimeout(timeout);
                console.error('Image load error:', err);
                reject(new Error('Failed to load image'));
            };
            
            img.src = base64Data;
        });
    } catch (error) {
        console.error('Error converting base64 to image:', error);
        throw error;
    }
}

async function createRotationGif(imageData, outputPath, options = {}) {
    try {
        // Validate base64 data first
        const validatedBase64 = validateAndNormalizeBase64(imageData);
        if (!validatedBase64) {
            console.error('Invalid base64 data provided for GIF creation');
            return null;
        }

        const {
            width = 64,
            height = 64,
            frames = 8,
            duration = 100 // milliseconds per frame
        } = options;

        // Validate imageData
        if (!imageData || typeof imageData !== 'string') {
            console.error('Invalid image data');
            return null;
        }

        // Create GIF encoder with memory-efficient settings
        const encoder = new GIFEncoder(width, height);
        encoder.start();
        encoder.setRepeat(0);   // 0 for repeat, -1 for no repeat
        encoder.setDelay(duration);  // frame delay in ms
        encoder.setQuality(20); // Increased quality loss to reduce memory usage

        // Create canvas
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        // Load the base image with enhanced error handling
        let image;
        try {
            image = await base64ToImage(imageData);
        } catch (imageError) {
            console.error('Failed to load image for GIF:', imageError);
            return null; // Skip this image
        }

        // Create rotation frames with memory management
        for (let i = 0; i < frames; i++) {
            // Clear canvas to prevent memory buildup
            ctx.clearRect(0, 0, width, height);
            
            // Rotate the image
            ctx.save();
            ctx.translate(width/2, height/2);
            ctx.rotate((i * Math.PI * 2) / frames);
            
            // Aggressive scaling to reduce memory usage
            const scale = Math.min(width / image.width, height / image.height, 1);
            const scaledWidth = image.width * scale;
            const scaledHeight = image.height * scale;
            
            ctx.drawImage(image, -scaledWidth/2, -scaledHeight/2, scaledWidth, scaledHeight);
            ctx.restore();

            // Add frame to encoder
            encoder.addFrame(ctx);

            // Optional: Force garbage collection after each frame
            if (global.gc) global.gc();
        }

        // Finish the GIF
        encoder.finish();

        // Write the GIF to file
        const buffer = encoder.out.getData();
        await fs.writeFile(outputPath, buffer);

        console.log(`Created GIF: ${outputPath}, size: ${buffer.length} bytes`);
        return outputPath;
    } catch (error) {
        console.error('Error creating rotation GIF:', error);
        return null; // Prevent entire process from stopping
    }
}

async function processUserStoryImages() {
    try {
        // Read the image database
        const imageDatabaseRaw = await fs.readFile('image_database.json', 'utf-8');
        const imageDatabase = JSON.parse(imageDatabaseRaw);

        // Create output directory if it doesn't exist
        await fs.mkdir('public/gifs', { recursive: true });

        // Process each user story with an image
        for (const [storyId, storyData] of Object.entries(imageDatabase)) {
            try {
                if (storyData.singleImage) {
                    const gifPath = `public/gifs/story_${storyId}_rotation.gif`;
                    const result = await createRotationGif(storyData.singleImage, gifPath);
                    
                    if (result) {
                        console.log(`Created GIF for story ${storyId}: ${gifPath}`);
                        // Update the image database with GIF path
                        storyData.rotationGif = gifPath;
                    } else {
                        console.warn(`Skipped GIF creation for story ${storyId} due to image processing error`);
                    }
                }
            } catch (storyError) {
                console.error(`Error processing story ${storyId}:`, storyError);
                // Continue processing other stories even if one fails
            }
        }

        // Write updated database
        await fs.writeFile('image_database.json', JSON.stringify(imageDatabase, null, 2));
    } catch (error) {
        console.error('Error processing user story images:', error);
    }
}

// Export functions for potential external use
module.exports = {
    createRotationGif,
    processUserStoryImages,
    validateAndNormalizeBase64
};

// If run directly, process images
if (require.main === module) {
    processUserStoryImages();
}
