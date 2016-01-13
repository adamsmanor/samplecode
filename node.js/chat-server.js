var net = require('net');

// read the config file to determine which port to listen on
var config = require('./chat-config.json').config;
var PORT = config.port || 4545;
var MOTD = config.motd;
var MAXBAN = config.maxban || 3;
var LOG = true;

// our list of connected clients
var clients = [];
clients.getClientByName = function(name) {
	for (clientIndex = 0; clientIndex < this.length; clientIndex++) {
		if (this[clientIndex].name == name) {
			return this[clientIndex];
		}
	}
	return undefined;
}
clients.getClientBySocket = function(socket) {
	for (clientIndex = 0; clientIndex < this.length; clientIndex++) {
		if (this[clientIndex].socket == socket) {
			return this[clientIndex];
		}
	}
	return undefined;
}

var server = net.createServer(function (socket) {

	logger(socket, 'Connection received');
	socket.write('Enter your name: ');

	var client = {
		name: undefined,
		socket: socket,
		isAdmin: false,
		bancount: 0
	};
	client.banUpdate = function() {
		this.bancount++;
		if (this.bancount >= MAXBAN) {
			logger(socket, client.name + ' disconnected due to abuse');
			socket.write('# You were warned... Now, go away\n');
			socket.end();
		}
	};

	if (!clients.length) {
		// first user to join gets ops
		client.isAdmin = true;
	}

	clients.push(client);

	socket.on('data', function(buffer) {
		var input = buffer.toString().trim();
		var message = '';
		var commandMode = false;

		if (!input) {
			return;
		}
		if (!client.name) {
			// new user - assume first input is a name
			client.name = input;
			if (!client.name.length) {
				// no name entered, have the user try again
				socket.write('You must enter a name to continue\n');
				socket.write('Enter your name: ');
				return;
			}
			socket.write('Welcome, ' + client.name + ', to this chat server!\n');
			
			// TODO read MOTD when client joins to always get the latest version

			socket.write('For help, use the "/help" command.\n\n' + MOTD + '\n');
			message = '# ' + client.name + ' has joined the channel\n';
			logger(socket, message);
		} else {
			message = client.name + ': ' + input + '\n';
			logger(socket, client.name + ' says: ' + input);
		}

		// did the user enter a command? if so, process it
		if(input.substring(0,1) == '/') {
			commandMode = true;
			var command = input.substring(1).split(' ');
			switch (command[0]) {
				case 'kickme':
					socket.write('# The server dropkicks you through the goalposts!\n');
					// fall through to quit case
				case'q':
				case 'quit':
				case 'part':
				case 'partall':
					socket.write('# You have disconnected from this channel\n');
					socket.end();
					return;
				case 'me':
				case 'action':
					// display an action
					message = '* ' + client.name + ' ' + command.slice(1).join(' ') + '\n';
					break;
				case 'nick':
					// update user's nickname
					var newName = command.slice(1).join(''); // don't use spaces here
					var oldName = client.name;
					client.name = newName;
					message = '* ' + oldName + ' is now known as ' + newName + '\n';
					break;
				case 'msg':
				case 'notice':
				case 'query':
					var cmdName = command[1];
					var cmdMessage = command.slice(2).join(' ');
					var cmdClient = clients.getClientByName(cmdName);
					if (cmdClient) {
						cmdClient.socket.write('-> *' + client.name + '* ' + cmdMessage + '\n');
						socket.write('-> *' + cmdName + '* ' + cmdMessage + '\n');
						return;
					}
					socket.write('# Can\'t find ' + cmdName + ' to send your message\n');
					return;
				case 'who':
					socket.write('# The following users are connected\n');
					clients.forEach(function (c) {
						socket.write('     ' + (c.isAdmin ? '(*)' : '   ') + c.name + '\n');
					});
					return;
				case 'dropkick':
				case 'kick':
					var cmdName = command[1];
					var cmdMessage = command.slice(2).join(' ');
					if (!client.isAdmin) {
						socket.write('# You do not have permission to kick other users\n');
						client.banUpdate();
						return;
					}
					var cmdClient = clients.getClientByName(cmdName);
					if (cmdClient) {
						cmdClient.socket.write('*kicked by ' + client.name + '* ' + cmdMessage + '\n');
						cmdClient.socket.end();
					}
					message = '* ' + cmdName + ' kicked by ' + client.name + (cmdMessage ? ' -- reason: ' + cmdMessage : '') + '\n';
					break;
				case 'giveop':
					var cmdName = command[1];
					if (!client.isAdmin) {
						socket.write('# You do not have permission to give ops to other users\n');
						client.banUpdate();
						return;
					}
					var cmdClient = clients.getClientByName(cmdName);
					if (cmdClient) {
						cmdClient.socket.write('# You are now an op. Remember, with great power comes great responsibility.\n');
						cmdClient.isAdmin = true;
						socket.write('# Ops given to ' + cmdName + '\n');
					}
					return;
				case 'takeop':
					var cmdName = command[1];
					if (!client.isAdmin) {
						socket.write('# You do not have permission to take ops from other users\n');
						client.banUpdate();
						return;
					}
					var cmdClient = clients.getClientByName(cmdName);
					if (cmdClient) {
						cmdClient.socket.write('# You are no longer an op.\n');
						cmdClient.isAdmin = false;
						socket.write('# Ops removed from ' + cmdName + '\n');
					}
					return;
				case 'help':
					socket.write('# The following commands are available\n');
					socket.write('\t/me <action>\n');
					socket.write('\t/nick <newNick>\n');
					socket.write('\t/msg <nickname> <your message>\n');
					socket.write('\t/who\n');
					socket.write('\t/quit or /q\n');
					socket.write('\t/kickme\n');
					if (client.isAdmin) {
						socket.write('\t/kick <nickname>\n');
						socket.write('\t/giveop <nickname>\n');
						socket.write('\t/takeop <nickname>\n');
					}
					return;
				case 'ping':
				case 'ignore':
				case 'whois':
				case 'chat':
					socket.write('# Command not implemented\n');
					socket.write('# See /help for list of commands\n');
					return;
				default:
					socket.write('# Unknown command\n');
					socket.write('# See /help for list of commands\n');
					return;
			}
		}

		// send message to the appropriate clients
		try {
			clients.forEach(function (c) {
				// note: in command mode, send message to originating client; otherwise, do not
				if (c.name && (c.socket != socket || commandMode)) {
					c.socket.write(message);
				}
			});
		} catch (err) {
		}
	});

	socket.on('end', function() {
		for (var clientIndex = 0; clientIndex < clients.length; clientIndex++) {
			// remove the disconnected user from the list of clients
			if (clients[clientIndex].socket == socket) {
				clients.splice(clientIndex, 1);
			}
		}
		logger(socket, client.name + ' disconnected');
		clients.forEach(function (c) {
			c.socket.write('# ' + client.name + ' has left the channel\n');
		});
	});
});

server.listen(PORT);

var logger = function(socket, message) {
	if (LOG) {
		console.log(socket.remoteAddress + ' -- ' + message.trim());
	}
}
