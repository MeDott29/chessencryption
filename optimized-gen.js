const {
    GoogleGenerativeAI,
    HarmCategory,
    HarmBlockThreshold,
} = require("@google/generative-ai");
const { createCanvas, loadImage, Image } = require('canvas');
const fs = require('fs').promises;
const path = require('path');
const pLimit = require('p-limit'); // For concurrency control

// Enhanced constants
const INITIAL_TIMEOUT = 20; // Reduced initial timeout
const MAX_RETRIES = 4; // Increased max retries
const BACKOFF_MULTIPLIER = 1.5; // Gentler backoff
const BATCH_SIZE = 3; // Number of rows to generate concurrently
const ROW_CACHE_SIZE = 5; // Number of previous rows to keep in memory

class RowGenerator {
    constructor(width, height, userStory) {
        this.width = width;
        this.height = height;
        this.userStory = userStory;
        this.rowCache = new Map();
        this.limit = pLimit(BATCH_SIZE);
        this.canvas = createCanvas(width, height);
        this.ctx = this.canvas.getContext('2d');
        this.failedRows = new Set();
    }

    async initializeAPI() {
        const apiKey = process.env.GEMINI_API_KEY;
        const genAI = new GoogleGenerativeAI(apiKey);
        this.model = genAI.getGenerativeModel({
            model: "gemini-1.5-flash",
            generationConfig: {
                temperature: 0.35,  // Reduced for more consistent outputs
                topP: 0.8,
                topK: 40,
                maxOutputTokens: 1024,
            }
        });

        // Pre-warm the chat session with a more detailed system prompt
        this.chatSession = this.model.startChat({
            history: [{
                role: 'user',
                parts: [{
                    text: `You are an image generator creating base64 PNG data for ${this.width}x1 pixel rows.
                          Each row is part of a ${this.width}x${this.height} image of "${this.userStory}".
                          Return only raw base64 without formatting or prefixes.
                          Maintain color coherence between adjacent rows.
                          Focus on ${this.width}x1 dimensional consistency.`
                }]
            }]
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
            
            const base64String = this.cleanBase64Response(result.response.text().trim());
            await this.validateRow(base64String, rowNum);
            
            return base64String;
        } catch (error) {
            throw new Error(`Row ${rowNum} generation failed: ${error.message}`);
        }
    }

    async getRowContext(rowNum) {
        // Get contextual information from previous rows
        const context = {
            previousRows: [],
            dominantColors: new Set()
        };

        for (let i = Math.max(0, rowNum - ROW_CACHE_SIZE); i < rowNum; i++) {
            if (this.rowCache.has(i)) {
                const prevRow = this.rowCache.get(i);
                context.previousRows.push({
                    rowNum: i,
                    colors: await this.analyzeRowColors(prevRow)
                });
            }
        }

        return context;
    }

    async analyzeRowColors(base64String) {
        // Implement color analysis for better context
        const buffer = Buffer.from(base64String, 'base64');
        const imageData = await this.decodeRow(buffer);
        return this.extractDominantColors(imageData);
    }

    async processRowBatch(startRow, endRow) {
        const tasks = [];
        for (let i = startRow; i < endRow; i++) {
            if (!this.failedRows.has(i)) {
                tasks.push(this.limit(() => this.generateRowWithRetry(i)));
            }
        }
        
        const results = await Promise.allSettled(tasks);
        return results.map((result, index) => ({
            row: startRow + index,
            success: result.status === 'fulfilled',
            data: result.status === 'fulfilled' ? result.value : null,
            error: result.status === 'rejected' ? result.reason : null
        }));
    }

    async generateRowWithRetry(rowNum) {
        let timeout = INITIAL_TIMEOUT;
        let lastError = null;

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                const base64String = await this.generateRow(rowNum, timeout);
                await this.processAndCacheRow(rowNum, base64String);
                return base64String;
            } catch (error) {
                lastError = error;
                timeout *= BACKOFF_MULTIPLIER;
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
        }

        this.failedRows.add(rowNum);
        throw lastError;
    }

    async processAndCacheRow(rowNum, base64String) {
        // Process the row and update the canvas
        await this.processRow(base64String, rowNum);
        
        // Update cache with LRU-style eviction
        this.rowCache.set(rowNum, base64String);
        if (this.rowCache.size > ROW_CACHE_SIZE) {
            const oldestKey = this.rowCache.keys().next().value;
            this.rowCache.delete(oldestKey);
        }
    }

    // Additional helper methods...
    cleanBase64Response(response) {
        return response.replace(/^["']|["']$/g, '')
                      .replace(/^data:image\/png;base64,/, '')
                      .replace(/[\r\n\s]/g, '')
                      .replace(/[^A-Za-z0-9+/=]/g, '');
    }
}

module.exports = RowGenerator;