const express = require("express");
const http = require("http");
const WebSocket = require("ws");

// Create an Express app
const app = express();

// Create HTTP server
const server = http.createServer(app);

// Create a WebSocket server
const wss = new WebSocket.Server({ server });


let waitingSessionQueue = [];
let gameRooms = {};
let playersWs = {};
let connectedPlayers = {};

app.get("/", (req, res) => {
    res.send("WebSocket server is running");
});

// Handle WebSocket connections
wss.on("connection", (ws) => {
    // Handle data during initial connection
    let deviceId;
    let name;
    let isGameOver;

    ws.on("message", (message) => {
        try {
            const data = JSON.parse(message);

            // Handle position updates
            if (data.type === "positionUpdate") {
                console.log("Received position update from " + data.deviceId + "-" + data.newPosition);
                broadcastPositionUpdate(data.deviceId, data.newPosition);
                return;
            }

            // Handle attack updates
            if (data.type === "isFirstAttack") {
                console.log("Received isFirstAttack " + data.deviceId + "-" + data.isFirstAttack);
                broadcastAttackUpdate(data.deviceId, data.isFirstAttack);
                return;
            }

            // Handle score and Strength updates
            if (data.type === "scoreAndStrength") {
                console.log("Received score " + data.deviceId + "-" + data.score, data.strength, data.isGameOver, data.opponentId, data.RemoteStrength);
                broadcastScoreUpdate(data.deviceId, data.score, data.strength, data.isGameOver, data.opponentId, data.RemoteStrength);
                return;
            }

            // Handle second attack update
            if (data.type === "isSecondAttack") {
                console.log("Received isSecondAttack " + data.deviceId + "-" + data.isSecondAttack);
                broadcastSecondAttackUpdate(data.deviceId, data.isSecondAttack);
                return;
            }

            if (data.type === "local") {
                console.log("LocalScoreAndStrength " + data.score + " - " + data.score);
                broadcastLocalUpdate(data.deviceId, data.score, data.strength);
                return;
            }

            if (data.type === "opponent") {
                console.log("OpponentScoreAndStrength " + data.score + " - " + data.strength);
                broadcastOpponentUpdate(data.deviceId, data.score, data.strength);
                return;
            }

            // Handle score and Strength updates
            if (data.type === "isShield") {
                console.log("Received Shield status " + data.deviceId + "-" + data.isShield);
                broadcastShieldUpdate(data.deviceId, data.isShield);
                return;
            }

            // Handle data during initial connection
            deviceId = data.deviceId;
            name = data.name;
            isGameOver = false;

            if (connectedPlayers[deviceId]) {
                ws.send(JSON.stringify({ status: "error", message: "Already connected." }));
                return;
            }

            playersWs[deviceId] = ws;
            connectedPlayers[deviceId] = null;

            if (waitingSessionQueue.length === 0) {
                waitingSessionQueue.push({ deviceId, ws, name, isGameOver });
                ws.send(JSON.stringify({
                    status: "waiting",
                    message: "Waiting for opponent...",
                    waitingDeviceId: deviceId,
                    name: name,
                }));
                console.log("Watinh Session " + name);
            } else {
                const waitingDevice = waitingSessionQueue.shift();
                const roomId = "room_" + Math.random().toString(36).substr(2, 9);
                gameRooms[roomId] = [waitingDevice.deviceId, deviceId];

                //This allows the second player to know their own deviceId, the opponent’s deviceId, and the assigned roomId.
                ws.send(JSON.stringify({
                    status: "connected",
                    roomId,
                    deviceId: deviceId,
                    opponentDeviceId: waitingDevice.deviceId,
                    deviceIdName: name,
                    opponentDeviceIdName: waitingDevice.name,
                    isGameOver: isGameOver,
                }));

                //This allows the first player to know their own deviceId, the opponent’s deviceId, and the assigned roomId.
                waitingDevice.ws.send(JSON.stringify({
                    status: "connected",
                    roomId,
                    deviceId: waitingDevice.deviceId,
                    opponentDeviceId: deviceId,
                    deviceIdName: waitingDevice.name,
                    opponentDeviceIdName: name,

                }));

                connectedPlayers[deviceId] = roomId;
                connectedPlayers[waitingDevice.deviceId] = roomId;

                console.log("Room " + roomId + " created with players: " + waitingDevice.deviceId + " and " + deviceId + "isGameOver");
                console.log("Room " + roomId + " created with players: " + waitingDevice.name + " and " + name);
            }
        } catch (error) {
            console.error("Error processing message:", error);
        }
    });

    ws.on("close", () => {
        if (deviceId) {
            const roomId = connectedPlayers[deviceId];
            if (roomId) {
                const room = gameRooms[roomId];

                // Notify each player in the room about disconnection and room deletion
                room.forEach((playerId) => {
                    if (playersWs[playerId]) {
                        playersWs[playerId].send(JSON.stringify({
                            type: "roomDeleted",
                            roomId: roomId,
                            message: "The room has been deleted due to player disconnection.",
                            disconnectedDeviceId: deviceId,
                            isGameOver: true,
                        }));
                    }
                    // Remove each player's WebSocket and connected status
                    delete playersWs[playerId];
                    delete connectedPlayers[playerId];
                });

                // After clearing players, delete the room itself
                delete gameRooms[roomId];
                console.log("Room " + roomId + " deleted with players " + room + " due to disconnection");
            }

            // Remove the disconnected player from waiting session queue if present
            waitingSessionQueue = waitingSessionQueue.filter(entry => entry.deviceId !== deviceId);
            console.log("Player " + deviceId + " disconnected");
        }
    });

});

// Broadcast position updates to other players in the same room
function broadcastPositionUpdate(sourceDeviceId, newPosition) {
    const roomId = connectedPlayers[sourceDeviceId];
    if (!roomId || !gameRooms[roomId]) return;

    gameRooms[roomId].forEach(targetDeviceId => {
        if (targetDeviceId !== sourceDeviceId) {
            const targetWs = playersWs[targetDeviceId];
            if (targetWs) {
                targetWs.send(JSON.stringify({
                    type: "positionUpdate",
                    deviceId: sourceDeviceId,
                    newPosition: newPosition
                }));
                console.log("Position update sent to " + targetDeviceId);
            }
        }
    });
}


// Broadcast position updates to other players in the same room
function broadcastScoreUpdate(sourceDeviceId, score, strength, isGameOver, opponentId, RemoteStrength) {
    const roomId = connectedPlayers[sourceDeviceId];
    if (!roomId || !gameRooms[roomId]) return;

    gameRooms[roomId].forEach(targetDeviceId => {
        // if (targetDeviceId !== sourceDeviceId) {
        const targetWs = playersWs[targetDeviceId];
        if (targetWs) {
            targetWs.send(JSON.stringify({
                type: "scoreAndStrength",
                deviceId: sourceDeviceId,
                score: score,
                strength: strength,
                isGameOver: isGameOver,
                opponentId: opponentId,
                RemoteStrength: RemoteStrength
            }));
            console.log("score update sent to " + targetWs + " - " + score + " - " + strength + " - " + opponentId);
        }
        // }
    });
}

// Broadcast position updates to other players in the same room
function broadcastAttackUpdate(sourceDeviceId, isFirstAttack) {
    const roomId = connectedPlayers[sourceDeviceId];
    if (!roomId || !gameRooms[roomId]) return;

    gameRooms[roomId].forEach(targetDeviceId => {
        if (targetDeviceId !== sourceDeviceId) {
            const targetWs = playersWs[targetDeviceId];
            if (targetWs) {
                targetWs.send(JSON.stringify({
                    type: "isFirstAttack",
                    deviceId: sourceDeviceId,
                    isFirstAttack: isFirstAttack
                }));
                console.log("Attack update sent to " + targetDeviceId + " - " + isFirstAttack);
            }
        }
    });
}

// Broadcast position updates to other players in the same room
function broadcastSecondAttackUpdate(sourceDeviceId, isSecondAttack) {
    const roomId = connectedPlayers[sourceDeviceId];
    if (!roomId || !gameRooms[roomId]) return;

    gameRooms[roomId].forEach(targetDeviceId => {
        if (targetDeviceId !== sourceDeviceId) {
            const targetWs = playersWs[targetDeviceId];
            if (targetWs) {
                targetWs.send(JSON.stringify({
                    type: "isSecondAttack",
                    deviceId: sourceDeviceId,
                    isSecondAttack: isSecondAttack
                }));
                console.log("Second Attack update sent to " + targetDeviceId + " - " + isSecondAttack);
            }
        }
    });
}

// Broadcast position updates to other players in the same room
function broadcastShieldUpdate(sourceDeviceId, isShield) {
    const roomId = connectedPlayers[sourceDeviceId];
    if (!roomId || !gameRooms[roomId]) return;

    gameRooms[roomId].forEach(targetDeviceId => {
        if (targetDeviceId !== sourceDeviceId) {
            const targetWs = playersWs[targetDeviceId];
            if (targetWs) {
                targetWs.send(JSON.stringify({
                    type: "isShield",
                    deviceId: sourceDeviceId,
                    isShield: isShield
                }));
                console.log("Second Attack update sent to " + targetDeviceId + " - " + isShield);
            }
        }
    });
}


function broadcastLocalUpdate(sourceDeviceId, score, strength) {
    const roomId = connectedPlayers[sourceDeviceId];
    if (!roomId || !gameRooms[roomId]) return;

    gameRooms[roomId].forEach(targetDeviceId => {
        if (targetDeviceId !== sourceDeviceId) {
            const targetWs = playersWs[targetDeviceId];
            if (targetWs) {
                targetWs.send(JSON.stringify({
                    type: "local",
                    deviceId: sourceDeviceId,
                    score: score,
                    strength: strength
                }));
                console.log("LocalScore" + targetDeviceId);
            }
        }
    });
}
function broadcastOpponentUpdate(sourceDeviceId, score, strength) {
    const roomId = connectedPlayers[sourceDeviceId];
    if (!roomId || !gameRooms[roomId]) return;

    gameRooms[roomId].forEach(targetDeviceId => {
        if (targetDeviceId !== sourceDeviceId) {
            const targetWs = playersWs[targetDeviceId];
            if (targetWs) {
                targetWs.send(JSON.stringify({
                    type: "opponent",
                    deviceId: sourceDeviceId,
                    score: score,
                    strength: strength
                }));
                console.log("OpponentScore " + targetDeviceId);
            }
        }
    });
}


// Expose the WebSocket server as a Cloud Function
// exports.websocket = functions.https.onRequest((req, res) => {
//     console.log("Received request:", req.method, req.url);
//     server.emit("request", req, res);
// });

// Start the server (commented out for Firebase deployment)
const PORT = 8081;
server.listen(PORT, () => {
    console.log("WebSocket server running on port " + PORT);
});
