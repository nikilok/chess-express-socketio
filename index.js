const app = require("express")();
const http = require("http").Server(app);
const io = require("socket.io")(http);
const port = process.env.PORT || 3001;

/**
 * OnGoing games Array
 */
const ON_GOING_GAMES_LIST = [];

/**
 * A Queue of other players waiting to find
 */
const WAITING_QUEUE = [];

/**
 * Look up of on going game Information
 */
let ON_GOING_GAMES_LOOKUP = {};

/**
 * Finds a game for a new player
 * 
 * Return  {
    id: GameID,
    created: Creation date,
    colorAllocated: side the player will use
  }
 * 
 */
function findGame() {
  const waitingQueueLength = WAITING_QUEUE.length;
  if (waitingQueueLength === 0) {
    // Get new game object
    const newGameObj = createNewGameObject();
    WAITING_QUEUE.push(newGameObj);
    console.log("TCL: findGame -> WAITING_QUEUE", WAITING_QUEUE);
    return newGameObj;
  } else {
    // If people are in the queue remove the first players game id.
    const oldestWaitingPlayer = WAITING_QUEUE.shift();
    const { id, created, colorAllocated } = oldestWaitingPlayer;
    const newOnGoingGameObj = createNewOnGoingGameLookup(
      id,
      created,
      colorAllocated
    );
    ON_GOING_GAMES_LOOKUP = { ...ON_GOING_GAMES_LOOKUP, ...newOnGoingGameObj };
    console.log(
      "TCL: findGame -> ON_GOING_GAMES_LOOKUP",
      ON_GOING_GAMES_LOOKUP
    );
    ON_GOING_GAMES_LIST.push(id);
    return gameObjTemplate(id, created, getPlayerColor(colorAllocated));
  }
}

function createNewGameObject() {
  return gameObjTemplate(generateRandomGameID(), Date.now(), "w");
}

function gameObjTemplate(id, created, color) {
  return {
    id: id,
    created: created,
    colorAllocated: color
  };
}

function createNewOnGoingGameLookup(gameId, created, firstPlayerColor) {
  return {
    [gameId]: {
      created: created,
      started: Date.now(),
      history: [],
      player1: firstPlayerColor,
      player2: getPlayerColor(firstPlayerColor)
    }
  };
}

function getPlayerColor(color) {
  return color === "w" ? "b" : "w";
}
//http://stackoverflow.com/questions/105034/how-to-create-a-guid-uuid-in-javascript
function generateRandomGameID() {
  return (
    Math.random()
      .toString(36)
      .substring(2, 15) +
    Math.random()
      .toString(36)
      .substring(2, 15)
  );
}

function onConnect(socket) {
  console.log("Client connected...");

  socket.on("subscribeGameKeyInit", function(clientKey) {
    console.log("TCL: onConnect -> subScribeGameKey", clientKey);
    socket.join(clientKey);
  });

  socket.on("getGameKey", function(clientKey) {
    console.log("TCL: onConnect -> getGameKey", clientKey);
    const gameKey = findGame();
    console.log("TCL: onConnect -> FindGame()", gameKey);
    // socket.to(clientKey).emit("getGameKey", gameKey);
    io.in(clientKey).emit("getGameKey", gameKey);
  });

  socket.on("subscribe", function(gameRoomID) {
    console.log("TCL: subscribeToGame -> gameRoomID", generateRandomGameID());
    socket.join(gameRoomID);
  });

  socket.on("move", function({ move, promotion, gameRoomID }) {
    console.log("TCL: onConnect -> move", move);
    socket.to(gameRoomID).emit("move", { move, promotion });
  });
}

io.on("connection", onConnect);

http.listen(port, function() {
  console.log("listening on *:" + port);
});
