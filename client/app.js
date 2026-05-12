// Removes the contents of the given DOM element (equivalent to elem.innerHTML = '' but faster)
function emptyDOM (elem){
    while (elem.firstChild) elem.removeChild(elem.firstChild);
}

// Creates a DOM element from the given HTML string
function createDOM (htmlString){
    let template = document.createElement('template');
    template.innerHTML = htmlString.trim();
    return template.content.firstChild;
}

function sanitize(string) {
    return String(string).replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

var profile = { username: null };
const AI_ROOM_NAME = 'AI Chat';
const AI_BOT_USERNAME = 'AI bot';

function isAIRoomData(room) {
    return Boolean(
        room &&
        (room.isAI === true ||
            (typeof room.name === 'string' && room.name.trim().toLowerCase() === AI_ROOM_NAME.toLowerCase()))
    );
}

function pickVoice(voices, type) {
    const englishVoices = voices.filter(voice => voice.lang && voice.lang.toLowerCase().startsWith('en'));
    if (type === 'female') {
        return englishVoices.find(voice => /zira|aria|samantha|victoria|female|woman|girl/i.test(voice.name))
        || englishVoices[0];
    }
    if (type === 'male') {
        return englishVoices.find(voice => /david|john|michael|mark|male|man|boy/i.test(voice.name))
        || englishVoices[0];
    }

    return englishVoices[0];
}
   
var Service = {
    origin: window.location.origin,

    addRoom: function (data) {
        return fetch(Service.origin + '/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        })
        .then(async (response) => {
            if (!response.ok) {
                const message = await response.text();
                throw new Error(message || `HTTP ${response.status}`);
            }
            return response.json();
        })
    },

    getAllRooms: function () {
        return fetch(Service.origin + '/chat')
            .then(async (response) => {
                if (!response.ok) {
                    const message = await response.text();
                    throw new Error(message || `HTTP ${response.status}`);
                }
                return response.json();
            });
    },

    getLastConversation: function (roomId, before) {
        let url = Service.origin + '/chat/' + encodeURIComponent(roomId) + '/messages';
        if (before !== undefined) {
            url += '?before=' + encodeURIComponent(before);
        }

        return fetch(url).then(async (response) => {
            if (!response.ok) {
                const message = await response.text();
                throw new Error(message || `HTTP ${response.status}`);
            }
            return response.json();
        });
    },

    getRoomSentiment: function (roomId) {
        return fetch(Service.origin + '/chat/' + encodeURIComponent(roomId) + '/sentiment')
            .then(async (response) => {
                if (!response.ok) {
                    const message = await response.text();
                    throw new Error(message || `HTTP ${response.status}`);
                }
                return response.json();
            });
    },

    getProfile: function () {
        return fetch(Service.origin + '/profile')
            .then(async (response) => {
                if (!response.ok) {
                    const message = await response.text();
                    throw new Error(message || `HTTP ${response.status}`);
                }
                return response.json();
            });
    }
};

function* makeConversationLoader(room) {
    let before = Date.now();
    if (Array.isArray(room.messages) && room.messages.length > 0) {
        const firstMessage = room.messages[0];
        const firstMessageTimestamp = Number(firstMessage && firstMessage.timestamp);
        if (Number.isFinite(firstMessageTimestamp)) {
            before = firstMessageTimestamp - 1;
        }
    }

    const createdAt = Number(room && room.createdAt);
    if (Number.isFinite(createdAt)) {
        before = Math.min(before, createdAt);
    }

    let done = false;

    while (!done) {
        room.canLoadConversation = false;

        const promise = Service.getLastConversation(room.id, before)
            .then((conversation) => {
                if (conversation) {
                    before = conversation.timestamp;
                    room.canLoadConversation = true;
                    room.addConversation(conversation);
                    return conversation;
                }

                done = true;
                return null;
            })
            .catch((error) => {
                room.canLoadConversation = true;
                throw error;
            });

        yield promise;
    }
}

class Room {
    constructor(id, name, image = 'assets/everyone-icon.png', messages = [], isAI = false) {
        this.id = id;
        this.name = name;
        this.image = image;
        this.messages = messages;
        this.isAI = isAI;
        this.createdAt = Date.now();
        this.onNewMessage = null;
        this.onFetchConversation = null;
        this.canLoadConversation = true;
        this.getLastConversation = makeConversationLoader(this);
    }

    addMessage(username, text) {
        if (!text || text.trim() === '') return;
        const message = { username, text};
        this.messages.push(message);
        if (this.onNewMessage) {
            this.onNewMessage(message);
        }
    }

    addConversation(conversation) {
        if (!conversation || !Array.isArray(conversation.messages) || conversation.messages.length === 0) return;

        this.messages = conversation.messages.concat(this.messages);
        if (this.onFetchConversation) {
            this.onFetchConversation(conversation);
        }
    }
}

class Lobby {
    constructor() {
        this.rooms = {};
        this.onNewRoom = null;
    }

    getRoom(roomId) {
        return this.rooms[roomId];
    }

    addRoom(id, name, image, messages, isAI = false) {
        const room = new Room(id, name, image, messages, isAI);
        this.rooms[id] = room;
        if (this.onNewRoom) {
            this.onNewRoom(room);
        }
        return room;
    }
}

class LobbyView {
    constructor(lobby) {
        this.lobby = lobby;
        this.elem = createDOM(`<div class="content">
          <ul class="room-list">
            <li><a href="#/chat">Room 1</a></li>
            <li><a href="#/chat">Room 2</a></li>
            <li><a href="#/chat">Room 3</a></li>
            <li><a href="#/chat">Room 4</a></li>
          </ul>

          <div class="page-control">
            <input type="text" placeholder="New room name" />
            <button>Create Room</button>
          </div>
        </div>`);

        this.listElem = this.elem.querySelector('ul.room-list');
        this.inputElem = this.elem.querySelector('input');
        this.buttonElem = this.elem.querySelector('button');

        this.redrawList();

        this.buttonElem.addEventListener('click', () => {
            const name = this.inputElem.value.trim();
            if (!name) return;
            

            const data = {
                name: name,
                image: 'assets/everyone-icon.png'
            };

            Service.addRoom(data)
                .then((room) => {
                    const roomId = room._id || room.id;
                    // only add locally AFTER server success
                    this.lobby.addRoom(roomId, room.name, room.image, room.messages || [], isAIRoomData(room));
                    this.inputElem.value = '';
                })
                .catch((err) => {
                console.error(err);
                alert(err.message);
                });

        });

        this.lobby.onNewRoom = () => this.redrawList();
    }

    createRoomListItem(room) {
        const roomClass = room.isAI ? ' class="ai-room"' : '';
        const roomBadge = room.isAI ? '<span class="room-badge">AI</span>' : '';
        const safeName = sanitize(room.name);
        const safeHref = `#/chat/${encodeURIComponent(room.id)}`;

        return createDOM(`<li${roomClass}><a href="${safeHref}"><span class="room-label">${safeName}</span>${roomBadge}</a></li>`);
    }

    redrawList() {
        emptyDOM(this.listElem);
        Object.values(this.lobby.rooms)
            .sort((a, b) => {
                if (a.isAI === b.isAI) return 0;
                return a.isAI ? -1 : 1;
            })
            .forEach(room => {
                this.listElem.appendChild(this.createRoomListItem(room));
            });
    }
}

 class ChatView {
    constructor(socket) {
        this.socket = socket;
        this.elem = createDOM(`<div class="content">
          <h4 class="room-name"></h4>

          <div class="ai-control">
            <div class="avatar-panel">
                <div class="avatar-face">
                    <img class="avatar-image" src="assets/portrait-girl.png" alt="Bot avatar">\
                </div>
                <div class="avatar-status">Idle</div>
            </div>

            <div class="avatar-controls">
                <label for="voice-select">Voice:</label>
                <select id="voice-select">
                    <option value="female">Girl</option>
                    <option value="male">Guy</option>
                </select>
            </div>
            </div>

          <div class="message-list">
            <div class="message">
              <span class="message-user"></span>
              <span class="message-text"></span>
            </div>
            
            <div class="message my-message">
              <span class="message-user"></span>
              <span class="message-text"></span>
            </div>
          </div>
          
          <div class="page-control">
            <textarea></textarea>
            <button class="send-button">Send</button>
          </div>

          <div class="chat-actions">
            <button class="sentiment-button" type="button">Analyze Sentiment</button>
          </div>

          <div class="sentiment-panel">
            <div class="sentiment-header">
              <h5>Emotion Snapshot</h5>
              <span class="sentiment-meta"></span>
            </div>
            <div class="sentiment-status"></div>
            <ul class="sentiment-list"></ul>
          </div>
        </div>`);

        this.titleElem = this.elem.querySelector('h4.room-name');
        this.chatElem = this.elem.querySelector('div.message-list');
        this.inputElem = this.elem.querySelector('textarea');
        this.buttonElem = this.elem.querySelector('button.send-button');
        this.sentimentButtonElem = this.elem.querySelector('button.sentiment-button');
        this.sentimentPanelElem = this.elem.querySelector('div.sentiment-panel');
        this.sentimentStatusElem = this.elem.querySelector('div.sentiment-status');
        this.sentimentListElem = this.elem.querySelector('ul.sentiment-list');
        this.sentimentMetaElem = this.elem.querySelector('span.sentiment-meta');
        this.room = null;
        this.sentimentRequestId = 0;
        this.avatarPanel = this.elem.querySelector('div.avatar-panel');
        this.avatarImage = this.avatarPanel.querySelector('img.avatar-image');
        this.avatarStatus = this.avatarPanel.querySelector('div.avatar-status');
        this.voiceSelect = this.elem.querySelector('select#voice-select');
        this.aiControlElem = this.elem.querySelector('div.ai-control');
        this.selectedVoiceType = 'female';
        this.updateAvatarImage();

        this.voiceSelect.addEventListener('change', () => {
            this.selectedVoiceType = this.voiceSelect.value;
            this.updateAvatarImage();
        });

        this.buttonElem.addEventListener('click', () => this.sendMessage());
        this.sentimentButtonElem.addEventListener('click', () => this.analyzeSentiment());
        this.inputElem.addEventListener('keyup', (evt) => {
            if (evt.key === 'Enter' && !evt.shiftKey) {
                evt.preventDefault();
                this.sendMessage();
            }
        });
        this.chatElem.addEventListener('wheel', (evt) => {
            if (!this.room) return;

            const getScrollTop = (value) => {
                const n = parseFloat(value);
                return Number.isFinite(n) ? n : 0;
            };
            const effectiveScrollTop = Math.max(
                getScrollTop(this.chatElem.scrollTop),
                evt && evt.currentTarget ? getScrollTop(evt.currentTarget.scrollTop) : 0,
                evt && evt.target ? getScrollTop(evt.target.scrollTop) : 0
            );
            if (effectiveScrollTop > 0) return;

            const scrollingUp = (typeof evt.deltaY === 'number')
                ? evt.deltaY < 0
                : (typeof evt.wheelDelta === 'number' ? evt.wheelDelta > 0 : false);

            if (scrollingUp && this.room.canLoadConversation) {
                this.room.getLastConversation.next();
            }
        });

        this.resetSentimentPanel('Analyze this room to see what each user is expressing.');
    }

    createMessageElem(message) {
        const isMine = message.username === profile.username;
        const isAIBotMessage = Boolean(this.room && this.room.isAI && message.username === AI_BOT_USERNAME);
        const classes = ['message'];
        if (isMine) classes.push('my-message');
        if (isAIBotMessage) classes.push('ai-message');
        const safeUsername = sanitize(message.username);
        const safeText = sanitize(message.text);

        return createDOM(`<div class="${classes.join(' ')}">
              <span class="message-user">${safeUsername}</span>
              <span class="message-text">${safeText}</span>
            </div>`);
    }

    resetSentimentPanel(message) {
        this.sentimentStatusElem.textContent = message;
        this.sentimentMetaElem.textContent = '';
        emptyDOM(this.sentimentListElem);
    }

    renderSentimentPanel(data) {
        emptyDOM(this.sentimentListElem);

        if (!data || !Array.isArray(data.sentiments) || data.sentiments.length === 0) {
            this.sentimentStatusElem.textContent = 'No messages to analyze in this room yet.';
            this.sentimentMetaElem.textContent = '';
            return;
        }

        this.sentimentStatusElem.textContent = 'Detected emotions by participant';
        this.sentimentMetaElem.textContent = data.source === 'ai'
            ? 'AI analysis'
            : (data.source === 'fallback' ? 'Local fallback analysis' : '');

        data.sentiments.forEach((sentiment) => {
            const safeUsername = sanitize(sentiment.username || 'Unknown');
            const safeEmotion = sanitize(sentiment.emotion || 'neutral');
            const safeDetail = sanitize(sentiment.detail || '');
            const countLabel = Number.isFinite(Number(sentiment.messageCount))
                ? `${Number(sentiment.messageCount)} message${Number(sentiment.messageCount) === 1 ? '' : 's'}`
                : '';

            const item = createDOM(`<li class="sentiment-item">
                <div class="sentiment-user-row">
                    <span class="sentiment-user">${safeUsername}</span>
                    <span class="sentiment-emotion">${safeEmotion}</span>
                </div>
                <div class="sentiment-detail">${safeDetail}</div>
                <div class="sentiment-count">${sanitize(countLabel)}</div>
            </li>`);

            this.sentimentListElem.appendChild(item);
        });
    }

    analyzeSentiment() {
        if (!this.room) return;

        const requestId = ++this.sentimentRequestId;
        const roomId = this.room.id;
        this.sentimentButtonElem.disabled = true;
        this.resetSentimentPanel('Analyzing the conversation...');

        Service.getRoomSentiment(roomId)
            .then((data) => {
                if (requestId !== this.sentimentRequestId || !this.room || this.room.id !== roomId) return;
                this.renderSentimentPanel(data);
            })
            .catch((err) => {
                if (requestId !== this.sentimentRequestId || !this.room || this.room.id !== roomId) return;
                this.resetSentimentPanel(err.message || 'Unable to analyze this room right now.');
            })
            .finally(() => {
                if (requestId === this.sentimentRequestId) {
                    this.sentimentButtonElem.disabled = false;
                }
            });
    }

    sendMessage() {
        if (!this.room) return;

        const text = this.inputElem.value;
        if (!text || text.trim() === '') return;

        if (this.room && this.room.isAI) {
            this.setAvatarState('thinking');
        }

        this.room.addMessage(profile.username, text);
        this.inputElem.value = '';
        const payload = { roomId: this.room.id, text };
        if (this.socket && typeof this.socket.send === 'function') {
            this.socket.send(JSON.stringify(payload));
        }
    }

    setRoom(room) {
        if (!room) return;
        if (this.room && this.room !== room) {
            this.room.onNewMessage = null;
            this.room.onFetchConversation = null;
        }
        this.room = room;
        this.titleElem.textContent = room.name;
        this.titleElem.classList.toggle('ai-room', room.isAI);
        this.aiControlElem.style.display = room.isAI ? 'block' : 'none';
        this.sentimentButtonElem.disabled = false;
        this.sentimentRequestId += 1;
        this.resetSentimentPanel('Analyze this room to see what each user is expressing.');

        emptyDOM(this.chatElem);
        room.messages.forEach(message => {
            this.chatElem.appendChild(this.createMessageElem(message));
        });

        this.room.onNewMessage = (message) => {
            this.chatElem.appendChild(this.createMessageElem(message));
        };
        this.room.onFetchConversation = (conversation) => {
            if (!conversation || !Array.isArray(conversation.messages) || conversation.messages.length === 0) return;

            const oldHeight = this.chatElem.scrollHeight;
            const fragment = document.createDocumentFragment();

            conversation.messages.forEach((message) => {
                fragment.appendChild(this.createMessageElem(message));
            });

            this.chatElem.insertBefore(fragment, this.chatElem.firstChild);

            const newHeight = this.chatElem.scrollHeight;
            this.chatElem.scrollTop = newHeight - oldHeight;
        };
    }

    setAvatarState(status) {
        if (!this.avatarPanel || !this.avatarImage || !this.avatarStatus) return;

        this.avatarPanel.classList.remove('idle', 'thinking', 'speaking');
        this.avatarPanel.classList.add(status);

        if (status === 'idle') {
            this.avatarStatus.textContent = 'Idle';
        } else if (status === 'thinking') {
            this.avatarStatus.textContent = 'Thinking...';
        } else if (status === 'speaking') {
            this.avatarStatus.textContent = 'Speaking...';
        }
    }

    updateAvatarImage() {
        if (!this.avatarImage) return;

        if (this.selectedVoiceType === 'female') {
            this.avatarImage.src = 'assets/portrait-girl.png';
            this.avatarImage.alt = 'Girl avatar';
        } else if (this.selectedVoiceType === 'male') {
            this.avatarImage.src = 'assets/portrait-boy.png';
            this.avatarImage.alt = 'Boy avatar';
        }
    }
}

 class ProfileView {
    constructor() {
        this.elem = createDOM(`<div class="content">
            <div class="profile-form">
                <div class="form-field">
                  <label>Label</label>
                  <input type="text" />
                </div>
          
                <div class="form-field">
                  <label>Label</label>
                  <input type="password" />
                </div>
          
                <div class="form-field">
                  <label>Label</label>
                  <input type="file" />
                </div>
            </div>

            <div class="page-control">
                <button>Save</button>
            </div>
        </div>`);
    }
 }

function main() {
    const socket = new WebSocket('ws://localhost:8000');

    const pageView = document.getElementById('page-view');
    
    const lobby = new Lobby();

    // Make the voice sounds better by preloading the voices
    const synth = window.speechSynthesis;
    let voices = [];

    function populateVoices() {
        voices = synth.getVoices();
    }

    if ('onvoiceschanged' in synth) {
        synth.onvoiceschanged = populateVoices;
    } else {
        populateVoices();
    }

    Service.getProfile()
        .then((data) => {
            profile.username = data.username;
        })
        .catch((err) => {
            console.error('Failed to fetch profile:', err);
        });

    socket.addEventListener('message', (event) => {
        let data;
        try {
            data = JSON.parse(event.data);
        } catch (err) {
            return;
        }

        const room = lobby.getRoom(data.roomId);
        if (room) {
            room.addMessage(data.username, data.text);

            if (room && room.isAI && data.username === 'AI bot') {
                speechSynthesis.cancel(); // Stop any ongoing speech
                const utterance = new SpeechSynthesisUtterance(data.text);

                const preferredVoice = pickVoice(voices, chatView.selectedVoiceType);

                if (preferredVoice) {
                    utterance.voice = preferredVoice;
                }

                utterance.onstart = () => {
                    chatView.setAvatarState('speaking');
                };

                utterance.onend = () => {
                    chatView.setAvatarState('idle');
                };

                utterance.onerror = () => {
                    chatView.setAvatarState('idle');
                };

                speechSynthesis.speak(utterance);
            }
        }
    });

    const lobbyView = new LobbyView(lobby);
    const chatView = new ChatView(socket);
    const profileView = new ProfileView();

    function refreshLobby() {
        return Service.getAllRooms().then((rooms) => {
            const serverRoomIds = new Set();
            rooms.forEach((roomData) => {
                const roomId = roomData._id || roomData.id;
                serverRoomIds.add(String(roomId));
                const room = lobby.getRoom(roomId);
                if (room) {
                    room.name = roomData.name;
                    room.image = roomData.image;
                    room.isAI = isAIRoomData(roomData);
                } else {
                    lobby.addRoom(roomId, roomData.name, roomData.image, roomData.messages || [], isAIRoomData(roomData));
                }
            });

            Object.keys(lobby.rooms).forEach((roomId) => {
                if (!serverRoomIds.has(String(roomId))) {
                    delete lobby.rooms[roomId];
                }
            });

            lobbyView.redrawList();
        });
    }

    function renderRoute() {
        const raw = window.location.hash || '#/';
        const hash = raw.startsWith('#') ? raw.slice(1) : raw;  // Remove the leading '#' if it exists
        const path = hash.startsWith('/') ? hash.slice(1) : hash;  // Remove the leading '/' if it exists
        const parts = path.split('/'); // Split the path into parts
        const first = parts[0] || ''; // Get the first part of the path

        emptyDOM(pageView); // Clear the current page view

        if (first === '') {
            pageView.appendChild(lobbyView.elem); // Lobby content 
        } else if (first === 'chat') {
            const roomId = parts[1] || 'room-1';
            const room = lobby.getRoom(roomId);
            if (room) {
                chatView.setRoom(room);
                pageView.appendChild(chatView.elem); // Chat content
            }
        } else if (first === 'profile') {
            pageView.appendChild(profileView.elem); // Profile content
        }
    }

    window.addEventListener('popstate', renderRoute);
    window.addEventListener('hashchange', renderRoute);
    renderRoute();
    refreshLobby();
    setInterval(refreshLobby, 5000);

    cpen322.export(arguments.callee, {
        refreshLobby,
        renderRoute,
        lobby,
        lobbyView,
        chatView,
        profileView,
        socket
    });
}

window.addEventListener('load', main);
