const { MongoClient, ObjectId } = require('mongodb');	// require the mongodb driver

/**
 * Database wraps a mongoDB connection to provide a higher-level abstraction layer
 * for manipulating the objects in our cpen322 app.
 */
function Database(mongoUrl, dbName){
	if (!(this instanceof Database)) return new Database(mongoUrl, dbName);
	this.connected = new Promise((resolve, reject) => {
		const client = new MongoClient(mongoUrl);
		client.connect()
			.then(() => {
				console.log(`[MongoClient] Connected to ${mongoUrl}/${dbName}`);
				resolve(client.db(dbName));
			})
			.catch(reject);
	});
	this.status = () => this.connected.then(
		db => ({ error: null, url: mongoUrl, db: dbName }),
		err => ({ error: err })
	);
}

Database.prototype.getRooms = function(){
	return this.connected.then(db => db.collection('chatrooms').find({}).toArray());
}

Database.prototype.getRoom = function(room_id){
	return this.connected.then(db => {
		const collection = db.collection('chatrooms');

		if (room_id instanceof ObjectId) {
			return collection.findOne({ _id: room_id });
		}

		if (typeof room_id === 'string' && ObjectId.isValid(room_id)) {
			return collection.findOne({ _id: new ObjectId(room_id) })
				.then(room => {
					if (room) return room;
					return collection.findOne({ _id: room_id });
				});
		}

		return collection.findOne({ _id: room_id });
	});
}

Database.prototype.addRoom = function(room){
	return this.connected.then(db => {
		if (!room || !room.name) {
			throw new Error('Room name is required');
		}

		const roomToInsert = { ...room };
		return db.collection('chatrooms')
			.insertOne(roomToInsert)
			.then(result => ({ ...roomToInsert, _id: result.insertedId }));
	});
}

Database.prototype.getLastConversation = function(room_id, before){
	const beforeTime = (before === undefined) ? Date.now() : before;
	return this.connected.then(db => db.collection('conversations')
		.find({
			room_id: room_id,
			timestamp: { $lt: beforeTime }
		})
		.sort({ timestamp: -1 })
		.limit(1)
		.next()
	);
}

Database.prototype.addConversation = function(conversation){
	return this.connected.then(db => {
		if (!conversation ||
			conversation.room_id === undefined ||
			conversation.timestamp === undefined ||
			conversation.messages === undefined) {
			throw new Error('Conversation requires room_id, timestamp, and messages');
		}

		const conversationToInsert = { ...conversation };
		return db.collection('conversations')
			.insertOne(conversationToInsert)
			.then(result => ({ ...conversationToInsert, _id: result.insertedId }));
	});
}

Database.prototype.getRoomConversations = function(room_id) {
	return this.connected.then(db => db.collection('conversations')
		.find({ room_id: room_id })
		.sort({ timestamp: 1 })
		.toArray()
	);
}

Database.prototype.getUser = function(username) {
	return this.connected.then(db => {
		return db.collection('users').findOne({ username: username });
	})
}

module.exports = Database;
