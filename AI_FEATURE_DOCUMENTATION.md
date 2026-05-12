# AI Feature Documentation

## Overview

Our group extended the chat application with two connected AI-enabled features:

- an OpenAI-powered `AI Chat` room where users can talk to `AI bot`
- a room sentiment analyzer that summarizes the emotion each participant is expressing in the currently open room

The resulting system combines real-time messaging, REST endpoints, WebSocket updates, browser speech synthesis, and LLM-based language analysis.

## User Manual

### Logging In

Use one of the seeded test accounts:

- `alice` / `secret`
- `bob` / `password`

### AI Chat Room

- After login, the lobby shows an `AI Chat` room at the top of the room list.
- This room is created automatically by the server, so users do not need to create it manually.
- The room is highlighted in purple to distinguish it from standard chat rooms.
- When a user sends a message in `AI Chat`, the server forwards the message to OpenAI and posts the response back as `AI bot`.
- `AI bot` replies are displayed in purple chat bubbles.
- The browser also speaks `AI bot` replies using the Web Speech API when possible.

### Sentiment Analyzer

- Open any chat room.
- Click the `Analyze Sentiment` button below the message box.
- A panel appears below the open chat and lists each participant in the room, the emotion they appear to be expressing, and a short explanation.
- If an OpenAI call is unavailable, the feature falls back to a local heuristic analysis so the UI still returns results.

## Design And Implementation

### High-Level Architecture

The AI feature spans both backend and frontend code:

- `server.js` manages the OpenAI calls, AI room lifecycle, and the sentiment REST endpoint.
- `Database.js` now exposes room conversation history for sentiment aggregation.
- `client/app.js` renders the special AI room, voice playback, and the sentiment analysis panel.
- `client/style.css` styles the AI room, AI bot messages, and the sentiment panel.

### AI Model Choice

We used OpenAI's Responses API with `gpt-5.4-mini`.

This model was chosen because:

- it is straightforward to call from the existing Node/Express backend
- it handles conversational generation and lightweight emotional classification well enough for the project scope
- it allowed us to build both the AI reply feature and the sentiment analysis feature without introducing separate model-serving infrastructure

### Alternatives Considered

We considered the following alternatives:

- a locally hosted open-source model through Ollama or GPT4All
- a purely rule-based chatbot
- a purely rule-based sentiment detector

Reasons we did not adopt them as the primary solution:

- local model hosting would have added setup complexity, machine requirements, and more evaluation friction for a course project
- a rule-based chatbot would have felt brittle and would not have delivered the same user-facing value as a real language model
- a rule-based-only sentiment detector is easier to run, but weaker at handling ambiguous or mixed conversational tone

We still kept one rule-based component: the sentiment analyzer includes a fallback heuristic so the feature remains available if the external API cannot be used.

### Purpose Of The AI Features

The AI additions serve two different user-facing goals:

- `AI Chat` makes the application more interactive by providing a live conversational room with automated responses
- sentiment analysis helps users understand the tone of a room at a glance, especially when several participants are active

This also gives the project both a generation feature and an analysis feature rather than a single API call with no follow-up interaction.

### Backend Integration Details

#### AI Chat Reply Flow

1. A signed-in user sends a WebSocket message in a chat room.
2. The server stores and broadcasts the user message.
3. If the room is the canonical `AI Chat` room, the server calls OpenAI.
4. The response is sanitized and rebroadcast as a message from `AI bot`.

#### Sentiment Analysis Flow

1. The client calls `GET /chat/:room_id/sentiment`.
2. The server loads the room and all stored conversation blocks for that room.
3. The server merges persisted messages with in-memory unsaved messages.
4. Messages are grouped by username.
5. The server asks OpenAI for one emotion label and a short explanation per user.
6. If that AI request fails, the server falls back to a local keyword-based heuristic.
7. The client renders the results in a small panel below the open chat room.

### Frontend Integration Details

On the frontend:

- the lobby treats `AI Chat` as a special room and always renders it first
- the room is visually distinguished with a purple card
- `AI bot` messages use a dedicated purple bubble style
- speech synthesis reads `AI bot` responses aloud
- the sentiment panel is embedded directly in the chat view to keep the feature local to the room where the user is already reading messages

## REST API Exposure

The Assignment 6 AI functionality is exposed through the backend route:

- `GET /chat/:room_id/sentiment`

This route returns a JSON object containing:

- the room id
- the room name
- whether the result came from the AI path or the fallback path
- an array of sentiment summaries for each participant
- a generation timestamp

This satisfies the requirement that the AI functionality be accessible via a backend REST API.

## Setup And Run Notes

### Required Software

- Node.js `v22.19.0` tested
- MongoDB running locally on `mongodb://localhost:27017`
- `mongosh`

### Required Packages

From [package.json](/c:/Users/domin/OneDrive/Documents/GitHub/project-group-33/package.json):

- `express` `^4.22.1`
- `mongodb` `^7.1.0`
- `ws` `^8.19.0`
- `nodemon` `^3.1.14`

### Environment Variables

Create a `.env` file in the project root:

```env
OPENAI_API_KEY=your_api_key_here
```

The server reads this value automatically on startup.

### Database Initialization

Run the following in `mongosh`:

```javascript
load("initdb.mongo")
load("src/initUsers.mongo")
```

### Starting The App

```bash
npm install
npx nodemon server.js
```

Then open `http://localhost:3000`.

## Limitations

- OpenAI-backed features require network access and a valid API key.
- AI response quality and sentiment labels are approximate rather than ground truth.
- The sentiment analyzer summarizes the current room history and does not model long-term user behavior across rooms.
- Voice playback depends on browser support for the Web Speech API (we use Chromium-based browsers).
