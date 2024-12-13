const fs = require('node:fs/promises');
const { createCanvas, loadImage } = require('canvas');
const GIFEncoder = require('gifencoder');

async function base64ToImage(base64String) {
    // Remove any potential data URI prefix and whitespace
    const base64Data = base64String.replace(/^data:image\/\w+;base64,/, '').trim();
    
    // Create a buffer from the base64 string
    const imageBuffer = Buffer.from(base64Data, 'base64');
    
    // Load the image using canvas
    return await loadImage(imageBuffer);
}

async function createRotationGif(imageData, outputPath, options = {}) {
    const {
        width = 64,
        height = 64,
        frames = 8,
        duration = 100 // milliseconds per frame
    } = options;

    // Create GIF encoder
    const encoder = new GIFEncoder(width, height);
    encoder.start();
    encoder.setRepeat(0);   // 0 for repeat, -1 for no repeat
    encoder.setDelay(duration);  // frame delay in ms
    encoder.setQuality(10); // image quality. 10 is default

    // Create canvas
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Load the base image
    const image = await base64ToImage(imageData);

    // Create rotation frames
    for (let i = 0; i < frames; i++) {
        ctx.clearRect(0, 0, width, height);
        
        // Rotate the image
        ctx.save();
        ctx.translate(width/2, height/2);
        ctx.rotate((i * Math.PI * 2) / frames);
        ctx.drawImage(image, -width/2, -height/2, width, height);
        ctx.restore();

        // Add frame to encoder
        encoder.addFrame(ctx);
    }

    // Finish the GIF
    encoder.finish();

    // Write the GIF to file
    const buffer = encoder.out.getData();
    await fs.writeFile(outputPath, buffer);

    return outputPath;
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
            if (storyData.singleImage) {
                const gifPath = `public/gifs/story_${storyId}_rotation.gif`;
                await createRotationGif(storyData.singleImage, gifPath);
                console.log(`Created GIF for story ${storyId}: ${gifPath}`);

                // Optionally, update the image database with GIF path
                storyData.rotationGif = gifPath;
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
