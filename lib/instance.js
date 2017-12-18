// Defines a class that represents an instance of CANBUS.
// A board may support 1 or 2 CAN boards depending on its hardware

const EventEmitter = require('events').EventEmitter;



// Default configuration for each CAN instance
const DEFAULT_INSTANCE_OPTIONS = {

  // The address we would like to negotiate.  If set to 254, we are in 
  // 'listen only' mode and cannot send.
  preferredAddress: 254,

  // If preferredAddress is sent, this should be set to the 8-byte NAME of the ECU
  name: [],
  
  // If preferredAddress is set, and that address is not available, we will
  // try to get an address in this range.
  addressRange: { from: 254, to: 254 },

  // Message Mode:
  // 0: Normal ECU mode
  // 1: Gateway Mode 1: report all PGNs including global address
  // 2: Gateway Mode 2: Mode 1 plus reports protocol PGNs
  messageMode: 0,

};

const DEFAULT_PRIORITY = 4;


class CanInstance extends EventEmitter {
	
	constructor( board, instance, options ) {

    super();

    // the object that lets us communicate with the hardware
    this.board = board;

    // save for later use
    this.options = Object.assign( DEFAULT_INSTANCE_OPTIONS, options );

    // a convenient reference for message ids
    this.MSG = options.MSG;

    this.reportedSourceAddress = 254;

    this.reportedAddrClaimStatus = 0;

  }

  configure() {

    let me = this;
    let todo = [];

    if( me.options.preferredAddress !== 254 ) {

      todo.push( me.setAddress( 
        me.options.name, 
        me.options.preferredAddress, 
        me.options.addressRange
      ));

      todo.push( me.board.waitFor( me.MSG.REPSTATUS ));

    }

    if( me.options.messageMode !== 0 ) {
      todo.push( me.setMessageMode( me.options.messageMode ));
    }

    return Promise.all( todo );

  }


  // returns a promise that resolves when the address claim process is complete
  setAddress( name, preferredAddress, addressRange ) {

    let msgdata = name;

    // default the address range to a benign value
    addressRange = Object.assign( { from: 254, to: 254 }, addressRange );

    msgdata.push( preferredAddress );
    msgdata.push( addressRange.from );
    msgdata.push( addressRange.to );
    msgdata.push( 1 );  // communication mode

    return this.board.sendMessage( this.MSG.SETPARAM1, msgdata );

  }

  // Returns a promise that resolves when the message mode has been set
  setMessageMode( mode ) {

    return this.board.sendMessage( this.MSG.SETMSGMODE, [mode] );

  }


  // Enables receipt of specified PGN(s)
  addFilter( pgn ) {

    var me = this;

    // If PGN isn't an array, make it an array
    if( pgn.constructor !== Array) {
      pgn = [ pgn ];
    }

    // build an array of commands to the board, one per requested PGN
    let todo = [];

    pgn.forEach( function (item) {

      let data = [
        (pgn >> 16) & 0xff,
        (pgn >> 8) & 0xff,
        (pgn) & 0xFF
      ];

      // Add the command to the to-do list
      todo.push( me.board.sendMessage( me.MSG.ADDFILTER, data ));

    });

    // return our to-do list to the caller
    return Promise.all( todo );
  }


  // disable receipt of specified PGN(s)
  removeFilter( pgn ) {

    var me = this;

    // If PGN isn't an array, make it an array
    if( pgn.constructor !== Array) {
      pgn = [ pgn ];
    }

    // build an array of commands to the board, one per requested PGN
    let todo = [];

    pgn.forEach( function (item) {

      let data = [
        (pgn >> 16) & 0xff,
        (pgn >> 8) & 0xff,
        (pgn) & 0xFF
      ];

      // Add the command to the to-do list
      todo.push( me.board.sendMessage( me.MSG.DELFILTER, data ));

    });

    // return our to-do list to the caller
    return Promise.all( todo );
  }

  // Returns a promise that resolves when the board is set to listen mode
  setListenMode() {

    let msgdata = [
      0,0,0,0,0,0,0,0,
      254,
      254,
      254,
      0   // listen mode
    ];

    return me.sendMessage( me.MSG.SETPARAM1, msgdata );
  }


  // Send a message to a destination
  // Options:
  // loopback: true means the message will also be received by us
  // interval: if present, sets the recurring transmission interval for
  // the message.  0 disables the transmission, otherwise the value
  // is specified in milliseconds
  send( pgn, destination, data, options ) {

    var me = this;

    options = Object.assign( { 
      loopback: false
    }, options );

    // whether this message is periodic or not
    let isPeriodic = ( 'undefined' !== typeof(options.interval) );

    // figure out which message to send to the board
    let msgId;

    if( options.loopback ) {
      msgId = (isPeriodic)? me.MSG.TXDATAPL : me.MSG.TXDATAL;
    }
    else {
      msgId = (isPeriodic)? me.MSG.TXDATAP : me.MSG.TXDATA;
    }

    let source = (options.sourceAddress)? options.sourceAddress : me.reportedSourceAddress;
    let priority = (options.priority || DEFAULT_PRIORITY );

    let msgdata = [
      (pgn >> 16) & 0xff,
      (pgn >> 8) & 0xff,
      (pgn) & 0xFF,
      destination & 0xFF,
      source & 0xFF,
      priority
    ];

    // add the transmission interval
    if( isPeriodic ) {
      msgdata.push( (options.interval >> 8) & 0xFF );
      msgdata.push( (options.interval) & 0xFF );
    }

    // add the user's data
    Array.prototype.push.apply( msgdata, data );

    console.log('tx: ', msgId, msgdata);
    return me.board.sendMessage( msgId, msgdata );

  }

  // Returns a promise that resolves when the board status is received
  status() {

    let me = this;

    return new Promise( function( resolve, reject ){
      
      me.sendMessage( me.MSG.REQINFO, [9], function(err) {
        if( err ) {
          reject( err );
        }
        else {

          let timer = setTimeout( function() {
            me.onResponseTimeout( me.MSG.REQINFO );
          }, DEFAULT_TIMEOUT );

          let cb = function(err) {
            if( err ) {
              reject(err);
            }
            else {
              resolve();
            }
          };

          // put it on the list of things we are waiting for
          me.requestQueue.push({
            msgId: me.MSG.REPSTATUS,
            id: 9,
            timer: timer,
            cb: cb
          });      
        }
      
      });
    });    
  }

  _handleRepStatus( data ) {
    
    if( this.reportedSourceAddress !== data[2] ||
      this.reportedAddrClaimStatus !== data[1] ) {

      let str;

      this.reportedSourceAddress = data[2];
      this.reportedAddrClaimStatus = data[1];

      switch( data[1] ) {
        case 1:
          str = 'Claim In Progress';
          break;
        case 2:
          str = 'Claim Successful';
          //this.resolveRequest( me.msg.REPSTATUS, 0 );
          break;
        case 3:
          str = 'Claim Failed';
          //this.resolveRequest( me.MSG.REPSTATUS, 0, new Error('Address Claim Failed') );
          break;
        case 4:
          str = 'Listen-Only Mode';
          break;
        default:
          str = 'Unknown Status ' + data[1];
          break;

      }

      this.emit( 'address', this.reportedAddrClaimStatus, this.reportedSourceAddress, str );

    }    
  }

}

module.exports = CanInstance;