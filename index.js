const {
    GoogleGenerativeAI,
    HarmCategory,
    HarmBlockThreshold,
  } = require("@google/generative-ai");
const fs = require('node:fs/promises');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const net = require('net');
const { processUserStoryImages } = require('./gif_generator');

const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

// 1.5 Flash Model for Chat (for generating user stories)
const model1_5 = genAI.getGenerativeModel({
  model: "gemini-1.5-flash",
});

// 1.5 Pro Model for single image generation
const model2_0 = genAI.getGenerativeModel({
    model: "gemini-1.5-pro",
});
const generationConfig = {
    temperature: 1,
    topP: 0.95,
    topK: 40,
    maxOutputTokens: 8192,
    responseMimeType: "text/plain",
  };
const safetySettings = [
    {
      category: HarmCategory.HARM_CATEGORY_HARASSMENT,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
  ]
const userStoriesFile = 'user_stories.txt';
const imageDatabaseFile = 'image_database.json';
// Set up Express app
const app = express();
const server = http.createServer(app);

// Setup web socket
const wss = new WebSocket.Server({ server });
wss.on('connection', ws => {
    console.log("Client connected");
});

app.use(express.static('public')); // Serve static files from 'public' folder
let PORT = 8000;

function isPortInUse(port) {
    return new Promise((resolve, reject) => {
      const tester = net.createServer()
        .once('error', err => (err.code == 'EADDRINUSE' ? resolve(true) : reject(err)))
        .once('listening', () => tester.close(() => resolve(false)))
        .listen(port);
    });
  }
  
  async function startServer() {
    let portInUse = await isPortInUse(PORT);
    while (portInUse) {
      PORT++;
      portInUse = await isPortInUse(PORT);
    }
    server.listen(PORT, () => {
      console.log(`Server listening on port ${PORT}`);
    });
  }
  
  startServer();
// user story and database functionality
async function readUserStories() {
    try {
        const data = await fs.readFile(userStoriesFile, 'utf-8');
        const stories = [];
        let currentStory = {};
        for (const line of data.split('\n')) {
            if (line.startsWith('ID:')) {
                if (currentStory.ID) {
                    stories.push(currentStory);
                }
                currentStory = { ID: parseInt(line.split(': ')[1]) };
            } else if (line.startsWith('User Story:')) {
                currentStory.userStory = line.split(': ')[1];
            } else if (line.startsWith('Description:')) {
                currentStory.description = line.split(': ')[1];
            } else if (line.startsWith('Tags:')) {
                currentStory.tags = line.split(': ')[1];
            } else if (line.startsWith('Status:')) {
                currentStory.status = line.split(': ')[1];
            }
        }
           if (currentStory.ID) {
                    stories.push(currentStory);
            }
        return stories;
    } catch (error) {
        console.error('Error reading user stories file:', error);
        return [];
    }
}
async function writeUserStories(stories) {
    let output = '';
    for (const story of stories) {
      output += `ID: ${story.ID}\n`;
      output += `User Story: ${story.userStory}\n`;
      output += `Description: ${story.description}\n`;
      output += `Tags: ${story.tags}\n`;
      output += `Status: ${story.status}\n\n`;
    }
    try{
        await fs.writeFile(userStoriesFile, output);
        console.log("Updated user_stories.txt")
    } catch (err) {
          console.error('Error writing user stories file:', err);
    }
}
async function findNextPendingStory(stories) {
  return stories.find(story => story.status === 'Pending');
}
async function updateStoryStatus(stories, storyID, newStatus) {
    return stories.map(story => {
      if (story.ID === storyID) {
        return { ...story, status: newStatus };
      }
      return story;
    });
}
async function readImageDatabase() {
    try {
        const data = await fs.readFile(imageDatabaseFile, 'utf-8');
        // If file is empty or just whitespace, return empty object
        if (!data || data.trim() === '') {
            return {};
        }
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            // File doesn't exist, create it with empty object
            await fs.writeFile(imageDatabaseFile, '{}');
            return {};
        }
        console.error('Error reading image database file:', error);
        return {};
    }
}
async function writeImageDatabase(data) {
    try {
        await fs.writeFile(imageDatabaseFile, JSON.stringify(data, null, 2));
        console.log("Updated image_database.json");
    } catch (error) {
        console.error('Error writing to image database file:', error);
    }
}
async function generateUserStory() {
    const chatSession = model1_5.startChat({
        generationConfig,
        safetySettings,
        history: [],
      });
        const prompt = `Generate a single, unique user story, description, and associated tags. The user story should be one sentence, description should be up to two sentences.
        Provide the user story in the following format, making sure to include the newline characters as shown:
        User Story: [user story]
        Description: [description]
        Tags: [tags]
        `
    const result = await chatSession.sendMessage(prompt);
    const storyData = result.response.text();
    console.log("Generated user story data:", storyData)
    const userStory = storyData.match(/User Story: (.*?)\n/)?.[1] || '';
    const description = storyData.match(/Description: (.*?)\n/)?.[1] || '';
    const tags = storyData.match(/Tags: (.*?)$/)?.[1] || '';
    const stories = await readUserStories();
    const nextID = stories.length > 0 ? Math.max(...stories.map(s => s.ID)) + 1 : 1;
    const newStory = {
        ID: nextID,
        userStory: userStory,
        description: description,
        tags: tags,
        status: "Pending"
    };
    stories.push(newStory);
    await writeUserStories(stories);
    console.log("appended new user story to user_stories.txt")
    return newStory;
}
async function generateImage(userStory) {
    const prompt2_0 = `Create a single 64x64 pixel image that visually represents this user story: "${userStory}".
Return ONLY a valid base64-encoded PNG image string.
- Do not include any markdown formatting
- Do not include "data:image" prefix
- Do not include any explanation text
- The string should only contain valid base64 characters (A-Z, a-z, 0-9, +, /, and = for padding)
- The string should be at least 1000 characters long to represent a valid 64x64 image
- The output should be a single continuous line of base64 characters`;

    const result2_0 = await model2_0.generateContent(prompt2_0);
    let singleBase64 = result2_0.response.text().trim();
    
    // Clean up and validate the response
    const { validateAndNormalizeBase64 } = require('./gif_generator');
    const validatedBase64 = validateAndNormalizeBase64(singleBase64);
    if (!validatedBase64) {
        console.log("Raw response from model:", singleBase64); // Add this for debugging
        throw new Error('Generated image data failed validation');
    }

    console.log("Generated base64 image data length:", validatedBase64.length);
    return validatedBase64;
}
async function run() {
    const stories = await readUserStories();
    if (!stories || stories.length === 0) {
      console.log("No user stories found, generating a new one.");
        await generateUserStory();
        return;
    }
    let nextStory = await findNextPendingStory(stories);
    if (!nextStory) {
      console.log('No pending user stories found.');
        console.log("Generating new user story...")
       await generateUserStory();
       return;
    }
    const userStoryID = nextStory.ID;
    const userStoryText = nextStory.userStory;
    console.log(`Processing user story ${userStoryID}`)
    let updatedStories = await updateStoryStatus(stories, userStoryID, "In Progress");
    await writeUserStories(updatedStories);

    try {
        const singleBase64 = await generateImage(userStoryText);
        if (!singleBase64) {
            throw new Error('Failed to generate image');
        }

        const imageDatabase = await readImageDatabase();
        imageDatabase[userStoryID] = {
            singleImage: singleBase64,
            timestamp: Date.now()  // Add timestamp for tracking
        };
        await writeImageDatabase(imageDatabase);
    } catch (error) {
        console.error('Error generating/saving image:', error);
        // Update story status to error
        updatedStories = await updateStoryStatus(updatedStories, userStoryID, "Error");
        await writeUserStories(updatedStories);
        return;
    }
    const updatedImageDatabase = await readImageDatabase();
    console.log("Updated Image Database:", updatedImageDatabase); // added console log
    updatedStories = await updateStoryStatus(updatedStories, userStoryID, "Done");
    await writeUserStories(updatedStories);
    const storedImageData = updatedImageDatabase[userStoryID];
        // Send data to client through web sockets
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
              console.log('sending image data to client') //added console log
            client.send(JSON.stringify({
                type:"image",
                userStoryID: userStoryID,
                singleImage: storedImageData.singleImage,
                status: "Done"
            }));
          } else {
               console.log('Client connection not open') //added console log
          }
        });
}
setInterval(async () => {
    await run();
    await processUserStoryImages(); // Generate GIFs after processing stories
}, 10000); // Run every ten seconds

app.get('/user-stories', async (req, res) => {
    const stories = await readUserStories();
    res.json(stories);
});
app.get('/test-gif', (req, res) => {
    res.sendFile(__dirname + '/public/test_gif.html');
});
