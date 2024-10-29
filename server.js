const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require('cors');
const functions = require('firebase-functions');
const {
    log,
    info,
    debug,
    warn,
    error,
    write,
  } = require("firebase-functions/logger");
  

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let waitingSessionQueue = [];
let gameRooms = {};
let playersWs = {};
let connectedPlayers = {};

wss.on("connection", (ws) => {
    let deviceId;

    ws.on("message", (message) => {
        try {
            const data = JSON.parse(message);

            // Handle position updates
            if (data.type === "positionUpdate") {
                console.log("Received position update from " + data.deviceId + "data.newPosition");
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
                    message: "Waiting for opponent..."
                }));
            } else {
                const waitingDevice = waitingSessionQueue.shift();
                const roomId = "room_" + Math.random().toString(36).substr(2, 9);
                gameRooms[roomId] = [waitingDevice.deviceId, deviceId];

                ws.send(JSON.stringify({
                    status: "connected",
                    roomId,
                    secondDevice: waitingDevice.deviceId
                }));

                waitingDevice.ws.send(JSON.stringify({
                    status: "connected",
                    roomId,
                    secondDevice: deviceId
                }));

                connectedPlayers[deviceId] = roomId;
                connectedPlayers[waitingDevice.deviceId] = roomId;

                console.log("Room " + roomId + " created " + waitingDevice.deviceId + " and " + deviceId);
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
            console.log("Player " + deviceId + "disconnected");
        }
    });
});

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
                console.log("position update to " + targetDeviceId);
            }
        }
    });
}

const PORT = 8080;
server.listen(PORT, () => {
    console.log("WebSocket server running on port " + PORT);
});

// Expose the WebSocket server
exports.websocket = functions.https.onRequest((req, res) => {
    server.emit("request", req, res);
});