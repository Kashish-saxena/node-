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
                console.log("Received score " + data.deviceId + "-" + data.score, data.strength, data.isGameOver, data.opponentId);
                broadcastScoreUpdate(data.deviceId, data.score, data.strength, data.isGameOver, data.opponentId);
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
                // Notify other player in the room
                room.forEach((playerId) => {
                    if (playerId !== deviceId && playersWs[playerId]) {
                        playersWs[playerId].send(JSON.stringify({
                            type: "playerDisconnected",
                            deviceId: deviceId
                        }));
                    }
                });
                delete gameRooms[roomId];
            }
            delete playersWs[deviceId];
            delete connectedPlayers[deviceId];
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
function broadcastScoreUpdate(sourceDeviceId, score, strength, isGameOver, opponentId) {
    const roomId = connectedPlayers[sourceDeviceId];
    if (!roomId || !gameRooms[roomId]) return;

    gameRooms[roomId].forEach(targetDeviceId => {
        if (targetDeviceId !== sourceDeviceId) {
            const targetWs = playersWs[targetDeviceId];
            if (targetWs) {
                targetWs.send(JSON.stringify({
                    type: "scoreAndStrength",
                    deviceId: sourceDeviceId,
                    score: score,
                    strength: strength,
                    isGameOver: isGameOver,
                    opponentId: opponentId,
                }));
                console.log("score update sent to " + targetDeviceId + " - " + score + " - " + strength + " - " + opponentId);
            }
        }
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
