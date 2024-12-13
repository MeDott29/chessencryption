const fs = require('node:fs/promises');
const { createCanvas, loadImage } = require('canvas');
const GIFEncoder = require('gifencoder');
const { Image } = require('canvas');

async function base64ToImage(base64String) {
    try {
        // Remove any potential data URI prefix and whitespace
        const base64Data = base64String.replace(/^data:image\/\w+;base64,/, '').replace(/^```|```$/g, '').trim();
        
        // Create a buffer from the base64 string
        const imageBuffer = Buffer.from(base64Data, 'base64');
        
        // Log image buffer size for debugging
        console.log(`Image buffer size: ${imageBuffer.length} bytes`);
        
        // Validate buffer size
        if (imageBuffer.length > 1024 * 1024) { // 1MB limit
            console.warn('Image buffer exceeds recommended size, attempting to resize');
            // Optionally, you could implement image resizing here
        }
        
        // Use a more robust image loading method with increased timeout and error handling
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                // Clear any potential memory leaks
                setTimeout(() => resolve(img), 0);
            };
            img.onerror = (err) => {
                console.error('Image load error:', err);
                console.error('Base64 data (first 100 chars):', base64Data.substring(0, 100));
                reject(new Error('Failed to load image'));
            };
            
            // Ensure we're using a valid data URI
            img.src = `data:image/png;base64,${base64Data}`;
        });
    } catch (error) {
        console.error('Error converting base64 to image:', error);
        throw error;
    }
}

async function createRotationGif(imageData, outputPath, options = {}) {
    try {
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
    processUserStoryImages
};

// If run directly, process images
if (require.main === module) {
    processUserStoryImages();
}
