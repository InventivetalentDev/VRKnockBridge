const WebSocketServer = require("websocket").server;
const http = require("http");

let server = http.createServer(function (request, response) {
    console.log((new Date()) + ' Received request for ' + request.url);
    response.writeHead(404);
    response.end();
});
let port = 16945;
server.listen(port, function () {
    console.log((new Date()) + ' Server is listening on port ' + port);
});

let servers = {};
let clients = {};

wsServer = new WebSocketServer({
    httpServer: server,
    // You should not use autoAcceptConnections for production
    // applications, as it defeats all standard cross-origin protection
    // facilities built into the protocol and the browser.  You should
    // *always* verify the connection's origin and decide whether or not
    // to accept it.
    autoAcceptConnections: false
});

function originIsAllowed(origin) {
    console.log("origin: " + origin)
    if (!origin) {
        return false;
    }
    return true;
}

function printInfo() {
    console.log("[I] " + Object.keys(servers).length + " servers, " + Object.keys(clients).length + " clients");
}

wsServer.on('request', function (request) {
    if (!originIsAllowed(request.origin)) {
        // Make sure we only accept requests from an allowed origin
        request.reject();
        console.log((new Date()) + ' Connection from origin ' + request.origin + ' rejected.');
        return;
    }

    let connection = request.accept(null, request.origin);
    console.log((new Date()) + ' Connection accepted.');

    printInfo();

    connection.isRegistered = false;
    connection.isClient = false;
    connection.isServer = false;

    connection.on('message', function (message) {
        if (message.type === 'utf8') {
            console.log('Received Message: ' + message.utf8Data);
            // connection.sendUTF(message.utf8Data);

            let json = JSON.parse(message.utf8Data);
            if (json) {
                if (!json.hasOwnProperty("_type")) {
                    connection.close(1008/*policy violation*/, "missing message type");
                }else{
                    if (!json.hasOwnProperty("payload")) {
                        connection.close(1008, "missing payload");
                    }else {
                        let payload = json["payload"];
                        switch (json["_type"]) {
                            case "register":
                                if (connection.isRegistered) {
                                    connection.close(1008, "already registered");
                                } else {
                                    if(!payload.hasOwnProperty("type")){
                                        connection.close(1008, "missing type");
                                    }else {
                                        let type = payload["type"];
                                        if (type === "server") {
                                            if (!payload.hasOwnProperty("serverId")) {
                                                connection.close(1008, "missing server id");
                                            }else{
                                                connection.isServer = true;
                                                connection.isRegistered = true;
                                                connection.serverId = payload["serverId"];
                                                connection.clients = [];

                                                servers[connection.serverId] = connection;
                                                console.log("Registered server with ID " + connection.serverId);
                                                connection.send(JSON.stringify({_state:"REGISTERED"}));
                                            }
                                        } else if (type === "client") {
                                            if (!payload.hasOwnProperty("clientId")) {
                                                connection.close(1008, "missing server id");
                                            }else{
                                                connection.isClient = true;
                                                connection.isRegistered = true;
                                                connection.clientId = payload["clientId"];
                                                connection.server = null;

                                                clients[connection.clientId] = connection;
                                                console.log("Registered client with ID " + connection.clientId);
                                                connection.send(JSON.stringify({_state:"REGISTERED"}));
                                            }
                                        }
                                    }
                                }
                                printInfo();
                                break;
                            case "forward":
                                if (!connection.isRegistered) {
                                    connection.close(1008, "not registered");
                                }else{
                                    if (!json.hasOwnProperty("source")) {
                                        connection.close(1008, "missing source");
                                    }else if (!json.hasOwnProperty("target")) {
                                        connection.close(1008, "missing target");
                                    }else{
                                        let source = json["source"];
                                        let target = json["target"];

                                        let targetConnection;
                                        if (connection.isServer) {
                                            if (!servers[source]) {
                                                connection.close(1002);
                                                console.warn("Received forward from 'server' at "+connection.remoteAddress+" with mismatching source");
                                            }else if(!clients[target]){
                                                connection.send(JSON.stringify({status:1, msg: "target client not found"}));
                                                connection.close(1000);
                                            }else{
                                                targetConnection = clients[target];
                                                if (connection.clients.indexOf(target) === -1) {
                                                    connection.clients.push(target);
                                                   connection.send(JSON.stringify({_state:"CONNECT",which:target}));
                                                }
                                            }
                                        }else if (connection.isClient) {
                                            if (!clients[source]) {
                                                connection.close(1002);
                                                console.warn("Received forward from 'client' at "+connection.remoteAddress+" with mismatching source")
                                            }else if(!servers[target]){
                                                connection.send(JSON.stringify({status:1, msg: "target server not found"}));
                                                connection.close(1000);
                                            }else{
                                                targetConnection = servers[target];
                                                if (!connection.server) {
                                                    connection.server = target;
                                                    connection.send(JSON.stringify({_state:"CONNECT",which:target}));
                                                }
                                            }
                                        }
                                        if (!targetConnection) {
                                            return;
                                        }

                                        payload["_source"] = source;
                                        targetConnection.send(JSON.stringify(payload));
                                    }
                                }
                                break;
                            default:
                                connection.close(1008/*policy violation*/, "invalid message type");
                                break;
                        }
                    }
                }
            }
        } else {
            connection.close(1003, "unsupported data type");
        }
    });
    connection.on('close', function (reasonCode, description) {
        connection.isRegistered = false;
        if (connection.isClient&&connection.clientId) {
            delete clients[connection.clientId];
            connection.isClient = false;

            if (connection.server) {
                let s = servers[connection.server];
                if (s) {
                    let i = s.clients.indexOf(connection.clientId);
                    if (i !== -1) {
                        s.clients.splice(i, 1);
                    }
                    s.send(JSON.stringify({_state:"DISCONNECT",which:connection.clientId}));
                }
                connection.server=null;
            }
        }
        if (connection.isServer && connection.serverId) {
            delete servers[connection.serverId];
            connection.isServer = false;

            if (connection.clients) {
                for (let i = 0; i < connection.clients.length; i++) {
                    let c = clients[connection.clients[i]];
                    if (c) {
                        if (c.server === connection.serverId) {
                            c.server=null;
                            c.send(JSON.stringify({_state:"DISCONNECT",which:connection.serverId}));
                        }
                    }
                }
                connection.clients = [];
            }
        }
        console.log((new Date()) + ' Peer ' + connection.remoteAddress + ' disconnected.');
        printInfo();
    });
});
