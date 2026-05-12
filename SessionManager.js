const crypto = require('crypto');

class SessionError extends Error {};

function SessionManager (){
	// default session length - you might want to
	// set this to something small during development
	const CookieMaxAgeMs = 600000;

	// keeping the session data inside a closure to keep them protected
	const sessions = {};

	// might be worth thinking about why we create these functions
	// as anonymous functions (per each instance) and not as prototype methods
	this.createSession = (response, username, maxAge = CookieMaxAgeMs) => {
		const token = crypto.randomBytes(32).toString('hex');
		sessions[token] = {username: username, createdAt: Date.now(), 
			expiresAt: Date.now() + maxAge};

		response.cookie('cpen322-session', token, { maxAge: maxAge});

		setTimeout(() => {
			delete sessions[token];
		}, maxAge);

		return token;
	};

	this.deleteSession = (request) => {
		if (request && request.session && (request.session in sessions)) {
			delete sessions[request.session];
		}

		if (request) {
			delete request.username;
			delete request.session;
		}
	};

	this.middleware = (request, response, next) => {
		const cookieHeader = request.headers.cookie;
		if (!cookieHeader) {
			next(new SessionError('No cookie header'));
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
		if (!token || !(token in sessions)) {
			next(new SessionError('No session token in cookies'));
			return;
		}

		request.username = sessions[token].username;
		request.session = token;
		next();
	};

	// this function is used by the test script.
	// you can use it if you want.
	this.getUsername = (token) => ((token in sessions) ? sessions[token].username : null);
};

// SessionError class is available to other modules as "SessionManager.Error"
SessionManager.Error = SessionError;

module.exports = SessionManager;