// Defines a NodeJS module to interface via serialport to the JCOM1939 module
// reference http://copperhilltech.com/content/jCOM1939-Protocol.pdf

const EventEmitter = require('events').EventEmitter;

const SerialPort = require('serialport');
const JcomParser = require('./lib/parser.js');
const CanInstance = require('./lib/instance.js');

const START = 192;
const ESC = 219;

const MSG_ID_ACK = 0;

const MSG_ID_RESET  = 5;
const MSG_ID_HEART = 6;
const MSG_ID_FLASH = 10;
const MSG_ID_SETACK = 11;
const MSG_ID_SETHEART = 12;
const MSG_ID_VERSION = 13;

// Messages used with one CAN instance
const MSG_SET1 = {
  ADDFILTER : 1,
  DELFILTER : 2,
  TXDATA : 3,
  RXDATA : 4,
  SETPARAM : 7,
  REQINFO : 8,
  REPSTATUS : 9,
  SETPARAM1 : 14,
  SETMSGMODE : 15,
  TXDATAL : 16,
  TXDATAP : 17,
  TXDATAPL : 18,
};

// Messages used with the seconds CAN instance on a dual-port board
const MSG_SET2 = {
  ADDFILTER : 129,
  DELFILTER : 130,
  TXDATA : 131,
  RXDATA : 132,
  SETPARAM : 135,
  REQINFO : 136,
  REPSTATUS : 137,
  SETPARAM1 : 142,
  SETMSGMODE : 143,
  TXDATAL : 144,
  TXDATAP : 145,
  TXDATAPL : 146,
};


const DEFAULT_TIMEOUT = 2000;


// Default configuration used unless overridden by caller
const DEFAULT_OPTIONS = {

  // Serial port baud rate
  baudRate: 115200,

  // Determines whether board sends ACK messages in response to commands
  ack: true,

  // Heartbeat interval in milliseconds (100-5000).
  // Zero disables heartbeat
  heartbeat: 0,

  // Configuration for CAN instance 1 on the board:
  can1: {},

  // To be used for dual-port boards
  can2: null

};


function seriesPromise( tasks ) {

  return tasks.reduce((promiseChain, currentTask) => {
      return promiseChain.then(chainResults =>
          currentTask.then(currentResult =>
              [ ...chainResults, currentResult ]
          )
      );
  }, Promise.resolve([]));

}

class Jcom1939 extends EventEmitter {
	
	constructor( options ) {

    super();

    // Diagnostic info
    this.hwVersion = '0.00.00';
    this.swVersion = '0.00.00';
    this.boardChecksumErrors = 0;
    this.boardStuffErrors  = 0;

    this.requestQueue = [];

    this.setOptions( options );
  }

  // sets (or re-sets) the configuration options.
  setOptions( options ) {

   // save for later use
    this.options = Object.assign( DEFAULT_OPTIONS, options );

    // Create the first CAN instance with the appropriate message set
    this.options.can1.MSG = MSG_SET1;
    this.can1 = new CanInstance( this, 1, this.options.can1 );

    // Create the second CAN instance with the appropriate message set
    if( this.options.can2 ) {
      this.options.can2.MSG = MSG_SET2;
      this.can2 = new CanInstance( this, 2, this.options.can2 );
    }

  }

  // Returns a promise that resolves to a list of available serial ports
  list() {

    return new Promise( function( resolve, reject ){
      SerialPort.list( function( err, ports ) {
        if( err ) {
          reject( err );
        }
        else {
          resolve( ports );
        }
      });
    });
  }


  // Open the specified serial port and configure as directed
  // Returns a promise that resolves when the operation is complete 
  open( port ) {

    var me = this;

    return new Promise( function( resolve, reject ){
      
      let serialOptions = {
        baudRate: me.options.baudRate
      };

      // Do this last, since the caller will have their callback called
      // when the port is opened
      me.port = new SerialPort( port, serialOptions, function( err ) {

        if( err ) {
          me.emit( 'error', err );
          reject( err );
        }
        else {
          me.emit( 'open' );

          me.configure()
          .then( function() {
            //console.log( 'board configure complete ');

            // board configured, now do CAN instance
            return me.can1.configure();
          })
          .then( function() {
            // if second instance, configure it
            if( me.can2 ) {
              return me.can2.configure();
            }
          })
          .then( function() {
            // success!
            //console.log( 'resolving open');
            resolve();
          })
          .catch( function(err) {
            // configure failed
            reject( err );
          });
        }

      });

      me.parser = me.port.pipe( new JcomParser() ); 

      // call the onData function when data is received
      me.parser.on('data', me.onData.bind(me));

      // Call event handler on serial port error
      me.port.on( 'error', me.onSerialError.bind(me));

    });

  }

  // Sets up a to-do list to send configuration commands to the board
  configure() {

    let me = this;

    // create a to-do list for any necessary configuration
    let todo = [
      me.reset(),
    ];

    // disable acknowledgement if requested
    if( !me.options.ack ) {
      todo.push( me.setAck( me.options.ack ));
    }

    // set heartbeat interval
    todo.push( me.setHeart( me.options.heartbeat ));

    // read the board version info
    //todo.push( me.version());

    // return  me.reset()
    // .then(function() {
    //     return me.setHeart( me.options.heartbeat );
    // });

   // return todo[0].then(function() { return todo[1]; });

    // return the to-do list to the caller
    //return Promise.all( todo );

    //return seriesPromise(todo); //.reduce((p, f) => p.then(f), Promise.resolve());
    return todo.reduce((p, f) => p.then(function() { return f; }), Promise.resolve());
  }


  // Close the serial port and clean up
  close() {
    this.flushRequestQueue();
    if( this.port ) {
      this.port.close();
      this.port = null;
    }
  }

  // Error out any requests we are waiting for
  flushRequestQueue() {
    let me = this;

    me.requestQueue.forEach( function( request ) {
      me.resolveRequest( request.msgId, request.id, new Error('Port Closed'));
    });
  }

  // finds the first matching request in the queue and closes it out
  // by calling the callback, removing the timer if any, and 
  // removing it from the queue
  resolveRequest( request, id, err ) {

    //console.log( 'resolving ' + request );

    let index = this.requestQueue.findIndex( function(item) {
      return item.id === id && item.msgId === request;
    });

    if( index > -1 ){
      if( this.requestQueue[index].timer ) {
        clearTimeout( this.requestQueue[index].timer );
      }

      this.requestQueue[index].cb( err );
      this.requestQueue.splice( index, 1);
    }
  }

  // Event handler for error reported by serial port
  onSerialError(err) {
    // should probably handle this in a more elegant way
    throw err;
  }

  // compute 2's complement checksum over 
  checksum( init, data ) {

    data.forEach( function( value ) {
      init = (init + value) & 0xFF;
    });

    return ((~init) + 1) & 0xFF;
  }


  sendMessage( id, data, options ) {

    var me = this;

    return new Promise( function( resolve, reject ) {

      //console.log( 'sending ' + id);

      options = options || {};

      // if we don't need to wait for an ack, resolve now
      if( options.noack ) {
        me._send( id, data, null, options.timeout );
        resolve();
      }
      else {
        // otherwise use a callback to catch the ack
        let cb = function( err, result ) {
          //console.log( 'cb: ', err );
          if( err ) {
            reject( err );
          }
          else {
            resolve( result );
          }
        };
        //console.log( 'write: ', id, data );

        me._send( id, data, cb, options.timeout );
      }

    });

  }

  // Send a message to the board
  _send( id, data, cb, timeout ) {

    let me = this;

    // applies escaping rules for the START and ESC bytes
    function stuff( byte ) {

      if( byte === START ) {
        return [ ESC, 220 ];
      }
      else if( byte === ESC ) {
        return [ESC, 221 ];
      }
      else {
        return byte;
      }
    }

    // message length = id + unstuffed data + checksum
    let msgLen = data.length + 2;
    let lengthMsb = (msgLen >> 8) & 0xFF;
    let lengthLsb = (msgLen & 0xFF);

    let stuffedArray = [ START ];

    stuffedArray.push( stuff( lengthMsb ));
    stuffedArray.push( stuff( lengthLsb ));

    stuffedArray.push( stuff( id ));

    // escape the data buffer
    data.forEach( function( value ) {
      stuffedArray.push( stuff( value ) );
    });

    let checksum = this.checksum( lengthMsb + lengthLsb + id, data );
    stuffedArray.push( stuff( checksum ));

    me.port.write( stuffedArray );

    if( cb ) {
      
      if( me.options.ack === false ) {
        // not waiting for acks
        cb();
      }
      else {

        timeout = timeout || DEFAULT_TIMEOUT;

        //console.log( 'waiting for response on ' + id + ' timeout ' + timeout );

        // Set a timer in case no response
        let timer = setTimeout( function() {
          me.resolveRequest( MSG_ID_ACK, id, new Error('No Response to ' + id ));
        }, timeout );

        // remember that we are waiting for an ack
        me.requestQueue.push({
          msgId: MSG_ID_ACK,
          id: id,
          timer: timer,
          cb: cb
        });
      }
    }

  }

  // Returns a promise that resolves when the board has been reset to defaults
  reset( bps ) {

    let data = [
      0xA5, 0x69, (bps === 500000)? 0x5B:0x5A
    ];

    return this.sendMessage( MSG_ID_RESET, data );

  }

  // Returns a promise that resolves when the board has been reset to defaults
  setAck( enabled ) {

    let ack = (enabled)? 1:0;

    return this.sendMessage( MSG_ID_SETACK, [ack] );

  }

  // Returns a promise that resolves when the heartbeat interval has been set
  setHeart( ms ) {

    let data = [
      (ms >> 8) & 0xFF,
      (ms) & 0xFF
    ];

    return this.sendMessage( MSG_ID_SETHEART, data );
  }


  // Sends a request to the board to retrieve the hw and sw versions
  // this does not seem to work in the board I have.
  version() {

    let me = this;

    return this.sendMessage( MSG_SET1.REQINFO, [MSG_ID_VERSION], { noack:true } )
    .then( function() {
      return me.waitFor( MSG_ID_VERSION );
    });

  }

  // returns the most recent info received in the heartbeat message
  // or after the version() request was made
  getVersion() {

    return {
      hw: this.hwVersion,
      sw: this.swVersion,
    };
  }

  // Save the version info from the board
  _storeVersion( data ) {
    this.hwVersion = data[1].toString(16) + 
      '.' + data[2].toString(16) +
      '.' + data[3].toString(16);

    this.swVersion = data[4].toString(16) + 
      '.' + data[5].toString(16) +
      '.' + data[6].toString(16) ;
  }


  // decodes the received array into a message object
  _decodeRxData( data ) {
    let pgn = (data[1] << 16) | (data[2] << 8) | (data[3]);
    return {
      pgn: pgn,
      destination: data[4],
      source: data[5],
      priority: data[6],
      data: data.slice( 7 )
    };
  }

  // wait for a message to be received, or a time interval to expire
  waitFor( msgId, timeout ) {

    let me = this;

    return new Promise( function( resolve, reject ){

      let timer = setTimeout( function() {
        me.resolveRequest( msgId, 0, new Error('No Response to ' + msgId ));
      }, timeout || DEFAULT_TIMEOUT );

      let cb = function(err, result) {
        if( err ) {
          reject(err);
        }
        else {
          resolve( result );
        }
      };

      // put it on the list of things we are waiting for
      me.requestQueue.push({
        msgId: msgId,
        id: 0,
        timer: timer,
        cb: cb
      });      
    });
  }


  // Event handler that is triggered when a valid message arrives on the serial port
  onData( data ) {
    
    //console.log( 'onData:', data );

    switch( data[0] ) {
      case MSG_ID_ACK:
        this.resolveRequest( MSG_ID_ACK, data[1] );
        break;

      case MSG_ID_HEART:
        this._storeVersion( data );
        this.boardChecksumErrors = data[7];
        this.boardStuffErrors = data[8];
        this.emit( 'heartbeat' );
        break;

      case MSG_ID_VERSION:
        this._storeVersion( data );
        this.resolveRequest( MSG_ID_VERSION, 0 );
        break;

      case MSG_SET1.REPSTATUS:
        this.can1._handleRepStatus( data );
        this.resolveRequest( data[0], 0 );
        break;

      case MSG_SET2.REPSTATUS:
        this.can2._handleRepStatus( data );
        this.resolveRequest( data[0], 0 );
        break;

      case MSG_SET1.RXDATA:
        this.can1.emit( 'pgn', this._decodeRxData( data ));
        break;

      case MSG_SET2.RXDATA:
        this.can2.emit( 'pgn', this._decodeRxData( data ));
        break;

      default:
        break;

    }
  }

}


module.exports = Jcom1939;