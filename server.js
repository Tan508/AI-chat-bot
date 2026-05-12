const path = require('path');
const fs = require('fs');
const express = require('express');
const ws = require('ws');
const cpen322 = require('./cpen322-tester.js');
const Database = require('./Database.js');
const db = new Database('mongodb://localhost:27017', 'cpen322-messenger');
const messageBlockSize = 10;
const crypto = require('crypto');
const SessionManager = require('./SessionManager.js');
const sessionManager = new SessionManager();

function loadEnvFile(filePath) {
	if (!fs.existsSync(filePath)) return;

	const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
	lines.forEach((line) => {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) return;

		const separatorIndex = trimmed.indexOf('=');
		if (separatorIndex === -1) return;

		const key = trimmed.slice(0, separatorIndex).trim();
		let value = trimmed.slice(separatorIndex + 1).trim();

		if ((value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith('\'') && value.endsWith('\''))) {
			value = value.slice(1, -1);
		}

		if (process.env[key] === undefined) {
			process.env[key] = value;
		}
	});
}

loadEnvFile(path.join(__dirname, '.env'));

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const AI_ROOM_NAME = 'AI Chat';
const AI_BOT_USERNAME = 'AI bot';
const AI_ROOM_IMAGE = 'assets/everyone-icon.png';
const MAX_SENTIMENT_MESSAGES_PER_USER = 12;

function logRequest(req, res, next){
	console.log(`${new Date()}  ${req.ip} : ${req.method} ${req.path}`);
	next();
}

function isCorrectPassword(password, saltedHash) {
	const salt = saltedHash.slice(0, 20);
	const storedHash = saltedHash.slice(20);

	const hash = crypto.createHash('sha256')
		.update(password + salt)
		.digest('base64');

	return hash === storedHash;
}

function sanitize(string) {
    return String(string).replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
}

function extractOutputText(data) {
	if (typeof data.output_text === 'string' && data.output_text.trim() !== '') {
		return data.output_text.trim();
	}

	for (const item of data.output || []) {
		if (item.type === 'message' && Array.isArray(item.content)) {
			for (const part of item.content) {
				if (part.type === 'output_text' && typeof part.text === 'string' && part.text.trim() !== '') {
					return part.text.trim();
				}
			}
		}
	}

	return '';
}

function parseJsonResponseText(rawText) {
	let normalized = String(rawText || '').trim();
	if (!normalized) throw new Error('Response did not contain any JSON text');

	if (normalized.startsWith('```')) {
		normalized = normalized.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
	}

	return JSON.parse(normalized);
}

function getAllRoomMessages(roomId) {
	return db.getRoomConversations(roomId).then((conversations) => {
		const storedMessages = conversations.flatMap((conversation) => (
			Array.isArray(conversation.messages) ? conversation.messages : []
		));
		const pendingMessages = Array.isArray(messages[roomId]) ? messages[roomId] : [];

		return storedMessages
			.concat(pendingMessages)
			.filter((message) => message && typeof message.username === 'string' && typeof message.text === 'string');
	});
}

function groupMessagesByUser(roomMessages) {
	const groupedUsers = new Map();

	roomMessages.forEach((message) => {
		const username = message.username.trim();
		const text = message.text.trim();
		if (!username || !text) return;

		if (!groupedUsers.has(username)) {
			groupedUsers.set(username, { username, messages: [] });
		}

		groupedUsers.get(username).messages.push(text);
	});

	return Array.from(groupedUsers.values());
}

const emotionPatterns = {
	excited: [/\b(excited|amazing|awesome|yay|woo|hype|hyped|pumped|let's go|cant wait|can't wait)\b/gi],
	happy: [/\b(happy|glad|great|good|nice|love|loving|fun|sweet|cool)\b/gi],
	playful: [/\b(lol|haha|lmao|hehe|joke|jk|funny)\b/gi],
	supportive: [/\b(thanks|thank you|appreciate|good job|well done|proud|helpful)\b/gi],
	curious: [/\b(why|how|what|wonder|curious|maybe|perhaps|question)\b/gi],
	frustrated: [/\b(stuck|ugh|annoyed|annoying|issue|problem|broken|frustrated|frustrating|hard|not working|doesn't work|doesnt work)\b/gi],
	angry: [/\b(hate|angry|mad|furious|ridiculous|wtf)\b/gi],
	anxious: [/\b(worried|nervous|stress|stressed|anxious|concerned|unsure)\b/gi],
	sad: [/\b(sad|upset|sorry|disappointed|unhappy|bummed)\b/gi]
};

function buildEmotionDetail(emotion, messageCount) {
	const noun = messageCount === 1 ? 'message' : 'messages';
	switch (emotion) {
		case 'excited':
			return `Recent ${noun} feel energetic and enthusiastic.`;
		case 'happy':
			return `Recent ${noun} read as upbeat and positive.`;
		case 'playful':
			return `Recent ${noun} come across as playful and light.`;
		case 'supportive':
			return `Recent ${noun} sound encouraging and supportive.`;
		case 'curious':
			return `Recent ${noun} are mostly inquisitive.`;
		case 'frustrated':
			return `Recent ${noun} sound stuck or frustrated.`;
		case 'angry':
			return `Recent ${noun} carry a sharper tone.`;
		case 'anxious':
			return `Recent ${noun} feel uncertain or worried.`;
		case 'sad':
			return `Recent ${noun} read as downcast.`;
		default:
			return `Recent ${noun} are fairly neutral overall.`;
	}
}

function fallbackAnalyzeSentiment(groupedUsers) {
	return groupedUsers.map(({ username, messages: userMessages }) => {
		const text = userMessages.join(' ').toLowerCase();
		const scores = Object.fromEntries(Object.keys(emotionPatterns).map((emotion) => [emotion, 0]));

		Object.entries(emotionPatterns).forEach(([emotion, patterns]) => {
			patterns.forEach((pattern) => {
				const matches = text.match(pattern);
				if (matches) scores[emotion] += matches.length;
			});
		});

		scores.excited += (text.match(/!/g) || []).length;
		scores.curious += (text.match(/\?/g) || []).length;

		let emotion = 'neutral';
		let topScore = 0;
		Object.entries(scores).forEach(([candidate, score]) => {
			if (score > topScore) {
				topScore = score;
				emotion = candidate;
			}
		});

		return {
			username,
			emotion,
			detail: buildEmotionDetail(emotion, userMessages.length),
			messageCount: userMessages.length
		};
	});
}

async function analyzeSentimentWithAI(room, groupedUsers) {
	const promptUsers = groupedUsers.map(({ username, messages: userMessages }) => ({
		username,
		messages: userMessages.slice(-MAX_SENTIMENT_MESSAGES_PER_USER)
	}));

	const response = await fetch('https://api.openai.com/v1/responses', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${OPENAI_API_KEY}`
		},
		body: JSON.stringify({
			model: 'gpt-5.4-mini',
			input: [
				{
					role: 'system',
					content: 'Analyze the emotion each chat participant is expressing. Return JSON only with the shape {"sentiments":[{"username":"name","emotion":"short label","detail":"short sentence"}]}. Use only the usernames provided, keep emotion labels short, and keep each detail under 14 words.'
				},
				{
					role: 'user',
					content: JSON.stringify({
						roomName: room.name,
						participants: promptUsers
					})
				}
			]
		})
	});

	if (!response.ok) {
		const errText = await response.text();
		throw new Error(`OpenAI API error: ${response.status} ${errText}`);
	}

	const data = await response.json();
	const rawText = extractOutputText(data);
	const parsed = parseJsonResponseText(rawText);
	return Array.isArray(parsed.sentiments) ? parsed.sentiments : [];
}

async function analyzeRoomSentiment(room, roomMessages) {
	const groupedUsers = groupMessagesByUser(roomMessages);
	if (groupedUsers.length === 0) {
		return { source: 'none', sentiments: [] };
	}

	const fallbackSentiments = fallbackAnalyzeSentiment(groupedUsers);
	if (!OPENAI_API_KEY) {
		return { source: 'fallback', sentiments: fallbackSentiments };
	}

	try {
		const aiSentiments = await analyzeSentimentWithAI(room, groupedUsers);
		const fallbackByUser = new Map(fallbackSentiments.map((sentiment) => [sentiment.username, sentiment]));
		const aiByUser = new Map();

		aiSentiments.forEach((sentiment) => {
			if (!sentiment || typeof sentiment.username !== 'string') return;
			const username = sentiment.username.trim();
			if (!fallbackByUser.has(username)) return;

			const emotion = typeof sentiment.emotion === 'string' && sentiment.emotion.trim()
				? sentiment.emotion.trim().toLowerCase()
				: fallbackByUser.get(username).emotion;
			const detail = typeof sentiment.detail === 'string' && sentiment.detail.trim()
				? sentiment.detail.trim()
				: fallbackByUser.get(username).detail;

			aiByUser.set(username, {
				username,
				emotion,
				detail,
				messageCount: fallbackByUser.get(username).messageCount
			});
		});

		return {
			source: 'ai',
			sentiments: groupedUsers.map(({ username }) => aiByUser.get(username) || fallbackByUser.get(username))
		};
	} catch (err) {
		console.error('[AI] Failed to analyze room sentiment:', err);
		return { source: 'fallback', sentiments: fallbackSentiments };
	}
}

const host = 'localhost';
const port = 3000;
const clientApp = path.join(__dirname, 'client');
const messages = {};

function isAIRoom(room) {
	return Boolean(
		room &&
		(room.isAI === true ||
			(typeof room.name === 'string' && room.name.trim().toLowerCase() === AI_ROOM_NAME.toLowerCase()))
	);
}

function escapeRegex(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatRoom(room) {
	const roomId = String(room._id);
	if (!Array.isArray(messages[roomId])) messages[roomId] = [];

	return {
		...room,
		name: isAIRoom(room) ? AI_ROOM_NAME : room.name,
		isAI: isAIRoom(room),
		messages: [...messages[roomId]]
	};
}

function sortRooms(rooms) {
	return rooms.slice().sort((a, b) => {
		const aIsAI = isAIRoom(a);
		const bIsAI = isAIRoom(b);
		if (aIsAI === bIsAI) return 0;
		return aIsAI ? -1 : 1;
	});
}

let ensureAIRoomPromise = null;
function ensureAIRoom() {
	if (ensureAIRoomPromise) return ensureAIRoomPromise;

	ensureAIRoomPromise = db.connected
		.then(async (database) => {
			const rooms = database.collection('chatrooms');
			const conversations = database.collection('conversations');
			const aiRooms = await rooms.find({
				$or: [
					{ isAI: true },
					{ name: { $regex: `^${escapeRegex(AI_ROOM_NAME)}$`, $options: 'i' } }
				]
			}).toArray();

			let room = aiRooms.find((candidate) => candidate.name === AI_ROOM_NAME && candidate.isAI === true)
				|| aiRooms.find((candidate) => candidate.name === AI_ROOM_NAME)
				|| aiRooms[0];

			if (!room) {
				room = await db.addRoom({
					name: AI_ROOM_NAME,
					image: AI_ROOM_IMAGE,
					isAI: true
				});
			} else {
				const updates = {};
				if (room.name !== AI_ROOM_NAME) updates.name = AI_ROOM_NAME;
				if (room.isAI !== true) updates.isAI = true;
				if (!room.image) updates.image = AI_ROOM_IMAGE;
				if (Object.keys(updates).length > 0) {
					await rooms.updateOne({ _id: room._id }, { $set: updates });
					room = { ...room, ...updates };
				}
			}

			const canonicalRoomId = String(room._id);
			if (!Array.isArray(messages[canonicalRoomId])) messages[canonicalRoomId] = [];

			const duplicateRooms = aiRooms.filter((candidate) => String(candidate._id) !== canonicalRoomId);
			for (const duplicate of duplicateRooms) {
				const duplicateRoomId = String(duplicate._id);

				if (Array.isArray(messages[duplicateRoomId]) && messages[duplicateRoomId].length > 0) {
					messages[canonicalRoomId].push(...messages[duplicateRoomId]);
				}
				delete messages[duplicateRoomId];

				await conversations.updateMany(
					{ room_id: duplicateRoomId },
					{ $set: { room_id: canonicalRoomId } }
				);
				await rooms.deleteOne({ _id: duplicate._id });
			}

			return room;
		})
		.catch((err) => {
			ensureAIRoomPromise = null;
			throw err;
		});

	return ensureAIRoomPromise;
}

ensureAIRoom()
	.then(() => db.getRooms())
	.then((rooms) => {
		rooms.forEach((room) => {
			const roomId = String(room._id);
			if (!Array.isArray(messages[roomId])) messages[roomId] = [];
		});
	})
	.catch((err) => {
		console.error('[MongoDB] Failed to initialize rooms for messages map:', err);
	});

// express app
let app = express();

// AI reply generation using OpenAI API
async function getAIReply(userText) {
	if (!OPENAI_API_KEY) {
		return 'AI is not configured yet.';
	}

	const response = await fetch('https://api.openai.com/v1/responses', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${OPENAI_API_KEY}`
		},
		body: JSON.stringify({
			model: 'gpt-5.4-mini',
			input: [
				{
					role: 'system',
					content: 'You are a friendly chatbot in a room called AI Chat. Keep replies short.'
				},
				{
					role: 'user',
					content: userText
				}
			]
		})
	});

	if (!response.ok) {
		const errText = await response.text();
		throw new Error(`OpenAI API error: ${response.status} ${errText}`);
	}

	const data = await response.json();
	console.log('RAW OPENAI RESPONSE:', JSON.stringify(data, null, 2));
	return extractOutputText(data) || 'Sorry, I could not reply.';
}

const broker = new ws.Server({ port: 8000 });
broker.on('connection', (client, request) => {
	const cookieHeader = request.headers.cookie;

	if (!cookieHeader) {
		client.close();
		return;
	}

	const cookies = {};
	cookieHeader.split(';').forEach(pair => {
		const parts = pair.trim().split('=');
		const key = parts[0];
		const value = parts.slice(1).join('=');
		cookies[key] = value;
	});

	const token = cookies['cpen322-session'];
	const username = sessionManager.getUsername(token);

	if (!token || !username) {
		client.close();
		return;
	}

	client.username = username;
	client.session = token;

	client.on('message', async (data) => {
    const raw = data.toString();

    let parsed;
    try { parsed = JSON.parse(raw); } catch { return; }

    const roomId = parsed.roomId;
	const text = sanitize(parsed.text);
    if (!roomId || typeof text !== 'string') return;

    if (!Array.isArray(messages[roomId])) return;

	const message = { roomId: roomId, username: client.username, text: text };
    messages[roomId].push({ username: client.username, text: text });

	if (messages[roomId].length === messageBlockSize) {
		const conversation = {
			room_id: roomId,
			timestamp: Date.now(),
			messages: messages[roomId].slice(0, messageBlockSize)
		};
		db.addConversation(conversation)
			.then(() => {
				messages[roomId] = messages[roomId].slice(messageBlockSize);
			})
			.catch((err) => {
				console.error('[MongoDB] Failed to add conversation:', err);
			});
	}

    broker.clients.forEach((otherClient) => {
      	if (otherClient !== client && otherClient.readyState === ws.OPEN) {
        	otherClient.send(JSON.stringify(message));
      	}
    	});
		try {
			const room = await db.getRoom(roomId);

			if (room && isAIRoom(room)) {
				const aiText = await getAIReply(text);

				const aiMessage = {
					roomId: roomId,
					username: AI_BOT_USERNAME,
					text: sanitize(aiText)
				};

				messages[roomId].push({
					username: AI_BOT_USERNAME,
					text: sanitize(aiText)
				});

			broker.clients.forEach((otherClient) => {
				if (otherClient.readyState === ws.OPEN) {
					otherClient.send(JSON.stringify(aiMessage));
				}
			});
		}
	} catch (err) {
		console.error('[AI] Failed to generate reply:', err);
	}
  	});
});

app.use(express.json()) 						// to parse application/json
app.use(express.urlencoded({ extended: true })) // to parse application/x-www-form-urlencoded
app.use(logRequest);							// logging for debug

app.route('/chat')
	.get(sessionManager.middleware, (req, res) => {
		ensureAIRoom()
			.then(() => db.getRooms())
			.then((rooms) => {
				const payload = sortRooms(rooms).map(formatRoom);
				res.status(200).json(payload);
			})
			.catch((err) => {
				res.status(500).send(err.message);
			});
	})
	.post(sessionManager.middleware, (req, res) => {
		const data = req.body;
		const roomName = typeof data.name === 'string' ? data.name.trim() : '';

		// i) validate
		if (!data || !roomName) {
			res.status(400).send('Missing room name');
			return;
		}

		if (roomName.toLowerCase() === AI_ROOM_NAME.toLowerCase()) {
			res.status(400).send(`${AI_ROOM_NAME} is created automatically`);
			return;
		}

		// ii) create and persist new room
		const room = {
			name: roomName,
			image: data.image || 'assets/everyone-icon.png'
		};
		db.addRoom(room)
			.then((addedRoom) => {
				messages[String(addedRoom._id)] = [];
				res.status(200).json(addedRoom);
			})
			.catch((err) => {
				res.status(500).send(err.message);
			});
	});

app.get('/chat/:room_id', sessionManager.middleware, (req, res) => {
	const roomId = req.params.room_id;
	db.getRoom(roomId)
		.then((room) => {
			if (room) {
				res.status(200).json({
					...room,
					name: isAIRoom(room) ? AI_ROOM_NAME : room.name,
					isAI: isAIRoom(room)
				});
				return;
			}
			res.status(404).send(`Room ${roomId} was not found`);
		})
		.catch((err) => {
			res.status(500).send(err.message);
		});
});

app.get('/chat/:room_id/messages', sessionManager.middleware, (req, res) => {
	const roomId = req.params.room_id;
	const before = (req.query.before === undefined) ? undefined : Number(req.query.before);

	if (before !== undefined && Number.isNaN(before)) {
		res.status(400).send('Invalid "before" query parameter');
		return;
	}

	db.getLastConversation(roomId, before)
		.then((conversation) => {
			res.status(200).json(conversation);
		})
		.catch((err) => {
			res.status(500).send(err.message);
		});
});

app.get('/chat/:room_id/sentiment', sessionManager.middleware, async (req, res) => {
	const roomId = req.params.room_id;

	try {
		const room = await db.getRoom(roomId);
		if (!room) {
			res.status(404).send(`Room ${roomId} was not found`);
			return;
		}

		const roomMessages = await getAllRoomMessages(roomId);
		const sentiment = await analyzeRoomSentiment(room, roomMessages);
		res.status(200).json({
			roomId,
			roomName: isAIRoom(room) ? AI_ROOM_NAME : room.name,
			source: sentiment.source,
			sentiments: sentiment.sentiments,
			generatedAt: Date.now()
		});
	} catch (err) {
		res.status(500).send(err.message);
	}
});

app.get('/login', (req, res) => {
	res.sendFile(path.join(clientApp, 'login.html'));
});

app.post('/login', (req, res) => {
	const { username, password } = req.body;

	db.getUser(username)
		.then((user) => {
			if (!user) {
				return res.redirect('/login');	
			}

			if (isCorrectPassword(password, user.password)) {
				sessionManager.createSession(res, username);
				return res.redirect('/');
			}

			return res.redirect('/login');
		})
		.catch((err) => {
			console.error(err);
			res.redirect('/login');
		});
	});

app.get('/logout', sessionManager.middleware, (req, res) => {
	sessionManager.deleteSession(req);
});

app.get('/index', sessionManager.middleware, (req, res) => {
	res.sendFile(path.join(clientApp, 'index.html'));
});

app.get('/index.html', sessionManager.middleware, (req, res) => {
	res.sendFile(path.join(clientApp, 'index.html'));
});

app.get('/app.js', sessionManager.middleware, (req, res) => {
	res.sendFile(path.join(clientApp, 'app.js'));
});

app.get('/profile', sessionManager.middleware, (req, res) => {
	res.json({ username: req.username });
});

app.get('/', sessionManager.middleware, (req, res) => {
	res.sendFile(path.join(clientApp, 'index.html'));
});

app.use((err, req, res, next) => {
	if (err instanceof SessionManager.Error) {
		if (req.headers.accept && req.headers.accept.includes('application/json')) {
			res.status(401).send(err.message);
		} else {
			res.redirect('/login');
		}
		return;
	}
	res.status(500).send('internal server error');
});

// serve static files (client-side)
app.use('/', express.static(clientApp, { extensions: ['html'] }));
app.listen(port, () => {
	console.log(`${new Date()}  App Started. Listening on ${host}:${port}, serving ${clientApp}`);
});

cpen322.connect('https://ubc-cpen-322.github.io/obfuscated/test-a5-server.js');
cpen322.export(__filename, { app, db, messages, messageBlockSize, sessionManager, isCorrectPassword });
