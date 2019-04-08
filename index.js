const app = require("express")();
const http = require("http").Server(app, {
  pingInterval: 10000,
  pingTimeout: 5000
});
const io = require("socket.io")(http);
const port = process.env.PORT || 3001;

app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );
  next();
});
/**
 * OnGoing games Object
 */
let ON_GOING_GAMES_LIST = {};

/**
 * A Queue of other players waiting to find
 */
let WAITING_QUEUE = [];

/**
 * Look up of on going game Information
 */
let ON_GOING_GAMES_LOOKUP = {};

/**
 * Look up for all connected users socket id that recieved a game key
 */
let CONNECTED_SOCKETS_GAMEKEY = {};
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
    return resumeGame;
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
    const resumeGame = {
      ...ON_GOING_GAMES_LIST[clientKey],
      history: ON_GOING_GAMES_LOOKUP[id].history,
      fen: ON_GOING_GAMES_LOOKUP[id].fen
    };
    return {
      ...gameObjTemplate(resumeGame.id, null, resumeGame.color, clientKey),
      history: resumeGame.history,
      fen: resumeGame.fen
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
      fen: undefined,
      player1: firstPlayerColor,
      player2: getPlayerOppositeColor(firstPlayerColor),
      clientKey1,
      clientKey2,
      playersInGame: ["1"]
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

function updateFen(fen, gameID) {
  ON_GOING_GAMES_LOOKUP[gameID].fen = fen;
}

function insertSocketID(gameKey, socketID) {
  console.log("TCL: insertSocketID -> socketID", socketID);
  console.log("TCL: insertSocketID -> gameKey", gameKey);
  CONNECTED_SOCKETS_GAMEKEY = {
    ...CONNECTED_SOCKETS_GAMEKEY,
    [socketID]: { id: gameKey }
  };
}

function leaveGame(clientKey, gameRoomID) {
  const fetchGame = ON_GOING_GAMES_LOOKUP[gameRoomID];
  if (fetchGame) {
    const players = [fetchGame.clientKey1, fetchGame.clientKey2];
    if (players.includes(clientKey)) {
      /* Validated to leave game now. */
      delete ON_GOING_GAMES_LIST[players[0]];
      delete ON_GOING_GAMES_LIST[players[1]];
      const gameKill = ON_GOING_GAMES_LOOKUP[gameRoomID].gameKill;
      if (gameKill) {
        clearTimeout(gameKill);
      }
      delete ON_GOING_GAMES_LOOKUP[gameRoomID];
      return true;
    }
  }
  return false;
}

function initGameKillCountDown(gameID, timeToKill, clientKey, socket) {
  ON_GOING_GAMES_LOOKUP[gameID].gameKill = setTimeout(() => {
    if (leaveGame(clientKey, gameID)) {
      socket.to(gameID).emit("terminateGame", {
        leaveGame: true,
        gameID
      });
    }
  }, timeToKill);
}

function stopGameKillCountDown(gameID, socket) {
  const gameKillHandle = ON_GOING_GAMES_LOOKUP[gameID].gameKill;
  clearTimeout(gameKillHandle);
  delete ON_GOING_GAMES_LOOKUP[gameID].gameKill;
  socket.to(gameID).emit("playerReconnected", true);
}

function checkIfGameCancelInProgress(gameID, socket) {
  if (ON_GOING_GAMES_LOOKUP[gameID]) {
    ON_GOING_GAMES_LOOKUP[gameID].playersInGame.push("1");

    // If the number of players currently in the game are equal to 2,
    // and there is a gameKill timer, then stop that gameKill timer.
    if (
      ON_GOING_GAMES_LOOKUP[gameID].playersInGame.length === 2 &&
      ON_GOING_GAMES_LOOKUP[gameID].gameKill
    ) {
      stopGameKillCountDown(gameID, socket);
    }
  }
}

function onConnect(socket) {
  console.log("Client connected...");
  console.log("TCL: -> WAITING_QUEUE", WAITING_QUEUE);

  socket.on("disconnect", reason => {
    console.log("Disconnect Reason", reason);
    console.log("Socket ID", socket.id);
    const socketsWithGameKey = CONNECTED_SOCKETS_GAMEKEY[socket.id];
    console.log("TCL: DISCONNECT -> socketsWithGameKey", socketsWithGameKey);
    if (socketsWithGameKey) {
      const { id } = socketsWithGameKey;
      console.log("TCL: DISCONNECT - GAME KEY -> id", id);
      const isOnGoingGame = ON_GOING_GAMES_LOOKUP[id];
      console.log("TCL: DISCONNECT -> isOnGoingGame", isOnGoingGame);
      // Remove the connected socket id from the CONNECTED_SOCKETS_GAMEKEY
      delete CONNECTED_SOCKETS_GAMEKEY[socket.id];
      if (ON_GOING_GAMES_LOOKUP[id]) {
        if (ON_GOING_GAMES_LOOKUP[id].playersInGame) {
          ON_GOING_GAMES_LOOKUP[id].playersInGame.pop();

          if (ON_GOING_GAMES_LOOKUP[id].playersInGame.length === 1) {
            // If atleast one player is left in the game only then start the Init timeout kill.
            // We do this so if the second player also leaves the board, we don't re init the
            // game kill timer.

            // 6 mins = 360000 ms
            initGameKillCountDown(
              id,
              360000,
              ON_GOING_GAMES_LOOKUP[id].clientKey1,
              socket
            );
          }
        }
      }

      if (isOnGoingGame) {
        // If ongoing game broadcast to all players of the gameid about the disconnect and rejoin time
        console.log("Emit Disconnect ----");
        io.in(id).emit("playerDisconnect", { status: true });
      } else {
        // If not an ongoing game the only other possibility is he was in the waiting list.
        // Find and remove object in waiting list having the matching gamekey id.
        WAITING_QUEUE = WAITING_QUEUE.filter(player => player.id !== id);
        console.log("TCL: DISCONECT -> WAITING_QUEUE", WAITING_QUEUE);
      }
    }
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
    insertSocketID(gameKey.id, socket.id);
    checkIfGameCancelInProgress(gameKey.id, socket);
    console.log("TCL: Found Game:", gameKey);
    io.in(clientKey).emit("getGameKey", { ...gameKey, clientKey });
  });

  socket.on("isGameReady", function(gameRoomID) {
    const player2Available = ON_GOING_GAMES_LOOKUP[gameRoomID] ? true : false;
    console.log("Player 2", player2Available);
    io.in(gameRoomID).emit("isGameReady", { player2Available });
  });

  socket.on("leaveGame", function(clientKey, gameRoomID) {
    if (leaveGame(clientKey, gameRoomID)) {
      socket.to(gameRoomID).emit("leaveGame", {
        leaveGame: true,
        gameID: gameRoomID
      });
    }
  });

  socket.on("move", function({ move, promotion, gameRoomID, fen }) {
    console.log(`TCL: onConnect -> move: ${move} for game: ${gameRoomID}`);
    console.log("ON Going", ON_GOING_GAMES_LOOKUP);
    updateMoveHistory(move, gameRoomID);
    updateFen(fen, gameRoomID);
    socket.to(gameRoomID).emit("move", { move, promotion });
  });
}

io.on("connection", onConnect);

app.get("/gamestatus/:clientKey", (req, res) => {
  const clientKey = req.params.clientKey;
  if (checkIfOngoingGameExists(clientKey)) {
    return res.send({ status: true });
  } else {
    return res.send({ status: false });
  }
});

http.listen(port, function() {
  console.log("listening on *:" + port);
});
