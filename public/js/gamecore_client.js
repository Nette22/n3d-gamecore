
  // gamecore_client.js
  // by joates (Aug-2013)

  /**
   *  Copyright (c) 2013 Asad Memon
   *  Forked and updated.
   *
   *  MIT Licensed.
   */

  /**
   *  Copyright (c) 2012 Sven "FuzzYspo0N" Bergström
   *  written by : http://underscorediscovery.com
   *  written for : http://buildnewgames.com/real-time-multiplayer/
   *
   *  MIT Licensed.
   */


  //  The main update loop runs on requestAnimationFrame,
  //  Which falls back to a setTimeout loop on the server
  //  Code below is from Three.js, and sourced from links below

  //  http://paulirish.com/2011/requestanimationframe-for-smart-animating/
  //  http://my.opera.com/emoller/blog/2011/12/20/requestanimationframe-for-smart-er-animating

  //  requestAnimationFrame polyfill by Erik Möller
  //  fixes from Paul Irish and Tino Zijdel

  var frame_time = 60 / 1000  // run the local game at 16ms/ 60hz
  if ('undefined' != typeof(global)) frame_time = 45  //on server we run at 45ms, 22hz

  ;(function() {

    var lastTime = 0
    var vendors = [ 'ms', 'moz', 'webkit', 'o' ]

    for (var x=0; x<vendors.length && ! window.requestAnimationFrame; ++x) {
      window.requestAnimationFrame = window[ vendors[x] + 'RequestAnimationFrame' ]
      window.cancelAnimationFrame = window[ vendors[x] + 'CancelAnimationFrame' ] || window[ vendors[x] + 'CancelRequestAnimationFrame' ]
    }

    if (! window.requestAnimationFrame) {
      window.requestAnimationFrame = function (callback, element) {
        var currTime = Date.now(), timeToCall = Math.max(0, frame_time - (currTime - lastTime))
        var id = window.setTimeout(function() { callback(currTime + timeToCall) }, timeToCall)
        lastTime = currTime + timeToCall
        return id
      }
    }

    if (! window.cancelAnimationFrame) {
      window.cancelAnimationFrame = function (id) { clearTimeout(id) }
    }

  }() )


  //  The game_core class

      var game_core = function() {

        // TODO: collision not implemented yet !
        // Used in collision etc.
        /**
        this.world = {
            width:  800,
            height: 800,
            depth:  800
        }
        */

        this.allplayers = []
        this.selfplayer = new game_player(this)

        // The speed at which the clients move.
        this.playerspeed = 120

        // Set up some physics integration values
        this._pdt  = 0.0001                 //The physics update delta time
        this._pdte = new Date().getTime()   //The physics update last delta time
        // A local timer for precision on server and client
        this.local_time = 0.016             //The local timer
        this._dt  = new Date().getTime()    //The local timer delta
        this._dte = new Date().getTime()    //The local timer last frame time

        // Start a physics loop, this is separate to the rendering
        // as this happens at a fixed frequency
        this.create_physics_simulation()

        // Start a fast paced timer for measuring time easier
        this.create_timer()

        // Create the default configuration settings
        this.client_create_configuration()

        // A list of recent server updates we interpolate across
        // This is the buffer that is the driving factor for our networking
        this.server_updates = []

        //Connect to the socket.io server!
        this.client_connect_to_server()

        // We start pinging the server to determine latency
        this.client_create_ping_timer()

        // Set their colors from the storage or locally
        this.color = localStorage.getItem('color') || '#cc8822'
        localStorage.setItem('color', this.color)
        this.selfplayer.color = this.color

        // Make this only if requested
        if (String(window.location).indexOf('debug') != -1) {
          this.client_create_debug_gui()
        }
      }

  //

      // server side we set the 'game_core' class to a global type, so that it can use it anywhere.
      if ('undefined' != typeof global) module.exports = global.game_core = game_core

  //

  /**
   *  Helper functions for the game code
   *
   *  Here we have some common maths and game related code to make working with 2d vectors easy,
   *  as well as some helpers for rounding numbers to fixed point.
   */

      // (4.22208334636).fixed(n) will return fixed point value to n places, default n = 3
      Number.prototype.fixed = function(n) { n = n || 3; return parseFloat(this.toFixed(n)) }
      // copies a 2d vector like object from one to another
      game_core.prototype.pos = function(a) { return { x:a.x, y:a.y, z:a.z } }
      // Add a 2d vector with another one and return the resulting vector
      game_core.prototype.v_add = function(a, b) { return { x:(a.x + b.x).fixed(), y:(a.y + b.y).fixed(), z:(a.z + b.z).fixed() } }
      // Subtract a 2d vector with another one and return the resulting vector
      game_core.prototype.v_sub = function(a, b) { return { x:(a.x - b.x).fixed(), y:(a.y - b.y).fixed(), z:(a.z - b.z).fixed() } }
      // Multiply a 2d vector with a scalar value and return the resulting vector
      game_core.prototype.v_mul_scalar = function(a, b) { return { x:(a.x * b).fixed(), y:(a.y * b).fixed(), z:(a.z * b).fixed() } }
      // For the server, we need to cancel the setTimeout that the polyfill creates
      game_core.prototype.stop_update = function() { window.cancelAnimationFrame(this.updateid) }
      // Simple linear interpolation
      game_core.prototype.lerp = function(p, n, t) { var _t = Number(t); _t = (Math.max(0, Math.min(1, _t))).fixed(); return (p + _t * (n - p)).fixed() }
      // Simple linear interpolation between 2 vectors
      game_core.prototype.v_lerp = function(v, tv, t) { return { x:this.lerp(v.x, tv.x, t), y:this.lerp(v.y, tv.y, t), z:this.lerp(v.z, tv.z, t) } }


  /**
   *  Common functions
   *
   *  These functions are shared between client and server, and are generic
   *  for the game state. The client functions are client_* and server functions
   *  are server_* so these have no prefix.
   */

  //  Main update loop

      game_core.prototype.update = function(t) {
    
        // Work out the delta time
        this.dt = this.lastframetime ? ((t - this.lastframetime) / 1000.0).fixed() : 0.016

        // Store the last frame time
        this.lastframetime = t

        // Update the game specifics
        this.client_update()

        // schedule the next update
        this.updateid = window.requestAnimationFrame(this.update.bind(this), this.viewport)
      }

  //

  /**
   *  Shared between server and client.
   *  In this example, `item` is always of type game_player.
   */

      game_core.prototype.check_collision = function(item) {

        // TODO: collisions not implemented yet !
        /**
        // left
        if (item.pos.x <= item.pos_limits.x_min) {
          item.pos.x = item.pos_limits.x_min
        }

        // right
        if (item.pos.x >= item.pos_limits.x_max) {
          item.pos.x = item.pos_limits.x_max
        }
    
        // floor
        if (item.pos.y <= item.pos_limits.y_min) {
          item.pos.y = item.pos_limits.y_min
        }

        // top
        if (item.pos.y >= item.pos_limits.y_max) {
          item.pos.y = item.pos_limits.y_max
        }

        // front
        if (item.pos.z <= item.pos_limits.z_min) {
          item.pos.z = item.pos_limits.z_min
        }

        // back
        if (item.pos.z >= item.pos_limits.z_max) {
          item.pos.z = item.pos_limits.z_max
        }

        // Fixed point helps be more deterministic
        item.pos.x = item.pos.x.fixed(4)
        item.pos.y = item.pos.y.fixed(4)
        item.pos.z = item.pos.z.fixed(4)
        */
      }

  //

      game_core.prototype.process_input = function(player) {

        // It's possible to have recieved multiple inputs by now,
        // so we process each one
        var x_dir = 0
        var y_dir = 0
        var z_dir = 0

        var ic = player.inputs.length
        if (ic) {
          for (var j=0; j<ic; ++j) {
            // don't process ones we already have simulated locally
            if (player.inputs[j].seq <= player.last_input_seq) continue

            var input = player.inputs[j].inputs
            var c = input.length

            for (var i=0; i<c; i+=2) {
              x_dir = input[i]
              z_dir = input[i + 1]
            }
          }
        }

        // we have a direction vector now, so apply the same physics as the client
        var resulting_vector = this.physics_movement_vector_from_direction(x_dir, y_dir, z_dir)
        if (player.inputs.length) {
          // we can now clear the array since these have been processed
          player.last_input_time = player.inputs[ic - 1].time
          player.last_input_seq  = player.inputs[ic - 1].seq
        }

        // give it back
        return resulting_vector
      }

  //

      game_core.prototype.physics_movement_vector_from_direction = function(x, y, z) {

        // Must be fixed step, at physics sync speed.
        return {
          x: (x * (this.playerspeed * 0.015)).fixed(3),
          y: (y * (this.playerspeed * 0.015)).fixed(3),
          z: (z * (this.playerspeed * 0.015)).fixed(3)
        }
      }

  //

      game_core.prototype.update_physics = function() {
        this.client_update_physics()
      }

  //

      game_core.prototype.client_handle_input = function(inpt) {

        // This takes input from the client and keeps a record,
        // It also sends the input information to the server immediately
        // as it is pressed. It also tags each input with a sequence number.

        if (! inpt) return { x:0, y:0, z:0 }

        var x_dir = inpt.x
        var y_dir = 0
        var z_dir = inpt.z

        if (inpt.x != 0 && inpt.z != 0) {

          // Update what sequence we are on now
          this.input_seq += 1

          // Store the input state as a snapshot of what happened.
          this.selfplayer.inputs.push({
            inputs: [ inpt.x, inpt.z ],
            time:   this.local_time.fixed(3),
            seq:    this.input_seq
          })

          // modify the coordinate values ready for socket transport to server.
          var input = String(inpt.x).replace('.', ',') + ':' + String(inpt.z).replace('.', ',')

          // Send the packet of information to the server.
          // The input packets are labelled with an 'i' in front.
          var server_packet = 'i.'
          server_packet += input + '.'
          server_packet += this.local_time.toFixed(3).replace('.', '-') + '.'
          server_packet += this.input_seq

          this.socket.send(server_packet)

          // Return the direction if needed
          return this.physics_movement_vector_from_direction(x_dir, y_dir, z_dir)

        } else {
          return { x:0, y:0, z:0 }
        }
      }

  //

      game_core.prototype.client_process_net_prediction_correction = function() {

        // No updates...
        if (! this.server_updates.length) return
        //return

        // The most recent server update
        var latest_server_data = this.server_updates[this.server_updates.length - 1]

        // Our latest server position
        var my_server_pos = latest_server_data.vals[latest_server_data.myi].pos

        // Update the debug server position block
        this.selfplayer.ghostpos = this.pos(my_server_pos)

        // here we handle our local input prediction,
        // by correcting it with the server and reconciling its differences

        var my_last_input_on_server = latest_server_data.vals[latest_server_data.myi].seq
        if (my_last_input_on_server) {
          // The last input sequence index in my local input list
          var lastinputseq_index = -1
          // Find this input in the list, and store the index
          for (var i=0, l=this.selfplayer.inputs.length; i<l; ++i) {
            if (this.selfplayer.inputs[i].seq == my_last_input_on_server) {
              lastinputseq_index = i
              break
            }
          }

          // Now we can crop the list of any updates we have already processed
          if (lastinputseq_index != -1) {
            // so we have now gotten an acknowledgement from the server that our inputs here have been accepted
            // and that we can predict from this known position instead

            // remove the rest of the inputs we have confirmed on the server
            var number_to_clear = Math.abs(lastinputseq_index - (-1))
            this.selfplayer.inputs.splice(0, number_to_clear)
            // The player is now located at the new server position, authoritive server
            this.selfplayer.cur_state.pos = this.pos(my_server_pos)
            this.selfplayer.last_input_seq = lastinputseq_index
            // Now we reapply all the inputs that we have locally that
            // the server hasn't yet confirmed. This will 'keep' our position the same,
            // but also confirm the server position at the same time.
            this.client_update_physics()
            this.client_update_local_position()
          }
        }
      }

  //

      game_core.prototype.client_process_net_updates = function() {

        // No updates...
        if (! this.server_updates.length) return

        // First:
        // Find the position in the updates, on the timeline
        // We call this current_time, then we find the past_pos
        // and the target_pos using this, searching throught the
        // server_updates array for current_time in between 2 other times.
        // Then:
        // other player position = lerp(past_pos, target_pos, current_time)

        // Find the position in the timeline of updates we stored.
        var current_time = this.client_time
        var count = this.server_updates.length - 1
        var target = null
        var previous = null

        // We look from the 'oldest' updates, since the newest ones are at the
        // end (list.length-1 for example). This will be expensive only when
        // our time is not found on the timeline, since it will run all samples.
        // Usually this iterates very little before breaking out with a target.
        for (var i=0; i<count; ++i) {

          var point = this.server_updates[i]
          var next_point = this.server_updates[i + 1]

          // Compare our point in time with the server times we have
          if (current_time > point.t && current_time < next_point.t) {
            target = next_point
            previous = point
            break
          }
        }

        // With no target we store the last known
        // server position and move to that instead
        if (! target) {
          target = this.server_updates[0]
          previous = this.server_updates[0]
        }

        // Now that we have a target and a previous destination,
        // We can interpolate between them based on 'how far in between' we are.
        // This is simple percentage maths, value/target = [0,1] range of numbers.
        // lerp requires the 0,1 value to lerp to? thats the one.

        if (target && previous) {

          this.target_time = target.t

          var difference = this.target_time - current_time
          var max_difference = (target.t - previous.t).fixed(3)
          var time_point = (difference / max_difference).fixed(3)

          // Because we use the same target and previous in extreme cases
          // It is possible to get incorrect values due to division by 0 difference
          // and such. This is a safe guard and should probably not be here. lol.
          if (isNaN(time_point)) time_point = 0
          if (time_point == -Infinity) time_point = 0
          if (time_point == Infinity) time_point = 0

          // The most recent server update
          var latest_server_data = this.server_updates[this.server_updates.length - 1]

          for (var i in latest_server_data.vals) {

            if (i == 0) continue

            // These are the exact server positions from this tick, but only for the ghost
            var other_server_pos = (latest_server_data.vals[i]) ? latest_server_data.vals[i].pos : 0

            // The other players positions in this timeline, behind us and in front of us
            var other_target_pos = (target.vals[i]) ? this.pos(target.vals[i].pos) : 0
            var other_past_pos = (previous.vals[i]) ? this.pos(previous.vals[i].pos) : other_target_pos  //set to target if this guy is new

            if (this.allplayers[i]) {
              // update the dest block, this is a simple lerp
              // to the target from the previous point in the server_updates buffer
              this.allplayers[i].ghostpos = this.pos(other_server_pos)
              this.allplayers[i].destpos  = this.v_lerp(other_past_pos, other_target_pos, time_point)

              // apply smoothing from current pos to the new destination pos
              if (this.client_smoothing) {
                this.allplayers[i].pos = this.v_lerp(this.allplayers[i].pos, this.allplayers[i].destpos, this._pdt * this.client_smooth)
              } else {
                this.allplayers[i].pos = this.pos(this.allplayers[i].destpos)
              }
            }
          }

          this.selfplayer = this.allplayers[latest_server_data.myi]  //myi has my index.

          // Now, if not predicting client movement, we will maintain the local player position
          // using the same method, smoothing the players information from the past.
          if (! this.client_predict && ! this.naive_approach) {

            // These are the exact server positions from this tick, but only for the ghost
            var my_server_pos = latest_server_data.vals[latest_server_data.myi].pos

            // The other players positions in this timeline, behind us and in front of us
            var my_target_pos = target.vals[target.myi].pos
            var my_past_pos = previous.vals[previous.myi].pos

            // Snap the ghost to the new server position
            this.selfplayer.ghostpos = this.pos(my_server_pos)
            var local_target = this.v_lerp(my_past_pos, my_target_pos, time_point)

            // Smoothly follow the destination position
            if (this.client_smoothing) {
              this.selfplayer.pos = this.v_lerp(this.selfplayer.pos, local_target, this._pdt * this.client_smooth)
            } else {
              this.selfplayer.pos = this.pos(local_target)
            }
          }
        }
      }

  //

      game_core.prototype.client_onserverupdate_recieved = function(data) {

        // Store the server time (this is offset by the latency in the network, by the time we get it)
        this.server_time = data.t
        // Update our local offset time from the last server update
        this.client_time = this.server_time - (this.net_offset / 1000)

       /**
        *  TODO: vals should be an Object() keyed by player.uuid
        *
        *  IMPORTANT NOTE:
        *
        *  1. the vals array is indexed using idingame which can
        *     never have a zero value, but the array is ALWAYS
        *     padded with a [0] element !!
        *
        *  2. the length of the vals array is not how many users
        *     are currently in our local game simulation, it goes
        *     from [0] up to the highest player.idingame which
        *     potentially can have many undefined elements as the
        *     number of connected players climbs (not scalable !!)
        */

        if (data.vals.length < this.allplayers.length) {
          // if some player(s) left in this new update, we can do cleanup.
          for (var i=this.allplayers.length-1; i>0; i--) {
            if (! data.vals[i] && this.allplayers[i] != undefined) {
              delete this.allplayers[i]
              scene_remove_mesh(i)
              console.log("deleted player #" + i)
            }
          }
        }

        for (var i in data.vals) {

          if (i < 1) continue

          if (data.vals[i] && ! this.allplayers[i]) {
            // need player to exist so we can apply the update.
            this.allplayers[i] = new game_player(this)
            scene_add_mesh(this.allplayers[i], i)
            console.log("created player #" + i)
          }

          if (this.allplayers[i]) {
            this.allplayers[i].state = "Player #" + i
            this.allplayers[i].idingame = i
          }
        }

        this.selfplayer = this.allplayers[data.myi]  //myi has my index. 
        this.selfplayer.myi = data.myi

        // One approach is to set the position directly as the server tells you.
        // This is a common mistake and causes somewhat playable results on a local LAN, for example,
        // but causes terrible lag when any ping/latency is introduced. The player can not deduce any
        // information to interpolate with so it misses positions, and packet loss destroys this approach
        // even more so. See 'the bouncing ball problem' on Wikipedia.

        if (this.naive_approach) {
          for (var i in data.vals) {

            if (i == 0) continue

            // loop for all players
            this.allplayers[i].pos = this.pos(data.vals[i].pos)
          }

        } else {

          // Cache the data from the server,
          // and then play the timeline
          // back to the player with a small delay (net_offset), allowing
          // interpolation between the points.
          this.server_updates.push(data)

          // we limit the buffer in seconds worth of updates
          // 60fps*buffer seconds = number of samples
          if (this.server_updates.length >= (60 * this.buffer_size)) {
            this.server_updates.splice(0, 1)
          }

          // We can see when the last tick we know of happened.
          // If client_time gets behind this due to latency, a snap occurs
          // to the last tick. Unavoidable, and a reallly bad connection here.
          // If that happens it might be best to drop the game after a period of time.
          this.oldest_tick = this.server_updates[0].t

          // Handle the latest positions from the server
          // and make sure to correct our local predictions, making the server have final say.
          this.client_process_net_prediction_correction()
        }
      }

  //

      game_core.prototype.client_update_local_position = function() {

        if (this.client_predict) {

          // Work out the time we have since we updated the state
          var t = (this.local_time - this.selfplayer.state_time) / this._pdt

          // Then store the states for clarity,
          var old_state = this.selfplayer.old_state.pos
          var current_state = this.selfplayer.cur_state.pos

          // Make sure the visual position matches the states we have stored
          //this.selfplayer.pos = this.v_add(old_state, this.v_mul_scalar(this.v_sub(current_state,old_state), t))
          this.selfplayer.pos = current_state

          // TODO: collisions are ignored for now!
          //We handle collision on client if predicting.
          //this.check_collision( this.selfplayer )
        }
      }

  //

      game_core.prototype.client_update_physics = function() {

        // Fetch the new direction from the input buffer,
        // and apply it to the state so we can smooth it in the visual state

        if (this.client_predict) {
          this.selfplayer.old_state.pos = this.pos(this.selfplayer.cur_state.pos)
          var nd = this.process_input(this.selfplayer)
          this.selfplayer.cur_state.pos = this.v_add(this.selfplayer.old_state.pos, nd)
          this.selfplayer.state_time = this.local_time
        }
      }

  //

      game_core.prototype.client_update = function() {

        // 2D Viewport visibility.
        if (! this.show_2D) this.viewport.style.visibility = 'hidden'
        else this.viewport.style.visibility = 'visible'

        // 3D Viewport visibility.
        if (! this.show_3D) this.scene.style.visibility = 'hidden'
        else this.scene.style.visibility = 'visible'

        // Update & Render the 3D scene.
        var input_coords = scene_update(this.allplayers)
        scene_render()

        // 2D viewport (player map)
        this.ctx.clearRect(0, 0, this.viewport.width, this.viewport.height)

        // draw help/information if required
        this.client_draw_info()

        // Capture inputs from the player
        this.client_handle_input(input_coords)

        // Network player just gets drawn normally, with interpolation from
        // the server updates, smoothing out the positions from the past.
        // Note that if we don't have prediction enabled - this will also
        // update the actual local client position on screen as well.
        if (! this.naive_approach) {
          this.client_process_net_updates()
        }

        // When we are doing client side prediction, we smooth out our position
        // across frames using local input states we have stored.
        this.client_update_local_position()

        for (var i in this.allplayers) {

          // need the client players position to use when calculating map view.
          var map_offset_pos = this.allplayers[this.selfplayer.myi].pos

          if (this.selfplayer.myi != i) {
            // only showing _other_ players on the 2d map !!

            // Now they should have updated, we can draw the entities themselves
            this.allplayers[i].draw(map_offset_pos)

            // and these
            if (this.show_dest_pos && !this.naive_approach) {
              this.allplayers[i].drawdestghost(map_offset_pos)
            }

            // and lastly draw these
            if (this.show_server_pos && ! this.naive_approach) {
              this.allplayers[i].drawserverghost(map_offset_pos)
            }
          }
        }
    
        // Work out the fps average
        this.client_refresh_fps()
      }

  //

      game_core.prototype.create_timer = function() {
        setInterval(function() {
          this._dt  = new Date().getTime() - this._dte
          this._dte = new Date().getTime()
          this.local_time += this._dt / 1000.0
        }.bind(this), 4)
      }

  //

      game_core.prototype.create_physics_simulation = function() {
        setInterval(function() {
          this._pdt  = (new Date().getTime() - this._pdte) / 1000.0
          this._pdte = new Date().getTime()
          this.update_physics()
        }.bind(this), 15)
      }

  //

      game_core.prototype.client_create_ping_timer = function() {

        //Set a ping timer to 1 second, to maintain the ping/latency between
        //client and server and calculated roughly how our connection is doing

        setInterval(function() {
          this.last_ping_time = new Date().getTime() - this.fake_lag
          this.socket.send('p.' + (this.last_ping_time))
        }.bind(this), 1000)
      }

  //

      game_core.prototype.client_create_configuration = function() {

        this.show_2D = false
        this.show_3D = true
        this.heading = 0

        this.show_help = false          // Whether or not to draw the help text
        this.naive_approach = false     // Whether or not to use the naive approach
        this.show_server_pos = false    // Whether or not to show the server position
        this.show_dest_pos = false      // Whether or not to show the interpolation goal
        this.client_predict = true      // Whether or not the client is predicting input
        this.input_seq = 0              // When predicting client inputs, we store the last input as a sequence number
        this.client_smoothing = true    // Whether or not the client side prediction tries to smooth things out
        this.client_smooth = 25         // amount of smoothing to apply to client update dest

        this.net_latency = 0.001        // the latency between the client and the server (ping/2)
        this.net_ping = 0.001           // The round trip time from here to the server,and back
        this.last_ping_time = 0.001     // The time we last sent a ping
        this.fake_lag = 0               // If we are simulating lag, this applies only to the input client (not others)
        this.fake_lag_time = 0

        this.net_offset = 100           // 100 ms latency between server and client interpolation for other clients
        this.buffer_size = 2            // The size of the server history to keep for rewinding/interpolating.
        this.target_time = 0.01         // the time where we want to be in the server timeline
        this.oldest_tick = 0.01         // the last time tick we have available in the buffer

        this.client_time = 0.01         // Our local 'clock' based on server time - client interpolation(net_offset).
        this.server_time = 0.01         // The time the server reported it was at, last we heard from it
    
        this.dt = 0.016                 // The time that the last frame took to run
        this.fps = 0                    // The current instantaneous fps (1/this.dt)
        this.fps_avg_count = 0          // The number of samples we have taken for fps_avg
        this.fps_avg = 0                // The current average fps displayed in the debug UI
        this.fps_avg_acc = 0            // The accumulation of the last avgcount fps samples

        this.lit = 0
        this.llt = new Date().getTime()
      }

  //

      game_core.prototype.client_create_debug_gui = function() {

        this.gui = new dat.GUI({ width: 200 })

        var _playersettings = this.gui.addFolder('Your settings')
        this.colorcontrol = _playersettings.addColor(this, 'color')

        // We want to know when we change our color so we can tell
        // the server to tell the other clients for us
        this.colorcontrol.onChange(function(value) {
            this.selfplayer.color = value
            localStorage.setItem('color', value)
            this.socket.send('c.' + this.selfplayer.myi+"," + value)
        }.bind(this))

        _playersettings.add(this, 'show_2D').listen()
        _playersettings.add(this, 'show_3D').listen()
        //_playersettings.add(this, 'heading').listen()
        _playersettings.open()

        var _othersettings = this.gui.addFolder('Methods')

        _othersettings.add(this, 'naive_approach').listen()
        _othersettings.add(this, 'client_smoothing').listen()
        _othersettings.add(this, 'client_smooth').listen()
        _othersettings.add(this, 'client_predict').listen()

        var _debugsettings = this.gui.addFolder('Debug view')
        
        _debugsettings.add(this, 'show_help').listen()
        _debugsettings.add(this, 'fps_avg').listen()
        _debugsettings.add(this, 'show_server_pos').listen()
        _debugsettings.add(this, 'show_dest_pos').listen()
        _debugsettings.add(this, 'local_time').listen()

        _debugsettings.open()

        var _consettings = this.gui.addFolder('Connection')
        _consettings.add(this, 'net_latency').step(0.001).listen()
        _consettings.add(this, 'net_ping').step(0.001).listen()

        // When adding fake lag, we need to tell the server about it.
        var lag_control = _consettings.add(this, 'fake_lag').step(0.001).listen()
        lag_control.onChange(function(value) {
          this.socket.send('l.' + value)
        }.bind(this))

        _consettings.open()

        var _netsettings = this.gui.addFolder('Networking')
        
        _netsettings.add(this, 'net_offset').min(0.01).step(0.001).listen()
        _netsettings.add(this, 'server_time').step(0.001).listen()
        _netsettings.add(this, 'client_time').step(0.001).listen()
        //_netsettings.add(this, 'oldest_tick').step(0.001).listen()

        _netsettings.open()
      }

  //

      game_core.prototype.client_reset_positions = function() {

        for (var i=0, l=this.allplayers.length; i<l; i++) {
          if (this.allplayers[i] && ! isNaN(this.allplayers[i].pos.x)) {
            var p = this.allplayers[i]
            p.old_state.pos = this.pos(p.pos)
            p.cur_state.pos = this.pos(p.pos)
            p.ghostpos = this.pos(p.pos)
            p.destpos = this.pos(p.pos)
          }
        }
      }

  //

      game_core.prototype.client_onreadygame = function(data) {
        var server_time = parseFloat(data.replace('-', '.'))

        this.local_time = server_time + this.net_latency
        //console.log('server time is about ' + this.local_time)
        for (var i=0, l=this.allplayers.length; i<l; i++) {

          var p = this.allplayers[i]

          // Store their info colors for clarity.
          // give them some color in random until a color update comes
          //p.setrandomcolor()

          if (p != undefined) {
            // Update their information
            p.state = "Player #" + (i + 1)
            //if (i == 0) p.resetpos = { x:0, y:0, z:0 }
          }
        }
      }

  //

      game_core.prototype.client_onjoingame = function(data) {

        // TODO: is this function ever called ?

        //We are not the host
        this.selfplayer.host = false
        //Update the local state
        this.selfplayer.state = 'connected.joined.waiting'
        this.selfplayer.info_color = '#fff'

        //Make sure the positions match servers and other clients
        this.client_reset_positions()
      }

  //

      game_core.prototype.client_onhostgame = function(data) {

        // TODO: is this function ever called ?

        // The server sends the time when asking us to host, but it should be a new game.
        // so the value will be really small anyway (15 or 16ms)
        var server_time = parseFloat(data.replace('-', '.'))

        // Get an estimate of the current time on the server
        this.local_time = server_time + this.net_latency

        // Set the flag that we are hosting, this helps us position respawns correctly
        this.selfplayer.host = true

        // Update debugging information to display state
        this.selfplayer.state = 'hosting.waiting for a player'
        this.selfplayer.info_color = '#fff'

        // Make sure we start in the correct place as the host.
        this.client_reset_positions()
      }

  //

      game_core.prototype.client_onconnected = function(data) {

        // The server responded that we are now in a game,
        // this lets us store the information about ourselves and set the colors
        // to show we are now ready to be playing.
        this.selfplayerid = data.id
        this.selfplayer.info_color = '#cc0000'
        this.selfplayer.state = 'connected'
        this.selfplayer.online = true
      }

  //

      game_core.prototype.client_on_otherclientcolorchange = function(data) {
        var commands = data.split(',')
        if (this.allplayers[commands[0]]) {
          // players color on 2D map.
          this.allplayers[commands[0]].color = commands[1]
          // players color in 3D scene.
          scene_update_player_color(commands[0], commands[1])
        }
      }

  //

      game_core.prototype.client_onping = function(data) {
        this.net_ping = new Date().getTime() - parseFloat(data)
        this.net_latency = this.net_ping / 2
      }

  //

      game_core.prototype.client_onnetmessage = function(data) {

        var commands = data.split('.')
        var command = commands[0]
        var subcommand  = commands[1] || null
        var commanddata = commands[2] || null

        switch (command) {
          case 's': //server message

            switch (subcommand) {
              case 'h' : //host a game requested
                this.client_onhostgame(commanddata); break

              case 'j' : //join a game requested
                this.client_onjoingame(commanddata); break

              case 'r' : //ready a game requested
                this.client_onreadygame(commanddata); break

              case 'e' : //end game requested
                this.client_ondisconnect(commanddata); break

              case 'p' : //server ping
                this.client_onping(commanddata); break

              case 'c' : //other player changed colors
                this.client_on_otherclientcolorchange(commanddata); break
            }

          break
        }
      }

  //

      game_core.prototype.client_ondisconnect = function(data) {

        // When we disconnect, we don't know if the other player is
        // connected or not, and since we aren't, everything goes to offline

        for(var i=0, l=this.allplayers.length; i<l; i++) {
          this.allplayers[i].info_color = 'rgba(255,255,255,0.1)'
          this.allplayers[i].state = 'not-connected'
        }

        this.selfplayer.info_color = 'rgba(255,255,255,0.1)'
        this.selfplayer.state = 'not-connected'
        this.selfplayer.online = false
      }

  //

      game_core.prototype.client_connect_to_server = function() {

        // Store a local reference to our connection to the server
        this.socket = io.connect()

        // When we connect, we are not 'connected' until we have a server id
        // and are placed in a game by the server. The server sends us a message for that.
        this.socket.on('connect', function() {
          this.selfplayer.state = 'connecting'
        }.bind(this))

        // Sent when we are disconnected (network, server down, etc)
        this.socket.on('disconnect', this.client_ondisconnect.bind(this))
        // Sent each tick of the server simulation. This is our authoritive update
        this.socket.on('onserverupdate', this.client_onserverupdate_recieved.bind(this))
        // Handle when we connect to the server, showing state and storing id's.
        this.socket.on('onconnected', this.client_onconnected.bind(this))
        // On error we just show that we are not connected for now. Can print the data.
        this.socket.on('error', this.client_ondisconnect.bind(this))
        // On message from the server, we parse the commands and send it to the handlers
        this.socket.on('message', this.client_onnetmessage.bind(this))
      }

  //

      game_core.prototype.client_refresh_fps = function() {

        // We store the fps for 10 frames, by adding it to this accumulator
        this.fps = 1 / this.dt
        this.fps_avg_acc += this.fps
        this.fps_avg_count++

        // When we reach 10 frames we work out the average fps
        if (this.fps_avg_count >= 10) {
          this.fps_avg = this.fps_avg_acc / 10
          this.fps_avg_count = 1
          this.fps_avg_acc = this.fps
        }
      }

  //

      game_core.prototype.client_draw_info = function() {

        // We don't want this to be too distracting
        this.ctx.fillStyle = 'rgba(255,255,255,0.3)'

        // They can hide the help with the debug GUI
        if (this.show_help) {

          this.ctx.fillText('net_offset : local offset of others players and their server updates. Players are net_offset "in the past" so we can smoothly draw them interpolated.', 10 , 30)
          this.ctx.fillText('server_time : last known game time on server', 10 , 70)
          this.ctx.fillText('client_time : delayed game time on client for other players only (includes the net_offset)', 10 , 90)
          this.ctx.fillText('net_latency : Time from you to the server. ', 10 , 130)
          this.ctx.fillText('net_ping : Time from you to the server and back. ', 10 , 150)
          this.ctx.fillText('fake_lag : Add fake ping/lag for testing, applies only to your inputs (watch server_pos block!). ', 10 , 170)
          this.ctx.fillText('client_smoothing/client_smooth : When updating players information from the server, it can smooth them out.', 10 , 210)
          this.ctx.fillText(' This only applies to other clients when prediction is enabled, and applies to local player with no prediction.', 170 , 230)
        }

        // Draw some information for the host
        if (this.selfplayer.host) {
          this.ctx.fillStyle = 'rgba(255,255,255,0.7)'
          this.ctx.fillText('You are the host', 10 , 465)
        }

        // Reset the style back to full white.
        this.ctx.fillStyle = 'rgba(255,255,255,1)'
      }
