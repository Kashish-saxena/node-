const cors = require("cors");
const functions = require("firebase-functions");
const express = require("express");
const http = require("http");
const WebSocket = require("ws");

// Create an Express app
const app = express();
app.use(cors());
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
    let deviceId;

    ws.on("message", (message) => {
        try {
            const data = JSON.parse(message);

            // Handle position updates
            if (data.type === "positionUpdate") {
                console.log("Received position update from " + data.deviceId + " data.newPosition");
                broadcastPositionUpdate(data.deviceId, data.newPosition);
                return;
            }

            // Handle initial connection
            deviceId = data.deviceId;

            if (connectedPlayers[deviceId]) {
                ws.send(JSON.stringify({ status: "error", message: "Already connected." }));
                return;
            }

            playersWs[deviceId] = ws;
            connectedPlayers[deviceId] = null;

            if (waitingSessionQueue.length === 0) {
                waitingSessionQueue.push({ deviceId, ws });
                ws.send(JSON.stringify({
                    status: "waiting",
                    message: "Waiting for opponent...",
                    waitingDeviceId: deviceId
                }));
            } else {
                const waitingDevice = waitingSessionQueue.shift();
                const roomId = "room_" + Math.random().toString(36).substr(2, 9);
                gameRooms[roomId] = [waitingDevice.deviceId, deviceId];

                ws.send(JSON.stringify({
                    status: "connected",
                    roomId,
                    deviceId: deviceId,
                    opponentDeviceId: waitingDevice.deviceId
                }));

                waitingDevice.ws.send(JSON.stringify({
                    status: "connected",
                    roomId,
                    deviceId: waitingDevice.deviceId,
                    opponentDeviceId: deviceId
                }));

                connectedPlayers[deviceId] = roomId;
                connectedPlayers[waitingDevice.deviceId] = roomId;

                console.log("Room " + roomId + " created with players: " + waitingDevice.deviceId + " and " + deviceId);
            }
        } catch (error) {
            console.error("Error processing message:", error);
        }
    });

    ws.on("close", () => {
        if (deviceId) {
            const roomId = connectedPlayers[deviceId];

            console.log("Player " + deviceId + " is disconnecting...");
            console.log("Connected players:", connectedPlayers);
            console.log("Game rooms:", gameRooms);

            if (roomId) {
                const room = gameRooms[roomId];

                console.log("Room ID for player:", roomId);
                console.log("Room content:", room);

                if (room) {
                    room.forEach((playerId) => {
                        if (playerId !== deviceId && playersWs[playerId]) {
                            // Notify the remaining player that the other player has disconnected
                            playersWs[playerId].send(JSON.stringify({
                                type: "playerDisconnected",
                                deviceId: deviceId
                            }));

                            // Optionally, disconnect the other player as well
                            playersWs[playerId].close();
                        }
                    });

                    // Remove the player from the room
                    gameRooms[roomId] = room.filter(playerId => playerId !== deviceId);

                    // If both players have disconnected, then delete the room
                    if (gameRooms[roomId].length === 0) {
                        delete gameRooms[roomId];
                        console.log("Room " + roomId + " deleted after both players disconnected.");
                    }
                } else {
                    console.log("No room found for roomId:", roomId);
                }
            } else {
                console.log("No roomId associated with deviceId:", deviceId);
            }

            // Clean up the player and connection data
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

// Expose the WebSocket server as a Cloud Function
exports.api = functions.https.onRequest((req, res) => {
    console.log("Received request:", req.method, req.url);
    server.emit("request", req, res);
});

// Start the server (commented out for Firebase deployment)
// const PORT = 8081;
// server.listen(PORT, () => {
//     console.log("WebSocket server running on port " + PORT);
// });
