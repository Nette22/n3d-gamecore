
  //  game_server.js
  //  by joates (Aug-2013)

  /**
   *  Copyright (c) 2013 Asad Memon
   *  Forked and updated.
   *
   *  MIT Licensed.
   */

  /**
   *  Copyright (c) 2012 Sven "FuzzYspo0N" Bergström
   *  written by : http://underscorediscovery.com
   *  written for: http://buildnewgames.com/real-time-multiplayer/
   *
   *  MIT Licensed.
   */

    var n3d_state = false


    var game_server = module.exports = { games: {}, game_count: 0 }
      , uuid        = require('node-uuid')
      , color       = require('./ansi-color.js')

    // Since we are sharing code with the browser, we
    // are going to include some values to handle that.
    global.window = global.document = global

    // Import shared game library code.
    require('./gamecore_server.js')
    require('./player.js')

  //

      // A simple wrapper for logging so we can toggle it,
      // and augment it for clarity.
      game_server.log = function() {
        var d = new Date()
          , dTime    = d.toTimeString().substr(0, 8)
          , dparts   = d.toDateString().split(' ')
          , ts = '  ' + dTime + ' ' +
                 Array(dparts[2], dparts[1], dparts[3]).join('-')
        console.log.apply(this, new Array(arguments[0] + ts))
      }

  //

      game_server.fake_latency = 0
      game_server.local_time = 0
      game_server._dt  = new Date().getTime()
      game_server._dte = new Date().getTime()

      // a local queue of messages we delay if faking latency
      game_server.messages = []

      setInterval(function() {
        game_server._dt  = new Date().getTime() - game_server._dte
        game_server._dte = new Date().getTime()
        game_server.local_time += game_server._dt / 1000.0
      }, 4)

  //

      game_server.onMessage = function(client, message) {

        if (this.fake_latency && message.split('.')[0].substr(0, 1) == 'i') {

          // store all input message
          game_server.messages.push({ client: client, message: message })

          setTimeout(function() {
            if (game_server.messages.length) {
              game_server._onMessage(game_server.messages[0].client, game_server.messages[0].message)
              game_server.messages.splice(0, 1)
            }
          }.bind(this), this.fake_latency)

        } else {
          game_server._onMessage(client, message)
        }
      }

  //
    
      game_server._onMessage = function(client, message) {

        // Cut the message up into sub components
        var message_parts = message.split('.')

        // The first is always the type of message
        var message_type = message_parts[0]

        if (message_type == 'i') {
          // Input handler will forward this
          this.onInput(client, message_parts)
        } else if (message_type == 'p') {
            client.send('s.p.' + message_parts[1])
        } else if (message_type == 'c') {

          // issue #3
          /**
          // Client changed their color.
          client.game.player_host.send('s.c.' + message_parts[1])

          // send changed color messages to all the other clients.
          for (var i=0, l=client.game.player_client.length; i<l; i++) {
            var p = client.game.player_client[i]
            p.send('s.c.' + message_parts[1])
          }
          */

        } else if (message_type == 'l') {
          // A client is asking for lag simulation
          this.fake_latency = parseFloat(message_parts[1])
        }
      }

  //

      game_server.onInput = function(client, parts) {
        // The input commands come in like 1:-2,
        // so we split them up and then update the players.
        var input_commands = parts[1].split(':')
        var input_time = parts[2].replace('-', '.')
        var input_seq = parts[3]

        // the client should be in a game, so
        // we can tell that game to handle the input
        if (client && client.game && client.game.gamecore) {

          // issue #2
          if (n3d_state) {
            client.game.gamecore.n3d_handle_server_input(client, input_commands, input_time, input_seq)
          } else {
            client.game.gamecore.handle_server_input(client, input_commands, input_time, input_seq)
          }
        }
      }

  //

      game_server.create_game = function(player) {

        // Create a new game instance
        var thegame = {
          uuid: uuid.v4({ rng: uuid.nodeRNG }),   // generate a new id for the game
          player_count: 0,                        // for simple checking of state
          player_capacity: 1024 * 1024 * 0.5      // 524,288 max
        }

        // Store it in the list of game
        this.games[thegame.uuid] = thegame
        this.game_count++

        // Create a new game core instance, this actually runs the
        // game code like collisions and such.
        thegame.gamecore = new game_core(thegame)

        // Start updating the game loop on the server
        thegame.gamecore.update(new Date().getTime())

        // the client needs to know which game it is connected to.
        player.game = thegame

        this.log('   Game start: ' + color.white + player.game.uuid + color.reset + '   ')

        // return the new game instance.
        return thegame
      }

  //

      game_server.leave_game = function(game_uuid, client_uuid) {

        var thegame = this.games[game_uuid]

        if (thegame) {

          if (thegame.player_count > 1) {
            // not the last player, remove one & let the game continue.
            thegame.player_count--
            thegame.gamecore.player_disconnect(client_uuid)
            return
          }

          // no players, stop the game updates
          thegame.gamecore.stop_update()

          // remove the game.
          delete this.games[game_uuid]
          this.game_count--

          this.log('   Game ended: ' + color.red + game_uuid + color.reset + '   ' )

        } else {
            this.log(color.red + '!! ## Error: Game was not found ## !!' + color.reset + '  ' + game_uuid)
        }
      }

  //

      game_server.start_game = function(game) {

        // issue #2
        /**
        for (var i = game.player_client.length - 1; i >= 0; i--) {
          game.player_client[i].send('s.j.' + game.player_host.uuid)
          game.player_client[i].game = game

          // now we tell them that the game is ready to start
          // clients will reset their positions in this case.
          game.player_client[i].send('s.r.'+ String(game.gamecore.local_time).replace('.', '-'))
        }

        //server should get ready and reset stuff too
        game.player_host.send('s.r.'+ String(game.gamecore.local_time).replace('.', '-'))

        //set this flag, so that the update loop can run it.
        game.active = true  // this is not even used !!
        */
      }

  //

      game_server.join_game = function(player) {

        if (this.game_count) {

          var joined_a_game = false

          //Check the list of games for an open game
          for (var gameid in this.games) {

            //only care about our own properties.
            if (! this.games.hasOwnProperty(gameid)) continue

            //get the game we are checking against
            var game_instance = this.games[gameid]

            if (game_instance.player_count < game_instance.player_capacity) {

              joined_a_game = true
              // increase the player count and store
              // the player as the client of this game

              // issue #2
              //game_instance.player_client.push(player)
              game_instance.gamecore.player_connect(player)
              player.game = game_instance
              game_instance.player_count++

              // start running the game on the server,
              // which will tell them to respawn/start
              this.start_game(game_instance)

              }
              if (joined_a_game) break
            }

            //now if we didn't join a game, we create one
            if (! joined_a_game) {
              this.create_game(player)
              // issue #2
              this.join_game(player)    // and join it.
            }

          } else {

          //no games? create one!
          this.create_game(player)
          // issue #2
          this.join_game(player)    // and join it.
        }
      }

