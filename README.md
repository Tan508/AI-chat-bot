# AI chat bot

This project is a chat application built for CPEN 322. It includes the authentication features and AI feature set built around an OpenAI-backed chat room and a room sentiment analyzer.

## Demo Video
[
https://github.com/user-attachments/assets/b67df10e-cbd9-446e-8e8b-010a928796ce](https://github.com/Tan508/AI-chat-bot/blob/main/demo.mov)

## Features

- User authentication with session cookies
- Real-time chat rooms over WebSocket
- An always-available `AI Chat` room pinned to the top of the lobby
- AI-generated replies from `AI bot` in the `AI Chat` room
- Browser voice playback for `AI bot` replies
- A per-room sentiment analysis panel that summarizes each participant's current emotion
- Two virtual avatars with different voices to choose from for conversation

## Tested Environment

- Node.js `v22.19.0`
- MongoDB running locally at `mongodb://localhost:27017`
- `mongosh` for database initialization

## Dependencies

The project currently uses:

- `express` `^4.22.1`
- `mongodb` `^7.1.0`
- `ws` `^8.19.0`
- `nodemon` `^3.1.14` for development

## Setup

1. Install dependencies:

```bash
npm install
```

2. Start MongoDB locally so the app can connect to `mongodb://localhost:27017`.

3. Initialize the database in `mongosh`:

```javascript
load("initdb.mongo")
load("src/initUsers.mongo")
```

`initdb.mongo` creates the baseline rooms and conversations. `src/initUsers.mongo` creates the login users required for Assignment 5:

- `alice` / `secret`
- `bob` / `password`

4. Create a `.env` file in the project root:

```env
OPENAI_API_KEY=your_api_key_here
```

`server.js` loads `.env` automatically on startup. If the key is missing:

- `AI bot` replies fall back to `AI is not configured yet.`
- Room sentiment analysis still works through a local heuristic fallback

## Running The App

Development mode:

```bash
npx nodemon server.js
```

Production-style run:

```bash
node server.js
```

Then open:

```text
http://localhost:3000
```

## Using The AI Features

1. Log in as `alice` or `bob`.
2. Open the `AI Chat` room at the top of the room list.
3. Send a message to receive an OpenAI-generated reply from `AI bot`.
4. In any room, click `Analyze Sentiment` below the chat input to view the emotion snapshot for each user in that room.
5. Avatar will show its state depending on whether it is speaking, thinking or doing nothing.

## Backend AI Endpoints

- `GET /chat/:room_id/sentiment`

This endpoint analyzes all messages currently available for the room, groups them by user, and returns a summary like:

```json
{
  "roomId": "room-1",
  "roomName": "Everyone in CPEN322",
  "source": "ai",
  "sentiments": [
    {
      "username": "alice",
      "emotion": "happy",
      "detail": "Recent messages read as upbeat and positive.",
      "messageCount": 3
    }
  ],
  "generatedAt": 1710000000000
}
```

## Notes

- The `AI Chat` room is created automatically by the server and is styled specially in the client.
- `AI bot` messages are shown in purple chat bubbles in the AI room.
- Sentiment analysis uses OpenAI when available, but the app includes a fallback heuristic so the feature remains usable without a valid API response.
