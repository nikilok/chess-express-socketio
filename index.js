const app = require("express")();
const http = require("http").Server(app, {
  pingInterval: 10000,
  pingTimeout: 5000
});
const io = require("socket.io")(http);
const port = process.env.PORT || 3001;

/**
 * OnGoing games Object
 */
let ON_GOING_GAMES_LIST = {};

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
function findGame(clientKey) {
  const resumeGame = checkIfOngoingGameExists(clientKey);
  if (resumeGame) {
    // The current player had left an early game in progess and he must rejoin.
    return {
      ...gameObjTemplate(resumeGame.id, null, resumeGame.color, clientKey),
      history: resumeGame.history
    };
  }
  const waitingQueueLength = WAITING_QUEUE.length;
  const checkInQueue = checkIfAlreadyInWaitingQueue(clientKey);
  if (checkInQueue) {
    return checkInQueue;
  }

  if (waitingQueueLength === 0) {
    // Get new game object
    const newGameObj = createNewGameObject(clientKey);
    WAITING_QUEUE.push(newGameObj);
    console.log("TCL: findGame -> WAITING_QUEUE", WAITING_QUEUE);
    return newGameObj;
  } else {
    // If people are in the queue remove the first players game id.
    const oldestWaitingPlayer = WAITING_QUEUE.shift();
    const {
      id,
      created,
      colorAllocated,
      clientKey: clientKey1
    } = oldestWaitingPlayer;
    const newOnGoingGameObj = createNewOnGoingGameLookup(
      id,
      created,
      colorAllocated,
      clientKey1,
      clientKey
    );
    ON_GOING_GAMES_LOOKUP = { ...ON_GOING_GAMES_LOOKUP, ...newOnGoingGameObj };
    console.log(
      "TCL: findGame -> ON_GOING_GAMES_LOOKUP",
      ON_GOING_GAMES_LOOKUP
    );
    ON_GOING_GAMES_LIST = {
      ...ON_GOING_GAMES_LIST,
      [clientKey1]: { id, color: colorAllocated },
      [clientKey]: { id, color: getPlayerOppositeColor(colorAllocated) }
    };
    console.log("TCL: findGame -> ON_GOING_GAMES_LIST", ON_GOING_GAMES_LIST);
    return gameObjTemplate(
      id,
      created,
      getPlayerOppositeColor(colorAllocated),
      clientKey
    );
  }
}

function checkIfAlreadyInWaitingQueue(clientKey) {
  return WAITING_QUEUE.find(item => item.clientKey === clientKey);
}

function checkIfOngoingGameExists(clientKey) {
  if (ON_GOING_GAMES_LIST[clientKey]) {
    const { id } = ON_GOING_GAMES_LIST[clientKey];
    return {
      ...ON_GOING_GAMES_LIST[clientKey],
      history: ON_GOING_GAMES_LOOKUP[id].history
    };
  } else {
    return undefined;
  }
}

function createNewGameObject(clientKey) {
  return gameObjTemplate(generateRandomGameID(), Date.now(), "w", clientKey);
}

function gameObjTemplate(id, created, color, clientKey) {
  return {
    id,
    created,
    colorAllocated: color,
    clientKey
  };
}

function createNewOnGoingGameLookup(
  gameId,
  created,
  firstPlayerColor,
  clientKey1,
  clientKey2
) {
  return {
    [gameId]: {
      created: created,
      started: Date.now(),
      history: [],
      player1: firstPlayerColor,
      player2: getPlayerOppositeColor(firstPlayerColor),
      clientKey1,
      clientKey2
    }
  };
}

function getPlayerOppositeColor(color) {
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

function updateMoveHistory(move, gameID) {
  ON_GOING_GAMES_LOOKUP[gameID].history.push(move);
}

function onConnect(socket) {
  console.log("Client connected...");

  socket.on("disconnect", reason => {
    console.log("Disconnect Reason", reason);
  });

  socket.on("subscribe", function(key) {
    console.log("TCL: Subscribe to Room:", key);
    socket.join(key);
  });

  socket.on("unsubscribe", function(key) {
    console.log("TCL: Leave Channel", key);
    socket.leave(key);
  });

  socket.on("getGameKey", function(clientKey) {
    console.log("TCL: onConnect -> getGameKey", clientKey);
    const gameKey = findGame(clientKey);
    console.log("TCL: Found Game:", gameKey);
    io.in(clientKey).emit("getGameKey", { ...gameKey, clientKey });
  });

  socket.on("isGameReady", function(gameRoomID) {
    const player2Available = ON_GOING_GAMES_LOOKUP[gameRoomID] ? true : false;
    console.log("Player 2", player2Available);
    io.in(gameRoomID).emit("isGameReady", { player2Available });
  });

  socket.on("move", function({ move, promotion, gameRoomID }) {
    console.log(`TCL: onConnect -> move: ${move} for game: ${gameRoomID}`);
    updateMoveHistory(move, gameRoomID);
    console.log("ON Going", ON_GOING_GAMES_LOOKUP);
    socket.to(gameRoomID).emit("move", { move, promotion });
  });
}

io.on("connection", onConnect);

http.listen(port, function() {
  console.log("listening on *:" + port);
});
