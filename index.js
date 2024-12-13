const {
    GoogleGenerativeAI,
    HarmCategory,
    HarmBlockThreshold,
  } = require("@google/generative-ai");
const fs = require('node:fs/promises');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { appendNewUserStory } = require('./user_story_generator');
const net = require('net');

const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

// 1.5 Flash Model for Chat
const model1_5 = genAI.getGenerativeModel({
  model: "gemini-1.5-flash",
});

// 2.0 Flash Experimental Model for single image generation
const model2_0 = genAI.getGenerativeModel({
  model: "gemini-2.0-flash-exp",
  systemInstruction: "The user will provide a user story, you will provide one 64 by 64 pixel image in base64, without any other text",
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
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading image database file, creating new database:', error);
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
async function run() {
    const stories = await readUserStories();
    if (!stories || stories.length === 0) {
        console.log("No user stories found")
    }
    let nextStory = await findNextPendingStory(stories);
    if (!nextStory) {
      console.log('No pending user stories found.');
      // Generate a new user story if none are pending
      console.log("Generating new user story...")
      await appendNewUserStory();
      return;
    }
    const userStoryID = nextStory.ID;
    console.log(`Processing user story ${userStoryID}`)
    let updatedStories = await updateStoryStatus(stories, userStoryID, "In Progress");
    await writeUserStories(updatedStories);
    // Generate a simple color array for the GIF using 1.5-flash model
    const chatSession = model1_5.startChat({
        generationConfig,
        safetySettings,
        history: [],
      });
    const prompt = `Generate two very small, square images, for the first GIF frames. Each image should be 20 pixels by 20 pixels.
    The first image should show a low-poly triangle in bright orange (#FFA500) on a dark grey (#333333) background.
    The second image should show the same low-poly triangle rotated slightly clockwise in bright orange (#FFA500) on a dark grey (#333333) background.
    The images must be delivered as a base64 strings for GIF frames. No other text is needed.`
    const result = await chatSession.sendMessage(prompt);
    const base64Strings = result.response.text().split('\n');
    // Generate single image using the 2.0-flash-exp model
    const prompt2_0 = `A low-poly triangle in bright orange (#FFA500) on a dark grey (#333333) background.`
    const result2_0 = await model2_0.generateContent(prompt2_0);
    const singleBase64 = result2_0.response.text();
   
    const imageDatabase = await readImageDatabase();
    imageDatabase[userStoryID] = {
        gifFrames: base64Strings,
        singleImage: singleBase64
    };
    await writeImageDatabase(imageDatabase);
    updatedStories = await updateStoryStatus(updatedStories, userStoryID, "Done");
    await writeUserStories(updatedStories);
    const updatedImageDatabase = await readImageDatabase();
    const storedImageData = updatedImageDatabase[userStoryID];
        // Send data to client through web sockets
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
                type:"image",
                userStoryID: userStoryID,
                gifFrames: storedImageData.gifFrames,
                singleImage: storedImageData.singleImage,
                status: "Done"
            }));
          }
        });
}
setInterval(async () => {
    await run();
}, 10000); // Run every ten seconds

app.get('/user-stories', async (req, res) => {
    const stories = await readUserStories();
    res.json(stories);
});
app.get('/test-gif', (req, res) => {
    res.sendFile(__dirname + '/public/test_gif.html');
});